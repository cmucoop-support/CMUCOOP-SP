/* CMUCOOP API — Cloudflare Worker + D1
 * รับ POST {fn, args:[...]} แล้วตอบ {ok:true,data} / {ok:false,error}  (รูปแบบเดียวกับ Apps Script เดิม → หน้าเว็บใช้ gas-shim.js เหมือนเดิม)
 * เฟส 1 : ล็อกอิน/ผู้ใช้/สิทธิ์ · การ์ดเมนูหลัก · ประวัติการใช้งาน · Banner · ระบบเสียงประกาศ
 * ไฟล์รูป/เสียงเก็บใน D1 (ตาราง files) เป็นข้อความ base64 แบ่งก้อนละ ~900 KB (ไม่ต้องใช้ R2 / ไม่ต้องผูกบัตร) */

const SESSION_TTL = 21600;           // วินาที (6 ชั่วโมง) ต่ออายุเมื่อเหลือน้อยกว่าครึ่ง
const MAX_FAIL = 5, LOCK_SEC = 300, LOG_DAYS = 30;
const CHUNK = 900000;                // จำนวนตัวอักษร base64 ต่อ 1 แถวในตาราง files (D1 จำกัดแถวละ 2 MB)
const MAX_BANNER_BYTES = 3 * 1024 * 1024, MAX_SOUND_BYTES = 3 * 1024 * 1024;

const ROLES = { admin: 'แอดมิน', viewer: 'ผู้ใช้งาน' };
const PERM_KEYS = ['barcode', 'sound', 'music', 'stock', 'stock_edit', 'market', 'market_edit'];   // stock_edit = แก้ไขข้อมูลสินค้าค้างสต็อกได้ (อัปโหลด/ตั้งชื่อหมวด/สลับฉบับ) · ไม่มี = ดูอย่างเดียว
const PERM_DEFAULT = { barcode: true, sound: true, music: true, stock: false, stock_edit: false, market: false, market_edit: false };   // stock = สินค้าค้างสต็อก (มีต้นทุน/กำไร) → แอดมินต้องติ๊กให้ผู้ใช้ทีละคน
const CARD_KEYS = ['barcode', 'sound', 'music', 'stock', 'market', 'settings'];
const CUSTOM_KEY = /^c_[0-9a-f]{8}$/, MAX_CUSTOM_CARDS = 30;   // การ์ดลิงก์ที่แอดมินสร้างเอง (รหัส c_xxxxxxxx)
const CARD_TITLE_MAX = 40;
/* การ์ดลิงก์เดิม 5 ใบ (ทำป้ายราคา ฯลฯ) ถูกแปลงเป็นการ์ดลิงก์ทั่วไปที่ลบ/แก้ได้ (ย้ายข้อมูลอัตโนมัติครั้งเดียวใน migrateLinks) */
const LEGACY_LINKS = [
  { old: 'label', k: 'c_00000001', t: 'ทำป้ายราคา', u: 'http://172.16.21.103/COOPSHOP/CoopAdmin/productall.php', def: true },
  { old: 'price', k: 'c_00000002', t: 'ตรวจสอบราคาสินค้า', u: 'https://cmu-coops.com/product/countpd.php', def: true },
  { old: 'offline', k: 'c_00000003', t: 'ระบบ CMUCOOP Offline', u: 'http://172.16.21.103/COOPSHOP/CoopAdmin/productall.php', def: false },
  { old: 'online', k: 'c_00000004', t: 'ระบบ CMUCOOP Online', u: 'https://cmu-coops.com/adEntry.php', def: false },
  { old: 'assets', k: 'c_00000005', t: 'รายการสินทรัพย์', u: '', def: true }
];
const LEGACY_ORDER = ['barcode', 'sound', 'music', 'label', 'price', 'offline', 'online', 'assets', 'history', 'settings'];
const ACT_GROUPS = [
  { key: 'barcode', label: 'รายการบาร์', sheets: ['บาร์สินค้า'] },
  { key: 'sound', label: 'ระบบเสียงประกาศ', sheets: ['Sound'] },
  { key: 'music', label: 'ขอเพลง/คิวเพลง', sheets: ['Music'] },
  { key: 'assets', label: 'รายการสินทรัพย์', sheets: ['รายการสินทรัพย์'] },
  { key: 'stock', label: 'สินค้าค้างสต็อก', sheets: ['สินค้าค้างสต็อก'] },
  { key: 'market', label: 'เช็คราคาตลาด', sheets: ['เช็คราคาตลาด'] },
  { key: 'banner', label: 'Banner', sheets: ['Banner'] },
  { key: 'system', label: 'ผู้ใช้งาน/ระบบ', sheets: ['ระบบ'] }
];
const USE_AREAS = { barcode: 'บาร์สินค้า', sound: 'Sound', music: 'Music', assets: 'รายการสินทรัพย์', banner: 'Banner', stock: 'สินค้าค้างสต็อก', market: 'เช็คราคาตลาด' };
const BANNER_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const BANNER_DEF = { speed: 4, per: 0, perMax: 6, h: 80 };
const SOUND_TYPES = ['ปุ่ม', 'เสียงตามเวลา', 'ระบบ', 'พนักงาน', 'สถานที่', 'แคชเชียร์', 'ประเภทงดรับ', 'เวลา', 'ตั้งค่า'];
const SOUND_NOFILE = { 'เวลา': 1, 'ตั้งค่า': 1 };
const SOUND_EXT = { 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav',
  'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/ogg': 'ogg', 'audio/webm': 'webm' };
const SOUND_MIME = { mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', webm: 'audio/webm' };
const SOUND_LEGACY = 'https://ratthaphontha-wq.github.io/--audio/';
const NOT_YET = 'ระบบนี้ยังไม่ได้ย้ายมาใช้หลังบ้านใหม่ (อยู่ระหว่างพัฒนา)';

/* ---------- ฟังก์ชันที่ยังไม่รองรับในเฟส 1 (ตอบข้อความชัดเจนแทนที่จะพัง) ---------- */
const PENDING = ['makePdf'];   // makePdf: ใช้ปุ่มปริ้นจากเบราว์เซอร์แทน

const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)',
  'CREATE TABLE IF NOT EXISTS users (username TEXT PRIMARY KEY, salt TEXT, hash TEXT, role TEXT, name TEXT, perms TEXT, lk_salt TEXT, lk_hash TEXT)',
  'CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, username TEXT, exp INTEGER)',
  'CREATE TABLE IF NOT EXISTS fails (k TEXT PRIMARY KEY, n INTEGER, until INTEGER)',
  'CREATE TABLE IF NOT EXISTS log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, who TEXT, sheet TEXT, cat TEXT, action TEXT, detail TEXT)',
  'CREATE INDEX IF NOT EXISTS log_ts ON log(ts)',
  'CREATE TABLE IF NOT EXISTS banners (id TEXT PRIMARY KEY, pos INTEGER, title TEXT, link TEXT, visible INTEGER, ts INTEGER, who TEXT, mime TEXT)',
  'CREATE TABLE IF NOT EXISTS sounds (rid INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT, code TEXT, label TEXT, fid TEXT, fname TEXT, value TEXT, enabled INTEGER, ts INTEGER, who TEXT)',
  'CREATE TABLE IF NOT EXISTS files (fid TEXT, n INTEGER, mime TEXT, data TEXT, PRIMARY KEY (fid, n))',
  'CREATE TABLE IF NOT EXISTS barcode_items (id INTEGER PRIMARY KEY AUTOINCREMENT, pos INTEGER, sheet TEXT, partner TEXT, cat TEXT, name TEXT, packBar TEXT, unitBar TEXT, ts INTEGER, who TEXT, perPack TEXT)',
  'CREATE INDEX IF NOT EXISTS bc_cat ON barcode_items(cat, pos)',
  'CREATE TABLE IF NOT EXISTS barcode_stage (job TEXT, pos INTEGER, sheet TEXT, partner TEXT, cat TEXT, name TEXT, packBar TEXT, unitBar TEXT, perPack TEXT, ts INTEGER, who TEXT, PRIMARY KEY(job,pos))',
  'CREATE TABLE IF NOT EXISTS barcode_cats (cat TEXT PRIMARY KEY)',
  'CREATE TABLE IF NOT EXISTS music_queue (id TEXT PRIMARY KEY, seq INTEGER, ts INTEGER, uname TEXT, who TEXT, kind TEXT, ref TEXT, url TEXT, title TEXT, thumb TEXT, status TEXT, t_start INTEGER, t_end INTEGER)',
  'CREATE INDEX IF NOT EXISTS mq_status ON music_queue(status, seq)',
  'CREATE TABLE IF NOT EXISTS backups (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, ts INTEGER, name TEXT, hash TEXT, data TEXT)',
  'CREATE TABLE IF NOT EXISTS stock_data (n INTEGER PRIMARY KEY, data TEXT)',   // สินค้าค้างสต็อก (ระบบเก่า: รวมทุกหมวด) — ใช้เฉพาะย้ายข้อมูลเข้า stock_grp
  'CREATE TABLE IF NOT EXISTS stock_grp (g TEXT, ver INTEGER, n INTEGER, data TEXT, PRIMARY KEY (g, ver, n))',   // สินค้าค้างสต็อก: แยกรายหมวด ver 0 = ปัจจุบัน, 1 = ฉบับก่อนหน้า
  'CREATE TABLE IF NOT EXISTS market_data (n INTEGER PRIMARY KEY, data TEXT)'   // แบ่งสถานะตลาดเป็นก้อน ไม่ให้เกินขนาดแถว D1
];
let schemaReady = false;

/* ============================== เข้า/ออก ============================== */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const C = { env, ctx, request, base: url.origin };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
    try {
      if (!schemaReady) { await env.DB.batch(SCHEMA.map(s => env.DB.prepare(s)));
        try { await env.DB.prepare('ALTER TABLE barcode_items ADD COLUMN perPack TEXT').run(); }
        catch (e) {
          const columns = (await env.DB.prepare('PRAGMA table_info(barcode_items)').all()).results || [];
          if (!columns.some(c => c.name === 'perPack')) throw e;
        }
        schemaReady = true; }
      if (request.method === 'POST') return await rpc(C);
      if (request.method === 'GET') {
        if (url.pathname.startsWith('/file/')) return await serveFile(C, url.pathname.slice(6));
        if (url.searchParams.get('page') === 'banner-json') return await bannerJson(C, url);
        return new Response('CMUCOOP API OK', { headers: { 'Content-Type': 'text/plain; charset=utf-8', ...cors() } });
      }
      return new Response('Method Not Allowed', { status: 405, headers: cors() });
    } catch (e) {
      return jsonOut({ ok: false, error: String((e && e.message) || e) });
    }
  }
};

function cors() { return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }; }
function jsonOut(obj) { return new Response(JSON.stringify(obj), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors() } }); }

const API = {};   // ลงทะเบียนท้ายไฟล์
async function rpc(C) {
  let out;
  try {
    const req = JSON.parse((await C.request.text()) || '{}'), fn = String(req.fn || '');
    if (PENDING.indexOf(fn) >= 0) throw new Error(NOT_YET);
    if (!Object.prototype.hasOwnProperty.call(API, fn)) throw new Error('ไม่รู้จักคำสั่ง: ' + fn);
    out = { ok: true, data: await API[fn](C, ...(Array.isArray(req.args) ? req.args : [])) };
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }
  return jsonOut(out);
}

/* ============================== ตัวช่วย ============================== */
const str = v => (v === null || v === undefined ? '' : String(v).trim());
const now = () => Date.now();
const all = async (C, sql, ...p) => (await C.env.DB.prepare(sql).bind(...p).all()).results || [];
const one = (C, sql, ...p) => C.env.DB.prepare(sql).bind(...p).first();
const run = (C, sql, ...p) => C.env.DB.prepare(sql).bind(...p).run();
const stmt = (C, sql, ...p) => C.env.DB.prepare(sql).bind(...p);
const batch = (C, list) => C.env.DB.batch(list);
async function kvGet(C, k, def) { const r = await one(C, 'SELECT v FROM kv WHERE k=?', k); return r ? r.v : def; }
function kvSetStmt(C, k, v) { return stmt(C, 'INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v', k, String(v)); }
const kvSet = (C, k, v) => kvSetStmt(C, k, v).run();
async function kvJson(C, k, def) { const v = await kvGet(C, k, null); if (v === null) return def; try { return JSON.parse(v); } catch (e) { return def; } }
async function stateJson(C, k, def) {
  const v = await kvGet(C, k, null);
  if (v === null) return def;
  try {
    const parsed = JSON.parse(v);
    if (Array.isArray(def) && !Array.isArray(parsed)) throw new Error('invalid array');
    if (def && typeof def === 'object' && !Array.isArray(def) && (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))) throw new Error('invalid object');
    return parsed;
  }
  catch (e) { throw new Error('ข้อมูลที่บันทึกไว้เสียหาย (' + k + ') กรุณาติดต่อผู้ดูแลก่อนทำรายการ'); }
}
async function kvMany(C, keys) {
  const rows = await all(C, 'SELECT k,v FROM kv WHERE k IN (' + keys.map(() => '?').join(',') + ')', ...keys), m = {};
  rows.forEach(r => { m[r.k] = r.v; });
  return m;
}
function numSetting(raw, min, max, def, round) {
  if (raw === undefined || raw === null || raw === '') return def;
  let v = Number(raw); if (round) v = Math.round(v);
  return v >= min && v <= max ? v : def;
}
async function sha256hex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, '0')).join('');
}
const hashPw = (salt, pw) => sha256hex(salt + '|' + pw);   // เหมือนของเดิมใน Apps Script
const uuid = () => crypto.randomUUID();
const passArg = v => String(v === null || v === undefined ? '' : v);

/* ---------- ประวัติ ---------- */
async function appendLog(C, who, sheet, cat, action, detail) {
  try {
    await run(C, 'INSERT INTO log(ts,who,sheet,cat,action,detail) VALUES(?,?,?,?,?,?)', now(), str(who), sheet, cat || '', action, detail || '');
    const day = new Date(now() + 7 * 3600e3).toISOString().slice(0, 10);
    if ((await kvGet(C, 'LOG_PRUNE_DAY', '')) !== day) {
      await run(C, 'DELETE FROM log WHERE ts<?', now() - LOG_DAYS * 86400000);
      await kvSet(C, 'LOG_PRUNE_DAY', day);
    }
  } catch (e) { console.error('บันทึกประวัติไม่สำเร็จ', e); } // ห้ามรายงานว่าบันทึกหลักล้มเหลวทั้งที่บันทึกสำเร็จแล้ว
}
async function sysLogTo(C, who, sheet, action, detail) { try { await appendLog(C, who, sheet, '', action, detail); } catch (e) { /* ไม่ให้บันทึกประวัติทำงานหลักล้ม */ } }
const sysLog = (C, who, action, detail) => sysLogTo(C, who, 'ระบบ', action, detail);
const actGroupOf = sheet => ACT_GROUPS.filter(g => g.sheets.indexOf(sheet) >= 0)[0] || { key: 'other', label: 'อื่น ๆ' };

