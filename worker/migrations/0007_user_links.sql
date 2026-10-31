CREATE TABLE IF NOT EXISTS user_login_links (username TEXT PRIMARY KEY,login_key TEXT NOT NULL,link_hash TEXT NOT NULL,saved_ts INTEGER NOT NULL);
INSERT INTO kv(k,v) VALUES('SCHEMA_VERSION','user-links-1') ON CONFLICT(k) DO UPDATE SET v=excluded.v;
