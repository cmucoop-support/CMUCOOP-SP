import { PRODUCT_SCHEMA } from '../modules/catalog.js';

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

const SCHEMA_VERSION = 'product-catalog-1';

SCHEMA.push(
  'CREATE TABLE IF NOT EXISTS write_revisions (scope TEXT PRIMARY KEY, revision INTEGER NOT NULL CONSTRAINT revision_conflict CHECK(revision>=0))',
  'CREATE TABLE IF NOT EXISTS kv_chunks (k TEXT, n INTEGER, data TEXT, PRIMARY KEY(k,n))',
  'CREATE TABLE IF NOT EXISTS barcode_backup_items (backup_id INTEGER, pos INTEGER, partner TEXT, cat TEXT, name TEXT, packBar TEXT, unitBar TEXT, perPack TEXT)',
  'CREATE INDEX IF NOT EXISTS bbi_backup ON barcode_backup_items(backup_id,pos)',
  'CREATE TABLE IF NOT EXISTS barcode_backup_cats (backup_id INTEGER, cat TEXT, PRIMARY KEY(backup_id,cat))',
  'CREATE INDEX IF NOT EXISTS bc_pos ON barcode_items(pos)',
  'CREATE INDEX IF NOT EXISTS bc_name ON barcode_items(cat,name)',
  'CREATE INDEX IF NOT EXISTS bc_pack ON barcode_items(packBar)',
  'CREATE INDEX IF NOT EXISTS bc_unit ON barcode_items(unitBar)',
  'CREATE INDEX IF NOT EXISTS bc_stage_ts ON barcode_stage(ts)',
  'CREATE INDEX IF NOT EXISTS sg_ver ON stock_grp(ver,g,n)',
  'CREATE INDEX IF NOT EXISTS log_sheet_id ON log(sheet,id DESC)',
  'CREATE INDEX IF NOT EXISTS sessions_exp ON sessions(exp)',
  'CREATE INDEX IF NOT EXISTS sessions_user ON sessions(username)',
  'CREATE INDEX IF NOT EXISTS fails_until ON fails(until)',
  'CREATE INDEX IF NOT EXISTS mq_user ON music_queue(uname,status)',
  'CREATE INDEX IF NOT EXISTS mq_ref ON music_queue(ref,status)',
  "CREATE TRIGGER IF NOT EXISTS keep_admin_delete BEFORE DELETE ON users WHEN OLD.role='admin' AND (SELECT COUNT(*) FROM users WHERE role='admin')<=1 BEGIN SELECT RAISE(ABORT,'ต้องมี Admin อย่างน้อย 1 คน'); END",
  "CREATE TRIGGER IF NOT EXISTS keep_admin_update BEFORE UPDATE OF role ON users WHEN OLD.role='admin' AND NEW.role<>'admin' AND (SELECT COUNT(*) FROM users WHERE role='admin')<=1 BEGIN SELECT RAISE(ABORT,'ต้องมี Admin อย่างน้อย 1 คน'); END"
);

const EXPIRY_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS expiry_lots (
    id INTEGER PRIMARY KEY AUTOINCREMENT, request_id TEXT NOT NULL UNIQUE, create_hash TEXT NOT NULL,
    barcode TEXT NOT NULL, name TEXT NOT NULL, branch TEXT NOT NULL, location TEXT NOT NULL,
    expires TEXT NOT NULL, quantity REAL CHECK(quantity IS NULL OR (quantity>=0 AND quantity<=1000000000)), unit TEXT NOT NULL,
    note TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','acknowledged','closed')),
    version INTEGER NOT NULL DEFAULT 1 CONSTRAINT expiry_revision_conflict CHECK(version>0),
    created_ts INTEGER NOT NULL, created_user TEXT NOT NULL, created_by TEXT NOT NULL,
    updated_ts INTEGER NOT NULL, updated_by TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS expiry_status_date ON expiry_lots(status,expires,id)',
  'CREATE INDEX IF NOT EXISTS expiry_branch_date ON expiry_lots(branch,status,expires,id)',
  'CREATE INDEX IF NOT EXISTS expiry_barcode ON expiry_lots(barcode)',
  'CREATE TABLE IF NOT EXISTS expiry_events (lot_id INTEGER NOT NULL, version INTEGER NOT NULL, ts INTEGER NOT NULL, who TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL, PRIMARY KEY(lot_id,version))'
];

SCHEMA.push(...EXPIRY_SCHEMA);

const EXPIRY_PRODUCT_SCHEMA = [
  'CREATE TABLE IF NOT EXISTS expiry_products (code_key TEXT NOT NULL,branch TEXT NOT NULL,code TEXT NOT NULL,name TEXT NOT NULL,group_code TEXT NOT NULL,PRIMARY KEY(code_key,branch,group_code,name))',
  'CREATE INDEX IF NOT EXISTS expiry_products_branch ON expiry_products(branch,code_key)'
];

SCHEMA.push(...EXPIRY_PRODUCT_SCHEMA);
SCHEMA.push(...PRODUCT_SCHEMA);

const schemaPromises = new WeakMap();

async function ensureSchema(db) {
  let ready = schemaPromises.get(db);
  const first = !ready;
  if (!ready) {
    ready = (async () => {
      try {
        const version = await db.prepare('SELECT v FROM kv WHERE k=?').bind('SCHEMA_VERSION').first();
        if (version && version.v === SCHEMA_VERSION) {
          const cols = (await db.prepare('PRAGMA table_info(barcode_items)').all()).results || [];
          if (cols.some(c => c.name === 'perPack')) return false;
        }
      } catch (e) { if (!/no such table/i.test(String(e))) throw e; }
      // Install with the migration command before production traffic. This is a
      // compatibility fallback for existing deployments, shared within an isolate.
      await db.batch(SCHEMA.map(sql => db.prepare(sql)));
      const cols = (await db.prepare('PRAGMA table_info(barcode_items)').all()).results || [];
      if (!cols.some(c => c.name === 'perPack')) {
        try { await db.prepare('ALTER TABLE barcode_items ADD COLUMN perPack TEXT').run(); }
        catch (e) {
          const after = (await db.prepare('PRAGMA table_info(barcode_items)').all()).results || [];
          if (!after.some(c => c.name === 'perPack')) throw e;
        }
      }
      await db.prepare('INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').bind('SCHEMA_VERSION', SCHEMA_VERSION).run();
      return true;
    })();
    schemaPromises.set(db, ready);
    ready.catch(() => schemaPromises.delete(db));
  }
  return (await ready) && first;
}

export { SCHEMA, SCHEMA_VERSION, EXPIRY_SCHEMA, EXPIRY_PRODUCT_SCHEMA, schemaPromises, ensureSchema };
