import { all, batch, hashPw, jsonBatches, kvJson, kvMany, kvSet, kvSetStmt, now, one, passArg, stateJson, stmt, str, uuid } from '../core/database.js';
import { API } from '../core/registry.js';
import { auth, authPerm, checkRecovery, failBump, failClear, failCount, getUser } from './auth.js';
import { sysLogTo } from '../core/logging.js';
import { MAX_FAIL } from '../core/config.js';

const STOCK_MAX_ROWS = 100000, STOCK_HISTORY_MAX = 36, STOCK_ST = ['DS', 'T3', 'T2', 'T1', ''];

const STOCK_GROUP_RE = /^[A-Z0-9_-]{1,12}$/;

const stockCodeKey = s => str(s).replace(/\s+/g, '').toLowerCase();

const STOCK_LOST_MAX = 5000;

const STOCK_ADJ_KV = { lost: 'STOCK_LOST', exp: 'STOCK_EXPIRED', pend: 'STOCK_PENDING', waste: 'STOCK_WASTE' }, STOCK_ADJ_LABEL = { lost: 'ของหาย', exp: 'สินค้าหมดอายุ', pend: 'รอปรับข้อมูล', waste: 'ของเสีย' };

const stockAdjKey = (code, br) => stockCodeKey(code) + (stockBrKey(br) ? '@' + stockBrKey(br) : '');

const STOCK_CT_MAX = 50, STOCK_CT_ID_RE = /^[a-z0-9]{4,16}$/;

async function stockCtagDefs(C) {
  const raw = (await stateJson(C, 'STOCK_CTAGS', {})) || {}, out = {};
  Object.keys(raw).forEach(id => { const v = raw[id]; if (STOCK_CT_ID_RE.test(id) && v && typeof v === 'object' && str(v.t)) out[id] = { t: str(v.t).slice(0, 30), mode: v.mode === 'deduct' ? 'deduct' : 'tag', ts: v.ts || 0, who: str(v.who) }; });
  return out;
}

function stockCtagMeta(id, def) { return { label: def.t, kv: 'STOCK_CT_' + id }; }

async function stockAdjLoad(C) {
  const out = {}, defs = await stockCtagDefs(C), kinds = {}, labels = {};
  Object.keys(STOCK_ADJ_KV).forEach(k => { kinds[k] = STOCK_ADJ_KV[k]; labels[k] = STOCK_ADJ_LABEL[k]; });
  Object.keys(defs).forEach(id => { if (defs[id].mode === 'deduct') { kinds['c_' + id] = 'STOCK_CT_' + id; labels['c_' + id] = defs[id].t; } });
  const stored = await kvMany(C, Object.values(kinds));
  for (const kind of Object.keys(kinds)) {
    let raw = {};
    try { raw = stored[kinds[kind]] === undefined ? {} : JSON.parse(stored[kinds[kind]]); }
    catch (e) { throw new Error('ข้อมูลรายการ' + labels[kind] + 'เสียหาย กรุณาติดต่อผู้ดูแล'); }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('ข้อมูลรายการ' + labels[kind] + 'ไม่ถูกต้อง');
    const m = Object.create(null);
    Object.keys(raw).forEach(k => {
      const v = raw[k];
      if (!k || !v || typeof v !== 'object' || !str(v.code) || (v.qty != null && (!Number.isFinite(Number(v.qty)) || Number(v.qty) < 0))) throw new Error('ข้อมูลรายการ' + labels[kind] + 'ไม่ถูกต้อง กรุณาติดต่อผู้ดูแล');
      m[k] = v;
    });
    out[kind] = m;
  }
  return out;
}

function stockApply(rows, adj) {
  const hit = { lost: Object.create(null), exp: Object.create(null), pend: Object.create(null), waste: Object.create(null) }, by = new Map();
  if (adj) Object.keys(adj).forEach(kind => { if (!hit[kind]) hit[kind] = Object.create(null); });
  if (adj) Object.keys(hit).forEach(kind => Object.keys(adj[kind] || {}).forEach(k => {
    const e = adj[kind][k], ck = stockCodeKey(e.code);
    if (!ck) return;
    const h = hit[kind][k] = [];
    if (!by.has(ck)) by.set(ck, []);
    by.get(ck).push({ h, bk: stockBrKey(e.br), left: (e.qty === null || e.qty === undefined) ? Infinity : Math.max(0, Number(e.qty) || 0) });
  }));
  by.forEach(l => l.sort((a, b) => (b.bk ? 1 : 0) - (a.bk ? 1 : 0)));
  const out = [], zero = [], cut = [];
  rows.forEach(r => {
    if (!(r[4] > 0)) { zero.push(r); return; }                    // คงเหลือ 0 = ไม่เอาไปคำนวณ แยกเป็นรายการต่างหาก
    const l = by.get(stockCodeKey(r[1]));
    if (!l) { out.push(r); return; }
    const rb = stockBrKey(r[3]); let q = r[4];
    l.forEach(en => {
      if (!(q > 0) || !(en.left > 0) || (en.bk && en.bk !== rb)) return;
      const t = Math.min(q, en.left);
      q -= t; en.left -= t;
      en.h.push({ g: r[0], br: r[3], qty: stockNum(t, 2), cost: r[11], name: r[2] });
    });
    q = stockNum(q, 2);
    if (q <= 0) { const c = r.slice(); c[4] = 0; c[20] = r[4]; cut.push(c); return; }
    if (q === r[4]) out.push(r); else { const c = r.slice(); c[4] = q; c[20] = r[4]; out.push(c); }
  });
  return { rows: out, hit, zero, cut };
}

const stockBrKey = s => {
  const key = str(s).replace(/\s+/g, '').toLowerCase();
  if (key === '__proto__' || key === 'constructor' || key === 'prototype') throw new Error('ชื่อสาขานี้สงวนไว้สำหรับระบบ กรุณาใช้ชื่ออื่น');
  return key;
};

const STOCK_DATE_CACHE = new Map();

const stockDate = v => {
  v = str(v);
  const hit = STOCK_DATE_CACHE.get(v); if (hit !== undefined) return hit;
  let out = '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { const d = new Date(v + 'T00:00:00Z'); if (Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v) out = v; }
  if (STOCK_DATE_CACHE.size > 5000) STOCK_DATE_CACHE.clear();
  STOCK_DATE_CACHE.set(v, out); return out;
};

const stockNum = (v, dp) => { const n = Number(v); return isFinite(n) ? Math.round(n * Math.pow(10, dp)) / Math.pow(10, dp) : 0; };

const stockOpt = (v, dp) => (v === null || v === undefined || v === '' || !isFinite(Number(v))) ? null : stockNum(v, dp);

function stockCleanRow(r) {
  if (!Array.isArray(r)) return null;
  const g = str(r[0]).toUpperCase().slice(0, 12), name = str(r[2]).slice(0, 200);
  if (!STOCK_GROUP_RE.test(g) || !name || r[4] === null || r[4] === undefined || str(r[4]) === '' || !Number.isFinite(Number(r[4]))) return null;
  const qty = stockNum(r[4], 2);
  if (!isFinite(qty)) return null;                               // เก็บทุกแถว รวมคงเหลือ 0 และติดลบ (แถวคงเหลือ 0 ไม่นับรวมในยอด/สรุป — แสดงแยกเป็นอีกรายการ)
  const days = (r[9] === null || r[9] === undefined || r[9] === '') ? null : Math.round(Number(r[9])), st = str(r[10]).toUpperCase();
  const sold = stockNum(r[5], 2), cost = stockNum(r[11], 4), price = stockNum(r[12], 2);
  let profit = stockOpt(r[16], 4); if (profit === null) profit = stockNum(price - cost, 4);                   // คอลัมน์ท้ายตามไฟล์ต้นฉบับ: ไม่มีในไฟล์ → คำนวณเอง
  let pct = stockOpt(r[17], 2); if (pct === null) pct = cost > 0 ? stockNum(profit / cost * 100, 2) : 0;
  let sales = stockOpt(r[18], 2); if (sales === null) sales = stockNum(sold * price, 2);
  let net = stockOpt(r[19], 2); if (net === null) net = stockNum(sold * profit / 1.07, 2);
  const bw = str(r[15]).toUpperCase(), below = bw ? (bw === 'B' ? 'B' : '-') : (price < cost ? 'B' : '-');
  return [g, str(r[1]).slice(0, 30), name, str(r[3]).slice(0, 20), qty, sold, stockNum(r[6], 2), stockDate(r[7]), stockDate(r[8]),
    days !== null && isFinite(days) ? days : null, STOCK_ST.indexOf(st) >= 0 ? st : '', cost, price, str(r[13]).slice(0, 60), stockDate(r[14]),
    below, profit, pct, sales, net];
}

