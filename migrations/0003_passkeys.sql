CREATE TABLE passkeys (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), public_key TEXT NOT NULL,
 counter INTEGER NOT NULL DEFAULT 0, transports TEXT NOT NULL, name TEXT NOT NULL,
 created_at INTEGER NOT NULL, last_used_at INTEGER, revoked_at INTEGER
);
CREATE INDEX passkeys_owner ON passkeys(user_id);
CREATE TABLE web_sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
 credential_id TEXT REFERENCES passkeys(id), auth_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX web_sessions_expiry ON web_sessions(expires_at);
CREATE TABLE webauthn_challenges (
 token_hash TEXT PRIMARY KEY, challenge TEXT NOT NULL, kind TEXT NOT NULL,
 user_id TEXT, expires_at INTEGER NOT NULL
);
CREATE INDEX webauthn_challenges_expiry ON webauthn_challenges(expires_at);
CREATE TABLE auth_limits (id TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
