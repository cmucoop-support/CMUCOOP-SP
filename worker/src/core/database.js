const str = v => (v === null || v === undefined ? '' : String(v).trim());

const now = () => Date.now();

const all = async (C, sql, ...p) => (await C.env.DB.prepare(sql).bind(...p).all()).results || [];

const one = (C, sql, ...p) => C.env.DB.prepare(sql).bind(...p).first();

const statementInfo = new WeakMap();

function stmt(C, sql, ...p) {
  const q = C.env.DB.prepare(sql).bind(...p); statementInfo.set(q, { sql, p }); return q;
}

const run = async (C, sql, ...p) => (await batch(C, [stmt(C, sql, ...p)]))[0];

const utf8Size = value => new TextEncoder().encode(value).byteLength;

function jsonBatches(values, maxBytes = 1200000) {
  const out = []; let parts = [], bytes = 2;
  for (const value of values) {
    const json = JSON.stringify(value), size = utf8Size(json) + 1;
    if (size > maxBytes) throw new Error('ข้อมูลหนึ่งรายการใหญ่เกินขนาดที่บันทึกได้');
    if (bytes + size > maxBytes && parts.length) { out.push('[' + parts.join(',') + ']'); parts = []; bytes = 2; }
    parts.push(json); bytes += size;
  }
  if (parts.length) out.push('[' + parts.join(',') + ']');
  return out;
}

function scopeWrite(info, scope) {
  if (!info || !/^(INSERT|UPDATE|DELETE)/i.test(info.sql)) return false;
  if (scope === 'stock') return /\bstock_(grp|data)\b/i.test(info.sql) || (/\bkv\b/.test(info.sql) && info.p.some(v => typeof v === 'string' && v.startsWith('STOCK_')));
  if (scope === 'barcode') return /^(?:INSERT(?: OR [A-Z]+)? INTO|UPDATE|DELETE FROM) barcode_(items|cats)\b/i.test(info.sql);
  if (scope === 'media') return /^(?:INSERT(?: OR [A-Z]+)? INTO|UPDATE|DELETE FROM) (sounds|banners)\b/i.test(info.sql);
  return false;
}

function compactStockOps(C, list) {
  const deletes = [], shifts = [], inserts = [], rest = [];
  for (const q of list) {
    const info = statementInfo.get(q);
    if (info && info.sql === 'DELETE FROM stock_grp WHERE g=? AND ver=1') deletes.push(info.p[0]);
    else if (info && info.sql === 'UPDATE stock_grp SET ver=1 WHERE g=? AND ver=0') shifts.push(info.p[0]);
    else if (info && info.sql.startsWith('INSERT OR REPLACE INTO stock_grp(g,ver,n,data) SELECT')) {
      const [g, ver, payload] = info.p;
      for (const [n, data] of JSON.parse(payload)) inserts.push([g, ver, n, data]);
    } else rest.push(q);
  }
  if (!deletes.length && !shifts.length && !inserts.length) return list;
  const ops = [];
  if (deletes.length) ops.push(stmt(C, 'DELETE FROM stock_grp WHERE ver=1 AND g IN (SELECT value FROM json_each(?))', JSON.stringify(deletes)));
  if (shifts.length) ops.push(stmt(C, 'UPDATE stock_grp SET ver=1 WHERE ver=0 AND g IN (SELECT value FROM json_each(?))', JSON.stringify(shifts)));
  for (const payload of jsonBatches(inserts)) ops.push(stmt(C, "INSERT OR REPLACE INTO stock_grp(g,ver,n,data) SELECT json_extract(value,'$[0]'),json_extract(value,'$[1]'),json_extract(value,'$[2]'),json_extract(value,'$[3]') FROM json_each(?)", payload));
  // Special cases deleting ver=0 or all versions must retain their original order.
  if (rest.some(q => /^(DELETE|UPDATE).*stock_grp/.test(statementInfo.get(q)?.sql || ''))) return list;
  return ops.concat(rest);
}

async function batch(C, list) {
  if (!list.length) return [];
  if (C.guard && C.guard.scope === 'stock') list = compactStockOps(C, list);
  let ops = [], ends = [];
  const guarded = C.guard && list.some(q => scopeWrite(statementInfo.get(q), C.guard.scope));
  if (guarded) {
    ops.push(stmt(C, 'INSERT OR IGNORE INTO write_revisions(scope,revision) VALUES(?,0)', C.guard.scope));
    ops.push(stmt(C, 'UPDATE write_revisions SET revision=CASE WHEN revision=? THEN revision+1 ELSE -1 END WHERE scope=?', C.guard.revision, C.guard.scope));
  }
  for (const q of list) {
    const info = statementInfo.get(q);
    if (info && info.kv !== undefined) {
      const { kv: k, value } = info;
      // Chunk large KV documents; only write chunks that actually changed.
      if (utf8Size(value) > 250000) {
        if (utf8Size(value) > 24 * 1024 * 1024) throw new Error('ข้อมูลประกอบใหญ่เกิน 24 MB กรุณาแบ่งชุด');
        const chunks = [];
        for (let i = 0; i < value.length; i += 240000) chunks.push([chunks.length, value.slice(i, i + 240000)]);
        ops.push(stmt(C, 'DELETE FROM kv_chunks WHERE k=? AND n>=?', k, chunks.length));
        for (const payload of jsonBatches(chunks)) ops.push(stmt(C, "INSERT INTO kv_chunks(k,n,data) SELECT ?,json_extract(value,'$[0]'),json_extract(value,'$[1]') FROM json_each(?) WHERE 1 ON CONFLICT(k,n) DO UPDATE SET data=excluded.data WHERE kv_chunks.data<>excluded.data", k, payload));
        ops.push(stmt(C, 'INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v WHERE kv.v<>excluded.v', k, JSON.stringify({ __kvChunks: true, count: chunks.length })));
      } else {
        ops.push(stmt(C, 'DELETE FROM kv_chunks WHERE k=?', k));
        ops.push(q);
      }
    } else {
      ops.push(q);
      if (info && /^DELETE FROM kv WHERE k=\?$/.test(info.sql)) ops.push(stmt(C, 'DELETE FROM kv_chunks WHERE k=?', info.p[0]));
    }
    ends.push(ops.length - 1);
  }
  let results;
  try {
    results = await C.env.DB.batch(ops);
  }
  catch (e) {
    if (/revision_conflict/.test(String(e))) throw Object.assign(new Error('ข้อมูลถูกแก้ไขพร้อมกัน กรุณาโหลดข้อมูลล่าสุดแล้วลองบันทึกอีกครั้ง'), { code: 'WRITE_CONFLICT' });
    throw e;
  }
  if (guarded) { C.guard.revision++; C.guard.committed = true; }
  return ends.map(i => results[i]);
}