function stockDedupe(rows) {                                     // กลุ่ม+รหัส+ชื่อ+สาขา ซ้ำกัน → เก็บแถวจากรายงานที่ใหม่กว่า
  const m = new Map();
  rows.forEach(r => { const k = [r[0], r[1], r[2], r[3]].join('\u0001'), o = m.get(k); if (!o || r[14] >= o[14]) m.set(k, r); });
  return Array.from(m.values());
}

function stockSummary(rows, lost) {                                // lost (ไม่บังคับ) = { lost, exp } จาก stockAdjLoad → หักจำนวนของหาย/หมดอายุก่อนสรุป
  rows = lost ? stockApply(rows, lost).rows : rows.filter(r => r[4] > 0);       // คงเหลือ 0 ไม่นับในสรุป
  const out = { items: rows.length, pcs: 0, cost: 0, st: {} };
  STOCK_ST.forEach(k => { out.st[k || 'NA'] = { n: 0, pcs: 0, cost: 0 }; });
  rows.forEach(r => {
    const v = r[4] * r[11], b = out.st[r[10] || 'NA'];
    out.pcs += r[4]; out.cost += v; b.n++; b.pcs += r[4]; b.cost += v;
  });
  out.pcs = Math.round(out.pcs * 100) / 100; out.cost = Math.round(out.cost * 100) / 100;
  Object.keys(out.st).forEach(k => { out.st[k].pcs = Math.round(out.st[k].pcs * 100) / 100; out.st[k].cost = Math.round(out.st[k].cost * 100) / 100; });
  return out;
}

function stockGroupSums(state) {                                  // ยอดทุกช่วงอายุรายหมวด ณ รอบที่บันทึก · { G01: { DS: [รายการ, มูลค่าทุน], T3: [..], T2: [..], T1: [..], NA: [..] } }
  const out = {};
  Object.keys(state).forEach(g => {
    const m = state[g] && state[g].cur, st = m && m.sum && m.sum.st; if (!st) return;
    out[g] = {};
    STOCK_ST.forEach(status => {
      const k = status || 'NA', a = st[k];
      out[g][k] = [a ? a.n : 0, a ? Math.round(a.cost) : 0];
    });
  });
  return out;
}

function stockTotal(state) {                                      // ผลรวมทั้งร้านจากฉบับปัจจุบันของทุกหมวด
  const out = { items: 0, pcs: 0, cost: 0, st: {} };
  STOCK_ST.forEach(k => { out.st[k || 'NA'] = { n: 0, pcs: 0, cost: 0 }; });
  Object.keys(state).forEach(g => {
    const s = state[g] && state[g].cur && state[g].cur.sum; if (!s) return;
    out.items += s.items; out.pcs += s.pcs; out.cost += s.cost;
    Object.keys(out.st).forEach(k => { const a = s.st && s.st[k]; if (a) { out.st[k].n += a.n; out.st[k].pcs += a.pcs; out.st[k].cost += a.cost; } });
  });
  out.pcs = Math.round(out.pcs * 100) / 100; out.cost = Math.round(out.cost * 100) / 100;
  Object.keys(out.st).forEach(k => { out.st[k].pcs = Math.round(out.st[k].pcs * 100) / 100; out.st[k].cost = Math.round(out.st[k].cost * 100) / 100; });
  return out;
}

function stockSideSummaries(state, side, rows) {
  const by = new Map();
  rows.forEach(r => { if (!by.has(r[0])) by.set(r[0], []); by.get(r[0]).push(r); });
  Object.keys(state).forEach(g => { if (state[g] && state[g][side]) state[g][side].sum = stockSummary(by.get(g) || []); });
}

async function stockRebuildSummaries(C, state, adj, replacements) {
  const versions = await Promise.all([stockRowsByGroup(C, 0), stockRowsByGroup(C, 1)]);
  for (let ver = 0; ver < 2; ver++) {
    const side = ver ? 'prev' : 'cur', by = versions[ver], replace = replacements && replacements[side];
    if (replace) replace.forEach((rows, g) => by.set(g, rows));
    const rows = [];
    Object.keys(state).sort().forEach(g => {
      const meta = state[g] && state[g][side]; if (!meta) return;
      if (!by.has(g) && meta.count > 0) throw new Error('ข้อมูลสต็อกไม่ครบ (หมวด ' + g + ') กรุณาติดต่อผู้ดูแล');
      (by.get(g) || []).forEach(r => rows.push(r));
    });
    // Allocate each adjustment once across all categories, matching stockGet.
    stockSideSummaries(state, side, stockApply(rows, adj).rows);
  }
  return state;
}

function stockInsertOps(C, g, ver, json) {
  const ops = [];
  const chunks = [];
  for (let i = 0, n = 0; i < json.length; i += 240000, n++) chunks.push([n, json.slice(i, i + 240000)]);
  for (const payload of jsonBatches(chunks)) ops.push(stmt(C, "INSERT OR REPLACE INTO stock_grp(g,ver,n,data) SELECT ?,?,json_extract(value,'$[0]'),json_extract(value,'$[1]') FROM json_each(?)", g, ver, payload));
  return ops;
}

function stockParseRows(json, label) {
  let rows;
  try { rows = JSON.parse(json); } catch (e) { /* แสดงข้อผิดพลาดด้านล่าง */ }
  if (!Array.isArray(rows) || rows.some(r => !stockCleanRow(r))) throw new Error('ข้อมูลสต็อกเสียหาย (' + label + ') กรุณาติดต่อผู้ดูแลก่อนทำรายการ');
  return rows;
}

async function stockRowsByGroup(C, ver) {
  const parts = await all(C, 'SELECT g,n,data FROM stock_grp WHERE ver=? ORDER BY g,n', ver), by = new Map();
  parts.forEach(p => {
    if (!by.has(p.g)) by.set(p.g, []);
    const list = by.get(p.g);
    if (p.n !== list.length) throw new Error('ข้อมูลสต็อกไม่ครบ (หมวด ' + p.g + ') กรุณาติดต่อผู้ดูแล');
    list.push(p.data);
  });
  by.forEach((parts, g) => {
    const rows = stockParseRows(parts.join(''), 'หมวด ' + g);
    if (rows.some(r => str(r[0]).toUpperCase() !== g)) throw new Error('ข้อมูลแถวไม่ตรงกับหมวด ' + g + ' กรุณาติดต่อผู้ดูแล');
    by.set(g, rows);
  });
  return by;
}

async function stockLoadRows(C, ver) {                            // แถวของทุกหมวดตามฉบับที่ขอ (0 = ปัจจุบัน, 1 = ก่อนหน้า) เรียงตามรหัสหมวด
  const by = await stockRowsByGroup(C, ver), out = [];
  Array.from(by.keys()).sort().forEach(g => by.get(g).forEach(r => out.push(r)));
  return out;
}

async function stockGroupJson(C, g, ver) {
  const parts = await all(C, 'SELECT n,data FROM stock_grp WHERE g=? AND ver=? ORDER BY n', g, ver);
  if (parts.some((p, i) => p.n !== i)) throw new Error('ข้อมูลสต็อกไม่ครบ (หมวด ' + g + ') กรุณาติดต่อผู้ดูแล');
  return parts.length ? parts.map(p => p.data).join('') : null;
}

