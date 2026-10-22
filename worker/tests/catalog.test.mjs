import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { D1 } from './d1.mjs';
import * as worker from '../index.js';
import { PRODUCT_SCHEMA, installProductCatalog, isCatalogSourceStatement } from '../src/modules/catalog.js';

const row = (code = '0001', name = 'นม กล่อง', branch = 'สาขาหลัก', qty = 10) => ['AA', code, name, branch, qty, 1, 1, '', '', 10, 'T1', 987654.321, 123456.789, '', '2026-10-18'];
async function setup() {
  const DB = new D1(); await DB.install([...worker.SCHEMA, ...PRODUCT_SCHEMA]);
  const C = { env: { DB }, base: 'https://example.test' }, API = {};
  let time = 1000;
  const catalog = installProductCatalog({ ...worker, API, now: () => ++time });
  for (const [username, role, perms] of [['admin', 'admin', {}], ['reader', 'viewer', { product_catalog: true }], ['other', 'viewer', { barcode: true }]]) {
    DB.db.prepare('INSERT INTO users(username,role,name,perms) VALUES(?,?,?,?)').run(username, role, username, JSON.stringify(perms));
    DB.db.prepare('INSERT INTO sessions(token,username,exp) VALUES(?,?,?)').run(username, username, Date.now() + 86400000);
  }
  put(C, 'LOG_PRUNE_BUCKET', String(Math.floor(Date.now() / 600000)));
  return { C, API, catalog, DB };
}
function put(C, key, value) {
  C.env.DB.db.prepare('INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(key, typeof value === 'string' ? value : JSON.stringify(value));
}
function stock(C, rows) {
  C.env.DB.db.exec('DELETE FROM stock_grp');
  C.env.DB.db.prepare('INSERT INTO stock_grp(g,ver,n,data) VALUES(?,0,0,?)').run('AA', JSON.stringify(rows));
  put(C, 'STOCK_GROUPS', { AA: { cur: {} } });
}
function barcode(C, code = '0001', name = 'นม กล่อง', pack = '') {
  return Number(C.env.DB.db.prepare('INSERT INTO barcode_items(pos,cat,name,unitBar,packBar,perPack) VALUES(1,?,?,?,?,?)').run('เครื่องดื่ม', name, code, pack, '12').lastInsertRowid);
}
function market(C, code = '0001', name = 'นม กล่อง', branch = 'สาขาหลัก') {
  put(C, 'MARKET_STATE', { branches: { [branch]: { groups: { AA: { cur: { rows: [['AA', code, name, 10, '', '', 987654.321, 123456.789, '', '', '', '', '', '2026-10-18']] } } } } } });
}
function lot(C, code = '0001', name = 'นม กล่อง', branch = 'สาขาหลัก') {
  return Number(C.env.DB.db.prepare(`INSERT INTO expiry_lots(request_id,create_hash,barcode,name,branch,location,expires,quantity,unit,note,created_ts,created_user,created_by,updated_ts,updated_by)
    VALUES(?,?,?,?,?,'ชั้น 1','2027-01-01',2,'ชิ้น','',1,'admin','admin',1,'admin')`).run(crypto.randomUUID(), 'hash', code, name, branch).lastInsertRowid);
}
const state = DB => DB.db.prepare('SELECT * FROM product_catalog_state WHERE id=1').get();
const stored = DB => DB.db.prepare('SELECT * FROM product_catalog ORDER BY product_key').all();
const storedRecords = DB => DB.db.prepare('SELECT * FROM product_catalog_records ORDER BY product_key,source_key').all();

test('directory compares exact string codes per branch and enriches from global barcode records', async () => {
  const { C, API } = await setup();
  stock(C, [row('00 01'), row('P0001', 'รหัส P เป็นสินค้าอีกตัว'), row('002', 'ไม่มีคงเหลือ', 'สาขาเหนือ', 0)]);
  barcode(C, '0001', 'นม ชื่อจากบาร์', '9001'); market(C); lot(C);
  const summary = await API.productCatalogSummary(C, 'admin');
  assert.equal(summary.total, 5);
  assert.equal(summary.branches.find(branch => branch.branchCode === '__global__').total, 2);
  const result = await API.productCatalogList(C, 'admin', { branchCode: 'b:สาขาหลัก', search: '00 01' });
  const merged = result.rows.find(item => item.code === '00 01');
  assert.equal(merged.name, 'นม กล่อง');
  assert.deepEqual(merged.sources, ['barcode', 'stock', 'market', 'expiry']);
  assert.equal(merged.sourceCount, 4);
  assert.equal(merged.conflicts[0].field, 'name');
  assert.ok(result.rows.some(item => item.code === 'P0001'));
  const details = await API.productCatalogDetail(C, 'admin', { productKey: merged.productKey });
  assert.equal(details.records.length, 4);
  assert.equal(details.records.find(record => record.system === 'barcode').unitBarcode, '0001');
  assert.equal((await API.productCatalogList(C, 'admin', { branchCode: 'b:สาขาเหนือ' })).rows[0].code, '002');
});

test('same names never join different or missing codes; unknown and global branches remain explicit', async () => {
  const { C, API } = await setup();
  stock(C, [row('001', 'ชื่อเดียวกัน', ''), row('002', 'ชื่อเดียวกัน', ''), row('', 'ชื่อเดียวกัน', ''), row('', 'ชื่อเดียวกัน', '')]);
  barcode(C, '003', 'ชื่อเดียวกัน');
  put(C, 'MARKET_STATE', { groups: { AA: { cur: { rows: [['AA', '', 'ชื่อเดียวกัน', 5]] } } } });
  const results = await API.productCatalogList(C, 'admin');
  assert.equal(results.total, 6);
  assert.equal(results.rows.filter(item => item.branchCode === '__unknown__').length, 5);
  assert.equal(results.rows.filter(item => item.code === '').length, 3);
  assert.ok(results.rows.filter(item => item.code === '').every(item => item.conflicts.some(conflict => conflict.field === 'code')));
});

test('catalog-only permission never exposes stock or market financial columns', async () => {
  const { C, API, DB } = await setup(); stock(C, [row()]); market(C); barcode(C); lot(C);
  const product = (await API.productCatalogList(C, 'reader')).rows.find(item => item.branchCode === 'b:สาขาหลัก');
  const detail = await API.productCatalogDetail(C, 'reader', { productKey: product.productKey });
  const serialized = JSON.stringify({ product, detail, rows: stored(DB), records: storedRecords(DB) });
  assert.doesNotMatch(serialized, /987654\.321|123456\.789|"cost"|"profit"|"price"|"margin"/);
  await assert.rejects(worker.API.stockGet(C, 'reader'), /ไม่มีสิทธิ์/);
  await assert.rejects(API.productCatalogSummary(C, 'other'), /ไม่มีสิทธิ์/);
  await assert.rejects(API.productCatalogSummary(C, ''), /SESSION_EXPIRED/);
});

test('server search is literal and normalized, filters and keyset pagination do not duplicate records', async () => {
  const { C, API } = await setup();
  stock(C, [row('00 01', 'นม %_ทดสอบ'), ...Array.from({ length: 8 }, (_, i) => row(String(i + 2).padStart(4, '0'), 'สินค้า ' + i))]);
  barcode(C, '0001', 'ชื่ออื่น');
  assert.equal((await API.productCatalogList(C, 'admin', { search: '%_' })).total, 1);
  assert.equal((await API.productCatalogList(C, 'admin', { search: "' OR 1=1--" })).total, 0);
  assert.equal((await API.productCatalogList(C, 'admin', { search: '00 01', source: 'stock' })).total, 1);
  assert.equal((await API.productCatalogList(C, 'admin', { conflictsOnly: true, branchCode: 'b:สาขาหลัก' })).total, 1);
  const keys = []; let cursor;
  do {
    const page = await API.productCatalogList(C, 'admin', { limit: 3, cursor });
    assert.ok(page.rows.length <= 3); keys.push(...page.rows.map(item => item.productKey)); cursor = page.nextCursor;
  } while (cursor);
  assert.equal(keys.length, 10); assert.equal(new Set(keys).size, 10);
  await assert.rejects(API.productCatalogList(C, 'admin', { source: 'invalid' }), /ต้นทาง/);
});

test('source detail pagination preserves all lots and aliases without large list responses', async () => {
  const { C, API } = await setup(); stock(C, [row()]);
  for (let i = 0; i < 125; i++) lot(C, '0001', i === 124 ? 'ชื่อเฉพาะท้ายรายการ' : 'นม กล่อง');
  const product = (await API.productCatalogList(C, 'admin', { search: 'ชื่อเฉพาะท้ายรายการ' })).rows[0];
  assert.equal(product.sourceCount, 126);
  const records = []; let cursor;
  do {
    const detail = await API.productCatalogDetail(C, 'admin', { productKey: product.productKey, limit: 40, cursor });
    assert.equal(detail.recordsTotal, 126); assert.ok(detail.records.length <= 40);
    records.push(...detail.records); cursor = detail.nextCursor;
  } while (cursor);
  assert.equal(records.length, 126); assert.equal(new Set(records.map(record => record.sourceKey)).size, 126);
});

test('clean reads skip source collection; dirty saves compare rows and only publish changed products', async () => {
  const { C, API, DB } = await setup(); stock(C, [row(), row('0002', 'ขนม')]);
  await API.productCatalogSummary(C, 'admin');
  const original = stored(DB), originalRecords = storedRecords(DB), statements = [];
  DB.hook = async operations => { statements.push(...operations.map(operation => operation.sql)); };
  DB.calls = 0; await API.productCatalogSummary(C, 'admin');
  assert.ok(DB.calls < 12); assert.ok(!statements.some(sql => /FROM (stock_grp|barcode_items|market_data|expiry_lots)/.test(sql)));
  statements.length = 0;
  put(C, 'STOCK_NAMES', { AA: 'หมวดใหม่' });
  await API.productCatalogSummary(C, 'admin');
  assert.deepEqual(stored(DB), original); assert.deepEqual(storedRecords(DB), originalRecords);
  assert.ok(!statements.some(sql => /^INSERT INTO product_catalog(?:\(|_records\()/.test(sql)));
  stock(C, [row('0001', 'นม กล่อง', 'สาขาหลัก', 7), row('0002', 'ขนม')]);
  await API.productCatalogSummary(C, 'admin');
  const after = stored(DB);
  assert.notEqual(after.find(item => item.code_key === '0001').updated_ts, original.find(item => item.code_key === '0001').updated_ts);
  assert.deepEqual(after.find(item => item.code_key === '0002'), original.find(item => item.code_key === '0002'));
});

test('durable triggers cover direct source edits, legacy data, configuration chunks and current versions only', async () => {
  const { C, API, DB } = await setup();
  DB.db.prepare('INSERT INTO stock_data(n,data) VALUES(0,?)').run(JSON.stringify([row('LEGACY')]));
  assert.equal((await API.productCatalogList(C, 'admin')).rows[0].code, 'LEGACY');
  assert.equal(DB.db.prepare('SELECT COUNT(*) AS n FROM stock_grp').get().n, 0);
  put(C, 'STOCK_GROUPS', {});
  assert.equal((await API.productCatalogList(C, 'admin')).total, 0);
  const revision = state(DB).source_revision;
  DB.db.prepare('INSERT INTO stock_grp(g,ver,n,data) VALUES(?,1,0,?)').run('AA', JSON.stringify([row('OLD')]));
  assert.equal(state(DB).source_revision, revision);
  DB.db.prepare('INSERT INTO kv_chunks(k,n,data) VALUES(?,0,?)').run('STOCK_NAMES', '{}');
  assert.ok(state(DB).source_revision > revision);
  barcode(C, 'NEW'); assert.equal((await API.productCatalogList(C, 'admin', { search: 'NEW' })).total, 1);
  DB.db.exec('DELETE FROM barcode_items'); assert.equal((await API.productCatalogList(C, 'admin')).total, 0);
  put(C, 'STOCK_NAMES', { __BR_CFG__: JSON.stringify({ branches: ['สาขาว่าง'] }) });
  assert.equal((await API.productCatalogSummary(C, 'admin')).branches.find(branch => branch.name === 'สาขาว่าง').total, 0);
});

test('publication rejects source revisions changed during collection and retries the latest snapshot', async () => {
  const { C, API, DB } = await setup(); stock(C, [row('OLD')]); let changed = false;
  DB.hook = async operations => {
    if (changed || !operations.some(operation => operation.sql.startsWith('UPDATE product_catalog_state SET synced_revision=CASE'))) return;
    changed = true;
    DB.db.prepare("UPDATE stock_grp SET data=? WHERE g='AA' AND ver=0").run(JSON.stringify([row('LATEST', 'รายการล่าสุด')]));
  };
  const result = await API.productCatalogList(C, 'admin');
  assert.equal(result.total, 1); assert.equal(result.rows[0].code, 'LATEST');
  assert.equal(state(DB).source_revision, state(DB).synced_revision);
});

test('read snapshot repairs a source write that commits immediately after synchronization', async () => {
  const { C, API, DB } = await setup(); stock(C, [row('OLD')]); await API.productCatalogSummary(C, 'admin');
  let changed = false;
  DB.hook = async operations => {
    if (changed || !operations.some(operation => operation.sql.startsWith('SELECT COUNT(*) AS total FROM product_catalog'))) return;
    changed = true;
    DB.db.prepare("UPDATE stock_grp SET data=? WHERE g='AA' AND ver=0").run(JSON.stringify([row('NEW')]));
  };
  const result = await API.productCatalogList(C, 'admin');
  assert.equal(result.rows[0].code, 'NEW');
});

test('concurrent reads share one build and recheck dirty revisions after a pending build', async () => {
  const { C, API, DB } = await setup(); stock(C, [row()]); let builds = 0;
  DB.hook = async operations => {
    if (operations.some(operation => operation.sql.startsWith('UPDATE product_catalog_state SET synced_revision=CASE'))) builds++;
  };
  const [summary, list, summary2] = await Promise.all([API.productCatalogSummary(C, 'admin'), API.productCatalogList(C, 'admin'), API.productCatalogSummary(C, 'reader')]);
  assert.equal(builds, 1); assert.equal(summary.total, list.total); assert.equal(summary2.revision, list.revision);
});

test('failed projection publication rolls back without damaging source saves or previous index', async () => {
  const { C, API, DB } = await setup(); stock(C, [row('OLD')]); await API.productCatalogSummary(C, 'admin');
  const previous = stored(DB), previousRecords = storedRecords(DB);
  stock(C, [row('NEW')]);
  DB.fail = statement => statement.sql.startsWith('INSERT INTO product_catalog_records(');
  await assert.rejects(API.productCatalogSummary(C, 'admin'), /injected storage failure/);
  assert.deepEqual(stored(DB), previous); assert.deepEqual(storedRecords(DB), previousRecords);
  assert.notEqual(state(DB).source_revision, state(DB).synced_revision);
  assert.match(DB.db.prepare('SELECT data FROM stock_grp WHERE ver=0').get().data, /NEW/);
  DB.fail = null;
  assert.equal((await API.productCatalogList(C, 'admin')).rows[0].code, 'NEW');
});

test('bulk transaction invalidation detection covers source tables and exact KV prefixes', () => {
  for (const sql of ['INSERT INTO barcode_items(name) VALUES(?)', 'DELETE FROM stock_data', 'UPDATE stock_grp SET ver=0', 'INSERT OR REPLACE INTO market_data(n,data) SELECT 1,?', 'UPDATE expiry_lots SET name=?']) assert.equal(isCatalogSourceStatement({ sql, p: [] }), true);
  assert.equal(isCatalogSourceStatement({ sql: 'SELECT * FROM stock_grp', p: [] }), false);
  assert.equal(isCatalogSourceStatement({ sql: 'UPDATE kv SET v=? WHERE k=?', p: ['{}', 'STOCK_NAMES'] }), true);
  assert.equal(isCatalogSourceStatement({ sql: 'DELETE FROM kv_chunks WHERE k=?', p: ['MARKET_STATE'] }), true);
  assert.equal(isCatalogSourceStatement({ sql: 'UPDATE kv SET v=? WHERE k=?', p: ['{}', 'STOCKXNOT_A_SOURCE'] }), false);
});

test('migration contains the same durable schema as runtime initialization', async () => {
  const migration = await readFile(new URL('../migrations/0004_product_catalog.sql', import.meta.url), 'utf8');
  for (const sql of PRODUCT_SCHEMA) assert.ok(migration.includes(sql + ';'));
});

test('30,000 products build in bounded chunks, then page without reading source tables', async () => {
  const { C, API, DB } = await setup();
  const rows = Array.from({ length: 30000 }, (_, i) => row(String(i).padStart(8, '0'), 'สินค้า ' + i, i % 2 ? 'สาขาเหนือ' : 'สาขาหลัก'));
  const json = JSON.stringify(rows);
  for (let index = 0, chunk = 0; index < json.length; index += 80000, chunk++) DB.db.prepare('INSERT INTO stock_grp(g,ver,n,data) VALUES(?,0,?,?)').run('AA', chunk, json.slice(index, index + 80000));
  put(C, 'STOCK_GROUPS', { AA: { cur: {} } });
  DB.calls = 0; const summary = await API.productCatalogSummary(C, 'admin'), buildCalls = DB.calls;
  assert.equal(summary.total, 30000); assert.ok(buildCalls < 100, `build used ${buildCalls} queries`);
  const statements = []; DB.hook = async operations => statements.push(...operations.map(operation => operation.sql)); DB.calls = 0;
  const page = await API.productCatalogList(C, 'reader', { branchCode: 'b:สาขาเหนือ', search: '00029999', limit: 20 });
  assert.equal(page.total, 1); assert.equal(page.rows[0].code, '00029999'); assert.ok(DB.calls < 12);
  assert.ok(!statements.some(sql => /FROM (stock_grp|barcode_items|market_data|expiry_lots)/.test(sql)));
  assert.ok(DB.maxValue < 2000000);
  console.log(JSON.stringify({ productRows: summary.total, buildQueries: buildCalls, warmPageQueries: DB.calls, largestParameterBytes: DB.maxValue }));
});
