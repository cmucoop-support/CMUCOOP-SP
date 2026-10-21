-- Independent expiry lots. This migration does not modify stock data.
CREATE TABLE IF NOT EXISTS expiry_lots (
    id INTEGER PRIMARY KEY AUTOINCREMENT, request_id TEXT NOT NULL UNIQUE, create_hash TEXT NOT NULL,
    barcode TEXT NOT NULL, name TEXT NOT NULL, branch TEXT NOT NULL, location TEXT NOT NULL,
    expires TEXT NOT NULL, quantity REAL CHECK(quantity IS NULL OR (quantity>=0 AND quantity<=1000000000)), unit TEXT NOT NULL,
    note TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','acknowledged','closed')),
    version INTEGER NOT NULL DEFAULT 1 CONSTRAINT expiry_revision_conflict CHECK(version>0),
    created_ts INTEGER NOT NULL, created_user TEXT NOT NULL, created_by TEXT NOT NULL,
    updated_ts INTEGER NOT NULL, updated_by TEXT NOT NULL
  );
CREATE INDEX IF NOT EXISTS expiry_status_date ON expiry_lots(status,expires,id);
CREATE INDEX IF NOT EXISTS expiry_branch_date ON expiry_lots(branch,status,expires,id);
CREATE INDEX IF NOT EXISTS expiry_barcode ON expiry_lots(barcode);
CREATE TABLE IF NOT EXISTS expiry_events (lot_id INTEGER NOT NULL, version INTEGER NOT NULL, ts INTEGER NOT NULL, who TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL, PRIMARY KEY(lot_id,version));
INSERT INTO kv(k,v) VALUES('SCHEMA_VERSION','expiry-1') ON CONFLICT(k) DO UPDATE SET v=excluded.v;