async function stockState(C) {
  const cur = await stateJson(C, 'STOCK_GROUPS', null);
  if (cur && typeof cur === 'object' && !Array.isArray(cur)) {
    if (Object.keys(cur).some(g => !STOCK_GROUP_RE.test(g) || !cur[g] || typeof cur[g] !== 'object' || Array.isArray(cur[g]) || ['cur', 'prev'].some(side => cur[g][side] != null && (typeof cur[g][side] !== 'object' || Array.isArray(cur[g][side]))))) throw new Error('ข้อมูลกำกับหมวดสต็อกไม่ถูกต้อง กรุณาติดต่อผู้ดูแล');
    return cur;
  }
  if (cur !== null) throw new Error('ข้อมูลหมวดสต็อกไม่ถูกต้อง กรุณาติดต่อผู้ดูแล');
  const parts = await all(C, 'SELECT data FROM stock_data ORDER BY n'), state = {};
  if (!parts.length) {
    const existing = await one(C, 'SELECT COUNT(*) AS n FROM stock_grp');
    if (existing && existing.n > 0) throw new Error('ไม่พบข้อมูลกำกับหมวดสต็อก กรุณาติดต่อผู้ดูแลก่อนทำรายการ');
  }
  let legacy = [];
  if (parts.length) legacy = stockParseRows(parts.map(p => p.data).join(''), 'ข้อมูลเดิม');
  if (legacy.length) {
    const meta = (await stateJson(C, 'STOCK_META', null)) || {}, by = {}, ops = [];
    legacy.map(stockCleanRow).filter(r => r !== null).forEach(r => { (by[r[0]] || (by[r[0]] = [])).push(r); });
    Object.keys(by).forEach(g => {
      const rows = by[g], reps = rows.map(r => r[14]).filter(Boolean).sort();
      ops.push(...stockInsertOps(C, g, 0, JSON.stringify(rows)));
      state[g] = { cur: { ts: meta.ts || now(), who: str(meta.who), file: str(meta.file), rep: reps[reps.length - 1] || '', title: '', count: rows.filter(r => r[4] > 0).length, sum: stockSummary(rows) }, prev: null };
    });
    ops.push(stmt(C, 'DELETE FROM stock_data'), kvSetStmt(C, 'STOCK_GROUPS', JSON.stringify(state)));
    await batch(C, ops);
  } else await kvSet(C, 'STOCK_GROUPS', '{}');
  return state;
}

const stockNames = async C => {
  const raw = (await stateJson(C, 'STOCK_NAMES', {})) || {}, out = {};
  Object.keys(raw).forEach(k => {
    const t = str(raw[k]);
    if (!t) return;
    if (k === '__BR_CFG__') { out[k] = t.slice(0, 20000); return; }
    if (/^[A-Z0-9_-]{1,12}$/.test(k) || /^[^:\s]{1,25}:[A-Z0-9_-]{1,12}$/.test(k)) out[k] = t.slice(0, 40);
  });
  return out;
};

function thaiDayIso(ts) {                                         // ไทยเป็น UTC+7 ตายตัว (ไม่มี DST) — ไม่สร้าง Intl.DateTimeFormat ทุกครั้งเพราะกิน CPU มาก
  var t = ts == null ? Date.now() : Number(ts);
  if (!Number.isFinite(t)) return '';
  var d = new Date(t + 7 * 3600000);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : '';
}

function stockDayKey(ts) { return thaiDayIso(ts); }

function stockDailyHistory(hist) {
  if (!Array.isArray(hist)) return [];
  const byDay = new Map();
  hist.forEach(x => {
    if (!x || !x.ts) return;
    const dk = stockDayKey(x.ts), prev = byDay.get(dk);
    if (!prev || x.ts >= prev.ts) {
      // Keep the final snapshot intact. Older per-group sums cannot describe a
      // newer snapshot and missing legacy age buckets must stay unknown.
      byDay.set(dk, Object.assign({}, x));
    }
  });
  return Array.from(byDay.values()).sort((a, b) => a.ts - b.ts);
}

function stockPushHistory(hist, entry) {
  return stockDailyHistory([...(Array.isArray(hist) ? hist : []), entry]).slice(-STOCK_HISTORY_MAX);
}

async function stockBarcodeData(C, options) {
  const cached = options && Number.isSafeInteger(options.barcodeRevision) && options.barcodeRevision >= 0 ? options.barcodeRevision : -1;
  // Read the revision and its matching rows in one snapshot. Cached clients
  // avoid scanning/transferring the barcode catalog until a barcode save.
  const snapshot = await batch(C, [
    stmt(C, "SELECT COALESCE((SELECT revision FROM write_revisions WHERE scope='barcode'),0) AS revision"),
    stmt(C, "SELECT partner,cat,name,perPack,packBar,unitBar FROM barcode_items WHERE ?<0 OR COALESCE((SELECT revision FROM write_revisions WHERE scope='barcode'),0)<>? ORDER BY pos,id", cached, cached)
  ]);
  const barcodeRevision = snapshot[0].results[0].revision;
  return { barcodeRevision, barcodes: cached === barcodeRevision ? undefined : (snapshot[1].results || []).map(r => [str(r.packBar), str(r.unitBar), str(r.perPack), str(r.name), str(r.cat), str(r.partner)]) };
}

API.stockGet = async (C, token, ver, options) => {
  const me = await authPerm(C, token, 'stock'), v = ver === 'prev' ? 1 : 0;
  const state = await stockState(C);
  const [rows0, history, names, lost, hard, barcodeData, notes] = await Promise.all([
    stockLoadRows(C, v),
    stateJson(C, 'STOCK_HISTORY', []),
    stockNames(C),
    stockAdjLoad(C),
    stockHardLoad(C),
    stockBarcodeData(C, options),
    stockNotesLoad(C)
  ]);
  const ap = stockApply(rows0, lost);
  const foundGroups = new Set(rows0.map(r => r[0]));
  Object.keys(state).forEach(g => {
    const meta = state[g] && state[g][v ? 'prev' : 'cur'];
    if (meta && meta.count > 0 && !foundGroups.has(g)) throw new Error('ข้อมูลสต็อกไม่ครบ (หมวด ' + g + ') กรุณาติดต่อผู้ดูแล');
  });
  stockSideSummaries(state, v ? 'prev' : 'cur', ap.rows);
  // ของหาย/สินค้าหมดอายุ: หักจำนวนออกจากแถวแล้ว (แถวที่ยังเหลือแสดงตามปกติด้วยจำนวนที่เหลือ) · เก็บรายละเอียดที่หักไว้แสดงในหน้า "ของหาย"/"สินค้าหมดอายุ"
  const adjList = kind => Object.keys(lost[kind]).map(k => { const e = lost[kind][k], h = ap.hit[kind][k] || []; return { k, code: str(e.code), br: str(e.br), qty: (e.qty === null || e.qty === undefined) ? null : (Number(e.qty) || 0), name: (h[0] && h[0].name) || str(e.name), note: str(e.note), ts: e.ts || 0, who: str(e.who), hit: h }; }).sort((a, b) => b.ts - a.ts);
  const ctDefs = await stockCtagDefs(C), ctMapRaw = (await stateJson(C, 'STOCK_CTMAP', {})) || {}, ctLists = {}, ctMap = {};
  Object.keys(ctDefs).forEach(id => { if (ctDefs[id].mode === 'deduct') ctLists[id] = adjList('c_' + id); else ctMap[id] = Object.keys(ctMapRaw[id] || {}); });
  return { me: { name: me.name, role: me.role, edit: me.role === 'admin' || !!me.perms.stock_edit }, ver: v ? 'prev' : 'cur', groups: state, rows: ap.rows, zero: ap.zero, cut: ap.cut, history: Array.isArray(history) ? stockDailyHistory(history) : [], names, lost: adjList('lost'), expired: adjList('exp'), pending: adjList('pend'), waste: adjList('waste'), hard, ...barcodeData, ctags: ctDefs, ctlists: ctLists, ctmap: ctMap, notes };
};

