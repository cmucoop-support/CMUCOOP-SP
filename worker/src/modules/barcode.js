import { all, batch, jsonBatches, kvGet, kvSet, now, one, run, sha256hex, stmt, str, uuid } from '../core/database.js';
import { appendLog } from '../core/logging.js';
import { API } from '../core/registry.js';
import { auth, authPerm } from './auth.js';

const BC_SHEET = 'บาร์สินค้า', BACKUP_KEEP = 2, BC_DEFCAT = 'ไม่ระบุหมวด';

const BC_COMPANY = 'ร้านสหกรณ์ มหาวิทยาลัยเชียงใหม่ จำกัด', BC_TITLE = 'รายการบาร์เดี่ยว/บาร์แพ็ค';

const BC_SCHEMA = {
  cols: [
    { k: 'no', label: 'ลำดับ', w: 5, num: true, calc: true },
    { k: 'partner', label: 'รหัสคู่ค้า', w: 9 },
    { k: 'cat', label: 'หมวด', w: 10 },
    { k: 'name', label: 'ชื่อรายการ', w: 24 },
    { k: 'perPack', label: 'จำนวนต่อแพ็ค', w: 8 },
    { k: 'packBar', label: 'เลขบาร์แพ็ค', w: 13, text: true },
    { k: 'qtyPack', label: 'จำนวนในระบบ แพ็ค', w: 8, num: true, edit: true },
    { k: 'unitBar', label: 'เลขบาร์เดี่ยว', w: 13, text: true },
    { k: 'qtyUnit', label: 'จำนวนในระบบ เดี่ยว', w: 8, num: true, edit: true },
    { k: 'spread', label: 'กระจาย', w: 7, edit: true },
    { k: 'old', label: 'ของเดิม', w: 7, edit: true }
  ],
  groups: [{ label: 'รายละเอียด', from: 1, to: 9 }, { label: 'จำนวนอัพเดต', from: 10, to: 11 }],
  handLines: ['ชื่อ ......................', 'วันที่ ......................'],
  nameCol: 4
};

const BC_FIELDS = ['partner', 'cat', 'name', 'perPack', 'packBar', 'unitBar'];

const bcClean = (k, v) => { v = str(v); return (k === 'packBar' || k === 'unitBar') ? v.replace(/\s+/g, '') : v.replace(/\s+/g, ' '); };

function bcVals(o) { const v = {}; BC_FIELDS.forEach(k => { v[k] = bcClean(k, o[k]).slice(0, 200); }); return v; }

const bcRow = (r, no) => ({ r: r.id, revision: r.ts, v: [no, str(r.partner), str(r.cat), str(r.name), str(r.perPack), str(r.packBar), '', str(r.unitBar), '', '', ''] });

const thDateS = ts => { const d = new Date(ts + 7 * 3600e3); return String(d.getUTCDate()).padStart(2, '0') + '/' + String(d.getUTCMonth() + 1).padStart(2, '0') + '/' + (d.getUTCFullYear() + 543); };

const bcLog = (C, me, cat, action, detail) => appendLog(C, me.name, BC_SHEET, cat || '', action, detail);

async function bcDup(C, v, exceptId) {
  const same = await one(C, 'SELECT id FROM barcode_items WHERE cat=? AND name=? AND id<>?', v.cat, v.name, exceptId);
  if (same) return 'มีรายการชื่อ "' + v.name + '" ในหมวด ' + v.cat + ' อยู่แล้ว';
  for (const [k, label] of [['packBar', 'เลขบาร์แพ็ค'], ['unitBar', 'เลขบาร์เดี่ยว']]) {
    if (!v[k]) continue;
    const m = await one(C, 'SELECT name,cat FROM barcode_items WHERE id<>? AND (packBar=? OR unitBar=?)', exceptId, v[k], v[k]);
    if (m) return label + ' ' + v[k] + ' ซ้ำกับรายการ: ' + m.name + ' (หมวด ' + m.cat + ')';
  }
  return '';
}

const BC_FONTS = ['Bai Jamjuree', 'Mali', 'Sarabun', 'Prompt', 'Kanit', 'Niramit', 'Noto Sans Thai', 'Pridi', 'Taviraj', 'K2D', 'Athiti', 'Mitr', 'Krub', 'Maitree', 'TH Sarabun New', 'Tahoma'];

const BC_FONT_DEF = 'Bai Jamjuree';

API.setPrintFont = async (C, token, font) => {
  const me = await auth(C, token, true); font = str(font);
  if (!BC_FONTS.includes(font)) throw new Error('ไม่รองรับฟอนต์นี้');
  await kvSet(C, 'BC_PRINT_FONT', font);
  await appendLog(C, me.name, BC_SHEET, '', 'ตั้งฟอนต์ปริ้น', font);
  return { ok: true, font };
};

