import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { D1 } from './d1.mjs';

const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
const mod = await import('data:text/javascript;base64,' + Buffer.from(source + '\nexport { API, SCHEMA, kvSet, kvGet, revision, stmt, batch, guardedApi, sha256hex, ensureSchema };').toString('base64'));
async function setup() {
  const DB = new D1(); await DB.install(mod.SCHEMA);
  const C = { env: { DB }, base: 'https://example.test' };
  await DB.prepare('INSERT INTO users(username,salt,hash,role,name,perms) VALUES(?,?,?,?,?,?)').bind('admin', 'salt', await mod.sha256hex('salt|password'), 'admin', 'Tester', '{}').run();
  await DB.prepare('INSERT INTO sessions(token,username,exp) VALUES(?,?,?)').bind('token', 'admin', Date.now() + 86400000).run();
  await mod.kvSet(C, 'LOG_PRUNE_BUCKET', String(Math.floor(Date.now() / 600000)));
  DB.calls = 0;
  return C;
}
const row = (g, code = 'p1', br = 'A', qty = 10) => [g, code, 'สินค้า ทดสอบ', br, qty, 2, 1, '', '', 90, 'DS', 5, 10, '', '2026-10-17', '-', 5, 100, 20, 10];
const save = (C, groups, branch = 'A', revision) => mod.API.stockSave(C, 'token', { branch, groups, revision });

test('20,000 Thai barcode rows import, backup, export and restore below D1 value limits', async () => {
  const C = await setup(), name = 'สินค้า'.repeat(30);
  const grid = [['ชื่อสินค้า', 'เลขบาร์เดี่ยว', 'หมวด'], ...Array.from({ length: 20000 }, (_, i) => [name + i, '885' + i, 'ทดสอบ'])];
  const result = await mod.API.importBarcodeData(C, 'token', [{ name: 'ทดสอบ', grid }], 'replace');
  assert.equal(result.count, 20000);
  const importCalls = C.env.DB.calls;
  const before = C.env.DB.db.prepare('SELECT COUNT(*) AS n FROM barcode_items').get().n;
  const second = await mod.API.importBarcodeData(C, 'token', [{ name: 'ทดสอบ', grid: [grid[0], ['ใหม่', '999', 'ใหม่']] }], 'replace');
  assert.equal(before, 20000);
  assert.equal(second.count, 1);
  const backup = second.backups[0];
  const csv = await mod.API.barcodeBackupData(C, 'token', backup.id);
  assert.ok(Buffer.byteLength(csv.csv) > 2000000);
  await mod.API.barcodeRestore(C, 'token', backup.id);
  assert.equal(C.env.DB.db.prepare('SELECT COUNT(*) AS n FROM barcode_items').get().n, 20000);
  assert.ok(C.env.DB.maxValue < 2000000);
  assert.ok(importCalls <= 50, `warm import took ${importCalls} queries`);
  console.log(JSON.stringify({ barcodeRows: 20000, warmImportQueries: importCalls, largestParameterBytes: C.env.DB.maxValue }));
});

test('30,000 stock rows, branch merge, no-change save and previous version', async () => {
  const C = await setup();
  const rows = Array.from({ length: 30000 }, (_, i) => row('G01', 'P' + i));
  let result = await save(C, [{ g: 'G01', rows }]);
  const queries = C.env.DB.calls;
  assert.deepEqual(result.changed, ['G01']);
  result = await save(C, [{ g: 'G01', rows }], 'A', result.revision);
  assert.deepEqual(result.same, ['G01']);
  result = await save(C, [{ g: 'G01', rows: [row('G01', 'other', 'B', 7)] }], 'B', result.revision);
  let state = await mod.API.stockGet(C, 'token');
  assert.equal(state.rows.length, 30001);
  assert.equal(state.groups.G01.cur.sum.pcs, 300007);
  await mod.API.stockRestore(C, 'token', 'G01');
  state = await mod.API.stockGet(C, 'token');
  assert.equal(state.rows.length, 30000);
  assert.ok(queries <= 50, `stock save took ${queries} queries`);
  console.log(JSON.stringify({ stockRows: 30000, warmSaveQueries: queries }));
});