API.stockSave = async (C, token, payload) => {
  const me = await stockEditAuth(C, token);
  payload = payload || {};
  if (payload.revision !== undefined && payload.revision !== C.guard.revision) throw new Error('ข้อมูลสต็อกเปลี่ยนไปแล้ว กรุณาโหลดล่าสุดก่อนบันทึก');
  if (!Array.isArray(payload.groups) || !payload.groups.length) throw new Error('ไม่พบข้อมูลในไฟล์');
  if (payload.groups.length > 50) throw new Error('กรุณาแบ่งบันทึกครั้งละไม่เกิน 50 หมวด');
  const branch = str(payload.branch).replace(/\s+/g, ' ').trim().slice(0, 20);
  if (!branch) throw new Error('กรุณาเลือกสาขาก่อนอัปโหลด');
  const bk = stockBrKey(branch);
  const state = await stockState(C), ts = now(), file = str(payload.fileName).slice(0, 120), ops = [], changed = [], same = [], seen = {}, diff = {}, lost = await stockAdjLoad(C);
  const replacements = { cur: new Map(), prev: new Map() };
  const tot = { add: 0, chg: 0, del: 0, same: 0 };
  let total = 0;
  for (const it of payload.groups) {
    const g = str(it && it.g).toUpperCase();
    if (!STOCK_GROUP_RE.test(g) || seen[g]) throw new Error('รหัสหมวดไม่ถูกต้องหรือซ้ำกัน: ' + g);
    seen[g] = 1;
    // แถวใหม่: เอาเฉพาะของสาขาที่เลือก (แถวที่ไม่มีชื่อสาขานับเป็นสาขานี้)
    if (!Array.isArray(it.rows)) throw new Error('ข้อมูลหมวด ' + g + ' ไม่ถูกต้อง กรุณาอ่านไฟล์ใหม่');
    const cleaned = it.rows.map(stockCleanRow);
    if (cleaned.some(r => !r || r[0] !== g || (r[3] && stockBrKey(r[3]) !== bk))) throw new Error('พบแถวที่ไม่ถูกต้องหรือสาขาไม่ตรงในหมวด ' + g + ' กรุณาตรวจไฟล์ก่อนอัปโหลด');
    const mine = stockDedupe(cleaned.map(r => { r[3] = branch; return r; }));
    total += mine.length;
    if (total > STOCK_MAX_ROWS) throw new Error('มีรายการเกิน ' + STOCK_MAX_ROWS + ' แถว');
    // แถวเดิมของสาขาอื่นในหมวดนี้เก็บไว้ครบ — ตัดออกเฉพาะแถวของสาขาที่กำลังอัปโหลด
    const oldJson = await stockGroupJson(C, g, 0);
    const existing = oldJson ? stockParseRows(oldJson, 'หมวด ' + g) : [];
    if (existing.some(r => r[0] !== g)) throw new Error('ข้อมูลแถวไม่ตรงกับหมวด ' + g + ' กรุณาติดต่อผู้ดูแล');
    if (!oldJson && state[g] && state[g].cur && state[g].cur.count > 0) throw new Error('ข้อมูลสต็อกไม่ครบ (หมวด ' + g + ') กรุณาติดต่อผู้ดูแล');
    // อัปเดตเฉพาะแถวที่เปลี่ยน: เทียบรายแถวของสาขานี้ (กลุ่ม+รหัส+ชื่อ+สาขา)
    const dk = r => [r[0], r[1], r[2], stockBrKey(r[3])].join('\u0001'), newMap = new Map(mine.map(r => [dk(r), r])), used = new Set(), merged = [], df = { add: 0, chg: 0, del: 0, same: 0 };
    for (const r of existing) {
      if (stockBrKey(r[3]) !== bk) { merged.push(r); continue; }
      const k = dk(r), n = newMap.get(k);
      if (!n) { df.del++; continue; }
      used.add(k);
      if (JSON.stringify(n) === JSON.stringify(r)) { df.same++; merged.push(r); } else { df.chg++; merged.push(n); }
    }
    mine.forEach(r => { if (!used.has(dk(r))) { df.add++; merged.push(r); } });
    const rows = stockDedupe(merged);
    const reps = rows.map(r => r[14]).filter(Boolean).sort(), rep = reps[reps.length - 1] || stockDate(it.rep) || '';
    const json = JSON.stringify(rows), old = state[g];
    diff[g] = df;
    if (old && old.cur && old.cur.rep === rep && !df.add && !df.chg && !df.del) { same.push(g); continue; }
    tot.add += df.add; tot.chg += df.chg; tot.del += df.del; tot.same += df.same;
    // meta รายสาขา: สาขาที่อัปโหลดครั้งนี้ใช้เวลา/ผู้อัป/ไฟล์ใหม่ สาขาอื่นคงของเดิมไว้
    const oc = old && old.cur, oldBr = (oc && oc.br) || {}, br = {};
    rows.forEach(r => { const b = br[r[3]] || (br[r[3]] = { count: 0, rep: '' }); if (r[4] > 0) b.count++; if (r[14] > b.rep) b.rep = r[14]; });
    if (!br[branch]) br[branch] = { count: 0, rep: stockDate(it.rep) };
    Object.keys(br).forEach(k => {
      const src = k === branch ? { ts, who: me.name, file } : (oldBr[k] || (oc ? { ts: oc.ts, who: oc.who, file: oc.file } : { ts, who: me.name, file }));
      br[k].ts = src.ts; br[k].who = src.who; br[k].file = src.file;
    });
    ops.push(stmt(C, 'DELETE FROM stock_grp WHERE g=? AND ver=1', g), stmt(C, 'UPDATE stock_grp SET ver=1 WHERE g=? AND ver=0', g), ...stockInsertOps(C, g, 0, json));
    state[g] = { cur: { ts, who: me.name, file, rep, title: str(it.title).slice(0, 160), count: rows.filter(r => r[4] > 0).length, sum: stockSummary(rows, lost), br }, prev: old && old.cur ? old.cur : null };
    replacements.cur.set(g, rows); replacements.prev.set(g, existing);
    changed.push(g);
  }
  if (!changed.length) return { ok: true, changed, same, diff, tot };
  // ไม่มีรายการหัก (ของหาย/หมดอายุ/แท็กหักออก) → ยอดสรุปรายหมวดที่คำนวณในลูปถูกต้องแล้ว ไม่ต้องโหลดทุกหมวดมาคำนวณใหม่
  if (Object.keys(lost).some(k => Object.keys(lost[k] || {}).length)) await stockRebuildSummaries(C, state, lost, replacements);
  const dates = Object.keys(state).map(g => state[g].cur && state[g].cur.rep).filter(Boolean).sort(), sum = stockTotal(state);
  const hist = stockPushHistory(await stateJson(C, 'STOCK_HISTORY', []), { ts, who: me.name, file, branch, to: dates[dates.length - 1] || '', sum, gs: stockGroupSums(state) });
  ops.push(kvSetStmt(C, 'STOCK_GROUPS', JSON.stringify(state)), kvSetStmt(C, 'STOCK_HISTORY', JSON.stringify(hist)));
  await batch(C, ops);
  await sysLogTo(C, me.name, 'สินค้าค้างสต็อก', 'อัปโหลดไฟล์ Excel', (file || '(ไม่ระบุชื่อ)') + ' · สาขา ' + branch + ' · อัปเดต ' + changed.length + ' หมวด (' + changed.join(',') + ') · เพิ่ม ' + tot.add + ' เปลี่ยน ' + tot.chg + ' ลบ ' + tot.del + ' เหมือนเดิม ' + tot.same + ' แถว' + (same.length ? ' · ไม่เปลี่ยน ' + same.length + ' หมวด' : ''));
  return { ok: true, changed, same, diff, tot };
};

API.stockRestore = async (C, token, g) => {
  const me = await stockEditAuth(C, token);
  g = str(g).toUpperCase();
  const state = await stockState(C), s = state[g];
  if (!s || !s.prev) throw new Error('หมวดนี้ไม่มีฉบับก่อนหน้า');
  const [curJson, prevJson, adj] = await Promise.all([stockGroupJson(C, g, 0), stockGroupJson(C, g, 1), stockAdjLoad(C)]);
  if (!prevJson) throw new Error('ข้อมูลฉบับก่อนหน้าไม่ครบ กรุณาติดต่อผู้ดูแล');
  state[g] = { cur: s.prev, prev: s.cur };
  await stockRebuildSummaries(C, state, adj, { cur: new Map([[g, stockParseRows(prevJson, g)]]), prev: new Map([[g, stockParseRows(curJson || '[]', g)]]) });
  const ts = now(), dates = Object.keys(state).map(k => state[k].cur && state[k].cur.rep).filter(Boolean).sort();
  const hist = stockPushHistory(await stateJson(C, 'STOCK_HISTORY', []), { ts, who: me.name, file: 'กู้คืนฉบับก่อนหน้า ' + g, to: dates[dates.length - 1] || '', sum: stockTotal(state), gs: stockGroupSums(state) });
  await batch(C, [stmt(C, 'UPDATE stock_grp SET ver=2 WHERE g=? AND ver=0', g), stmt(C, 'UPDATE stock_grp SET ver=0 WHERE g=? AND ver=1', g), stmt(C, 'UPDATE stock_grp SET ver=1 WHERE g=? AND ver=2', g),
    kvSetStmt(C, 'STOCK_GROUPS', JSON.stringify(state)), kvSetStmt(C, 'STOCK_HISTORY', JSON.stringify(hist))]);
  await sysLogTo(C, me.name, 'สินค้าค้างสต็อก', 'สลับไปใช้ฉบับก่อนหน้า', g + ' · ข้อมูลวันที่ ' + (state[g].cur.rep || '-'));
  return { ok: true, groups: state };
};