/* ---------- ผู้ใช้ / สิทธิ์ / เซสชัน ---------- */
function rowToUser(r) {
  let perms = {}; try { perms = JSON.parse(r.perms || '{}') || {}; } catch (e) { /* ใช้ค่าเริ่มต้น */ }
  return { username: r.username, salt: r.salt, hash: r.hash, role: r.role, name: r.name || '', perms, lk: r.lk_hash ? { salt: r.lk_salt, hash: r.lk_hash } : null };
}
function userPerms(u) {
  const out = {}, p = u.perms || {};
  PERM_KEYS.forEach(k => { out[k] = u.role === 'admin' ? true : (p[k] !== undefined ? !!p[k] : PERM_DEFAULT[k]); });
  Object.keys(p).forEach(k => { if (CUSTOM_KEY.test(k)) out[k] = u.role === 'admin' ? true : p[k] !== false; });   // การ์ดกำหนดเอง: ไม่ได้ตั้ง = เห็นได้
  if (!out.stock) out.stock_edit = false;          // แก้ไขได้ต้องดูได้ก่อน
  if (!out.market) out.market_edit = false;
  return out;
}
function cleanPerms(p, role) {
  const out = {}; p = p || {};
  PERM_KEYS.forEach(k => { out[k] = role === 'admin' ? true : (p[k] === undefined ? PERM_DEFAULT[k] : !(p[k] === false || p[k] === 'false')); });
  Object.keys(p).forEach(k => { if (CUSTOM_KEY.test(k)) out[k] = role === 'admin' ? true : !(p[k] === false || p[k] === 'false'); });
  if (!out.stock) out.stock_edit = false;          // แก้ไขได้ต้องดูได้ก่อน
  if (!out.market) out.market_edit = false;
  return out;
}
async function makeUser(pw, role, name) { const salt = uuid(); return { salt, hash: await hashPw(salt, pw), role, name: name || '' }; }
const saveUserStmt = (C, username, u) => stmt(C,
  'INSERT INTO users(username,salt,hash,role,name,perms,lk_salt,lk_hash) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(username) DO UPDATE SET salt=excluded.salt, hash=excluded.hash, role=excluded.role, name=excluded.name, perms=excluded.perms, lk_salt=excluded.lk_salt, lk_hash=excluded.lk_hash',
  username, u.salt, u.hash, u.role, u.name || '', JSON.stringify(u.perms || {}), u.lk ? u.lk.salt : null, u.lk ? u.lk.hash : null);
async function getUser(C, username) { const r = await one(C, 'SELECT * FROM users WHERE username=?', username); return r ? rowToUser(r) : null; }
async function allUsers(C) { return (await all(C, 'SELECT * FROM users ORDER BY rowid')).map(rowToUser); }
async function ensureAdmin(C) {
  const r = await one(C, 'SELECT COUNT(*) AS n FROM users');
  if (!r || !r.n) { const u = await makeUser('0000', 'admin', ''); u.perms = cleanPerms({}, 'admin'); await saveUserStmt(C, '0000', u).run(); }   // เหมือนของเดิม: แอดมินเริ่มต้น 0000/0000
}
async function newLinkRec(username) {
  const key = (uuid() + uuid()).replace(/-/g, ''), salt = uuid();
  return { key, lk: { salt, hash: await hashPw(salt, key) }, link: '?u=' + encodeURIComponent(username) + '&k=' + key };
}

async function auth(C, token, adminOnly) {
  const s = token ? await one(C, 'SELECT s.exp AS exp, u.* FROM sessions s JOIN users u ON u.username=s.username WHERE s.token=?', String(token)) : null;
  if (!s || s.exp < now()) { if (token) await run(C, 'DELETE FROM sessions WHERE token=?', String(token)); throw new Error('SESSION_EXPIRED'); }
  if (s.exp - now() < SESSION_TTL * 500) await run(C, 'UPDATE sessions SET exp=? WHERE token=?', now() + SESSION_TTL * 1000, String(token));   // ต่ออายุเมื่อเหลือน้อยกว่าครึ่ง
  const u = rowToUser(s);
  if (adminOnly && u.role !== 'admin') throw new Error('ไม่มีสิทธิ์ใช้งานส่วนนี้');
  const perms = userPerms(u);
  return { user: u.username, name: u.name || u.username, role: u.role, assets: perms.assets, perms };
}
async function authPerm(C, token, key) { const me = await auth(C, token); if (!me.perms[key]) throw new Error('คุณไม่มีสิทธิ์ใช้งานส่วนนี้'); return me; }
async function startSession(C, username, u, how) {
  const token = uuid() + uuid(), perms = userPerms(u);
  await run(C, 'DELETE FROM sessions WHERE exp<?', now());
  await run(C, 'INSERT INTO sessions(token,username,exp) VALUES(?,?,?)', token, username, now() + SESSION_TTL * 1000);
  await sysLog(C, u.name || username, 'เข้าสู่ระบบ', 'รหัสผู้ใช้ ' + username + ' (' + how + ')');
  return { token, user: username, name: u.name || username, role: u.role, assets: perms.assets, perms };
}
async function failCount(C, k) { const r = await one(C, 'SELECT n, until FROM fails WHERE k=?', k); return r && r.until > now() ? r.n : 0; }
const failBump = (C, k, n) => run(C, 'INSERT INTO fails(k,n,until) VALUES(?,?,?) ON CONFLICT(k) DO UPDATE SET n=excluded.n, until=excluded.until', k, n, now() + LOCK_SEC * 1000);
const failClear = (C, k) => run(C, 'DELETE FROM fails WHERE k=?', k);

API.login = async (C, username, password) => {
  username = str(username); password = passArg(password);
  await ensureAdmin(C);
  const lockKey = 'fail:' + username, fails = await failCount(C, lockKey);
  if (fails >= MAX_FAIL) throw new Error('ใส่รหัสผิดหลายครั้ง กรุณารอ 5 นาทีแล้วลองใหม่');
  const u = await getUser(C, username);
  if (!u || u.hash !== await hashPw(u.salt, password)) { await failBump(C, lockKey, fails + 1); throw new Error('รหัสผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'); }
  await failClear(C, lockKey);
  return startSession(C, username, u, 'รหัสผ่าน');
};
API.loginByLink = async (C, username, key) => {
  username = str(username); key = str(key);
  const lockKey = 'lfail:' + username, fails = await failCount(C, lockKey);
  if (fails >= MAX_FAIL) throw new Error('ลองผิดหลายครั้ง กรุณารอ 5 นาทีแล้วลองใหม่');
  const u = await getUser(C, username);
  if (!u || !u.lk || !key || u.lk.hash !== await hashPw(u.lk.salt, key)) {
    await failBump(C, lockKey, fails + 1);
    throw new Error('ลิงก์เข้าใช้งานไม่ถูกต้องหรือถูกยกเลิกแล้ว กรุณาขอลิงก์ใหม่จากแอดมิน');
  }
  await failClear(C, lockKey);
  return startSession(C, username, u, 'ลิงก์');
};
API.whoami = (C, token) => auth(C, token);
API.logout = async (C, token) => {
  if (token) {
    try { const me = await auth(C, token); await sysLog(C, me.name, 'ออกจากระบบ', 'รหัสผู้ใช้ ' + me.user); } catch (e) { /* ข้าม */ }
    await run(C, 'DELETE FROM sessions WHERE token=?', String(token));
  }
  return true;
};
API.changePassword = async (C, token, oldPassword, newPassword) => {
  const me = await auth(C, token);
  oldPassword = passArg(oldPassword); newPassword = passArg(newPassword);
  if (newPassword.length < 4) throw new Error('รหัสผ่านใหม่ต้องมีอย่างน้อย 4 ตัวอักษร');
  const lockKey = 'fail:' + me.user, fails = await failCount(C, lockKey);
  if (fails >= MAX_FAIL) throw new Error('ใส่รหัสผิดหลายครั้ง กรุณารอ 5 นาทีแล้วลองใหม่');
  const u = await getUser(C, me.user);
  if (!u) throw new Error('SESSION_EXPIRED');
  if (u.hash !== await hashPw(u.salt, oldPassword)) { await failBump(C, lockKey, fails + 1); throw new Error('รหัสผ่านเดิมไม่ถูกต้อง'); }
  await failClear(C, lockKey);
  const nu = await makeUser(newPassword, u.role, u.name); nu.perms = u.perms; nu.lk = u.lk;
  await saveUserStmt(C, me.user, nu).run();
  await sysLog(C, me.name, 'เปลี่ยนรหัสผ่านตัวเอง', 'รหัสผู้ใช้ ' + me.user);
  return { ok: true };
};

/* ---------- รหัสกู้คืนแอดมิน ---------- */
const normRecovery = c => String(c || '').replace(/[\s-]+/g, '').toUpperCase();
async function checkRecovery(C, code) {
  const rec = await kvJson(C, 'RECOVERY_CODE', null);
  if (rec) return (await hashPw(rec.salt, normRecovery(code))) === rec.hash;
  const { RECOVERY_SALT, RECOVERY_HASH } = C.env;       // รหัสเดิม: ตั้งเป็น Secret ใน Cloudflare (ไม่เก็บในโค้ด)
  if (!RECOVERY_SALT || !RECOVERY_HASH) return false;
  return (await hashPw(RECOVERY_SALT, code)) === RECOVERY_HASH;
}
API.recoveryInfo = async (C, token) => {
  await auth(C, token, true);
  const rec = await kvJson(C, 'RECOVERY_CODE', null);
  return { custom: !!rec, ts: rec ? rec.ts : 0, by: rec ? rec.by : '' };
};
API.issueRecoveryCode = async (C, token) => {
  const me = await auth(C, token, true);
  const raw = (uuid() + uuid()).replace(/-/g, '').toUpperCase().slice(0, 20), code = raw.match(/.{4}/g).join('-'), salt = uuid();
  await kvSet(C, 'RECOVERY_CODE', JSON.stringify({ salt, hash: await hashPw(salt, raw), ts: now(), by: me.name }));
  await failClear(C, 'rfail');
  await sysLog(C, me.name, 'ออกรหัสกู้คืนใหม่', 'รหัสกู้คืนเดิมใช้ไม่ได้แล้ว');
  return { ok: true, code };
};
API.recoverAdmin = async (C, username, code, newPassword) => {
  username = str(username); code = passArg(code).trim(); newPassword = passArg(newPassword);
  await ensureAdmin(C);
  const fails = await failCount(C, 'rfail');
  if (fails >= MAX_FAIL) throw new Error('ใส่รหัสกู้คืนผิดหลายครั้ง กรุณารอ 5 นาทีแล้วลองใหม่');
  if (!username) throw new Error('กรุณากรอกรหัสผู้ใช้แอดมิน');
  if (newPassword.length < 4) throw new Error('รหัสผ่านใหม่ต้องมีอย่างน้อย 4 ตัวอักษร');
  if (!(await checkRecovery(C, code))) { await failBump(C, 'rfail', fails + 1); throw new Error('รหัสกู้คืนไม่ถูกต้อง'); }
  const u = await getUser(C, username);
  if (!u || u.role !== 'admin') throw new Error('ไม่พบบัญชีแอดมินชื่อนี้');
  const nu = await makeUser(newPassword, 'admin', u.name); nu.perms = u.perms; nu.lk = u.lk;
  await saveUserStmt(C, username, nu).run();
  await failClear(C, 'rfail'); await failClear(C, 'fail:' + username);
  await sysLog(C, username, 'กู้คืนรหัสผ่านแอดมิน', 'รหัสผู้ใช้ ' + username);
  return { ok: true };
};

/* ---------- จัดการผู้ใช้ (แอดมิน) ---------- */
API.listUsers = async (C, token) => {
  await auth(C, token, true);
  return (await allUsers(C)).map(u => { const p = userPerms(u); return { username: u.username, name: u.name, role: u.role, assets: p.assets, perms: p, link: !!u.lk }; });
};
API.saveUser = async (C, token, p) => {
  const me = await auth(C, token, true);
  p = p || {};
  const users = await allUsers(C), map = {}; users.forEach(u => { map[u.username] = u; });
  const original = str(p.original), username = str(p.username), password = String(p.password || ''), role = ROLES[p.role] ? p.role : 'viewer';
  const linkMode = p.linkMode === true || p.linkMode === 'true';
  if (!username) throw new Error('กรุณากรอกรหัสผู้ใช้');
  if (username.length > 50) throw new Error('รหัสผู้ใช้ยาวเกินไป');
  const old = original ? map[original] : null;
  if (original && !old) throw new Error('ไม่พบผู้ใช้ ' + original);
  if (!original && map[username]) throw new Error('มีผู้ใช้ชื่อนี้อยู่แล้ว');
  if (original && original !== username && map[username]) throw new Error('มีผู้ใช้ชื่อนี้อยู่แล้ว');
  if (!old && !linkMode && password.length < 4) throw new Error('รหัสผ่านต้องมีอย่างน้อย 4 ตัวอักษร');
  if (old && password && password.length < 4) throw new Error('รหัสผ่านต้องมีอย่างน้อย 4 ตัวอักษร');
  let rec;
  if (old) { rec = { salt: old.salt, hash: old.hash, role, name: str(p.name), lk: old.lk }; if (password) { rec.salt = uuid(); rec.hash = await hashPw(rec.salt, password); } }
  else if (linkMode) rec = await makeUser(uuid(), role, str(p.name));   // รหัสผ่านสุ่ม → เข้าได้ทางลิงก์เท่านั้น
  else rec = await makeUser(password, role, str(p.name));
  rec.perms = cleanPerms(p.perms, role);
  let link = '';
  if ((!old && linkMode) || (old && old.lk && original !== username)) { const nl = await newLinkRec(username); rec.lk = nl.lk; link = nl.link; }
  const next = Object.assign({}, map); if (original && original !== username) delete next[original]; next[username] = rec;
  if (!Object.keys(next).some(k => next[k].role === 'admin')) throw new Error('ต้องมีแอดมินอย่างน้อย 1 คน');
  const ops = [];
  if (original && original !== username) ops.push(stmt(C, 'DELETE FROM users WHERE username=?', original), stmt(C, 'DELETE FROM sessions WHERE username=?', original));
  ops.push(saveUserStmt(C, username, rec));
  await batch(C, ops);
  await sysLog(C, me.name, old ? 'แก้ไขผู้ใช้' : 'เพิ่มผู้ใช้', username + ' · ' + ROLES[role] + ' · การ์ด: ' + PERM_KEYS.filter(k => rec.perms[k]).join(','));
  return { ok: true, link, relogin: original === me.user && original !== username };
};
API.regenUserLink = async (C, token, username) => {
  const me = await auth(C, token, true); username = str(username);
  const u = await getUser(C, username);
  if (!u) throw new Error('ไม่พบผู้ใช้ ' + username);
  const nl = await newLinkRec(username); u.lk = nl.lk;
  await saveUserStmt(C, username, u).run();
  await sysLog(C, me.name, 'ออกลิงก์ใหม่ให้ผู้ใช้', username);
  return { ok: true, link: nl.link };
};
API.deleteUser = async (C, token, username) => {
  const me = await auth(C, token, true); username = str(username);
  if (username === me.user) throw new Error('ไม่สามารถลบบัญชีที่กำลังใช้งานอยู่ได้');
  const users = await allUsers(C);
  if (!users.some(u => u.username === username)) throw new Error('ไม่พบผู้ใช้ ' + username);
  if (!users.some(u => u.username !== username && u.role === 'admin')) throw new Error('ต้องมีแอดมินอย่างน้อย 1 คน');
  await batch(C, [stmt(C, 'DELETE FROM users WHERE username=?', username), stmt(C, 'DELETE FROM sessions WHERE username=?', username), stmt(C, 'DELETE FROM kv WHERE k=?', 'CSZ:' + username)]);
  await sysLog(C, me.name, 'ลบผู้ใช้', username);
  return { ok: true };
};

