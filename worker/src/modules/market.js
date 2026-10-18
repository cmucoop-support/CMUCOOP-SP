import { batch, jsonBatches, revision, stmt, str, uuid } from '../core/database.js';
import { API } from '../core/registry.js';
import { auth } from './auth.js';
import { sysLogTo } from '../core/logging.js';

const MARKET_MAX_BYTES = 24 * 1024 * 1024;

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
  const chunks = [];
  for (let i = 0; i < data.length; i += 80000) chunks.push([count++, data.slice(i, i + 80000)]);
  for (const payload of jsonBatches(chunks)) ops.push(stmt(C, "INSERT INTO market_data(n,data) SELECT json_extract(value,'$[0]'),json_extract(value,'$[1]') FROM json_each(?) WHERE " + condition, payload, ...expected));
  const marker = JSON.stringify({ __marketChunks: true, revision, chunks: count });
  ops.push(old.raw === null
    ? stmt(C, 'INSERT INTO kv(k,v) SELECT ?,? WHERE ' + condition, 'MARKET_STATE', marker, ...expected)
    : stmt(C, 'UPDATE kv SET v=? WHERE k=? AND v=?', marker, 'MARKET_STATE', old.raw));
  const saved = await batch(C, ops);
  if (!(saved[saved.length - 1].meta.changes > 0)) throw new Error('ข้อมูลถูกแก้ไขระหว่างบันทึก กรุณารีเฟรชข้อมูลล่าสุดก่อนบันทึก');
  await sysLogTo(C, me.name, 'เช็คราคาตลาด', 'บันทึกข้อมูลเช็คราคาตลาด', (state.branches && typeof state.branches === 'object' ? Object.keys(state.branches).length + ' สาขา · ' + Object.keys(state.branches).reduce((n, b) => n + Object.keys((state.branches[b] && state.branches[b].groups) || {}).length, 0) : Object.keys(state.groups || {}).length) + ' หมวด');
  return { ok: true, revision };
};

export { MARKET_MAX_BYTES, isRecord, unsafeKey, marketValidate, marketRead };
