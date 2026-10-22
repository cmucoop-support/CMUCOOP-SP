-- Durable product directory and source invalidation.
CREATE TABLE IF NOT EXISTS product_catalog_state (
    id INTEGER PRIMARY KEY CHECK(id=1), source_revision INTEGER NOT NULL DEFAULT 0, batching INTEGER NOT NULL DEFAULT 0 CHECK(batching IN (0,1)),
    synced_revision INTEGER NOT NULL DEFAULT -1 CONSTRAINT product_catalog_revision_conflict CHECK(synced_revision>=-1),
    synced_ts INTEGER NOT NULL DEFAULT 0, branches_json TEXT NOT NULL DEFAULT '[]'
  );
INSERT OR IGNORE INTO product_catalog_state(id) VALUES(1);
CREATE TABLE IF NOT EXISTS product_catalog (
    product_key TEXT PRIMARY KEY, branch_key TEXT NOT NULL, code_key TEXT NOT NULL,
    name TEXT NOT NULL, search_text TEXT NOT NULL, source_mask INTEGER NOT NULL,
    conflict_count INTEGER NOT NULL, data TEXT NOT NULL, updated_ts INTEGER NOT NULL
  );
CREATE INDEX IF NOT EXISTS product_catalog_branch ON product_catalog(branch_key,product_key);
CREATE INDEX IF NOT EXISTS product_catalog_code ON product_catalog(code_key,product_key);
CREATE TABLE IF NOT EXISTS product_catalog_records (
    product_key TEXT NOT NULL, source_key TEXT NOT NULL, system TEXT NOT NULL, data TEXT NOT NULL, search_text TEXT NOT NULL,
    PRIMARY KEY(product_key,source_key)
  );