/* ---------- การ์ดเมนูหลัก ---------- */
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
API.getCustomCards = async (C, token) => {           // ผู้ใช้ทั่วไปเห็นเฉพาะการ์ดที่แอดมินไม่ได้ปิดสิทธิ์ไว้
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

/* ---------- ประวัติการใช้งาน ---------- */
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
    const known = ACT_GROUPS.reduce((a, x) => a.concat(x.sheets), []);
    const sheets = g ? g.sheets : null;
    const where = g ? 'sheet IN (' + sheets.map(() => '?').join(',') + ')' : 'sheet NOT IN (' + known.map(() => '?').join(',') + ')';
    const args = g ? sheets : known;
    removed = (await one(C, 'SELECT COUNT(*) AS n FROM log WHERE ' + where, ...args)).n;
    await run(C, 'DELETE FROM log WHERE ' + where, ...args);
  }
  await sysLog(C, me.name, 'ล้างประวัติการใช้งาน', 'หมวด ' + label + ' · ลบ ' + removed + ' รายการ');
  return { ok: true, removed };
};

/* ============================== ไฟล์ (รูป/เสียง) ============================== */
async function saveFile(C, mime, b64) {
  const fid = uuid().replace(/-/g, ''), ops = [];
  for (let i = 0, n = 0; i < b64.length; i += CHUNK, n++) ops.push(stmt(C, 'INSERT INTO files(fid,n,mime,data) VALUES(?,?,?,?)', fid, n, mime, b64.slice(i, i + CHUNK)));
  await batch(C, ops);
  return fid;
}
const dropFile = (C, fid) => (fid ? run(C, 'DELETE FROM files WHERE fid=?', fid) : null);
async function fileB64(C, fid) {
  const rows = await all(C, 'SELECT mime,data FROM files WHERE fid=? ORDER BY n', fid);
  if (!rows.length) return null;
  return { mime: rows[0].mime, b64: rows.map(r => r.data).join('') };
}
async function dataUrl(C, fid) {
  const f = await fileB64(C, fid);
  if (!f) throw new Error('ไม่พบไฟล์');
  return 'data:' + f.mime + ';base64,' + f.b64;
}
function checkB64(data, maxBytes, label) {
  data = String(data || '').replace(/\s+/g, '');
  if (!data) throw new Error('ไม่พบข้อมูล' + label);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new Error('ข้อมูลไฟล์ไม่ถูกต้อง');
  let bytes;
  try { bytes = atob(data).length; } catch (e) { throw new Error('ข้อมูลไฟล์ไม่ถูกต้อง'); }
  if (bytes > maxBytes) throw new Error('ไฟล์ใหญ่เกิน ' + Math.round(maxBytes / 1048576) + ' MB');
  return data;
}
async function serveFile(C, fid) {
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  if (cache) { const hit = await cache.match(C.request); if (hit) return hit; }
  const f = await fileB64(C, str(fid).replace(/[^0-9a-f]/gi, ''));
  if (!f) return new Response('Not found', { status: 404, headers: cors() });
  const bin = atob(f.b64), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const res = new Response(bytes, { headers: { 'Content-Type': f.mime, 'Cache-Control': 'public, max-age=31536000, immutable', ...cors() } });
  if (cache && C.ctx) C.ctx.waitUntil(cache.put(C.request, res.clone()));
  return res;
}

/* ============================== Banner ============================== */
const bannerUrl = (C, id) => C.base + '/file/' + id;
async function bannerSettings(C) {
  const m = await kvMany(C, ['BANNER_SPEED', 'BANNER_PER_VIEW', 'BANNER_HEIGHT_PCT']);
  return { speed: numSetting(m.BANNER_SPEED, 1, 60, BANNER_DEF.speed, false), perView: numSetting(m.BANNER_PER_VIEW, 0, BANNER_DEF.perMax, BANNER_DEF.per, true), heightPct: numSetting(m.BANNER_HEIGHT_PCT, 30, 100, BANNER_DEF.h, true) };
}
async function readBanners(C) {
  return (await all(C, 'SELECT id,title,link,visible,ts,who FROM banners ORDER BY pos')).map(b => ({ id: b.id, title: b.title || '', link: b.link || '', show: !!b.visible, ts: b.ts || 0, by: b.who || '' }));
}
async function publicBanners(C) {
  const list = (await readBanners(C)).filter(b => b.show).map(b => ({ id: b.id, title: b.title, link: b.link, url: bannerUrl(C, b.id) }));
  return Object.assign({ banners: list }, await bannerSettings(C));
}
API.getPublicBanners = C => publicBanners(C);
async function bannerJson(C, url) {
  const json = JSON.stringify(await publicBanners(C)), cb = url.searchParams.get('callback') || '';
  if (cb && /^[A-Za-z_$][A-Za-z0-9_$.]{0,60}$/.test(cb)) return new Response(cb + '(' + json + ');', { headers: { 'Content-Type': 'application/javascript; charset=utf-8', ...cors() } });
  return new Response(json, { headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors() } });
}
API.getBannerImage = async (C, id) => {
  id = str(id);
  const b = await one(C, 'SELECT id FROM banners WHERE id=? AND visible=1', id);
  if (!b) throw new Error('ไม่พบรูป');
  return dataUrl(C, id);
};
API.adminBannerImage = async (C, token, id) => {
  await auth(C, token, true); id = str(id);
  if (!(await one(C, 'SELECT id FROM banners WHERE id=?', id))) throw new Error('ไม่พบรูป');
  return dataUrl(C, id);
};
API.listBanners = async (C, token) => {
  await auth(C, token, true);
  const s = await bannerSettings(C);
  return Object.assign({ banners: (await readBanners(C)).map(b => Object.assign(b, { url: bannerUrl(C, b.id) })), perMax: BANNER_DEF.perMax, displayUrl: '', folderUrl: '' }, s);
};
const checkLink = v => { v = str(v); if (v && !/^https?:\/\/\S+$/i.test(v)) throw new Error('ลิงก์ต้องขึ้นต้นด้วย http:// หรือ https://'); return v; };
API.addBanner = async (C, token, p) => {
  const me = await auth(C, token, true); p = p || {};
  const mime = str(p.mime);
  if (!BANNER_EXT[mime]) throw new Error('รองรับเฉพาะไฟล์รูป JPG, PNG, WEBP, GIF');
  const link = checkLink(p.link), data = checkB64(p.data, MAX_BANNER_BYTES, 'รูป');
  const title = str(p.name).replace(/\.[^.]+$/, '').slice(0, 100);
  const id = await saveFile(C, mime, data);
  const pos = ((await one(C, 'SELECT MAX(pos) AS m FROM banners')).m || 0) + 1;
  await run(C, 'INSERT INTO banners(id,pos,title,link,visible,ts,who,mime) VALUES(?,?,?,?,1,?,?,?)', id, pos, title, link, now(), me.name, mime);
  await appendLog(C, me.name, 'Banner', '', 'เพิ่ม Banner', title || id);
  return { ok: true, id };
};
API.updateBanner = async (C, token, id, p) => {
  const me = await auth(C, token, true); p = p || {}; id = str(id);
  const b = await one(C, 'SELECT * FROM banners WHERE id=?', id);
  if (!b) throw new Error('ไม่พบ Banner นี้ (อาจถูกลบไปแล้ว)');
  const detail = []; let title = b.title, link = b.link, vis = b.visible;
  if (p.title !== undefined) { title = str(p.title).slice(0, 100); detail.push('ชื่อ'); }
  if (p.link !== undefined) { link = checkLink(p.link); detail.push('ลิงก์'); }
  if (p.show !== undefined) { vis = p.show ? 1 : 0; detail.push(p.show ? 'แสดง' : 'ซ่อน'); }
  await run(C, 'UPDATE banners SET title=?, link=?, visible=? WHERE id=?', title, link, vis, id);
  await appendLog(C, me.name, 'Banner', '', 'แก้ไข Banner', title + ' (' + detail.join(', ') + ')');
  return { ok: true };
};
API.moveBanner = async (C, token, id, dir) => {
  await auth(C, token, true); id = str(id); dir = Number(dir) < 0 ? -1 : 1;
  const b = await one(C, 'SELECT id,pos FROM banners WHERE id=?', id);
  if (!b) throw new Error('ไม่พบ Banner นี้ (อาจถูกลบไปแล้ว)');
  const o = dir < 0 ? await one(C, 'SELECT id,pos FROM banners WHERE pos<? ORDER BY pos DESC LIMIT 1', b.pos) : await one(C, 'SELECT id,pos FROM banners WHERE pos>? ORDER BY pos ASC LIMIT 1', b.pos);
  if (!o) return { ok: true };
  await batch(C, [stmt(C, 'UPDATE banners SET pos=? WHERE id=?', o.pos, b.id), stmt(C, 'UPDATE banners SET pos=? WHERE id=?', b.pos, o.id)]);
  return { ok: true };
};
API.deleteBanner = async (C, token, id) => {
  const me = await auth(C, token, true); id = str(id);
  const b = await one(C, 'SELECT title FROM banners WHERE id=?', id);
  if (!b) throw new Error('ไม่พบ Banner นี้ (อาจถูกลบไปแล้ว)');
  await batch(C, [stmt(C, 'DELETE FROM banners WHERE id=?', id), stmt(C, 'DELETE FROM files WHERE fid=?', id)]);
  await appendLog(C, me.name, 'Banner', '', 'ลบ Banner', b.title || id);
  return { ok: true };
};
async function setBannerNum(C, token, key, v, min, max, round, errMsg, action, logText) {
  const me = await auth(C, token, true);
  v = Number(v); if (round) v = Math.round(v);
  if (!(v >= min && v <= max)) throw new Error(errMsg);
  if (!round) v = Math.round(v * 10) / 10;
  await kvSet(C, key, v);
  await appendLog(C, me.name, 'Banner', '', action, logText(v));
  return v;
}
API.setBannerSpeed = async (C, token, sec) => ({ ok: true, speed: await setBannerNum(C, token, 'BANNER_SPEED', sec, 1, 60, false, 'ความเร็วต้องอยู่ระหว่าง 1–60 วินาที', 'ตั้งความเร็ว Banner', x => x + ' วินาทีต่อรูป') });
API.setBannerPerView = async (C, token, n) => ({ ok: true, perView: await setBannerNum(C, token, 'BANNER_PER_VIEW', n, 0, BANNER_DEF.perMax, true, 'จำนวนรูปต่อหน้าต้องอยู่ระหว่าง 0–' + BANNER_DEF.perMax + ' (0 = อัตโนมัติ)', 'ตั้งจำนวนรูปต่อหน้า', x => (x ? x + ' รูปต่อหน้า' : 'อัตโนมัติ (เต็มกรอบ)')) });
API.setBannerHeight = async (C, token, pct) => ({ ok: true, heightPct: await setBannerNum(C, token, 'BANNER_HEIGHT_PCT', pct, 30, 100, true, 'ความสูงต้องอยู่ระหว่าง 30–100 %', 'ตั้งความสูง Banner', x => x + ' % ของกรอบ') });

