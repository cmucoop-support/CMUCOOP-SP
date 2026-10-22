import { ACT_GROUPS, CARD_KEYS, CARD_TITLE_MAX, CUSTOM_KEY, LEGACY_LINKS, LEGACY_ORDER, LOG_DAYS, MAX_CUSTOM_CARDS, USE_AREAS } from '../core/config.js';
import { all, batch, kvGet, kvJson, kvSet, kvSetStmt, now, one, run, str, uuid } from '../core/database.js';
import { allUsers, auth, saveUserStmt } from './auth.js';
import { API } from '../core/registry.js';
import { actGroupOf, sysLog, sysLogTo } from '../core/logging.js';

function normCardOrder(list, extra) {
  const out = [], keys = CARD_KEYS.concat(extra || []);
  (Array.isArray(list) ? list : []).forEach(k => { k = str(k); if (keys.indexOf(k) >= 0 && out.indexOf(k) < 0) out.push(k); });
  keys.forEach(k => { if (out.indexOf(k) < 0) out.push(k); });
  return out;
}

const linkMigratedCache = new WeakSet();

async function migrateLinks(C) {
  if (linkMigratedCache.has(C.env.DB)) return;
  if (await kvGet(C, 'LINK_MIGRATED', '')) { linkMigratedCache.add(C.env.DB); return; }
  const rawL = (await kvJson(C, 'CARD_LINKS', {})) || {}, rawT = (await kvJson(C, 'CARD_TITLES', {})) || {};
  const existing = Array.isArray(await kvJson(C, 'CUSTOM_CARDS', [])) ? await kvJson(C, 'CUSTOM_CARDS', []) : [];
  const seeded = [], map = {};
  LEGACY_LINKS.forEach(L => {
    const u = str(rawL[L.old]) || L.u;
    if (!u || !validCardLink(u)) return;                       // การ์ดที่ไม่เคยมีลิงก์ (เช่น รายการสินทรัพย์) ไม่ต้องย้าย
    seeded.push({ k: L.k, t: (str(rawT[L.old]) || L.t).slice(0, CARD_TITLE_MAX), u });
    map[L.old] = L;
  });
  const have = {}; existing.forEach(c => { have[c && c.k] = 1; });
  const stored = await kvJson(C, 'CARD_ORDER', null);
  const order = (Array.isArray(stored) ? stored : LEGACY_ORDER).map(k => (map[k] ? map[k].k : k));
  const ops = [];
  (await allUsers(C)).forEach(u => {                           // สิทธิ์เดิมของการ์ดลิงก์ → สิทธิ์ของการ์ดที่แปลงแล้ว
    if (u.role === 'admin') return;
    const p = Object.assign({}, u.perms || {});
    Object.keys(map).forEach(o => { p[map[o].k] = p[o] !== undefined ? !(p[o] === false || p[o] === 'false') : map[o].def; });
    u.perms = p; ops.push(saveUserStmt(C, u.username, u));
  });
  ops.push(kvSetStmt(C, 'CUSTOM_CARDS', JSON.stringify(seeded.filter(c => !have[c.k]).concat(existing))),
           kvSetStmt(C, 'CARD_ORDER', JSON.stringify(order)), kvSetStmt(C, 'LINK_MIGRATED', '1'));
  await batch(C, ops);
  linkMigratedCache.add(C.env.DB);
}

async function customCards(C) {
  await migrateLinks(C);
  const raw = await kvJson(C, 'CUSTOM_CARDS', []), out = [];
  (Array.isArray(raw) ? raw : []).forEach(c => {
    const k = str(c && c.k), t = str(c && c.t), u = str(c && c.u);
    if (CUSTOM_KEY.test(k) && t && validCardLink(u) && !out.some(x => x.k === k)) out.push({ k, t: t.slice(0, CARD_TITLE_MAX), u });
  });
  return out;
}

const customIds = async C => (await customCards(C)).map(c => c.k);

API.getCardOrder = async (C, token) => { await auth(C, token); return normCardOrder(await kvJson(C, 'CARD_ORDER', null), await customIds(C)); };