API.getInit = async (C, token) => {
  await authPerm(C, token, 'barcode');
  const pf = await kvGet(C, 'BC_PRINT_FONT', BC_FONT_DEF);
  const cats = await all(C, 'SELECT cat, COUNT(*) AS n, MAX(ts) AS ts, MIN(pos) AS p FROM barcode_items GROUP BY cat ORDER BY p');
  const parts = await all(C, 'SELECT cat, partner, COUNT(*) AS n FROM barcode_items GROUP BY cat, partner');
  const empties = await all(C, 'SELECT cat FROM barcode_cats ORDER BY cat');
  const map = Object.create(null), list = [];
  const add = (cat, n, ts) => { if (map[cat]) return; map[cat] = { key: BC_SHEET + '|' + cat, sheet: BC_SHEET, cat, label: cat, items: n, last: ts ? { ts } : null, partners: {} }; list.push(map[cat]); };
  cats.forEach(r => add(str(r.cat), r.n, r.ts));
  empties.forEach(r => add(str(r.cat), 0, 0));
  parts.forEach(r => { const c = map[str(r.cat)], p = str(r.partner); if (c && p) c.partners[p] = r.n; });
  const lg = await one(C, 'SELECT ts,who,cat,action,detail FROM log WHERE sheet=? ORDER BY id DESC LIMIT 1', BC_SHEET);
  const mx = await one(C, 'SELECT MAX(ts) AS m FROM barcode_items'), lastTs = Math.max(lg ? lg.ts : 0, mx && mx.m || 0);
  return {
    categories: list, printFont: BC_FONTS.includes(pf) ? pf : BC_FONT_DEF, printFonts: BC_FONTS,
    sheets: { [BC_SHEET]: { schema: 'bar', statusText: lastTs ? 'ข้อมูลอัพเดตล่าสุดวันที่ ' + thDateS(lastTs) : '' } },
    schemas: { bar: BC_SCHEMA },
    overall: lg ? { ts: lg.ts, user: str(lg.who), sheet: BC_SHEET, cat: str(lg.cat), action: str(lg.action), detail: str(lg.detail) } : (lastTs ? { ts: lastTs, user: '', sheet: BC_SHEET, cat: '', action: '', detail: '' } : null),
    now: now()
  };
};

API.getCategoryData = async (C, token, sheet, cat) => {
  await authPerm(C, token, 'barcode'); cat = str(cat);
  const rows = cat === '*' ? await all(C, 'SELECT * FROM barcode_items ORDER BY pos,id') : await all(C, 'SELECT * FROM barcode_items WHERE cat=? ORDER BY pos,id', cat);
  const ts = rows.reduce((m, r) => Math.max(m, r.ts || 0), 0);
  return { sheet: BC_SHEET, cat: cat === '*' ? '' : cat, last: ts ? { ts } : null,
    header: { company: BC_COMPANY, title: BC_TITLE, statusText: ts ? 'ข้อมูลอัพเดตล่าสุดวันที่ ' + thDateS(ts) : '' },
    rows: rows.map((r, i) => bcRow(r, i + 1)) };
};

API.findBarcode = async (C, token, code, exSheet, exRow) => {
  await authPerm(C, token, 'barcode'); code = bcClean('packBar', code);
  if (code.length < 5) return [];
  const rows = await all(C, 'SELECT id,name,cat,packBar,unitBar FROM barcode_items WHERE (packBar=? OR unitBar=?) AND id<>? LIMIT 5', code, code, Number(exRow) || 0);
  return rows.map(r => ({ field: str(r.packBar) === code ? 'เลขบาร์แพ็ค' : 'เลขบาร์เดี่ยว', name: str(r.name), sheet: BC_SHEET, cat: str(r.cat), row: r.id }));
};

API.createCategory = async (C, token, name) => {
  const me = await auth(C, token, true); name = bcClean('cat', name).slice(0, 100);
  if (!name) throw new Error('กรุณากรอกชื่อหมวด');
  if ((await one(C, 'SELECT 1 AS x FROM barcode_items WHERE cat=?', name)) || (await one(C, 'SELECT 1 AS x FROM barcode_cats WHERE cat=?', name))) throw new Error('มีหมวดนี้อยู่แล้ว');
  await run(C, 'INSERT INTO barcode_cats(cat) VALUES(?)', name);
  await bcLog(C, me, name, 'สร้างหมวด', name);
  return { ok: true, key: BC_SHEET + '|' + name };
};