/* ============================== ระบบเสียงประกาศ ============================== */
const soundLog = (C, who, action, detail) => appendLog(C, who, 'Sound', '', action, detail);
async function readSounds(C) {
  return (await all(C, 'SELECT * FROM sounds ORDER BY rid')).map(r => ({ row: r.rid, type: str(r.type), code: str(r.code), label: str(r.label), id: str(r.fid), file: str(r.fname), value: str(r.value), on: !!r.enabled, ts: r.ts || 0, by: str(r.who) }))
    .filter(x => x.type && x.code);
}
async function buildSoundCfg(C, full) {
  const cfg = { buttons: [], timed: [], staff: [], locations: [], cashiers: [], notices: [], schedule: [], intro: '', outro: '', daytime: { on: false, interval: 30 } };
  const map = { 'ปุ่ม': 'buttons', 'เสียงตามเวลา': 'timed', 'พนักงาน': 'staff', 'สถานที่': 'locations', 'แคชเชียร์': 'cashiers', 'ประเภทงดรับ': 'notices' };
  let dayKey = '';
  (await readSounds(C)).forEach(x => {
    if (!x.on) return;
    if (map[x.type]) { if (x.id) cfg[map[x.type]].push({ code: x.code, label: (x.type === 'พนักงาน' && !full) ? x.code : (x.label || x.code), id: x.id }); }
    else if (x.type === 'ระบบ') { if (x.code === 'intro') cfg.intro = x.id; if (x.code === 'outro') cfg.outro = x.id; }
    else if (x.type === 'เวลา') cfg.schedule.push({ time: x.code, key: x.value });
    else if (x.type === 'ตั้งค่า' && x.code === 'daytime') cfg.daytime = { on: true, interval: Number(x.value) || 30 };
    else if (x.type === 'ตั้งค่า' && x.code === 'daytimeKey') dayKey = x.value;
  });
  cfg.daytime.key = dayKey || '3';
  cfg.ver = (await sha256hex(JSON.stringify(cfg))).slice(0, 22);
  return cfg;
}
API.getSoundConfig = async (C, token) => { await authPerm(C, token, 'sound'); return buildSoundCfg(C, true); };
API.getSoundPublic = C => buildSoundCfg(C, false);
API.getSoundAudio = async (C, id) => {
  id = str(id);
  if (!(await one(C, 'SELECT rid FROM sounds WHERE enabled=1 AND fid=?', id))) throw new Error('ไม่พบไฟล์เสียง');
  return dataUrl(C, id);
};
API.soundLog = async (C, token, action, detail) => { const me = await authPerm(C, token, 'sound'); await soundLog(C, me.name, str(action).slice(0, 40), str(detail).slice(0, 300)); return true; };
API.soundScheduleLog = async (C, time, key, kind, skipped) => {
  time = str(time); key = str(key); kind = str(kind).slice(0, 60);
  if (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(time)) return false;
  const snd = await one(C, "SELECT label FROM sounds WHERE type IN ('ปุ่ม','เสียงตามเวลา') AND code=? LIMIT 1", key);
  if (!snd) return false;
  const ck = 'schlog:' + new Date(now() + 7 * 3600e3).toISOString().slice(0, 10) + time + ':' + kind;
  if (await failCount(C, ck)) return false;
  await run(C, 'INSERT INTO fails(k,n,until) VALUES(?,?,?) ON CONFLICT(k) DO UPDATE SET n=excluded.n, until=excluded.until', ck, 1, now() + 120000);
  await soundLog(C, 'TV', skipped ? 'ข้ามประกาศตามเวลา' : 'ประกาศตามเวลา', (kind || 'ตามเวลา') + ' · เวลา ' + time + ' · เสียง ' + (snd.label || key) + ' (รหัส ' + key + ')' + (skipped ? ' · ข้ามเพราะมีประกาศอื่นกำลังเล่น' : ''));
  return true;
};
API.listSounds = async (C, token) => { await auth(C, token, true); return { rows: await readSounds(C), types: SOUND_TYPES, folderUrl: '', receiverUrl: '' }; };
API.adminSoundAudio = async (C, token, id) => {
  await auth(C, token, true); id = str(id);
  if (!(await one(C, 'SELECT rid FROM sounds WHERE fid=?', id))) throw new Error('ไม่พบไฟล์เสียง');
  return dataUrl(C, id);
};
API.saveSound = async (C, token, p) => {
  const me = await auth(C, token, true); p = p || {};
  const type = str(p.type), code = str(p.code), label = str(p.label), value = str(p.value), row = Number(p.row) || 0;
  if (SOUND_TYPES.indexOf(type) < 0) throw new Error('ประเภทไม่ถูกต้อง');
  if (!code) throw new Error('กรุณากรอกรหัส');
  if (type === 'เวลา' && !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(code)) throw new Error('เวลาต้องเป็นรูปแบบ HH:MM เช่น 19:30');
  if (type === 'เวลา' && !value) throw new Error('กรุณาระบุรหัสเสียงที่จะเล่นในช่อง "ค่าเพิ่มเติม"');
  if (type === 'ตั้งค่า' && code === 'daytime' && !(Number(value) >= 1 && Number(value) <= 120)) throw new Error('ช่วงนาทีต้องอยู่ระหว่าง 1–120');
  const f = p.file; let data = null, mime = '';
  if (f && f.data) {
    mime = str(f.mime).toLowerCase();
    if (!SOUND_EXT[mime]) throw new Error('รองรับเฉพาะไฟล์เสียง MP3, WAV, M4A, AAC, OGG');
    if (SOUND_NOFILE[type]) throw new Error('รายการประเภทนี้ไม่ใช้ไฟล์เสียง');
    data = checkB64(f.data, MAX_SOUND_BYTES, 'ไฟล์เสียง');
  }
  const on = str(p.status) !== 'ปิด';
  const list = await readSounds(C); let old = null;
  list.forEach(x => { if (x.row === row) old = x; else if (x.type === type && x.code === code) throw new Error('มีรหัสนี้ในประเภท "' + type + '" แล้ว'); });
  if (row && !old) throw new Error('ไม่พบแถวที่ต้องการแก้ไข');
  let fid = old ? old.id : '', fname = old ? old.file : '';
  if (data) { fid = await saveFile(C, mime, data); fname = str(f.name).slice(0, 120) || ('sound.' + SOUND_EXT[mime]); }
  if (SOUND_NOFILE[type]) { fid = ''; fname = ''; }
  let rid = row;
  try {
    const ops = [row
      ? stmt(C, 'UPDATE sounds SET type=?,code=?,label=?,fid=?,fname=?,value=?,enabled=?,ts=?,who=? WHERE rid=?', type, code, label, fid, fname, value, on ? 1 : 0, now(), me.name, row)
      : stmt(C, 'INSERT INTO sounds(type,code,label,fid,fname,value,enabled,ts,who) VALUES(?,?,?,?,?,?,?,?,?)', type, code, label, fid, fname, value, on ? 1 : 0, now(), me.name)];
    if (old && old.id && old.id !== fid) ops.push(stmt(C, 'DELETE FROM files WHERE fid=?', old.id));
    const saved = await batch(C, ops);
    if (!row) rid = saved[0].meta.last_row_id;
  } catch (e) {
    if (data && fid && (!old || old.id !== fid)) { try { await dropFile(C, fid); } catch (_) { /* เก็บไฟล์เดิมไว้ครบ */ } }
    throw e;
  }
  await soundLog(C, me.name, old ? 'แก้ไขเสียง' : 'เพิ่มเสียง', type + ' ' + code + (label ? ' (' + label + ')' : ''));
  return { ok: true, row: rid };
};
API.deleteSound = async (C, token, row, code) => {
  const me = await auth(C, token, true); row = Number(row) || 0;
  const x = (await readSounds(C)).filter(r => r.row === row)[0];
  if (!x || x.code !== str(code)) throw new Error('ไม่พบรายการ (ข้อมูลอาจเปลี่ยนไปแล้ว กรุณาโหลดใหม่)');
  await batch(C, [stmt(C, 'DELETE FROM sounds WHERE rid=?', row), stmt(C, 'DELETE FROM files WHERE fid=?', x.id || '-')]);
  await soundLog(C, me.name, 'ลบเสียง', x.type + ' ' + x.code + (x.label ? ' (' + x.label + ')' : ''));
  return { ok: true };
};
function bytesToB64(buf) {
  const u = new Uint8Array(buf); let s = '';
  for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192));
  return btoa(s);
}
/** นำเข้าไฟล์เสียงเดิมจากเว็บ GitHub เดิม (ตามชื่อไฟล์) ครั้งละไม่กี่ไฟล์ — หน้าเว็บเรียกซ้ำจนกว่า remaining = 0 */
API.soundImportLegacy = async (C, token) => {
  const me = await auth(C, token, true), BATCH = 5;
  const missSet = await kvJson(C, 'LEGACY_MISS', []);
  const rows = (await readSounds(C)).filter(x => !x.id && x.file && !SOUND_NOFILE[x.type] && missSet.indexOf(x.file) < 0);
  let done = 0; const take = rows.slice(0, BATCH);
  for (const x of take) {
    try {
      const res = await fetch(SOUND_LEGACY + encodeURIComponent(x.file));
      if (!res.ok) { missSet.push(x.file); continue; }
      const buf = await res.arrayBuffer();
      if (buf.byteLength > MAX_SOUND_BYTES) { missSet.push(x.file); continue; }
      const ext = (/\.([A-Za-z0-9]+)$/.exec(x.file) || [])[1] || 'mp3', mime = SOUND_MIME[ext.toLowerCase()] || 'audio/mpeg';
      const fid = await saveFile(C, mime, bytesToB64(buf));
      await run(C, 'UPDATE sounds SET fid=?, ts=?, who=? WHERE rid=?', fid, now(), me.name, x.row);
      done++;
    } catch (e) { missSet.push(x.file); }
  }
  const remaining = Math.max(0, rows.length - take.length);
  await kvSet(C, 'LEGACY_MISS', JSON.stringify(remaining ? missSet : []));
  await soundLog(C, me.name, 'นำเข้าไฟล์เสียงเดิม', 'สำเร็จ ' + done + ' ไม่พบ ' + missSet.length);
  return { done, missing: missSet, remaining };
};

/* ============================== ขอเพลง / คิวเพลง ==============================
 * ตาราง music_queue : 1 แถว = 1 คำขอ  สถานะ  รออนุมัติ → รอคิว → กำลังเล่น → เล่นแล้ว
 *                                         (แยกออก: ปฏิเสธ · ยกเลิก · ลบแล้ว · ข้ามแล้ว · ผิดพลาด)
 * TV (receiver.html) เรียก musicTvTick ทุก 5 วินาที เพื่อรับว่าต้องเล่นเพลงไหน และเรียก musicTvEnd เมื่อเพลงจบ */
const MU_LIVE = "('รออนุมัติ','รอคิว','กำลังเล่น')";
const MU_PROG_MAX_AGE = 7000;   // ตำแหน่งเพลงที่ TV รายงานล่าสุด ใช้นับต่อเองได้ไม่เกินกี่ ms
const MU_MAX_QUEUE = 60, MU_KEEP_DAYS = 7, MU_USER_DEF = 3, MU_TV_ONLINE_MS = 90000;
const MU_AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|oga|opus|webm|flac)$/i;
const MU_YT_HOST = /^(?:www\.|m\.|music\.)?(?:youtube\.com|youtube-nocookie\.com)$/i;
const YT_ID = /^[A-Za-z0-9_-]{11}$/, YT_LIST = /^[A-Za-z0-9_-]{10,64}$/;

async function musicState(C) {
  const m = await kvMany(C, ['MUSIC_VOL', 'ANN_VOL', 'MUSIC_AUTO', 'MUSIC_MAX_USER', 'MUSIC_TV_SEEN', 'MUSIC_PAUSED', 'MUSIC_PROG', 'MUSIC_CMD']);
  let prog = null; try { prog = m.MUSIC_PROG ? JSON.parse(m.MUSIC_PROG) : null; } catch (e) {}
  return {
    pausedId: m.MUSIC_PAUSED || '', prog, cmd: (() => { try { return m.MUSIC_CMD ? JSON.parse(m.MUSIC_CMD) : null; } catch (e) { return null; } })(),
    vol: numSetting(m.MUSIC_VOL, 0, 100, 70, true), avol: numSetting(m.ANN_VOL, 10, 100, 100, true), auto: m.MUSIC_AUTO === '1',
    maxUser: numSetting(m.MUSIC_MAX_USER, 1, 10, MU_USER_DEF, true), tvSeen: Number(m.MUSIC_TV_SEEN) || 0
  };
}

/* แปลงลิงก์ที่วางมา → { kind: 'yt' | 'ytlist' | 'audio', ref, url, thumb, title } หรือโยนข้อความผิดพลาด */
function ytItem(kind, id) {
  return kind === 'yt'
    ? { kind, ref: id, url: 'https://www.youtube.com/watch?v=' + id, thumb: 'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg', title: 'วิดีโอ YouTube (' + id + ')' }
    : { kind, ref: id, url: 'https://www.youtube.com/playlist?list=' + id, thumb: '', title: 'เพลย์ลิสต์ YouTube' };
}
function parseMusicUrl(raw) {
  let s = str(raw);
  if (!s) throw new Error('วางลิงก์เพลงก่อน');
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  let u; try { u = new URL(s); } catch (e) { throw new Error('ลิงก์ไม่ถูกต้อง'); }
  const host = u.hostname.toLowerCase();
  if (host === 'youtu.be' || host === 'www.youtu.be') {
    const id = u.pathname.slice(1).split('/')[0];
    if (YT_ID.test(id)) return ytItem('yt', id);
  } else if (MU_YT_HOST.test(host)) {
    const v = u.searchParams.get('v'), list = u.searchParams.get('list'), seg = u.pathname.split('/').filter(Boolean);
    if (u.pathname === '/playlist' && list) {
      if (/^RD/.test(list)) throw new Error('YouTube Mix (รายการเล่นอัตโนมัติ) ไม่รองรับ — ใช้ลิงก์วิดีโอหรือเพลย์ลิสต์ปกติแทน');
      if (YT_LIST.test(list)) return ytItem('ytlist', list);
    }
    if (v && YT_ID.test(v)) return ytItem('yt', v);                                            // ลิงก์วิดีโอที่มี &list= ติดมา → เล่นเฉพาะวิดีโอนั้น
    if (['shorts', 'embed', 'live', 'v'].indexOf(seg[0]) >= 0 && YT_ID.test(seg[1] || '')) return ytItem('yt', seg[1]);
    if (list && !/^RD/.test(list) && YT_LIST.test(list)) return ytItem('ytlist', list);
  } else if (MU_AUDIO_EXT.test(u.pathname)) {
    let name = u.pathname.split('/').pop().replace(MU_AUDIO_EXT, '');
    try { name = decodeURIComponent(name); } catch (e) { /* ใช้ชื่อดิบ */ }
    return { kind: 'audio', ref: u.href, url: u.href, thumb: '', title: name.slice(0, 150) || 'ไฟล์เสียง' };
  }
  throw new Error('รองรับเฉพาะลิงก์ YouTube (วิดีโอ/เพลย์ลิสต์) หรือไฟล์เสียง .mp3 .m4a .wav .ogg');
}
/* ถามชื่อเพลงและเช็กว่าฝังเล่นได้ไหมจาก YouTube oEmbed (ถ้าเช็กไม่ได้ ใช้ชื่อสำรอง ไม่ขวางการขอเพลง) */
async function ytMeta(item) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 4000);
  try {
    const res = await fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(item.url), { signal: ctl.signal });
    if (res.ok) { const j = await res.json(); return { title: str(j.title).slice(0, 150) }; }
    if (item.kind === 'yt' && (res.status === 401 || res.status === 403)) return { error: 'วิดีโอนี้เป็นส่วนตัวหรือเจ้าของปิดการฝังเล่น TV จะเล่นไม่ได้ — เลือกเพลงอื่น' };
    if (item.kind === 'yt' && res.status === 404) return { error: 'ไม่พบวิดีโอนี้ (ลิงก์ผิดหรือถูกลบแล้ว)' };
  } catch (e) { /* ใช้ชื่อสำรอง */ } finally { clearTimeout(t); }
  return { title: '' };
}

const muRow = (r, me) => ({
  id: r.id, title: r.title, url: r.url, kind: r.kind, thumb: r.thumb || '', by: r.who, status: r.status,
  mine: !!me && r.uname === me.user, ts: r.ts, start: r.t_start || 0, end: r.t_end || 0
});
const muItem = r => ({ id: r.id, kind: r.kind, ref: r.ref, title: r.title, by: r.who });

