import { BANNER_EXT, CHUNK, MAX_BANNER_BYTES } from '../core/config.js';
import { all, batch, guardedApi, jsonBatches, kvGet, kvSetStmt, now, one, sha256hex, stmt, str, uuid } from '../core/database.js';
import { appendLog } from '../core/logging.js';
import { API } from '../core/registry.js';
import { authPerm } from './auth.js';
import { checkB64 } from './media.js';
import { stockDate } from './stock.js';

const ASSETS_TITLE = 'รายการสินทรัพย์ ร้านสหกรณ์มหาวิทยาลัย เชียงใหม่ จำกัด';
const ASSETS_STATUSES = ['normal', 'irreparable', 'repair', 'reduced'];
const ASSETS_MONEY = ['total', 'opening', 'increase', 'decrease', 'closing', 'net'];
const ASSETS_LABELS = { total: 'รวม', rate: 'อัตรา ร้อยละ', opening: 'ยกมา', increase: 'เพิ่ม ระหว่างปี', decrease: 'ลด ระหว่างปี', closing: 'ยกไป', net: 'ราคาสินทรัพย์ สุทธิ' };

async function assetsAuth(C, token, edit = false) {
  const me = await authPerm(C, token, 'assets');
  if (edit && !me.perms.assets_edit) throw new Error('บัญชีนี้มีสิทธิ์ดูรายการสินทรัพย์อย่างเดียว');
  return me;
}

