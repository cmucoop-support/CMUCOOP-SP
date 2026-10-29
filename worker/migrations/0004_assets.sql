CREATE TABLE IF NOT EXISTS asset_items (
    id TEXT PRIMARY KEY, seq INTEGER NOT NULL UNIQUE CHECK(seq>0),
    name TEXT NOT NULL, code TEXT NOT NULL, code_key TEXT UNIQUE,
    received TEXT NOT NULL, location TEXT NOT NULL, image_url TEXT NOT NULL, note TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('normal','irreparable','repair','reduced')),
    amounts TEXT NOT NULL,
    version INTEGER NOT NULL CHECK(version>0), request_id TEXT NOT NULL UNIQUE, create_hash TEXT NOT NULL,
    created_user TEXT NOT NULL, created_ts INTEGER NOT NULL, updated_by TEXT NOT NULL, updated_ts INTEGER NOT NULL
  );
CREATE INDEX IF NOT EXISTS asset_location ON asset_items(location,seq);
CREATE INDEX IF NOT EXISTS asset_status ON asset_items(status,seq);
CREATE TABLE IF NOT EXISTS asset_events (asset_id TEXT NOT NULL,version INTEGER NOT NULL,ts INTEGER NOT NULL,who TEXT NOT NULL,action TEXT NOT NULL,detail TEXT NOT NULL,request_id TEXT UNIQUE,PRIMARY KEY(asset_id,version));
INSERT INTO kv(k,v) VALUES('SCHEMA_VERSION','assets-1') ON CONFLICT(k) DO UPDATE SET v=excluded.v;
