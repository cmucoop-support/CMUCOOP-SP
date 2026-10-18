import { all, batch, guardedApi, jsonBatches, kvSetStmt, now, one, revision, sha256hex, stateJson, stmt, str } from '../core/database.js';
import { stockBrKey, stockCodeKey, stockDate, stockNames, stockParseRows, stockRowsByGroup, thaiDayIso } from './stock.js';
import { authPerm } from './auth.js';
import { API } from '../core/registry.js';
import { sysLogTo } from '../core/logging.js';

function expiryBounds(ts = now()) {
  const today = thaiDayIso(ts), base = new Date(today + 'T00:00:00Z');
  const addMonths = months => {
    const year = base.getUTCFullYear(), month = base.getUTCMonth() + months;
    const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return new Date(Date.UTC(year, month, Math.min(base.getUTCDate(), last))).toISOString().slice(0, 10);
  };
  return { today, week: new Date(base.getTime() + 7 * 86400000).toISOString().slice(0, 10), month: addMonths(1), m3: addMonths(3), m6: addMonths(6), m12: addMonths(12) };
}

function expiryBucket(date, b) {
  if (date < b.today) return 'expired';
  if (date <= b.week) return 'week';
  if (date <= b.month) return 'month';
  if (date <= b.m3) return 'm3';
  if (date <= b.m6) return 'm6';
  if (date <= b.m12) return 'm12';
  return 'later';
}

async function expiryAuth(C, token, edit = false) {
  const me = await authPerm(C, token, 'expiry');
  if (edit && !me.perms.expiry_edit) throw new Error('บัญชีนี้ดูข้อมูลได้อย่างเดียว ไม่สามารถเปลี่ยนรายการแจ้งเตือนได้');
  return me;
}

function expiryClean(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('รูปแบบรายการไม่ถูกต้อง');
  const text = (v, max) => str(v).replace(/\s+/g, ' ').slice(0, max);
  const data = { barcode: str(p.barcode).replace(/\s+/g, '').slice(0, 64), name: text(p.name, 200), branch: text(p.branch, 80), location: text(p.location, 120), expires: stockDate(p.expires), quantity: /** @type {number | null} */ (null), unit: '', note: text(p.note, 1000) };
  if (!data.name) throw new Error('กรุณาระบุชื่อสินค้า');
  if (!data.branch) throw new Error('กรุณาระบุสาขา');
  if (!data.expires || Number(data.expires.slice(0, 4)) < 1900 || Number(data.expires.slice(0, 4)) > 2200) throw new Error('วันหมดอายุไม่ถูกต้อง กรุณาเลือกปี ค.ศ. จากปฏิทิน');
  if (p.quantity != null && !['number', 'string'].includes(typeof p.quantity)) throw new Error('จำนวนต้องเป็นตัวเลขหรือเว้นว่าง');
  if (p.quantity !== null && p.quantity !== undefined && str(p.quantity) !== '') {
    const value = Number(p.quantity);
    if (!Number.isFinite(value) || value < 0 || value > 1000000000 || Math.abs(value * 1000 - Math.round(value * 1000)) > 0.0001) throw new Error('จำนวนต้องเป็นเลขตั้งแต่ 0 ถึง 1,000,000,000 และทศนิยมไม่เกิน 3 ตำแหน่ง หรือเว้นว่าง');
    data.quantity = value; data.unit = text(p.unit, 20) || 'ชิ้น';
  }
  return data;
}

function expiryRow(row, bounds = expiryBounds()) {
  return { id: row.id, lot: 'LOT-' + String(row.id).padStart(6, '0'), barcode: row.barcode, name: row.name, branch: row.branch, location: row.location,
    expires: row.expires, quantity: row.quantity, unit: row.unit, note: row.note, status: row.status, version: row.version,
    createdTs: row.created_ts, createdBy: row.created_by, updatedTs: row.updated_ts, updatedBy: row.updated_by,
    days: Math.round((Date.parse(row.expires + 'T00:00:00Z') - Date.parse(bounds.today + 'T00:00:00Z')) / 86400000), bucket: expiryBucket(row.expires, bounds) };
}