API.addItem = async (C, token, sheet, catArg, item, force) => {
  const me = await auth(C, token, true), v = bcVals(item || {});
  v.cat = v.cat || bcClean('cat', catArg);
  if (!v.name) throw new Error('กรุณากรอกชื่อรายการ');
  if (!v.cat) throw new Error('กรุณาเลือกหมวด');
  if (!force) { const d = await bcDup(C, v, 0); if (d) return { duplicate: true, message: d }; }
  let a = v.partner ? await one(C, 'SELECT MAX(pos) AS p FROM barcode_items WHERE cat=? AND partner=?', v.cat, v.partner) : null;
  const shiftInCat = !!(a && a.p != null);
  if (!a || a.p == null) a = await one(C, 'SELECT MAX(pos) AS p FROM barcode_items WHERE cat=?', v.cat);
  if (!a || a.p == null) a = await one(C, 'SELECT MAX(pos) AS p FROM barcode_items');
  const at = ((a && a.p) || 0) + 1;
  const ops = [];
  if (shiftInCat) ops.push(stmt(C, 'UPDATE barcode_items SET pos=pos+1 WHERE cat=? AND pos>=?', v.cat, at));
  ops.push(
    stmt(C, 'INSERT INTO barcode_items(pos,sheet,partner,cat,name,packBar,unitBar,perPack,ts,who) VALUES(?,?,?,?,?,?,?,?,?,?)', at, BC_SHEET, v.partner, v.cat, v.name, v.packBar, v.unitBar, v.perPack, now(), me.name),
    stmt(C, 'DELETE FROM barcode_cats WHERE cat=?', v.cat)
  );
  const saved = await batch(C, ops);
  const r = saved[shiftInCat ? 1 : 0];
  await bcLog(C, me, v.cat, 'เพิ่มรายการ', v.name + (v.packBar ? ' · แพ็ค ' + v.packBar : '') + (v.unitBar ? ' · เดี่ยว ' + v.unitBar : ''));
  return { ok: true, cat: v.cat, row: r.meta.last_row_id };
};

API.editItem = async (C, token, sheet, row, oldName, vals, force, expectedRevision) => {
  const me = await auth(C, token, true); vals = vals || {};
  const cur = await one(C, 'SELECT * FROM barcode_items WHERE id=?', Number(row) || 0);
  if (!cur || str(cur.name) !== str(oldName) || (expectedRevision !== undefined && cur.ts !== expectedRevision)) throw new Error('ข้อมูลเปลี่ยนไปแล้ว กรุณาโหลดใหม่ก่อนแก้ไข');
  const src = {}; BC_FIELDS.forEach(k => { src[k] = vals[k] === undefined ? cur[k] : vals[k]; });
  const v = bcVals(src);
  if (!v.name) throw new Error('กรุณากรอกชื่อรายการ');
  if (!v.cat) throw new Error('กรุณากรอกหมวด');
  const changed = BC_FIELDS.filter(k => str(cur[k]) !== v[k]);
  if (!changed.length) return { ok: true, nochange: true, cat: str(cur.cat) };
  if (!force) { const d = await bcDup(C, v, cur.id); if (d) return { duplicate: true, message: d }; }
  await run(C, 'UPDATE barcode_items SET partner=?,cat=?,name=?,packBar=?,unitBar=?,perPack=?,ts=?,who=? WHERE id=?', v.partner, v.cat, v.name, v.packBar, v.unitBar, v.perPack, Math.max(now(), (cur.ts || 0) + 1), me.name, cur.id);
  await bcLog(C, me, v.cat, 'แก้ไขรายการ', str(oldName) + ' · ' + changed.map(k => k + ': ' + str(cur[k]) + ' → ' + v[k]).join(' | '));
  return { ok: true, cat: v.cat };
};

API.deleteItem = async (C, token, sheet, row, name, expectedRevision) => {
  const me = await auth(C, token, true);
  const cur = await one(C, 'SELECT * FROM barcode_items WHERE id=?', Number(row) || 0);
  if (!cur || str(cur.name) !== str(name) || (expectedRevision !== undefined && cur.ts !== expectedRevision)) throw new Error('ข้อมูลเปลี่ยนไปแล้ว กรุณาโหลดใหม่ก่อนลบ');
  await batch(C, [stmt(C, 'DELETE FROM barcode_items WHERE id=?', cur.id),
    stmt(C, 'INSERT OR IGNORE INTO barcode_cats(cat) SELECT ? WHERE NOT EXISTS (SELECT 1 FROM barcode_items WHERE cat=?)', cur.cat, cur.cat)]);
  await bcLog(C, me, str(cur.cat), 'ลบรายการ', str(cur.name) + (cur.packBar ? ' · แพ็ค ' + cur.packBar : '') + (cur.unitBar ? ' · เดี่ยว ' + cur.unitBar : ''));
  return { ok: true };
};

