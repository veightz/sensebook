import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

import {
  createEntry,
  deleteEntry,
  getEntry,
  listEntries,
  updateEntry,
} from './db.js';
import { login, register, verifyToken } from './auth.js';
import { enrichEntry, hasLlm, translateText } from './llm.js';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const app = new Hono();

app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  })
);

app.get('/health', (c) =>
  c.json({
    ok: true,
    service: 'Sensebook',
    llm: hasLlm(),
    time: new Date().toISOString(),
  })
);

app.post('/auth/register', async (c) => {
  try {
    const body = await c.req.json();
    const result = await register(body.email, body.password);
    return c.json(result, 201);
  } catch (e) {
    return c.json({ error: e.message }, e.status || 500);
  }
});

app.post('/auth/login', async (c) => {
  try {
    const body = await c.req.json();
    const result = await login(body.email, body.password);
    return c.json(result);
  } catch (e) {
    return c.json({ error: e.message }, e.status || 500);
  }
});

async function requireAuth(c) {
  const header = c.req.header('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    const err = new Error('未登录');
    err.status = 401;
    throw err;
  }
  return verifyToken(token);
}

app.get('/entries', async (c) => {
  try {
    const user = await requireAuth(c);
    const limit = Math.min(Number(c.req.query('limit') || 50), 200);
    const offset = Number(c.req.query('offset') || 0);
    return c.json({ entries: listEntries(user.id, { limit, offset }) });
  } catch (e) {
    return c.json({ error: e.message }, e.status || 500);
  }
});

app.get('/entries/:id', async (c) => {
  try {
    const user = await requireAuth(c);
    const entry = getEntry(c.req.param('id'), user.id);
    if (!entry) return c.json({ error: '未找到' }, 404);
    return c.json(entry);
  } catch (e) {
    return c.json({ error: e.message }, e.status || 500);
  }
});

app.post('/entries', async (c) => {
  try {
    const user = await requireAuth(c);
    const body = await c.req.json();
    if (!body.word || !body.sentence) {
      return c.json({ error: 'word 与 sentence 必填' }, 400);
    }
    const entry = createEntry(user.id, {
      word: String(body.word).trim(),
      sentence: String(body.sentence).trim(),
      source_url: body.source_url || null,
      tags: Array.isArray(body.tags) ? body.tags : undefined,
      ai_sentence_gloss: body.ai_sentence_gloss,
      ai_word_sense: body.ai_word_sense,
      status: body.status || 'pending_ai',
    });
    return c.json(entry, 201);
  } catch (e) {
    return c.json({ error: e.message }, e.status || 500);
  }
});

app.patch('/entries/:id', async (c) => {
  try {
    const user = await requireAuth(c);
    const body = await c.req.json();
    const entry = updateEntry(c.req.param('id'), user.id, body);
    if (!entry) return c.json({ error: '未找到' }, 404);
    return c.json(entry);
  } catch (e) {
    return c.json({ error: e.message }, e.status || 500);
  }
});

app.delete('/entries/:id', async (c) => {
  try {
    const user = await requireAuth(c);
    const ok = deleteEntry(c.req.param('id'), user.id);
    if (!ok) return c.json({ error: '未找到' }, 404);
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: e.message }, e.status || 500);
  }
});

app.post('/entries/:id/enrich', async (c) => {
  try {
    const user = await requireAuth(c);
    const id = c.req.param('id');
    const entry = getEntry(id, user.id);
    if (!entry) return c.json({ error: '未找到' }, 404);

    try {
      const result = await enrichEntry({
        word: entry.word,
        sentence: entry.sentence,
      });
      const updated = updateEntry(id, user.id, {
        ai_sentence_gloss: result.ai_sentence_gloss,
        ai_word_sense: result.ai_word_sense,
        status: 'ready',
      });
      return c.json({ entry: updated, stub: result.stub });
    } catch (llmErr) {
      updateEntry(id, user.id, { status: 'failed' });
      return c.json({ error: llmErr.message, status: 'failed' }, 502);
    }
  } catch (e) {
    return c.json({ error: e.message }, e.status || 500);
  }
});

app.post('/translate', async (c) => {
  try {
    const user = await requireAuth(c);
    void user;
    const body = await c.req.json();
    const text = (body.text || '').trim();
    if (!text) return c.json({ error: 'text 必填' }, 400);
    const result = await translateText(text, body.target || 'zh');
    return c.json(result);
  } catch (e) {
    return c.json({ error: e.message }, e.status || 500);
  }
});

// Minimal web UI
app.get('/', (c) => {
  const html = readFileSync(join(root, 'web', 'index.html'), 'utf8');
  return c.html(html);
});

app.use('/web/*', serveStatic({ root: './' }));

const port = Number(process.env.PORT || 8787);
console.log(`Sensebook listening on http://127.0.0.1:${port}`);
serve({ fetch: app.fetch, port });