test('concurrent stock adjustments preserve both quantities after rolled-back conflict retry', async () => {
  const C = await setup(); await save(C, [{ g: 'G01', rows: [row('G01')] }]);
  await Promise.all([
    mod.API.stockLostAdd(C, 'token', [{ code: 'p1', qty: 2 }], '', 'A'),
    mod.API.stockLostAdd(C, 'token', [{ code: 'p1', qty: 3 }], '', 'A')
  ]);
  const state = await mod.API.stockGet(C, 'token');
  assert.equal(state.lost[0].qty, 5);
  assert.equal(state.rows[0][4], 5);
  assert.equal(state.groups.G01.cur.sum.pcs, 5);
});

test('failed stock batch rolls back rows, metadata and revision', async () => {
  const C = await setup(); await save(C, [{ g: 'G01', rows: [row('G01')] }]);
  const before = await mod.API.stockGet(C, 'token');
  C.env.DB.fail = q => q.params[0] === 'STOCK_HISTORY' && q.sql.startsWith('INSERT INTO kv');
  await assert.rejects(save(C, [{ g: 'G01', rows: [row('G01', 'new')] }]), /injected/);
  C.env.DB.fail = null;
  const after = await mod.API.stockGet(C, 'token');
  assert.deepEqual(after.rows, before.rows);
  assert.deepEqual(after.groups, before.groups);
  assert.equal(after.revision, before.revision);
});

test('large UTF-8 KV round trip, shrink and rollback never expose partial values', async () => {
  const C = await setup(), value = JSON.stringify({ note: 'ภาษาไทย 🛒'.repeat(120000) });
  await mod.kvSet(C, 'STOCK_HARD', value);
  assert.equal(await mod.kvGet(C, 'STOCK_HARD', null), value);
  C.env.DB.fail = q => q.sql.startsWith('INSERT INTO kv(');
  await assert.rejects(mod.kvSet(C, 'STOCK_HARD', 'small'), /injected/);
  C.env.DB.fail = null;
  assert.equal(await mod.kvGet(C, 'STOCK_HARD', null), value);
  await mod.kvSet(C, 'STOCK_HARD', '{}');
  assert.equal(await mod.kvGet(C, 'STOCK_HARD', null), '{}');
  assert.equal(C.env.DB.db.prepare('SELECT COUNT(*) n FROM kv_chunks').get().n, 0);
});

test('stale stock payload cannot overwrite a newer upload or its previous version', async () => {
  const C = await setup(); const first = await save(C, [{ g: 'G01', rows: [row('G01')] }]);
  await save(C, [{ g: 'G01', rows: [row('G01', 'new')] }], 'A', first.revision);
  await assert.rejects(save(C, [{ g: 'G01', rows: [row('G01')] }], 'A', first.revision), /เปลี่ยนไปแล้ว/);
  const current = await mod.API.stockGet(C, 'token');
  assert.equal(current.rows[0][1], 'new');
});

test('competing barcode adds cannot lose position shifts or admit duplicate names', async () => {
  const C = await setup();
  const results = await Promise.all([
    mod.API.addItem(C, 'token', '', 'หมวด', { name: 'รายการ', unitBar: '885001' }),
    mod.API.addItem(C, 'token', '', 'หมวด', { name: 'รายการ', unitBar: '885001' })
  ]);
  assert.equal(results.filter(r => r.duplicate).length, 1);
  assert.equal(C.env.DB.db.prepare('SELECT COUNT(*) AS n FROM barcode_items').get().n, 1);
});

