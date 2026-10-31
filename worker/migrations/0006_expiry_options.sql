CREATE TABLE IF NOT EXISTS expiry_groups (group_id INTEGER PRIMARY KEY,lot_no INTEGER NOT NULL UNIQUE CHECK(lot_no>0));
INSERT OR IGNORE INTO expiry_groups(group_id,lot_no)
    SELECT DISTINCT group_id,group_id FROM expiry_records WHERE group_id NOT IN (SELECT group_id FROM expiry_groups);
CREATE TABLE IF NOT EXISTS expiry_locations (branch TEXT NOT NULL,name TEXT NOT NULL,created_ts INTEGER NOT NULL,created_by TEXT NOT NULL,PRIMARY KEY(branch,name));
DROP VIEW IF EXISTS expiry_records;
CREATE VIEW expiry_records AS SELECT l.*,COALESCE(i.group_id,l.id) AS group_id,
    COALESCE(i.item_no,1) AS item_no,COALESCE(i.deleted,0) AS deleted,
    COALESCE(g.lot_no,COALESCE(i.group_id,l.id)) AS group_no
    FROM expiry_lots l LEFT JOIN expiry_item_links i ON i.lot_id=l.id
    LEFT JOIN expiry_groups g ON g.group_id=COALESCE(i.group_id,l.id);
INSERT INTO kv(k,v) VALUES('SCHEMA_VERSION','expiry-options-2') ON CONFLICT(k) DO UPDATE SET v=excluded.v;
