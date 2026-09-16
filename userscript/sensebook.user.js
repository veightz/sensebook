// ==UserScript==
// @name         Sensebook 划词
// @namespace    https://github.com/veightz/sensebook
// @updateURL    https://raw.githubusercontent.com/veightz/sensebook/main/userscript/sensebook.user.js
// @downloadURL  https://raw.githubusercontent.com/veightz/sensebook/main/userscript/sensebook.user.js
// @version      0.1.202609161204
// @description  划词自动查询 / 翻译 / 存词 / AI 释义 — Sensebook（本地词库 + 模型双出）
// @author       Sensebook
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @connect      localhost
// @connect      *
// @run-at       document-idle
// @inject-into  content
// ==/UserScript==

(function () {
  'use strict';

  // ---- safe GM_* wrappers (never throw if grant/polyfill missing) ----
  function gmGet(key, def) {
    try {
      if (typeof GM_getValue === 'function') return GM_getValue(key, def);
    } catch { /* ignore */ }
    return def;
  }
  function gmSet(key, val) {
    try {
      if (typeof GM_setValue === 'function') {
        GM_setValue(key, val);
        return true;
      }
    } catch { /* ignore */ }
    return false;
  }
  function gmMenu(caption, fn) {
    try {
      if (typeof GM_registerMenuCommand === 'function') {
        GM_registerMenuCommand(caption, fn);
        return true;
      }
    } catch { /* ignore */ }
    return false;
  }
  function gmXhr(details) {
    try {
      if (typeof GM_xmlhttpRequest === 'function') {
        return GM_xmlhttpRequest(details);
      }
    } catch (err) {
      if (details && typeof details.onerror === 'function') {
        try { details.onerror(err); } catch { /* ignore */ }
      }
      return undefined;
    }
    if (details && typeof details.onerror === 'function') {
      try { details.onerror(new Error('GM_xmlhttpRequest unavailable')); } catch { /* ignore */ }
    }
    return undefined;
  }

  let sensebookErrorAlerted = false;
  function sensebookAlertError(err) {
    try {
      if (sensebookErrorAlerted) return;
      sensebookErrorAlerted = true;
      const msg = (err && err.message) ? err.message : String(err);
      alert('Sensebook 脚本错误: ' + msg);
    } catch { /* ignore */ }
  }

  function mountEmergencyFab() {
    try {
      if (document.getElementById('sensebook-fab-root')) return;
      const root = document.createElement('div');
      root.id = 'sensebook-fab-root';
      Object.assign(root.style, {
        position: 'fixed',
        right: '16px',
        bottom: '16px',
        zIndex: '2147483647',
      });
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Sensebook 设置';
      Object.assign(btn.style, {
        minWidth: '120px',
        minHeight: '48px',
        padding: '12px 16px',
        border: '2px solid #fff',
        borderRadius: '999px',
        background: '#dc2626',
        color: '#fff',
        boxShadow: '0 6px 20px rgba(0,0,0,.4)',
        fontSize: '14px',
        fontWeight: '800',
        cursor: 'pointer',
      });
      btn.addEventListener('click', () => {
        try {
          if (typeof showLlmSettingsPanel === 'function') showLlmSettingsPanel();
          else alert('Sensebook：请在油猴菜单打开 LLM 设置');
        } catch (e) {
          alert('Sensebook：' + ((e && e.message) || e));
        }
      });
      root.appendChild(btn);
      const mount = document.body || document.documentElement;
      if (mount) mount.appendChild(root);
    } catch { /* ignore */ }
  }


  try { // sensebook-main
    const ENTRIES_KEY = 'sensebook_entries';
  const API_URL_KEY = 'sensebook_api_url';
  const TOKEN_KEY = 'sensebook_token';
  // LLM settings (local-only; separate from optional server sync)
  const LLM_BASE_URL_KEY = 'sensebook_llm_base_url';
  const LLM_API_KEY_KEY = 'sensebook_llm_api_key';
  const LLM_MODEL_KEY = 'sensebook_llm_model';
  const ONBOARDING_DONE_KEY = 'sensebook_onboarding_done';
  const AUTO_QUERY_KEY = 'sensebook_auto_query';
  const QUERY_CACHE_KEY = 'sensebook_query_cache';
  const QUERY_CACHE_CAP = 250;
  const AUTO_QUERY_DEBOUNCE_MS = 350;

  // Local EN→ZH dict (async file from repo). Keys are INDEPENDENT of userscript @version
  // so bumping the script never clears the dict GM cache.
  const LOCAL_DICT_DATA_KEY = 'sensebook_local_dict_data';
  const LOCAL_DICT_META_KEY = 'sensebook_local_dict_meta';
  const LOCAL_DICT_URL =
    'https://raw.githubusercontent.com/veightz/sensebook/main/userscript/dict/en-zh-common.json';
  // Bump only when shipping a new dict JSON. Mismatch vs GM-cached payload.version
  // triggers one refresh; unrelated @version bumps must NOT clear dict cache.
  const LOCAL_DICT_EXPECTED_VERSION = '0.1.20260916-full20k';
  const LOCAL_DICT_SHORT_MAX = 20;

  const DEFAULT_LLM_BASE_URL = 'https://api.deepseek.com/v1';
  const DEFAULT_LLM_MODEL = 'deepseek-flash';

  const ENRICH_SYSTEM_PROMPT =
    '你是简洁的语境词汇助教。根据用户给出的单词、句子与来源页，用中文解释。' +
    '只输出 JSON 对象：{"ai_sentence_gloss":"整句中文释义（简洁）","ai_word_sense":"该词在此句中的中文义项（含词性/用法提示，简洁）"}。' +
    '不要输出 Markdown 或其它文字。';

  // ---- storage helpers (safe gmGet/gmSet + localStorage fallback) ----
  function storeGet(key, def) {
    try {
      const v = gmGet(key, undefined);
      if (v !== undefined && v !== null) return v;
    } catch { /* ignore */ }
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return def;
      try { return JSON.parse(raw); } catch { return raw; }
    } catch {
      return def;
    }
  }

  function storeSet(key, val) {
    if (gmSet(key, val)) return;
    try {
      localStorage.setItem(key, typeof val === 'string' ? val : JSON.stringify(val));
    } catch { /* ignore */ }
  }

  function getApiUrl() {
    const v = storeGet(API_URL_KEY, '');
    return (typeof v === 'string' ? v : '').replace(/\/$/, '');
  }

  function getToken() {
    const v = storeGet(TOKEN_KEY, '');
    return typeof v === 'string' ? v : '';
  }

  function hasOptionalApi() {
    return !!(getApiUrl() && getToken());
  }

  function getLlmBaseUrl() {
    const v = storeGet(LLM_BASE_URL_KEY, '');
    const s = typeof v === 'string' ? v.trim() : '';
    return (s || DEFAULT_LLM_BASE_URL).replace(/\/$/, '');
  }

  function getLlmApiKey() {
    const v = storeGet(LLM_API_KEY_KEY, '');
    return typeof v === 'string' ? v.trim() : '';
  }

  function getLlmModel() {
    const v = storeGet(LLM_MODEL_KEY, '');
    const s = typeof v === 'string' ? v.trim() : '';
    return s || DEFAULT_LLM_MODEL;
  }

  /** True when user configured an API key (base URL has a usable default). */
  function hasLlmConfig() {
    return !!getLlmApiKey();
  }

  /** Auto-query on selection; default ON. */
  function isAutoQueryEnabled() {
    const v = storeGet(AUTO_QUERY_KEY, true);
    if (v === false || v === 'false' || v === 0 || v === '0') return false;
    return true;
  }

  function setAutoQueryEnabled(on) {
    storeSet(AUTO_QUERY_KEY, !!on);
  }

  // ---- Local dict (GM cache; versioned independently of @version) ----
  let localDictMem = null; // { version, entries: Map-like object }
  let localDictLoadPromise = null;

  function isShortWordToken(text) {
    const t = String(text || '').trim();
    if (!t || /\s/.test(t)) return false;
    if (t.length > LOCAL_DICT_SHORT_MAX) return false;
    return /^[A-Za-z][A-Za-z\-']*$/.test(t);
  }

  /** Light stemming only: -s / -ed / -ing (+ simple -ies). */
  function stemCandidates(word) {
    const w = String(word || '').toLowerCase();
    const out = [];
    const push = (x) => {
      if (x && x.length >= 2 && !out.includes(x)) out.push(x);
    };
    push(w);
    if (w.endsWith('ies') && w.length > 4) push(w.slice(0, -3) + 'y');
    if (w.endsWith('es') && w.length > 3 && !w.endsWith('ss')) push(w.slice(0, -2));
    if (w.endsWith('s') && !w.endsWith('ss') && w.length > 2) push(w.slice(0, -1));
    if (w.endsWith('ing') && w.length > 5) {
      push(w.slice(0, -3));
      push(w.slice(0, -3) + 'e');
      if (w.length > 6 && w[w.length - 4] === w[w.length - 5]) {
        push(w.slice(0, -4)); // running -> run
      }
    }
    if (w.endsWith('ed') && w.length > 3) {
      push(w.slice(0, -2));
      push(w.slice(0, -1)); // liked -> like-ish via -e keep
      if (w.length > 4 && w[w.length - 3] === w[w.length - 4]) {
        push(w.slice(0, -3)); // stopped -> stop
      }
    }
    return out;
  }

  function formatLocalGloss(entry) {
    if (!entry) return '';
    if (typeof entry === 'string') return entry;
    const g = entry.g || entry.gloss || '';
    const p = entry.p || entry.pos || '';
    if (p && g) return p + ' ' + g;
    return g || '';
  }

  function lookupLocalDictSync(word) {
    if (!localDictMem || !localDictMem.entries) return null;
    const entries = localDictMem.entries;
    for (const cand of stemCandidates(word)) {
      const hit = entries[cand];
      if (hit) {
        return { word: cand, gloss: formatLocalGloss(hit), entry: hit };
      }
    }
    return null;
  }

  function readDictFromStore() {
    try {
      const data = storeGet(LOCAL_DICT_DATA_KEY, null);
      if (!data) return null;
      if (typeof data === 'string') {
        try {
          return JSON.parse(data);
        } catch {
          return null;
        }
      }
      if (data && typeof data === 'object' && data.entries) return data;
    } catch { /* ignore */ }
    return null;
  }

  function persistDictToStore(payload) {
    // Store full payload under DATA key; META only tracks dict.version (NOT script @version).
    storeSet(LOCAL_DICT_DATA_KEY, payload);
    storeSet(LOCAL_DICT_META_KEY, {
      dictVersion: payload.version || '',
      count: payload.count || (payload.entries ? Object.keys(payload.entries).length : 0),
      fetchedAt: Date.now(),
      source: payload.source || '',
    });
  }

  function clearLocalDictCache() {
    storeSet(LOCAL_DICT_DATA_KEY, null);
    storeSet(LOCAL_DICT_META_KEY, null);
    localDictMem = null;
    localDictLoadPromise = null;
  }

  function adoptDictPayload(payload) {
    if (!payload || typeof payload !== 'object' || !payload.entries) return false;
    localDictMem = payload;
    return true;
  }

  function gmGetText(url) {
    return new Promise((resolve, reject) => {
      const h = gmXhr({
        method: 'GET',
        url,
        timeout: 60000,
        onload(res) {
          if (res.status >= 200 && res.status < 300) resolve(res.responseText || '');
          else reject(new Error('dict HTTP ' + res.status));
        },
        onerror() {
          reject(new Error('dict network error'));
        },
        ontimeout() {
          reject(new Error('dict timeout'));
        },
      });
      if (h === undefined) reject(new Error('GM_xmlhttpRequest unavailable'));
    });
  }

  /**
   * Ensure local dict is in memory. Uses GM cache first; refreshes from repo when
   * missing or when cached.version !== LOCAL_DICT_EXPECTED_VERSION (dict ship only).
   * Script @version bumps alone do not clear dict GM cache.
   * Fetch failure → silent (caller falls back to model-only).
   * forceRefresh downloads even if cache present.
   */
  async function ensureLocalDict(opts) {
    const forceRefresh = !!(opts && opts.forceRefresh);
    if (!forceRefresh && localDictMem && localDictMem.entries) {
      if (localDictMem.version === LOCAL_DICT_EXPECTED_VERSION) return localDictMem;
      // Stale in-memory dict (expected version bumped) — fall through to refresh.
      localDictMem = null;
    }
    if (!forceRefresh) {
      const cached = readDictFromStore();
      if (cached && cached.entries && cached.version === LOCAL_DICT_EXPECTED_VERSION) {
        adoptDictPayload(cached);
        return localDictMem;
      }
      // Version mismatch or empty → download; do not keep serving stale half pack.
    }
    if (localDictLoadPromise && !forceRefresh) return localDictLoadPromise;

    localDictLoadPromise = (async () => {
      try {
        const text = await gmGetText(LOCAL_DICT_URL);
        const payload = JSON.parse(text);
        if (!payload || !payload.entries) throw new Error('invalid dict json');
        persistDictToStore(payload);
        adoptDictPayload(payload);
        return localDictMem;
      } catch (err) {
        // Silent fallback to model — keep any previous memory/cache.
        try {
          console.warn('[Sensebook] local dict fetch failed', err);
        } catch { /* ignore */ }
        if (!localDictMem) {
          const cached = readDictFromStore();
          if (cached) adoptDictPayload(cached);
        }
        return localDictMem;
      } finally {
        localDictLoadPromise = null;
      }
    })();
    return localDictLoadPromise;
  }

  function getLocalDictStatusText() {
    const meta = storeGet(LOCAL_DICT_META_KEY, null) || {};
    const ver = (localDictMem && localDictMem.version) || meta.dictVersion || '未加载';
    const n = (localDictMem && localDictMem.count) || meta.count || 0;
    return '词库 ' + ver + (n ? ' · ' + n + ' 词' : '');
  }


  function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function loadEntries() {
    const raw = storeGet(ENTRIES_KEY, []);
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  }

  function saveEntries(list) {
    storeSet(ENTRIES_KEY, list);
  }

  function patchLocalEntry(id, patch) {
    const list = loadEntries();
    const idx = list.findIndex((x) => x.id === id);
    if (idx < 0) return null;
    list[idx] = { ...list[idx], ...patch };
    saveEntries(list);
    return list[idx];
  }

  function createLocalEntry({ word, sentence, source_url, status }) {
    const now = new Date().toISOString();
    const entry = {
      id: uuid(),
      word: word || '',
      sentence: sentence || word || '',
      ai_sentence_gloss: null,
      ai_word_sense: null,
      source_url: source_url || '',
      tags: [],
      status: status || 'pending_ai',
      created_at: now,
    };
    const list = loadEntries();
    list.unshift(entry);
    saveEntries(list);
    return entry;
  }

  // ---- query cache (local lookup history; LRU by updated_at) ----
  function normalizeWord(word) {
    return String(word || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function sentenceContextKey(sentence) {
    return String(sentence || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  }

  function makeCacheKey(word, sentence) {
    return normalizeWord(word) + '::' + sentenceContextKey(sentence);
  }

  function loadQueryCache() {
    const raw = storeGet(QUERY_CACHE_KEY, []);
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  }

  function saveQueryCache(list) {
    storeSet(QUERY_CACHE_KEY, list);
  }

  function getCachedByKey(cacheKey) {
    const list = loadQueryCache();
    return list.find((x) => x && x.cacheKey === cacheKey) || null;
  }

  function upsertQueryCache( partial ) {
    const word = partial.word || '';
    const sentence = partial.sentence || word || '';
    const cacheKey = partial.cacheKey || makeCacheKey(word, sentence);
    const now = new Date().toISOString();
    let list = loadQueryCache();
    const idx = list.findIndex((x) => x && x.cacheKey === cacheKey);
    let record;
    if (idx >= 0) {
      record = {
        ...list[idx],
        ...partial,
        cacheKey,
        word,
        sentence,
        updated_at: now,
      };
      list.splice(idx, 1);
    } else {
      record = {
        id: partial.id || uuid(),
        cacheKey,
        word,
        sentence,
        translation: partial.translation || '',
        ai_word_sense: partial.ai_word_sense ?? null,
        ai_sentence_gloss: partial.ai_sentence_gloss ?? null,
        source_url: partial.source_url || '',
        created_at: now,
        updated_at: now,
      };
    }
    list.unshift(record);
    if (list.length > QUERY_CACHE_CAP) list = list.slice(0, QUERY_CACHE_CAP);
    saveQueryCache(list);
    return record;
  }

  function clientStubEnrich(word, sentence) {
    return {
      ai_sentence_gloss: `[本地 stub] 句意占位：${(sentence || '').slice(0, 80)}`,
      ai_word_sense: `[本地 stub] 「${word}」在句中的义项（未配置 LLM API Key，仅占位）`,
    };
  }

  function clientStubTranslate(text) {
    return `[本地翻译占位] ${text}\n（请先点「配置 DeepSeek」填写 API Key）`;
  }

  function buildEnrichUserPrompt({ word, sentence, source_url }) {
    return [
      `单词：${word || ''}`,
      `句子：${sentence || ''}`,
      `来源：${source_url || ''}`,
    ].join('\n');
  }

  /**
   * Parse LLM message content into enrich JSON.
   * Strips optional markdown fences; validates required keys.
   */
  function parseEnrichJson(content) {
    if (content == null) throw new Error('LLM 返回空内容');
    let text = String(content).trim();
    const fence = text.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
    if (fence) text = fence[1].trim();
    const obj = JSON.parse(text);
    if (!obj || typeof obj !== 'object') throw new Error('LLM JSON 无效');
    return {
      ai_sentence_gloss: String(obj.ai_sentence_gloss ?? '').trim(),
      ai_word_sense: String(obj.ai_word_sense ?? '').trim(),
    };
  }

  function parseTranslationContent(content) {
    if (content == null) throw new Error('LLM 返回空内容');
    let text = String(content).trim();
    const fence = text.match(/^```(?:json|text)?\s*([\s\S]*?)```$/i);
    if (fence) text = fence[1].trim();
    try {
      const obj = JSON.parse(text);
      if (obj && typeof obj.translation === 'string') return obj.translation.trim();
    } catch { /* plain-text translation is also valid */ }
    if (!text) throw new Error('LLM 返回空译文');
    return text;
  }

  // Menus + FAB boot run at end (after function decls); safe gmMenu never aborts IIFE.

  let popup = null;
  let popupBtnRow = null;
  let popupResultEl = null;
  let panel = null;
  let llmPanelHost = null;
  let lastSel = { text: '', sentence: '', rect: null };
  let busy = false; // only for heavy manual AI释义 / optional server paths
  let selectionGen = 0; // bumps on each new selection; stale responses discard
  let autoQueryTimer = null;
  const inFlightByCacheKey = new Map(); // cacheKey -> Promise (dedupe)
  let fabRoot = null;
  let fabSheet = null;
  let fabButton = null;
  let onboardingScheduled = false;

  function eventInsideLlmSettings(e) {
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    return path.length ? path.includes(llmPanelHost) : e.target === llmPanelHost;
  }

  function toast(msg) {
    let el = document.getElementById('sensebook-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'sensebook-toast';
      Object.assign(el.style, {
        position: 'fixed',
        bottom: '24px',
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'rgba(0,0,0,.85)',
        color: '#fff',
        padding: '10px 16px',
        borderRadius: '8px',
        zIndex: '2147483647',
        fontSize: '14px',
        maxWidth: '90vw',
        pointerEvents: 'none',
      });
      (document.body || document.documentElement).appendChild(el);
    }
    el.textContent = msg;
    el.style.display = 'block';
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.display = 'none'; }, 3200);
  }

  // Early FAB boot (function decls for setupFab* are hoisted; menus come later)
  try {
    setupFabAndOnboarding();
  } catch (err) {
    sensebookAlertError(err);
    mountEmergencyFab();
  }

  function extractSentence(range) {
    try {
      let node = range.commonAncestorContainer;
      if (node.nodeType === 3) node = node.parentElement;
      const block = node.closest(
        'p, li, td, th, blockquote, h1, h2, h3, h4, h5, h6, article, section, div'
      ) || node;
      let text = (block.innerText || block.textContent || '').replace(/\s+/g, ' ').trim();
      if (text.length > 500) {
        const sel = range.toString();
        const idx = text.indexOf(sel);
        if (idx >= 0) {
          const start = Math.max(0, idx - 120);
          const end = Math.min(text.length, idx + sel.length + 120);
          text = (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
        } else {
          text = text.slice(0, 400) + '…';
        }
      }
      return text || range.toString();
    } catch {
      return range.toString();
    }
  }

  function hidePopup() {
    if (autoQueryTimer) {
      clearTimeout(autoQueryTimer);
      autoQueryTimer = null;
    }
    if (popup) {
      popup.remove();
      popup = null;
    }
    popupBtnRow = null;
    popupResultEl = null;
  }

  function ensurePopupResultEl() {
    if (!popup) return null;
    if (popupResultEl && popup.contains(popupResultEl)) return popupResultEl;
    const el = document.createElement('div');
    el.setAttribute('data-sensebook-result', '1');
    Object.assign(el.style, {
      display: 'none',
      width: '100%',
      marginTop: '4px',
      padding: '8px 10px',
      borderRadius: '8px',
      background: '#f8fafc',
      border: '1px solid #e2e8f0',
      fontSize: '13px',
      lineHeight: '1.5',
      color: '#0f172a',
      maxWidth: 'min(360px, calc(100vw - 32px))',
      maxHeight: '220px',
      overflow: 'auto',
      boxSizing: 'border-box',
    });
    const localRow = document.createElement('div');
    localRow.setAttribute('data-slot', 'local');
    localRow.style.display = 'none';
    const modelRow = document.createElement('div');
    modelRow.setAttribute('data-slot', 'model');
    modelRow.style.display = 'none';
    el.appendChild(localRow);
    el.appendChild(modelRow);
    popup.appendChild(el);
    popupResultEl = el;
    return el;
  }

  function resetPopupResultSlots() {
    const el = ensurePopupResultEl();
    if (!el) return;
    el.style.display = 'none';
    el.style.background = '#f8fafc';
    el.style.borderColor = '#e2e8f0';
    const localRow = el.querySelector('[data-slot="local"]');
    const modelRow = el.querySelector('[data-slot="model"]');
    if (localRow) {
      localRow.style.display = 'none';
      while (localRow.firstChild) localRow.removeChild(localRow.firstChild);
    }
    if (modelRow) {
      modelRow.style.display = 'none';
      while (modelRow.firstChild) modelRow.removeChild(modelRow.firstChild);
    }
  }

  function _paintMetaHint(parent, label, dotColor) {
    const meta = document.createElement('div');
    Object.assign(meta.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
      fontSize: '11px',
      lineHeight: '1.2',
      color: '#94a3b8',
      letterSpacing: '0.02em',
      marginBottom: '4px',
    });
    const dot = document.createElement('span');
    Object.assign(dot.style, {
      width: '6px',
      height: '6px',
      borderRadius: '50%',
      background: dotColor || '#94a3b8',
      flexShrink: '0',
    });
    const lab = document.createElement('span');
    lab.textContent = label;
    meta.appendChild(dot);
    meta.appendChild(lab);
    parent.appendChild(meta);
  }

  /** Local dict row — never overwritten by model row. */
  function setLocalDictRow(gloss) {
    const el = ensurePopupResultEl();
    if (!el) return;
    const localRow = el.querySelector('[data-slot="local"]');
    if (!localRow) return;
    while (localRow.firstChild) localRow.removeChild(localRow.firstChild);
    if (!gloss) {
      localRow.style.display = 'none';
      const modelRow = el.querySelector('[data-slot="model"]');
      if (!modelRow || modelRow.style.display === 'none') el.style.display = 'none';
      return;
    }
    el.style.display = 'block';
    localRow.style.display = 'block';
    Object.assign(localRow.style, {
      marginBottom: '8px',
      paddingBottom: '8px',
      borderBottom: '1px solid #e2e8f0',
    });
    _paintMetaHint(localRow, '本地词库', '#38bdf8');
    const text = document.createElement('div');
    Object.assign(text.style, {
      color: '#0f172a',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
    });
    text.textContent = String(gloss);
    localRow.appendChild(text);
  }

  /** Model / cache / error row — independent of local dict row. */
  function setModelRow(msg, kind) {
    const el = ensurePopupResultEl();
    if (!el) return;
    const modelRow = el.querySelector('[data-slot="model"]');
    if (!modelRow) return;
    el.style.display = 'block';
    modelRow.style.display = 'block';
    while (modelRow.firstChild) modelRow.removeChild(modelRow.firstChild);

    const body = String(msg || '');
    if (kind === 'cache') {
      _paintMetaHint(modelRow, '本地缓存', '#5eead4');
    } else if (kind === 'loading') {
      _paintMetaHint(modelRow, '模型', '#c4b5fd');
    } else if (kind === 'ok') {
      _paintMetaHint(modelRow, '模型', '#a78bfa');
    }

    const text = document.createElement('div');
    Object.assign(text.style, {
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
    });
    text.textContent = body;
    if (kind === 'error') text.style.color = '#b91c1c';
    else if (kind === 'loading') text.style.color = '#6d28d9';
    else if (kind === 'hint') text.style.color = '#64748b';
    else text.style.color = '#0f172a';
    modelRow.appendChild(text);
  }

  /**
   * Backward-compatible single-block setter.
   * Writes the model row (does not clear a visible local dict row).
   * kind: 'loading' | 'ok' | 'cache' | 'error' | 'hint'
   */
  function setPopupResult(msg, kind) {
    setModelRow(msg, kind);
  }

  function setPopupLoading(msg) {
    setModelRow(msg || '查询中…', 'loading');
  }


  function repositionPopup(rect) {
    if (!popup || !rect) return;
    const pw = popup.offsetWidth;
    const ph = popup.offsetHeight;
    let top = rect.bottom + 8;
    let left = rect.left + rect.width / 2 - pw / 2;
    if (top + ph > window.innerHeight - 8) top = rect.top - ph - 8;
    if (left < 8) left = 8;
    if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
    popup.style.top = Math.max(8, top) + 'px';
    popup.style.left = left + 'px';
  }

  function showPopup(rect) {
    hidePopup();
    popup = document.createElement('div');
    popup.id = 'sensebook-popup';
    Object.assign(popup.style, {
      position: 'fixed',
      zIndex: '2147483646',
      display: 'flex',
      flexDirection: 'column',
      gap: '4px',
      padding: '6px',
      maxWidth: 'calc(100vw - 16px)',
      boxSizing: 'border-box',
      background: '#fff',
      borderRadius: '10px',
      boxShadow: '0 4px 20px rgba(0,0,0,.18)',
      border: '1px solid #e2e8f0',
      fontFamily: 'system-ui,sans-serif',
    });

    popupBtnRow = document.createElement('div');
    Object.assign(popupBtnRow.style, {
      display: 'flex',
      gap: '6px',
      flexWrap: 'wrap',
    });

    const mkBtn = (label, onClick, bg) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      Object.assign(b.style, {
        minHeight: '44px',
        minWidth: '64px',
        padding: '8px 12px',
        border: 'none',
        borderRadius: '8px',
        background: bg || '#2563eb',
        color: '#fff',
        fontSize: '14px',
        cursor: 'pointer',
        touchAction: 'manipulation',
      });
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Auto-query must not block buttons; only heavy enrich uses busy.
        if (busy && label === 'AI释义') return;
        onClick();
      });
      return b;
    };

    popupBtnRow.appendChild(mkBtn('翻译', () => doTranslate({ forceRefresh: true })));
    popupBtnRow.appendChild(mkBtn('存词', () => doSave(false)));
    popupBtnRow.appendChild(mkBtn('AI释义', () => doSave(true), '#7c3aed'));
    popupBtnRow.appendChild(mkBtn('生词', () => { hidePopup(); showLocalPanel(); }, '#0f766e'));

    popup.appendChild(popupBtnRow);
    ensurePopupResultEl();
    resetPopupResultSlots();
    document.documentElement.appendChild(popup);
    repositionPopup(rect);
  }

  function hidePanel() {
    if (panel) {
      panel.remove();
      panel = null;
    }
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  function maskApiKey(key) {
    if (!key) return '未设置';
    if (key.length <= 8) return '已设置（••••）';
    return '已设置：' + key.slice(0, 4) + '…' + key.slice(-4);
  }

  function hideLlmSettingsPanel() {
    storeSet(ONBOARDING_DONE_KEY, true);
    if (llmPanelHost) {
      llmPanelHost.remove();
      llmPanelHost = null;
    }
  }

  /**
   * In-page DeepSeek LLM settings (Shadow DOM).
   * Replaces scattered prompt() menus. Keeps sensebook_llm_* keys.
   */
  function showLlmSettingsPanel() {
    hideLlmSettingsPanel();

    const host = document.createElement('div');
    host.id = 'sensebook-llm-settings-host';
    Object.assign(host.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '2147483647',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '16px',
      boxSizing: 'border-box',
      background: 'rgba(15,23,42,.45)',
      fontFamily: 'system-ui,sans-serif',
    });
    const shadow = host.attachShadow({ mode: 'open' });

    const storedBase = storeGet(LLM_BASE_URL_KEY, '');
    const storedModel = storeGet(LLM_MODEL_KEY, '');
    const curKey = getLlmApiKey();
    const baseVal = (typeof storedBase === 'string' && storedBase.trim()) || DEFAULT_LLM_BASE_URL;
    const modelVal = (typeof storedModel === 'string' && storedModel.trim()) || DEFAULT_LLM_MODEL;

    shadow.innerHTML = `
<style>
  * { box-sizing: border-box; }
  .card {
    width: min(440px, 100%);
    max-height: min(92vh, 720px);
    overflow: auto;
    background: #fff;
    border-radius: 14px;
    box-shadow: 0 12px 40px rgba(0,0,0,.28);
    padding: 18px 18px 16px;
    color: #0f172a;
  }
  h2 { margin: 0 0 4px; font-size: 18px; font-weight: 700; }
  .sub { margin: 0 0 14px; font-size: 12px; color: #64748b; line-height: 1.5; }
  .badge {
    display: inline-block;
    margin-bottom: 12px;
    padding: 4px 10px;
    border-radius: 999px;
    background: #ecfdf5;
    color: #047857;
    font-size: 12px;
    font-weight: 600;
  }
  label {
    display: block;
    font-size: 13px;
    font-weight: 600;
    margin: 12px 0 6px;
    color: #334155;
  }
  .hint { font-weight: 400; color: #94a3b8; font-size: 11px; }
  input[type="text"], input[type="password"] {
    width: 100%;
    min-height: 44px;
    padding: 10px 12px;
    border: 1px solid #cbd5e1;
    border-radius: 10px;
    font-size: 15px;
    background: #f8fafc;
  }
  input:focus { outline: 2px solid #a78bfa; border-color: #7c3aed; background: #fff; }
  .key-row { display: flex; gap: 8px; align-items: stretch; }
  .key-row input { flex: 1; }
  .key-status { margin-top: 6px; font-size: 12px; color: #64748b; }
  .key-link {
    display: inline-block;
    margin-top: 8px;
    color: #6d28d9;
    font-size: 12px;
    text-decoration: underline;
  }
  .note {
    margin: 12px 0 0;
    padding: 10px 12px;
    background: #f1f5f9;
    border-radius: 10px;
    font-size: 12px;
    color: #475569;
    line-height: 1.55;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 16px;
  }
  button {
    min-height: 44px;
    padding: 10px 14px;
    border: none;
    border-radius: 10px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    touch-action: manipulation;
  }
  .primary { background: #7c3aed; color: #fff; }
  .secondary { background: #e2e8f0; color: #1e293b; }
  .danger { background: #fee2e2; color: #b91c1c; }
  .ghost { background: transparent; color: #64748b; margin-left: auto; }
  .test-status {
    margin-top: 12px;
    min-height: 20px;
    font-size: 13px;
    line-height: 1.45;
    white-space: pre-wrap;
  }
  .ok { color: #047857; }
  .err { color: #b91c1c; }
  .info { color: #475569; }
</style>
<div class="card" role="dialog" aria-label="Sensebook LLM 设置">
  <h2>LLM 设置</h2>
  <p class="sub">Key 仅保存在本机油猴存储，不经过 Sensebook 服务器。可选同步设置请用独立菜单。</p>
  <span class="badge">供应商：DeepSeek（当前仅支持）</span>

  <label>Base URL <span class="hint">OpenAI 兼容 /v1 根路径</span></label>
  <input type="text" id="base" autocomplete="off" spellcheck="false" />

  <label>API Key</label>
  <div class="key-row">
    <input type="password" id="key" autocomplete="off" spellcheck="false" placeholder="sk-…" />
    <button type="button" class="secondary" id="toggleKey">显示</button>
  </div>
  <div class="key-status" id="keyStatus"></div>
  <a class="key-link" href="https://platform.deepseek.com/api_keys" target="_blank" rel="noopener">去 DeepSeek 官网创建 API Key</a>

  <label>模型 <span class="hint">默认 deepseek-flash，可改</span></label>
  <input type="text" id="model" autocomplete="off" spellcheck="false" />

  <label style="display:flex;align-items:center;gap:8px;font-weight:600;margin-top:14px;">
    <input type="checkbox" id="autoQuery" style="width:18px;height:18px;" />
    选中自动查询
  </label>
  <div class="hint" style="margin-top:4px;">划词后约 0.35 秒自动轻量翻译；结果与缓存可在「查询记录」回看。</div>

  <div class="note">
    Sensebook 的 Base URL 是 OpenAI 兼容的 <strong>/v1</strong> 根（例如 <code>https://api.deepseek.com/v1</code>），脚本会自动追加 <code>/chat/completions</code>，请勿填完整 completions 路径。
  </div>

  <div class="actions">
    <button type="button" class="primary" id="save">保存</button>
    <button type="button" class="secondary" id="test">测试连接</button>
    <button type="button" class="danger" id="clearKey">清除 Key</button>
    <button type="button" class="ghost" id="close">关闭</button>
  </div>
  <div class="test-status info" id="status"></div>
</div>
`;

    const $ = (id) => shadow.getElementById(id);
    const baseInput = $('base');
    const keyInput = $('key');
    const modelInput = $('model');
    const keyStatus = $('keyStatus');
    const statusEl = $('status');

    baseInput.value = baseVal;
    modelInput.value = modelVal;
    keyInput.value = curKey;
    keyStatus.textContent = '当前：' + maskApiKey(curKey);
    const autoQueryInput = $('autoQuery');
    if (autoQueryInput) autoQueryInput.checked = isAutoQueryEnabled();
    const card = shadow.querySelector('.card');
    card.addEventListener('click', (e) => e.stopPropagation());

    function setStatus(msg, kind) {
      statusEl.textContent = msg || '';
      statusEl.className = 'test-status ' + (kind || 'info');
    }

    function readForm() {
      return {
        base: baseInput.value.trim().replace(/\/$/, ''),
        key: keyInput.value.trim(),
        model: modelInput.value.trim(),
      };
    }

    $('toggleKey').onclick = () => {
      const show = keyInput.type === 'password';
      keyInput.type = show ? 'text' : 'password';
      $('toggleKey').textContent = show ? '隐藏' : '显示';
    };

    $('close').onclick = () => hideLlmSettingsPanel();
    host.addEventListener('click', (e) => {
      const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
      const trueTarget = path.length ? path[0] : e.target;
      if (trueTarget === host) hideLlmSettingsPanel();
    });

    $('save').onclick = () => {
      const { base, key, model } = readForm();
      storeSet(LLM_BASE_URL_KEY, base || DEFAULT_LLM_BASE_URL);
      storeSet(LLM_API_KEY_KEY, key);
      storeSet(LLM_MODEL_KEY, model || DEFAULT_LLM_MODEL);
      storeSet(ONBOARDING_DONE_KEY, true);
      if (autoQueryInput) setAutoQueryEnabled(!!autoQueryInput.checked);
      updateFabState();
      // Reflect defaults in fields if user cleared
      if (!base) baseInput.value = DEFAULT_LLM_BASE_URL;
      if (!model) modelInput.value = DEFAULT_LLM_MODEL;
      keyStatus.textContent = '当前：' + maskApiKey(key);
      setStatus('已保存（本机）。' + (key ? '可用「测试连接」验证。' : '未填 Key 时 AI 释义仍用本地 stub。'), 'ok');
      toast(key ? 'DeepSeek LLM 设置已保存' : '已保存（无 Key，将使用 stub）');
    };

    $('clearKey').onclick = () => {
      storeSet(LLM_API_KEY_KEY, '');
      updateFabState();
      keyInput.value = '';
      keyStatus.textContent = '当前：' + maskApiKey('');
      setStatus('已清除 API Key（Base URL / 模型保留）', 'ok');
      toast('已清除 LLM API Key（本地词库不受影响）');
    };

    $('test').onclick = async () => {
      const { base, key, model } = readForm();
      const useBase = (base || DEFAULT_LLM_BASE_URL).replace(/\/$/, '');
      const useModel = model || DEFAULT_LLM_MODEL;
      if (!key) {
        setStatus('请先填写 API Key 再测试。', 'err');
        return;
      }
      setStatus('正在测试连接…', 'info');
      $('test').disabled = true;
      try {
        const url = useBase + '/chat/completions';
        const res = await gmRequest(url, {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + key },
          body: {
            model: useModel,
            temperature: 0,
            max_tokens: 8,
            messages: [{ role: 'user', content: 'ping' }],
          },
        });
        if (res.status >= 200 && res.status < 300) {
          const reply = res.data?.choices?.[0]?.message?.content;
          setStatus(
            '连接成功（HTTP ' + res.status + '）。模型：' + useModel +
              (reply ? '\n回复片段：' + String(reply).slice(0, 80) : ''),
            'ok'
          );
        } else if (res.status === 401 || res.status === 403) {
          const detail =
            (res.data && (res.data.error?.message || res.data.error || res.data.message)) || '';
          setStatus(
            '鉴权失败（HTTP ' + res.status + '）。请检查 API Key。' +
              (detail ? '\n' + String(detail).slice(0, 160) : ''),
            'err'
          );
        } else {
          const detail =
            (res.data && (res.data.error?.message || res.data.error || res.data.message)) ||
            (res.raw || '').slice(0, 160);
          setStatus('请求失败（HTTP ' + res.status + '）。' + (detail ? '\n' + String(detail) : ''), 'err');
        }
      } catch (err) {
        setStatus('网络错误：' + (err.message || String(err)) + '\n请检查 Base URL 与油猴 @connect。', 'err');
      } finally {
        $('test').disabled = false;
      }
    };

    document.documentElement.appendChild(host);
    llmPanelHost = host;
    keyInput.focus();
  }


  function formatTimeShort(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return String(iso).slice(0, 19);
      const pad = (n) => String(n).padStart(2, '0');
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
        ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    } catch {
      return String(iso).slice(0, 19);
    }
  }

  function showQueryHistoryPanel(filterText) {
    hidePanel();
    const q = String(filterText || '').trim().toLowerCase();
    let entries = loadQueryCache();
    if (q) {
      entries = entries.filter((e) => String(e.word || '').toLowerCase().includes(q));
    }
    panel = document.createElement('div');
    panel.id = 'sensebook-panel';
    Object.assign(panel.style, {
      position: 'fixed',
      top: '0',
      right: '0',
      width: 'min(400px, 100vw)',
      height: '100vh',
      zIndex: '2147483646',
      background: '#f8fafc',
      boxShadow: '-4px 0 24px rgba(0,0,0,.2)',
      fontFamily: 'system-ui,sans-serif',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    });

    const header = document.createElement('div');
    Object.assign(header.style, {
      padding: '14px 16px',
      borderBottom: '1px solid #e2e8f0',
      background: '#fff',
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
      flexShrink: '0',
    });
    header.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
      <div>
        <div style="font-weight:700;font-size:16px;">查询记录</div>
        <div style="font-size:12px;color:#64748b;margin-top:2px;">本地缓存 · 最多 ${QUERY_CACHE_CAP} 条 · 当前 ${entries.length} 条</div>
      </div>
    </div>`;

    const toolbar = document.createElement('div');
    Object.assign(toolbar.style, {
      display: 'flex',
      gap: '6px',
      flexWrap: 'wrap',
      alignItems: 'center',
    });
    const search = document.createElement('input');
    search.type = 'search';
    search.placeholder = '按单词过滤…';
    search.value = filterText || '';
    Object.assign(search.style, {
      flex: '1',
      minWidth: '120px',
      minHeight: '40px',
      padding: '8px 10px',
      border: '1px solid #cbd5e1',
      borderRadius: '8px',
      fontSize: '14px',
      boxSizing: 'border-box',
    });
    const goBtn = document.createElement('button');
    goBtn.type = 'button';
    goBtn.textContent = '搜索';
    Object.assign(goBtn.style, {
      minHeight: '40px',
      padding: '8px 12px',
      border: 'none',
      borderRadius: '8px',
      background: '#2563eb',
      color: '#fff',
      cursor: 'pointer',
      fontSize: '13px',
    });
    goBtn.onclick = () => showQueryHistoryPanel(search.value);
    search.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') showQueryHistoryPanel(search.value);
    });

    const vocabBtn = document.createElement('button');
    vocabBtn.type = 'button';
    vocabBtn.textContent = '生词本';
    Object.assign(vocabBtn.style, {
      minHeight: '40px',
      padding: '8px 10px',
      border: 'none',
      borderRadius: '8px',
      background: '#0f766e',
      color: '#fff',
      cursor: 'pointer',
      fontSize: '13px',
    });
    vocabBtn.onclick = () => showLocalPanel();

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = '关闭';
    Object.assign(closeBtn.style, {
      minHeight: '40px',
      padding: '8px 12px',
      border: 'none',
      borderRadius: '8px',
      background: '#64748b',
      color: '#fff',
      cursor: 'pointer',
      fontSize: '14px',
    });
    closeBtn.onclick = () => hidePanel();

    toolbar.appendChild(search);
    toolbar.appendChild(goBtn);
    toolbar.appendChild(vocabBtn);
    toolbar.appendChild(closeBtn);
    header.appendChild(toolbar);
    panel.appendChild(header);

    const body = document.createElement('div');
    Object.assign(body.style, {
      overflow: 'auto',
      padding: '12px',
      flex: '1',
    });

    if (!entries.length) {
      body.innerHTML = '<div style="padding:16px;color:#64748b;font-size:14px;">暂无查询记录。划词自动查询或点「翻译」后会出现在这里。</div>';
    } else {
      body.innerHTML = entries.map((e) => {
        const snippet = escapeHtml(String(e.translation || e.ai_word_sense || '').slice(0, 80));
        return `
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:12px;margin-bottom:10px;cursor:pointer;" data-cache-id="${escapeHtml(e.id)}">
          <div style="font-weight:700;font-size:15px;">${escapeHtml(e.word)}</div>
          <div style="margin:6px 0;color:#475569;font-size:13px;">${snippet || '（无译文）'}</div>
          <div style="font-size:11px;color:#94a3b8;">${escapeHtml(formatTimeShort(e.updated_at || e.created_at))}</div>
        </div>`;
      }).join('');
    }
    panel.appendChild(body);

    body.addEventListener('click', (ev) => {
      let node = ev.target;
      while (node && node !== body && !(node.getAttribute && node.getAttribute('data-cache-id'))) {
        node = node.parentElement;
      }
      if (!node || node === body) return;
      const id = node.getAttribute('data-cache-id');
      const rec = loadQueryCache().find((x) => x.id === id);
      if (rec) showQueryDetail(rec);
    });

    document.documentElement.appendChild(panel);
  }

  function showQueryDetail(rec) {
    hidePanel();
    panel = document.createElement('div');
    panel.id = 'sensebook-panel';
    Object.assign(panel.style, {
      position: 'fixed',
      top: '0',
      right: '0',
      width: 'min(400px, 100vw)',
      height: '100vh',
      zIndex: '2147483646',
      background: '#f8fafc',
      boxShadow: '-4px 0 24px rgba(0,0,0,.2)',
      fontFamily: 'system-ui,sans-serif',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    });

    const header = document.createElement('div');
    Object.assign(header.style, {
      padding: '14px 16px',
      borderBottom: '1px solid #e2e8f0',
      background: '#fff',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: '8px',
      flexShrink: '0',
    });
    header.innerHTML = `<div>
      <div style="font-weight:700;font-size:16px;">${escapeHtml(rec.word)}</div>
      <div style="font-size:12px;color:#64748b;margin-top:2px;">查询详情 · ${escapeHtml(formatTimeShort(rec.updated_at || rec.created_at))}</div>
    </div>`;
    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.textContent = '返回';
    Object.assign(backBtn.style, {
      minHeight: '40px',
      padding: '8px 12px',
      border: 'none',
      borderRadius: '8px',
      background: '#64748b',
      color: '#fff',
      cursor: 'pointer',
      fontSize: '14px',
    });
    backBtn.onclick = () => showQueryHistoryPanel();
    header.appendChild(backBtn);
    panel.appendChild(header);

    const body = document.createElement('div');
    Object.assign(body.style, { overflow: 'auto', padding: '12px', flex: '1' });
    body.innerHTML = `
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px;">
        <div style="font-size:13px;color:#64748b;margin-bottom:4px;">句子</div>
        <div style="font-size:14px;color:#334155;margin-bottom:12px;white-space:pre-wrap;">${escapeHtml(rec.sentence || '')}</div>
        <div style="font-size:13px;color:#64748b;margin-bottom:4px;">翻译</div>
        <div style="font-size:14px;color:#0f172a;margin-bottom:12px;white-space:pre-wrap;">${escapeHtml(rec.translation || '（无）')}</div>
        ${rec.ai_word_sense ? `<div style="font-size:13px;color:#64748b;margin-bottom:4px;">词义</div><div style="font-size:14px;margin-bottom:12px;white-space:pre-wrap;">${escapeHtml(rec.ai_word_sense)}</div>` : ''}
        ${rec.ai_sentence_gloss ? `<div style="font-size:13px;color:#64748b;margin-bottom:4px;">句意</div><div style="font-size:14px;margin-bottom:12px;white-space:pre-wrap;">${escapeHtml(rec.ai_sentence_gloss)}</div>` : ''}
        <div style="font-size:11px;color:#94a3b8;word-break:break-all;">${escapeHtml(rec.source_url || '')}</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">
        <button type="button" data-act="save" style="min-height:44px;padding:10px 14px;border:none;border-radius:8px;background:#2563eb;color:#fff;cursor:pointer;font-size:14px;">存词</button>
        <button type="button" data-act="requery" style="min-height:44px;padding:10px 14px;border:none;border-radius:8px;background:#7c3aed;color:#fff;cursor:pointer;font-size:14px;">再查一次</button>
      </div>
    `;
    panel.appendChild(body);

    body.addEventListener('click', async (ev) => {
      const act = ev.target && ev.target.getAttribute && ev.target.getAttribute('data-act');
      if (act === 'save') {
        createLocalEntry({
          word: rec.word,
          sentence: rec.sentence || rec.word,
          source_url: rec.source_url || location.href,
          status: (rec.ai_word_sense || rec.ai_sentence_gloss) ? 'ready' : 'pending_ai',
        });
        // If senses exist, patch the newest entry
        if (rec.ai_word_sense || rec.ai_sentence_gloss) {
          const list = loadEntries();
          if (list[0] && list[0].word === rec.word) {
            patchLocalEntry(list[0].id, {
              ai_word_sense: rec.ai_word_sense || null,
              ai_sentence_gloss: rec.ai_sentence_gloss || null,
              status: 'ready',
            });
          }
        }
        toast('已存入生词本：' + rec.word);
        return;
      }
      if (act === 'requery') {
        if (!hasLlmConfig()) {
          toast('请先配置 DeepSeek');
          showLlmSettingsPanel();
          return;
        }
        toast('重新查询中…');
        try {
          const { record } = await runTranslateLookup({
            word: rec.word,
            sentence: rec.sentence || rec.word,
            source_url: rec.source_url || location.href,
            forceRefresh: true,
          });
          toast('已更新缓存');
          showQueryDetail(record);
        } catch (e) {
          toast('再查失败：' + (e.message || String(e)));
        }
      }
    });

    document.documentElement.appendChild(panel);
  }

    function showLocalPanel() {
    hidePanel();
    const entries = loadEntries();
    panel = document.createElement('div');
    panel.id = 'sensebook-panel';
    Object.assign(panel.style, {
      position: 'fixed',
      top: '0',
      right: '0',
      width: 'min(400px, 100vw)',
      height: '100vh',
      zIndex: '2147483646',
      background: '#f8fafc',
      boxShadow: '-4px 0 24px rgba(0,0,0,.2)',
      fontFamily: 'system-ui,sans-serif',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    });

    const header = document.createElement('div');
    Object.assign(header.style, {
      padding: '14px 16px',
      borderBottom: '1px solid #e2e8f0',
      background: '#fff',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: '8px',
      flexShrink: '0',
    });
    const llmHint = hasLlmConfig() ? 'LLM 已配置' : '未配置 LLM Key';
    header.innerHTML = `<div>
      <div style="font-weight:700;font-size:16px;">我的生词（本地）</div>
      <div style="font-size:12px;color:#64748b;margin-top:2px;">无需登录 · ${llmHint} · 共 ${entries.length} 条</div>
    </div>`;
    const headerActions = document.createElement('div');
    Object.assign(headerActions.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: '6px',
      flexWrap: 'wrap',
      flexShrink: '0',
    });
    const configBtn = document.createElement('button');
    configBtn.type = 'button';
    configBtn.textContent = '配置 DeepSeek';
    Object.assign(configBtn.style, {
      minHeight: '40px',
      padding: '8px 10px',
      border: 'none',
      borderRadius: '8px',
      background: '#7c3aed',
      color: '#fff',
      cursor: 'pointer',
      fontSize: '13px',
      whiteSpace: 'nowrap',
      touchAction: 'manipulation',
    });
    configBtn.onclick = () => showLlmSettingsPanel();
    headerActions.appendChild(configBtn);

    const histBtn = document.createElement('button');
    histBtn.type = 'button';
    histBtn.textContent = '查询记录';
    Object.assign(histBtn.style, {
      minHeight: '40px',
      padding: '8px 10px',
      border: 'none',
      borderRadius: '8px',
      background: '#2563eb',
      color: '#fff',
      cursor: 'pointer',
      fontSize: '13px',
      whiteSpace: 'nowrap',
      touchAction: 'manipulation',
    });
    histBtn.onclick = () => showQueryHistoryPanel();
    headerActions.appendChild(histBtn);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = '关闭';
    Object.assign(closeBtn.style, {
      minHeight: '40px',
      padding: '8px 12px',
      border: 'none',
      borderRadius: '8px',
      background: '#64748b',
      color: '#fff',
      cursor: 'pointer',
      fontSize: '14px',
      touchAction: 'manipulation',
    });
    closeBtn.onclick = () => hidePanel();
    headerActions.appendChild(closeBtn);
    header.appendChild(headerActions);
    panel.appendChild(header);

    const body = document.createElement('div');
    Object.assign(body.style, {
      overflow: 'auto',
      padding: '12px',
      flex: '1',
    });

    if (!entries.length) {
      body.innerHTML = '<div style="padding:16px;color:#64748b;font-size:14px;">暂无本地词条。划词后点「存词」即可保存到本机。</div>';
    } else {
      body.innerHTML = entries.map((e) => `
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:12px;margin-bottom:10px;" data-id="${escapeHtml(e.id)}">
          <div style="font-weight:700;font-size:15px;">${escapeHtml(e.word)}
            <span style="font-size:11px;padding:2px 6px;border-radius:999px;background:#e2e8f0;font-weight:500;margin-left:6px;">${escapeHtml(e.status || '')}</span>
          </div>
          <div style="margin:6px 0;color:#334155;font-size:13px;">${escapeHtml(e.sentence)}</div>
          ${e.ai_word_sense ? `<div style="font-size:12px;color:#475569;margin-top:4px;"><strong>词义：</strong>${escapeHtml(e.ai_word_sense)}</div>` : ''}
          ${e.ai_sentence_gloss ? `<div style="font-size:12px;color:#475569;margin-top:4px;"><strong>句意：</strong>${escapeHtml(e.ai_sentence_gloss)}</div>` : ''}
          <div style="font-size:11px;color:#94a3b8;margin-top:8px;">${escapeHtml(e.created_at || '')}</div>
          <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">
            <button type="button" data-enrich-local="${escapeHtml(e.id)}" style="min-height:36px;padding:6px 10px;border:none;border-radius:8px;background:#7c3aed;color:#fff;cursor:pointer;font-size:13px;">AI 释义</button>
            <button type="button" data-del-local="${escapeHtml(e.id)}" style="min-height:36px;padding:6px 10px;border:none;border-radius:8px;background:#dc2626;color:#fff;cursor:pointer;font-size:13px;">删除</button>
          </div>
        </div>
      `).join('');
    }
    panel.appendChild(body);

    body.addEventListener('click', async (ev) => {
      const enrichId = ev.target.getAttribute && ev.target.getAttribute('data-enrich-local');
      const delId = ev.target.getAttribute && ev.target.getAttribute('data-del-local');
      if (enrichId) {
        if (busy) return;
        const list = loadEntries();
        const idx = list.findIndex((x) => x.id === enrichId);
        if (idx < 0) return;
        const entry = list[idx];
        busy = true;
        toast('AI 释义中…');
        try {
          const result = await enrichLocalEntry(entry);
          patchLocalEntry(enrichId, {
            ai_sentence_gloss: result.ai_sentence_gloss,
            ai_word_sense: result.ai_word_sense,
            status: 'ready',
          });
          toast(result.stub ? '已生成本地 stub 释义' : 'AI 释义完成');
          // optional server mirror
          if (hasOptionalApi() && !result.stub) {
            optionalServerEnrich({ ...entry, ...result }).catch(() => {});
          }
        } catch (err) {
          patchLocalEntry(enrichId, { status: 'failed' });
          toast('AI 释义失败：' + (err.message || String(err)));
        } finally {
          busy = false;
          showLocalPanel();
        }
      }
      if (delId) {
        if (!confirm('确认删除该本地词条？')) return;
        saveEntries(loadEntries().filter((x) => x.id !== delId));
        toast('已删除');
        showLocalPanel();
      }
    });

    document.documentElement.appendChild(panel);
  }

  function gmFetch(url, { method = 'GET', body, headers = {} } = {}) {
    return new Promise((resolve, reject) => {
      gmXhr({
        method,
        url,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        data: body ? JSON.stringify(body) : undefined,
        onload: (res) => {
          let data = {};
          try { data = JSON.parse(res.responseText); } catch { /* ignore */ }
          if (res.status >= 200 && res.status < 300) resolve({ data, status: res.status, raw: res.responseText });
          else {
            const err = new Error(
              (data && (data.error || data.message)) ||
                `HTTP ${res.status}`
            );
            err.status = res.status;
            err.data = data;
            err.raw = res.responseText;
            reject(err);
          }
        },
        onerror: () => reject(new Error('网络错误，请检查地址与 @connect')),
      });
    });
  }

  /** Raw GM request that returns status even for error codes (for retry logic). */
  function gmRequest(url, { method = 'GET', body, headers = {} } = {}) {
    return new Promise((resolve, reject) => {
      gmXhr({
        method,
        url,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        data: body ? JSON.stringify(body) : undefined,
        onload: (res) => {
          let data = null;
          try { data = JSON.parse(res.responseText); } catch { /* ignore */ }
          resolve({ status: res.status, data, raw: res.responseText });
        },
        onerror: () => reject(new Error('网络错误，请检查 LLM Base URL 与 @connect')),
      });
    });
  }

  function authHeaders() {
    const t = getToken();
    if (!t) throw new Error('未配置 Token');
    return { Authorization: 'Bearer ' + t };
  }

  /**
   * Call OpenAI-compatible /chat/completions via GM_xmlhttpRequest.
   * Prefer response_format json_object; retry without if provider rejects.
   */
  async function callLlmChatCompletions(messages, parseContent = parseEnrichJson, { jsonResponse = true } = {}) {
    const base = getLlmBaseUrl();
    const key = getLlmApiKey();
    const model = getLlmModel();
    if (!key) throw new Error('未配置 LLM API Key');
    if (!base) throw new Error('未配置 LLM Base URL');

    const url = base + '/chat/completions';
    const headers = { Authorization: 'Bearer ' + key };
    const body = {
      model,
      temperature: 0.2,
      ...(jsonResponse ? { response_format: { type: 'json_object' } } : {}),
      messages,
    };

    let res = await gmRequest(url, { method: 'POST', headers, body });

    // Some providers reject response_format — retry without
    if (jsonResponse && res.status >= 400) {
      const errText = (res.raw || '') + JSON.stringify(res.data || {});
      const formatRejected =
        /response_format|json_object|unsupported|unknown.?param|invalid/i.test(errText);
      if (formatRejected || res.status === 400) {
        const bodyNoFormat = {
          model,
          temperature: 0.2,
          messages,
        };
        res = await gmRequest(url, { method: 'POST', headers, body: bodyNoFormat });
      }
    }

    if (res.status < 200 || res.status >= 300) {
      const msg =
        (res.data && (res.data.error?.message || res.data.error || res.data.message)) ||
        `LLM HTTP ${res.status}`;
      throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg).slice(0, 200));
    }

    const content = res.data?.choices?.[0]?.message?.content;
    return parseContent(content);
  }

  async function callLlmEnrich({ word, sentence, source_url }) {
    return callLlmChatCompletions([
      { role: 'system', content: ENRICH_SYSTEM_PROMPT },
      { role: 'user', content: buildEnrichUserPrompt({ word, sentence, source_url }) },
    ]);
  }


  async function callLlmTranslate(text) {
    return callLlmChatCompletions([
      { role: 'system', content: '你是简洁、准确的中文翻译助手。只输出中文译文，不要解释。' },
      { role: 'user', content: `请将下面文本翻译成自然的中文：\n${text}` },
    ], parseTranslationContent, { jsonResponse: false });
  }

  /** Enrich one entry: real LLM if key set, else stub. */
  async function enrichLocalEntry(entry) {
    if (!hasLlmConfig()) {
      const stub = clientStubEnrich(entry.word, entry.sentence);
      return { ...stub, stub: true };
    }
    const result = await callLlmEnrich({
      word: entry.word,
      sentence: entry.sentence,
      source_url: entry.source_url,
    });
    return { ...result, stub: false };
  }

  async function optionalServerEnrich(entry) {
    try {
      const createdRes = await gmFetch(getApiUrl() + '/entries', {
        method: 'POST',
        headers: authHeaders(),
        body: {
          word: entry.word,
          sentence: entry.sentence,
          source_url: entry.source_url,
          ai_sentence_gloss: entry.ai_sentence_gloss,
          ai_word_sense: entry.ai_word_sense,
          status: entry.status || 'ready',
        },
      });
      const created = createdRes.data;
      if (created && created.id && !(entry.ai_sentence_gloss && entry.ai_word_sense)) {
        const enrichedRes = await gmFetch(getApiUrl() + '/entries/' + created.id + '/enrich', {
          method: 'POST',
          headers: authHeaders(),
          body: {},
        });
        const enriched = enrichedRes.data;
        const ent = enriched.entry || enriched;
        return {
          ai_sentence_gloss: ent.ai_sentence_gloss || created.ai_sentence_gloss,
          ai_word_sense: ent.ai_word_sense || created.ai_word_sense,
        };
      }
      return {
        ai_sentence_gloss: entry.ai_sentence_gloss || created.ai_sentence_gloss,
        ai_word_sense: entry.ai_word_sense || created.ai_word_sense,
      };
    } catch {
      return null;
    }
  }

  function formatCacheResult(rec) {
    if (!rec) return '';
    const parts = [];
    if (rec.translation) parts.push(rec.translation);
    if (rec.ai_word_sense) parts.push('词义：' + rec.ai_word_sense);
    if (rec.ai_sentence_gloss) parts.push('句意：' + rec.ai_sentence_gloss);
    return parts.join('\n') || '';
  }

  /**
   * Lightweight translate lookup with cache + in-flight dedupe.
   * Does not set global busy. Caller must check selectionGen / reqId for stale.
   */
  async function runTranslateLookup({ word, sentence, source_url, forceRefresh }) {
    const text = word || sentence;
    if (!text) throw new Error('没有可翻译文本');
    const cacheKey = makeCacheKey(word, sentence);
    if (!forceRefresh) {
      const hit = getCachedByKey(cacheKey);
      if (hit && hit.translation) {
        return { record: hit, fromCache: true };
      }
    }
    if (!forceRefresh && inFlightByCacheKey.has(cacheKey)) {
      const record = await inFlightByCacheKey.get(cacheKey);
      return { record, fromCache: false, piggyback: true };
    }

    const work = (async () => {
      let translation = '';
      if (hasLlmConfig()) {
        translation = await callLlmTranslate(text);
      } else if (hasOptionalApi()) {
        try {
          const { data } = await gmFetch(getApiUrl() + '/translate', {
            method: 'POST',
            headers: authHeaders(),
            body: { text },
          });
          translation = data.translation || '';
        } catch (e) {
          translation = clientStubTranslate(text);
        }
      } else {
        translation = clientStubTranslate(text);
      }
      return upsertQueryCache({
        word,
        sentence: sentence || word,
        translation: translation || '',
        source_url: source_url || location.href,
        cacheKey,
      });
    })();

    inFlightByCacheKey.set(cacheKey, work);
    try {
      const record = await work;
      return { record, fromCache: false };
    } finally {
      inFlightByCacheKey.delete(cacheKey);
    }
  }

  async function doTranslate(opts) {
    const forceRefresh = !!(opts && opts.forceRefresh);
    const word = lastSel.text;
    const sentence = lastSel.sentence || lastSel.text;
    const reqId = selectionGen;
    const text = word || sentence;
    if (!text) {
      resetPopupResultSlots();
      setPopupResult('没有可翻译文本', 'error');
      return;
    }

    const short = isShortWordToken(word);
    let localHit = null;
    if (short) {
      await ensureLocalDict();
      if (reqId !== selectionGen) return;
      localHit = lookupLocalDictSync(word);
      if (localHit) setLocalDictRow(localHit.gloss);
      else setLocalDictRow(null);
    } else {
      setLocalDictRow(null);
    }

    if (!hasLlmConfig() && !hasOptionalApi()) {
      if (localHit) {
        // Local-only OK; light hint for model
        setModelRow('已显示本地词库；配置 DeepSeek 后可并行补全', 'hint');
      } else {
        const stub = clientStubTranslate(text);
        setPopupResult(stub, 'hint');
        toast('请先配置 DeepSeek');
      }
      return;
    }

    if (!forceRefresh) {
      const hit = getCachedByKey(makeCacheKey(word, sentence));
      if (hit && hit.translation) {
        setModelRow(formatCacheResult(hit) || hit.translation || '', 'cache');
      } else {
        setModelRow('查询中…', 'loading');
      }
    } else {
      setModelRow('查询中…', 'loading');
    }

    try {
      const { record, fromCache } = await runTranslateLookup({
        word,
        sentence,
        source_url: location.href,
        forceRefresh,
      });
      if (reqId !== selectionGen) return; // stale
      const body = formatCacheResult(record) || '(空)';
      setModelRow(body, fromCache ? 'cache' : 'ok');
    } catch (e) {
      if (reqId !== selectionGen) return;
      if (localHit) {
        setModelRow('模型失败：' + (e.message || String(e)), 'error');
      } else {
        setModelRow('翻译失败：' + (e.message || String(e)), 'error');
      }
    }
  }

  function scheduleAutoQuery(reqId) {
    if (autoQueryTimer) {
      clearTimeout(autoQueryTimer);
      autoQueryTimer = null;
    }
    if (!isAutoQueryEnabled()) return;
    const word = lastSel.text;
    const sentence = lastSel.sentence || lastSel.text;
    if (!word) return;

    const short = isShortWordToken(word);

    // Kick local dict immediately for short tokens (dual-out path).
    const localReady = (async () => {
      if (!short) return null;
      await ensureLocalDict();
      if (reqId !== selectionGen) return null;
      const hit = lookupLocalDictSync(word);
      if (hit) setLocalDictRow(hit.gloss);
      return hit;
    })();

    const cacheKey = makeCacheKey(word, sentence);
    const cacheHit = getCachedByKey(cacheKey);

    autoQueryTimer = setTimeout(async () => {
      autoQueryTimer = null;
      if (reqId !== selectionGen) return;

      let localHit = null;
      try {
        localHit = await localReady;
      } catch { /* ignore */ }
      if (reqId !== selectionGen) return;

      if (cacheHit && cacheHit.translation) {
        setModelRow(formatCacheResult(cacheHit), 'cache');
        // Still keep local row if present; no forced network refresh.
        return;
      }

      if (!hasLlmConfig()) {
        if (localHit) {
          setModelRow('本地词库已命中；配置 DeepSeek 后可并行显示模型释义', 'hint');
        } else {
          setModelRow('已配置自动查询，请先点「配置 DeepSeek」填写 API Key', 'hint');
        }
        return;
      }

      setModelRow('查询中…', 'loading');
      try {
        const { record, fromCache } = await runTranslateLookup({
          word,
          sentence,
          source_url: location.href,
          forceRefresh: false,
        });
        if (reqId !== selectionGen) return;
        const body = formatCacheResult(record) || '(空)';
        setModelRow(body, fromCache ? 'cache' : 'ok');
        if (lastSel.rect) repositionPopup(lastSel.rect);
      } catch (e) {
        if (reqId !== selectionGen) return;
        if (localHit) {
          setModelRow('模型失败：' + (e.message || String(e)), 'error');
        } else {
          setModelRow('自动查询失败：' + (e.message || String(e)), 'error');
        }
      }
    }, AUTO_QUERY_DEBOUNCE_MS);
  }

  async function doSave(enrich) {
    if (busy) return;
    try {
      const word = lastSel.text;
      const sentence = lastSel.sentence || lastSel.text;
      const source_url = location.href;

      if (!enrich) {
        const entry = createLocalEntry({
          word,
          sentence,
          source_url,
          status: 'pending_ai',
        });
        if (hasOptionalApi()) {
          try {
            await gmFetch(getApiUrl() + '/entries', {
              method: 'POST',
              headers: authHeaders(),
              body: { word: entry.word, sentence: entry.sentence, source_url: entry.source_url },
            });
            toast('已本地存词（并已可选同步）：' + entry.word);
          } catch (syncErr) {
            toast('已本地存词（同步失败：' + syncErr.message + '）：' + entry.word);
          }
        } else {
          toast('已本地存词：' + entry.word);
        }
        hidePopup();
        return;
      }

      // AI 释义 path
      const reqId = selectionGen;
      busy = true;
      setPopupLoading(hasLlmConfig() ? 'AI 释义中…' : '生成 stub 释义…');

      const entry = createLocalEntry({
        word,
        sentence,
        source_url,
        status: 'pending_ai',
      });

      try {
        const result = await enrichLocalEntry(entry);
        patchLocalEntry(entry.id, {
          ai_sentence_gloss: result.ai_sentence_gloss,
          ai_word_sense: result.ai_word_sense,
          status: 'ready',
        });
        upsertQueryCache({
          word,
          sentence,
          source_url,
          ai_word_sense: result.ai_word_sense,
          ai_sentence_gloss: result.ai_sentence_gloss,
          translation: result.ai_word_sense || result.ai_sentence_gloss || '',
        });
        if (reqId === selectionGen && popup) {
          setPopupResult(formatCacheResult({
            translation: result.ai_word_sense || '',
            ai_word_sense: result.ai_word_sense,
            ai_sentence_gloss: result.ai_sentence_gloss,
          }), 'ok');
        }

        if (hasOptionalApi()) {
          try {
            await optionalServerEnrich({
              ...entry,
              ai_sentence_gloss: result.ai_sentence_gloss,
              ai_word_sense: result.ai_word_sense,
              status: 'ready',
            });
            toast(
              (result.stub ? '已本地 stub 释义并同步：' : '已 AI 释义并可选同步：') + entry.word
            );
          } catch (syncErr) {
            toast(
              (result.stub ? '已本地 stub 释义（同步失败）：' : '已 AI 释义（同步失败）：') +
                entry.word
            );
          }
        } else {
          toast(
            (result.stub
              ? '已本地存词并生成 stub 释义（请先点「配置 DeepSeek」填写 API Key）：'
              : '已本地存词并 AI 释义：') + entry.word
          );
        }
      } catch (llmErr) {
        patchLocalEntry(entry.id, { status: 'failed' });
        toast('已存词，但 AI 释义失败：' + (llmErr.message || String(llmErr)));
      } finally {
        busy = false;
        hidePopup();
      }
    } catch (e) {
      busy = false;
      toast(e.message || '存词失败');
      hidePopup();
    }
  }

  function onSelectionChange() {
    // Do not gate on busy — auto-query / parallel lookups must allow new selection
    // (stale responses discarded via selectionGen).
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
      return;
    }
    const text = sel.toString().trim();
    if (!text || text.length > 200) {
      hidePopup();
      return;
    }
    // Ignore selections inside Sensebook UI
    try {
      const node = sel.anchorNode;
      const el = node && (node.nodeType === 3 ? node.parentElement : node);
      if (el && el.closest && el.closest('#sensebook-popup, #sensebook-panel, #sensebook-fab-root, #sensebook-llm-settings-host')) {
        return;
      }
    } catch { /* ignore */ }

    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) return;
    selectionGen += 1;
    const reqId = selectionGen;
    lastSel = {
      text,
      sentence: extractSentence(range),
      rect,
    };
    showPopup(rect);
    scheduleAutoQuery(reqId);
  }

  document.addEventListener('mouseup', () => {
    setTimeout(onSelectionChange, 10);
  });
  document.addEventListener('touchend', () => {
    setTimeout(onSelectionChange, 50);
  }, { passive: true });

  document.addEventListener('mousedown', (e) => {
    if (llmPanelHost && eventInsideLlmSettings(e)) return;
    if (popup && !popup.contains(e.target)) {
      // Allow dismissing popup even while a background request is in flight
      hidePopup();
      selectionGen += 1; // invalidate in-flight auto results for UI
    }
    if (panel && !panel.contains(e.target) && !(popup && popup.contains(e.target))) {
      /* keep panel open unless closed explicitly */
    }
  });
  document.addEventListener('scroll', () => {
    hidePopup();
    selectionGen += 1;
  }, true);

  function hideFabSheet() {
    if (fabSheet) {
      fabSheet.style.display = 'none';
      if (fabRoot) fabRoot.querySelector('[data-sensebook-fab]')?.setAttribute('aria-expanded', 'false');
    }
  }

  function showFabSheet() {
    if (!fabSheet) return;
    const opening = fabSheet.style.display === 'none';
    fabSheet.style.display = opening ? 'flex' : 'none';
    if (fabRoot) fabRoot.querySelector('[data-sensebook-fab]')?.setAttribute('aria-expanded', String(opening));
  }

  function setupFab() {
    // Re-attach path may reset fabRoot=null while a stale node is gone
    if (fabRoot && document.getElementById('sensebook-fab-root')) return;
    fabRoot = document.createElement('div');
    fabRoot.id = 'sensebook-fab-root';
    Object.assign(fabRoot.style, {
      position: 'fixed',
      right: '16px',
      bottom: '16px',
      zIndex: '2147483647',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-end',
      gap: '8px',
      fontFamily: 'system-ui,sans-serif',
      pointerEvents: 'auto',
    });

    fabSheet = document.createElement('div');
    fabSheet.id = 'sensebook-fab-sheet';
    Object.assign(fabSheet.style, {
      display: 'none',
      flexDirection: 'column',
      gap: '6px',
      width: '180px',
      padding: '8px',
      background: '#fff',
      border: '1px solid #e2e8f0',
      borderRadius: '12px',
      boxShadow: '0 6px 24px rgba(15,23,42,.22)',
    });

    const makeAction = (label, onClick, background) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      Object.assign(button.style, {
        minHeight: '44px',
        width: '100%',
        padding: '8px 10px',
        border: 'none',
        borderRadius: '8px',
        background,
        color: '#fff',
        fontSize: '13px',
        cursor: 'pointer',
        textAlign: 'left',
        touchAction: 'manipulation',
      });
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        hideFabSheet();
        setTimeout(onClick, 0);
      });
      return button;
    };
    fabSheet.appendChild(makeAction('DeepSeek 设置', showLlmSettingsPanel, '#7c3aed'));
    fabSheet.appendChild(makeAction('我的生词', showLocalPanel, '#0f766e'));
    fabSheet.appendChild(makeAction('查询记录', () => showQueryHistoryPanel(), '#2563eb'));
    fabSheet.appendChild(makeAction(
      isAutoQueryEnabled() ? '自动查询：开' : '自动查询：关',
      () => {
        setAutoQueryEnabled(!isAutoQueryEnabled());
        toast(isAutoQueryEnabled() ? '已开启选中自动查询' : '已关闭选中自动查询');
        // rebuild sheet labels next open
        try {
          if (fabSheet) {
            fabSheet.remove();
            fabSheet = null;
          }
          if (fabRoot) fabRoot.remove();
          fabRoot = null;
          fabButton = null;
          setupFab();
        } catch { /* ignore */ }
      },
      '#475569'
    ));

    fabButton = document.createElement('button');
    fabButton.type = 'button';
    fabButton.setAttribute('data-sensebook-fab', 'true');
    fabButton.setAttribute('aria-expanded', 'false');
    Object.assign(fabButton.style, {
      minWidth: '128px',
      minHeight: '52px',
      padding: '12px 18px',
      border: '2px solid #fff',
      borderRadius: '999px',
      background: '#7c3aed',
      color: '#fff',
      boxShadow: '0 6px 22px rgba(124,58,237,.55), 0 2px 8px rgba(0,0,0,.25)',
      fontSize: '15px',
      fontWeight: '800',
      letterSpacing: '0.02em',
      cursor: 'pointer',
      touchAction: 'manipulation',
    });
    fabButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (hasLlmConfig()) {
        showFabSheet();
      } else {
        showLlmSettingsPanel();
      }
    });
    updateFabState();

    fabRoot.appendChild(fabSheet);
    fabRoot.appendChild(fabButton);
    const mount = document.body || document.documentElement;
    if (mount) mount.appendChild(fabRoot);
  }

  function updateFabState() {
    if (!fabButton) return;
    const configured = hasLlmConfig();
    fabButton.textContent = configured ? 'Sensebook' : '配置 DeepSeek';
    fabButton.style.background = configured ? '#0f172a' : '#7c3aed';
    fabButton.setAttribute(
      'aria-label',
      configured ? '打开 Sensebook 快捷菜单' : '配置 DeepSeek API Key'
    );
    fabButton.title = configured ? '打开 Sensebook 快捷菜单' : '配置 DeepSeek API Key';
  }

  document.addEventListener('mousedown', (e) => {
    if (llmPanelHost && eventInsideLlmSettings(e)) return;
    if (fabSheet && fabSheet.style.display !== 'none' && fabRoot && !fabRoot.contains(e.target)) {
      hideFabSheet();
    }
  });

  function setupFabAndOnboarding() {
    try {
      setupFab();
    } catch (err) {
      sensebookAlertError(err);
      mountEmergencyFab();
      return;
    }
    if (onboardingScheduled) return;
    if (!hasLlmConfig() && !storeGet(ONBOARDING_DONE_KEY, false)) {
      onboardingScheduled = true;
      setTimeout(() => {
        try {
          if (hasLlmConfig() || storeGet(ONBOARDING_DONE_KEY, false)) return;
          showLlmSettingsPanel();
          toast('请配置 DeepSeek API Key');
        } catch (err) {
          sensebookAlertError(err);
        }
      }, 600);
    }
  }

  function registerSensebookMenus() {
    try {
      gmMenu('Sensebook：我的生词（本地）', () => {
        showLocalPanel();
      });
      gmMenu('Sensebook：查询记录', () => {
        showQueryHistoryPanel();
      });
      gmMenu('Sensebook：LLM 设置', () => {
        showLlmSettingsPanel();
      });
      gmMenu('Sensebook：登录/同步（可选）— API 地址', () => {
        const cur = getApiUrl();
        const v = prompt(
          '【可选】Sensebook API 地址\n本地模式无需填写。填写后用于可选同步/在线翻译。\n例如 http://127.0.0.1:8787',
          cur || 'http://127.0.0.1:8787'
        );
        if (v != null) storeSet(API_URL_KEY, v.trim());
      });
      gmMenu('Sensebook：登录/同步（可选）— Token', () => {
        const cur = getToken();
        const v = prompt(
          '【可选】JWT Token（网页登录后复制）\n本地存词不需要 Token。',
          cur
        );
        if (v != null) storeSet(TOKEN_KEY, v.trim());
      });
      gmMenu('Sensebook：清除可选 Token', () => {
        storeSet(TOKEN_KEY, '');
        toast('已清除 Token（本地词库不受影响）');
      });
      gmMenu('Sensebook：刷新本地词库', async () => {
        try {
          toast('正在下载本地词库…');
          const d = await ensureLocalDict({ forceRefresh: true });
          if (d && d.entries) toast('词库已刷新：' + getLocalDictStatusText());
          else toast('词库下载失败，已保留旧缓存（若有）');
        } catch (e) {
          toast('词库刷新失败：' + (e.message || e));
        }
      });
      gmMenu('Sensebook：清除本地词库缓存', () => {
        clearLocalDictCache();
        toast('已清除本地词库缓存（脚本 @version / 生词本不受影响）');
      });
      gmMenu('Sensebook：关于本地模式', () => {
        toast(
          (hasLlmConfig()
            ? '本地优先：存词在本机；已配置 DeepSeek，AI 释义将直连模型'
            : '默认本地优先：存词写入油猴存储。菜单「LLM 设置」填写 DeepSeek API Key 后可真实 AI 释义') +
            ' · ' + getLocalDictStatusText() +
            '（dict version 与脚本 @version 独立）'
        );
      });
    } catch (err) {
      // Menu registration must never prevent FAB from staying up
      try { console.warn('[Sensebook] menu registration failed', err); } catch { /* ignore */ }
    }
  }

  function ensureFabAttached() {
    try {
      if (!document.getElementById('sensebook-fab-root')) {
        fabRoot = null;
        fabSheet = null;
        fabButton = null;
        setupFab();
      }
    } catch (err) {
      sensebookAlertError(err);
      mountEmergencyFab();
    }
  }

  function startFabWatchdog() {
    try {
      setInterval(ensureFabAttached, 2000);
    } catch { /* ignore */ }
    try {
      const obs = new MutationObserver(() => {
        if (!document.getElementById('sensebook-fab-root')) {
          fabRoot = null;
          fabSheet = null;
          fabButton = null;
          try { setupFab(); } catch (err) {
            sensebookAlertError(err);
            mountEmergencyFab();
          }
        }
      });
      const root = document.documentElement || document.body;
      if (root) obs.observe(root, { childList: true, subtree: true });
    } catch { /* ignore */ }
  }

  // Boot order: FAB first (regardless of menus), then menus in try/catch
  setupFabAndOnboarding();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      ensureFabAttached();
      setupFabAndOnboarding();
    }, { once: true });
  }
  registerSensebookMenus();
  try { ensureLocalDict(); } catch { /* ignore */ }
  startFabWatchdog();

  // Expose parse helpers for optional page-console smoke (no export in userscript)
  try {
    window.__sensebookParseEnrichJson = parseEnrichJson;
    window.__sensebookBuildEnrichUserPrompt = buildEnrichUserPrompt;
  } catch { /* ignore */ }

  } catch (err) { // sensebook-main
    sensebookAlertError(err);
    mountEmergencyFab();
  }

})();