function expiryCountsStmt(C, branch, b) {
  return stmt(C, `WITH cut(today,week,month,m3,m6,m12) AS (VALUES(?,?,?,?,?,?))
    SELECT COUNT(*) AS total,
      COALESCE(SUM(expires<today),0) AS expired,
      COALESCE(SUM(expires>=today AND expires<=week),0) AS week,
      COALESCE(SUM(expires>week AND expires<=month),0) AS month,
      COALESCE(SUM(expires>month AND expires<=m3),0) AS m3,
      COALESCE(SUM(expires>m3 AND expires<=m6),0) AS m6,
      COALESCE(SUM(expires>m6 AND expires<=m12),0) AS m12,
      COALESCE(SUM(expires>m12),0) AS later
    FROM expiry_lots,cut WHERE status IN ('active','acknowledged') AND (?='' OR branch=?)`, b.today, b.week, b.month, b.m3, b.m6, b.m12, branch, branch);
}

API.expirySummary = async (C, token, branch) => {
  await expiryAuth(C, token);
  const bounds = expiryBounds(), data = await expiryCountsStmt(C, str(branch), bounds).first();
  return { counts: data, bounds };
};

const expiryCatalogBuilds = new WeakMap();

const expiryCodeKey = value => stockCodeKey(value).replace(/^p(?=\d)/, '');

