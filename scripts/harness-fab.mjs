/**
 * Sensebook FAB harness — polyfills GM_* and asserts #sensebook-fab-root.
 * Usage: node scripts/harness-fab.mjs
 *        node scripts/harness-fab.mjs --throw-menu
 */
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const throwMenu = process.argv.includes('--throw-menu');
const scriptPath = path.join(__dirname, '../userscript/sensebook.user.js');
let code = fs.readFileSync(scriptPath, 'utf8');
// Strip userscript header
code = code.replace(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==\s*/, '');

const store = new Map();
const alerts = [];

function createEl(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    id: '',
    style: {},
    children: [],
    attrs: {},
    textContent: '',
    parent: null,
    _listeners: {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    appendChild(c) { c.parent = this; this.children.push(c); return c; },
    remove() {
      if (!this.parent) return;
      const i = this.parent.children.indexOf(this);
      if (i >= 0) this.parent.children.splice(i, 1);
      this.parent = null;
    },
    contains(n) {
      if (n === this) return true;
      for (const c of this.children) if (c.contains(n)) return true;
      return false;
    },
    querySelector(sel) {
      const all = [];
      const walk = (n) => { all.push(n); n.children.forEach(walk); };
      this.children.forEach(walk);
      if (sel.startsWith('#')) return all.find((n) => n.id === sel.slice(1)) || null;
      if (sel.startsWith('[') && sel.endsWith(']')) {
        const raw = sel.slice(1, -1);
        const [k, v] = raw.split('=');
        const key = k.trim();
        const val = v ? v.replace(/['"]/g, '').trim() : null;
        return all.find((n) => (val == null ? key in n.attrs : n.attrs[key] === val)) || null;
      }
      return null;
    },
    addEventListener(type, fn) {
      (this._listeners[type] ||= []).push(fn);
    },
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return ''; },
    set() { this.children = []; },
  });
  return el;
}

const documentElement = createEl('html');
const body = createEl('body');
documentElement.appendChild(body);

const byId = new Map();
const origAppend = documentElement.appendChild.bind(documentElement);
documentElement.appendChild = function (c) {
  if (c.id) byId.set(c.id, c);
  return origAppend(c);
};
const bodyAppend = body.appendChild.bind(body);
body.appendChild = function (c) {
  if (c.id) byId.set(c.id, c);
  return bodyAppend(c);
};

const document = {
  documentElement,
  body,
  readyState: 'complete',
  getElementById(id) {
    if (byId.has(id)) {
      const n = byId.get(id);
      // treat as missing if detached
      let p = n;
      while (p && p !== documentElement && p !== body) p = p.parent;
      if (p === documentElement || p === body || n.parent) return n;
    }
    const walk = (n) => {
      if (n.id === id) return n;
      for (const c of n.children) {
        const f = walk(c);
        if (f) return f;
      }
      return null;
    };
    return walk(documentElement);
  },
  createElement: createEl,
  addEventListener() {},
};

const sandbox = {
  console,
  setTimeout: (fn) => { /* don't auto-run onboarding */ return 0; },
  clearTimeout() {},
  setInterval() { return 0; },
  clearInterval() {},
  alert: (m) => { alerts.push(String(m)); },
  prompt: () => null,
  confirm: () => false,
  document,
  window: {},
  localStorage: {
    _d: {},
    getItem(k) { return this._d[k] ?? null; },
    setItem(k, v) { this._d[k] = String(v); },
  },
  MutationObserver: class { observe() {} disconnect() {} },
  GM_getValue(k, d) { return store.has(k) ? store.get(k) : d; },
  GM_setValue(k, v) { store.set(k, v); },
  GM_xmlhttpRequest(details) {
    if (details && details.onerror) details.onerror(new Error('no network in harness'));
  },
  GM_registerMenuCommand(caption, fn) {
    if (throwMenu) throw new Error('GM_registerMenuCommand broken (harness)');
    return caption;
  },
  crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000001' },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

vm.createContext(sandbox);
vm.runInContext(code, sandbox, { timeout: 5000 });

const fab = document.getElementById('sensebook-fab-root');
if (!fab) {
  console.error('FAIL: #sensebook-fab-root missing');
  if (alerts.length) console.error('alerts:', alerts);
  process.exit(1);
}
const bottom = fab.style.bottom;
const right = fab.style.right;
if (bottom !== '16px' || right !== '16px') {
  console.error('FAIL: expected bottom/right 16px, got', { bottom, right });
  process.exit(1);
}
if (String(fab.style.zIndex) !== '2147483647') {
  console.error('FAIL: zIndex', fab.style.zIndex);
  process.exit(1);
}
console.log('PASS: #sensebook-fab-root present', throwMenu ? '(GM menu threw)' : '(GM menu ok)');
console.log('  bottom=', bottom, 'right=', right, 'zIndex=', fab.style.zIndex);
if (alerts.length) console.log('  alerts:', alerts);
