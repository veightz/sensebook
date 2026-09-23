/**
 * Sensebook FAB harness — polyfills GM_* and asserts #sensebook-fab-root.
 * Usage: node scripts/harness-fab.mjs
 *        node scripts/harness-fab.mjs --throw-menu
 *        node scripts/harness-fab.mjs --null-style
 *        node scripts/harness-fab.mjs --corrupt-fab-pos
 *        node scripts/harness-fab.mjs --iframe
 */
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const throwMenu = process.argv.includes('--throw-menu');
const nullStyle = process.argv.includes('--null-style');
const corruptFab = process.argv.includes('--corrupt-fab-pos');
const iframeMode = process.argv.includes('--iframe');
const scriptPath = path.join(__dirname, '../userscript/sensebook.user.js');
let code = fs.readFileSync(scriptPath, 'utf8');
code = code.replace(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==\s*/, '');

const store = new Map();
const alerts = [];
if (corruptFab) store.set('sensebook_fab_pos', 'not-json{{{');

function createEl(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    id: '',
    style: nullStyle ? null : {},
    children: [],
    attrs: {},
    textContent: '',
    parent: null,
    _listeners: {},
    type: 'button',
    offsetWidth: 72,
    offsetHeight: 36,
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
    addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); },
    removeEventListener() {},
    getBoundingClientRect() {
      return { left: 100, top: 100, right: 172, bottom: 136, width: 72, height: 36, x: 100, y: 100 };
    },
    setPointerCapture() {},
    releasePointerCapture() {},
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
  setTimeout: (fn) => { return 0; },
  clearTimeout() {},
  setInterval() { return 0; },
  clearInterval() {},
  alert: (m) => { alerts.push(String(m)); },
  prompt: () => null,
  confirm: () => false,
  document,
  window: {},
  navigator: {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    platform: 'Win32',
    maxTouchPoints: 0,
  },
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
  matchMedia: () => ({ matches: true }),
  innerWidth: 1280,
  innerHeight: 800,
  Date, Math, JSON, Object, Array, String, Number, Boolean, Error, Map, Promise,
  parseInt, parseFloat, isNaN, Infinity, NaN, undefined,
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.window.matchMedia = sandbox.matchMedia;
sandbox.window.innerWidth = 1280;
sandbox.window.innerHeight = 800;
sandbox.window.self = sandbox.window;
sandbox.window.top = iframeMode ? { __otherTop: true } : sandbox.window;

vm.createContext(sandbox);
vm.runInContext(code, sandbox, { timeout: 5000 });

const fab = document.getElementById('sensebook-fab-root');
if (iframeMode) {
  if (fab) {
    console.error('FAIL: iframe mode should not mount #sensebook-fab-root');
    process.exit(1);
  }
  console.log('PASS: iframe mode skipped FAB mount');
  process.exit(0);
}
if (!fab) {
  console.error('FAIL: #sensebook-fab-root missing');
  if (alerts.length) console.error('alerts:', alerts);
  process.exit(1);
}

const left = fab.style && fab.style.left;
const top = fab.style && fab.style.top;
const attrStyle = fab.attrs && fab.attrs.style;
const positioned =
  (left && top) ||
  (attrStyle && /left\s*:/.test(attrStyle) && /top\s*:/.test(attrStyle));

if (!positioned) {
  console.error('FAIL: expected left/top position, got', { left, top, attrStyle, style: fab.style });
  process.exit(1);
}

const convertAlerts = alerts.filter((a) => /Cannot convert undefined or null to object/i.test(a));
if (convertAlerts.length) {
  console.error('FAIL: null-object alert still shown', convertAlerts);
  process.exit(1);
}

console.log('PASS: #sensebook-fab-root present', throwMenu ? '(GM menu threw)' : '(GM menu ok)', nullStyle ? '(null style)' : '', corruptFab ? '(corrupt fab pos)' : '');
console.log('  left=', left, 'top=', top, 'attrStyle=', attrStyle ? attrStyle.slice(0, 80) : undefined);
if (alerts.length) console.log('  alerts:', alerts);