async function stockEditAuth(C, token) {
  const me = await auth(C, token);
  if (!me.perms.stock) throw new Error('คุณไม่มีสิทธิ์ใช้งานส่วนนี้');
  if (me.role !== 'admin' && !me.perms.stock_edit) throw new Error('บัญชีนี้มีสิทธิ์ดูข้อมูลอย่างเดียว ไม่สามารถแก้ไขได้');
  return me;
}

async function stockVerifyPw(C, me, password) {
  password = passArg(password);
  if (!password) throw new Error('กรุณาใส่รหัสผ่านเพื่อยืนยัน');
  const lockKey = 'fail:' + me.user, fails = await failCount(C, lockKey);
  if (fails >= MAX_FAIL) throw new Error('ใส่รหัสผิดหลายครั้ง กรุณารอ 5 นาทีแล้วลองใหม่');
  const u = await getUser(C, me.user);
  if (!u) throw new Error('SESSION_EXPIRED');
  if (u.hash !== await hashPw(u.salt, password) && !(await checkRecovery(C, password))) { await failBump(C, lockKey, fails + 1); throw new Error('รหัสผ่านไม่ถูกต้อง'); }
  if (fails > 0) await failClear(C, lockKey);
}

API.stockClear = async (C, token, password, scope) => {
  const me = await auth(C, token, true);
  await stockVerifyPw(C, me, password);
  scope = scope || {};
  const mode = str(scope.mode), state = await stockState(C), ts = now(), ops = [], changed = [], lost = await stockAdjLoad(C);
  const replacements = { cur: new Map(), prev: new Map() };
  const shiftGroup = (g, rows, clearedBr) => {
    const old = state[g], oc = old && old.cur, oldBr = (oc && oc.br) || {}, br = {};
    rows.forEach(r => { const b = br[r[3]] || (br[r[3]] = { count: 0, rep: '' }); if (r[4] > 0) b.count++; if (r[14] > b.rep) b.rep = r[14]; });
    if (clearedBr && !br[clearedBr]) br[clearedBr] = { count: 0, rep: '' };
    Object.keys(br).forEach(k => {
      const src = k === clearedBr ? { ts, who: me.name, file: 'ล้างข้อมูล' } : (oldBr[k] || (oc ? { ts: oc.ts, who: oc.who, file: oc.file } : { ts, who: me.name, file: 'ล้างข้อมูล' }));
      br[k].ts = src.ts; br[k].who = src.who; br[k].file = src.file;
    });
    const reps = rows.map(r => r[14]).filter(Boolean).sort();
    ops.push(stmt(C, 'DELETE FROM stock_grp WHERE g=? AND ver=1', g), stmt(C, 'UPDATE stock_grp SET ver=1 WHERE g=? AND ver=0', g), ...stockInsertOps(C, g, 0, JSON.stringify(rows)));
    state[g] = { cur: { ts, who: me.name, file: 'ล้างข้อมูล', rep: reps[reps.length - 1] || '', title: '', count: rows.filter(r => r[4] > 0).length, sum: stockSummary(rows, lost), br }, prev: oc ? Object.assign({}, oc, { sum: stockSummary(replacements.prev.get(g) || []) }) : null };
    replacements.cur.set(g, rows);
    changed.push(g);
  };
  let desc;
  if (mode === 'all') {
    Object.keys(state).forEach(g => changed.push(g));
    await batch(C, [stmt(C, 'DELETE FROM stock_grp'), kvSetStmt(C, 'STOCK_GROUPS', '{}'), kvSetStmt(C, 'STOCK_HISTORY', '[]')]);
    await sysLogTo(C, me.name, 'สินค้าค้างสต็อก', 'ล้างข้อมูล', 'ล้างข้อมูลทั้งหมด (' + changed.length + ' หมวด) · ลบฉบับก่อนหน้าและประวัติแนวโน้มด้วย');
    return { ok: true, changed };
  }
  if (mode === 'group') {
    const g = str(scope.g).toUpperCase();
    if (!state[g]) throw new Error('ไม่พบหมวด ' + g);
    const rows = stockParseRows((await stockGroupJson(C, g, 0)) || '[]', 'หมวด ' + g);
    if (rows.length) { replacements.prev.set(g, rows); shiftGroup(g, []); }
    desc = 'ล้างทั้งหมวด ' + g;
  } else if (mode === 'branch') {
    const branch = str(scope.branch).replace(/\s+/g, ' ').trim().slice(0, 20);
    if (!branch) throw new Error('กรุณาเลือกสาขาที่จะล้าง');
    const bk = stockBrKey(branch), current = await stockRowsByGroup(C, 0);
    for (const g of Object.keys(state)) {
      if (!state[g] || !state[g].cur) continue;
      const rows = current.get(g) || [];
      if (!current.has(g) && state[g].cur.count > 0) throw new Error('ข้อมูลสต็อกไม่ครบ หมวด ' + g);
      const keep = rows.filter(r => stockBrKey(r[3]) !== bk);
      if (keep.length !== rows.length) { replacements.prev.set(g, rows); shiftGroup(g, keep, branch); }
    }
    desc = 'ล้างทั้งสาขา ' + branch;
  } else throw new Error('เลือกสิ่งที่จะล้างไม่ถูกต้อง');
  if (!changed.length) return { ok: true, changed };
  if (Object.keys(lost).some(k => Object.keys(lost[k] || {}).length)) await stockRebuildSummaries(C, state, lost, replacements);
  const dates = Object.keys(state).map(g => state[g].cur && state[g].cur.rep).filter(Boolean).sort();
  const hist = stockPushHistory(await stateJson(C, 'STOCK_HISTORY', []), { ts, who: me.name, file: 'ล้างข้อมูล · ' + desc, to: dates[dates.length - 1] || '', sum: stockTotal(state), gs: stockGroupSums(state) });
  ops.push(kvSetStmt(C, 'STOCK_GROUPS', JSON.stringify(state)), kvSetStmt(C, 'STOCK_HISTORY', JSON.stringify(hist)));
  await batch(C, ops);
  await sysLogTo(C, me.name, 'สินค้าค้างสต็อก', 'ล้างข้อมูล', desc + ' · ' + changed.length + ' หมวด (' + changed.join(',') + ') · เก็บเป็นฉบับก่อนหน้า');
  return { ok: true, changed };
};

API.stockSetNames = async (C, token, names) => {
  const me = await stockEditAuth(C, token), out = {};
  names = (names && typeof names === 'object') ? names : {};
  Object.keys(names).forEach(k => {
    if (k === '__BR_CFG__') { out[k] = str(names[k]).slice(0, 20000); return; }
    const parts = str(k).split(':');
    if (parts.length === 2) {
      const bk = stockBrKey(parts[0]), code = str(parts[1]).toUpperCase(), t = str(names[k]).replace(/\s+/g, ' ').trim();
      if (bk && /^[A-Z0-9_-]{1,12}$/.test(code) && t) out[bk + ':' + code] = t.slice(0, 40);
      return;
    }
    const code = str(k).toUpperCase(), t = str(names[k]).replace(/\s+/g, ' ').trim();
    if (/^[A-Z0-9_-]{1,12}$/.test(code) && t) out[code] = t.slice(0, 40);
  });
  await kvSet(C, 'STOCK_NAMES', JSON.stringify(out));
  await sysLogTo(C, me.name, 'สินค้าค้างสต็อก', 'ตั้งค่าหมวดและสาขา', Object.keys(out).length + ' รายการ');
  return out;
};

