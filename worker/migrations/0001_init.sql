CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entries (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  word TEXT NOT NULL,
  sentence TEXT NOT NULL,
  ai_word_sense TEXT,
  ai_sentence_gloss TEXT,
  source_url TEXT,
  source_app TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending_ai',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  review_due_at TEXT,
  review_interval_days INTEGER NOT NULL DEFAULT 0,
  review_repetitions INTEGER NOT NULL DEFAULT 0,
  review_last_at TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sync_changes (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_sync_changes_user_seq ON sync_changes(user_id, seq);
CREATE INDEX IF NOT EXISTS idx_entries_user_word ON entries(user_id, word);

CREATE TRIGGER IF NOT EXISTS entries_insert_change AFTER INSERT ON entries
BEGIN
  INSERT INTO sync_changes(user_id, entry_id) VALUES (NEW.user_id, NEW.id);
END;

CREATE TRIGGER IF NOT EXISTS entries_update_change AFTER UPDATE ON entries
BEGIN
  INSERT INTO sync_changes(user_id, entry_id) VALUES (NEW.user_id, NEW.id);
END;