API.getCustomCards = async (C, token) => {           // ผู้ใช้ทั่วไปเห็นเฉพาะการ์ดที่ Admin ไม่ได้ปิดสิทธิ์ไว้
  const me = await auth(C, token), list = await customCards(C);
  return me.role === 'admin' ? list : list.filter(c => me.perms[c.k] !== false);
};

API.setCustomCards = async (C, token, list) => {     // รับรายการทั้งหมด (ตามลำดับ) ตอบกลับรายการพร้อมรหัสที่กำหนดให้การ์ดใหม่
  const me = await auth(C, token, true), old = await customCards(C), out = [];
  list = Array.isArray(list) ? list : [];
  if (list.length > MAX_CUSTOM_CARDS) throw new Error('สร้างการ์ดได้ไม่เกิน ' + MAX_CUSTOM_CARDS + ' ใบ');
  list.forEach(c => {
    c = c || {};
    const t = str(c.t).replace(/\s+/g, ' ').trim(), u = str(c.u);
    if (!t) throw new Error('กรุณากรอกชื่อการ์ด');
    if (t.length > CARD_TITLE_MAX) throw new Error('ชื่อการ์ดยาวเกิน ' + CARD_TITLE_MAX + ' ตัวอักษร');
    if (!validCardLink(u)) throw new Error('ลิงก์ของการ์ด "' + t + '" ไม่ถูกต้อง (ต้องขึ้นต้นด้วย http:// หรือ https:// และไม่มีช่องว่าง)');
    let k = str(c.k);
    if (!(old.some(x => x.k === k) && !out.some(x => x.k === k))) { do { k = 'c_' + uuid().replace(/-/g, '').slice(0, 8); } while (out.some(x => x.k === k) || old.some(x => x.k === k)); }
    out.push({ k, t, u });
  });
  if (JSON.stringify(old) === JSON.stringify(out)) return out;
  const nextOrder = normCardOrder(await kvJson(C, 'CARD_ORDER', null), out.map(c => c.k));
  const rawHidden = await kvJson(C, 'CARD_HIDDEN', []);
  const nextHidden = normHiddenCards(rawHidden, out.map(c => c.k));
  const rawNewTabs = await kvJson(C, 'CARD_NEW_TABS', []);
  const nextNewTabs = normCardNewTabs(rawNewTabs, out.map(c => c.k));
  const ops = [kvSetStmt(C, 'CUSTOM_CARDS', JSON.stringify(out)), kvSetStmt(C, 'CARD_ORDER', JSON.stringify(nextOrder))];
  if (JSON.stringify(rawHidden) !== JSON.stringify(nextHidden)) ops.push(kvSetStmt(C, 'CARD_HIDDEN', JSON.stringify(nextHidden)));
  if (JSON.stringify(rawNewTabs) !== JSON.stringify(nextNewTabs)) ops.push(kvSetStmt(C, 'CARD_NEW_TABS', JSON.stringify(nextNewTabs)));
  await batch(C, ops);
  await sysLog(C, me.name, 'จัดการการ์ดลิงก์', out.map(c => c.t).join(' | ') || '(ไม่มี)');
  return out;
};

API.setCardOrder = async (C, token, order) => {
  const me = await auth(C, token, true), ids = await customIds(C);
  const prev = normCardOrder(await kvJson(C, 'CARD_ORDER', null), ids), out = normCardOrder(order, ids);
  if (JSON.stringify(prev) === JSON.stringify(out)) return out;
  await kvSet(C, 'CARD_ORDER', JSON.stringify(out));
  await sysLog(C, me.name, 'จัดลำดับการ์ดเมนูหลัก', out.join(','));
  return out;
};

async function cardTitles(C) {
  const raw = await kvJson(C, 'CARD_TITLES', {}) || {}, out = {};
  CARD_KEYS.forEach(k => { const t = str(raw[k]); if (t) out[k] = t.slice(0, CARD_TITLE_MAX); });
  return out;
}

API.getCardTitles = async (C, token) => { await auth(C, token); return cardTitles(C); };

