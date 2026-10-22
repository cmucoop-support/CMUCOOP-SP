/* Branch product directory. Source tables remain authoritative; this index stores
 * only public product fields, never purchase costs, margins, or sale prices. */
const SOURCE_LABELS = { barcode: 'บาร์สินค้า', stock: 'สินค้าค้างสต็อก', market: 'เช็คราคาตลาด', expiry: 'วันหมดอายุ' };
const SOURCE_ORDER = { stock: 0, market: 1, expiry: 2, barcode: 3 };
const GLOBAL = '__global__', UNKNOWN = '__unknown__';
const text = value => value == null ? '' : String(value).trim();
const clean = (value, max = 200) => text(value).slice(0, max);
const nameKey = value => text(value).replace(/\s+/g, ' ').toLowerCase();
const sortText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const recordKey = record => JSON.stringify([record.system, record.ref]);
const branchKey = value => text(value) ? 'b:' + text(value).replace(/\s+/g, '').toLowerCase() : UNKNOWN;
const trigger = (table, event, condition = '') => `CREATE TRIGGER IF NOT EXISTS catalog_dirty_${table}_${event.toLowerCase()} AFTER ${event} ON ${table} WHEN (SELECT batching FROM product_catalog_state WHERE id=1)=0${condition ? ' AND (' + condition + ')' : ''} BEGIN UPDATE product_catalog_state SET source_revision=source_revision+1 WHERE id=1; END`;
const relevantKV = prefix => `(${prefix}.k='MARKET_STATE' OR ${prefix}.k GLOB 'STOCK_*')`;

export const PRODUCT_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS product_catalog_state (
    id INTEGER PRIMARY KEY CHECK(id=1), source_revision INTEGER NOT NULL DEFAULT 0, batching INTEGER NOT NULL DEFAULT 0 CHECK(batching IN (0,1)),
    synced_revision INTEGER NOT NULL DEFAULT -1 CONSTRAINT product_catalog_revision_conflict CHECK(synced_revision>=-1),
    synced_ts INTEGER NOT NULL DEFAULT 0, branches_json TEXT NOT NULL DEFAULT '[]'
  )`,
  'INSERT OR IGNORE INTO product_catalog_state(id) VALUES(1)',
  `CREATE TABLE IF NOT EXISTS product_catalog (
    product_key TEXT PRIMARY KEY, branch_key TEXT NOT NULL, code_key TEXT NOT NULL,
    name TEXT NOT NULL, search_text TEXT NOT NULL, source_mask INTEGER NOT NULL,
    conflict_count INTEGER NOT NULL, data TEXT NOT NULL, updated_ts INTEGER NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS product_catalog_branch ON product_catalog(branch_key,product_key)',
  'CREATE INDEX IF NOT EXISTS product_catalog_code ON product_catalog(code_key,product_key)',
  `CREATE TABLE IF NOT EXISTS product_catalog_records (
    product_key TEXT NOT NULL, source_key TEXT NOT NULL, system TEXT NOT NULL, data TEXT NOT NULL, search_text TEXT NOT NULL,
    PRIMARY KEY(product_key,source_key)
  )`,
  'CREATE INDEX IF NOT EXISTS product_catalog_record_system ON product_catalog_records(system,product_key)',
  ...['barcode_items', 'stock_data', 'market_data', 'expiry_lots'].flatMap(table => ['INSERT', 'UPDATE', 'DELETE'].map(event => trigger(table, event))),
  trigger('stock_grp', 'INSERT', 'NEW.ver=0'),
  trigger('stock_grp', 'DELETE', 'OLD.ver=0'),
  trigger('stock_grp', 'UPDATE', 'OLD.ver=0 OR NEW.ver=0'),
  ...['kv', 'kv_chunks'].flatMap(table => [
    trigger(table, 'INSERT', relevantKV('NEW')),
    trigger(table, 'DELETE', relevantKV('OLD')),
    trigger(table, 'UPDATE', relevantKV('OLD') + ' OR ' + relevantKV('NEW'))
  ])
];

/** The application's transaction helper uses this to suppress per-row trigger
 * updates inside bulk imports and bump the durable revision once on commit.
 * External SQL still runs the triggers normally. */
