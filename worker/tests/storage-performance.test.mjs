import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { API, SCHEMA, hashPw } from '../index.js';
import { D1 } from './d1.mjs';

async function setup() {
  const DB = new D1(); await DB.install(SCHEMA);
  const hash = await hashPw('salt', 'pass1234');
  DB.db.prepare('INSERT INTO users(username,salt,hash,role,name,perms) VALUES(?,?,?,?,?,?)').run('admin','salt',hash,'admin','ผู้ทดสอบ','{}');
  DB.db.prepare('INSERT INTO sessions(token,username,exp) VALUES(?,?,?)').run('token','admin',Date.now()+86400000);
  DB.db.prepare('INSERT INTO kv(k,v) VALUES(?,?)').run('LOG_PRUNE_BUCKET',String(Math.floor(Date.now()/600000)));
  DB.db.prepare('INSERT INTO barcode_items(pos,cat,name,packBar,unitBar) VALUES(?,?,?,?,?)').run(1,'A','สินค้าเดิม','','8850000000001');
  return { env: { DB } };
}

test('stock refresh omits cached barcodes and sends additions/removals after barcode saves', async () => {
  const C = await setup(), initial = await API.stockGet(C,'token');
  assert.equal(initial.barcodes.length,1);
  assert.equal(initial.barcodeRevision,0);
  const cached = await API.stockGet(C,'token','cur',{barcodeRevision:initial.barcodeRevision});
  assert.equal(cached.barcodes,undefined);
  assert.equal(JSON.stringify(cached).includes('"barcodes"'),false);
  await API.addItem(C,'token','','A',{cat:'A',name:'สินค้าใหม่',unitBar:'8850000000002'});
  const changed = await API.stockGet(C,'token','cur',{barcodeRevision:initial.barcodeRevision});
  assert.equal(changed.barcodes.length,2);
  assert.ok(changed.barcodeRevision>initial.barcodeRevision);
  const added = C.env.DB.db.prepare("SELECT id FROM barcode_items WHERE name='สินค้าใหม่'").get();
  await API.deleteItem(C,'token','',added.id,'สินค้าใหม่');
  const removed = await API.stockGet(C,'token','cur',{barcodeRevision:changed.barcodeRevision});
  assert.equal(removed.barcodes.length,1);
  assert.equal((await API.stockGet(C,'token')).barcodes.length,1,'legacy clients continue to receive the complete catalog');
});

test('stock barcode revision and rows come from the same database snapshot', async () => {
  const C = await setup(); let changed = false;
  C.env.DB.hook = async ops => {
    if (changed || !ops.some(q=>q.sql.startsWith("SELECT COALESCE((SELECT revision FROM write_revisions WHERE scope='barcode')"))) return;
    changed = true;
    C.env.DB.db.prepare("UPDATE barcode_items SET name='ข้อมูลล่าสุด'").run();
    C.env.DB.db.prepare("INSERT INTO write_revisions(scope,revision) VALUES('barcode',1)").run();
  };
  const latest = await API.stockGet(C,'token','cur',{barcodeRevision:0});
  assert.equal(changed,true);
  assert.equal(latest.barcodeRevision,1);
  assert.equal(latest.barcodes[0][3],'ข้อมูลล่าสุด');
});

test('re-importing unchanged barcode rows skips rewriting barcode_items and duplicate backups', async () => {
  const C = await setup();
  const grid = [['ชื่อสินค้า', 'เลขบาร์เดี่ยว', 'หมวด'], ...Array.from({ length: 500 }, (_, i) => ['สินค้า ' + i, '885000' + i, 'หมวด A'])];
  await API.importBarcodeData(C, 'token', [{ name: 'A', grid }], 'replace');
  C.env.DB.writes = 0;
  // Re-importing the exact same 500 rows should only write the revision + log, not 500 barcode rows or 500 backup rows!
  await API.importBarcodeData(C, 'token', [{ name: 'A', grid }], 'replace');
  assert.ok(C.env.DB.writes <= 5, `expected <= 5 row writes on unchanged re-import, got ${C.env.DB.writes}`);
});

test('TV music tick deduplicates progress writes during normal continuous playback', async () => {
  const C = await setup();
  await API.musicTvTick(C, 'song1', 10, 200, true);
  C.env.DB.writes = 0;
  // Subsequent ticks whose position matches elapsed time should perform 0 D1 writes.
  await API.musicTvTick(C, 'song1', 10.5, 200, true);
  await API.musicTvTick(C, 'song1', 11.0, 200, true);
  assert.equal(C.env.DB.writes, 0, 'continuous playback ticks do not write to D1 every 5 seconds');
});

test('login and whoami fall back to stateless signed tokens when D1 daily write limit is exceeded', async () => {
  const C = await setup();
  C.env.DB.fail = q => /^(INSERT|UPDATE|DELETE)/i.test(q.sql);
  // Simulate Cloudflare D1 free tier daily row write limit error on any write statement
  const origExec = C.env.DB.execute.bind(C.env.DB);
  C.env.DB.fail = null;
  C.env.DB.execute = q => {
    if (/^(INSERT|UPDATE|DELETE)/i.test(q.sql)) {
      throw new Error("D1_ERROR: Your account has exceeded D1's free tier daily row write limit.");
    }
    return origExec(q);
  };
  const session = await API.login(C, 'admin', 'pass1234');
  assert.ok(session.token.startsWith('s1.'), 'issued stateless signed token when D1 writes are blocked');
  const me = await API.whoami(C, session.token);
  assert.equal(me.user, 'admin');
  assert.equal(me.role, 'admin');
  assert.equal(await API.logout(C, session.token), true);
});

test('market draft bursts serialize once and flush the latest draft before exit without crossing accounts', async () => {
  const html = await readFile(new URL('../../assets/js/pages/market.js',import.meta.url),'utf8');
  const start = html.indexOf('var LOCAL_SAVE_TIMER ='), end = html.indexOf('function loadLocalState()',start);
  assert.ok(start>0 && end>start);
  const timers = new Map(), writes = []; let nextTimer = 0, serializations = 0, state = {value:0};
  const context = vm.createContext({
    D:{me:{user:'admin'}}, DIRTY:true, STORAGE_KEY:'draft',
    localStorage:{setItem:(key,value)=>writes.push({key,value:JSON.parse(value)})},
    stateObj:()=>{serializations++;return state;},
    setTimeout:fn=>{const id=++nextTimer;timers.set(id,fn);return id;},
    clearTimeout:id=>timers.delete(id)
  });
  vm.runInContext(html.slice(start,end),context);
  for (let i=1;i<=20;i++) {state={value:i};vm.runInContext('saveLocalState()',context);}
  assert.equal(timers.size,1);assert.equal(serializations,0);
  const scheduled=[...timers.values()][0];timers.clear();scheduled();
  assert.equal(serializations,1);assert.equal(writes[0].value.state.value,20);assert.equal(writes[0].value.pending,true);
  state={value:21};vm.runInContext('saveLocalState(); flushLocalState()',context);
  assert.equal(timers.size,0);assert.equal(writes[1].value.state.value,21);
  vm.runInContext("saveLocalState(); D.me={user:'different'}; flushLocalState()",context);
  assert.equal(writes.length,2,'a delayed save never persists another account under the old account name');
});