API.musicList = async (C, token) => {
  const me = await authPerm(C, token, 'music'), s = await musicState(C);
  const live = await all(C, 'SELECT * FROM music_queue WHERE status IN ' + MU_LIVE + " ORDER BY CASE status WHEN 'กำลังเล่น' THEN 0 WHEN 'รอคิว' THEN 1 ELSE 2 END, seq");
  const hist = await all(C, 'SELECT * FROM music_queue WHERE status NOT IN ' + MU_LIVE + ' ORDER BY COALESCE(t_end, ts) DESC LIMIT 40');
  const cur = live.find(r => r.status === 'กำลังเล่น');           // หยุดเพลง/ความคืบหน้า ใช้ได้เฉพาะเพลงที่กำลังเล่นอยู่
  return {
    paused: !!cur && s.pausedId === cur.id, prog: cur && s.prog && s.prog.id === cur.id ? s.prog : null, now: now(),
    rows: live.concat(hist).map(r => muRow(r, me)), auto: s.auto, vol: s.vol, avol: s.avol, maxUser: s.maxUser,
    tv: { online: s.tvSeen > 0 && now() - s.tvSeen < MU_TV_ONLINE_MS, seen: s.tvSeen }, max: MU_MAX_QUEUE
  };
};
API.musicRequest = async (C, token, url) => {
  const me = await authPerm(C, token, 'music'), item = parseMusicUrl(url), s = await musicState(C), admin = me.role === 'admin';
  const live = await all(C, 'SELECT uname, ref FROM music_queue WHERE status IN ' + MU_LIVE);
  if (live.length >= MU_MAX_QUEUE) throw new Error('คิวเต็มแล้ว (สูงสุด ' + MU_MAX_QUEUE + ' เพลง) ลองใหม่เมื่อมีเพลงเล่นจบ');
  if (live.some(x => x.ref === item.ref)) throw new Error('เพลงนี้อยู่ในคิวแล้ว');
  const mine = live.filter(x => x.uname === me.user).length;
  if (!admin && mine >= s.maxUser) throw new Error('คุณมีเพลงในคิวครบ ' + s.maxUser + ' เพลงแล้ว — รอให้เล่นจบหรือยกเลิกอันเดิมก่อน');
  if (item.kind !== 'audio') { const m = await ytMeta(item); if (m.error) throw new Error(m.error); if (m.title) item.title = m.title; }
  const id = uuid().replace(/-/g, '').slice(0, 12), status = (s.auto || admin) ? 'รอคิว' : 'รออนุมัติ';
  await run(C, 'INSERT INTO music_queue(id,seq,ts,uname,who,kind,ref,url,title,thumb,status) VALUES(?, (SELECT COALESCE(MAX(seq),0)+1 FROM music_queue), ?,?,?,?,?,?,?,?,?)',
    id, now(), me.user, me.name, item.kind, item.ref, item.url, item.title, item.thumb, status);
  await run(C, 'DELETE FROM music_queue WHERE status NOT IN ' + MU_LIVE + ' AND COALESCE(t_end, ts)<?', now() - MU_KEEP_DAYS * 86400000);
  await appendLog(C, me.name, 'Music', '', 'ขอเพลง', item.title + (status === 'รออนุมัติ' ? ' (รออนุมัติ)' : ''));
  return { id, status, title: item.title, kind: item.kind };
};
async function muMove(C, id, from, to, extra) {            // เปลี่ยนสถานะแบบกันชนกัน: สำเร็จเฉพาะเมื่อแถวยังอยู่สถานะเดิม
  const q = "UPDATE music_queue SET status=?, t_end=CASE WHEN ? IN ('รอคิว','กำลังเล่น') THEN t_end ELSE ? END WHERE id=? AND status IN (" + from.map(() => '?').join(',') + ')';
  const r = await run(C, q, to, to, now(), id, ...from);
  if (!r.meta.changes) throw new Error('สถานะเพลงเปลี่ยนไปแล้ว กรุณารีเฟรชแล้วลองใหม่');
}
API.musicCancel = async (C, token, id) => {
  const me = await authPerm(C, token, 'music'); id = str(id);
  const r = await one(C, 'SELECT * FROM music_queue WHERE id=?', id);
  if (!r) throw new Error('ไม่พบคำขอนี้');
  if (r.uname !== me.user && me.role !== 'admin') throw new Error('ยกเลิกได้เฉพาะเพลงที่คุณขอเอง');
  await muMove(C, id, ['รออนุมัติ', 'รอคิว'], 'ยกเลิก');
  await appendLog(C, me.name, 'Music', '', 'ยกเลิกคำขอเพลง', r.title);
  return true;
};
/* หยุดเพลง/เล่นต่อ (แอดมิน) — เก็บเป็น "รหัสเพลงที่ถูกหยุด" ข้ามเพลง/จบเพลง/เปลี่ยนเพลงแล้วสถานะหยุดหายเองโดยไม่ต้องล้าง */
API.musicPause = async (C, token, id, on) => {
  const me = await auth(C, token, true); id = str(id); on = on === true || on === 'true';
  const r = await one(C, 'SELECT * FROM music_queue WHERE id=?', id);
  if (!r || r.status !== 'กำลังเล่น') throw new Error('เพลงนี้ไม่ได้กำลังเล่นอยู่แล้ว กรุณารีเฟรช');
  const s = await musicState(C), p = s.prog && s.prog.id === id ? s.prog : null;
  await kvSet(C, 'MUSIC_PAUSED', on ? id : '');
  if (p) {                                                      // ล็อกตำแหน่งตอนกดหยุด / เริ่มนับต่อตอนกดเล่นต่อ ไม่ต้องรอ TV รายงานรอบหน้า
    const age = Math.min(Math.max(now() - p.ts, 0), MU_PROG_MAX_AGE);
    const pos = on && p.mv ? (p.pos || 0) + age / 1000 : (p.pos || 0);
    await kvSet(C, 'MUSIC_PROG', JSON.stringify(Object.assign({}, p, { pos: p.dur > 0 ? Math.min(pos, p.dur) : pos, mv: !on, ts: now() })));
  }
  await appendLog(C, me.name, 'Music', '', on ? 'หยุดเพลง' : 'เล่นเพลงต่อ', r.title);
  return { ok: true, paused: on };
};
/* ข้ามเพลงถัดไปในเพลย์ลิสต์ (แอดมิน) — ต่างจาก skip ที่ข้ามทั้งรายการ: ส่งคำสั่งให้ TV เลื่อนไปเพลงถัดไปในเพลย์ลิสต์เดิม */
API.musicNextTrack = async (C, token, id) => {
  const me = await auth(C, token, true); id = str(id);
  const r = await one(C, 'SELECT * FROM music_queue WHERE id=?', id);
  if (!r || r.status !== 'กำลังเล่น') throw new Error('เพลงนี้ไม่ได้กำลังเล่นอยู่แล้ว กรุณารีเฟรช');
  if (r.kind !== 'ytlist') throw new Error('ใช้ได้เฉพาะเพลย์ลิสต์ YouTube');
  await kvSet(C, 'MUSIC_CMD', JSON.stringify({ id, cmd: 'nexttrack', seq: now() }));
  await appendLog(C, me.name, 'Music', '', 'ข้ามเพลงในเพลย์ลิสต์', r.title);
  return { ok: true };
};
API.musicDecide = async (C, token, id, action) => {
  const me = await auth(C, token, true); id = str(id); action = str(action);
  const r = await one(C, 'SELECT * FROM music_queue WHERE id=?', id);
  if (!r) throw new Error('ไม่พบคำขอนี้');
  let label;
  if (action === 'approve') { await muMove(C, id, ['รออนุมัติ'], 'รอคิว'); label = 'อนุมัติเพลง'; }
  else if (action === 'reject') { await muMove(C, id, ['รออนุมัติ'], 'ปฏิเสธ'); label = 'ปฏิเสธเพลง'; }
  else if (action === 'skip') { await muMove(C, id, ['กำลังเล่น'], 'ข้ามแล้ว'); label = 'ข้ามเพลง'; }
  else if (action === 'remove') { await muMove(C, id, ['รออนุมัติ', 'รอคิว'], 'ลบแล้ว'); label = 'ลบเพลงออกจากคิว'; }
  else if (action === 'next') {                                  // ดันขึ้นเป็นเพลงถัดไป (ถ้ายังรออนุมัติ จะอนุมัติให้ด้วย)
    const top = await one(C, "SELECT COALESCE(MIN(seq),1) AS m FROM music_queue WHERE status='รอคิว'");
    await muMove(C, id, ['รออนุมัติ', 'รอคิว'], 'รอคิว');
    await run(C, 'UPDATE music_queue SET seq=? WHERE id=?', (top ? top.m : 1) - 1, id);
    label = 'ดันเป็นเพลงถัดไป';
  } else throw new Error('คำสั่งไม่ถูกต้อง');
  await appendLog(C, me.name, 'Music', '', label, r.title);
  return { ok: true };
};
API.musicApproveAll = async (C, token) => {
  const me = await auth(C, token, true);
  const r = await run(C, "UPDATE music_queue SET status='รอคิว' WHERE status='รออนุมัติ'");
  const n = r.meta.changes || 0;
  if (n) await appendLog(C, me.name, 'Music', '', 'อนุมัติเพลงทั้งหมดที่รออยู่', n + ' เพลง');
  return { count: n };
};
API.musicClearHistory = async (C, token) => {
  const me = await auth(C, token, true);
  const r = await run(C, 'DELETE FROM music_queue WHERE status NOT IN ' + MU_LIVE);
  await appendLog(C, me.name, 'Music', '', 'ล้างประวัติเพลง', (r.meta.changes || 0) + ' รายการ');
  return { count: r.meta.changes || 0 };
};
API.musicSetVolume = async (C, token, v) => {
  const me = await authPerm(C, token, 'music'); v = Math.round(Number(v));
  if (!(v >= 0 && v <= 100)) throw new Error('ความดังต้องอยู่ระหว่าง 0–100');
  await kvSet(C, 'MUSIC_VOL', v); await appendLog(C, me.name, 'Music', '', 'ตั้งความดังเพลง', v + '%');
  return { ok: true, vol: v };
};
API.musicSetAnnounceVolume = async (C, token, v) => {
  const me = await auth(C, token, true); v = Math.round(Number(v));
  if (!(v >= 10 && v <= 100)) throw new Error('ความดังประกาศต้องอยู่ระหว่าง 10–100');
  await kvSet(C, 'ANN_VOL', v); await appendLog(C, me.name, 'Music', '', 'ตั้งความดังเสียงประกาศ', v + '%');
  return { ok: true, avol: v };
};
API.musicSetAuto = async (C, token, on) => {
  const me = await auth(C, token, true); const flag = on === true || on === 'true';
  await kvSet(C, 'MUSIC_AUTO', flag ? '1' : '0'); await appendLog(C, me.name, 'Music', '', flag ? 'เปิดอนุมัติอัตโนมัติ' : 'ปิดอนุมัติอัตโนมัติ', '');
  return { ok: true, auto: flag };
};
API.musicSetMaxUser = async (C, token, n) => {
  const me = await auth(C, token, true); n = Math.round(Number(n));
  if (!(n >= 1 && n <= 10)) throw new Error('จำนวนต้องอยู่ระหว่าง 1–10 เพลง');
  await kvSet(C, 'MUSIC_MAX_USER', n); await appendLog(C, me.name, 'Music', '', 'ตั้งจำนวนเพลงสูงสุดต่อคน', n + ' เพลง');
  return { ok: true, maxUser: n };
};

/* ---------- ฝั่ง TV ---------- */
let tvSeenWrite = 0;
async function muHeartbeat(C) { if (now() - tvSeenWrite > 20000) { tvSeenWrite = now(); await kvSet(C, 'MUSIC_TV_SEEN', now()); } }
API.musicTvPing = async C => { await muHeartbeat(C); return true; };     // TV เรียกระหว่างหยุดเพลงเพื่อประกาศ จะได้ไม่ถูกมองว่าออฟไลน์
API.musicTvTick = async (C, curId, pos, dur, mv, idx, n) => {
  curId = str(curId); await muHeartbeat(C);
  const p = Number(pos), d = Number(dur);
  if (curId && pos !== undefined && pos !== null && pos !== '' && isFinite(p) && p >= 0) {     // TV รายงานว่าเพลงเล่นถึงวินาทีที่เท่าไร
    const o = { id: curId, pos: Math.round(p * 10) / 10, dur: isFinite(d) && d > 0 ? Math.round(d) : 0, mv: mv === true || mv === 'true', ts: now() };
    if (Number(n) > 1) { o.idx = Math.round(Number(idx)) || 0; o.n = Math.round(Number(n)); }
    await kvSet(C, 'MUSIC_PROG', JSON.stringify(o));
  }
  const [s, top] = await Promise.all([musicState(C),
    one(C, "SELECT id,kind,ref,title,who,status FROM music_queue WHERE status IN ('กำลังเล่น','รอคิว') ORDER BY CASE status WHEN 'กำลังเล่น' THEN 0 ELSE 1 END, seq LIMIT 1")]);
  const base = { vol: s.vol, avol: s.avol };
  if (!top) return Object.assign({ action: 'idle' }, base);
  const cmd = s.cmd && s.cmd.id === top.id && now() - s.cmd.seq < 30000 ? s.cmd : null;     // คำสั่งค้างเก่าเกิน 30 วินาทีไม่ทำ (กัน TV รีเฟรชแล้วข้ามซ้ำ)
  const paused = s.pausedId === top.id;                           // เพลงนี้ถูกแอดมินสั่งหยุดอยู่หรือไม่
  if (top.status === 'กำลังเล่น') return top.id === curId ? Object.assign({ action: 'keep', paused, cmd }, base) : Object.assign({ action: 'play', item: muItem(top), paused }, base);
  const r = await run(C, "UPDATE music_queue SET status='กำลังเล่น', t_start=? WHERE id=? AND status='รอคิว'", now(), top.id);
  return r.meta.changes ? Object.assign({ action: 'play', item: muItem(top), paused: false }, base) : Object.assign({ action: 'keep', paused: false }, base);   // อีกเครื่องรับไปก่อน → รอบหน้าค่อยซิงก์
};
API.musicTvEnd = async (C, id, ok) => {
  await run(C, "UPDATE music_queue SET status=?, t_end=? WHERE id=? AND status='กำลังเล่น'", (ok === true || ok === 'true') ? 'เล่นแล้ว' : 'ผิดพลาด', now(), str(id));
  return true;
};

/* ============================ รายการบาร์เดี่ยว/บาร์แพ็ค (เก็บใน D1 + นำเข้าจาก Excel) ============================
 * ข้อมูลทั้งหมดอยู่ใน Cloud (ตาราง barcode_items / barcode_cats) แก้ไขผ่านหน้าเว็บ · นำเข้าจาก Excel ได้ (หัวตารางอ่านจากชื่อคอลัมน์)
 * ก่อนนำเข้า/กู้คืนทุกครั้งระบบทำสำเนาไว้ให้ เก็บล่าสุดแค่ BACKUP_KEEP ชุด */
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
const bcRow = (r, no) => ({ r: r.id, v: [no, str(r.partner), str(r.cat), str(r.name), str(r.perPack), str(r.packBar), '', str(r.unitBar), '', '', ''] });
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

/* ฟอนต์ตอนปริ้นรายงานบาร์ — แอดมินตั้งครั้งเดียว ใช้กับทุกคน (เฉพาะฟอนต์ในรายการนี้ ซึ่งมีน้ำหนัก 400 และ 700 ครบทั้งหมด) */
const BC_FONTS = ['Bai Jamjuree', 'Mali', 'Sarabun', 'Prompt', 'Kanit', 'Niramit', 'Noto Sans Thai', 'Pridi', 'Taviraj', 'K2D', 'Athiti', 'Mitr', 'Krub', 'Maitree', 'TH Sarabun New', 'Tahoma'];
const BC_FONT_DEF = 'Bai Jamjuree';
/* ============================== ตั้งค่าหน้าจอ TV (tv.html) ============================== */
const TV_DEF = { shop: 'ร้านสหกรณ์ มช. (CMU CO-OP)', helloMain: 'ยินดีต้อนรับ', helloSub: '"ขอให้วันนี้เป็นวันที่สดใสสำหรับคุณ"', caption: 'ร้านสหกรณ์ มช. ยินดีให้บริการ',
  bg: '#a07ab8', width: 760, bannerH: 230, receiverH: 430, fontClock: 22, fontShop: 22, fontHello: 22, fontCaption: 22, capSpeed: 80, gap: 14, padTop: 14, logoSize: 84, headGap: 18, gapBanner: null, gapCaption: null, gapReceiver: null, gapFoot: null, bannerW: 0, receiverW: 0, font: 'Sarabun', headLayout: 'side', showClock: true, showLogo: true, showBanner: true };