API.stockGroupAdd = async (C, token, g, name, branch) => {
  const me = await stockEditAuth(C, token);
  const code = str(g).trim().toUpperCase(), br = str(branch).replace(/\s+/g, ' ').trim().slice(0, 20), bk = stockBrKey(br);
  if (!STOCK_GROUP_RE.test(code)) throw new Error('รหัสหมวดต้องเป็นตัวอักษรภาษาอังกฤษหรือตัวเลข 1–12 ตัว เช่น G01');
  const [state, names] = await Promise.all([stockState(C), stockNames(C)]);
  const label = str(name).replace(/\s+/g, ' ').trim().slice(0, 40);
  if (label) {
    if (bk) names[bk + ':' + code] = label;
    if (!names[code]) names[code] = label;
  }
  const ts = now(), ops = [kvSetStmt(C, 'STOCK_NAMES', JSON.stringify(names))];
  if (!state[code]) {
    const brMap = {};
    if (br) brMap[br] = { count: 0, rep: '', ts, who: me.name, file: 'ตั้งค่าหมวด' };
    state[code] = { cur: { ts, who: me.name, file: 'เพิ่มหมวดใหม่', rep: '', title: '', count: 0, sum: stockSummary([]), br: brMap }, prev: null };
    ops.push(...stockInsertOps(C, code, 0, '[]'), kvSetStmt(C, 'STOCK_GROUPS', JSON.stringify(state)));
  } else if (br && state[code].cur) {
    if (!state[code].cur.br) state[code].cur.br = {};
    if (!state[code].cur.br[br]) state[code].cur.br[br] = { count: 0, rep: '', ts, who: me.name, file: 'ตั้งค่าหมวด' };
    ops.push(kvSetStmt(C, 'STOCK_GROUPS', JSON.stringify(state)));
  }
  await batch(C, ops);
  await sysLogTo(C, me.name, 'สินค้าค้างสต็อก', 'เพิ่มหมวดสินค้า', code + (br ? ' · สาขา ' + br : '') + (label ? ' · ' + label : ''));
  return { ok: true, g: code, names, groups: state };
};

API.stockGroupDelete = async (C, token, g, branch) => {
  const me = await stockEditAuth(C, token);
  const code = str(g).trim().toUpperCase(), br = str(branch).replace(/\s+/g, ' ').trim().slice(0, 20), bk = stockBrKey(br);
  if (!code) throw new Error('กรุณาระบุหมวดที่จะลบ');
  const [state, names, lost] = await Promise.all([stockState(C), stockNames(C), stockAdjLoad(C)]);
  const ts = now(), ops = [];
  const replacements = { cur: new Map() };
  if (bk && state[code] && state[code].cur) {
    const rows = stockParseRows((await stockGroupJson(C, code, 0)) || '[]', 'หมวด ' + code);
    const keep = Array.isArray(rows) ? rows.filter(r => stockBrKey(r[3]) !== bk) : [];
    if (state[code].cur.br) {
      Object.keys(state[code].cur.br).forEach(k => { if (stockBrKey(k) === bk) delete state[code].cur.br[k]; });
    }
    delete names[bk + ':' + code];
    const remBrs = state[code].cur.br ? Object.keys(state[code].cur.br) : [];
    if (!keep.length && !remBrs.length) {
      delete state[code];
      delete names[code];
      ops.push(stmt(C, 'DELETE FROM stock_grp WHERE g=?', code));
    } else {
      state[code].cur.count = keep.filter(r => r[4] > 0).length;
      state[code].cur.sum = stockSummary(keep, lost);
      replacements.cur.set(code, keep);
      ops.push(stmt(C, 'DELETE FROM stock_grp WHERE g=? AND ver=0', code), ...stockInsertOps(C, code, 0, JSON.stringify(keep)));
    }
  } else {
    delete state[code];
    delete names[code];
    Object.keys(names).forEach(k => { if (k.endsWith(':' + code)) delete names[k]; });
    ops.push(stmt(C, 'DELETE FROM stock_grp WHERE g=?', code));
  }
  if (Object.keys(lost).some(k => Object.keys(lost[k] || {}).length)) await stockRebuildSummaries(C, state, lost, replacements);
  const dates = Object.keys(state).map(k => state[k].cur && state[k].cur.rep).filter(Boolean).sort();
  const hist = stockPushHistory(await stateJson(C, 'STOCK_HISTORY', []), { ts, who: me.name, file: 'ลบหมวด ' + code + (br ? ' สาขา ' + br : ''), to: dates[dates.length - 1] || '', sum: stockTotal(state), gs: stockGroupSums(state) });
  ops.push(
    kvSetStmt(C, 'STOCK_GROUPS', JSON.stringify(state)),
    kvSetStmt(C, 'STOCK_NAMES', JSON.stringify(names)),
    kvSetStmt(C, 'STOCK_HISTORY', JSON.stringify(hist))
  );
  await batch(C, ops);
  await sysLogTo(C, me.name, 'สินค้าค้างสต็อก', 'ลบหมวดสินค้า', code + (br ? ' · สาขา ' + br : ''));
  return { ok: true, g: code, names, groups: state };
};

API.stockHistoryDelete = async (C, token, payload) => {
  const me = await stockEditAuth(C, token);
  payload = payload || {};
  const mode = str(payload.mode);
  if (mode === 'all_hist') {
    await kvSet(C, 'STOCK_HISTORY', '[]');
    await sysLogTo(C, me.name, 'สินค้าค้างสต็อก', 'ลบประวัติสถิติแนวโน้ม', 'ล้างประวัติสถิติแนวโน้มทั้งหมด');
    return { ok: true };
  }
  if (mode === 'hist_item') {
    const day = str(payload.dayKey), ts = Number(payload.ts) || 0;
    const raw = (await stateJson(C, 'STOCK_HISTORY', [])) || [];
    const next = raw.filter(x => {
      if (!x) return false;
      if (day && stockDayKey(x.ts) === day) return false;
      if (ts && Number(x.ts) === ts) return false;
      return true;
    });
    await kvSet(C, 'STOCK_HISTORY', JSON.stringify(next));
    await sysLogTo(C, me.name, 'สินค้าค้างสต็อก', 'ลบประวัติสถิติแนวโน้ม', 'ลบข้อมูลวันที่ ' + (day || ts));
    return { ok: true, count: next.length };
  }
  if (mode === 'prev_group') {
    const gs = Array.isArray(payload.groups) ? payload.groups.map(g => str(g).trim().toUpperCase()).filter(Boolean) : [];
    const state = await stockState(C), ops = [];
    const targets = gs.length ? gs : Object.keys(state);
    let n = 0;
    targets.forEach(g => {
      if (state[g] && state[g].prev) {
        state[g].prev = null;
        ops.push(stmt(C, 'DELETE FROM stock_grp WHERE g=? AND ver=1', g));
        n++;
      }
    });
    if (ops.length) {
      ops.push(kvSetStmt(C, 'STOCK_GROUPS', JSON.stringify(state)));
      await batch(C, ops);
      await sysLogTo(C, me.name, 'สินค้าค้างสต็อก', 'ลบข้อมูลย้อนหลังฉบับก่อนหน้า', n + ' หมวด (' + targets.slice(0, 10).join(',') + ')');
    }
    return { ok: true, removed: n };
  }
  throw new Error('คำสั่งลบประวัติไม่ถูกต้อง');
};

async function stockHardLoad(C) {
  const raw = (await stateJson(C, 'STOCK_HARD', {})) || {}, out = Object.create(null);
  Object.keys(raw).forEach(k => { const e = raw[k]; if (k && e && typeof e === 'object') out[k] = { code: str(e.code), ts: e.ts || 0, who: str(e.who), note: str(e.note).slice(0, 100) }; });
  return out;
}

API.stockHardSet = async (C, token, codes, on, note) => {
  const me = await stockEditAuth(C, token), list = (Array.isArray(codes) ? codes : [codes]).map(x => str(x).trim().slice(0, 40)).filter(Boolean).slice(0, 500);
  if (!list.length) throw new Error('ไม่พบรหัสสินค้า');
  const hard = await stockHardLoad(C), ts = now(), nt = str(note).replace(/\s+/g, ' ').slice(0, 100);
  let n = 0;
  list.forEach(code => {
    const k = stockCodeKey(code); if (!k) return;
    if (on) { if (!hard[k] || hard[k].note !== nt) n++; hard[k] = { code, ts, who: me.name, note: nt }; }
    else if (hard[k]) { delete hard[k]; n++; }
  });
  await kvSet(C, 'STOCK_HARD', JSON.stringify(hard));
  if (n) await sysLogTo(C, me.name, 'สินค้าค้างสต็อก', on ? 'ติดแท็กสินค้าขายยาก' : 'ยกเลิกแท็กสินค้าขายยาก', n + ' รายการ (' + list.slice(0, 10).join(',') + (list.length > 10 ? ',…' : '') + ')' + (nt ? ' · ' + nt : ''));
  return hard;
};

async function stockResumState(C, lost) {
  const state = await stockState(C);
  return stockRebuildSummaries(C, state, lost);
}

