import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { D1 } from './d1.mjs';
const { API, SCHEMA } = await import('../index.js');
const row = (code = 'P8850000000001', name = 'นม  กล่อง A', branch = 'สาขาหลัก', qty = 10) => ['AA',code,name,branch,qty,1,1,'2026-10-01','2026-10-01',10,'T1',99,120,'','2026-10-18'];
async function setup(rows = [row(), row('002','ช็อกโกแลต','สาขาเหนือ',0), row('003','ขนม %_ทดสอบ','สาขาลบ',-2)]) {
  const DB = new D1(); await DB.install(SCHEMA);
  DB.db.prepare('INSERT INTO users(username,role,name,perms) VALUES(?,?,?,?)').run('admin','admin','ผู้ทดสอบ','{}');
  DB.db.prepare('INSERT INTO sessions(token,username,exp) VALUES(?,?,?)').run('token','admin',Date.now()+86400000);
  DB.db.prepare('INSERT INTO kv(k,v) VALUES(?,?)').run('LOG_PRUNE_BUCKET',String(Math.floor(Date.now()/600000)));
  const C = {env:{DB}};
  for (const branch of new Set(rows.map(r=>r[3]))) await API.stockSave(C,'token',{branch,groups:[{g:'AA',rows:rows.filter(r=>r[3]===branch)}]});
  return C;
}
const put = (C,k,v) => C.env.DB.db.prepare('INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k,JSON.stringify(v));
const draft = extra => ({requestId:crypto.randomUUID().replace(/-/g,''),barcode:'P8850000000001',name:'นม กล่อง A',branch:'สาขาหลัก',expires:'2027-01-01',quantity:null,stockSource:true,...extra});

test('catalog derives names/codes from current stock and configured branches, including zero stock', async () => {
  const C=await setup();
  await API.stockSetNames(C,'token',{__BR_CFG__:JSON.stringify({branches:['สาขาใหม่','สาขาลบ'],delBranches:{สาขาลบ:1}})});
  C.env.DB.db.prepare("INSERT INTO barcode_items(pos,cat,name,packBar,unitBar) VALUES(1,'wrong','ชื่อจากระบบอื่น','','8850000000001')").run();
  const catalog=await API.expiryCatalog(C,'token');
  assert.deepEqual(catalog.branches,['สาขาเหนือ','สาขาใหม่','สาขาหลัก'].sort());
  assert.equal(catalog.total,2);
  const result=await API.expiryLookup(C,'token','8850000000001');
  assert.equal(result.rows[0].name,'นม กล่อง A');assert.equal(result.rows[0].code,'P8850000000001');
  assert.deepEqual(Object.keys(result.rows[0]).sort(),['branch','category','code','name']);
  assert.equal((await API.expiryLookup(C,'token','ช็อก')).rows.length,1);
  assert.equal((await API.expiryLookup(C,'token','003')).rows.length,0);
});
test('stock name/code/branch lookups limit results and keep wildcard searches literal', async () => {
  const C=await setup(Array.from({length:70},(_,i)=>row(String(i).padStart(4,'0'),i===69?'ขนม %_ทดสอบ':'ขนม '+i,i%2?'สาขาเหนือ':'สาขาหลัก')));
  assert.equal((await API.expiryLookup(C,'token','ขนม')).rows.length,30);
  assert.equal((await API.expiryLookup(C,'token','ขนม')).more,true);
  assert.ok((await API.expiryLookup(C,'token','ขนม','สาขาเหนือ')).rows.every(r=>r.branch==='สาขาเหนือ'));
  assert.equal((await API.expiryLookup(C,'token','%_')).rows.length,1);
  assert.equal((await API.expiryLookup(C,'token',"' OR 1=1--")).rows.length,0);
  assert.equal((await API.expiryLookup(C,'token','ข')).rows.length,0);
});
test('expiry-only viewers can search source names/codes without stock cost permission', async () => {
  const C=await setup();
  C.env.DB.db.prepare('INSERT INTO users(username,role,name,perms) VALUES(?,?,?,?)').run('viewer','viewer','อ่าน',JSON.stringify({expiry:true}));
  C.env.DB.db.prepare('INSERT INTO sessions(token,username,exp) VALUES(?,?,?)').run('viewer','viewer',Date.now()+86400000);
  assert.equal((await API.expiryLookup(C,'viewer','8850000000001')).rows.length,1);
  await assert.rejects(API.stockGet(C,'viewer'),/ไม่มีสิทธิ์/);
  await assert.rejects(API.expiryCatalog(C,''),/SESSION_EXPIRED/);
});
test('new stock-backed forms validate canonical names and branches; old lots/retries survive stock replacement', async () => {
  const C=await setup(),p=draft();
  await assert.rejects(API.expiryCreate(C,'token',draft({branch:'ไม่มีสาขา'})),/เลือกสาขา/);
  await assert.rejects(API.expiryCreate(C,'token',draft({name:'ชื่อปลอม'})),/ไม่พบสินค้า/);
  const saved=await API.expiryCreate(C,'token',p);
  await API.stockSave(C,'token',{branch:'สาขาหลัก',groups:[{g:'AA',rows:[row('NEW','ชื่อใหม่')]}]});
  assert.equal((await API.expiryLookup(C,'token','8850000000001')).rows.length,0);
  assert.equal((await API.expiryCreate(C,'token',p)).lot.id,saved.lot.id);
  const updated=await API.expiryUpdate(C,'token',saved.lot.id,saved.lot.version,{...p,quantity:2});
  assert.equal(updated.lot.name,'นม กล่อง A');assert.equal(updated.lot.quantity,2);
  assert.equal((await API.expirySummary(C,'token')).counts.total,1);
  await assert.rejects(API.expiryCreate(C,'token',draft()),/เลือกสาขา|ไม่พบสินค้า/);
});
test('catalog refreshes after actual stock saves and branch configuration edits, never changing stock itself', async () => {
  const C=await setup();const before=C.env.DB.db.prepare('SELECT * FROM stock_grp ORDER BY g,ver,n').all();
  await Promise.all([API.expiryCatalog(C,'token'),API.expiryLookup(C,'token','นม')]);
  const rebuilds=C.env.DB.db.prepare("SELECT revision FROM write_revisions WHERE scope='expiry_catalog'").get().revision;
  await API.expiryLookup(C,'token','นม');await API.expiryCatalog(C,'token');
  assert.equal(C.env.DB.db.prepare("SELECT revision FROM write_revisions WHERE scope='expiry_catalog'").get().revision,rebuilds);
  assert.deepEqual(C.env.DB.db.prepare('SELECT * FROM stock_grp ORDER BY g,ver,n').all(),before);
  await API.stockSetNames(C,'token',{__BR_CFG__:JSON.stringify({branches:['สาขาเพิ่ม']})});
  assert.ok((await API.expiryCatalog(C,'token')).branches.includes('สาขาเพิ่ม'));
});
test('stock revision changing during a catalog rebuild cannot publish mixed or stale data', async () => {
  const C=await setup();let changed=false;
  C.env.DB.hook=async ops=>{
    if(changed||!ops.some(q=>q.sql.startsWith('UPDATE write_revisions SET revision=CASE WHEN COALESCE')&&q.sql.includes("scope='expiry_catalog'")))return;
    changed=true;C.env.DB.db.prepare("UPDATE stock_grp SET data=? WHERE g='AA' AND ver=0 AND n=0").run(JSON.stringify([row('LATEST','รายการล่าสุด')]));
    C.env.DB.db.prepare("UPDATE write_revisions SET revision=revision+1 WHERE scope='stock'").run();
  };
  const result=await API.expiryLookup(C,'token','LATEST');
  assert.equal(changed,true,'the source changes immediately before catalog publication');
  assert.equal(result.rows[0].name,'รายการล่าสุด');
  assert.equal(C.env.DB.db.prepare('SELECT COUNT(*) n FROM expiry_products').get().n,1);
});
test('failed catalog publication rolls back and can be retried without affecting previous lots', async () => {
  const C=await setup();await API.expiryCatalog(C,'token');const old=C.env.DB.db.prepare('SELECT * FROM expiry_products').all();
  const oldMetadata=C.env.DB.db.prepare("SELECT v FROM kv WHERE k='EXPIRY_STOCK_CATALOG'").get().v;
  const oldRevision=C.env.DB.db.prepare("SELECT revision FROM write_revisions WHERE scope='expiry_catalog'").get().revision;
  await API.stockSetNames(C,'token',{__BR_CFG__:JSON.stringify({branches:['สาขาเพิ่ม']})});
  C.env.DB.fail=q=>q.sql.startsWith('INSERT INTO kv(k,v)')&&q.params[0]==='EXPIRY_STOCK_CATALOG';
  await assert.rejects(API.expiryCatalog(C,'token'),/injected/);
  assert.deepEqual(C.env.DB.db.prepare('SELECT * FROM expiry_products').all(),old);
  assert.equal(C.env.DB.db.prepare("SELECT v FROM kv WHERE k='EXPIRY_STOCK_CATALOG'").get().v,oldMetadata);
  assert.equal(C.env.DB.db.prepare("SELECT revision FROM write_revisions WHERE scope='expiry_catalog'").get().revision,oldRevision);
  C.env.DB.fail=null;assert.ok((await API.expiryCatalog(C,'token')).branches.includes('สาขาเพิ่ม'));
});
test('legacy source data is readable without migrating or writing to stock tables', async () => {
  const C=await setup();C.env.DB.db.exec("DELETE FROM stock_grp; DELETE FROM kv WHERE k='STOCK_GROUPS';");
  C.env.DB.db.prepare('INSERT INTO stock_data(n,data) VALUES(0,?)').run(JSON.stringify([row()]));
  assert.equal((await API.expiryLookup(C,'token','8850000000001')).rows.length,1);
  assert.equal(C.env.DB.db.prepare('SELECT COUNT(*) n FROM stock_grp').get().n,0);
  assert.equal(C.env.DB.db.prepare('SELECT COUNT(*) n FROM stock_data').get().n,1);
});
test('30,000 current stock records build once in bounded chunks and lookup never returns the entire source', async () => {
  const C=await setup(Array.from({length:30000},(_,i)=>row(String(i).padStart(8,'0'),'สินค้า '+i,i%2?'สาขาเหนือ':'สาขาหลัก')));
  C.env.DB.calls=0;const catalog=await API.expiryCatalog(C,'token');const buildCalls=C.env.DB.calls;
  assert.equal(catalog.total,30000);assert.ok(buildCalls<40);C.env.DB.calls=0;
  const result=await API.expiryLookup(C,'token','00029999','สาขาเหนือ');
  assert.equal(result.rows.length,1);assert.equal(result.rows[0].name,'สินค้า 29999');assert.ok(C.env.DB.calls<12);
  console.log(JSON.stringify({catalogRows:catalog.total,buildQueries:buildCalls,warmLookupQueries:C.env.DB.calls,largestParameterBytes:C.env.DB.maxValue}));
});
