-- Searchable projection of current stock product names/codes. No stock quantities/costs.
CREATE TABLE IF NOT EXISTS expiry_products (code_key TEXT NOT NULL,branch TEXT NOT NULL,code TEXT NOT NULL,name TEXT NOT NULL,group_code TEXT NOT NULL,PRIMARY KEY(code_key,branch,group_code,name));
CREATE INDEX IF NOT EXISTS expiry_products_branch ON expiry_products(branch,code_key);
INSERT INTO kv(k,v) VALUES('SCHEMA_VERSION','expiry-stock-2') ON CONFLICT(k) DO UPDATE SET v=excluded.v;