API.getLog = async (C, token, limit) => {
  await auth(C, token, true); limit = Math.min(Math.max(Number(limit) || 80, 1), 500);
  return (await all(C, 'SELECT ts,who,sheet,cat,action,detail FROM log WHERE sheet=? ORDER BY id DESC LIMIT ?', BC_SHEET, limit)).map(r => ({ ts: r.ts, who: str(r.who), sheet: str(r.sheet), cat: str(r.cat), action: str(r.action), detail: str(r.detail) }));
};

const bcBackups = async C => (await all(C, 'SELECT id,ts,name FROM backups WHERE kind=? ORDER BY id DESC', 'barcode')).map(b => ({ id: b.id, ts: b.ts, name: b.name }));

async function bcSnapshot(C, why) {
  const [rows, cats] = await Promise.all([
    all(C, 'SELECT partner,cat,name,packBar,unitBar,perPack FROM barcode_items ORDER BY pos,id'),
    all(C, 'SELECT cat FROM barcode_cats ORDER BY cat')
  ]);
  if (!rows.length && !cats.length) return bcBackups(C);
  const rowsJson = JSON.stringify(rows.map(r => [str(r.partner), str(r.cat), str(r.name), str(r.packBar), str(r.unitBar), str(r.perPack)]));
  const catsList = cats.map(r => str(r.cat));
  const hash = await sha256hex(rowsJson + '\n' + JSON.stringify(catsList));
  const latest = await one(C, 'SELECT hash FROM backups WHERE kind=? ORDER BY id DESC LIMIT 1', 'barcode');
  if (latest && latest.hash === hash) return bcBackups(C);
  const chunks = [];
  for (let i = 0; i < rowsJson.length; i += 240000) chunks.push([chunks.length, rowsJson.slice(i, i + 240000)]);
  const ops = [
    stmt(C, 'INSERT INTO backups(kind,ts,name,hash,data) VALUES(?,?,?,?,?)', 'barcode', now(), rows.length + ' รายการ · ' + why, hash, JSON.stringify({ __barcodeChunks: chunks.length, cats: catsList }))
  ];
  for (const payload of jsonBatches(chunks)) {
    ops.push(stmt(C, "INSERT INTO barcode_backup_items(backup_id,pos,name) SELECT (SELECT id FROM backups WHERE hash=? ORDER BY id DESC LIMIT 1),json_extract(value,'$[0]'),json_extract(value,'$[1]') FROM json_each(?)", hash, payload));
  }
  ops.push(
    stmt(C, 'DELETE FROM backups WHERE kind=? AND id NOT IN (SELECT id FROM backups WHERE kind=? ORDER BY id DESC LIMIT ?)', 'barcode', 'barcode', BACKUP_KEEP),
    stmt(C, 'DELETE FROM barcode_backup_items WHERE backup_id NOT IN (SELECT id FROM backups)'),
    stmt(C, 'DELETE FROM barcode_backup_cats WHERE backup_id NOT IN (SELECT id FROM backups)')
  );
  await batch(C, ops);
  return bcBackups(C);
}

async function bcBackupRead(C, id) {
  const result = await batch(C, [stmt(C, 'SELECT data FROM backups WHERE id=? AND kind=?', Number(id) || 0, 'barcode'),
    stmt(C, 'SELECT partner,cat,name,packBar,unitBar,perPack FROM barcode_backup_items WHERE backup_id=? ORDER BY pos', Number(id) || 0),
    stmt(C, 'SELECT cat FROM barcode_backup_cats WHERE backup_id=?', Number(id) || 0)]);
  const b = (result[0].results || [])[0];
  if (!b) throw new Error('ไม่พบสำเนานี้ (อาจถูกแทนที่ด้วยสำเนาใหม่แล้ว)');
  const data = JSON.parse(b.data);
  if (data && typeof data.__barcodeChunks === 'number') {
    const parts = result[1].results || [];
    if (parts.length !== data.chunks && parts.length !== data.__barcodeChunks) throw new Error('ข้อมูลสำเนาไม่ครบ กรุณาติดต่อผู้ดูแล');
    return { rows: JSON.parse(parts.map(r => r.name || '').join('') || '[]'), cats: Array.isArray(data.cats) ? data.cats : (result[2].results || []).map(r => r.cat) };
  }
  if (!data.__barcodeRows) return data;
  return { rows: (result[1].results || []).map(r => [r.partner, r.cat, r.name, r.packBar, r.unitBar, r.perPack]), cats: (result[2].results || []).map(r => r.cat) };
}

API.barcodeBackupList = async (C, token) => { await auth(C, token, true); return { backups: await bcBackups(C) }; };