function stockAdjItems(items) {                                   // items = [{ code, qty }]
  if (!Array.isArray(items)) throw new Error('รูปแบบข้อมูลไม่ถูกต้อง (ลองรีเฟรชหน้าเว็บแล้วทำใหม่)');
  return items.map(x => {
    const code = str(x && x.code).trim().slice(0, 40), qty = stockNum(x && x.qty, 2);
    if (!code) return null;
    if (!(qty > 0) || qty > 1000000) throw new Error('จำนวนต้องมากกว่า 0 (บาร์ ' + code + ')');
    return { code, qty };
  }).filter(item => item !== null);
}

function stockAdjApi(kind, meta) {                                // meta (ไม่บังคับ) = { label, kv } สำหรับแท็กที่สร้างเอง
  const label = meta ? meta.label : STOCK_ADJ_LABEL[kind], kv = meta ? meta.kv : STOCK_ADJ_KV[kind];
  return {
    add: async (C, token, items, note, br) => {
      const me = await stockEditAuth(C, token), list = stockAdjItems(items);
      if (!list.length) throw new Error('กรุณากรอกบาร์โค้ดและจำนวน');
      if (list.length > 300) throw new Error('เพิ่มได้ครั้งละไม่เกิน 300 รายการ');
      const adj = await stockAdjLoad(C), cur = adj[kind], ts = now(), nt = str(note).replace(/\s+/g, ' ').slice(0, 100), bn = str(br).replace(/\s+/g, ' ').trim().slice(0, 20), by = new Map();
      (await stockLoadRows(C, 0)).forEach(r => { const k = stockCodeKey(r[1]); if (k && !by.has(k)) by.set(k, r); });   // หาชื่อจากข้อมูลปัจจุบัน (ถ้าไม่พบก็เก็บไว้ก่อน — ถ้าภายหลังมีในไฟล์ก็หักให้)
      let added = 0, merged = 0, dup = 0, pcs = 0; const notFound = [];
      for (const it of list) {
        const k = stockAdjKey(it.code, bn), r = by.get(stockCodeKey(it.code)), e = cur[k];
        if (e) {
          if (e.qty === null || e.qty === undefined) { dup++; continue; }     // รายการเก่าที่หักทั้งบาร์อยู่แล้ว
          e.qty = stockNum(Number(e.qty) + it.qty, 2); e.ts = ts; e.who = me.name; if (nt) e.note = nt; if (!e.name && r) e.name = str(r[2]).slice(0, 200);
          merged++; pcs += it.qty; continue;
        }
        if (Object.keys(cur).length >= STOCK_LOST_MAX) throw new Error('รายการ' + label + 'เต็ม (' + STOCK_LOST_MAX + ' รายการ) กรุณายกเลิกรายการที่ไม่ใช้แล้วก่อน');
        cur[k] = { code: it.code, br: bn, qty: it.qty, name: r ? str(r[2]).slice(0, 200) : '', g: r ? str(r[0]) : '', note: nt, ts, who: me.name };
        added++; pcs += it.qty; if (!r) notFound.push(it.code);
      }
      if (!added && !merged) return { ok: true, added, merged, dup, pcs, notFound };
      const state = await stockResumState(C, adj);
      await batch(C, [kvSetStmt(C, kv, JSON.stringify(cur)), kvSetStmt(C, 'STOCK_GROUPS', JSON.stringify(state))]);
      await sysLogTo(C, me.name, 'สินค้าค้างสต็อก', 'เพิ่ม' + label, (added + merged) + ' รายการ ' + stockNum(pcs, 2) + ' ชิ้น' + (bn ? ' · สาขา ' + bn : '') + ' (' + list.slice(0, 10).map(x => x.code + 'x' + x.qty).join(',') + (list.length > 10 ? ',…' : '') + ')' + (nt ? ' · ' + nt : ''));
      return { ok: true, added, merged, dup, pcs, notFound };
    },
    remove: async (C, token, keys) => {                           // keys = คีย์รายการ (k จาก stockGet) · รับรหัสบาร์ล้วนได้ (= รายการแบบทุกสาขา)
      const me = await stockEditAuth(C, token), list = (Array.isArray(keys) ? keys : [keys]).map(x => str(x)).filter(Boolean);
      if (!list.length) throw new Error('ไม่พบรายการที่จะยกเลิก');
      const adj = await stockAdjLoad(C), cur = adj[kind], gone = [];
      list.forEach(x => {
        const k = cur[x] ? x : stockAdjKey(x, ''), e = cur[k];
        if (e) { gone.push(str(e.code) + (e.br ? '@' + e.br : '') + (e.qty === null || e.qty === undefined ? '' : ' x' + e.qty)); delete cur[k]; }
      });
      if (!gone.length) return { ok: true, removed: 0 };
      const state = await stockResumState(C, adj);
      await batch(C, [kvSetStmt(C, kv, JSON.stringify(cur)), kvSetStmt(C, 'STOCK_GROUPS', JSON.stringify(state))]);
      await sysLogTo(C, me.name, 'สินค้าค้างสต็อก', 'ยกเลิก' + label, gone.length + ' รายการ (' + gone.slice(0, 10).join(',') + (gone.length > 10 ? ',…' : '') + ')');
      return { ok: true, removed: gone.length };
    }
  };
}

const stockLostApi = stockAdjApi('lost'), stockExpApi = stockAdjApi('exp'), stockPendApi = stockAdjApi('pend'), stockWasteApi = stockAdjApi('waste');

API.stockLostAdd = stockLostApi.add;

API.stockLostRemove = stockLostApi.remove;

API.stockExpiredAdd = stockExpApi.add;

API.stockExpiredRemove = stockExpApi.remove;

API.stockPendingAdd = stockPendApi.add;

API.stockPendingRemove = stockPendApi.remove;

API.stockWasteAdd = stockWasteApi.add;

API.stockWasteRemove = stockWasteApi.remove;

API.stockAdjNote = async (C, token, kind, key, note) => {
  const me = await stockEditAuth(C, token);
  let kvName = STOCK_ADJ_KV[kind], kLabel = STOCK_ADJ_LABEL[kind];
  if (!kvName && /^c_/.test(str(kind))) { const defs = await stockCtagDefs(C), d = defs[str(kind).slice(2)]; if (d && d.mode === 'deduct') { kvName = 'STOCK_CT_' + str(kind).slice(2); kLabel = d.t; } }
  if (!kvName) throw new Error('ประเภทไม่ถูกต้อง');
  const adj = await stockAdjLoad(C), cur = adj[kind], k = str(key), e = cur[k];
  if (!e) throw new Error('ไม่พบรายการนี้ (อาจถูกยกเลิกไปแล้ว) กรุณารีเฟรช');
  e.note = str(note).replace(/\s+/g, ' ').slice(0, 100);
  await kvSet(C, kvName, JSON.stringify(cur));
  await sysLogTo(C, me.name, 'สินค้าค้างสต็อก', 'แก้หมายเหตุ' + kLabel, str(e.code) + (e.br ? '@' + e.br : '') + ' · ' + (e.note || '(ลบหมายเหตุ)'));
  return { ok: true };
};

async function stockCtagNeed(C, id, mode) {
  id = str(id);
  const defs = await stockCtagDefs(C), d = defs[id];
  if (!d) throw new Error('ไม่พบแท็กนี้ (อาจถูกลบไปแล้ว) กรุณารีเฟรช');
  if (mode && d.mode !== mode) throw new Error('แท็ก "' + d.t + '" เป็นโหมด' + (d.mode === 'deduct' ? 'หักออก' : 'แท็กเฉยๆ'));
  return { id, def: d, defs };
}

API.stockCtagCreate = async (C, token, name, mode) => {
  const me = await stockEditAuth(C, token), nm = str(name).replace(/\s+/g, ' ').trim().slice(0, 30), md = str(mode) === 'deduct' ? 'deduct' : 'tag';
  if (!nm) throw new Error('กรุณาใส่ชื่อแท็ก');
  const defs = await stockCtagDefs(C), reserved = ['ขายยาก', 'ของหาย', 'หมดอายุ', 'รอปรับ', 'ของเสีย', 'คงเหลือ 0', 'ติดลบ'];
  if (reserved.indexOf(nm) >= 0 || Object.keys(defs).some(k => defs[k].t === nm)) throw new Error('มีแท็กชื่อนี้อยู่แล้ว');
  if (Object.keys(defs).length >= STOCK_CT_MAX) throw new Error('สร้างแท็กได้ไม่เกิน ' + STOCK_CT_MAX + ' แท็ก');
  let id = '';
  do { id = ('t' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).slice(0, 14); } while (defs[id]);
  defs[id] = { t: nm, mode: md, ts: now(), who: me.name };
  await kvSet(C, 'STOCK_CTAGS', JSON.stringify(defs));
  await sysLogTo(C, me.name, 'สินค้าค้างสต็อก', 'สร้างแท็ก', nm + ' (' + (md === 'deduct' ? 'หักออก' : 'แท็กเฉยๆ') + ')');
  return { ok: true, id };
};