export function isCatalogSourceStatement(info) {
  if (!info) return false;
  const sql = text(info.sql), match = /^(?:INSERT(?: OR [A-Z]+)? INTO|UPDATE|DELETE FROM)\s+(\w+)\b/i.exec(sql);
  if (!match) return false;
  const table = match[1].toLowerCase();
  if (['barcode_items', 'stock_grp', 'stock_data', 'market_data', 'expiry_lots'].includes(table)) return true;
  if (table !== 'kv' && table !== 'kv_chunks') return false;
  return (info.p || []).some(value => typeof value === 'string' && (value === 'MARKET_STATE' || value.startsWith('STOCK_'))) || /['"](?:MARKET_STATE|STOCK_[A-Z0-9_]+)['"]/i.test(sql);
}

/** Install once after all source helpers are defined. Append PRODUCT_SCHEMA to
 * the application schema and bump SCHEMA_VERSION before serving this module. */
export function installProductCatalog(deps) {
  const { API, stmt, all, one, authPerm, stockLoadRows, marketRead, stockCodeKey, jsonBatches, kvGet } = deps;
  const clock = deps.now || Date.now;
  const pending = new WeakMap();
  const codeKey = value => stockCodeKey(text(value));
  const sourceBit = id => ({ barcode: 1, stock: 2, market: 4, expiry: 8 })[id] || 0;
  const meta = C => one(C, 'SELECT * FROM product_catalog_state WHERE id=1');
  const resultMeta = state => ({ revision: state.synced_revision, syncedAt: state.synced_ts });
  // Keep comfortably below D1's 2,000,000-byte bound-value limit while reducing
  // the number of statements needed for large derived indexes.
  const indexBatches = values => jsonBatches(values, 1800000);

  function makeRecord(system, ref, values) {
    const record = { system, ref, code: text(values.code), name: clean(values.name), branch: text(values.branch), category: clean(values.category, 120) };
    for (const key of ['unitBarcode', 'packBarcode', 'perPack', 'reportedAt', 'expires', 'status', 'location']) {
      if (values[key] != null && text(values[key])) record[key] = key === 'unitBarcode' || key === 'packBarcode' ? text(values[key]) : clean(values[key], key === 'location' ? 200 : 120);
    }
    if (values.quantity != null && text(values.quantity) !== '' && Number.isFinite(Number(values.quantity))) record.quantity = Number(values.quantity);
    record.sourceKey = recordKey(record);
    return record;
  }

  async function collect(C) {
    const [barcodes, currentRows, market, lots, legacy, rawNames, rawGroups] = await Promise.all([
      all(C, 'SELECT id,name,cat,packBar,unitBar,perPack FROM barcode_items ORDER BY id'),
      stockLoadRows(C, 0), marketRead(C),
      all(C, 'SELECT id,barcode,name,branch,location,expires,quantity,unit,status FROM expiry_lots ORDER BY id'),
      all(C, 'SELECT n,data FROM stock_data ORDER BY n'), kvGet(C, 'STOCK_NAMES', '{}'), kvGet(C, 'STOCK_GROUPS', null)
    ]);
    let stockState = null;
    if (rawGroups !== null) {
      try { stockState = JSON.parse(rawGroups); } catch { throw new Error('ข้อมูลกำกับหมวดสต็อกเสียหาย กรุณาติดต่อผู้ดูแล'); }
      if (!stockState || typeof stockState !== 'object' || Array.isArray(stockState)) throw new Error('ข้อมูลกำกับหมวดสต็อกไม่ถูกต้อง');
      const present = new Set(currentRows.map(row => text(row[0])));
      for (const [group, metadata] of Object.entries(stockState)) {
        if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('ข้อมูลกำกับหมวดสต็อกไม่ถูกต้อง');
        if (metadata.cur && metadata.cur.count > 0 && !present.has(group)) throw new Error('ข้อมูลสต็อกไม่ครบ (หมวด ' + group + ') กรุณาติดต่อผู้ดูแล');
      }
    } else if (currentRows.length) throw new Error('ไม่พบข้อมูลกำกับหมวดสต็อก กรุณาติดต่อผู้ดูแล');
    let stock = currentRows;
    if (!stock.length && legacy.length && rawGroups === null) {
      if (legacy.some((row, i) => row.n !== i)) throw new Error('ข้อมูลสต็อกเดิมไม่ครบ กรุณาติดต่อผู้ดูแล');
      try { stock = JSON.parse(legacy.map(row => row.data).join('')); } catch { throw new Error('ข้อมูลสต็อกเดิมเสียหาย กรุณาติดต่อผู้ดูแล'); }
      if (!Array.isArray(stock) || stock.some(row => !Array.isArray(row))) throw new Error('ข้อมูลสต็อกเดิมไม่ถูกต้อง');
    }
    const branches = new Map(), removedBranches = new Set();
    const rememberBranch = value => {
      const label = text(value), key = branchKey(label);
      if (!branches.has(key) || sortText(label, branches.get(key)) < 0) branches.set(key, label || 'ไม่ระบุสาขา');
      return key;
    };
    try {
      const names = JSON.parse(rawNames || '{}'), config = JSON.parse(names.__BR_CFG__ || '{}');
      if (!names || typeof names !== 'object' || Array.isArray(names) || !config || typeof config !== 'object' || Array.isArray(config)) throw new Error();
      if (config.delBranches && typeof config.delBranches === 'object') for (const [key, deleted] of Object.entries(config.delBranches)) if (deleted) removedBranches.add(branchKey(key));
      if (Array.isArray(config.branches)) for (const branch of config.branches) {
        if (!removedBranches.has(branchKey(branch))) rememberBranch(branch);
      }
    } catch { throw new Error('ข้อมูลชื่อสาขาไม่ถูกต้อง กรุณาติดต่อผู้ดูแล'); }
    if (stockState) for (const metadata of Object.values(stockState)) {
      if (metadata.cur && metadata.cur.br && typeof metadata.cur.br === 'object') for (const branch of Object.keys(metadata.cur.br)) if (!removedBranches.has(branchKey(branch))) rememberBranch(branch);
    }
    const records = [];
    // Codes alone establish identity. A missing code gets an isolated source key;
    // equal names must never merge two unrelated products.
    const occurrences = new Map();
    const rowRef = (system, values) => {
      const identity = [values.category, codeKey(values.code), branchKey(values.branch)];
      const base = JSON.stringify([system, ...identity]);
      const occurrence = occurrences.get(base) || 0; occurrences.set(base, occurrence + 1);
      return JSON.stringify([...identity, occurrence]);
    };
    for (const row of stock) {
      const values = { category: row[0], code: row[1], name: row[2], branch: row[3], quantity: row[4], reportedAt: row[14] };
      if (!text(values.name) && !text(values.code)) continue;
      rememberBranch(values.branch);
      records.push(makeRecord('stock', rowRef('stock', values), values));
    }
    const marketState = market.state || {}, byBranch = marketState.branches && typeof marketState.branches === 'object' ? marketState.branches : { '': marketState };
    for (const branch of Object.keys(byBranch).sort(sortText)) {
      const groups = byBranch[branch] && byBranch[branch].groups || {};
      if (branch || Object.keys(groups).length) rememberBranch(branch);
      for (const group of Object.keys(groups).sort(sortText)) {
        const current = groups[group] && groups[group].cur;
        for (const row of current && current.rows || []) {
          const values = { category: row[0] || group, code: row[1], name: row[2], branch, quantity: row[3], reportedAt: row[13] };
          if (!text(values.name) && !text(values.code)) continue;
          records.push(makeRecord('market', rowRef('market', values), values));
        }
      }
    }
    for (const row of lots) {
      rememberBranch(row.branch);
      records.push(makeRecord('expiry', String(row.id), { code: row.barcode, name: row.name, branch: row.branch, category: '', quantity: row.quantity, expires: row.expires, status: row.status, location: row.location }));
    }
    const barcodeByCode = new Map(), globals = [];
    for (const row of barcodes) {
      const codes = [...new Set([text(row.unitBar), text(row.packBar)].filter(Boolean))];
      const record = makeRecord('barcode', String(row.id), { code: codes[0] || '', name: row.name, branch: '', category: row.cat, unitBarcode: row.unitBar, packBarcode: row.packBar, perPack: row.perPack });
      globals.push({ record, codes: codes.length ? codes : [''] });
      for (const code of codes) {
        const key = codeKey(code);
        if (!barcodeByCode.has(key)) barcodeByCode.set(key, []);
        barcodeByCode.get(key).push(record);
      }
    }
    const products = new Map();
    const add = (record, branchCode, code, global = false) => {
      const normalized = codeKey(code), identity = normalized || 'missing:' + record.sourceKey;
      const key = JSON.stringify([branchCode, identity]);
      if (!products.has(key)) products.set(key, { key, branchCode, branch: global ? 'ข้อมูลกลาง (บาร์สินค้า)' : branches.get(branchCode) || 'ไม่ระบุสาขา', normalized, records: new Map(), codes: new Set() });
      const product = products.get(key);
      product.records.set(record.sourceKey, record);
      if (code) product.codes.add(code);
      return product;
    };
    for (const record of records) {
      const product = add(record, branchKey(record.branch), record.code);
      if (product.normalized) for (const barcode of barcodeByCode.get(product.normalized) || []) product.records.set(barcode.sourceKey, barcode);
    }
    for (const { record, codes } of globals) for (const code of codes) add(record, GLOBAL, code, true);
    if (globals.length) branches.set(GLOBAL, 'ข้อมูลกลาง (บาร์สินค้า)');
    return { products, branches: [...branches].sort((a, b) => sortText(a[0], b[0])).map(([branchCode, name]) => ({ branchCode, name })) };
  }

  function serialize(product) {
    const records = [...product.records.values()].sort((a, b) => SOURCE_ORDER[a.system] - SOURCE_ORDER[b.system] || sortText(a.sourceKey, b.sourceKey));
    const unique = (values, normalize = text, limit = 50) => {
      const found = new Map();
      for (const value of values) { const key = normalize(value); if (key && !found.has(key)) found.set(key, value); }
      return [...found.values()].slice(0, limit);
    };
    const names = unique(records.map(row => row.name), nameKey, 30), codes = unique([...product.codes], text, 30);
    const categories = unique(records.map(row => row.category));
    const sources = Object.keys(SOURCE_LABELS).filter(source => records.some(row => row.system === source));
    const conflicts = [];
    if (!product.normalized) conflicts.push({ field: 'code', values: ['ไม่ระบุรหัส'] });
    if (names.length > 1) conflicts.push({ field: 'name', values: names });
    const body = {
      productKey: product.key, branchCode: product.branchCode, branch: product.branch,
      code: codes[0] || '', name: names[0] || '', codes, names, categories, sources,
      sourceCount: records.length, conflicts, conflictCount: conflicts.length
    };
    const search = unique([product.branch, ...product.codes, ...records.flatMap(row => [row.name, row.category, row.unitBarcode || '', row.packBarcode || ''])], value => text(value).toLowerCase(), 500).join(' ').toLowerCase();
    return { body, search, mask: sources.reduce((mask, source) => mask | sourceBit(source), 0), records };
  }

  async function rebuild(C) {
    const before = await meta(C);
    if (before.source_revision === before.synced_revision) return before;
    const collected = await collect(C);
    const [oldProducts, oldRecords] = await Promise.all([
      all(C, 'SELECT product_key,data,search_text FROM product_catalog'),
      all(C, 'SELECT product_key,source_key,data FROM product_catalog_records')
    ]);
    const previousProducts = new Map(oldProducts.map(row => [row.product_key, row]));
    const previousRecords = new Map(oldRecords.map(row => [JSON.stringify([row.product_key, row.source_key]), row]));
    const changedProducts = [], changedRecords = [], ts = clock();
    for (const product of collected.products.values()) {
      const { body, search, mask, records } = serialize(product), data = JSON.stringify(body), previous = previousProducts.get(product.key);
      let detailChanged = false;
      previousProducts.delete(product.key);
      for (const record of records) {
        // source_key is already indexed in its own column; duplicating it in
        // JSON inflates Thai source records and every bulk-write parameter.
        const { sourceKey, ...fields } = record;
        const key = JSON.stringify([product.key, sourceKey]), data = JSON.stringify(fields), previous = previousRecords.get(key);
        if (!previous || previous.data !== data) {
          detailChanged = true;
          const recordSearch = [record.code, record.name, record.branch, record.category, record.unitBarcode || '', record.packBarcode || ''].join(' ').toLowerCase();
          changedRecords.push([product.key, record.sourceKey, record.system, data, recordSearch]);
        }
        previousRecords.delete(key);
      }
      if (!previous || previous.data !== data || previous.search_text !== search || detailChanged) changedProducts.push([product.key, product.branchCode, product.normalized, body.name, search, mask, body.conflictCount, data, ts]);
    }
    // All mutations, including removals, commit under one compare-and-swap. If a
    // source save lands during collection, SQLite aborts and rolls back this batch.
    const ops = [stmt(C, `UPDATE product_catalog_state SET synced_revision=CASE WHEN source_revision=? THEN source_revision ELSE -2 END,synced_ts=?,branches_json=? WHERE id=1`, before.source_revision, ts, JSON.stringify(collected.branches))];
    for (const payload of indexBatches([...previousRecords.values()].map(row => [row.product_key, row.source_key]))) ops.push(stmt(C, `DELETE FROM product_catalog_records WHERE (product_key,source_key) IN (SELECT json_extract(value,'$[0]'),json_extract(value,'$[1]') FROM json_each(?))`, payload));
    for (const payload of indexBatches([...previousProducts.keys()])) ops.push(stmt(C, 'DELETE FROM product_catalog WHERE product_key IN (SELECT value FROM json_each(?))', payload));
    for (const payload of indexBatches(changedProducts)) ops.push(stmt(C, `INSERT INTO product_catalog(product_key,branch_key,code_key,name,search_text,source_mask,conflict_count,data,updated_ts)
      SELECT json_extract(value,'$[0]'),json_extract(value,'$[1]'),json_extract(value,'$[2]'),json_extract(value,'$[3]'),json_extract(value,'$[4]'),json_extract(value,'$[5]'),json_extract(value,'$[6]'),json_extract(value,'$[7]'),json_extract(value,'$[8]') FROM json_each(?) WHERE true
      ON CONFLICT(product_key) DO UPDATE SET branch_key=excluded.branch_key,code_key=excluded.code_key,name=excluded.name,search_text=excluded.search_text,source_mask=excluded.source_mask,conflict_count=excluded.conflict_count,data=excluded.data,updated_ts=excluded.updated_ts`, payload));
    for (const payload of indexBatches(changedRecords)) ops.push(stmt(C, `INSERT INTO product_catalog_records(product_key,source_key,system,data,search_text)
      SELECT json_extract(value,'$[0]'),json_extract(value,'$[1]'),json_extract(value,'$[2]'),json_extract(value,'$[3]'),json_extract(value,'$[4]') FROM json_each(?) WHERE true
      ON CONFLICT(product_key,source_key) DO UPDATE SET system=excluded.system,data=excluded.data,search_text=excluded.search_text`, payload));
    try { await C.env.DB.batch(ops); }
    catch (error) {
      if (/product_catalog_revision_conflict/.test(String(error))) return null;
      throw error;
    }
    return { ...before, synced_revision: before.source_revision, synced_ts: ts, branches_json: JSON.stringify(collected.branches) };
  }

  async function sync(C) {
    const db = C.env.DB;
    // Waiting callers recheck the durable revision after the shared build: a
    // source save may have committed while an older caller was still rebuilding.
    for (let attempt = 0; attempt < 8; attempt++) {
      let work = pending.get(db);
      if (!work) {
        const current = await meta(C);
        if (current.source_revision === current.synced_revision) return current;
        work = pending.get(db);
        if (!work) { work = rebuild(C); pending.set(db, work); }
      }
      try { await work; } finally { if (pending.get(db) === work) pending.delete(db); }
      const current = await meta(C);
      if (current.source_revision === current.synced_revision) return current;
    }
    throw new Error('ข้อมูลสินค้ากำลังเปลี่ยนแปลง กรุณาลองใหม่');
  }

  const pageOptions = options => {
    options = options && typeof options === 'object' && !Array.isArray(options) ? options : {};
    return { ...options, limit: Math.min(100, Math.max(1, Math.floor(Number(options.limit) || 30))), cursor: text(options.cursor).slice(0, 3000) };
  };
  const decodeRow = row => ({ ...JSON.parse(row.data), updatedAt: row.updated_ts });
  const first = result => result.results && result.results[0];
  async function authorized(C, token) { await authPerm(C, token, 'product_catalog'); await sync(C); }
  async function readSnapshot(C, statements) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const results = await C.env.DB.batch(statements), state = first(results[0]);
      if (state.source_revision === state.synced_revision) return results;
      await sync(C);
    }
    throw new Error('ข้อมูลสินค้ากำลังเปลี่ยนแปลง กรุณาลองใหม่');
  }

  API.productCatalogSummary = async (C, token) => {
    await authorized(C, token);
    const results = await readSnapshot(C, [
      stmt(C, 'SELECT * FROM product_catalog_state WHERE id=1'),
      stmt(C, 'SELECT COUNT(*) AS total,SUM(CASE WHEN conflict_count>0 THEN 1 ELSE 0 END) AS conflicts FROM product_catalog'),
      stmt(C, 'SELECT branch_key,COUNT(*) AS total,SUM(CASE WHEN conflict_count>0 THEN 1 ELSE 0 END) AS conflicts FROM product_catalog GROUP BY branch_key'),
      stmt(C, 'SELECT source_mask,COUNT(*) AS n FROM product_catalog GROUP BY source_mask')
    ]);
    const state = first(results[0]), totals = first(results[1]), byBranch = new Map((results[2].results || []).map(row => [row.branch_key, row]));
    return {
      total: totals.total, conflictCount: totals.conflicts || 0,
      branches: JSON.parse(state.branches_json).map(branch => ({ ...branch, total: byBranch.get(branch.branchCode)?.total || 0, conflictCount: byBranch.get(branch.branchCode)?.conflicts || 0 })),
      sources: Object.keys(SOURCE_LABELS).map(id => ({ id, label: SOURCE_LABELS[id], count: (results[3].results || []).reduce((count, row) => count + (row.source_mask & sourceBit(id) ? row.n : 0), 0) })),
      ...resultMeta(state)
    };
  };

  API.productCatalogList = async (C, token, options) => {
    await authorized(C, token); options = pageOptions(options);
    const where = [], parameters = [];
    if (text(options.branchCode)) { where.push('branch_key=?'); parameters.push(text(options.branchCode)); }
    const search = text(options.search).slice(0, 200).toLowerCase();
    if (search) {
      // Normalized code search uses precisely the stock normalization; regular
      // text search stays literal, including %, _, quotes, and escape characters.
      where.push('(instr(search_text,?)>0 OR instr(code_key,?)>0 OR EXISTS(SELECT 1 FROM product_catalog_records r WHERE r.product_key=product_catalog.product_key AND instr(r.search_text,?)>0))'); parameters.push(search, codeKey(search), search);
    }
    if (options.source) {
      if (!sourceBit(options.source)) throw new Error('ระบบต้นทางไม่ถูกต้อง');
      where.push('(source_mask & ?)>0'); parameters.push(sourceBit(options.source));
    }
    if (options.conflictsOnly === true) where.push('conflict_count>0');
    const filter = where.length ? ' WHERE ' + where.join(' AND ') : '';
    const pageFilter = filter + (filter ? ' AND ' : ' WHERE ') + 'product_key>?';
    const results = await readSnapshot(C, [
      stmt(C, 'SELECT * FROM product_catalog_state WHERE id=1'),
      stmt(C, 'SELECT COUNT(*) AS total FROM product_catalog' + filter, ...parameters),
      stmt(C, 'SELECT data,updated_ts,product_key FROM product_catalog' + pageFilter + ' ORDER BY product_key LIMIT ?', ...parameters, options.cursor, options.limit + 1)
    ]);
    const rows = results[2].results || [], hasMore = rows.length > options.limit;
    if (hasMore) rows.pop();
    return { rows: rows.map(decodeRow), total: first(results[1]).total, nextCursor: hasMore ? rows[rows.length - 1].product_key : null, ...resultMeta(first(results[0])) };
  };

  API.productCatalogDetail = async (C, token, options) => {
    await authorized(C, token); options = pageOptions(options);
    const key = text(options.productKey).slice(0, 3000);
    const results = await readSnapshot(C, [
      stmt(C, 'SELECT * FROM product_catalog_state WHERE id=1'),
      stmt(C, 'SELECT data,updated_ts FROM product_catalog WHERE product_key=?', key),
      stmt(C, 'SELECT COUNT(*) AS total FROM product_catalog_records WHERE product_key=?', key),
      stmt(C, 'SELECT source_key,data FROM product_catalog_records WHERE product_key=? AND source_key>? ORDER BY source_key LIMIT ?', key, options.cursor, options.limit + 1)
    ]);
    const product = first(results[1]);
    if (!product) throw new Error('ไม่พบสินค้า กรุณาโหลดข้อมูลล่าสุด');
    const records = results[3].results || [], hasMore = records.length > options.limit;
    if (hasMore) records.pop();
    return { ...decodeRow(product), records: records.map(row => ({ ...JSON.parse(row.data), sourceKey: row.source_key })), recordsTotal: first(results[2]).total, nextCursor: hasMore ? records[records.length - 1].source_key : null, ...resultMeta(first(results[0])) };
  };

  return { sync };
}