const TV_TXT = { shop: 80, helloMain: 60, helloSub: 100, caption: 120 };
const TV_NUM = { width: [480, 3840, 'ความกว้างหน้า'], bannerH: [60, 2000, 'ความสูงแบนเนอร์'], receiverH: [150, 2000, 'ความสูงกรอบตัวรับเสียง'],
  gap: [0, 200, 'ระยะห่างระหว่างส่วน'], logoSize: [20, 600, 'ขนาดโลโก้'], padTop: [0, 600, 'ระยะห่างขอบด้านบนสุด'], headGap: [0, 200, 'ระยะห่างโลโก้กับข้อความ'], bannerW: [0, 3840, 'ความกว้างแบนเนอร์ (0 = เต็มหน้า)'], receiverW: [0, 3840, 'ความกว้างกรอบตัวรับเสียง (0 = เต็มหน้า)'],
  fontClock: [10, 200, 'ขนาดตัวอักษรนาฬิกา'], fontShop: [10, 200, 'ขนาดตัวอักษรชื่อร้าน'], fontHello: [10, 200, 'ขนาดตัวอักษรข้อความต้อนรับ'],
  fontCaption: [10, 200, 'ขนาดตัวอักษรข้อความใต้แบนเนอร์'], capSpeed: [10, 400, 'ความเร็วข้อความไหล'] };
const TV_OPT = { gapBanner: 'ระยะห่างเหนือแบนเนอร์', gapCaption: 'ระยะห่างเหนือข้อความไหล', gapReceiver: 'ระยะห่างเหนือกรอบตัวรับเสียง', gapFoot: 'ระยะห่างเหนือท้ายหน้า' };   // เว้นว่าง = ใช้ค่าระยะห่างรวม (null)
const TV_LAYOUTS = ['side', 'stack', 'row', 'topRow'];   // โลโก้ข้างข้อความ / เรียงลงทั้งหมด / เรียงข้างทั้งหมด / โลโก้บน ข้อความเรียงข้าง
const TV_BOOL = ['showClock', 'showLogo', 'showBanner'];
function tvNorm(o, strict) {
  o = o && typeof o === 'object' ? o : {}; const out = {};
  Object.keys(TV_TXT).forEach(k => {
    if (o[k] === undefined || o[k] === null) { out[k] = TV_DEF[k]; return; }
    const v = str(o[k]); if (v.length > TV_TXT[k]) { if (strict) throw new Error('ข้อความยาวเกิน ' + TV_TXT[k] + ' ตัวอักษร'); out[k] = v.slice(0, TV_TXT[k]); } else out[k] = v;
  });
  Object.keys(TV_NUM).forEach(k => {
    const [mn, mx, nm] = TV_NUM[k]; let v = Number(o[k]);
    if (o[k] === undefined || o[k] === null || o[k] === '' || !isFinite(v)) { if (strict && o[k] !== undefined) throw new Error(nm + 'ต้องเป็นตัวเลข'); out[k] = TV_DEF[k]; return; }
    v = Math.round(v); if (v < mn || v > mx) { if (strict) throw new Error(nm + 'ต้องอยู่ระหว่าง ' + mn + '–' + mx + ' px'); v = Math.min(mx, Math.max(mn, v)); }
    out[k] = v;
  });
  Object.keys(TV_OPT).forEach(k => {
    if (o[k] === undefined || o[k] === null || o[k] === '') { out[k] = null; return; }
    let v = Number(o[k]);
    if (!isFinite(v)) { if (strict) throw new Error(TV_OPT[k] + 'ต้องเป็นตัวเลข'); out[k] = null; return; }
    v = Math.round(v); if (v < 0 || v > 200) { if (strict) throw new Error(TV_OPT[k] + 'ต้องอยู่ระหว่าง 0–200 px'); v = Math.min(200, Math.max(0, v)); }
    out[k] = v;
  });
  out.font = BC_FONTS.includes(str(o.font)) ? str(o.font) : TV_DEF.font;
  out.headLayout = TV_LAYOUTS.includes(str(o.headLayout)) ? str(o.headLayout) : TV_DEF.headLayout;
  out.bg = /^#[0-9a-f]{6}$/i.test(str(o.bg)) ? str(o.bg).toLowerCase() : TV_DEF.bg;
  TV_BOOL.forEach(k => { out[k] = o[k] === undefined || o[k] === null ? TV_DEF[k] : !(o[k] === false || o[k] === 'false'); });
  return out;
}
const tvCfg = async C => tvNorm(await kvJson(C, 'TV_CFG', {}), false);
API.getTvPublic = C => tvCfg(C);                       // tv.html เรียกโดยไม่ต้องล็อกอิน (เป็นข้อความตั้งค่าล้วน ไม่มีข้อมูลลับ)
API.getTvConfig = async (C, token) => { await auth(C, token, true); return { cfg: await tvCfg(C), def: TV_DEF }; };
API.setTvConfig = async (C, token, o) => {
  const me = await auth(C, token, true), cfg = tvNorm(o, true);
  await kvSet(C, 'TV_CFG', JSON.stringify(cfg));
  await appendLog(C, me.name, 'TV', '', 'ตั้งค่าหน้าจอ TV', cfg.shop + ' · แบนเนอร์สูง ' + cfg.bannerH + ' · ตัวรับเสียงสูง ' + cfg.receiverH);
  return { ok: true, cfg };
};
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
  const map = {}, list = [];
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
  const rows = cat === '*' ? await all(C, 'SELECT * FROM barcode_items ORDER BY pos') : await all(C, 'SELECT * FROM barcode_items WHERE cat=? ORDER BY pos', cat);
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
  if (!a || a.p == null) a = await one(C, 'SELECT MAX(pos) AS p FROM barcode_items WHERE cat=?', v.cat);
  if (!a || a.p == null) a = await one(C, 'SELECT MAX(pos) AS p FROM barcode_items');
  const at = ((a && a.p) || 0) + 1;                       // แทรกต่อจากรายการของคู่ค้า/หมวดเดียวกัน
  await run(C, 'UPDATE barcode_items SET pos=pos+1 WHERE pos>=?', at);
  const r = await run(C, 'INSERT INTO barcode_items(pos,sheet,partner,cat,name,packBar,unitBar,perPack,ts,who) VALUES(?,?,?,?,?,?,?,?,?,?)', at, BC_SHEET, v.partner, v.cat, v.name, v.packBar, v.unitBar, v.perPack, now(), me.name);
  await run(C, 'DELETE FROM barcode_cats WHERE cat=?', v.cat);
  await bcLog(C, me, v.cat, 'เพิ่มรายการ', v.name + (v.packBar ? ' · แพ็ค ' + v.packBar : '') + (v.unitBar ? ' · เดี่ยว ' + v.unitBar : ''));
  return { ok: true, cat: v.cat, row: r.meta.last_row_id };
};
API.editItem = async (C, token, sheet, row, oldName, vals, force) => {
  const me = await auth(C, token, true); vals = vals || {};
  const cur = await one(C, 'SELECT * FROM barcode_items WHERE id=?', Number(row) || 0);
  if (!cur || str(cur.name) !== str(oldName)) throw new Error('ข้อมูลเปลี่ยนไปแล้ว กรุณาโหลดใหม่ก่อนแก้ไข');
  const src = {}; BC_FIELDS.forEach(k => { src[k] = vals[k] === undefined ? cur[k] : vals[k]; });
  const v = bcVals(src);
  if (!v.name) throw new Error('กรุณากรอกชื่อรายการ');
  if (!v.cat) throw new Error('กรุณากรอกหมวด');
  const changed = BC_FIELDS.filter(k => str(cur[k]) !== v[k]);
  if (!changed.length) return { ok: true, nochange: true, cat: str(cur.cat) };
  if (!force) { const d = await bcDup(C, v, cur.id); if (d) return { duplicate: true, message: d }; }
  await run(C, 'UPDATE barcode_items SET partner=?,cat=?,name=?,packBar=?,unitBar=?,perPack=?,ts=?,who=? WHERE id=?', v.partner, v.cat, v.name, v.packBar, v.unitBar, v.perPack, now(), me.name, cur.id);
  await bcLog(C, me, v.cat, 'แก้ไขรายการ', str(oldName) + ' · ' + changed.map(k => k + ': ' + str(cur[k]) + ' → ' + v[k]).join(' | '));
  return { ok: true, cat: v.cat };
};
API.deleteItem = async (C, token, sheet, row, name) => {
  const me = await auth(C, token, true);
  const cur = await one(C, 'SELECT * FROM barcode_items WHERE id=?', Number(row) || 0);
  if (!cur || str(cur.name) !== str(name)) throw new Error('ข้อมูลเปลี่ยนไปแล้ว กรุณาโหลดใหม่ก่อนลบ');
  await run(C, 'DELETE FROM barcode_items WHERE id=?', cur.id);
  if (!(await one(C, 'SELECT 1 AS x FROM barcode_items WHERE cat=?', cur.cat))) await run(C, 'INSERT OR IGNORE INTO barcode_cats(cat) VALUES(?)', cur.cat);   // หมวดว่างยังอยู่
  await bcLog(C, me, str(cur.cat), 'ลบรายการ', str(cur.name) + (cur.packBar ? ' · แพ็ค ' + cur.packBar : '') + (cur.unitBar ? ' · เดี่ยว ' + cur.unitBar : ''));
  return { ok: true };
};
API.getLog = async (C, token, limit) => {
  await auth(C, token, true); limit = Math.min(Math.max(Number(limit) || 80, 1), 500);
  return (await all(C, 'SELECT ts,who,sheet,cat,action,detail FROM log WHERE sheet=? ORDER BY id DESC LIMIT ?', BC_SHEET, limit)).map(r => ({ ts: r.ts, who: str(r.who), sheet: str(r.sheet), cat: str(r.cat), action: str(r.action), detail: str(r.detail) }));
};