API.barcodeBackupData = async (C, token, id) => {
  await auth(C, token, true);
  const data = await bcBackupRead(C, id);
  const q = v => { let text = String(v); if (/^[=+\-@\t\r]/.test(text)) text = "'" + text; return '"' + text.replace(/"/g, '""') + '"'; };
  return { name: 'สำเนารายการบาร์', csv: '\uFEFF' + [['รหัสคู่ค้า', 'หมวด', 'ชื่อรายการ', 'เลขบาร์แพ็ค', 'เลขบาร์เดี่ยว', 'จำนวนต่อแพ็ค']].concat(data.rows).map(r => r.map(q).join(',')).join('\r\n') };
};

async function bcApplyItems(C, who, items, cats, replace, startPos) {
  const ts = now(), ops = [];
  if (replace) {
    const existing = await all(C, 'SELECT id,pos,partner,cat,name,packBar,unitBar,perPack FROM barcode_items ORDER BY pos,id');
    const upserts = [], inserts = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i], pos = i + 1, old = existing[i];
      const partner = str(it.partner), cat = str(it.cat), name = str(it.name), packBar = str(it.packBar), unitBar = str(it.unitBar), perPack = str(it.perPack);
      if (old) {
        if (old.pos === pos && str(old.partner) === partner && str(old.cat) === cat && str(old.name) === name && str(old.packBar) === packBar && str(old.unitBar) === unitBar && str(old.perPack) === perPack) continue;
        upserts.push([old.id, pos, partner, cat, name, packBar, unitBar, perPack]);
      } else {
        inserts.push([pos, partner, cat, name, packBar, unitBar, perPack]);
      }
    }
    if (existing.length > items.length) {
      const extraIds = existing.slice(items.length).map(r => r.id);
      for (const payload of jsonBatches(extraIds)) ops.push(stmt(C, 'DELETE FROM barcode_items WHERE id IN (SELECT value FROM json_each(?))', payload));
    }
    for (const payload of jsonBatches(upserts)) {
      ops.push(stmt(C, `INSERT INTO barcode_items(id,pos,sheet,partner,cat,name,packBar,unitBar,perPack,ts,who) /* barcode_stage */
        SELECT json_extract(value,'$[0]'),json_extract(value,'$[1]'),?,json_extract(value,'$[2]'),json_extract(value,'$[3]'),json_extract(value,'$[4]'),json_extract(value,'$[5]'),json_extract(value,'$[6]'),json_extract(value,'$[7]'),?,? FROM json_each(?) WHERE 1
        ON CONFLICT(id) DO UPDATE SET pos=excluded.pos,sheet=excluded.sheet,partner=excluded.partner,cat=excluded.cat,name=excluded.name,packBar=excluded.packBar,unitBar=excluded.unitBar,perPack=excluded.perPack,ts=excluded.ts,who=excluded.who`,
        BC_SHEET, ts, who, payload));
    }
    for (const payload of jsonBatches(inserts)) {
      ops.push(stmt(C, `INSERT INTO barcode_items(pos,sheet,partner,cat,name,packBar,unitBar,perPack,ts,who) /* barcode_stage */
        SELECT json_extract(value,'$[0]'),?,json_extract(value,'$[1]'),json_extract(value,'$[2]'),json_extract(value,'$[3]'),json_extract(value,'$[4]'),json_extract(value,'$[5]'),json_extract(value,'$[6]'),?,? FROM json_each(?)`,
        BC_SHEET, ts, who, payload));
    }
    ops.push(stmt(C, 'DELETE FROM barcode_cats'));
    if (Array.isArray(cats) && cats.length) ops.push(stmt(C, 'INSERT OR IGNORE INTO barcode_cats(cat) SELECT value FROM json_each(?)', JSON.stringify(cats)));
  } else {
    const inserts = items.map((it, i) => [startPos + i + 1, str(it.partner), str(it.cat), str(it.name), str(it.packBar), str(it.unitBar), str(it.perPack)]);
    for (const payload of jsonBatches(inserts)) {
      ops.push(stmt(C, `INSERT INTO barcode_items(pos,sheet,partner,cat,name,packBar,unitBar,perPack,ts,who) /* barcode_stage */
        SELECT json_extract(value,'$[0]'),?,json_extract(value,'$[1]'),json_extract(value,'$[2]'),json_extract(value,'$[3]'),json_extract(value,'$[4]'),json_extract(value,'$[5]'),json_extract(value,'$[6]'),?,? FROM json_each(?)`,
        BC_SHEET, ts, who, payload));
    }
  }
  if (ops.length) await batch(C, ops);
}

const bcStage = async () => '';
const bcPublishStage = () => null;

API.barcodeRestore = async (C, token, id) => {
  const me = await auth(C, token, true);
  const d = await bcBackupRead(C, id), items = d.rows.map(a => ({ partner: a[0], cat: a[1], name: a[2], packBar: a[3], unitBar: a[4], perPack: a[5] || '' }));
  await bcSnapshot(C, 'ก่อนกู้คืน');
  await bcApplyItems(C, me.name, items, d.cats || [], true, 0);
  await bcLog(C, me, '', 'กู้คืนจากสำเนา', items.length + ' รายการ');
  return { ok: true, count: items.length, backups: await bcBackups(C) };
};

