import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { D1 } from './d1.mjs';
const {API,SCHEMA,ensureSchema,SCHEMA_VERSION}=await import('../index.js');
async function setup() {
  const DB=new D1(); await DB.install(SCHEMA);
  for (const [u,role,perms] of [['admin','admin',{}],['other','admin',{}],['reader','viewer',{expiry:true}]]) {
    DB.db.prepare('INSERT INTO users(username,role,name,perms) VALUES(?,?,?,?)').run(u,role,u,JSON.stringify(perms));
    DB.db.prepare('INSERT INTO sessions(token,username,exp) VALUES(?,?,?)').run(u,u,Date.now()+86400000);
  }
  return {env:{DB}};
}
const payload = extra=>({requestId:crypto.randomUUID().replace(/-/g,''),name:'นม',barcode:'8850001',branch:'A',expires:'2027-12-31',...extra});
test('next items share their lot, concurrent numbers are unique and retry retains the same item number',async()=>{
  const C=await setup(), first=(await API.expiryCreate(C,'admin',payload())).lot;
  assert.equal(first.itemNo,1); assert.match(first.lot,/-1$/);
  const p=payload({groupId:first.groupId}), [a,b]=await Promise.all([API.expiryCreate(C,'admin',p),API.expiryCreate(C,'admin',payload({groupId:first.groupId}))]);
  assert.deepEqual([a.lot.itemNo,b.lot.itemNo].sort(),[2,3]); assert.equal(a.lot.groupLot,first.groupLot);
  assert.equal((await API.expiryCreate(C,'admin',p)).lot.id,a.lot.id);
  assert.equal((await API.expiryList(C,'admin',{q:a.lot.lot})).total,1);
  await assert.rejects(API.expiryCreate(C,'other',payload({groupId:first.groupId})),/ไม่พบล็อตเดิม/);
  await assert.rejects(API.expiryCreate(C,'admin',payload({groupId:12345})),/ไม่พบล็อตเดิม/);
  await assert.rejects(API.expiryCreate(C,'admin',{...p,groupId:0}),/ข้อมูลอื่น/);
});
test('delete removes only that item from all lists/counts, retains receipt and never reuses its sequence',async()=>{
  const C=await setup(), p=payload(), first=(await API.expiryCreate(C,'admin',p)).lot;
  const second=(await API.expiryCreate(C,'admin',payload({groupId:first.groupId}))).lot;
  await assert.rejects(API.expiryDelete(C,'reader',first.id,first.version),/ดูข้อมูลได้อย่างเดียว/);
  await assert.rejects(API.expiryDelete(C,'admin',first.id,999),/ถูกแก้ไข/);
  await API.expiryDelete(C,'admin',first.id,first.version);
  assert.equal((await API.expiryList(C,'admin',{state:'all'})).total,1);
  assert.equal((await API.expirySummary(C,'admin')).counts.total,1);
  assert.equal((await API.expiryList(C,'admin',{state:'all'})).rows[0].id,second.id);
  const replay=await API.expiryCreate(C,'admin',p); assert.equal(replay.lot.deleted,true); assert.equal(replay.replayed,true);
  assert.equal((await API.expiryDelete(C,'admin',first.id,first.version)).replayed,true);
  await assert.rejects(API.expiryUpdate(C,'admin',first.id,first.version,p),/ไม่พบ/);
  const third=(await API.expiryCreate(C,'admin',payload({groupId:first.groupId}))).lot;
  assert.equal(third.itemNo,3); assert.equal(third.groupId,first.groupId);
  assert.equal(C.env.DB.db.prepare("SELECT count(*) n FROM expiry_events WHERE lot_id=? AND action='ลบรายการ'").get(first.id).n,1);
});
test('delete rolls back completely if its history cannot be saved',async()=>{
  const C=await setup(), first=(await API.expiryCreate(C,'admin',payload())).lot;
  C.env.DB.fail=q=>q.sql.startsWith('INSERT INTO expiry_events');
  await assert.rejects(API.expiryDelete(C,'admin',first.id,first.version),/injected/);
  C.env.DB.fail=null;
  assert.equal((await API.expiryList(C,'admin')).total,1); assert.equal((await API.expiryHistory(C,'admin',first.id)).lot.version,1);
});
test('delete racing edit permits only one write and preserves the winner',async()=>{
  const C=await setup(), p=payload(), r=(await API.expiryCreate(C,'admin',p)).lot;
  const results=await Promise.allSettled([API.expiryDelete(C,'admin',r.id,r.version),API.expiryUpdate(C,'admin',r.id,r.version,{...p,note:'changed'})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
});
test('automatic schema upgrade preserves pre-existing lots without rewriting their rows',async()=>{
  const C=await setup(), p=payload(), r=(await API.expiryCreate(C,'admin',p)).lot;
  const old=C.env.DB.db.prepare('SELECT * FROM expiry_lots').all();
  C.env.DB.db.exec("DROP VIEW expiry_records; DROP TABLE expiry_item_links; INSERT OR REPLACE INTO kv(k,v) VALUES('SCHEMA_VERSION','assets-1')");
  await ensureSchema(C.env.DB);
  assert.deepEqual(C.env.DB.db.prepare('SELECT * FROM expiry_lots').all(),old);
  assert.equal((await API.expiryList(C,'admin')).rows[0].id,r.id);
  assert.equal(C.env.DB.db.prepare("SELECT v FROM kv WHERE k='SCHEMA_VERSION'").get().v,SCHEMA_VERSION);
});
const context={window:{}};vm.runInNewContext(await readFile(new URL('../../assets/js/shared/expiry-date-reader.js',import.meta.url),'utf8'),context);
const parse=text=>Array.from(context.window.CMUExpiryDate.parse(text),r=>r.value);
test('OCR date parsing supports numeric, English month, Buddhist year, compact dates and leap dates',()=>{
  for (const text of ['EXP 31/12/2026','EXP 31.12.26','EXP 31 DEC 26','EXP 31/12/2569','EXP 31122026','EXP 2026-12-31','EXP\n31/12/26','EXP 31/12/69']) assert.deepEqual(parse(text),['2026-12-31'],text);
  assert.deepEqual(parse('EXP 29/02/2028'),['2028-02-29']);
  for(const text of ['EXP 31/02/2026','EXP 29/02/2027','MFG 10/01/2026','LOT 8851234567890']) assert.deepEqual(parse(text),[],text);
  assert.deepEqual(parse('MFG 01/01/2026\nEXP 31/12/2026'),['2026-12-31']);
  assert.deepEqual(parse('MFG 01/01/2026 EXP 31/12/2026'),['2026-12-31']);
  assert.deepEqual(parse('01/01/2026\n31/12/2026'),['2026-01-01','2026-12-31']);
});
