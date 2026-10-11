/* CMUCOOP API — Cloudflare Worker + D1
 * รับ POST {fn, args:[...]} แล้วตอบ {ok:true,data} / {ok:false,error}  (รูปแบบเดียวกับ Apps Script เดิม → หน้าเว็บใช้ gas-shim.js เหมือนเดิม)
 * เฟส 1 : ล็อกอิน/ผู้ใช้/สิทธิ์ · การ์ดเมนูหลัก · ประวัติการใช้งาน · Banner · ระบบเสียงประกาศ
 * ไฟล์รูป/เสียงเก็บใน D1 (ตาราง files) เป็นข้อความ base64 แบ่งก้อนละ ~900 KB (ไม่ต้องใช้ R2 / ไม่ต้องผูกบัตร) */

const SESSION_TTL = 21600;           // วินาที (6 ชั่วโมง) ต่ออายุเมื่อเหลือน้อยกว่าครึ่ง
const MAX_FAIL = 5, LOCK_SEC = 300, LOG_DAYS = 30;
const CHUNK = 900000;                // จำนวนตัวอักษร base64 ต่อ 1 แถวในตาราง files (D1 จำกัดแถวละ 2 MB)
const MAX_BANNER_BYTES = 3 * 1024 * 1024, MAX_SOUND_BYTES = 3 * 1024 * 1024;

const ROLES = { admin: 'แอดมิน', viewer: 'ผู้ใช้งาน' };
const PERM_KEYS = ['barcode', 'sound', 'music', 'label', 'price', 'offline', 'online', 'assets', 'history'];
const PERM_DEFAULT = { barcode: true, sound: true, music: true, label: true, price: true, offline: false, online: false, assets: true, history: false };
const CARD_KEYS = ['barcode', 'sound', 'music', 'label', 'price', 'offline', 'online', 'assets', 'history', 'settings'];
const CUSTOM_KEY = /^c_[0-9a-f]{8}$/, MAX_CUSTOM_CARDS = 30;   // การ์ดลิงก์ที่แอดมินสร้างเอง (รหัส c_xxxxxxxx)
const CARD_TITLE_MAX = 40;
const CARD_LINK_DEF = {
  label: 'http://172.16.21.103/COOPSHOP/CoopAdmin/productall.php',
  price: 'https://cmu-coops.com/product/countpd.php',
  offline: 'http://172.16.21.103/COOPSHOP/CoopAdmin/productall.php',
  online: 'https://cmu-coops.com/adEntry.php',
  assets: ''                       // รายการสินทรัพย์ = การ์ดลิงก์ ไม่มีลิงก์เริ่มต้น (แอดมินตั้งเอง)
};
const ACT_GROUPS = [
  { key: 'barcode', label: 'รายการบาร์', sheets: ['บาร์สินค้า'] },
  { key: 'sound', label: 'ระบบเสียงประกาศ', sheets: ['Sound'] },
  { key: 'music', label: 'ขอเพลง/คิวเพลง', sheets: ['Music'] },
  { key: 'assets', label: 'รายการสินทรัพย์', sheets: ['รายการสินทรัพย์'] },
  { key: 'banner', label: 'Banner', sheets: ['Banner'] },
  { key: 'system', label: 'ผู้ใช้งาน/ระบบ', sheets: ['ระบบ'] }
];
const USE_AREAS = { barcode: 'บาร์สินค้า', sound: 'Sound', music: 'Music', assets: 'รายการสินทรัพย์', banner: 'Banner' };
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
const PENDING = ['makePdf', 'musicApproveAll', 'musicCancel', 'musicDecide', 'musicRequest'];   // makePdf: ใช้ปุ่มปริ้นจากเบราว์เซอร์แทน

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
  'CREATE TABLE IF NOT EXISTS barcode_items (id INTEGER PRIMARY KEY AUTOINCREMENT, pos INTEGER, sheet TEXT, partner TEXT, cat TEXT, name TEXT, packBar TEXT, unitBar TEXT, ts INTEGER, who TEXT)',
  'CREATE INDEX IF NOT EXISTS bc_cat ON barcode_items(cat, pos)',
  'CREATE TABLE IF NOT EXISTS barcode_cats (cat TEXT PRIMARY KEY)',
  'CREATE TABLE IF NOT EXISTS backups (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, ts INTEGER, name TEXT, hash TEXT, data TEXT)'
];
let schemaReady = false;