async function expiryBuildCatalog(C, rev) {
  const [names, state, by] = await Promise.all([stockNames(C), stateJson(C, 'STOCK_GROUPS', null), stockRowsByGroup(C, 0)]);
  let cfg = {};
  if (names.__BR_CFG__) {
    try { cfg = JSON.parse(names.__BR_CFG__); if (!cfg || typeof cfg !== 'object') throw new Error(); }
    catch (_) { throw new Error('การตั้งค่าสาขาสินค้าค้างสต็อกไม่ถูกต้อง กรุณาติดต่อผู้ดูแล'); }
  }
  const removed = cfg.delBranches && typeof cfg.delBranches === 'object' ? cfg.delBranches : {};
  const branches = new Set(), products = new Map();
  const addBranch = value => {
    const name = str(value).replace(/\s+/g, ' ').slice(0, 80);
    if (name && !removed[stockBrKey(name)]) branches.add(name);
  };
  (Array.isArray(cfg.branches) ? cfg.branches : []).forEach(addBranch);
  if (state !== null) {
    if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('ข้อมูลกำกับสินค้าค้างสต็อกไม่ถูกต้อง');
    Object.keys(state).forEach(g => {
      const meta = state[g] && state[g].cur;
      if (meta && meta.count > 0 && !by.has(g)) throw new Error('ข้อมูลสต็อกไม่ครบ (หมวด ' + g + ') กรุณาติดต่อผู้ดูแล');
      if (meta && meta.br) Object.keys(meta.br).forEach(addBranch);
    });
  } else {
    if (by.size) throw new Error('ไม่พบข้อมูลกำกับสินค้าค้างสต็อก กรุณาติดต่อผู้ดูแล');
    // Read legacy data without migrating or modifying the stock system.
    const parts = await all(C, 'SELECT n,data FROM stock_data ORDER BY n');
    if (parts.some((p, i) => p.n !== i)) throw new Error('ข้อมูลสต็อกเดิมไม่ครบ กรุณาติดต่อผู้ดูแล');
    if (parts.length) by.set('legacy', stockParseRows(parts.map(p => p.data).join(''), 'ข้อมูลเดิม'));
  }
  by.forEach(rows => rows.forEach(row => {
    addBranch(row[3]);
    const code = str(row[1]).replace(/\s+/g, '').slice(0, 64), name = str(row[2]).replace(/\s+/g, ' ').slice(0, 200), branch = str(row[3]).replace(/\s+/g, ' ').slice(0, 80), group = str(row[0]);
    if (!code || !name || !branch || removed[stockBrKey(branch)]) return;
    const record = [expiryCodeKey(code), branch, code, name, group];
    products.set(JSON.stringify([record[0], branch, group, name]), record);
  }));
  // Compare the minimal projection before writing. Recreating all product rows
  // on each stock revision also rewrites their indexes and quickly spends D1's
  // free daily allowance. Unchanged products require no product-table writes.
  const existing = await all(C, 'SELECT code_key,branch,code,name,group_code FROM expiry_products'), seen = new Set(), removedKeys = [], changedProducts = [];
  for (const row of existing) {
    const key = JSON.stringify([row.code_key, row.branch, row.group_code, row.name]), next = products.get(key);
    if (!next) removedKeys.push([row.code_key, row.branch, row.group_code, row.name]);
    else { seen.add(key); if (next[2] !== row.code) changedProducts.push(next); }
  }
  for (const [key, row] of products) if (!seen.has(key)) changedProducts.push(row);
  const metadata = { version: 1, revision: rev, branches: [...branches].sort(), total: products.size };
  const ops = [
    stmt(C, "INSERT OR IGNORE INTO write_revisions(scope,revision) VALUES('expiry_catalog',0)"),
    stmt(C, "UPDATE write_revisions SET revision=CASE WHEN COALESCE((SELECT revision FROM write_revisions WHERE scope='stock'),0)=? THEN revision+1 ELSE -1 END WHERE scope='expiry_catalog'", rev)
  ];
  for (const chunk of jsonBatches(removedKeys)) ops.push(stmt(C, `DELETE FROM expiry_products WHERE (code_key,branch,group_code,name) IN
    (SELECT json_extract(value,'$[0]'),json_extract(value,'$[1]'),json_extract(value,'$[2]'),json_extract(value,'$[3]') FROM json_each(?))`, chunk));
  for (const chunk of jsonBatches(changedProducts)) ops.push(stmt(C, `INSERT INTO expiry_products(code_key,branch,code,name,group_code)
    SELECT json_extract(value,'$[0]'),json_extract(value,'$[1]'),json_extract(value,'$[2]'),json_extract(value,'$[3]'),json_extract(value,'$[4]') FROM json_each(?) WHERE 1
    ON CONFLICT(code_key,branch,group_code,name) DO UPDATE SET code=excluded.code WHERE expiry_products.code<>excluded.code`, chunk));
  ops.push(kvSetStmt(C, 'EXPIRY_STOCK_CATALOG', JSON.stringify(metadata)));
  await batch(C, ops);
  return metadata;
}

async function expiryStockCatalog(C) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const rev = await revision(C, 'stock'), cached = await stateJson(C, 'EXPIRY_STOCK_CATALOG', null);
    if (cached && cached.version === 1 && cached.revision === rev && Array.isArray(cached.branches)) return cached;
    let pending = expiryCatalogBuilds.get(C.env.DB);
    if (!pending || pending.revision !== rev) {
      const promise = expiryBuildCatalog(C, rev);
      pending = { revision: rev, promise }; expiryCatalogBuilds.set(C.env.DB, pending);
    }
    try { return await pending.promise; }
    catch (e) { if (e.code !== 'WRITE_CONFLICT' || attempt === 2) throw e; }
    finally { if (expiryCatalogBuilds.get(C.env.DB) === pending) expiryCatalogBuilds.delete(C.env.DB); }
  }
}

API.expiryCatalog = guardedApi(async (C, token) => {
  await expiryAuth(C, token);
  return expiryStockCatalog(C);
}, 'stock', true);