API.setCardTitles = async (C, token, titles) => {
  const me = await auth(C, token, true), prev = await cardTitles(C), out = {};
  titles = (titles && typeof titles === 'object') ? titles : {};
  CARD_KEYS.forEach(k => {
    const t = str(titles[k]).replace(/\s+/g, ' ').trim();
    if (!t) return;
    if (t.length > CARD_TITLE_MAX) throw new Error('ชื่อการ์ดยาวเกิน ' + CARD_TITLE_MAX + ' ตัวอักษร');
    out[k] = t;
  });
  if (JSON.stringify(prev) === JSON.stringify(out)) return out;
  await kvSet(C, 'CARD_TITLES', JSON.stringify(out));
  await sysLog(C, me.name, 'แก้ไขชื่อการ์ดเมนูหลัก', JSON.stringify(out));
  return out;
};

// Menu visibility is shared presentation configuration, separate from access
// permissions. Keep settings reachable so an administrator can undo hiding.
function normHiddenCards(list, custom = []) {
  const hidden = new Set(Array.isArray(list) ? list : []);
  return CARD_KEYS.concat(custom).filter(k => k !== 'settings' && hidden.has(k));
}

API.getHiddenCards = async (C, token) => {
  await auth(C, token);
  return normHiddenCards(await kvJson(C, 'CARD_HIDDEN', []), await customIds(C));
};

API.setHiddenCards = async (C, token, list) => {
  const me = await auth(C, token, true), ids = await customIds(C);
  if (!Array.isArray(list) || list.length > CARD_KEYS.length + MAX_CUSTOM_CARDS) {
    throw new Error('รายการการ์ดที่ซ่อนไม่ถูกต้อง');
  }
  const allowed = new Set(CARD_KEYS.concat(ids));
  if (list.includes('settings')) throw new Error('การ์ดตั้งค่าต้องแสดงเสมอเพื่อให้กลับมาเปิดการ์ดอื่นได้');
  if (list.some(k => typeof k !== 'string' || !allowed.has(k))) throw new Error('พบการ์ดที่ไม่มีอยู่ กรุณาโหลดการตั้งค่าใหม่');
  const out = normHiddenCards(list, ids);
  const prev = normHiddenCards(await kvJson(C, 'CARD_HIDDEN', []), ids);
  if (JSON.stringify(prev) === JSON.stringify(out)) return out;
  await kvSet(C, 'CARD_HIDDEN', JSON.stringify(out));
  await sysLog(C, me.name, 'ซ่อน/แสดงการ์ดเมนูหลัก', out.length ? out.join(',') : 'แสดงทุกการ์ดตามสิทธิ์');
  return out;
};

// Store tab preferences separately from custom-card data so older clients that
// edit a title or URL cannot erase them. Missing preferences mean the same tab.
function normCardNewTabs(list, custom = []) {
  const newTabs = new Set(Array.isArray(list) ? list : []);
  return CARD_KEYS.concat(custom).filter(k => newTabs.has(k));
}

API.getCardNewTabs = async (C, token) => {
  await auth(C, token);
  return normCardNewTabs(await kvJson(C, 'CARD_NEW_TABS', []), await customIds(C));
};

API.setCardNewTabs = async (C, token, list) => {
  const me = await auth(C, token, true), ids = await customIds(C);
  if (!Array.isArray(list) || list.length > CARD_KEYS.length + MAX_CUSTOM_CARDS) throw new Error('ค่าการเปิดแท็บไม่ถูกต้อง');
  const allowed = new Set(CARD_KEYS.concat(ids));
  if (list.some(k => typeof k !== 'string' || !allowed.has(k))) throw new Error('พบการ์ดที่ไม่มีอยู่ กรุณาโหลดการตั้งค่าใหม่');
  const out = normCardNewTabs(list, ids);
  const prev = normCardNewTabs(await kvJson(C, 'CARD_NEW_TABS', []), ids);
  if (JSON.stringify(prev) === JSON.stringify(out)) return out;
  await kvSet(C, 'CARD_NEW_TABS', JSON.stringify(out));
  await sysLog(C, me.name, 'ตั้งค่าการเปิดแท็บของการ์ด', out.length ? out.join(',') : 'ทุกการ์ดเปิดในแท็บเดิม');
  return out;
};

const validCardLink = u => /^https?:\/\/\S+$/i.test(u) && u.length <= 500;

