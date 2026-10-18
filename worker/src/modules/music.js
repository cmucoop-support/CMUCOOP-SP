import { all, kvMany, kvSet, now, numSetting, one, run, str, uuid } from '../core/database.js';
import { API } from '../core/registry.js';
import { auth, authPerm } from './auth.js';
import { appendLog } from '../core/logging.js';

const MU_LIVE = "('รออนุมัติ','รอคิว','กำลังเล่น')";

const MU_PROG_MAX_AGE = 7000;

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
    let name = (u.pathname.split('/').pop() || '').replace(MU_AUDIO_EXT, '');
    try { name = decodeURIComponent(name); } catch (e) { /* ใช้ชื่อดิบ */ }
    return { kind: 'audio', ref: u.href, url: u.href, thumb: '', title: name.slice(0, 150) || 'ไฟล์เสียง' };
  }
  throw new Error('รองรับเฉพาะลิงก์ YouTube (วิดีโอ/เพลย์ลิสต์) หรือไฟล์เสียง .mp3 .m4a .wav .ogg');
}

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
  const inserted = await run(C, 'INSERT INTO music_queue(id,seq,ts,uname,who,kind,ref,url,title,thumb,status) SELECT ?, (SELECT COALESCE(MAX(seq),0)+1 FROM music_queue), ?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM music_queue WHERE status IN ' + MU_LIVE + ') < ? AND NOT EXISTS (SELECT 1 FROM music_queue WHERE ref=? AND status IN ' + MU_LIVE + ') AND (? OR (SELECT COUNT(*) FROM music_queue WHERE uname=? AND status IN ' + MU_LIVE + ') < ?)',
    id, now(), me.user, me.name, item.kind, item.ref, item.url, item.title, item.thumb, status, MU_MAX_QUEUE, item.ref, admin ? 1 : 0, me.user, s.maxUser);
  if (!inserted.meta.changes) throw new Error('คิวเปลี่ยนระหว่างส่งคำขอ (เต็มหรือเพลงซ้ำ) กรุณาโหลดใหม่');
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

API.musicNextTrack = async (C, token, id) => {
  const me = await authPerm(C, token, 'music'); id = str(id);
  const r = await one(C, 'SELECT * FROM music_queue WHERE id=?', id);
  if (!r || r.status !== 'กำลังเล่น') throw new Error('เพลงนี้ไม่ได้กำลังเล่นอยู่แล้ว กรุณารีเฟรช');
  if (r.kind !== 'ytlist') throw new Error('ใช้ได้เฉพาะเพลย์ลิสต์ YouTube');
  await kvSet(C, 'MUSIC_CMD', JSON.stringify({ id, cmd: 'nexttrack', seq: now() }));
  await appendLog(C, me.name, 'Music', '', 'ข้ามเพลงในเพลย์ลิสต์', r.title);
  return { ok: true };
};

API.musicDecide = async (C, token, id, action) => {
  action = str(action);
  const me = action === 'skip' ? await authPerm(C, token, 'music') : await auth(C, token, true); id = str(id);
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

let tvSeenWrite = 0;

async function muHeartbeat(C) { if (now() - tvSeenWrite > 20000) { await kvSet(C, 'MUSIC_TV_SEEN', now()); tvSeenWrite = now(); } }

API.musicTvPing = async C => { await muHeartbeat(C); return true; };

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
  const paused = s.pausedId === top.id;                           // เพลงนี้ถูก Admin สั่งหยุดอยู่หรือไม่
  if (top.status === 'กำลังเล่น') return top.id === curId ? Object.assign({ action: 'keep', paused, cmd }, base) : Object.assign({ action: 'play', item: muItem(top), paused }, base);
  const r = await run(C, "UPDATE music_queue SET status='กำลังเล่น', t_start=? WHERE id=? AND status='รอคิว' AND NOT EXISTS (SELECT 1 FROM music_queue WHERE status='กำลังเล่น')", now(), top.id);
  return r.meta.changes ? Object.assign({ action: 'play', item: muItem(top), paused: false }, base) : Object.assign({ action: 'keep', paused: false }, base);   // อีกเครื่องรับไปก่อน → รอบหน้าค่อยซิงก์
};

API.musicTvEnd = async (C, id, ok) => {
  await run(C, "UPDATE music_queue SET status=?, t_end=? WHERE id=? AND status='กำลังเล่น'", (ok === true || ok === 'true') ? 'เล่นแล้ว' : 'ผิดพลาด', now(), str(id));
  return true;
};

export { MU_LIVE, MU_PROG_MAX_AGE, MU_MAX_QUEUE, MU_KEEP_DAYS, MU_USER_DEF, MU_TV_ONLINE_MS, MU_AUDIO_EXT, MU_YT_HOST, YT_ID, YT_LIST, musicState, ytItem, parseMusicUrl, ytMeta, muRow, muItem, muMove, tvSeenWrite, muHeartbeat };
