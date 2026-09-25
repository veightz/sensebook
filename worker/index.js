import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { SignJWT, jwtVerify } from 'jose';

const app = new Hono();
app.use('*', cors({ origin: '*', allowHeaders: ['Authorization', 'Content-Type'], allowMethods: ['GET', 'PUT', 'POST', 'OPTIONS'] }));

const textEncoder = new TextEncoder();
const ENTRY_FIELDS = [
  'word', 'sentence', 'translation', 'ai_word_sense', 'ai_sentence_gloss', 'source_url', 'source_app',
  'tags', 'status', 'created_at', 'updated_at', 'deleted_at', 'review_due_at',
  'review_interval_days', 'review_repetitions', 'review_last_at',
];

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function secret(env) {
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) throw fail('服务尚未配置密钥', 503);
  return textEncoder.encode(env.JWT_SECRET);
}

function hex(bytes) {
  return [...bytes].map((n) => n.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(password, saltHex) {
  const key = await crypto.subtle.importKey('raw', textEncoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const salt = Uint8Array.from(saltHex.match(/../g).map((part) => parseInt(part, 16)));
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256);
  return hex(new Uint8Array(bits));
}

function equalHex(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function limitKey(c, email) {
  const ip = c.req.header('CF-Connecting-IP') || 'local';
  const value = textEncoder.encode(email + '|' + ip);
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', value)));
}

async function checkLoginLimit(c, key) {
  const row = await c.env.DB.prepare('SELECT attempts, reset_at FROM auth_limits WHERE key = ?').bind(key).first();
  if (row && row.reset_at > Math.floor(Date.now() / 1000) && row.attempts >= 10) {
    throw fail('尝试过多，请稍后再试', 429);
  }
}

async function recordLoginFailure(c, key) {
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare(`INSERT INTO auth_limits (key, attempts, reset_at) VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET
      attempts = CASE WHEN reset_at <= ? THEN 1 ELSE attempts + 1 END,
      reset_at = CASE WHEN reset_at <= ? THEN ? ELSE reset_at END`)
    .bind(key, now + 900, now, now, now + 900).run();
}

async function signToken(env, user) {
  return new SignJWT({ email: user.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(secret(env));
}

async function auth(c) {
  const header = c.req.header('Authorization') || '';
  if (!header.startsWith('Bearer ')) throw fail('未登录', 401);
  let payload;
  try {
    ({ payload } = await jwtVerify(header.slice(7), secret(c.env)));
  } catch {
    throw fail('登录已失效', 401);
  }
  if (!payload.sub) throw fail('登录已失效', 401);
  const user = await c.env.DB.prepare('SELECT id, email FROM users WHERE id = ?').bind(payload.sub).first();
  if (!user) throw fail('用户不存在', 401);
  return user;
}

function normalizedEntry(raw, id) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw fail('词条格式错误');
  const word = String(raw.word || '').trim();
  const sentence = String(raw.sentence || word).trim();
  if (!word || word.length > 200 || !sentence || sentence.length > 4000) throw fail('词条或句子长度无效');
  const tags = Array.isArray(raw.tags) ? raw.tags.filter((tag) => typeof tag === 'string').map((tag) => tag.trim().slice(0, 40)).filter(Boolean).slice(0, 20) : [];
  const timestamp = new Date().toISOString();
  const createdAt = Number.isFinite(Date.parse(raw.created_at)) ? new Date(raw.created_at).toISOString() : timestamp;
  const optional = (name, max = 4000) => raw[name] == null ? null : String(raw[name]).slice(0, max);
  const iso = (name) => raw[name] && Number.isFinite(Date.parse(raw[name])) ? new Date(raw[name]).toISOString() : null;
  return {
    id, word, sentence, translation: optional('translation'), ai_word_sense: optional('ai_word_sense'),
    ai_sentence_gloss: optional('ai_sentence_gloss'), source_url: optional('source_url', 2000),
    source_app: optional('source_app', 200), tags: JSON.stringify(tags),
    status: ['pending_ai', 'ready', 'failed'].includes(raw.status) ? raw.status : 'pending_ai',
    created_at: createdAt, updated_at: timestamp, deleted_at: iso('deleted_at'),
    review_due_at: iso('review_due_at'),
    review_interval_days: Math.max(0, Math.min(3650, Math.trunc(Number(raw.review_interval_days) || 0))),
    review_repetitions: Math.max(0, Math.min(10000, Math.trunc(Number(raw.review_repetitions) || 0))),
    review_last_at: iso('review_last_at'),
  };
}

function mapEntry(row) {
  if (!row) return null;
  return { ...row, tags: JSON.parse(row.tags || '[]') };
}

app.onError((error, c) => {
  const status = Number(error.status) || 500;
  if (status === 500) console.error(JSON.stringify({ event: 'request_error', path: c.req.path, message: error.message }));
  return c.json({ error: status === 500 ? '服务器错误' : error.message }, status);
});

app.get('/health', (c) => c.json({ ok: true, service: 'sensebook-sync' }));

app.post('/auth/register', async (c) => {
  const body = await c.req.json();
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254 || password.length < 8 || password.length > 128) throw fail('请输入有效邮箱和至少 8 位密码');
  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) throw fail('该邮箱已注册', 409);
  const user = { id: crypto.randomUUID(), email };
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  const passwordHash = await hashPassword(password, salt);
  await c.env.DB.prepare('INSERT INTO users (id, email, password_salt, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(user.id, email, salt, passwordHash, new Date().toISOString()).run();
  return c.json({ user, token: await signToken(c.env, user) }, 201);
});

app.post('/auth/login', async (c) => {
  const body = await c.req.json();
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const key = await limitKey(c, email);
  await checkLoginLimit(c, key);
  const row = await c.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  const calculated = await hashPassword(password, row?.password_salt || '00000000000000000000000000000000');
  if (!row || !equalHex(calculated, row.password_hash)) {
    await recordLoginFailure(c, key);
    throw fail('邮箱或密码错误', 401);
  }
  await c.env.DB.prepare('DELETE FROM auth_limits WHERE key = ?').bind(key).run();
  const user = { id: row.id, email: row.email };
  return c.json({ user, token: await signToken(c.env, user) });
});

app.get('/auth/me', async (c) => c.json({ user: await auth(c) }));

app.get('/sync/changes', async (c) => {
  const user = await auth(c);
  const after = Math.max(0, Math.trunc(Number(c.req.query('after')) || 0));
  const limit = Math.max(1, Math.min(200, Math.trunc(Number(c.req.query('limit')) || 200)));
  const rows = await c.env.DB.prepare(`
    SELECT changes.seq, entries.* FROM sync_changes AS changes
    JOIN entries ON entries.user_id = changes.user_id AND entries.id = changes.entry_id
    WHERE changes.user_id = ? AND changes.seq > ? ORDER BY changes.seq ASC LIMIT ?
  `).bind(user.id, after, limit + 1).all();
  const page = rows.results.slice(0, limit);
  return c.json({ changes: page.map((row) => {
    const { seq, ...entry } = row;
    return { seq, entry: mapEntry(entry) };
  }),
    cursor: page.length ? page[page.length - 1].seq : after, has_more: rows.results.length > limit });
});

app.put('/sync/entries/:id', async (c) => {
  const user = await auth(c);
  const id = c.req.param('id');
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(id)) throw fail('词条 ID 无效');
  const body = await c.req.json();
  const entry = normalizedEntry(body.entry, id);
  const baseRevision = body.base_revision == null ? null : Math.trunc(Number(body.base_revision));
  if (baseRevision != null && (!Number.isSafeInteger(baseRevision) || baseRevision < 1)) throw fail('版本号无效');
  const current = await c.env.DB.prepare('SELECT * FROM entries WHERE user_id = ? AND id = ?').bind(user.id, id).first();
  if (!current) {
    if (baseRevision != null) return c.json({ error: '词条不存在，无法应用增量修改' }, 409);
    try {
      await c.env.DB.prepare(`INSERT INTO entries (user_id, id, ${ENTRY_FIELDS.join(', ')}, revision)
        VALUES (${Array(ENTRY_FIELDS.length + 3).fill('?').join(', ')})`)
        .bind(user.id, id, ...ENTRY_FIELDS.map((field) => entry[field]), 1).run();
    } catch (error) {
      const race = await c.env.DB.prepare('SELECT * FROM entries WHERE user_id = ? AND id = ?').bind(user.id, id).first();
      if (race) return c.json({ error: '版本冲突', entry: mapEntry(race) }, 409);
      throw error;
    }
  } else {
    if (baseRevision == null || baseRevision !== current.revision) return c.json({ error: '版本冲突', entry: mapEntry(current) }, 409);
    const result = await c.env.DB.prepare(`UPDATE entries SET ${ENTRY_FIELDS.filter((field) => field !== 'created_at').map((field) => `${field} = ?`).join(', ')}, revision = revision + 1
      WHERE user_id = ? AND id = ? AND revision = ?`)
      .bind(...ENTRY_FIELDS.filter((field) => field !== 'created_at').map((field) => entry[field]), user.id, id, baseRevision).run();
    if (!result.meta.changes) {
      const race = await c.env.DB.prepare('SELECT * FROM entries WHERE user_id = ? AND id = ?').bind(user.id, id).first();
      return c.json({ error: '版本冲突', entry: mapEntry(race) }, 409);
    }
  }
  const saved = await c.env.DB.prepare('SELECT * FROM entries WHERE user_id = ? AND id = ?').bind(user.id, id).first();
  return c.json({ entry: mapEntry(saved) });
});

export default app;