function normCardSize(o) {
  if (!o || typeof o !== 'object') return null;
  const c = Math.round(Number(o.c)), f = Math.round(Number(o.f)), n = Math.round(Number(o.n === undefined ? 0 : o.n));
  return (c >= 0 && c <= 5 && f >= 0 && f <= 5 && n >= 0 && n <= 4) ? { c, f, n } : null;
}

API.getCardSize = async (C, token) => { const me = await auth(C, token); return normCardSize(await kvJson(C, 'CSZ:' + me.user, null)); };

API.setCardSize = async (C, token, o) => {
  const me = await auth(C, token), v = normCardSize(o);
  if (!v) throw new Error('ค่าขนาดการ์ดไม่ถูกต้อง');
  const prev = normCardSize(await kvJson(C, 'CSZ:' + me.user, null));
  if (prev && prev.c === v.c && prev.f === v.f && prev.n === v.n) return v;
  await kvSet(C, 'CSZ:' + me.user, JSON.stringify(v));
  await sysLog(C, me.name, 'ปรับขนาดการ์ดเมนูหลัก', 'การ์ดระดับ ' + v.c + ' · ตัวอักษรระดับ ' + v.f + ' · ต่อแถว ' + (v.n || 'อัตโนมัติ'));
  return v;
};

const PASSIVE_ACTIONS = new Set(['เปิดการ์ด', 'เลือกหมวด', 'สลับแท็บ']);

API.logUse = async (C, token, area, action, detail) => {
  const act = str(action).slice(0, 40);
  if (PASSIVE_ACTIONS.has(act)) return true;
  const me = await auth(C, token);
  await sysLogTo(C, me.name, USE_AREAS[str(area)] || 'ระบบ', act, str(detail).slice(0, 200));
  return true;
};

API.getActivity = async (C, token, group, limit) => {
  await auth(C, token, true);
  group = str(group) || 'all'; limit = Math.min(Math.max(Number(limit) || 300, 1), 1000);
  const data = await all(C, 'SELECT ts,who,sheet,cat,action,detail FROM log WHERE ts>=? ORDER BY id DESC LIMIT 3000', now() - LOG_DAYS * 86400000);
  const counts = { all: 0 }, rows = [];
  data.forEach(r => {
    const g = actGroupOf(str(r.sheet));
    counts.all++; counts[g.key] = (counts[g.key] || 0) + 1;
    if ((group === 'all' || group === g.key) && rows.length < limit) rows.push({ ts: r.ts, who: str(r.who), sheet: str(r.sheet), cat: str(r.cat), action: str(r.action), detail: str(r.detail), g: g.label });
  });
  const cats = [{ key: 'all', label: 'ทั้งหมด', count: counts.all }];
  ACT_GROUPS.forEach(g => cats.push({ key: g.key, label: g.label, count: counts[g.key] || 0 }));
  if (counts.other) cats.push({ key: 'other', label: 'อื่น ๆ', count: counts.other });
  return { cats, rows };
};

API.clearActivity = async (C, token, group) => {
  const me = await auth(C, token, true);
  group = str(group) || 'all';
  let label = 'ทั้งหมด', removed = 0;
  if (group === 'all') { removed = (await one(C, 'SELECT COUNT(*) AS n FROM log')).n; await run(C, 'DELETE FROM log'); }
  else {
    const g = ACT_GROUPS.filter(x => x.key === group)[0];
    if (!g && group !== 'other') throw new Error('ไม่พบหมวดที่เลือก');
    label = g ? g.label : 'อื่น ๆ';
    const known = ACT_GROUPS.flatMap(x => x.sheets);
    const sheets = g ? g.sheets : [];
    const where = g ? 'sheet IN (' + sheets.map(() => '?').join(',') + ')' : 'sheet NOT IN (' + known.map(() => '?').join(',') + ')';
    const args = g ? sheets : known;
    removed = (await one(C, 'SELECT COUNT(*) AS n FROM log WHERE ' + where, ...args)).n;
    await run(C, 'DELETE FROM log WHERE ' + where, ...args);
  }
  await sysLog(C, me.name, 'ล้างประวัติการใช้งาน', 'หมวด ' + label + ' · ลบ ' + removed + ' รายการ');
  return { ok: true, removed };
};

export { normCardOrder, migrateLinks, customCards, customIds, cardTitles, validCardLink, normCardSize, normHiddenCards, normCardNewTabs };
