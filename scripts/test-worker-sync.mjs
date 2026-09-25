import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const base = process.env.SENSEBOOK_TEST_API || 'http://127.0.0.1:8788';

async function request(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, data: await response.json() };
}

const id = randomUUID();
const email = `sync-${id}@example.test`;
const password = `pass-${id}`;
const registration = await request('/auth/register', { method: 'POST', body: { email, password } });
assert.equal(registration.status, 201, JSON.stringify(registration.data));
const token = registration.data.token;
assert.ok(token);
assert.equal((await request('/auth/login', { method: 'POST', body: { email, password } })).status, 200);
assert.equal((await request('/sync/changes')).status, 401);
const other = await request('/auth/register', { method: 'POST',
  body: { email: `other-${id}@example.test`, password } });
assert.equal(other.status, 201);

const entry = { id, word: 'context', sentence: 'A word in context.', tags: ['reading'], status: 'ready' };
const inserted = await request(`/sync/entries/${id}`, { method: 'PUT', token, body: { entry, base_revision: null } });
assert.equal(inserted.status, 200, JSON.stringify(inserted.data));
assert.equal(inserted.data.entry.revision, 1);
const first = await request('/sync/changes?after=0&limit=1', { token });
assert.equal(first.status, 200);
assert.equal(first.data.changes.length, 1);
assert.equal(first.data.changes[0].entry.word, 'context');
assert.deepEqual(first.data.changes[0].entry.tags, ['reading']);
const otherChanges = await request('/sync/changes?after=0', { token: other.data.token });
assert.equal(otherChanges.status, 200);
assert.equal(otherChanges.data.changes.length, 0);

const changed = await request(`/sync/entries/${id}`, { method: 'PUT', token,
  body: { entry: { ...entry, ai_word_sense: '语境', review_due_at: '2026-09-26T00:00:00Z' }, base_revision: 1 } });
assert.equal(changed.status, 200, JSON.stringify(changed.data));
assert.equal(changed.data.entry.revision, 2);
const conflict = await request(`/sync/entries/${id}`, { method: 'PUT', token,
  body: { entry: { ...entry, word: 'wrong' }, base_revision: 1 } });
assert.equal(conflict.status, 409);
assert.equal(conflict.data.entry.word, 'context');

const deleted = await request(`/sync/entries/${id}`, { method: 'PUT', token,
  body: { entry: { ...entry, deleted_at: new Date().toISOString() }, base_revision: 2 } });
assert.equal(deleted.status, 200, JSON.stringify(deleted.data));
assert.ok(deleted.data.entry.deleted_at);
const since = await request(`/sync/changes?after=${first.data.cursor}`, { token });
assert.equal(since.status, 200);
assert.equal(since.data.changes.length, 2);
assert.equal(since.data.changes.at(-1).entry.revision, 3);

console.log('Worker auth, change cursor, update conflict, and tombstone tests passed');