/* ============================== เข้า/ออก ============================== */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const C = { env, ctx, request, base: url.origin };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
    try {
      if (!schemaReady) { await env.DB.batch(SCHEMA.map(s => env.DB.prepare(s))); schemaReady = true; }
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
  await run(C, 'INSERT INTO log(ts,who,sheet,cat,action,detail) VALUES(?,?,?,?,?,?)', now(), str(who), sheet, cat || '', action, detail || '');
  const day = new Date(now() + 7 * 3600e3).toISOString().slice(0, 10);
  if ((await kvGet(C, 'LOG_PRUNE_DAY', '')) !== day) {
    await kvSet(C, 'LOG_PRUNE_DAY', day);
    await run(C, 'DELETE FROM log WHERE ts<?', now() - LOG_DAYS * 86400000);
  }
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
  return out;
}
function cleanPerms(p, role) {
  const out = {}; p = p || {};
  PERM_KEYS.forEach(k => { out[k] = role === 'admin' ? true : (p[k] === undefined ? PERM_DEFAULT[k] : !(p[k] === false || p[k] === 'false')); });
  Object.keys(p).forEach(k => { if (CUSTOM_KEY.test(k)) out[k] = role === 'admin' ? true : !(p[k] === false || p[k] === 'false'); });
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
async function customCards(C) {
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
async function cardLinks(C) {
  const raw = await kvJson(C, 'CARD_LINKS', {}) || {}, out = {};
  Object.keys(CARD_LINK_DEF).forEach(k => { const u = str(raw[k]); if (u && validCardLink(u)) out[k] = u; });
  return out;
}
API.getCardLinks = async (C, token) => { await auth(C, token); return cardLinks(C); };
API.setCardLinks = async (C, token, links) => {
  const me = await auth(C, token, true), out = {};
  links = (links && typeof links === 'object') ? links : {};
  Object.keys(CARD_LINK_DEF).forEach(k => {
    const u = str(links[k]);
    if (!u || u === CARD_LINK_DEF[k]) return;
    if (!validCardLink(u)) throw new Error('ลิงก์ไม่ถูกต้อง (ต้องขึ้นต้นด้วย http:// หรือ https:// และไม่มีช่องว่าง): ' + u.slice(0, 80));
    out[k] = u;
  });
  await kvSet(C, 'CARD_LINKS', JSON.stringify(out));
  await sysLog(C, me.name, 'แก้ไขลิงก์การ์ดเมนูหลัก', JSON.stringify(out));
  return out;
};
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
  await authPerm(C, token, 'history');
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
  if (Math.floor(data.length * 3 / 4) > maxBytes) throw new Error('ไฟล์ใหญ่เกิน ' + Math.round(maxBytes / 1048576) + ' MB');
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
  if (data) { const nf = await saveFile(C, mime, data); if (old && old.id) await dropFile(C, old.id); fid = nf; fname = str(f.name).slice(0, 120) || ('sound.' + SOUND_EXT[mime]); }
  if (SOUND_NOFILE[type]) { if (fid) await dropFile(C, fid); fid = ''; fname = ''; }
  let rid = row;
  if (row) await run(C, 'UPDATE sounds SET type=?,code=?,label=?,fid=?,fname=?,value=?,enabled=?,ts=?,who=? WHERE rid=?', type, code, label, fid, fname, value, on ? 1 : 0, now(), me.name, row);
  else rid = (await run(C, 'INSERT INTO sounds(type,code,label,fid,fname,value,enabled,ts,who) VALUES(?,?,?,?,?,?,?,?,?)', type, code, label, fid, fname, value, on ? 1 : 0, now(), me.name)).meta.last_row_id;
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

/* ============================== ขอเพลง (เฟส 1: เฉพาะค่าความดัง ส่วนคิวเพลงยังไม่ย้าย) ============================== */
async function musicState(C) {
  const m = await kvMany(C, ['MUSIC_VOL', 'ANN_VOL', 'MUSIC_AUTO']);
  return { vol: numSetting(m.MUSIC_VOL, 0, 100, 70, true), avol: numSetting(m.ANN_VOL, 10, 100, 100, true), auto: m.MUSIC_AUTO === '1' };
}
API.musicList = async (C, token) => { await authPerm(C, token, 'music'); const s = await musicState(C); return { rows: [], auto: s.auto, vol: s.vol, avol: s.avol }; };
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
  const me = await authPerm(C, token, 'music'); const flag = on === true || on === 'true';
  await kvSet(C, 'MUSIC_AUTO', flag ? '1' : '0'); await appendLog(C, me.name, 'Music', '', flag ? 'เปิดอนุมัติอัตโนมัติ' : 'ปิดอนุมัติอัตโนมัติ', '');
  return { ok: true, auto: flag };
};
let tickCache = { at: 0, v: null };
API.musicTvTick = async C => {                     // หน้า TV เรียกทุก 5 วินาที → ตอบจากแคชในหน่วยความจำ 30 วินาที ลดภาระฐานข้อมูล
  if (!tickCache.v || now() - tickCache.at > 30000) { const s = await musicState(C); tickCache = { at: now(), v: { action: 'idle', vol: s.vol, avol: s.avol } }; }
  return tickCache.v;
};
API.musicTvEnd = async () => true;

/* ============================ รายการบาร์เดี่ยว/บาร์แพ็ค (เก็บใน D1 + นำเข้าจาก Excel) ============================
 * ข้อมูลทั้งหมดอยู่ใน Cloud (ตาราง barcode_items / barcode_cats) แก้ไขผ่านหน้าเว็บ · นำเข้าจาก Excel ได้ (หัวตารางอ่านจากชื่อคอลัมน์)
 * ก่อนนำเข้า/กู้คืนทุกครั้งระบบทำสำเนาไว้ให้ เก็บล่าสุดแค่ BACKUP_KEEP ชุด */
const BC_SHEET = 'บาร์สินค้า', BACKUP_KEEP = 2, BC_DEFCAT = 'ไม่ระบุหมวด';
const BC_COMPANY = 'ร้านสหกรณ์ มหาวิทยาลัยเชียงใหม่', BC_TITLE = 'รายการบาร์เดี่ยว/บาร์แพ็ค';
const BC_SCHEMA = {
  cols: [
    { k: 'no', label: 'ลำดับ', w: 5, num: true, calc: true },
    { k: 'partner', label: 'รหัสคู่ค้า', w: 9 },
    { k: 'cat', label: 'หมวด', w: 10 },
    { k: 'name', label: 'ชื่อรายการ', w: 29 },
    { k: 'packBar', label: 'เลขบาร์แพ็ค', w: 13, text: true },
    { k: 'unitBar', label: 'เลขบาร์เดี่ยว', w: 13, text: true },
    { k: 'qtySys', label: 'จำนวนในระบบ', w: 7, num: true, edit: true },
    { k: 'spread', label: 'กระจาย', w: 7, edit: true },
    { k: 'old', label: 'ของเดิม', w: 7, edit: true }
  ],
  groups: [{ label: 'ตรวจนับ', from: 7, to: 9 }],
  handLines: ['ผู้ตรวจนับ ......................', 'วันที่ ......................'],
  nameCol: 4
};
const BC_FIELDS = ['partner', 'cat', 'name', 'packBar', 'unitBar'];
const bcClean = (k, v) => { v = str(v); return (k === 'packBar' || k === 'unitBar') ? v.replace(/\s+/g, '') : v.replace(/\s+/g, ' '); };
function bcVals(o) { const v = {}; BC_FIELDS.forEach(k => { v[k] = bcClean(k, o[k]).slice(0, 200); }); return v; }
const bcRow = (r, no) => ({ r: r.id, v: [no, str(r.partner), str(r.cat), str(r.name), str(r.packBar), str(r.unitBar), '', '', ''] });
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

API.getInit = async (C, token) => {
  await authPerm(C, token, 'barcode');
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
    categories: list,
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
  const r = await run(C, 'INSERT INTO barcode_items(pos,sheet,partner,cat,name,packBar,unitBar,ts,who) VALUES(?,?,?,?,?,?,?,?,?)', at, BC_SHEET, v.partner, v.cat, v.name, v.packBar, v.unitBar, now(), me.name);
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
  await run(C, 'UPDATE barcode_items SET partner=?,cat=?,name=?,packBar=?,unitBar=?,ts=?,who=? WHERE id=?', v.partner, v.cat, v.name, v.packBar, v.unitBar, now(), me.name, cur.id);
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
  const rows = await all(C, 'SELECT partner,cat,name,packBar,unitBar FROM barcode_items ORDER BY pos');
  const cats = (await all(C, 'SELECT cat FROM barcode_cats')).map(r => str(r.cat));
  if (rows.length || cats.length) {
    const data = JSON.stringify({ rows: rows.map(r => [str(r.partner), str(r.cat), str(r.name), str(r.packBar), str(r.unitBar)]), cats });
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
  return { name: 'สำเนารายการบาร์', csv: '﻿' + [['รหัสคู่ค้า', 'หมวด', 'ชื่อรายการ', 'เลขบาร์แพ็ค', 'เลขบาร์เดี่ยว']].concat(JSON.parse(b.data).rows).map(r => r.map(q).join(',')).join('\r\n') };
};
const bcInsert = (C, pos, who, r) => stmt(C, 'INSERT INTO barcode_items(pos,sheet,partner,cat,name,packBar,unitBar,ts,who) VALUES(?,?,?,?,?,?,?,?,?)', pos, BC_SHEET, r.partner, r.cat, r.name, r.packBar, r.unitBar, now(), who);
async function bcInsertAll(C, who, items, startPos) {
  for (let i = 0; i < items.length; i += 80) await batch(C, items.slice(i, i + 80).map((r, j) => bcInsert(C, startPos + i + j + 1, who, r)));
}
API.barcodeRestore = async (C, token, id) => {
  const me = await auth(C, token, true);
  const b = await one(C, 'SELECT data FROM backups WHERE id=? AND kind=?', Number(id) || 0, 'barcode');
  if (!b) throw new Error('ไม่พบสำเนานี้');
  const d = JSON.parse(b.data), items = d.rows.map(a => ({ partner: a[0], cat: a[1], name: a[2], packBar: a[3], unitBar: a[4] }));
  await bcSnapshot(C, 'ก่อนกู้คืน');
  await batch(C, [stmt(C, 'DELETE FROM barcode_items'), stmt(C, 'DELETE FROM barcode_cats')].concat((d.cats || []).map(c => stmt(C, 'INSERT OR IGNORE INTO barcode_cats(cat) VALUES(?)', c))));
  await bcInsertAll(C, me.name, items, 0);
  await bcLog(C, me, '', 'กู้คืนจากสำเนา', items.length + ' รายการ');
  return { ok: true, count: items.length, backups: await bcBackups(C) };
};

/* ---------- นำเข้าจาก Excel ---------- */
const BC_PATS = [
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
  if (replace) await batch(C, [stmt(C, 'DELETE FROM barcode_items'), stmt(C, 'DELETE FROM barcode_cats')]);
  else {
    const have = new Set((await all(C, 'SELECT cat,name,packBar,unitBar FROM barcode_items')).map(r => [r.cat, r.name, r.packBar, r.unitBar].join('\u0001')));
    add = items.filter(x => { const k = [x.cat, x.name, x.packBar, x.unitBar].join('\u0001'); if (have.has(k)) { dup++; return false; } have.add(k); return true; });
    start = (await one(C, 'SELECT MAX(pos) AS m FROM barcode_items')).m || 0;
  }
  await bcInsertAll(C, me.name, add, start);
  await bcLog(C, me, '', 'นำเข้าจาก Excel', (replace ? 'แทนที่ทั้งหมด' : 'เพิ่มต่อท้าย') + ' · ' + add.length + ' รายการ' + (dup ? ' · ข้ามซ้ำ ' + dup : ''));
  return { ok: true, count: add.length, duplicates: dup, notes, backups: await bcBackups(C) };
};
