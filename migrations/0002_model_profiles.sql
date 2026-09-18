-- 账号配置与查询分开；主密钥仅放在 Worker Secret，不进入 D1。
CREATE TABLE model_profiles (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
 name TEXT NOT NULL, base_url TEXT NOT NULL, model TEXT NOT NULL,
 api_key_ciphertext TEXT NOT NULL, key_hint TEXT NOT NULL,
 thinking INTEGER NOT NULL DEFAULT 0, is_default INTEGER NOT NULL DEFAULT 0,
 updated_at TEXT NOT NULL
);
CREATE INDEX model_profiles_owner ON model_profiles(user_id);
CREATE UNIQUE INDEX model_profiles_default ON model_profiles(user_id) WHERE is_default=1;
