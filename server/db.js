import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config();

const dbPath = resolve(process.env.DATABASE_PATH || './data/sensebook.db');
mkdirSync(dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS entries (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      word TEXT NOT NULL,
      sentence TEXT NOT NULL,
      ai_sentence_gloss TEXT,
      ai_word_sense TEXT,
      source_url TEXT,
      tags TEXT,
      status TEXT NOT NULL DEFAULT 'pending_ai',
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_entries_user ON entries(user_id);
    CREATE INDEX IF NOT EXISTS idx_entries_created ON entries(created_at DESC);
  `);
}

initDb();

export function createUser(email, passwordHash) {
  const id = randomUUID();
  const created_at = new Date().toISOString();
  db.prepare(
    'INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)'
  ).run(id, email, passwordHash, created_at);
  return { id, email, created_at };
}

export function findUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
}

export function findUserById(id) {
  return db.prepare('SELECT id, email, created_at FROM users WHERE id = ?').get(id);
}

export function createEntry(userId, data) {
  const id = randomUUID();
  const created_at = new Date().toISOString();
  const tags = data.tags ? JSON.stringify(data.tags) : null;
  db.prepare(
    `INSERT INTO entries
      (id, user_id, word, sentence, ai_sentence_gloss, ai_word_sense, source_url, tags, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    userId,
    data.word,
    data.sentence,
    data.ai_sentence_gloss ?? null,
    data.ai_word_sense ?? null,
    data.source_url ?? null,
    tags,
    data.status ?? 'pending_ai',
    created_at
  );
  return getEntry(id, userId);
}

export function getEntry(id, userId) {
  const row = db
    .prepare('SELECT * FROM entries WHERE id = ? AND user_id = ?')
    .get(id, userId);
  return row ? mapEntry(row) : null;
}

export function listEntries(userId, { limit = 50, offset = 0 } = {}) {
  const rows = db
    .prepare(
      'SELECT * FROM entries WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
    )
    .all(userId, limit, offset);
  return rows.map(mapEntry);
}

export function updateEntry(id, userId, patch) {
  const current = getEntry(id, userId);
  if (!current) return null;

  const next = {
    word: patch.word ?? current.word,
    sentence: patch.sentence ?? current.sentence,
    ai_sentence_gloss:
      patch.ai_sentence_gloss !== undefined
        ? patch.ai_sentence_gloss
        : current.ai_sentence_gloss,
    ai_word_sense:
      patch.ai_word_sense !== undefined
        ? patch.ai_word_sense
        : current.ai_word_sense,
    source_url:
      patch.source_url !== undefined ? patch.source_url : current.source_url,
    tags: patch.tags !== undefined ? patch.tags : current.tags,
    status: patch.status ?? current.status,
  };

  db.prepare(
    `UPDATE entries SET
      word = ?, sentence = ?, ai_sentence_gloss = ?, ai_word_sense = ?,
      source_url = ?, tags = ?, status = ?
     WHERE id = ? AND user_id = ?`
  ).run(
    next.word,
    next.sentence,
    next.ai_sentence_gloss,
    next.ai_word_sense,
    next.source_url,
    next.tags ? JSON.stringify(next.tags) : null,
    next.status,
    id,
    userId
  );

  return getEntry(id, userId);
}

export function deleteEntry(id, userId) {
  const info = db
    .prepare('DELETE FROM entries WHERE id = ? AND user_id = ?')
    .run(id, userId);
  return info.changes > 0;
}

function mapEntry(row) {
  return {
    id: row.id,
    user_id: row.user_id,
    word: row.word,
    sentence: row.sentence,
    ai_sentence_gloss: row.ai_sentence_gloss,
    ai_word_sense: row.ai_word_sense,
    source_url: row.source_url,
    tags: row.tags ? JSON.parse(row.tags) : [],
    status: row.status,
    created_at: row.created_at,
  };
}

if (process.argv.includes('--init')) {
  console.log(`Database ready at ${dbPath}`);
}

export default db;
