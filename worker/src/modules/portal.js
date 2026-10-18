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

async function migrateLinks(C) {
  if (await kvGet(C, 'LINK_MIGRATED', '')) return;
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
  await kvSet(C, 'CUSTOM_CARDS', JSON.stringify(out));
  await kvSet(C, 'CARD_ORDER', JSON.stringify(normCardOrder(await kvJson(C, 'CARD_ORDER', null), out.map(c => c.k))));
  await sysLog(C, me.name, 'จัดการการ์ดลิงก์', out.map(c => c.t).join(' | ') || '(ไม่มี)');
  return out;
};

API.setCardOrder = async (C, token, order) => {
  const me = await auth(C, token, true), out = normCardOrder(order, await customIds(C));
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
  const me = await auth(C, token, true), out = {};
  titles = (titles && typeof titles === 'object') ? titles : {};
  CARD_KEYS.forEach(k => {
    const t = str(titles[k]).replace(/\s+/g, ' ').trim();
    if (!t) return;
    if (t.length > CARD_TITLE_MAX) throw new Error('ชื่อการ์ดยาวเกิน ' + CARD_TITLE_MAX + ' ตัวอักษร');
    out[k] = t;
  });
  await kvSet(C, 'CARD_TITLES', JSON.stringify(out));
  await sysLog(C, me.name, 'แก้ไขชื่อการ์ดเมนูหลัก', JSON.stringify(out));
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
  await kvSet(C, 'CSZ:' + me.user, JSON.stringify(v));
  await sysLog(C, me.name, 'ปรับขนาดการ์ดเมนูหลัก', 'การ์ดระดับ ' + v.c + ' · ตัวอักษรระดับ ' + v.f + ' · ต่อแถว ' + (v.n || 'อัตโนมัติ'));
  return v;
};

API.logUse = async (C, token, area, action, detail) => {
  const me = await auth(C, token);
  await sysLogTo(C, me.name, USE_AREAS[str(area)] || 'ระบบ', str(action).slice(0, 40), str(detail).slice(0, 200));
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

export { normCardOrder, migrateLinks, customCards, customIds, cardTitles, validCardLink, normCardSize };