test('market large chunk state CAS rejects stale saves and preserves revisions', async () => {
  const C = await setup();
  const rows = Array.from({ length: 20000 }, (_, i) => ['G01', i, 'สินค้า'.repeat(50)]);
  const state = { groups: { G01: { cur: { rows } } }, revision: '' };
  const saved = await mod.API.marketSaveState(C, 'token', state);
  const queries = C.env.DB.calls;
  await assert.rejects(mod.API.marketSaveState(C, 'token', state), /ถูกแก้ไข/);
  const loaded = await mod.API.marketGet(C, 'token');
  assert.equal(loaded.groups.G01.cur.rows.length, 20000);
  assert.equal(loaded.revision, saved.revision);
  assert.ok(queries <= 50, `market save took ${queries} queries`);
  console.log(JSON.stringify({ marketRows: 20000, warmSaveQueries: queries }));
});

test('music duplicate requests insert at most one live row', async () => {
  const C = await setup();
  const result = await Promise.allSettled([
    mod.API.musicRequest(C, 'token', 'https://example.test/song.mp3'),
    mod.API.musicRequest(C, 'token', 'https://example.test/song.mp3')
  ]);
  assert.equal(result.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(C.env.DB.db.prepare('SELECT COUNT(*) AS n FROM music_queue').get().n, 1);
});

test('50 custom stock deduction tags load without 50 individual KV queries', async () => {
  const C = await setup(); await save(C, [{ g: 'G01', rows: [row('G01')] }]);
  const defs = {};
  for (let i = 0; i < 50; i++) defs['tag' + String(i).padStart(2, '0')] = { t: 'แท็ก ' + i, mode: 'deduct' };
  await mod.kvSet(C, 'STOCK_CTAGS', JSON.stringify(defs)); C.env.DB.calls = 0;
  const state = await mod.API.stockGet(C, 'token');
  assert.equal(Object.keys(state.ctags).length, 50);
  assert.ok(C.env.DB.calls <= 25, `read with 50 tags took ${C.env.DB.calls} queries`);
});

test('clearing 100 stock groups uses bulk reads/writes and preserves previous data', async () => {
  const C = await setup();
  for (let i = 0; i < 100; i++) await save(C, [{ g: 'G' + i, rows: [row('G' + i)] }]);
  C.env.DB.calls = 0;
  const result = await mod.API.stockClear(C, 'token', 'password', { mode: 'branch', branch: 'A' });
  const queries = C.env.DB.calls;
  assert.equal(result.changed.length, 100);
  const before = await mod.API.stockGet(C, 'token', 'prev');
  const current = await mod.API.stockGet(C, 'token');
  assert.equal(before.rows.length, 100); assert.equal(current.rows.length, 0);
  assert.ok(queries <= 50, `clearing 100 groups took ${queries} queries`);
  console.log(JSON.stringify({ clearedGroups: 100, queries }));
});

test('failed barcode publication leaves current rows unchanged', async () => {
  const C = await setup(); await mod.API.addItem(C, 'token', '', 'เดิม', { name: 'เดิม', unitBar: '12345' });
  C.env.DB.fail = q => q.sql.startsWith('INSERT INTO barcode_items') && q.sql.includes('barcode_stage');
  await assert.rejects(mod.API.importBarcodeData(C, 'token', [{ name: 'ใหม่', grid: [['ชื่อสินค้า', 'เลขบาร์เดี่ยว'], ['ใหม่', '99999']] }], 'replace'), /injected/);
  C.env.DB.fail = null;
  const rows = C.env.DB.db.prepare('SELECT name FROM barcode_items').all();
  assert.deepEqual(rows.map(r => r.name), ['เดิม']);
});

test('old barcode edit form cannot overwrite a completed same-name edit', async () => {
  const C = await setup(); await mod.API.addItem(C, 'token', '', 'หมวด', { name: 'สินค้า', unitBar: '12345' });
  const first = (await mod.API.getCategoryData(C, 'token', '', 'หมวด')).rows[0];
  await mod.API.editItem(C, 'token', '', first.r, 'สินค้า', { perPack: '10' }, false, first.revision);
  await assert.rejects(mod.API.editItem(C, 'token', '', first.r, 'สินค้า', { perPack: '20' }, false, first.revision), /เปลี่ยนไปแล้ว/);
  await assert.rejects(mod.API.deleteItem(C, 'token', '', first.r, 'สินค้า', first.revision), /เปลี่ยนไปแล้ว/);
});

test('market publication failure rolls back all chunks and marker', async () => {
  const C = await setup();
  const saved = await mod.API.marketSaveState(C, 'token', { groups: { G01: { cur: { rows: [['G01', '1', 'เดิม']] } } }, revision: '' });
  C.env.DB.fail = q => q.sql.startsWith('UPDATE kv SET v=') && q.params[1] === 'MARKET_STATE';
  await assert.rejects(mod.API.marketSaveState(C, 'token', { groups: {}, revision: saved.revision }), /injected/);
  C.env.DB.fail = null;
  assert.equal((await mod.API.marketGet(C, 'token')).groups.G01.cur.rows[0][2], 'เดิม');
});

test('missing stock chunks fail closed rather than publishing an empty dataset', async () => {
  const C = await setup(); await save(C, [{ g: 'G01', rows: [row('G01')] }]);
  C.env.DB.db.prepare('DELETE FROM stock_grp').run();
  await assert.rejects(mod.API.stockGet(C, 'token'), /ไม่ครบ/);
  await assert.rejects(save(C, [{ g: 'G01', rows: [row('G01', 'new')] }]), /ไม่ครบ/);
});

test('last-admin triggers survive concurrent demotions and allow renaming', async () => {
  const C = await setup();
  const renamed = await mod.API.saveUser(C, 'token', { original: 'admin', username: 'renamed', role: 'admin', name: 'A' });
  assert.equal(renamed.relogin, true);
  assert.equal(C.env.DB.db.prepare("SELECT COUNT(*) n FROM users WHERE role='admin'").get().n, 1);
  await assert.rejects(C.env.DB.prepare("UPDATE users SET role='viewer' WHERE username='renamed'").run(), /Admin/);
  await assert.rejects(C.env.DB.prepare("DELETE FROM users WHERE username='renamed'").run(), /Admin/);
});

test('first POST installs schema without running a write, subsequent POST is normal', async () => {
  const DB = new D1(), env = { DB };
  const request = () => new Request('https://example.test', { method: 'POST', body: JSON.stringify({ fn: 'login', args: ['0000', '0000'] }) });
  let response = await mod.default.fetch(request(), env, {});
  assert.equal((await response.json()).code, 'SCHEMA_INITIALIZED');
  assert.equal(DB.db.prepare('SELECT COUNT(*) n FROM users').get().n, 0);
  response = await mod.default.fetch(request(), env, {});
  assert.equal((await response.json()).ok, true);
});

test('oversized declared requests are rejected before a business operation', async () => {
  const C = await setup(); await mod.ensureSchema(C.env.DB);
  const request = new Request('https://example.test', { method: 'POST', headers: { 'Content-Length': String(33 * 1024 * 1024) }, body: '{}' });
  const result = await (await mod.default.fetch(request, C.env, {})).json();
  assert.equal(result.ok, false); assert.match(result.error, /32 MB/);
});

test('view-only users cannot mutate stock or market', async () => {
  const C = await setup();
  C.env.DB.db.prepare("UPDATE users SET perms=? WHERE username='admin'").run('{}');
  C.env.DB.db.prepare("INSERT INTO users(username,role,name,perms) VALUES('viewer','viewer','Viewer',?)").run(JSON.stringify({ stock: true, stock_edit: false, market: true, market_edit: false }));
  C.env.DB.db.prepare("INSERT INTO sessions(token,username,exp) VALUES('viewer-token','viewer',?)").run(Date.now() + 86400000);
  await assert.rejects(mod.API.stockLostAdd(C, 'viewer-token', [{ code: 'x', qty: 1 }]), /ดูข้อมูลอย่างเดียว/);
  await assert.rejects(mod.API.marketSaveState(C, 'viewer-token', { groups: {}, revision: '' }), /ดูข้อมูลอย่างเดียว/);
});

test('simultaneous sound saves cannot create duplicate type/code records', async () => {
  const C = await setup();
  const p = { type: 'ตั้งค่า', code: 'daytime', value: '30', label: 'ช่วงเวลา' };
  const results = await Promise.allSettled([mod.API.saveSound(C, 'token', p), mod.API.saveSound(C, 'token', p)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(C.env.DB.db.prepare('SELECT COUNT(*) n FROM sounds').get().n, 1);
});

test('failed banner publication removes the staged file', async () => {
  const C = await setup();
  C.env.DB.fail = q => q.sql.startsWith('INSERT INTO banners');
  await assert.rejects(mod.API.addBanner(C, 'token', { mime: 'image/png', data: 'aGVsbG8=', name: 'test.png' }), /injected/);
  C.env.DB.fail = null;
  assert.equal(C.env.DB.db.prepare('SELECT COUNT(*) n FROM files').get().n, 0);
});

test('legacy JSON barcode backups remain restorable', async () => {
  const C = await setup();
  await C.env.DB.prepare('INSERT INTO backups(kind,ts,name,hash,data) VALUES(?,?,?,?,?)').bind('barcode', 1, 'เก่า', 'legacy', JSON.stringify({ rows: [['คู่ค้า', 'หมวด', 'สินค้าเก่า', '12345', '67890', '12']], cats: ['ว่าง'] })).run();
  await mod.API.barcodeRestore(C, 'token', 1);
  const state = await mod.API.getCategoryData(C, 'token', '', '*');
  assert.equal(state.rows[0].v[3], 'สินค้าเก่า');
});

test('legacy stock_data migrates without losing rows', async () => {
  const C = await setup();
  C.env.DB.db.prepare('INSERT INTO stock_data(n,data) VALUES(0,?)').run(JSON.stringify([row('G01')]));
  const result = await mod.API.stockGet(C, 'token');
  assert.equal(result.rows.length, 1);
  assert.equal(C.env.DB.db.prepare('SELECT COUNT(*) n FROM stock_data').get().n, 0);
});

test('migration and schema fallback preserve an old barcode table lacking perPack', async () => {
  const DB = new D1();
  DB.db.exec("CREATE TABLE barcode_items (id INTEGER PRIMARY KEY AUTOINCREMENT,pos INTEGER,sheet TEXT,partner TEXT,cat TEXT,name TEXT,packBar TEXT,unitBar TEXT,ts INTEGER,who TEXT); INSERT INTO barcode_items(name) VALUES('preserve');");
  const sql = await readFile(new URL('../migrations/0001_stability.sql', import.meta.url), 'utf8');
  DB.db.exec(sql);
  await mod.ensureSchema(DB);
  assert.equal(DB.db.prepare('SELECT name,perPack FROM barcode_items').get().name, 'preserve');
});

test('reserved branch names are rejected without modifying object prototypes', async () => {
  const C = await setup();
  await assert.rejects(save(C, [{ g: 'G01', rows: [row('G01', 'x', '__proto__')] }], '__proto__'), /สงวน/);
  assert.equal(Object.prototype.count, undefined);
});

test('simultaneous failed logins accumulate every failed attempt', async () => {
  const C = await setup();
  await Promise.allSettled(Array.from({ length: 10 }, () => mod.API.login(C, 'admin', 'wrong')));
  const count = C.env.DB.db.prepare("SELECT n FROM fails WHERE k='fail:admin'").get().n;
  assert.equal(count, 10);
});

test('a burst of music requests never exceeds 60 live records', async () => {
  const C = await setup();
  const requests = await Promise.allSettled(Array.from({ length: 65 }, (_, i) => mod.API.musicRequest(C, 'token', 'https://example.test/song' + i + '.mp3')));
  assert.equal(requests.filter(r => r.status === 'fulfilled').length, 60);
  assert.equal(C.env.DB.db.prepare('SELECT COUNT(*) n FROM music_queue').get().n, 60);
});
