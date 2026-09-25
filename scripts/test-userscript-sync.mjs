import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';

const base = process.env.SENSEBOOK_TEST_API || 'http://127.0.0.1:8788';
const store = new Map();
let code = readFileSync(new URL('../userscript/sensebook.user.js', import.meta.url), 'utf8');
code = code.replace(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==\s*/, '');
code = code.replace('try { // sensebook-main', `try { // sensebook-main
  window.__test = { createLocalEntry, patchLocalEntry, deleteLocalEntry, loadEntries, loadAllEntries,
    reviewLocalEntry, storeSet, syncAccount, syncNow };`);

const element = () => ({ style: {}, children: [], appendChild(child) { this.children.push(child); return child; },
  remove() {}, setAttribute() {}, getAttribute() { return null; }, addEventListener() {},
  attachShadow() { return { innerHTML: '', getElementById() { return null; }, querySelector() { return null; } }; },
  getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; } });
const sandbox = {
  console: { ...console, warn() {}, error() {} },
  document: { documentElement: element(), body: element(), readyState: 'loading', createElement: element,
    getElementById() { return null; }, addEventListener() {} },
  location: { href: 'https://example.test/article' },
  navigator: { userAgent: 'test', platform: 'test', maxTouchPoints: 0 },
  crypto: { randomUUID },
  URL,
  MutationObserver: class { observe() {} },
  setTimeout() { return 1; }, clearTimeout() {}, setInterval() { return 1; },
  alert() {}, prompt() { return null; }, confirm() { return false; },
  GM_getValue(key, fallback) { return store.has(key) ? store.get(key) : fallback; },
  GM_setValue(key, value) { store.set(key, value); },
  GM_registerMenuCommand() {},
  GM_xmlhttpRequest(details) {
    if (!details.url.startsWith(base)) {
      details.onerror?.(new Error('offline test'));
      return;
    }
    fetch(details.url, { method: details.method, headers: details.headers, body: details.data })
      .then(async (response) => details.onload({ status: response.status, responseText: await response.text() }))
      .catch((error) => details.onerror?.(error));
  },
  matchMedia: () => ({ matches: false }), innerWidth: 1280, innerHeight: 800,
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.window.addEventListener = () => {};
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { timeout: 5000 });
assert.ok(sandbox.__test, 'test hooks were not installed');
const api = sandbox.__test;

const entry = api.createLocalEntry({ word: 'handoff', sentence: 'A handoff between devices.', source_url: 'https://example.test/a' });
assert.equal(api.createLocalEntry({ word: 'handoff', sentence: 'A handoff between devices.', source_url: 'https://example.test/a' }).id, entry.id);
api.patchLocalEntry(entry.id, { ai_word_sense: '交接', status: 'ready' });
api.reviewLocalEntry(entry.id, true);
const deleted = api.createLocalEntry({ word: 'remove', sentence: 'Remove this word.', source_url: 'https://example.test/a' });
api.deleteLocalEntry(deleted.id);
assert.equal(api.loadEntries().length, 1);
assert.equal(api.loadAllEntries().length, 2);

api.storeSet('sensebook_api_url', base);
const user = await api.syncAccount(`browser-${randomUUID()}@example.test`, `pass-${randomUUID()}`, true);
assert.ok(user.id);
const first = await api.syncNow();
assert.equal(first.uploaded, 2);
assert.ok(api.loadAllEntries().every((item) => item.sync_revision === 1 && !item.sync_dirty));

const token = store.get('sensebook_token');
const remoteUpdate = await fetch(`${base}/sync/entries/${entry.id}`, {
  method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ base_revision: 1, entry: { ...entry, word: 'handoff-updated', sentence: entry.sentence } }),
});
assert.equal(remoteUpdate.status, 200);
const second = await api.syncNow();
assert.ok(second.downloaded >= 1);
assert.equal(api.loadEntries()[0].word, 'handoff-updated');

api.patchLocalEntry(entry.id, { word: 'local-edit' });
const concurrent = await fetch(`${base}/sync/entries/${entry.id}`, {
  method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ base_revision: 2, entry: { ...entry, word: 'remote-edit' } }),
});
assert.equal(concurrent.status, 200);
await api.syncNow();
const visible = api.loadEntries();
assert.ok(visible.some((item) => item.word === 'remote-edit'));
assert.ok(visible.some((item) => item.word === 'local-edit' && item.tags.includes('同步冲突')));
await api.syncNow();
assert.ok(api.loadAllEntries().every((item) => !item.sync_dirty));

console.log('Userscript dedupe, tombstones, upload, pull, and conflict copy passed');
