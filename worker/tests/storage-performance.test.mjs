import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { API, SCHEMA } from '../index.js';
import { D1 } from './d1.mjs';

async function setup() {
  const DB = new D1(); await DB.install(SCHEMA);
  DB.db.prepare('INSERT INTO users(username,role,name,perms) VALUES(?,?,?,?)').run('admin','admin','ผู้ทดสอบ','{}');
  DB.db.prepare('INSERT INTO sessions(token,username,exp) VALUES(?,?,?)').run('token','admin',Date.now()+86400000);
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