CREATE INDEX IF NOT EXISTS product_catalog_record_system ON product_catalog_records(system,product_key);
CREATE TRIGGER IF NOT EXISTS catalog_dirty_barcode_items_insert AFTER INSERT ON barcode_items WHEN (SELECT batching FROM product_catalog_state WHERE id=1)=0 BEGIN UPDATE product_catalog_state SET source_revision=source_revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS catalog_dirty_barcode_items_update AFTER UPDATE ON barcode_items WHEN (SELECT batching FROM product_catalog_state WHERE id=1)=0 BEGIN UPDATE product_catalog_state SET source_revision=source_revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS catalog_dirty_barcode_items_delete AFTER DELETE ON barcode_items WHEN (SELECT batching FROM product_catalog_state WHERE id=1)=0 BEGIN UPDATE product_catalog_state SET source_revision=source_revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS catalog_dirty_stock_data_insert AFTER INSERT ON stock_data WHEN (SELECT batching FROM product_catalog_state WHERE id=1)=0 BEGIN UPDATE product_catalog_state SET source_revision=source_revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS catalog_dirty_stock_data_update AFTER UPDATE ON stock_data WHEN (SELECT batching FROM product_catalog_state WHERE id=1)=0 BEGIN UPDATE product_catalog_state SET source_revision=source_revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS catalog_dirty_stock_data_delete AFTER DELETE ON stock_data WHEN (SELECT batching FROM product_catalog_state WHERE id=1)=0 BEGIN UPDATE product_catalog_state SET source_revision=source_revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS catalog_dirty_market_data_insert AFTER INSERT ON market_data WHEN (SELECT batching FROM product_catalog_state WHERE id=1)=0 BEGIN UPDATE product_catalog_state SET source_revision=source_revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS catalog_dirty_market_data_update AFTER UPDATE ON market_data WHEN (SELECT batching FROM product_catalog_state WHERE id=1)=0 BEGIN UPDATE product_catalog_state SET source_revision=source_revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS catalog_dirty_market_data_delete AFTER DELETE ON market_data WHEN (SELECT batching FROM product_catalog_state WHERE id=1)=0 BEGIN UPDATE product_catalog_state SET source_revision=source_revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS catalog_dirty_expiry_lots_insert AFTER INSERT ON expiry_lots WHEN (SELECT batching FROM product_catalog_state WHERE id=1)=0 BEGIN UPDATE product_catalog_state SET source_revision=source_revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS catalog_dirty_expiry_lots_update AFTER UPDATE ON expiry_lots WHEN (SELECT batching FROM product_catalog_state WHERE id=1)=0 BEGIN UPDATE product_catalog_state SET source_revision=source_revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS catalog_dirty_expiry_lots_delete AFTER DELETE ON expiry_lots WHEN (SELECT batching FROM product_catalog_state WHERE id=1)=0 BEGIN UPDATE product_catalog_state SET source_revision=source_revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS catalog_dirty_stock_grp_insert AFTER INSERT ON stock_grp WHEN (SELECT batching FROM product_catalog_state WHERE id=1)=0 AND (NEW.ver=0) BEGIN UPDATE product_catalog_state SET source_revision=source_revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS catalog_dirty_stock_grp_delete AFTER DELETE ON stock_grp WHEN (SELECT batching FROM product_catalog_state WHERE id=1)=0 AND (OLD.ver=0) BEGIN UPDATE product_catalog_state SET source_revision=source_revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS catalog_dirty_stock_grp_update AFTER UPDATE ON stock_grp WHEN (SELECT batching FROM product_catalog_state WHERE id=1)=0 AND (OLD.ver=0 OR NEW.ver=0) BEGIN UPDATE product_catalog_state SET source_revision=source_revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS catalog_dirty_kv_insert AFTER INSERT ON kv WHEN (SELECT batching FROM product_catalog_state WHERE id=1)=0 AND ((NEW.k='MARKET_STATE' OR NEW.k GLOB 'STOCK_*')) BEGIN UPDATE product_catalog_state SET source_revision=source_revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS catalog_dirty_kv_delete AFTER DELETE ON kv WHEN (SELECT batching FROM product_catalog_state WHERE id=1)=0 AND ((OLD.k='MARKET_STATE' OR OLD.k GLOB 'STOCK_*')) BEGIN UPDATE product_catalog_state SET source_revision=source_revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS catalog_dirty_kv_update AFTER UPDATE ON kv WHEN (SELECT batching FROM product_catalog_state WHERE id=1)=0 AND ((OLD.k='MARKET_STATE' OR OLD.k GLOB 'STOCK_*') OR (NEW.k='MARKET_STATE' OR NEW.k GLOB 'STOCK_*')) BEGIN UPDATE product_catalog_state SET source_revision=source_revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS catalog_dirty_kv_chunks_insert AFTER INSERT ON kv_chunks WHEN (SELECT batching FROM product_catalog_state WHERE id=1)=0 AND ((NEW.k='MARKET_STATE' OR NEW.k GLOB 'STOCK_*')) BEGIN UPDATE product_catalog_state SET source_revision=source_revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS catalog_dirty_kv_chunks_delete AFTER DELETE ON kv_chunks WHEN (SELECT batching FROM product_catalog_state WHERE id=1)=0 AND ((OLD.k='MARKET_STATE' OR OLD.k GLOB 'STOCK_*')) BEGIN UPDATE product_catalog_state SET source_revision=source_revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS catalog_dirty_kv_chunks_update AFTER UPDATE ON kv_chunks WHEN (SELECT batching FROM product_catalog_state WHERE id=1)=0 AND ((OLD.k='MARKET_STATE' OR OLD.k GLOB 'STOCK_*') OR (NEW.k='MARKET_STATE' OR NEW.k GLOB 'STOCK_*')) BEGIN UPDATE product_catalog_state SET source_revision=source_revision+1 WHERE id=1; END;
INSERT INTO kv(k,v) VALUES('SCHEMA_VERSION','product-catalog-1') ON CONFLICT(k) DO UPDATE SET v=excluded.v;