const BC_PATS = [
  ['perPack', /ต่อแพ็ค|ต่อแพค|ต่อ\s*pack|per\s*pack/i],
  ['packBar', /แพ็ค|แพค|pack/i, /บาร์|bar|รหัส|เลข|code/i], ['unitBar', /เดี่ยว|เดียว|unit|single|ชิ้น/i, /บาร์|bar|รหัส|เลข|code/i],
  ['partner', /คู่ค้า|ซัพพลายเออร์|ผู้ขาย|รหัสผู้ขาย|ผู้จำหน่าย|เจ้าหนี้|supplier|vendor|vender|partner/i], ['cat', /หมวด|categor/i], ['name', /ชื่อ|name|^รายการ|description/i]];

function parseBarGrid(grid, defCat) {
  grid = Array.isArray(grid) ? grid : [];
  for (let h = 0; h < Math.min(grid.length, 30); h++) {
    const cols = {};
    (grid[h] || []).forEach((cell, c) => {
      const label = str(cell); if (!label) return;
      for (const [k, re, re2] of BC_PATS) if (typeof k === 'string' && cols[k] === undefined && re instanceof RegExp && re.test(label) && (!(re2 instanceof RegExp) || re2.test(label))) { cols[k] = c; break; }
    });
    if (cols.name === undefined || (cols.packBar === undefined && cols.unitBar === undefined)) continue;
    const items = []; let lastCat = '';
    for (let r = h + 1; r < grid.length; r++) {
      const g = grid[r] || [], o = {};
      BC_FIELDS.forEach(k => { o[k] = cols[k] === undefined ? '' : bcClean(k, g[cols[k]]).slice(0, 200); });
      if (o.cat) lastCat = o.cat; else o.cat = lastCat || defCat || BC_DEFCAT;
      if (!o.name) continue;
      items.push(o);
    }
    return items;
  }
  throw new Error('ไม่พบหัวตาราง (ต้องมีคอลัมน์ชื่อสินค้า/รายการ และเลขบาร์แพ็ค หรือ เลขบาร์เดี่ยว)');
}

API.importBarcodeData = async (C, token, sheets, mode) => {
  const me = await auth(C, token, true);
  if (!Array.isArray(sheets) || !sheets.length) throw new Error('ไม่พบข้อมูลในไฟล์');
  const items = [], notes = [];
  sheets.forEach(s => {
    try { parseBarGrid(s && s.grid, str(s && s.name)).forEach(x => items.push(x)); }
    catch (e) { notes.push(str(s && s.name) + ': ' + e.message); }
  });
  if (!items.length) throw new Error('นำเข้าไม่ได้ — ' + (notes.join(' | ') || 'ไม่พบรายการ'));
  if (items.length > 20000) throw new Error('มีรายการเกิน 20,000 แถว');
  const replace = mode !== 'append';
  await bcSnapshot(C, replace ? 'ก่อนนำเข้า (แทนที่)' : 'ก่อนนำเข้า (เพิ่ม)');
  let add = items, dup = 0, start = 0;
  if (!replace) {
    const have = new Set((await all(C, 'SELECT cat,name,packBar,unitBar FROM barcode_items')).map(r => [r.cat, r.name, r.packBar, r.unitBar].join('\u0001')));
    add = items.filter(x => { const k = [x.cat, x.name, x.packBar, x.unitBar].join('\u0001'); if (have.has(k)) { dup++; return false; } have.add(k); return true; });
    start = (await one(C, 'SELECT MAX(pos) AS m FROM barcode_items')).m || 0;
  }
  await bcApplyItems(C, me.name, add, [], replace, start);
  await bcLog(C, me, '', 'นำเข้าจาก Excel', (replace ? 'แทนที่ทั้งหมด' : 'เพิ่มต่อท้าย') + ' · ' + add.length + ' รายการ' + (dup ? ' · ข้ามซ้ำ ' + dup : ''));
  return { ok: true, count: add.length, duplicates: dup, notes, backups: await bcBackups(C) };
};

const BC_PAIR_KEY = 'BC_PAIR_DRAFT', BC_PAIR_TTL = 7 * 86400000;

