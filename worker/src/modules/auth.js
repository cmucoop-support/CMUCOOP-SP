import { CUSTOM_KEY, LOCK_SEC, MAX_FAIL, PERM_DEFAULT, PERM_KEYS, ROLES, SESSION_TTL } from '../core/config.js';
import { all, batch, hashPw, kvJson, kvSet, now, one, passArg, run, stmt, str, uuid } from '../core/database.js';
import { sysLog } from '../core/logging.js';
import { API } from '../core/registry.js';

function rowToUser(r) {
  /** @type {Record<string, boolean>} */
  let perms = {}; try { perms = JSON.parse(r.perms || '{}') || {}; } catch (e) { /* ใช้ค่าเริ่มต้น */ }
  return { username: r.username, salt: r.salt, hash: r.hash, role: r.role, name: r.name || '', perms, lk: r.lk_hash ? { salt: r.lk_salt, hash: r.lk_hash } : null };
}

function userPerms(u) {
  const out = /** @type {Record<string, boolean>} */ ({}), p = u.perms || {};
  PERM_KEYS.forEach(k => { out[k] = u.role === 'admin' ? true : (p[k] !== undefined ? !!p[k] : PERM_DEFAULT[k]); });
  Object.keys(p).forEach(k => { if (CUSTOM_KEY.test(k)) out[k] = u.role === 'admin' ? true : p[k] !== false; });   // การ์ดกำหนดเอง: ไม่ได้ตั้ง = เห็นได้
  if (!out.stock) out.stock_edit = false;          // แก้ไขได้ต้องดูได้ก่อน
  if (!out.market) out.market_edit = false;
  if (!out.expiry) out.expiry_edit = false;
  return out;
}

function cleanPerms(p, role) {
  const out = /** @type {Record<string, boolean>} */ ({}); p = p || {};
  PERM_KEYS.forEach(k => { out[k] = role === 'admin' ? true : (p[k] === undefined ? PERM_DEFAULT[k] : !(p[k] === false || p[k] === 'false')); });
  Object.keys(p).forEach(k => { if (CUSTOM_KEY.test(k)) out[k] = role === 'admin' ? true : !(p[k] === false || p[k] === 'false'); });
  if (!out.stock) out.stock_edit = false;          // แก้ไขได้ต้องดูได้ก่อน
  if (!out.market) out.market_edit = false;
  if (!out.expiry) out.expiry_edit = false;
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
  if (!r || !r.n) { const u = await makeUser('0000', 'admin', ''); u.perms = cleanPerms({}, 'admin'); await run(C, 'INSERT INTO users(username,salt,hash,role,name,perms) SELECT ?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM users)', '0000', u.salt, u.hash, u.role, u.name, JSON.stringify(u.perms)); }   // เหมือนของเดิม: Admin เริ่มต้น 0000/0000
}

async function newLinkRec(username) {
  const key = (uuid() + uuid()).replace(/-/g, ''), salt = uuid();
  return { key, lk: { salt, hash: await hashPw(salt, key) }, link: '?u=' + encodeURIComponent(username) + '&k=' + key };
}

