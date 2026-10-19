import { all, batch, kvJson, kvMany, kvSet, now, numSetting, one, run, sha256hex, stmt, str, uuid } from '../core/database.js';
import { BANNER_DEF, BANNER_EXT, CHUNK, MAX_BANNER_BYTES, MAX_SOUND_BYTES, SOUND_EXT, SOUND_LEGACY, SOUND_MIME, SOUND_NOFILE, SOUND_TYPES } from '../core/config.js';
import { cors } from '../core/response.js';
import { API } from '../core/registry.js';
import { auth, authPerm, failCount } from './auth.js';
import { appendLog } from '../core/logging.js';

async function saveFile(C, mime, b64) {
  const fid = uuid().replace(/-/g, ''), ops = [];
  for (let i = 0, n = 0; i < b64.length; i += CHUNK, n++) ops.push(stmt(C, 'INSERT INTO files(fid,n,mime,data) VALUES(?,?,?,?)', fid, n, mime, b64.slice(i, i + CHUNK)));
  await batch(C, ops);
  return fid;
}

const dropFile = (C, fid) => (fid ? run(C, 'DELETE FROM files WHERE fid=?', fid) : null);

async function fileB64(C, fid) {
  const rows = await all(C, 'SELECT n,mime,data FROM files WHERE fid=? ORDER BY n', fid);
  if (!rows.length) return null;
  if (rows.some((r, i) => r.n !== i)) throw new Error('ข้อมูลไฟล์ไม่ครบ กรุณาติดต่อผู้ดูแล');
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
  try {
    await run(C, 'INSERT INTO banners(id,pos,title,link,visible,ts,who,mime) VALUES(?,?,?,?,1,?,?,?)', id, pos, title, link, now(), me.name, mime);
  } catch (e) { try { await dropFile(C, id); } catch (_) {} throw e; }
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
  if (title === b.title && link === b.link && vis === b.visible) return { ok: true };
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

const soundLog = (C, who, action, detail) => appendLog(C, who, 'Sound', '', action, detail);

async function readSounds(C) {
  return (await all(C, 'SELECT * FROM sounds ORDER BY rid')).map(r => ({ row: r.rid, type: str(r.type), code: str(r.code), label: str(r.label), id: str(r.fid), file: str(r.fname), value: str(r.value), on: !!r.enabled, ts: r.ts || 0, by: str(r.who) }))
    .filter(x => x.type && x.code);
}

async function buildSoundCfg(C, full) {
  const cfg = { buttons: [], timed: [], staff: [], locations: [], cashiers: [], notices: [], schedule: /** @type {Array<{time: string, key: string}>} */ ([]), intro: '', outro: '', daytime: { on: false, interval: 30 } };
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
  for (const x of list) { if (x.row === row) old = x; else if (x.type === type && x.code === code) throw new Error('มีรหัสนี้ในประเภท "' + type + '" แล้ว'); }
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

export { saveFile, dropFile, fileB64, dataUrl, checkB64, serveFile, bannerUrl, bannerSettings, readBanners, publicBanners, bannerJson, checkLink, setBannerNum, soundLog, readSounds, buildSoundCfg, bytesToB64 };