async function bcStockMap(C) {
  const out = Object.create(null);
  try {
    const parts = await all(C, 'SELECT g,n,data FROM stock_grp WHERE ver=0 ORDER BY g,n'), by = new Map();
    parts.forEach(p => { if (!by.has(p.g)) by.set(p.g, []); by.get(p.g).push(p.data); });
    by.forEach(list => {
      let rows = [];
      try { rows = JSON.parse(list.join('')); } catch (_) {}
      if (!Array.isArray(rows)) return;
      rows.forEach(r => {
        if (!Array.isArray(r)) return;
        const code = bcClean('packBar', r[1]);
        if (!code) return;
        const q = Number(r[4]) || 0, pr = Number(r[12]) || 0, vd = str(r[13]);
        if (!out[code]) out[code] = { qty: 0, price: 0, partner: '' };
        out[code].qty = Math.round((out[code].qty + q) * 100) / 100;
        if (pr > 0 && !out[code].price) out[code].price = pr;
        if (vd && !out[code].partner) out[code].partner = vd;
      });
    });
  } catch (_) {}
  return out;
}

API.barcodePairContext = async (C, token) => {
  await authPerm(C, token, 'barcode');
  let draft = null;
  try {
    const raw = await kvGet(C, BC_PAIR_KEY, '');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.expiresAt && now() <= Number(parsed.expiresAt)) draft = parsed;
      else await run(C, 'DELETE FROM kv WHERE k=?', BC_PAIR_KEY);
    }
  } catch (_) {}
  return { ok: true, draft, stockMap: await bcStockMap(C), now: now(), ttlMs: BC_PAIR_TTL };
};

API.barcodePairDraftSave = async (C, token, payload) => {
  const me = await auth(C, token, true);
  if (!payload || payload.clear || (!Array.isArray(payload.pairs) || (!payload.pairs.length && !(payload.unmatchedUnits && payload.unmatchedUnits.length) && !(payload.unmatchedPacks && payload.unmatchedPacks.length)))) {
    await run(C, 'DELETE FROM kv WHERE k=?', BC_PAIR_KEY);
    return { ok: true, cleared: true, draft: null };
  }
  const ts = now(), expiresAt = ts + BC_PAIR_TTL;
  const draft = {
    savedAt: ts,
    expiresAt,
    who: me.name,
    pairs: payload.pairs.slice(0, 5000),
    unmatchedUnits: Array.isArray(payload.unmatchedUnits) ? payload.unmatchedUnits.slice(0, 3000) : [],
    unmatchedPacks: Array.isArray(payload.unmatchedPacks) ? payload.unmatchedPacks.slice(0, 3000) : []
  };
  await kvSet(C, BC_PAIR_KEY, JSON.stringify(draft));
  return { ok: true, savedAt: ts, expiresAt, who: me.name, draft };
};

