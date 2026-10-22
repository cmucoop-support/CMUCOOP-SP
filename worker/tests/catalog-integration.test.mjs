import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { SCHEMA, SCHEMA_VERSION, stmt, batch } from '../index.js';
import { D1 } from './d1.mjs';

async function setup() {
  const DB = new D1(); await DB.install(SCHEMA);
  DB.db.prepare('INSERT INTO kv(k,v) VALUES(?,?)').run('SCHEMA_VERSION', SCHEMA_VERSION);
  DB.db.prepare("INSERT INTO users(username,role,name,perms) VALUES('admin','admin','Admin','{}')").run();
  DB.db.prepare("INSERT INTO sessions(token,username,exp) VALUES('token','admin',?)").run(Date.now() + 86400000);
  return { env: { DB }, base: 'https://example.test' };
}
async function rpc(C, fn, ...args) {
  const request = new Request(C.base + '/api', { method: 'POST', body: JSON.stringify({ fn, args: ['token', ...args] }) });
  return (await worker.fetch(request, C.env, {})).json();
}
const state = C => C.env.DB.db.prepare('SELECT * FROM product_catalog_state WHERE id=1').get();
const stockRow = code => ['AA', code, 'สินค้า ' + code, 'สาขาหลัก', 10, 1, 1, '', '', 5, 'T1', 99, 120, '', '2026-10-18'];

test('RPC source save synchronizes catalog before responding and repeated clean reads do not collect sources', async () => {
  const C = await setup();
  const saved = await rpc(C, 'stockSave', { branch: 'สาขาหลัก', groups: [{ g: 'AA', rows: [stockRow('001')] }] });
  assert.equal(saved.ok, true); assert.equal(state(C).source_revision, state(C).synced_revision);
  const statements = [];
  C.env.DB.hook = async ops => statements.push(...ops.map(q => q.sql));
  const result = await rpc(C, 'productCatalogList', { search: '001' });
  assert.equal(result.data.rows[0].code, '001');
  assert.equal(statements.some(sql => /FROM (?:stock_grp|market_data|barcode_items|expiry_lots)\b/.test(sql)), false);
});

test('projection failure preserves source save success, signals pending, and repairs on the next catalog read', async () => {
  const C = await setup(), DB = C.env.DB;
  DB.fail = q => q.sql.startsWith('INSERT INTO product_catalog(');
  const previousError = console.error; console.error = () => {};
  let saved;
  try { saved = await rpc(C, 'addItem', '', 'AA', { name: 'สินค้าใหม่', cat: 'AA', unitBar: '000123' }); }
  finally { console.error = previousError; }
  assert.equal(saved.ok, true); assert.equal(saved.data.ok, true); assert.equal(saved.catalogSync.status, 'pending');
  assert.equal(DB.db.prepare('SELECT COUNT(*) n FROM barcode_items').get().n, 1);
  assert.notEqual(state(C).source_revision, state(C).synced_revision);
  DB.fail = null;
  const index = await rpc(C, 'productCatalogList', { search: '000123' });
  assert.equal(index.ok, true); assert.equal(index.data.total, 1);
  assert.equal(state(C).source_revision, state(C).synced_revision);
  assert.equal(DB.db.prepare('SELECT COUNT(*) n FROM barcode_items').get().n, 1);
});

test('bulk source writes increment the durable marker once and transaction failures restore the trigger flag', async () => {
  const C = await setup(), DB = C.env.DB, before = state(C).source_revision;
  const values = Array.from({ length: 2000 }, (_, i) => ['สินค้า ' + i, String(i)]);
  await batch(C, [stmt(C, "INSERT INTO barcode_items(pos,cat,name,unitBar) SELECT 1,'AA',json_extract(value,'$[0]'),json_extract(value,'$[1]') FROM json_each(?)", JSON.stringify(values))]);
  assert.equal(state(C).source_revision, before + 1); assert.equal(state(C).batching, 0);
  const current = state(C);
  DB.fail = q => q.sql.startsWith('INSERT INTO barcode_items');
  await assert.rejects(batch(C, [stmt(C, "INSERT INTO barcode_items(name) VALUES('failed')")]), /injected/);
  assert.deepEqual(state(C), current);
  DB.fail = null;
  DB.db.prepare("UPDATE barcode_items SET name='external' WHERE unitBar='0'").run();
  assert.equal(state(C).source_revision, current.source_revision + 1, 'external edits still invalidate after rollback');
});

test('missing an entire stock group fails closed and retains the last published catalog', async () => {
  const C = await setup(), DB = C.env.DB;
  await rpc(C, 'stockSave', { branch: 'สาขาหลัก', groups: [{ g: 'AA', rows: [stockRow('001')] }] });
  const previous = DB.db.prepare('SELECT * FROM product_catalog').all();
  DB.db.prepare("DELETE FROM stock_grp WHERE g='AA' AND ver=0").run();
  const result = await rpc(C, 'productCatalogList', {});
  assert.equal(result.ok, false); assert.match(result.error, /ข้อมูลสต็อกไม่ครบ/);
  assert.deepEqual(DB.db.prepare('SELECT * FROM product_catalog').all(), previous);
});