/* ---------- สำเนา (เก็บ 2 ชุดล่าสุด) ---------- */
const bcBackups = async C => (await all(C, 'SELECT id,ts,name FROM backups WHERE kind=? ORDER BY id DESC', 'barcode')).map(b => ({ id: b.id, ts: b.ts, name: b.name }));
async function bcSnapshot(C, why) {
  const rows = await all(C, 'SELECT partner,cat,name,packBar,unitBar,perPack FROM barcode_items ORDER BY pos');
  const cats = (await all(C, 'SELECT cat FROM barcode_cats')).map(r => str(r.cat));
  if (rows.length || cats.length) {
    const data = JSON.stringify({ rows: rows.map(r => [str(r.partner), str(r.cat), str(r.name), str(r.packBar), str(r.unitBar), str(r.perPack)]), cats });
    if (data.length > 1900000) throw new Error('ข้อมูลใหญ่เกินกว่าจะทำสำเนาได้');
    const hash = (await sha256hex(data)).slice(0, 24), last = await one(C, 'SELECT hash FROM backups WHERE kind=? ORDER BY id DESC LIMIT 1', 'barcode');
    if (!last || last.hash !== hash) {
      await run(C, 'INSERT INTO backups(kind,ts,name,hash,data) VALUES(?,?,?,?,?)', 'barcode', now(), rows.length + ' รายการ · ' + why, hash, data);
      await run(C, 'DELETE FROM backups WHERE kind=? AND id NOT IN (SELECT id FROM backups WHERE kind=? ORDER BY id DESC LIMIT ?)', 'barcode', 'barcode', BACKUP_KEEP);
    }
  }
  return bcBackups(C);
}
API.barcodeBackupList = async (C, token) => { await auth(C, token, true); return { backups: await bcBackups(C) }; };
API.barcodeBackupData = async (C, token, id) => {
  await auth(C, token, true);
  const b = await one(C, 'SELECT data FROM backups WHERE id=? AND kind=?', Number(id) || 0, 'barcode');
  if (!b) throw new Error('ไม่พบสำเนานี้ (อาจถูกแทนที่ด้วยสำเนาใหม่แล้ว)');
  const q = v => '"' + String(v).replace(/"/g, '""') + '"';
  return { name: 'สำเนารายการบาร์', csv: '﻿' + [['รหัสคู่ค้า', 'หมวด', 'ชื่อรายการ', 'เลขบาร์แพ็ค', 'เลขบาร์เดี่ยว', 'จำนวนต่อแพ็ค']].concat(JSON.parse(b.data).rows).map(r => r.map(q).join(',')).join('\r\n') };
};
async function bcStage(C, who, items, startPos) {
  const job = uuid(), ts = now();
  try {
    await run(C, 'DELETE FROM barcode_stage WHERE ts<?', ts - 86400000);
    for (let i = 0; i < items.length; i += 80) await batch(C, items.slice(i, i + 80).map((r, j) => stmt(C,
      'INSERT INTO barcode_stage(job,pos,sheet,partner,cat,name,packBar,unitBar,perPack,ts,who) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      job, startPos + i + j + 1, BC_SHEET, r.partner, r.cat, r.name, r.packBar, r.unitBar, str(r.perPack), ts, who)));
    return job;
  } catch (e) { try { await run(C, 'DELETE FROM barcode_stage WHERE job=?', job); } catch (_) { /* ล้างรายการค้างในรอบถัดไป */ } throw e; }
}
const bcPublishStage = (C, job) => stmt(C, 'INSERT INTO barcode_items(pos,sheet,partner,cat,name,packBar,unitBar,perPack,ts,who) SELECT pos,sheet,partner,cat,name,packBar,unitBar,perPack,ts,who FROM barcode_stage WHERE job=? ORDER BY pos', job);
API.barcodeRestore = async (C, token, id) => {
  const me = await auth(C, token, true);
  const b = await one(C, 'SELECT data FROM backups WHERE id=? AND kind=?', Number(id) || 0, 'barcode');
  if (!b) throw new Error('ไม่พบสำเนานี้');
  const d = JSON.parse(b.data), items = d.rows.map(a => ({ partner: a[0], cat: a[1], name: a[2], packBar: a[3], unitBar: a[4], perPack: a[5] || '' }));
  await bcSnapshot(C, 'ก่อนกู้คืน');
  const job = await bcStage(C, me.name, items, 0);
  try {
    await batch(C, [stmt(C, 'DELETE FROM barcode_items'), stmt(C, 'DELETE FROM barcode_cats')].concat((d.cats || []).map(c => stmt(C, 'INSERT OR IGNORE INTO barcode_cats(cat) VALUES(?)', c)), [bcPublishStage(C, job), stmt(C, 'DELETE FROM barcode_stage WHERE job=?', job)]));
  } catch (e) { try { await run(C, 'DELETE FROM barcode_stage WHERE job=?', job); } catch (_) {} throw e; }
  await bcLog(C, me, '', 'กู้คืนจากสำเนา', items.length + ' รายการ');
  return { ok: true, count: items.length, backups: await bcBackups(C) };
};

/* ---------- นำเข้าจาก Excel ---------- */
const BC_PATS = [
  ['perPack', /ต่อแพ็ค|ต่อแพค|ต่อ\s*pack|per\s*pack/i],
  ['packBar', /แพ็ค|แพค|pack/i, /บาร์|bar|รหัส|เลข|code/i], ['unitBar', /เดี่ยว|เดียว|unit|single|ชิ้น/i, /บาร์|bar|รหัส|เลข|code/i],
  ['partner', /คู่ค้า|ซัพพลายเออร์|supplier|vendor|partner/i], ['cat', /หมวด|categor/i], ['name', /ชื่อ|name|^รายการ|description/i]];
function parseBarGrid(grid, defCat) {
  grid = Array.isArray(grid) ? grid : [];
  for (let h = 0; h < Math.min(grid.length, 30); h++) {
    const cols = {};
    (grid[h] || []).forEach((cell, c) => {
      const label = str(cell); if (!label) return;
      for (const [k, re, re2] of BC_PATS) if (cols[k] === undefined && re.test(label) && (!re2 || re2.test(label))) { cols[k] = c; break; }
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
  const job = await bcStage(C, me.name, add, start), ops = [];
  if (replace) ops.push(stmt(C, 'DELETE FROM barcode_items'), stmt(C, 'DELETE FROM barcode_cats'));
  ops.push(bcPublishStage(C, job), stmt(C, 'DELETE FROM barcode_stage WHERE job=?', job));
  try { await batch(C, ops); }
  catch (e) { try { await run(C, 'DELETE FROM barcode_stage WHERE job=?', job); } catch (_) {} throw e; }
  await bcLog(C, me, '', 'นำเข้าจาก Excel', (replace ? 'แทนที่ทั้งหมด' : 'เพิ่มต่อท้าย') + ' · ' + add.length + ' รายการ' + (dup ? ' · ข้ามซ้ำ ' + dup : ''));
  return { ok: true, count: add.length, duplicates: dup, notes, backups: await bcBackups(C) };
};

/* ============================== สินค้าค้างสต็อก ==============================
 * หน้า stock.html อ่านไฟล์ Excel (รายงานวิเคราะห์การขาย 1 ชีต = 1 กลุ่มสินค้า) ในเบราว์เซอร์ แล้วส่งเฉพาะรายการที่ยังมีสต็อกมาเก็บที่นี่
 * แถว = [กลุ่ม, รหัส, ชื่อ, สาขา, คงเหลือ, รวมขาย, เฉลี่ยขาย, รับเข้า, ขายล่าสุด, ค้าง(วัน), สถานะ, ต้นทุน, ราคา, หมายเหตุ, วันที่ของรายงาน,
 *        ต่ำกว่าทุน('-'/'B'), กำไร฿, กำไร%, ยอดขาย, กำไรสุทธิ V]
 * เก็บแยกรายหมวดใน D1 (ตาราง stock_grp: g, ver, n, data) — ver 0 = ฉบับปัจจุบัน, ver 1 = ฉบับก่อนหน้า (เก็บไว้ 1 ฉบับต่อหมวด)
 * kv: STOCK_GROUPS = { G01: { cur: meta, prev: meta|null } }, STOCK_HISTORY (ผลรวมทั้งร้านแต่ละรอบ ใช้วาดกราฟแนวโน้ม), STOCK_NAMES */
const STOCK_CHUNK = 400000;        // ตัวอักษรต่อก้อน (ภาษาไทย 3 ไบต์/ตัว → ไม่เกิน ~1.2 MB ต่อแถว ต่ำกว่าเพดาน 2 MB ของ D1)
const STOCK_MAX_ROWS = 30000, STOCK_HISTORY_MAX = 36, STOCK_ST = ['DS', 'T3', 'T2', 'T1', ''];
const STOCK_GROUP_RE = /^[A-Z0-9_-]{1,12}$/;
const stockCodeKey = s => str(s).replace(/\s+/g, '').toLowerCase();    // เทียบบาร์/รหัสสินค้าแบบไม่สนช่องว่าง/ตัวพิมพ์ (หน้าเว็บใช้สูตรเดียวกัน)
const STOCK_LOST_MAX = 5000;
/* ของหาย / สินค้าหมดอายุ: เก็บ "จำนวน" เท่านั้น (ไม่ตัดทั้งบาร์) แล้วหักออกจากคงเหลือของแถวที่มีรหัสตรงกัน
 * kv STOCK_LOST / STOCK_EXPIRED = { <codeKey>[@<สาขา>]: { code, name, g, br, qty, note, ts, who } } — แยกจากข้อมูลสต็อก อัปโหลดใหม่ไม่แตะ
 * br ว่าง = หักจากทุกสาขาตามลำดับแถวที่พบ · br มีค่า = หักเฉพาะสาขานั้น · qty ว่าง (ข้อมูลเก่าก่อนมีจำนวน) = หักทั้งบาร์ */
const STOCK_ADJ_KV = { lost: 'STOCK_LOST', exp: 'STOCK_EXPIRED', pend: 'STOCK_PENDING', waste: 'STOCK_WASTE' }, STOCK_ADJ_LABEL = { lost: 'ของหาย', exp: 'สินค้าหมดอายุ', pend: 'รอปรับข้อมูล', waste: 'ของเสีย' };
const stockAdjKey = (code, br) => stockCodeKey(code) + (stockBrKey(br) ? '@' + stockBrKey(br) : '');
async function stockAdjLoad(C) {
  const out = {};
  for (const kind of Object.keys(STOCK_ADJ_KV)) {
    const raw = (await stateJson(C, STOCK_ADJ_KV[kind], {})) || {}, m = {};
    Object.keys(raw).forEach(k => {
      const v = raw[k];
      if (!k || !v || typeof v !== 'object' || !str(v.code) || (v.qty != null && (!Number.isFinite(Number(v.qty)) || Number(v.qty) < 0))) throw new Error('ข้อมูลรายการ' + STOCK_ADJ_LABEL[kind] + 'ไม่ถูกต้อง กรุณาติดต่อผู้ดูแล');
      m[k] = v;
    });
    out[kind] = m;
  }
  return out;
}
/* หักจำนวนของหาย/หมดอายุออกจากแถว → { rows: แถวที่ยังเหลือ (คงเหลือ > 0 · แถวที่ถูกหักจะเป็นสำเนา ไม่แก้ของเดิม), hit: { lost|exp: { key: [{ g, br, qty, cost, name }] } } }
 * จำนวนสต็อกมากกว่าที่หัก → แถวยังอยู่ด้วยจำนวนที่เหลือ · หักหมดหรือเกิน → แถวหายไป · รายการที่ระบุสาขาหักก่อน แล้วค่อยหักแบบทุกสาขา */
function stockApply(rows, adj) {
  const hit = { lost: {}, exp: {}, pend: {}, waste: {} }, by = new Map();
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
const stockBrKey = s => str(s).replace(/\s+/g, '').toLowerCase();      // เทียบชื่อสาขาแบบไม่สนช่องว่าง/ตัวพิมพ์
const stockDate = v => {
  v = str(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return '';
  const d = new Date(v + 'T00:00:00Z');
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : '';
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
function stockGroupSums(state) {                                  // ยอด DS/T3 รายหมวด (ฉบับปัจจุบัน) เก็บคู่กับประวัติแต่ละรอบ → กราฟแนวโน้มแยกหมวด · { G01: { DS: [รายการ, มูลค่าทุน], T3: [..] } }
  const out = {};
  Object.keys(state).forEach(g => {
    const m = state[g] && state[g].cur, st = m && m.sum && m.sum.st; if (!st) return;
    out[g] = { DS: [st.DS ? st.DS.n : 0, st.DS ? Math.round(st.DS.cost) : 0], T3: [st.T3 ? st.T3.n : 0, st.T3 ? Math.round(st.T3.cost) : 0] };
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
  for (let i = 0, n = 0; i < json.length; i += STOCK_CHUNK, n++) ops.push(stmt(C, 'INSERT OR REPLACE INTO stock_grp(g,ver,n,data) VALUES(?,?,?,?)', g, ver, n, json.slice(i, i + STOCK_CHUNK)));
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
/* สถานะรายหมวด — ถ้ายังไม่เคยมี (ระบบเดิมเก็บทุกหมวดรวมกันใน stock_data) ย้ายข้อมูลเดิมเข้ามาเป็นฉบับปัจจุบันของแต่ละหมวดหนึ่งครั้ง */
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
    legacy.map(stockCleanRow).filter(Boolean).forEach(r => { (by[r[0]] || (by[r[0]] = [])).push(r); });
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
function thaiDayIso(ts) {
  var date = new Date(ts == null ? Date.now() : ts);
  if (!Number.isFinite(date.getTime())) return '';
  try {
    var parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    var obj = {};
    parts.forEach(function (part) { obj[part.type] = part.value; });
    return obj.year + '-' + obj.month + '-' + obj.day;
  } catch (e) {
    return new Date(date.getTime() + 7 * 3600000).toISOString().slice(0, 10);
  }
}
function stockDayKey(ts) { return thaiDayIso(ts); }
function stockDailyHistory(hist) {
  if (!Array.isArray(hist)) return [];
  const byDay = new Map();
  hist.forEach(x => {
    if (!x || !x.ts) return;
    const dk = stockDayKey(x.ts), prev = byDay.get(dk);
    if (!prev || x.ts >= prev.ts) {
      const merged = Object.assign({}, x);
      if (prev && prev.gs && !merged.gs) merged.gs = prev.gs;
      byDay.set(dk, merged);
    }
  });
  return Array.from(byDay.values()).sort((a, b) => a.ts - b.ts);
}
function stockPushHistory(hist, entry) {
  return stockDailyHistory([...(Array.isArray(hist) ? hist : []), entry]).slice(-STOCK_HISTORY_MAX);
}
API.stockGet = async (C, token, ver) => {
  const me = await authPerm(C, token, 'stock'), v = ver === 'prev' ? 1 : 0;
  const state = await stockState(C);
  const [rows0, history, names, lost, hard, bcRows] = await Promise.all([
    stockLoadRows(C, v),
    stateJson(C, 'STOCK_HISTORY', []),
    stockNames(C),
    stockAdjLoad(C),
    stockHardLoad(C),
    all(C, 'SELECT partner,cat,name,perPack,packBar,unitBar FROM barcode_items ORDER BY pos').catch(() => [])
  ]);
  const ap = stockApply(rows0, lost);
  const foundGroups = new Set(rows0.map(r => r[0]));
  Object.keys(state).forEach(g => {
    const meta = state[g] && state[g][v ? 'prev' : 'cur'];
    if (meta && meta.count > 0 && !foundGroups.has(g)) throw new Error('ข้อมูลสต็อกไม่ครบ (หมวด ' + g + ') กรุณาติดต่อผู้ดูแล');
  });
  stockSideSummaries(state, v ? 'prev' : 'cur', ap.rows);
  const barcodes = (bcRows || []).map(r => [str(r.packBar), str(r.unitBar), str(r.perPack), str(r.name), str(r.cat), str(r.partner)]);
  // ของหาย/สินค้าหมดอายุ: หักจำนวนออกจากแถวแล้ว (แถวที่ยังเหลือแสดงตามปกติด้วยจำนวนที่เหลือ) · เก็บรายละเอียดที่หักไว้แสดงในหน้า "ของหาย"/"สินค้าหมดอายุ"
  const adjList = kind => Object.keys(lost[kind]).map(k => { const e = lost[kind][k], h = ap.hit[kind][k] || []; return { k, code: str(e.code), br: str(e.br), qty: (e.qty === null || e.qty === undefined) ? null : (Number(e.qty) || 0), name: (h[0] && h[0].name) || str(e.name), note: str(e.note), ts: e.ts || 0, who: str(e.who), hit: h }; }).sort((a, b) => b.ts - a.ts);
  return { me: { name: me.name, role: me.role, edit: me.role === 'admin' || !!me.perms.stock_edit }, ver: v ? 'prev' : 'cur', groups: state, rows: ap.rows, zero: ap.zero, cut: ap.cut, history: Array.isArray(history) ? stockDailyHistory(history) : [], names, lost: adjList('lost'), expired: adjList('exp'), pending: adjList('pend'), waste: adjList('waste'), hard, barcodes };
};
/* payload = { fileName, branch, groups: [{ g, rep, title, rows }] } — อัปโหลดแยกสาขา: แทนที่เฉพาะแถวของ "สาขา branch" ในหมวดที่ส่งมา
 * แถวของสาขาอื่นในหมวดเดียวกัน และหมวดอื่นทั้งหมด ไม่ถูกแตะ
 * ฉบับปัจจุบันของหมวดนั้น (ทุกสาขา) ถูกย้ายไปเป็น "ฉบับก่อนหน้า" (ทับฉบับก่อนหน้าเดิม) · ถ้าข้อมูลเหมือนฉบับปัจจุบันทุกอย่างจะข้าม ไม่ดันฉบับเก่าทิ้ง
 * meta ของหมวดมี br = { สาขา: { count, rep, ts, who, file } } ไว้บอกว่าแต่ละสาขาอัปเดตล่าสุดเมื่อไร */
API.stockSave = async (C, token, payload) => {
  const me = await stockEditAuth(C, token);
  payload = payload || {};
  if (!Array.isArray(payload.groups) || !payload.groups.length) throw new Error('ไม่พบข้อมูลในไฟล์');
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
    // อัปเดตเฉพาะแถวที่เปลี่ยน: เทียบรายแถวของสาขานี้ (กลุ่ม+รหัส+ชื่อ+สาขา) · แถวเหมือนเดิมคงไว้ตามเดิม · แถวที่เปลี่ยนแทนที่ตรงตำแหน่งเดิม · แถวใหม่ต่อท้าย · แถวที่หายไปจากไฟล์ใหม่ (ไม่มีของแล้ว) ตัดออก · สาขาอื่นไม่แตะ
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
  await stockRebuildSummaries(C, state, lost, replacements);
  const dates = Object.keys(state).map(g => state[g].cur && state[g].cur.rep).filter(Boolean).sort(), sum = stockTotal(state);
  const hist = stockPushHistory(await stateJson(C, 'STOCK_HISTORY', []), { ts, who: me.name, file, branch, to: dates[dates.length - 1] || '', sum, gs: stockGroupSums(state) });
  ops.push(kvSetStmt(C, 'STOCK_GROUPS', JSON.stringify(state)), kvSetStmt(C, 'STOCK_HISTORY', JSON.stringify(hist)));
  await batch(C, ops);
  await sysLogTo(C, me.name, 'สินค้าค้างสต็อก', 'อัปโหลดไฟล์ Excel', (file || '(ไม่ระบุชื่อ)') + ' · สาขา ' + branch + ' · อัปเดต ' + changed.length + ' หมวด (' + changed.join(',') + ') · เพิ่ม ' + tot.add + ' เปลี่ยน ' + tot.chg + ' ลบ ' + tot.del + ' เหมือนเดิม ' + tot.same + ' แถว' + (same.length ? ' · ไม่เปลี่ยน ' + same.length + ' หมวด' : ''));
  return { ok: true, changed, same, diff, tot };
};
/* สลับฉบับปัจจุบันกับฉบับก่อนหน้าของหมวดนั้น (กดซ้ำ = สลับกลับ) */
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
/* แก้ไขข้อมูลสินค้าค้างสต็อกได้: แอดมิน หรือผู้ใช้ที่แอดมินติ๊ก "แก้ไขได้" ให้ · ผู้ใช้ที่มีสิทธิ์ดูอย่างเดียวจะเห็นข้อมูลแต่แก้ไม่ได้ */
async function stockEditAuth(C, token) {
  const me = await auth(C, token);
  if (!me.perms.stock) throw new Error('คุณไม่มีสิทธิ์ใช้งานส่วนนี้');
  if (me.role !== 'admin' && !me.perms.stock_edit) throw new Error('บัญชีนี้มีสิทธิ์ดูข้อมูลอย่างเดียว ไม่สามารถแก้ไขได้');
  return me;
}
/* ยืนยันรหัสผ่านของแอดมินที่กำลังใช้งาน (หรือรหัสกู้คืนแอดมิน สำหรับบัญชีที่เข้าทางลิงก์) · ใส่ผิดนับรวมกับการล็อกอิน (5 ครั้ง = รอ 5 นาที) */
async function stockVerifyPw(C, me, password) {
  password = passArg(password);
  if (!password) throw new Error('กรุณาใส่รหัสผ่านเพื่อยืนยัน');
  const lockKey = 'fail:' + me.user, fails = await failCount(C, lockKey);
  if (fails >= MAX_FAIL) throw new Error('ใส่รหัสผิดหลายครั้ง กรุณารอ 5 นาทีแล้วลองใหม่');
  const u = await getUser(C, me.user);
  if (!u) throw new Error('SESSION_EXPIRED');
  if (u.hash !== await hashPw(u.salt, password) && !(await checkRecovery(C, password))) { await failBump(C, lockKey, fails + 1); throw new Error('รหัสผ่านไม่ถูกต้อง'); }
  await failClear(C, lockKey);
}
/* ล้างข้อมูล (แอดมิน + ต้องใส่รหัส) scope = { mode:'all' } | { mode:'branch', branch } | { mode:'group', g }
 * branch/group: ฉบับที่ล้างเก็บเป็น "ฉบับก่อนหน้า" กู้คืนได้ · all: ลบทุกอย่างรวมฉบับก่อนหน้าและประวัติแนวโน้ม (ย้อนกลับไม่ได้ · ชื่อหมวดคงไว้) */
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
    state[g] = { cur: { ts, who: me.name, file: 'ล้างข้อมูล', rep: reps[reps.length - 1] || '', title: '', count: rows.filter(r => r[4] > 0).length, sum: stockSummary(rows, lost), br }, prev: oc || null };
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
    const bk = stockBrKey(branch);
    for (const g of Object.keys(state)) {
      if (!state[g] || !state[g].cur) continue;
      const rows = stockParseRows((await stockGroupJson(C, g, 0)) || '[]', 'หมวด ' + g);
      const keep = rows.filter(r => stockBrKey(r[3]) !== bk);
      if (keep.length !== rows.length) { replacements.prev.set(g, rows); shiftGroup(g, keep, branch); }
    }
    desc = 'ล้างทั้งสาขา ' + branch;
  } else throw new Error('เลือกสิ่งที่จะล้างไม่ถูกต้อง');
  if (!changed.length) return { ok: true, changed };
  await stockRebuildSummaries(C, state, lost, replacements);
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
      ops.push(stmt(C, 'DELETE FROM stock_grp WHERE g=? AND ver=0', code), ...stockInsertOps(C, code, 0, JSON.stringify(keep)));
    }
  } else {
    delete state[code];
    delete names[code];
    Object.keys(names).forEach(k => { if (k.endsWith(':' + code)) delete names[k]; });
    ops.push(stmt(C, 'DELETE FROM stock_grp WHERE g=?', code));
  }
  const replacements = { cur: new Map() };
  if (state[code] && state[code].cur && bk) {
    const rows = stockParseRows((await stockGroupJson(C, code, 0)) || '[]', 'หมวด ' + code);
    replacements.cur.set(code, rows.filter(r => stockBrKey(r[3]) !== bk));
  }
  await stockRebuildSummaries(C, state, lost, replacements);
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

/* ============================== แท็ก "สินค้าขายยาก" ==============================
 * ผูกกับรหัสสินค้า/บาร์ (ทุกสาขา) เก็บใน KV 'STOCK_HARD' = { stockCodeKey: { code, ts, who } }
 * อัปโหลดไฟล์ใหม่/ล้างข้อมูล/สลับฉบับ ไม่แตะแท็ก → ติดอยู่จนกว่าจะยกเลิก (ดูอย่างเดียวก็เห็นแท็กได้ · แก้ไขต้องมีสิทธิ์ stock_edit) */
async function stockHardLoad(C) {
  const raw = (await stateJson(C, 'STOCK_HARD', {})) || {}, out = {};
  Object.keys(raw).forEach(k => { const e = raw[k]; if (k && e && typeof e === 'object') out[k] = { code: str(e.code), ts: e.ts || 0, who: str(e.who), note: str(e.note).slice(0, 100) }; });
  return out;
}
/* codes = รหัส/บาร์ 1 ตัว หรือรายการ · on = true ติดแท็ก, false ยกเลิก */
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

/* ============================== ของหาย / สินค้าหมดอายุ / รอปรับข้อมูล ==============================
 * รายการที่ใส่ไว้ที่นี่ = บาร์ + "จำนวน" ที่หาย/หมดอายุ (จำเฉพาะจำนวน) → หักออกจากคงเหลือ (stockGet / stockSummary ผ่าน stockApply)
 *   สต็อกมากกว่าจำนวนที่หัก → ยังแสดงรายการตามปกติด้วยจำนวนที่เหลือ · หักหมด → รายการหายไปจากตาราง
 * บาร์/รหัสตรงกับคอลัมน์ "รหัส" ในไฟล์รายงาน · เลือกสาขาได้ (ไม่เลือก = ทุกสาขา) · เพิ่มบาร์เดิมซ้ำ = บวกจำนวนเพิ่ม
 * อัปโหลดไฟล์ใหม่/ล้างข้อมูล/สลับฉบับ ไม่แตะรายการนี้ → หักต่อไปจนกว่าจะยกเลิก (stockLostRemove / stockExpiredRemove)
 * เปลี่ยนรายการแล้วคำนวณยอดสรุป (sum) ของทุกหมวดทั้งฉบับปัจจุบัน/ก่อนหน้าใหม่ให้ตรงกัน */
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
  }).filter(Boolean);
}
function stockAdjApi(kind) {
  const label = STOCK_ADJ_LABEL[kind], kv = STOCK_ADJ_KV[kind];
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
/* แก้หมายเหตุของรายการ ของหาย/หมดอายุ/รอปรับ/ของเสีย (ไม่แตะจำนวน) · kind = lost|exp|pend|waste · key = k จาก stockGet */
API.stockAdjNote = async (C, token, kind, key, note) => {
  const me = await stockEditAuth(C, token);
  if (!STOCK_ADJ_KV[kind]) throw new Error('ประเภทไม่ถูกต้อง');
  const adj = await stockAdjLoad(C), cur = adj[kind], k = str(key), e = cur[k];
  if (!e) throw new Error('ไม่พบรายการนี้ (อาจถูกยกเลิกไปแล้ว) กรุณารีเฟรช');
  e.note = str(note).replace(/\s+/g, ' ').slice(0, 100);
  await kvSet(C, STOCK_ADJ_KV[kind], JSON.stringify(cur));
  await sysLogTo(C, me.name, 'สินค้าค้างสต็อก', 'แก้หมายเหตุ' + STOCK_ADJ_LABEL[kind], str(e.code) + (e.br ? '@' + e.br : '') + ' · ' + (e.note || '(ลบหมายเหตุ)'));
  return { ok: true };
};


/* ============================== เช็คราคาตลาด (market.html) ============================== */
const MARKET_CHUNK = 300000, MARKET_MAX_BYTES = 24 * 1024 * 1024;
const isRecord = v => !!v && typeof v === 'object' && !Array.isArray(v);
const unsafeKey = k => k === '__proto__' || k === 'constructor' || k === 'prototype';
function marketValidate(state) {
  if (!isRecord(state) || (!isRecord(state.branches) && !isRecord(state.groups))) throw new Error('ข้อมูลเช็คราคาตลาดไม่ถูกต้อง');
  if (isRecord(state.branches) && Object.keys(state.branches).some(unsafeKey)) throw new Error('ชื่อสาขานี้สงวนไว้สำหรับระบบ กรุณาใช้ชื่ออื่น');
  const branches = isRecord(state.branches) ? Object.values(state.branches) : [state];
  branches.forEach(b => {
    if (!isRecord(b) || !isRecord(b.groups)) throw new Error('ข้อมูลหมวดของสาขาไม่ถูกต้อง');
    Object.keys(b.groups).forEach(g => {
      if (unsafeKey(g)) throw new Error('รหัสหมวดนี้สงวนไว้สำหรับระบบ กรุณาใช้รหัสอื่น');
      const item = b.groups[g];
      if (!isRecord(item)) throw new Error('ข้อมูลหมวด ' + g + ' ไม่ถูกต้อง');
      ['cur', 'prev'].forEach(side => {
        const meta = item[side];
        if (meta == null) return;
        if (!isRecord(meta) || !Array.isArray(meta.rows) || meta.rows.some(r => !Array.isArray(r) || !str(r[2]))) throw new Error('ข้อมูลแถวในหมวด ' + g + ' ไม่ถูกต้อง');
      });
    });
  });
  return state;
}
async function marketRead(C) {
  // Read the marker and its chunks in one transaction so a simultaneous save
  // cannot pair an old revision with the contents of a new revision.
  const results = await batch(C, [stmt(C, 'SELECT v FROM kv WHERE k=?', 'MARKET_STATE'), stmt(C, 'SELECT n,data FROM market_data ORDER BY n')]);
  const row = (results[0].results || [])[0], raw = row ? row.v : null;
  if (raw === null) return { raw, state: { groups: {}, names: {}, surveyor: '', checker: '', approver: '', surveyNote: '', revision: '' } };
  let stored;
  try { stored = JSON.parse(raw); } catch (e) { throw new Error('ข้อมูลเช็คราคาตลาดเสียหาย กรุณาติดต่อผู้ดูแลก่อนบันทึก'); }
  let state = stored;
  if (isRecord(stored) && stored.__marketChunks === true) {
    const chunks = results[1].results || [];
    if (!Number.isInteger(stored.chunks) || chunks.length !== stored.chunks || chunks.some((c, i) => c.n !== i)) throw new Error('ข้อมูลเช็คราคาตลาดไม่ครบ กรุณาติดต่อผู้ดูแล');
    try { state = JSON.parse(chunks.map(c => c.data).join('')); } catch (e) { throw new Error('ข้อมูลเช็คราคาตลาดเสียหาย กรุณาติดต่อผู้ดูแล'); }
    if (!isRecord(state) || state.revision !== stored.revision) throw new Error('รุ่นข้อมูลเช็คราคาตลาดไม่ตรงกัน กรุณาโหลดใหม่');
  }
  marketValidate(state);
  return { raw, state: Object.assign({}, state, { revision: str(state.revision) }) };
}
API.marketGet = async (C, token) => {
  const me = await auth(C, token);
  if (me.role !== 'admin' && !(me.perms && me.perms.market)) throw new Error('คุณไม่มีสิทธิ์ใช้งานส่วนนี้');
  return (await marketRead(C)).state;
};
API.marketSaveState = async (C, token, state) => {
  const me = await auth(C, token);
  if (me.role !== 'admin' && !(me.perms && me.perms.market && me.perms.market_edit)) throw new Error('บัญชีนี้มีสิทธิ์ดูข้อมูลอย่างเดียว ไม่สามารถแก้ไขได้');
  marketValidate(state);
  const old = await marketRead(C);
  if (str(state.revision) !== str(old.state.revision)) throw new Error('ข้อมูลถูกแก้ไขจากหน้าหรือผู้ใช้อื่นแล้ว กรุณารีเฟรชข้อมูลล่าสุดก่อนบันทึก');
  const revision = uuid(), next = Object.assign({}, state, { revision }), data = JSON.stringify(next);
  if (new TextEncoder().encode(data).byteLength > MARKET_MAX_BYTES) throw new Error('ข้อมูลเช็คราคาตลาดใหญ่เกิน 24 MB กรุณาลดจำนวนฉบับย้อนหลัง');
  const condition = old.raw === null ? 'NOT EXISTS (SELECT 1 FROM kv WHERE k=?)' : 'EXISTS (SELECT 1 FROM kv WHERE k=? AND v=?)';
  const expected = old.raw === null ? ['MARKET_STATE'] : ['MARKET_STATE', old.raw];
  const ops = [stmt(C, 'DELETE FROM market_data WHERE ' + condition, ...expected)];
  let count = 0;
  for (let i = 0; i < data.length; i += MARKET_CHUNK) ops.push(stmt(C, 'INSERT INTO market_data(n,data) SELECT ?,? WHERE ' + condition, count++, data.slice(i, i + MARKET_CHUNK), ...expected));
  const marker = JSON.stringify({ __marketChunks: true, revision, chunks: count });
  ops.push(old.raw === null
    ? stmt(C, 'INSERT INTO kv(k,v) SELECT ?,? WHERE ' + condition, 'MARKET_STATE', marker, ...expected)
    : stmt(C, 'UPDATE kv SET v=? WHERE k=? AND v=?', marker, 'MARKET_STATE', old.raw));
  const saved = await batch(C, ops);
  if (!(saved[saved.length - 1].meta.changes > 0)) throw new Error('ข้อมูลถูกแก้ไขระหว่างบันทึก กรุณารีเฟรชข้อมูลล่าสุดก่อนบันทึก');
  await sysLogTo(C, me.name, 'เช็คราคาตลาด', 'บันทึกข้อมูลเช็คราคาตลาด', (state.branches && typeof state.branches === 'object' ? Object.keys(state.branches).length + ' สาขา · ' + Object.keys(state.branches).reduce((n, b) => n + Object.keys((state.branches[b] && state.branches[b].groups) || {}).length, 0) : Object.keys(state.groups || {}).length) + ' หมวด');
  return { ok: true, revision };
};