async function auth(C, token, adminOnly) {
  const s = token ? await one(C, 'SELECT s.exp AS exp, u.* FROM sessions s JOIN users u ON u.username=s.username WHERE s.token=?', String(token)) : null;
  if (!s || s.exp < now()) { if (token) await run(C, 'DELETE FROM sessions WHERE token=?', String(token)); throw new Error('SESSION_EXPIRED'); }
  if (s.exp - now() < SESSION_TTL * 500) await run(C, 'UPDATE sessions SET exp=? WHERE token=? AND exp<?', now() + SESSION_TTL * 1000, String(token), now() + SESSION_TTL * 500);   // คำขอพร้อมกันต่ออายุได้ครั้งเดียว
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

const failBump = (C, k, n) => run(C, 'INSERT INTO fails(k,n,until) VALUES(?,?,?) ON CONFLICT(k) DO UPDATE SET n=CASE WHEN fails.until>? THEN fails.n+1 ELSE 1 END, until=excluded.until', k, 1, now() + LOCK_SEC * 1000, now());

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
    throw new Error('ลิงก์เข้าใช้งานไม่ถูกต้องหรือถูกยกเลิกแล้ว กรุณาขอลิงก์ใหม่จาก Admin');
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
  const raw = (uuid() + uuid()).replace(/-/g, '').toUpperCase().slice(0, 20), code = (raw.match(/.{4}/g) || []).join('-'), salt = uuid();
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
  if (!username) throw new Error('กรุณากรอกรหัสผู้ใช้ Admin');
  if (newPassword.length < 4) throw new Error('รหัสผ่านใหม่ต้องมีอย่างน้อย 4 ตัวอักษร');
  if (!(await checkRecovery(C, code))) { await failBump(C, 'rfail', fails + 1); throw new Error('รหัสกู้คืนไม่ถูกต้อง'); }
  const u = await getUser(C, username);
  if (!u || u.role !== 'admin') throw new Error('ไม่พบบัญชี Admin ชื่อนี้');
  const nu = await makeUser(newPassword, 'admin', u.name); nu.perms = u.perms; nu.lk = u.lk;
  await saveUserStmt(C, username, nu).run();
  await failClear(C, 'rfail'); await failClear(C, 'fail:' + username);
  await sysLog(C, username, 'กู้คืนรหัสผ่าน Admin', 'รหัสผู้ใช้ ' + username);
  return { ok: true };
};

API.listUsers = async (C, token) => {
  await auth(C, token, true);
  return (await allUsers(C)).map(u => { const p = userPerms(u); return { username: u.username, name: u.name, role: u.role, assets: p.assets, perms: p, link: !!u.lk }; });
};

API.saveUser = async (C, token, p) => {
  const me = await auth(C, token, true);
  p = p || {};
  const users = await allUsers(C), map = Object.create(null); users.forEach(u => { map[u.username] = u; });
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
  /** @type {UserRecord} */
  let rec;
  if (old) { rec = { salt: old.salt, hash: old.hash, role, name: str(p.name), lk: old.lk }; if (password) { rec.salt = uuid(); rec.hash = await hashPw(rec.salt, password); } }
  else if (linkMode) rec = await makeUser(uuid(), role, str(p.name));   // รหัสผ่านสุ่ม → เข้าได้ทางลิงก์เท่านั้น
  else rec = await makeUser(password, role, str(p.name));
  const perms = cleanPerms(p.perms, role); rec.perms = perms;
  let link = '';
  if ((!old && linkMode) || (old && old.lk && original !== username)) { const nl = await newLinkRec(username); rec.lk = nl.lk; link = nl.link; }
  const next = Object.assign({}, map); if (original && original !== username) delete next[original]; next[username] = rec;
  if (!Object.keys(next).some(k => next[k].role === 'admin')) throw new Error('ต้องมี Admin อย่างน้อย 1 คน');
  const ops = [saveUserStmt(C, username, rec)];
  if (original && original !== username) ops.push(stmt(C, 'DELETE FROM users WHERE username=?', original), stmt(C, 'DELETE FROM sessions WHERE username=?', original));
  await batch(C, ops);
  await sysLog(C, me.name, old ? 'แก้ไขผู้ใช้' : 'เพิ่มผู้ใช้', username + ' · ' + ROLES[role] + ' · การ์ด: ' + PERM_KEYS.filter(k => perms[k]).join(','));
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
  if (!users.some(u => u.username !== username && u.role === 'admin')) throw new Error('ต้องมี Admin อย่างน้อย 1 คน');
  await batch(C, [stmt(C, 'DELETE FROM users WHERE username=?', username), stmt(C, 'DELETE FROM sessions WHERE username=?', username), stmt(C, 'DELETE FROM kv WHERE k=?', 'CSZ:' + username)]);
  await sysLog(C, me.name, 'ลบผู้ใช้', username);
  return { ok: true };
};

export { rowToUser, userPerms, cleanPerms, makeUser, saveUserStmt, getUser, allUsers, ensureAdmin, newLinkRec, auth, authPerm, startSession, failCount, failBump, failClear, normRecovery, checkRecovery };