API.confirmBarcodePairs = async (C, token, payload) => {
  const me = await auth(C, token, true);
  const rawPairs = Array.isArray(payload) ? payload : (payload && Array.isArray(payload.pairs) ? payload.pairs : []);
  if (!rawPairs.length) throw new Error('กรุณาเลือกรายการคู่บาร์เดี่ยว/บาร์แพ็คที่ต้องการยืนยันอย่างน้อย 1 คู่');
  if (rawPairs.length > 10000) throw new Error('ยืนยันได้ครั้งละไม่เกิน 10,000 คู่');

  const validPairs = [];
  for (let i = 0; i < rawPairs.length; i++) {
    const v = bcVals(rawPairs[i] || {});
    v.cat = v.cat || BC_DEFCAT;
    if (!v.name) throw new Error('คู่ที่ ' + (i + 1) + ': กรุณากรอกชื่อรายการ');
    if (!v.packBar && !v.unitBar) throw new Error('คู่ที่ ' + (i + 1) + ' (' + v.name + '): ต้องมีเลขบาร์แพ็คหรือเลขบาร์เดี่ยว');
    validPairs.push(v);
  }

  await bcSnapshot(C, 'ก่อนยืนยันจับคู่บาร์เดี่ยว/แพ็ค');

  const existing = await all(C, 'SELECT id,pos,partner,cat,name,packBar,unitBar,perPack FROM barcode_items ORDER BY pos,id');
  const byUnit = new Map(), byPack = new Map(), byCatName = new Map();
  let maxPos = 0;
  existing.forEach(r => {
    if (r.pos > maxPos) maxPos = r.pos;
    const u = str(r.unitBar), p = str(r.packBar), cn = str(r.cat) + '\u0001' + str(r.name).toLowerCase();
    if (u && !byUnit.has(u)) byUnit.set(u, r);
    if (p && !byPack.has(p)) byPack.set(p, r);
    if (!byCatName.has(cn)) byCatName.set(cn, r);
  });

  const toUpdate = new Map();
  const toInsert = [];
  const toDeleteIds = new Set();
  const touchedCats = new Set();

  for (const v of validPairs) {
    let uRow = v.unitBar ? (byUnit.get(v.unitBar) || byPack.get(v.unitBar) || null) : null;
    let pRow = v.packBar ? (byPack.get(v.packBar) || byUnit.get(v.packBar) || null) : null;
    let nRow = byCatName.get(v.cat + '\u0001' + v.name.toLowerCase()) || null;
    if (uRow && toDeleteIds.has(uRow.id)) uRow = null;
    if (pRow && toDeleteIds.has(pRow.id)) pRow = null;
    if (nRow && toDeleteIds.has(nRow.id)) nRow = null;

    const target = uRow || pRow || nRow;
    if (target) {
      if (pRow && uRow && pRow.id !== uRow.id) {
        toDeleteIds.add(pRow.id);
        toUpdate.delete(pRow.id);
      }
      const merged = {
        id: target.id,
        pos: target.pos,
        partner: v.partner || str(target.partner),
        cat: v.cat || str(target.cat) || BC_DEFCAT,
        name: v.name || str(target.name),
        packBar: v.packBar || str(target.packBar),
        unitBar: v.unitBar || str(target.unitBar),
        perPack: v.perPack || str(target.perPack)
      };
      Object.assign(target, merged);
      toUpdate.set(target.id, [merged.id, merged.pos, merged.partner, merged.cat, merged.name, merged.packBar, merged.unitBar, merged.perPack]);
      if (merged.unitBar) byUnit.set(merged.unitBar, target);
      if (merged.packBar) byPack.set(merged.packBar, target);
      byCatName.set(merged.cat + '\u0001' + merged.name.toLowerCase(), target);
      touchedCats.add(merged.cat);
    } else {
      maxPos++;
      toInsert.push([maxPos, v.partner, v.cat, v.name, v.packBar, v.unitBar, v.perPack]);
      touchedCats.add(v.cat);
    }
  }

  const ts = now(), ops = [];
  if (toDeleteIds.size) {
    for (const batchIds of jsonBatches(Array.from(toDeleteIds))) {
      ops.push(stmt(C, 'DELETE FROM barcode_items WHERE id IN (SELECT value FROM json_each(?))', batchIds));
    }
  }
  const updateList = Array.from(toUpdate.values());
  for (const batchUpd of jsonBatches(updateList)) {
    ops.push(stmt(C, `INSERT INTO barcode_items(id,pos,sheet,partner,cat,name,packBar,unitBar,perPack,ts,who)
      SELECT json_extract(value,'$[0]'),json_extract(value,'$[1]'),?,json_extract(value,'$[2]'),json_extract(value,'$[3]'),json_extract(value,'$[4]'),json_extract(value,'$[5]'),json_extract(value,'$[6]'),json_extract(value,'$[7]'),?,? FROM json_each(?) WHERE 1
      ON CONFLICT(id) DO UPDATE SET pos=excluded.pos,sheet=excluded.sheet,partner=excluded.partner,cat=excluded.cat,name=excluded.name,packBar=excluded.packBar,unitBar=excluded.unitBar,perPack=excluded.perPack,ts=excluded.ts,who=excluded.who`,
      BC_SHEET, ts, me.name, batchUpd));
  }
  for (const batchIns of jsonBatches(toInsert)) {
    ops.push(stmt(C, `INSERT INTO barcode_items(pos,sheet,partner,cat,name,packBar,unitBar,perPack,ts,who)
      SELECT json_extract(value,'$[0]'),?,json_extract(value,'$[1]'),json_extract(value,'$[2]'),json_extract(value,'$[3]'),json_extract(value,'$[4]'),json_extract(value,'$[5]'),json_extract(value,'$[6]'),?,? FROM json_each(?)`,
      BC_SHEET, ts, me.name, batchIns));
  }
  if (touchedCats.size) {
    for (const batchCats of jsonBatches(Array.from(touchedCats))) {
      ops.push(stmt(C, 'DELETE FROM barcode_cats WHERE cat IN (SELECT value FROM json_each(?))', batchCats));
    }
  }
  if (ops.length) await batch(C, ops);

  await bcLog(C, me, '', 'จับคู่บาร์เดี่ยว/แพ็ค', 'ยืนยัน ' + validPairs.length + ' คู่ (เพิ่มใหม่ ' + toInsert.length + ' · อัปเดต ' + updateList.length + ')');
  return { ok: true, count: validPairs.length, created: toInsert.length, updated: updateList.length, merged: toDeleteIds.size, backups: await bcBackups(C) };
};

export { BC_SHEET, BACKUP_KEEP, BC_DEFCAT, BC_COMPANY, BC_TITLE, BC_SCHEMA, BC_FIELDS, bcClean, bcVals, bcRow, thDateS, bcLog, bcDup, BC_FONTS, BC_FONT_DEF, bcBackups, bcSnapshot, bcBackupRead, bcStage, bcPublishStage, BC_PATS, parseBarGrid, BC_PAIR_KEY, BC_PAIR_TTL };