API.stockCtagDelete = async (C, token, id) => {
  const me = await stockEditAuth(C, token), n = await stockCtagNeed(C, id), kind = 'c_' + n.id;
  const adj = await stockAdjLoad(C), freed = Object.keys(adj[kind] || {}).length;
  delete adj[kind];
  const defs = n.defs; delete defs[n.id];
  const map = (await stateJson(C, 'STOCK_CTMAP', {})) || {}; delete map[n.id];
  const ops = [kvSetStmt(C, 'STOCK_CTAGS', JSON.stringify(defs)), kvSetStmt(C, 'STOCK_CTMAP', JSON.stringify(map)), stmt(C, 'DELETE FROM kv WHERE k=?', 'STOCK_CT_' + n.id)];
  if (n.def.mode === 'deduct' && freed) { const state = await stockResumState(C, adj); ops.push(kvSetStmt(C, 'STOCK_GROUPS', JSON.stringify(state))); }
  await batch(C, ops);
  await sysLogTo(C, me.name, 'สินค้าค้างสต็อก', 'ลบแท็ก', n.def.t + (freed ? ' · คืนยอดที่หักไว้ ' + freed + ' รายการ' : ''));
  return { ok: true, freed };
};

API.stockCtagAssign = async (C, token, id, items, on) => {
  const me = await stockEditAuth(C, token), n = await stockCtagNeed(C, id, 'tag');
  if (!Array.isArray(items)) throw new Error('รูปแบบข้อมูลไม่ถูกต้อง');
  if (items.length > 5000) throw new Error('ทำได้ครั้งละไม่เกิน 5,000 รายการ');
  const map = (await stateJson(C, 'STOCK_CTMAP', {})) || {}, m = map[n.id] || (map[n.id] = {});
  let c = 0;
  items.forEach(it => {
    const ck = stockCodeKey(it && it.code); if (!ck) return;
    const k = ck + '|' + stockBrKey(it.br);
    if (on) { if (!m[k]) { m[k] = 1; c++; } } else if (m[k]) { delete m[k]; c++; }
  });
  if (!c) return { ok: true, changed: 0 };
  await kvSet(C, 'STOCK_CTMAP', JSON.stringify(map));
  await sysLogTo(C, me.name, 'สินค้าค้างสต็อก', (on ? 'ติดแท็ก ' : 'ถอดแท็ก ') + n.def.t, c + ' รายการ');
  return { ok: true, changed: c };
};

API.stockCtagAdd = async (C, token, items, note, br, id) => {
  await stockEditAuth(C, token);
  const n = await stockCtagNeed(C, id, 'deduct');
  return stockAdjApi('c_' + n.id, stockCtagMeta(n.id, n.def)).add(C, token, items, note, br);
};

API.stockCtagRemove = async (C, token, keys, id) => {
  await stockEditAuth(C, token);
  const n = await stockCtagNeed(C, id, 'deduct');
  return stockAdjApi('c_' + n.id, stockCtagMeta(n.id, n.def)).remove(C, token, keys);
};

const STOCK_NOTES_MAX = 100;

async function stockNotesLoad(C) {
  const raw = await kvJson(C, 'STOCK_NOTES', []);
  if (!Array.isArray(raw)) return [];
  const out = [];
  raw.forEach(item => {
    if (!item || typeof item !== 'object') return;
    const id = str(item.id).slice(0, 40), text = str(item.text).replace(/\r\n/g, '\n').trim().slice(0, 500);
    if (!id || !text) return;
    const ts = Number(item.ts) || 0, updatedTs = Number(item.updatedTs) || ts;
    out.push({ id, text, who: str(item.who).slice(0, 80), user: str(item.user).slice(0, 50), ts, updatedTs });
  });
  return out.sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, STOCK_NOTES_MAX);
}

API.stockNotesGet = async (C, token) => {
  await authPerm(C, token, 'stock');
  return stockNotesLoad(C);
};

API.stockNoteSave = async (C, token, payload) => {
  const me = await authPerm(C, token, 'stock');
  payload = payload && typeof payload === 'object' ? payload : {};
  const text = str(payload.text).replace(/\r\n/g, '\n').trim().slice(0, 500);
  if (!text) throw new Error('กรุณาพิมพ์ข้อความก่อนบันทึก');
  const id = str(payload.id).slice(0, 40), ts = now(), list = await stockNotesLoad(C);
  const canManageAll = me.role === 'admin' || !!me.perms.stock_edit;
  let edited = false;
  if (id) {
    const old = list.find(x => x.id === id);
    if (!old) throw new Error('ไม่พบข้อความนี้ (อาจถูกลบไปแล้ว) กรุณารีเฟรช');
    if (old.user && old.user !== me.user && !canManageAll) throw new Error('แก้ไขได้เฉพาะข้อความที่คุณฝากไว้เอง');
    old.text = text;
    old.updatedTs = ts;
    old.who = me.name;
    edited = true;
  } else {
    let nid = '';
    do { nid = 'n_' + ts.toString(36) + '_' + uuid().replace(/-/g, '').slice(0, 6); } while (list.some(x => x.id === nid));
    list.unshift({ id: nid, text, who: me.name, user: me.user, ts, updatedTs: ts });
    if (list.length > STOCK_NOTES_MAX) list.length = STOCK_NOTES_MAX;
  }
  await kvSet(C, 'STOCK_NOTES', JSON.stringify(list));
  await sysLogTo(C, me.name, 'สินค้าค้างสต็อก', edited ? 'แก้ไขข้อความ Notes' : 'ฝากข้อความ Notes', text.slice(0, 120));
  return { ok: true, notes: list };
};

API.stockNoteDelete = async (C, token, id) => {
  const me = await authPerm(C, token, 'stock');
  const targetId = str(id), list = await stockNotesLoad(C);
  const canManageAll = me.role === 'admin' || !!me.perms.stock_edit;
  if (targetId === '__all__') {
    if (!canManageAll) throw new Error('เฉพาะ Admin หรือผู้มีสิทธิ์แก้ไขจึงจะล้างข้อความทั้งหมดได้');
    if (!list.length) return { ok: true, notes: [] };
    await kvSet(C, 'STOCK_NOTES', '[]');
    await sysLogTo(C, me.name, 'สินค้าค้างสต็อก', 'ล้างข้อความ Notes ทั้งหมด', list.length + ' ข้อความ');
    return { ok: true, notes: [] };
  }
  const target = list.find(x => x.id === targetId);
  if (!target) return { ok: true, notes: list };
  if (target.user && target.user !== me.user && !canManageAll) throw new Error('ลบได้เฉพาะข้อความที่คุณฝากไว้เอง');
  const next = list.filter(x => x.id !== targetId);
  await kvSet(C, 'STOCK_NOTES', JSON.stringify(next));
  await sysLogTo(C, me.name, 'สินค้าค้างสต็อก', 'ลบข้อความ Notes', target.text.slice(0, 120));
  return { ok: true, notes: next };
};

export { STOCK_NOTES_MAX, stockNotesLoad, STOCK_MAX_ROWS, STOCK_HISTORY_MAX, STOCK_ST, STOCK_GROUP_RE, stockCodeKey, STOCK_LOST_MAX, STOCK_ADJ_KV, STOCK_ADJ_LABEL, stockAdjKey, STOCK_CT_MAX, STOCK_CT_ID_RE, stockCtagDefs, stockCtagMeta, stockAdjLoad, stockApply, stockBrKey, STOCK_DATE_CACHE, stockDate, stockNum, stockOpt, stockCleanRow, stockDedupe, stockSummary, stockGroupSums, stockTotal, stockSideSummaries, stockRebuildSummaries, stockInsertOps, stockParseRows, stockRowsByGroup, stockLoadRows, stockGroupJson, stockState, stockNames, thaiDayIso, stockDayKey, stockDailyHistory, stockPushHistory, stockEditAuth, stockVerifyPw, stockHardLoad, stockResumState, stockAdjItems, stockAdjApi, stockLostApi, stockExpApi, stockPendApi, stockWasteApi, stockCtagNeed };