API.expiryLookup = guardedApi(async (C, token, query, branch) => {
  await expiryAuth(C, token); await expiryStockCatalog(C);
  const q = str(query).slice(0, 120), br = str(branch).slice(0, 80);
  if (q.length < 2) return { rows: [], more: false };
  const key = expiryCodeKey(q), keys = [key];
  if (/^\d{12}$/.test(key)) keys.push('0' + key);
  if (/^0\d{12}$/.test(key)) keys.push(key.slice(1));
  const literal = '%' + q.replace(/[!%_]/g, '!$&') + '%';
  // Exact scans use the primary-key index, even with a large source catalog.
  let rows = await all(C, `SELECT code,name,branch,group_code AS category FROM expiry_products
    WHERE code_key IN (SELECT value FROM json_each(?)) AND (?='' OR branch=?) ORDER BY code,name,branch,group_code LIMIT 31`, JSON.stringify(keys), br, br);
  if (!rows.length) rows = await all(C, `SELECT code,name,branch,group_code AS category FROM expiry_products
    WHERE (?='' OR branch=?) AND (code LIKE ? ESCAPE '!' OR name LIKE ? ESCAPE '!') ORDER BY code,name,branch,group_code LIMIT 31`, br, br, literal, literal);
  return { rows: rows.slice(0, 30), more: rows.length > 30 };
}, 'stock', true);

async function expiryValidateSource(C, data) {
  const catalog = await expiryStockCatalog(C);
  if (!catalog.branches.includes(data.branch)) throw new Error('กรุณาเลือกสาขาจากระบบสินค้าค้างสต็อก');
  if (!data.barcode || !await one(C, 'SELECT 1 AS found FROM expiry_products WHERE code_key=? AND code=? AND name=? AND branch=? LIMIT 1', expiryCodeKey(data.barcode), data.barcode, data.name, data.branch))
    throw new Error('กรุณาค้นหาและเลือกสินค้าจากระบบสินค้าค้างสต็อกอีกครั้ง (ไม่พบสินค้านี้ในสาขาที่เลือก)');
}

API.expiryList = async (C, token, options) => {
  const me = await expiryAuth(C, token), o = options && typeof options === 'object' ? options : {}, bounds = expiryBounds();
  const branch = str(o.branch).slice(0, 80), search = str(o.q).slice(0, 120), state = ['open','closed','all'].includes(o.state) ? o.state : 'open';
  const size = 50, page = Math.min(20000, Math.max(1, Math.floor(Number(o.page) || 1))), where = [], params = [];
  if (state === 'open') where.push("status IN ('active','acknowledged')");
  if (state === 'closed') where.push("status='closed'");
  if (branch) { where.push('branch=?'); params.push(branch); }
  if (search) {
    const q = '%' + search.replace(/[\\%_]/g, '\\$&') + '%';
    where.push("(name LIKE ? ESCAPE '\\' OR barcode LIKE ? ESCAPE '\\' OR location LIKE ? ESCAPE '\\' OR ('LOT-'||printf('%06d',id)) LIKE ? ESCAPE '\\')"); params.push(q, q, q, q);
  }
  const ranges = {
    expired: ['expires<?', bounds.today], week: ['expires>=? AND expires<=?', bounds.today, bounds.week],
    month: ['expires>? AND expires<=?', bounds.week, bounds.month], m3: ['expires>? AND expires<=?', bounds.month, bounds.m3],
    m6: ['expires>? AND expires<=?', bounds.m3, bounds.m6], m12: ['expires>? AND expires<=?', bounds.m6, bounds.m12], later: ['expires>?', bounds.m12]
  };
  if (o.bucket && o.bucket !== 'all') {
    if (!Object.hasOwn(ranges, o.bucket)) throw new Error('ช่วงเวลาแจ้งเตือนไม่ถูกต้อง');
    const [sql, ...p] = ranges[o.bucket]; where.push('(' + sql + ')'); params.push(...p);
  }
  const filter = where.length ? ' WHERE ' + where.join(' AND ') : '';
  // Counts, branches and this page come from one consistent D1 transaction.
  const results = await batch(C, [
    stmt(C, 'SELECT * FROM expiry_lots' + filter + ' ORDER BY expires,id LIMIT ? OFFSET ?', ...params, size, (page - 1) * size),
    stmt(C, 'SELECT COUNT(*) AS n FROM expiry_lots' + filter, ...params), expiryCountsStmt(C, branch, bounds),
    stmt(C, 'SELECT DISTINCT branch FROM expiry_lots ORDER BY branch')
  ]);
  return { rows: (results[0].results || []).map(r => expiryRow(r, bounds)), total: results[1].results[0].n, counts: results[2].results[0], branches: (results[3].results || []).map(r => r.branch), page, pageSize: size, bounds, me: { name: me.name, edit: !!me.perms.expiry_edit } };
};

