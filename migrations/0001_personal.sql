CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE devices (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL,
 token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, last_seen_at TEXT, revoked_at TEXT
);
CREATE TABLE query_events (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id),
 device_id TEXT NOT NULL REFERENCES devices(id), installation_id TEXT NOT NULL,
 selected_text TEXT NOT NULL, context TEXT NOT NULL DEFAULT '', explanation TEXT NOT NULL DEFAULT '',
 source_url TEXT NOT NULL DEFAULT '', source_title TEXT NOT NULL DEFAULT '', source_app TEXT NOT NULL DEFAULT '',
 platform TEXT NOT NULL, mode TEXT NOT NULL, status TEXT NOT NULL, from_cache INTEGER NOT NULL DEFAULT 0,
 occurred_at TEXT NOT NULL, timezone TEXT NOT NULL, origin TEXT NOT NULL DEFAULT 'query',
 starred INTEGER NOT NULL DEFAULT 0, deleted_at TEXT, updated_at TEXT NOT NULL,
 UNIQUE(user_id,id)
);
CREATE INDEX events_period ON query_events(user_id, occurred_at DESC, seq DESC);
CREATE INDEX events_device ON query_events(user_id, device_id, seq);
CREATE TABLE reviews (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL,
 period_start TEXT NOT NULL, period_end TEXT NOT NULL, timezone TEXT NOT NULL,
 content TEXT NOT NULL, fingerprint TEXT NOT NULL, model TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE review_sources (review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE, event_id TEXT NOT NULL, PRIMARY KEY(review_id,event_id));
CREATE INDEX reviews_owner ON reviews(user_id,period_start);