const assetFileFid = url => {
  const m = /\/file\/([0-9a-f]{32})(?:[?#]|$)/i.exec(str(url));
  return m ? m[1].toLowerCase() : '';
};

const assetFileUrl = (C, fid) => (C && C.base ? C.base : 'https://cmucoop-api.cmucoopcashier.workers.dev') + '/file/' + fid;

async function assetsSaveImageOps(C, imageData, knownFids) {
  if (!imageData || typeof imageData !== 'object') return null;
  const mime = str(imageData.mime).toLowerCase();
  if (!BANNER_EXT[mime]) throw new Error('รองรับเฉพาะไฟล์รูปภาพ JPG, PNG, WEBP, GIF');
  const b64 = checkB64(imageData.data, MAX_BANNER_BYTES, 'รูปภาพสินทรัพย์');
  const fid = (await sha256hex(mime + ':' + b64)).slice(0, 32);
  const ops = [];
  if (!knownFids.has(fid)) {
    for (let i = 0, n = 0; i < b64.length; i += CHUNK, n++) {
      ops.push(stmt(C, 'INSERT OR REPLACE INTO files(fid,n,mime,data) VALUES(?,?,?,?)', fid, n, mime, b64.slice(i, i + CHUNK)));
    }
    knownFids.add(fid);
  }
  return { fid, url: assetFileUrl(C, fid), ops };
}

function assetsClean(p, C) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('รูปแบบรายการสินทรัพย์ไม่ถูกต้อง');
  const text = (value, max, label) => {
    const out = str(value);
    if (out.length > max) throw new Error(label + 'ยาวเกิน ' + max + ' ตัวอักษร');
    return out;
  };
  let rawUrl = text(p.imageUrl, 2000, 'ลิงก์ภาพ');
  const fid = assetFileFid(rawUrl);
  if (fid && rawUrl.startsWith('/file/')) rawUrl = assetFileUrl(C, fid);
  const data = { seq: p.seq === '' || p.seq == null ? null : Number(p.seq),
    name: text(p.name, 250, 'รายการ'), code: text(p.code, 80, 'รหัสสินทรัพย์'), received: str(p.received),
    location: text(p.location, 200, 'สถานที่ตั้ง'), status: str(p.status) || 'normal',
    imageUrl: rawUrl, note: text(p.note, 2000, 'หมายเหตุ') };
  if (!data.name) throw new Error('กรุณากรอกชื่อรายการสินทรัพย์');
  if (p.seq != null && p.seq !== '' && !['number', 'string'].includes(typeof p.seq)) throw new Error('ลำดับต้องเป็นตัวเลข');
  if (data.seq !== null && (!Number.isSafeInteger(data.seq) || data.seq < 1 || data.seq > 1000000000)) throw new Error('ลำดับต้องเป็นจำนวนเต็มตั้งแต่ 1 ถึง 1,000,000,000');
  if (!ASSETS_STATUSES.includes(data.status)) throw new Error('กรุณาเลือกสถานะที่ถูกต้องเพียง 1 สถานะ');
  if (data.received && (!stockDate(data.received) || Number(data.received.slice(0, 4)) < 1900 || Number(data.received.slice(0, 4)) > 2200)) throw new Error('วันที่รับสินทรัพย์ไม่ถูกต้อง กรุณาเลือกปี ค.ศ. จากปฏิทิน');
  if (data.imageUrl) {
    let url; try { url = new URL(data.imageUrl); } catch (_) {}
    if (!url || !['https:', 'http:'].includes(url.protocol) || url.username || url.password || /\s/.test(data.imageUrl)) throw new Error('ลิงก์ภาพต้องขึ้นต้นด้วย https:// หรือ http:// และไม่มีช่องว่าง');
  }
  for (const key of [...ASSETS_MONEY, 'rate']) {
    const value = p[key];
    data[key] = value === '' || value == null ? null : Number(value);
    if (data[key] === null) continue;
    const max = key === 'rate' ? 100 : 1000000000000;
    const rounded = Math.round(data[key] * 100) / 100;
    const tooPrecise = (data[key] !== 0 && rounded === 0) || Math.abs(data[key] - rounded) > Number.EPSILON * Math.max(1, Math.abs(data[key])) * 2;
    if (!['number', 'string'].includes(typeof value) || !Number.isFinite(data[key]) || data[key] < 0 || data[key] > max || tooPrecise) throw new Error(ASSETS_LABELS[key] + 'ต้องเป็นเลขตั้งแต่ 0 ถึง ' + max.toLocaleString('en-US') + ' ทศนิยมไม่เกิน 2 ตำแหน่ง หรือเว้นว่าง');
    data[key] = rounded;
  }
  return data;
}

function assetsRow(row) {
  if (!row) return null;
  return { id: row.id, seq: row.seq, name: row.name, code: row.code, received: row.received, location: row.location, status: row.status,
    imageUrl: row.image_url, note: row.note, ...JSON.parse(row.amounts), version: row.version, createdTs: row.created_ts, updatedTs: row.updated_ts, updatedBy: row.updated_by };
}

function assetsWhere(options) {
  const q = str(options.q).slice(0, 200).toLowerCase(), status = str(options.status), location = str(options.location).slice(0, 200);
  if (status && !ASSETS_STATUSES.includes(status)) throw new Error('ตัวกรองสถานะไม่ถูกต้อง');
  return { sql: " WHERE (?='' OR instr(lower(name||' '||code||' '||location||' '||note),?)>0) AND (?='' OR status=?) AND (?='' OR location=?)", values: [q, q, status, status, location, location] };
}

API.assetsList = guardedApi(async (C, token, options = {}) => {
  options = options && typeof options === 'object' && !Array.isArray(options) ? options : {};
  const me = await assetsAuth(C, token), where = assetsWhere(options || {});
  const page = Number.isSafeInteger(Number(options.page)) && Number(options.page) > 0 ? Math.min(1000000000, Number(options.page)) : 1;
  const pageSize = Math.min(100, Math.max(1, Math.floor(Number(options.pageSize) || 30)));
  const sums = ASSETS_MONEY.map(k => `ROUND(COALESCE(SUM(json_extract(amounts,'$.${k}')),0),2) AS ${k}`).join(',');
  const results = await batch(C, [
    stmt(C, 'SELECT * FROM asset_items' + where.sql + ' ORDER BY seq,id LIMIT ? OFFSET ?', ...where.values, pageSize, (page - 1) * pageSize),
    stmt(C, 'SELECT COUNT(*) AS count,' + sums + ' FROM asset_items' + where.sql, ...where.values),
    stmt(C, 'SELECT status,COUNT(*) AS count FROM asset_items GROUP BY status'),
    stmt(C, "SELECT DISTINCT location FROM asset_items WHERE location<>'' ORDER BY location LIMIT 500"),
    stmt(C, 'SELECT COALESCE(MAX(seq),0)+1 AS nextSeq FROM asset_items')
  ]);
  const counts = Object.fromEntries(ASSETS_STATUSES.map(k => [k, 0]));
  results[2].results.forEach(r => { counts[r.status] = r.count; });
  const summary = results[1].results[0];
  return { me: { name: me.name, edit: !!me.perms.assets_edit }, title: await kvGet(C, 'ASSETS_TITLE', ASSETS_TITLE),
    rows: results[0].results.map(assetsRow), total: summary.count, summary, counts, locations: results[3].results.map(r => r.location), nextSeq: results[4].results[0].nextSeq, page, pageSize };
}, 'assets', true, true);

API.assetsGet = guardedApi(async (C, token, id) => {
  await assetsAuth(C, token);
  const row = assetsRow(await one(C, 'SELECT * FROM asset_items WHERE id=?', str(id)));
  if (!row) throw new Error('ไม่พบรายการสินทรัพย์นี้ กรุณาโหลดข้อมูลล่าสุด');
  return row;
}, 'assets', true);

const assetsCodeKey = code => str(code).replace(/\s/g, '').toLowerCase() || null;

API.assetsGetByCode = guardedApi(async (C, token, code) => {
  await assetsAuth(C, token);
  const raw = str(code), key = assetsCodeKey(raw);
  if (!raw) throw new Error('กรุณาระบุรหัสสินทรัพย์');
  const row = await one(C, 'SELECT * FROM asset_items WHERE (code_key IS NOT NULL AND code_key=?) OR id=? ORDER BY seq LIMIT 1', key, raw);
  if (!row) throw new Error('ไม่พบรายการสินทรัพย์รหัส ' + raw);
  return assetsRow(row);
}, 'assets', true);

API.assetsPublicByCode = guardedApi(async (C, code) => {
  const raw = str(code), key = assetsCodeKey(raw);
  if (!raw) throw new Error('กรุณาระบุรหัสสินทรัพย์');
  const [row, title] = await Promise.all([
    one(C, 'SELECT * FROM asset_items WHERE (code_key IS NOT NULL AND code_key=?) OR id=? ORDER BY seq LIMIT 1', key, raw),
    kvGet(C, 'ASSETS_TITLE', ASSETS_TITLE)
  ]);
  if (!row) throw new Error('ไม่พบรายการสินทรัพย์รหัส ' + raw);
  return {
    title,
    row: { id: row.id, seq: row.seq, name: row.name, code: row.code, received: row.received, location: row.location, status: row.status, imageUrl: row.image_url, note: row.note, updatedTs: row.updated_ts }
  };
}, 'assets', true);

API.assetsUploadImage = guardedApi(async (C, token, payload = {}) => {
  const me = await assetsAuth(C, token, true);
  payload = payload && typeof payload === 'object' ? payload : {};
  const mime = str(payload.mime).toLowerCase();
  if (!BANNER_EXT[mime]) throw new Error('รองรับเฉพาะไฟล์รูปภาพ JPG, PNG, WEBP, GIF');
  const b64 = checkB64(payload.data, MAX_BANNER_BYTES, 'รูปภาพสินทรัพย์');
  const fid = (await sha256hex(mime + ':' + b64)).slice(0, 32);
  const exists = await one(C, 'SELECT fid FROM files WHERE fid=? AND n=0', fid);
  if (!exists) {
    const saved = await assetsSaveImageOps(C, { mime, data: b64 }, new Set());
    if (saved && saved.ops.length) await batch(C, saved.ops);
  }
  const url = assetFileUrl(C, fid);
  await appendLog(C, me.name, 'รายการสินทรัพย์', '', 'อัปโหลดรูปสินทรัพย์', str(payload.name || fid).slice(0, 100));
  return { ok: true, fid, url };
}, 'assets', false, true);

API.assetsExport = guardedApi(async (C, token, options = {}) => {
  options = options && typeof options === 'object' && !Array.isArray(options) ? options : {};
  await assetsAuth(C, token);
  const where = assetsWhere(options);
  const [rows, title] = await Promise.all([
    all(C, 'SELECT * FROM asset_items' + where.sql + ' ORDER BY seq,id', ...where.values),
    kvGet(C, 'ASSETS_TITLE', ASSETS_TITLE)
  ]);
  const fids = [...new Set(rows.map(r => assetFileFid(r.image_url)).filter(Boolean))];
  const images = {};
  if (fids.length) {
    const parts = await all(C, 'SELECT fid,n,mime,data FROM files WHERE fid IN (SELECT value FROM json_each(?)) ORDER BY fid,n', JSON.stringify(fids));
    const grouped = new Map();
    for (const p of parts) {
      if (!grouped.has(p.fid)) grouped.set(p.fid, []);
      grouped.get(p.fid).push(p);
    }
    grouped.forEach((list, fid) => {
      if (!list.some((p, i) => p.n !== i)) {
        images[fid] = { mime: list[0].mime, data: list.map(p => p.data).join('') };
      }
    });
  }
  return { title, rows: rows.map(assetsRow), images };
}, 'assets', true, true);

function assetsValues(data) { return JSON.stringify(Object.fromEntries([...ASSETS_MONEY, 'rate'].map(k => [k, data[k]]))); }
async function assetsUnique(C, data, id = '') {
  if (await one(C, 'SELECT id FROM asset_items WHERE seq=? AND id<>?', data.seq, id)) throw new Error('ลำดับนี้ถูกใช้แล้ว กรุณาเลือกลำดับอื่น');
  if (data.code && await one(C, 'SELECT id FROM asset_items WHERE code_key=? AND id<>?', assetsCodeKey(data.code), id)) throw new Error('รหัสสินทรัพย์นี้มีอยู่แล้ว กรุณาตรวจสอบรหัส');
}
const assetsEvent = (C, id, version, me, action, detail, requestId = null) => stmt(C, 'INSERT INTO asset_events(asset_id,version,ts,who,action,detail,request_id) VALUES(?,?,?,?,?,?,?)', id, version, now(), me.name, action, JSON.stringify(detail), requestId);

API.assetsCreate = guardedApi(async (C, token, payload) => {
  const me = await assetsAuth(C, token, true);
  payload = payload && typeof payload === 'object' ? payload : {};
  const imageOps = [];
  if (payload.imageData && typeof payload.imageData === 'object' && payload.imageData.data) {
    const mime = str(payload.imageData.mime).toLowerCase();
    const b64 = checkB64(payload.imageData.data, MAX_BANNER_BYTES, 'รูปภาพสินทรัพย์');
    const fid = (await sha256hex(mime + ':' + b64)).slice(0, 32);
    const known = new Set((await one(C, 'SELECT fid FROM files WHERE fid=? AND n=0', fid)) ? [fid] : []);
    const saved = await assetsSaveImageOps(C, { mime, data: b64 }, known);
    if (saved) { payload = { ...payload, imageUrl: saved.url }; imageOps.push(...saved.ops); }
  }
  const data = assetsClean(payload, C);
  const requestId = str(payload.requestId);
  if (!/^[a-z0-9-]{12,64}$/i.test(requestId)) throw new Error('รหัสการบันทึกไม่ถูกต้อง กรุณาเปิดแบบฟอร์มใหม่');
  const hash = await sha256hex(JSON.stringify(data)), previous = await one(C, 'SELECT * FROM asset_items WHERE request_id=?', requestId);
  if (previous) {
    if (previous.created_user !== me.user || previous.create_hash !== hash) throw new Error('คำขอบันทึกนี้ถูกใช้กับข้อมูลอื่นแล้ว กรุณาเปิดแบบฟอร์มใหม่');
    return { row: assetsRow(previous), duplicate: true };
  }
  if (await one(C, 'SELECT asset_id FROM asset_events WHERE request_id=?', requestId)) throw new Error('คำขอนี้เคยบันทึกสำเร็จและรายการถูกลบไปแล้ว กรุณาเปิดแบบฟอร์มใหม่');
  if (data.seq === null) data.seq = (await one(C, 'SELECT COALESCE(MAX(seq),0)+1 AS n FROM asset_items')).n;
  await assetsUnique(C, data);
  const id = uuid(), ts = now();
  await batch(C, [
    ...imageOps,
    stmt(C, 'INSERT INTO asset_items(id,seq,name,code,code_key,received,location,status,image_url,note,amounts,version,request_id,create_hash,created_user,created_ts,updated_by,updated_ts) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      id, data.seq, data.name, data.code, assetsCodeKey(data.code), data.received, data.location, data.status, data.imageUrl, data.note, assetsValues(data), 1, requestId, hash, me.user, ts, me.name, ts),
    assetsEvent(C, id, 1, me, 'เพิ่มรายการสินทรัพย์', data, requestId)
  ]);
  return { row: assetsRow(await one(C, 'SELECT * FROM asset_items WHERE id=?', id)) };
}, 'assets', false, true);

API.assetsUpdate = guardedApi(async (C, token, id, version, payload) => {
  const me = await assetsAuth(C, token, true);
  payload = payload && typeof payload === 'object' ? payload : {};
  const imageOps = [];
  if (payload.imageData && typeof payload.imageData === 'object' && payload.imageData.data) {
    const mime = str(payload.imageData.mime).toLowerCase();
    const b64 = checkB64(payload.imageData.data, MAX_BANNER_BYTES, 'รูปภาพสินทรัพย์');
    const fid = (await sha256hex(mime + ':' + b64)).slice(0, 32);
    const known = new Set((await one(C, 'SELECT fid FROM files WHERE fid=? AND n=0', fid)) ? [fid] : []);
    const saved = await assetsSaveImageOps(C, { mime, data: b64 }, known);
    if (saved) { payload = { ...payload, imageUrl: saved.url }; imageOps.push(...saved.ops); }
  }
  const data = assetsClean(payload, C), old = await one(C, 'SELECT * FROM asset_items WHERE id=?', str(id));
  if (!old) throw new Error('ไม่พบรายการสินทรัพย์นี้');
  if (!Number.isSafeInteger(version) || old.version !== version) throw new Error('รายการนี้ถูกแก้ไขแล้ว กรุณาโหลดข้อมูลล่าสุดก่อนบันทึก');
  if (data.seq === null) data.seq = old.seq;
  await assetsUnique(C, data, old.id);
  await batch(C, [
    ...imageOps,
    stmt(C, 'UPDATE asset_items SET seq=?,name=?,code=?,code_key=?,received=?,location=?,status=?,image_url=?,note=?,amounts=?,version=version+1,updated_by=?,updated_ts=? WHERE id=? AND version=?',
      data.seq, data.name, data.code, assetsCodeKey(data.code), data.received, data.location, data.status, data.imageUrl, data.note, assetsValues(data), me.name, now(), old.id, version),
    assetsEvent(C, old.id, version + 1, me, 'แก้ไขรายการสินทรัพย์', { before: assetsRow(old), after: data })
  ]);
  return { row: assetsRow(await one(C, 'SELECT * FROM asset_items WHERE id=?', old.id)) };
}, 'assets', false, true);

API.assetsImport = guardedApi(async (C, token, payload = {}) => {
  const me = await assetsAuth(C, token, true);
  payload = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const mode = payload.mode === 'replace' ? 'replace' : 'merge';
  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  if (!rawItems.length) throw new Error('ไม่พบรายการสินทรัพย์ในไฟล์ Excel');
  if (rawItems.length > 5000) throw new Error('นำเข้าได้ครั้งละไม่เกิน 5,000 รายการ');

  const candidateFids = [];
  const preparedImages = [];
  for (let i = 0; i < rawItems.length; i++) {
    const it = rawItems[i];
    if (it && it.imageData && typeof it.imageData === 'object' && it.imageData.data) {
      const mime = str(it.imageData.mime).toLowerCase();
      if (!BANNER_EXT[mime]) throw new Error('แถวที่ ' + (i + 1) + ': รองรับเฉพาะไฟล์รูปภาพ JPG, PNG, WEBP, GIF');
      const b64 = checkB64(it.imageData.data, MAX_BANNER_BYTES, 'รูปภาพสินทรัพย์');
      const fid = (await sha256hex(mime + ':' + b64)).slice(0, 32);
      candidateFids.push(fid);
      preparedImages[i] = { mime, data: b64, fid };
    }
  }

  const knownFids = new Set();
  if (candidateFids.length) {
    const existingFiles = await all(C, 'SELECT DISTINCT fid FROM files WHERE n=0 AND fid IN (SELECT value FROM json_each(?))', JSON.stringify([...new Set(candidateFids)]));
    existingFiles.forEach(r => knownFids.add(r.fid));
  }

  const ops = [];
  let imagesSaved = 0;
  const cleaned = [];
  const fileCodes = new Set();
  for (let i = 0; i < rawItems.length; i++) {
    const raw = rawItems[i] && typeof rawItems[i] === 'object' ? { ...rawItems[i] } : {};
    if (preparedImages[i]) {
      const beforeSize = knownFids.size;
      const saved = await assetsSaveImageOps(C, preparedImages[i], knownFids);
      if (saved) {
        raw.imageUrl = saved.url;
        ops.push(...saved.ops);
        if (knownFids.size > beforeSize) imagesSaved++;
      }
    }
    let data;
    try { data = assetsClean(raw, C); }
    catch (e) { throw new Error('รายการที่ ' + (i + 1) + (raw.name ? ' (' + str(raw.name).slice(0, 40) + ')' : '') + ': ' + e.message); }
    const ck = assetsCodeKey(data.code);
    if (ck) {
      if (fileCodes.has(ck)) throw new Error('พบรหัสสินทรัพย์ซ้ำกันในไฟล์ Excel: ' + data.code);
      fileCodes.add(ck);
    }
    cleaned.push(data);
  }

  const existing = await all(C, 'SELECT * FROM asset_items ORDER BY seq,id');
  const ts = now();
  let created = 0, updated = 0;

  if (mode === 'replace') {
    const usedSeq = new Set();
    let nextSeq = 1;
    for (const item of cleaned) {
      if (item.seq !== null && !usedSeq.has(item.seq)) {
        usedSeq.add(item.seq);
      } else {
        while (usedSeq.has(nextSeq)) nextSeq++;
        item.seq = nextSeq;
        usedSeq.add(nextSeq);
      }
    }
    ops.push(stmt(C, 'DELETE FROM asset_items'));
    const rowsToInsert = [];
    for (const item of cleaned) {
      const id = uuid(), reqId = uuid();
      const hash = await sha256hex(JSON.stringify(item));
      rowsToInsert.push([id, item.seq, item.name, item.code, assetsCodeKey(item.code), item.received, item.location, item.status, item.imageUrl, item.note, assetsValues(item), 1, reqId, hash, me.user, ts, me.name, ts]);
      created++;
    }
    for (const payloadBatch of jsonBatches(rowsToInsert)) {
      ops.push(stmt(C, `INSERT INTO asset_items(id,seq,name,code,code_key,received,location,status,image_url,note,amounts,version,request_id,create_hash,created_user,created_ts,updated_by,updated_ts)
        SELECT json_extract(value,'$[0]'),json_extract(value,'$[1]'),json_extract(value,'$[2]'),json_extract(value,'$[3]'),json_extract(value,'$[4]'),json_extract(value,'$[5]'),json_extract(value,'$[6]'),json_extract(value,'$[7]'),json_extract(value,'$[8]'),json_extract(value,'$[9]'),json_extract(value,'$[10]'),json_extract(value,'$[11]'),json_extract(value,'$[12]'),json_extract(value,'$[13]'),json_extract(value,'$[14]'),json_extract(value,'$[15]'),json_extract(value,'$[16]'),json_extract(value,'$[17]') FROM json_each(?)`, payloadBatch));
    }
  } else {
    const byCode = new Map(), bySeq = new Map(), usedSeq = new Set();
    let maxSeq = 0;
    existing.forEach(r => {
      if (r.code_key) byCode.set(r.code_key, r);
      bySeq.set(r.seq, r);
      usedSeq.add(r.seq);
      if (r.seq > maxSeq) maxSeq = r.seq;
    });
    const matchedIds = new Set();
    const toUpdate = [], toInsert = [];
    for (const item of cleaned) {
      const ck = assetsCodeKey(item.code);
      let match = ck ? byCode.get(ck) : null;
      if (!match && !ck && item.seq !== null) {
        const seqMatch = bySeq.get(item.seq);
        if (seqMatch && !matchedIds.has(seqMatch.id) && seqMatch.name === item.name) match = seqMatch;
      }
      if (match && !matchedIds.has(match.id)) {
        matchedIds.add(match.id);
        usedSeq.delete(match.seq);
        toUpdate.push({ match, item });
      } else {
        toInsert.push(item);
      }
    }
    for (const { match, item } of toUpdate) {
      const seq = item.seq !== null && !usedSeq.has(item.seq) ? item.seq : match.seq;
      usedSeq.add(seq);
      if (seq > maxSeq) maxSeq = seq;
      const imageUrl = item.imageUrl || match.image_url;
      ops.push(stmt(C, 'UPDATE asset_items SET seq=?,name=?,code=?,code_key=?,received=?,location=?,status=?,image_url=?,note=?,amounts=?,version=version+1,updated_by=?,updated_ts=? WHERE id=?',
        seq, item.name, item.code, assetsCodeKey(item.code), item.received, item.location, item.status, imageUrl, item.note, assetsValues(item), me.name, ts, match.id));
      updated++;
    }
    for (const item of toInsert) {
      let seq = item.seq;
      if (seq === null || usedSeq.has(seq)) {
        maxSeq++;
        while (usedSeq.has(maxSeq)) maxSeq++;
        seq = maxSeq;
      }
      usedSeq.add(seq);
      if (seq > maxSeq) maxSeq = seq;
      const id = uuid(), reqId = uuid();
      const hash = await sha256hex(JSON.stringify(item));
      ops.push(stmt(C, 'INSERT INTO asset_items(id,seq,name,code,code_key,received,location,status,image_url,note,amounts,version,request_id,create_hash,created_user,created_ts,updated_by,updated_ts) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        id, seq, item.name, item.code, assetsCodeKey(item.code), item.received, item.location, item.status, item.imageUrl, item.note, assetsValues(item), 1, reqId, hash, me.user, ts, me.name, ts));
      created++;
    }
  }

  const importTitle = str(payload.title);
  if (importTitle && importTitle.length <= 200) {
    ops.push(kvSetStmt(C, 'ASSETS_TITLE', importTitle));
  }
  ops.push(assetsEvent(C, '__import__', (C.guard ? C.guard.revision : 0) + 1 + Math.floor(Math.random() * 1000000), me, 'นำเข้าสินทรัพย์จาก Excel', { mode, count: cleaned.length, created, updated, imagesSaved }));
  await batch(C, ops);
  await appendLog(C, me.name, 'รายการสินทรัพย์', '', 'นำเข้าจาก Excel', (mode === 'replace' ? 'แทนที่ทั้งหมด' : 'เพิ่ม/อัปเดต') + ' · ' + cleaned.length + ' รายการ (เพิ่ม ' + created + ' · อัปเดต ' + updated + ' · รูปภาพ ' + imagesSaved + ')');
  return { ok: true, mode, count: cleaned.length, created, updated, imagesSaved };
}, 'assets', false, true);

API.assetsDelete = guardedApi(async (C, token, id, version) => {
  const me = await assetsAuth(C, token, true), old = await one(C, 'SELECT * FROM asset_items WHERE id=?', str(id));
  if (!old) throw new Error('ไม่พบรายการสินทรัพย์นี้');
  if (!Number.isSafeInteger(version) || old.version !== version) throw new Error('รายการนี้ถูกแก้ไขแล้ว กรุณาโหลดข้อมูลล่าสุดก่อนลบ');
  await batch(C, [stmt(C, 'DELETE FROM asset_items WHERE id=? AND version=?', old.id, version), assetsEvent(C, old.id, version + 1, me, 'ลบรายการสินทรัพย์', { before: assetsRow(old) })]);
  return { ok: true };
}, 'assets', false, true);

API.assetsSetTitle = guardedApi(async (C, token, title, expectedRevision) => {
  const me = await assetsAuth(C, token, true), value = str(title);
  if (!value || value.length > 200) throw new Error('ชื่อตารางต้องมี 1–200 ตัวอักษร');
  if (expectedRevision !== C.guard.revision) throw new Error('ข้อมูลสินทรัพย์เปลี่ยนไปแล้ว กรุณาโหลดล่าสุดก่อนแก้ชื่อตาราง');
  await batch(C, [kvSetStmt(C, 'ASSETS_TITLE', value), assetsEvent(C, '__title__', C.guard.revision + 1, me, 'แก้ชื่อตารางสินทรัพย์', { title: value })]);
  return { title: value };
}, 'assets', false, true);

export { ASSETS_TITLE, ASSETS_STATUSES, ASSETS_MONEY, ASSETS_LABELS, assetFileFid, assetFileUrl, assetsSaveImageOps, assetsAuth, assetsClean, assetsRow, assetsWhere, assetsCodeKey, assetsValues, assetsUnique, assetsEvent };