API.expiryCreate = async (C, token, payload) => {
  const me = await expiryAuth(C, token, true), data = expiryClean(payload), requestId = str(payload.requestId);
  if (!/^[a-zA-Z0-9_-]{16,80}$/.test(requestId)) throw new Error('รหัสคำขอไม่ถูกต้อง กรุณาเปิดฟอร์มเพิ่มล็อตใหม่');
  const digest = await sha256hex(JSON.stringify(data)), ts = now();
  // Old clients/pending receipts remain compatible. New forms explicitly select stock data.
  if (payload.stockSource === true) {
    const previous = await one(C, 'SELECT * FROM expiry_lots WHERE request_id=?', requestId);
    if (previous) {
      if (previous.create_hash !== digest || previous.created_user !== me.user) throw new Error('คำขอนี้เคยส่งด้วยข้อมูลอื่นแล้ว กรุณาตรวจล็อตเดิมก่อนเพิ่มรายการใหม่');
      return { lot: expiryRow(previous), replayed: true };
    }
    await expiryValidateSource(C, data);
  }
  const results = await batch(C, [
    stmt(C, `INSERT INTO expiry_lots(request_id,create_hash,barcode,name,branch,location,expires,quantity,unit,note,created_ts,created_user,created_by,updated_ts,updated_by)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(request_id) DO NOTHING`, requestId, digest, data.barcode, data.name, data.branch, data.location, data.expires, data.quantity, data.unit, data.note, ts, me.user, me.name, ts, me.name),
    stmt(C, `INSERT INTO expiry_events(lot_id,version,ts,who,action,detail)
      SELECT id,1,created_ts,created_by,'เพิ่มล็อต',? FROM expiry_lots WHERE request_id=? AND create_hash=? AND created_user=? AND version=1
      AND NOT EXISTS (SELECT 1 FROM expiry_events e WHERE e.lot_id=expiry_lots.id AND e.version=1)`, JSON.stringify(data), requestId, digest, me.user),
    stmt(C, 'SELECT * FROM expiry_lots WHERE request_id=?', requestId)
  ]);
  const row = results[2].results[0];
  if (!row || row.create_hash !== digest || row.created_user !== me.user) throw new Error('คำขอนี้เคยส่งด้วยข้อมูลอื่นแล้ว กรุณาตรวจล็อตเดิมก่อนเพิ่มรายการใหม่');
  const replayed = !results[0].meta.changes;
  if (!replayed) await sysLogTo(C, me.name, 'วันหมดอายุ', 'เพิ่มล็อต', 'LOT-' + row.id + ' · ' + data.name + ' · ' + data.expires);
  return { lot: expiryRow(row), replayed };
};

API.expiryHistory = async (C, token, id) => {
  await expiryAuth(C, token);
  const result = await batch(C, [stmt(C, 'SELECT * FROM expiry_lots WHERE id=?', Number(id) || 0), stmt(C, 'SELECT version,ts,who,action,detail FROM expiry_events WHERE lot_id=? ORDER BY version DESC LIMIT 100', Number(id) || 0)]);
  if (!result[0].results.length) throw new Error('ไม่พบล็อตนี้');
  return { lot: expiryRow(result[0].results[0]), events: result[1].results || [] };
};

