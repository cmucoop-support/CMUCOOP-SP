CREATE TABLE IF NOT EXISTS expiry_item_links (
    lot_id INTEGER PRIMARY KEY, group_id INTEGER NOT NULL, item_no INTEGER NOT NULL CHECK(item_no>0),
    deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1)), UNIQUE(group_id,item_no)
  );
CREATE VIEW IF NOT EXISTS expiry_records AS SELECT l.*, COALESCE(i.group_id,l.id) AS group_id,
    COALESCE(i.item_no,1) AS item_no, COALESCE(i.deleted,0) AS deleted
    FROM expiry_lots l LEFT JOIN expiry_item_links i ON i.lot_id=l.id;
INSERT INTO kv(k,v) VALUES('SCHEMA_VERSION','expiry-items-1') ON CONFLICT(k) DO UPDATE SET v=excluded.v;