async function kvDecode(C, k, raw) {
  if (typeof raw !== 'string' || !raw.startsWith('{"__kvChunks":true,')) return raw;
  const snapshot = await C.env.DB.batch([
    stmt(C, 'SELECT v FROM kv WHERE k=?', k), stmt(C, 'SELECT n,data FROM kv_chunks WHERE k=? ORDER BY n', k)
  ]);
  const head = (snapshot[0].results || [])[0]; if (!head) return null;
  const marker = JSON.parse(head.v);
  if (!marker || marker.__kvChunks !== true) return head.v;
  const parts = snapshot[1].results || [];
  if (parts.length !== marker.count || parts.some((p, i) => p.n !== i)) throw new Error('ข้อมูลประกอบไม่ครบ (' + k + ') กรุณาติดต่อผู้ดูแล');
  return parts.map(p => p.data).join('');
}

async function kvGet(C, k, def) {
  const r = await one(C, 'SELECT v FROM kv WHERE k=?', k);
  return r ? kvDecode(C, k, r.v) : def;
}

function kvSetStmt(C, k, v) {
  const value = String(v), q = stmt(C, 'INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v WHERE kv.v<>excluded.v', k, value);
  Object.assign(statementInfo.get(q), { kv: k, value }); return q;
}

const kvSet = async (C, k, v) => (await batch(C, [kvSetStmt(C, k, v)]))[0];

async function revision(C, scope) { const r = await one(C, 'SELECT revision FROM write_revisions WHERE scope=?', scope); return r ? r.revision : 0; }

function guardedApi(fn, scope, readOnly = false, includeRevision = false) {
  return async (C, ...args) => {
    // Retrying only a known rolled-back conflict is safe for additive operations.
    for (let attempt = 0; ; attempt++) {
      const scoped = { ...C, guard: { scope, revision: await revision(C, scope), committed: false } };
      try {
        const result = await fn(scoped, ...args);
        if (readOnly && await revision(scoped, scope) !== scoped.guard.revision) {
          throw Object.assign(new Error('ข้อมูลเปลี่ยนระหว่างโหลด กรุณาโหลดใหม่'), { code: 'WRITE_CONFLICT' });
        }
        if (includeRevision && result && typeof result === 'object' && !Array.isArray(result)) result.revision = scoped.guard.revision;
        return result;
      } catch (e) {
        if (e.code === 'WRITE_CONFLICT' && !scoped.guard.committed && attempt < 2) continue;
        throw e;
      }
    }
  };
}

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
  if (!keys.length) return Object.create(null);
  const payload = JSON.stringify(keys);
  const snapshot = await C.env.DB.batch([
    stmt(C, 'SELECT k,v FROM kv WHERE k IN (SELECT value FROM json_each(?))', payload),
    stmt(C, 'SELECT k,n,data FROM kv_chunks WHERE k IN (SELECT value FROM json_each(?)) ORDER BY k,n', payload)
  ]);
  const out = Object.create(null), by = new Map();
  for (const r of snapshot[1].results || []) { if (!by.has(r.k)) by.set(r.k, []); by.get(r.k).push(r); }
  for (const r of snapshot[0].results || []) {
    if (typeof r.v === 'string' && r.v.startsWith('{"__kvChunks":true,')) {
      const marker = JSON.parse(r.v), parts = by.get(r.k) || [];
      if (parts.length !== marker.count || parts.some((p, i) => p.n !== i)) throw new Error('ข้อมูลประกอบไม่ครบ (' + r.k + ') กรุณาติดต่อผู้ดูแล');
      out[r.k] = parts.map(p => p.data).join('');
    } else out[r.k] = r.v;
  }
  return out;
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

const hashPw = (salt, pw) => sha256hex(salt + '|' + pw);

const uuid = () => crypto.randomUUID();

const passArg = v => String(v === null || v === undefined ? '' : v);

export { str, now, all, one, statementInfo, stmt, run, utf8Size, jsonBatches, scopeWrite, compactStockOps, batch, kvDecode, kvGet, kvSetStmt, kvSet, revision, guardedApi, kvJson, stateJson, kvMany, numSetting, sha256hex, hashPw, uuid, passArg };