async function expiryWrite(C, me, current, expectedVersion, data, action, detail) {
  if (!Number.isInteger(expectedVersion) || current.version !== expectedVersion) throw new Error('ล็อตนี้ถูกแก้ไขแล้ว กรุณาโหลดข้อมูลล่าสุดก่อนบันทึก');
  const ts = Math.max(now(), current.updated_ts + 1), nextVersion = expectedVersion + 1;
  let results;
  try {
    results = await batch(C, [
      stmt(C, `UPDATE expiry_lots SET barcode=?,name=?,branch=?,location=?,expires=?,quantity=?,unit=?,note=?,status=?,updated_ts=?,updated_by=?,
        version=CASE WHEN version=? THEN version+1 ELSE 0 END WHERE id=?`, data.barcode, data.name, data.branch, data.location, data.expires, data.quantity, data.unit, data.note, data.status, ts, me.name, expectedVersion, current.id),
      stmt(C, `INSERT INTO expiry_events(lot_id,version,ts,who,action,detail)
        SELECT id,version,updated_ts,updated_by,?,? FROM expiry_lots WHERE id=? AND version=? AND updated_ts=?`, action, detail, current.id, nextVersion, ts),
      stmt(C, 'SELECT * FROM expiry_lots WHERE id=?', current.id)
    ]);
  } catch (e) {
    if (/expiry_revision_conflict/.test(String(e))) throw new Error('ล็อตนี้ถูกแก้ไขพร้อมกัน กรุณาโหลดข้อมูลล่าสุดก่อนบันทึก');
    throw e;
  }
  if (!results[0].meta.changes || !results[2].results.length) throw new Error('ไม่พบล็อตนี้ กรุณาโหลดข้อมูลล่าสุด');
  await sysLogTo(C, me.name, 'วันหมดอายุ', action, 'LOT-' + current.id + ' · ' + data.name);
  return { lot: expiryRow(results[2].results[0]) };
}

API.expiryUpdate = async (C, token, id, version, payload) => {
  const me = await expiryAuth(C, token, true), data = expiryClean(payload), current = await one(C, 'SELECT * FROM expiry_lots WHERE id=?', Number(id) || 0);
  if (!current) throw new Error('ไม่พบล็อตนี้');
  if (payload.stockSource === true && (data.barcode !== current.barcode || data.name !== current.name || data.branch !== current.branch)) await expiryValidateSource(C, data);
  data.status = current.status;
  return expiryWrite(C, me, current, version, data, 'แก้ไขล็อต', JSON.stringify({ before: expiryRow(current), after: data }));
};

API.expirySetStatus = async (C, token, id, version, status) => {
  const me = await expiryAuth(C, token, true);
  if (!['active','acknowledged','closed'].includes(status)) throw new Error('สถานะไม่ถูกต้อง');
  const current = await one(C, 'SELECT * FROM expiry_lots WHERE id=?', Number(id) || 0);
  if (!current) throw new Error('ไม่พบล็อตนี้');
  if (current.version !== version) throw new Error('ล็อตนี้ถูกแก้ไขแล้ว กรุณาโหลดข้อมูลล่าสุด');
  if (current.status === status) return { lot: expiryRow(current) };
  const data = { ...expiryClean(current), status };
  return expiryWrite(C, me, current, version, data, { active: 'เปิดแจ้งเตือนอีกครั้ง', acknowledged: 'รับทราบ', closed: 'ปิดแจ้งเตือน' }[status], JSON.stringify({ from: current.status, to: status }));
};

export { expiryBounds, expiryBucket, expiryAuth, expiryClean, expiryRow, expiryCountsStmt, expiryCatalogBuilds, expiryCodeKey, expiryBuildCatalog, expiryStockCatalog, expiryValidateSource, expiryWrite };
