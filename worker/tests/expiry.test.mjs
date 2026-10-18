import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { D1 } from './d1.mjs';
const { API, SCHEMA, expiryBounds, expiryBucket, sha256hex, SCHEMA_VERSION } = await import('../index.js');
async function setup() {
  const DB = new D1(); await DB.install(SCHEMA);
  DB.db.prepare('INSERT INTO users(username,role,name,perms) VALUES(?,?,?,?)').run('admin', 'admin', 'ผู้ทดสอบ', '{}');
  DB.db.prepare('INSERT INTO sessions(token,username,exp) VALUES(?,?,?)').run('token', 'admin', Date.now() + 86400000);
  DB.db.prepare('INSERT INTO kv(k,v) VALUES(?,?)').run('LOG_PRUNE_BUCKET', String(Math.floor(Date.now() / 600000)));
  return { env: { DB } };
}
const payload = (overrides = {}) => ({ requestId: crypto.randomUUID().replace(/-/g, ''), barcode: '885000000001', name: 'นมกล่อง A', branch: 'สาขาหลัก', location: 'ชั้น A1', expires: '2026-12-20', quantity: null, unit: '', note: '', ...overrides });

test('identical products/dates create distinct lots and retain every earlier alert', async () => {
  const C = await setup();
  const one = await API.expiryCreate(C, 'token', payload());
  const two = await API.expiryCreate(C, 'token', payload());
  assert.notEqual(one.lot.id, two.lot.id);
  assert.equal((await API.expiryList(C, 'token')).total, 2);
  assert.equal((await API.expirySummary(C, 'token')).counts.total, 2);
  assert.equal((await API.expiryHistory(C, 'token', one.lot.id)).lot.status, 'active');
});
test('optional quantity preserves null, zero, decimals and units without affecting lot counts', async () => {
  const C = await setup();
  for (const quantity of [null, '', 0, 2.5]) await API.expiryCreate(C, 'token', payload({ quantity, unit: 'กล่อง' }));
  const result = await API.expiryList(C, 'token');
  assert.deepEqual(result.rows.map(r => r.quantity), [null, null, 0, 2.5]);
  assert.equal(result.counts.total, 4);
  assert.equal(C.env.DB.db.prepare('SELECT COUNT(*) n FROM stock_grp').get().n, 0);
  assert.equal(C.env.DB.db.prepare('SELECT COUNT(*) n FROM stock_data').get().n, 0);
});
test('retrying the same create request is idempotent, including concurrent submissions', async () => {
  const C = await setup(), p = payload();
  const results = await Promise.all([API.expiryCreate(C, 'token', p), API.expiryCreate(C, 'token', p)]);
  assert.equal(results[0].lot.id, results[1].lot.id);
  assert.equal(results.filter(r => r.replayed).length, 1);
  assert.equal(C.env.DB.db.prepare('SELECT COUNT(*) n FROM expiry_events').get().n, 1);
  await assert.rejects(API.expiryCreate(C, 'token', { ...p, quantity: 9 }), /ข้อมูลอื่น/);
  assert.equal((await API.expiryList(C, 'token')).total, 1);
});
test('month-end and leap-year boundaries use clamped calendar months in Thai time', () => {
  const b = expiryBounds(Date.parse('2028-01-31T04:00:00Z'));
  assert.equal(b.today, '2028-01-31'); assert.equal(b.month, '2028-02-29'); assert.equal(b.m3, '2028-04-30');
  assert.equal(expiryBucket('2028-02-29', b), 'month'); assert.equal(expiryBucket('2028-03-01', b), 'm3');
  assert.equal(expiryBucket(b.m3, b), 'm3'); assert.equal(expiryBucket(b.m6, b), 'm6'); assert.equal(expiryBucket(b.m12, b), 'm12');
  assert.equal(expiryBounds(Date.parse('2026-10-16T17:01:00Z')).today, '2026-10-17');
});
test('all alert ranges are mutually exclusive and counts/filters agree', async () => {
  const C = await setup(), b = expiryBounds();
  const before = new Date(Date.parse(b.today) - 86400000).toISOString().slice(0, 10);
  const later = new Date(Date.parse(b.m12) + 86400000).toISOString().slice(0, 10);
  const dates = [before, b.today, b.week, b.month, b.m3, b.m6, b.m12, later];
  for (const expires of dates) await API.expiryCreate(C, 'token', payload({ expires }));
  const summary = await API.expirySummary(C, 'token');
  assert.equal(summary.counts.total, 8);
  let total = 0;
  for (const bucket of ['expired','week','month','m3','m6','m12','later']) {
    const list = await API.expiryList(C, 'token', { bucket });
    assert.equal(list.total, summary.counts[bucket]); total += list.total;
  }
  assert.equal(total, 8);
});
test('acknowledgement retains an alert, closing affects only that lot, reopen retains history', async () => {
  const C = await setup();
  const a = (await API.expiryCreate(C, 'token', payload())).lot;
  await API.expiryCreate(C, 'token', payload());
  const acknowledged = (await API.expirySetStatus(C, 'token', a.id, a.version, 'acknowledged')).lot;
  assert.equal((await API.expirySummary(C, 'token')).counts.total, 2);
  const closed = (await API.expirySetStatus(C, 'token', a.id, acknowledged.version, 'closed')).lot;
  assert.equal((await API.expirySummary(C, 'token')).counts.total, 1);
  assert.equal((await API.expiryList(C, 'token', { state: 'closed' })).total, 1);
  await API.expirySetStatus(C, 'token', a.id, closed.version, 'active');
  assert.equal((await API.expiryHistory(C, 'token', a.id)).events.length, 4);
  assert.equal((await API.expirySummary(C, 'token')).counts.total, 2);
});
test('concurrent edits fence the row and retain exactly one update in history', async () => {
  const C = await setup(), original = payload();
  const r = (await API.expiryCreate(C, 'token', original)).lot;
  const edits = await Promise.allSettled([API.expiryUpdate(C, 'token', r.id, r.version, { ...original, quantity: 2 }), API.expiryUpdate(C, 'token', r.id, r.version, { ...original, quantity: 3 })]);
  assert.equal(edits.filter(e => e.status === 'fulfilled').length, 1);
  const history = await API.expiryHistory(C, 'token', r.id);
  assert.equal(history.events.length, 2); assert.equal(history.lot.version, 2);
  assert.ok([2, 3].includes(history.lot.quantity));
});
test('history failure rolls back the new lot and all edits', async () => {
  const C = await setup();
  C.env.DB.fail = q => q.sql.startsWith('INSERT INTO expiry_events');
  await assert.rejects(API.expiryCreate(C, 'token', payload()), /injected/);
  assert.equal((await API.expiryList(C, 'token')).total, 0);
  C.env.DB.fail = null;
  const p = payload(), r = (await API.expiryCreate(C, 'token', p)).lot;
  C.env.DB.fail = q => q.sql.startsWith('INSERT INTO expiry_events');
  await assert.rejects(API.expiryUpdate(C, 'token', r.id, r.version, { ...p, quantity: 9 }), /injected/);
  C.env.DB.fail = null;
  const h = await API.expiryHistory(C, 'token', r.id);
  assert.equal(h.lot.quantity, null); assert.equal(h.lot.version, 1); assert.equal(h.events.length, 1);
});
test('view-only and unpermitted users cannot change lots', async () => {
  const C = await setup();
  for (const [u, perms] of [['reader', { expiry: true, expiry_edit: false }], ['none', {}]]) {
    C.env.DB.db.prepare('INSERT INTO users(username,role,name,perms) VALUES(?,?,?,?)').run(u, 'viewer', u, JSON.stringify(perms));
    C.env.DB.db.prepare('INSERT INTO sessions(token,username,exp) VALUES(?,?,?)').run(u, u, Date.now() + 86400000);
  }
  assert.equal((await API.expiryList(C, 'reader')).me.edit, false);
  await assert.rejects(API.expiryCreate(C, 'reader', payload()), /ดูข้อมูลได้อย่างเดียว/);
  await assert.rejects(API.expiryList(C, 'none'), /ไม่มีสิทธิ์/);
  await assert.rejects(API.expiryLookup(C, '', '885'), /SESSION_EXPIRED/);
});
test('invalid dates/quantities are rejected; past dates and missing barcodes are allowed', async () => {
  const C = await setup();
  for (const expires of ['2026-02-30', '2569-10-17', 'bad']) await assert.rejects(API.expiryCreate(C, 'token', payload({ expires })), /วันหมดอายุ/);
  for (const quantity of [-1, 0.00001, 'bad', true, {}, []]) await assert.rejects(API.expiryCreate(C, 'token', payload({ quantity })), /จำนวนต้อง/);
  assert.equal((await API.expiryCreate(C, 'token', payload({ expires: '2020-01-01', barcode: '' }))).lot.bucket, 'expired');
});
test('10,000 lots are paginated on the server and escaped searches remain literal', async () => {
  const C = await setup(), ts = Date.now();
  C.env.DB.db.exec('BEGIN');
  const insert = C.env.DB.db.prepare("INSERT INTO expiry_lots(request_id,create_hash,barcode,name,branch,location,expires,quantity,unit,note,created_ts,created_user,created_by,updated_ts,updated_by) VALUES(?,'hash',?,?,?,'','2027-01-01',NULL,'','',?,'admin','ผู้ทดสอบ',?,'ผู้ทดสอบ')");
  for (let i = 0; i < 10000; i++) insert.run('test-' + i, '885-' + i, i === 9999 ? 'สินค้า %_ท้าย' : 'สินค้า ' + i, i % 2 ? 'A' : 'B', ts, ts);
  C.env.DB.db.exec('COMMIT'); C.env.DB.calls = 0;
  const list = await API.expiryList(C, 'token', { page: 2, branch: 'A' });
  assert.equal(list.total, 5000); assert.equal(list.rows.length, 50); assert.equal(list.rows[0].id, 102);
  assert.ok(C.env.DB.calls <= 6);
  assert.equal((await API.expiryList(C, 'token', { q: '%_' })).total, 1);
  assert.equal((await API.expiryList(C, 'token', { q: "' OR 1=1--" })).total, 0);
});
test('expiry migrations preserve the existing stable database and initialize the new version', async () => {
  const DB = new D1();
  DB.db.exec(await readFile(new URL('../migrations/0001_stability.sql', import.meta.url), 'utf8'));
  DB.db.prepare("INSERT INTO barcode_cats(cat) VALUES('preserve')").run();
  const migration = await readFile(new URL('../migrations/0002_expiry.sql', import.meta.url), 'utf8');
  DB.db.exec(migration);
  DB.db.exec(await readFile(new URL('../migrations/0003_expiry_stock.sql', import.meta.url), 'utf8'));
  DB.db.exec(await readFile(new URL('../migrations/0004_product_catalog.sql', import.meta.url), 'utf8'));
  assert.equal(DB.db.prepare('SELECT cat FROM barcode_cats').get().cat, 'preserve');
  assert.equal(DB.db.prepare("SELECT v FROM kv WHERE k='SCHEMA_VERSION'").get().v, SCHEMA_VERSION);
  assert.equal(DB.db.prepare('SELECT COUNT(*) n FROM expiry_lots').get().n, 0);
});
