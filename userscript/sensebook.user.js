// ==UserScript==
// @name         Sensebook 划词
// @namespace    https://github.com/veightz/sensebook
// @updateURL    https://raw.githubusercontent.com/veightz/sensebook/main/userscript/sensebook.user.js
// @downloadURL  https://raw.githubusercontent.com/veightz/sensebook/main/userscript/sensebook.user.js
// @version      0.1.202609170156
// @description  划词自动查询 / 翻译 / 加入生词本 / 存本并释义 — Sensebook（本地词库 + 模型双出）
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

  /** Prefer own enumerable keys without throwing on null/undefined. */
  function safeKeys(obj) {
    if (obj == null) return [];
    try {
      return Object.keys(obj);
    } catch {
      const out = [];
      try {
        for (const k in obj) {
          if (Object.prototype.hasOwnProperty.call(obj, k)) out.push(k);
        }
      } catch { /* ignore */ }
      return out;
    }
  }

  /**
   * Set inline styles without Object.assign(target) — page context may poison
   * Object.assign or leave el.style null; never throw "Cannot convert undefined or null to object".
   */
  function applyStyles(el, styles) {
    if (!el || !styles || typeof styles !== 'object') return;
    const keys = safeKeys(styles);
    const st = el.style;
    if (st != null) {
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        try {
          st[k] = styles[k];
        } catch { /* ignore individual prop */ }
      }
      return;
    }
    // Rare: el.style missing (poisoned createElement) — CSS text attribute fallback
    try {
      const parts = [];
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        const cssKey = String(k).replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
        parts.push(cssKey + ':' + styles[k]);
      }
      if (!parts.length || typeof el.setAttribute !== 'function') return;
      const prev = (typeof el.getAttribute === 'function' && el.getAttribute('style')) || '';
      el.setAttribute('style', (prev ? prev + ';' : '') + parts.join(';'));
    } catch { /* ignore */ }
  }

  function setStyleProp(el, key, val) {
    if (!el) return;
    try {
      if (el.style != null) {
        el.style[key] = val;
        return;
      }
    } catch { /* fall through */ }
    const o = {};
    o[key] = val;
    applyStyles(el, o);
  }

  function getStyleProp(el, key) {
    if (!el) return '';
    try {
      if (el.style != null && el.style[key] != null) return el.style[key];
    } catch { /* ignore */ }
    try {
      const raw = typeof el.getAttribute === 'function' ? el.getAttribute('style') : '';
      if (!raw) return '';
      const cssKey = String(key).replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
      const re = new RegExp('(?:^|;)\\s*' + cssKey.replace(/-/g, '\\-') + '\\s*:\\s*([^;]+)', 'i');
      const m = String(raw).match(re);
      return m ? m[1].trim() : '';
    } catch {
      return '';
    }
  }

  function sensebookAlertError(err, where) {
    try {
      const msg = (err && err.message) ? err.message : String(err);
      let loc = where ? String(where) : '';
      if (!loc) {
        try {
          const stack = (err && err.stack) ? String(err.stack) : '';
          const lines = stack.split('\n').map((l) => l.trim()).filter(Boolean);
          // skip the TypeError line itself; find first sensebook-ish or function frame
          for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            const m =
              line.match(/at\s+(?:async\s+)?([\w$.<]+)/) ||
              line.match(/([\w$.]+)\s*@/);
            if (m && m[1] && m[1] !== 'Object' && m[1] !== 'Array') {
              loc = m[1];
              break;
            }
          }
          if (!loc && lines[1]) loc = lines[1].slice(0, 80);
        } catch { /* ignore */ }
      }
      const detail = loc ? (msg + ' @' + loc) : msg;
      // Console-only: do not alert() — blocking modals disrupt page interaction.
      try { console.error('[Sensebook]', detail, err); } catch { /* ignore */ }
    } catch { /* ignore */ }
  }

  function mountEmergencyFab() {
    try {
      if (document.getElementById('sensebook-fab-root')) return;
      const root = document.createElement('div');
      root.id = 'sensebook-fab-root';
      applyStyles(root, {
        position: 'fixed',
        right: '16px',
        bottom: '16px',
        zIndex: '2147483647',
      });
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Sensebook 设置';
      applyStyles(btn, {
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
          else console.warn('[Sensebook] 请在油猴菜单打开 DeepSeek 设置');
        } catch (e) {
          console.error('[Sensebook]', (e && e.message) || e, e);
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
  const LLM_THINKING_KEY = 'sensebook_llm_thinking';
  const ONBOARDING_DONE_KEY = 'sensebook_onboarding_done';
  const FAB_POS_KEY = 'sensebook_fab_pos';
  const AUTO_QUERY_KEY = 'sensebook_auto_query';
  const AUTO_QUERY_MODE_KEY = 'sensebook_auto_query_mode';
  const AUTO_SAVE_VOCAB_KEY = 'sensebook_auto_save_vocab';
  const AUTO_QUERY_MODE_TRANSLATE = 'translate';
  const AUTO_QUERY_MODE_SENSE = 'sense';
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
  function coerceStoreValue(v) {
    // GM backends sometimes return JSON strings for objects we stored as objects.
    if (typeof v === 'string') {
      const s = v.trim();
      if (
        (s.startsWith('{') && s.endsWith('}')) ||
        (s.startsWith('[') && s.endsWith(']')) ||
        s === 'null' ||
        s === 'true' ||
        s === 'false' ||
        /^-?\d+(\.\d+)?$/.test(s)
      ) {
        try { return JSON.parse(s); } catch { return v; }
      }
    }
    return v;
  }

  function storeGet(key, def) {
    try {
      const v = gmGet(key, undefined);
      if (v !== undefined && v !== null) return coerceStoreValue(v);
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

  /** DeepSeek-style thinking for chat/completions; default OFF (speed/cost). */
  function isLlmThinkingEnabled() {
    const v = storeGet(LLM_THINKING_KEY, false);
    return v === true || v === 'true' || v === 1;
  }

  /** Fields merged into every Sensebook chat/completions body (incl. retries). */
  function llmThinkingBodyFields() {
    if (isLlmThinkingEnabled()) {
      return {
        thinking: { type: 'enabled' },
        reasoning_effort: 'high',
      };
    }
    return { thinking: { type: 'disabled' } };
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

  /** Auto-query mode: 'translate' | 'sense'. Default 语境释义 (sense). */
  function getAutoQueryMode() {
    const v = storeGet(AUTO_QUERY_MODE_KEY, AUTO_QUERY_MODE_SENSE);
    if (v === AUTO_QUERY_MODE_TRANSLATE || v === '翻译') return AUTO_QUERY_MODE_TRANSLATE;
    return AUTO_QUERY_MODE_SENSE;
  }

  function setAutoQueryMode(mode) {
    storeSet(
      AUTO_QUERY_MODE_KEY,
      mode === AUTO_QUERY_MODE_TRANSLATE ? AUTO_QUERY_MODE_TRANSLATE : AUTO_QUERY_MODE_SENSE
    );
  }

  /** When auto-query runs, optionally write vocab. Default ON (missing/undefined => true). */
  function isAutoSaveVocabEnabled() {
    const v = storeGet(AUTO_SAVE_VOCAB_KEY, true);
    if (v === false || v === 'false' || v === 0 || v === '0') return false;
    return true;
  }

  function setAutoSaveVocabEnabled(on) {
    storeSet(AUTO_SAVE_VOCAB_KEY, !!on);
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
    if (!payload || typeof payload !== 'object') return;
    const entries = payload.entries;
    let count = typeof payload.count === 'number' ? payload.count : 0;
    if (!count && entries && typeof entries === 'object') {
      count = safeKeys(entries).length;
    }
    storeSet(LOCAL_DICT_DATA_KEY, payload);
    storeSet(LOCAL_DICT_META_KEY, {
      dictVersion: payload.version || '',
      count,
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
    let meta = storeGet(LOCAL_DICT_META_KEY, null);
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) meta = {};
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
  let appSettingsPanelHost = null;
  let lastSel = { text: '', sentence: '', rect: null };
  let busy = false; // only for heavy manual 存本并释义 / optional server paths
  let translateInFlight = false; // ignore duplicate 翻译 clicks while lookup runs
  let selectionGen = 0; // bumps on each new selection; stale responses discard
  let autoQueryTimer = null;
  const inFlightByCacheKey = new Map(); // cacheKey -> Promise (dedupe)
  let fabRoot = null;
  let fabSheet = null;
  let fabHoverBridge = null;
  let fabButton = null;
  let fabDragging = false;
  let fabDragSuppressUntil = 0;
  let fabHoverCloseTimer = null;
  const FAB_HOVER_CLOSE_DELAY_MS = 200;
  /** Authoritative sheet open flag (display can lag / be raced by events). */
  let fabSheetOpen = false;
  /** Ignore duplicate pointerup+click (or double-fire) within one gesture. */
  let fabToggleSuppressUntil = 0;
  const FAB_TOGGLE_SUPPRESS_MS = 480;
  let onboardingScheduled = false;

  function eventInsideLlmSettings(e) {
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    const hosts = [llmPanelHost, appSettingsPanelHost].filter(Boolean);
    if (!hosts.length) return false;
    if (path.length) return hosts.some((h) => path.includes(h));
    return hosts.some((h) => e.target === h);
  }

  function toast(msg) {
    let el = document.getElementById('sensebook-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'sensebook-toast';
      applyStyles(el, {
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
    setStyleProp(el, 'display', 'block');
    clearTimeout(el._t);
    el._t = setTimeout(() => { setStyleProp(el, 'display', 'none'); }, 3200);
  }

  // Early FAB boot (function decls for setupFab* are hoisted; menus come later)
  try {
    setupFabAndOnboarding();
  } catch (err) {
    sensebookAlertError(err, 'early-boot/setupFabAndOnboarding');
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

  let iconTipEl = null;
  let iconTipTimer = null;

  function hideIconTip() {
    if (iconTipTimer) {
      clearTimeout(iconTipTimer);
      iconTipTimer = null;
    }
    if (iconTipEl) {
      try { iconTipEl.remove(); } catch { /* ignore */ }
      iconTipEl = null;
    }
  }

  function positionIconTip(anchor) {
    if (!iconTipEl || !anchor) return;
    const tip = iconTipEl;
    const margin = 8;
    const gap = 6;
    const rect = anchor.getBoundingClientRect();
    tip.style.visibility = 'hidden';
    tip.style.display = 'block';
    tip.style.left = '0px';
    tip.style.top = '0px';
    const tw = tip.offsetWidth || 0;
    const th = tip.offsetHeight || 0;
    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;

    // Prefer above the icon; flip below if needed.
    let top = rect.top - th - gap;
    if (top < margin) top = rect.bottom + gap;
    if (top + th > vh - margin) top = Math.max(margin, vh - th - margin);
    if (top < margin) top = margin;

    let left = rect.left + (rect.width - tw) / 2;
    if (left < margin) left = margin;
    if (left + tw > vw - margin) left = Math.max(margin, vw - tw - margin);

    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
    tip.style.visibility = 'visible';
  }

  /** Near-instant custom Chinese hover tip (do not rely on native title). */
  function showIconTip(anchor, label) {
    hideIconTip();
    if (!anchor || !label) return;
    iconTipTimer = setTimeout(() => {
      iconTipTimer = null;
      try {
        if (!anchor.isConnected) return;
      } catch {
        return;
      }
      const tip = document.createElement('div');
      tip.id = 'sensebook-icon-tip';
      tip.setAttribute('role', 'tooltip');
      tip.textContent = String(label);
      applyStyles(tip, {
        position: 'fixed',
        zIndex: '2147483647',
        padding: '4px 8px',
        borderRadius: '6px',
        background: 'rgba(15,23,42,.92)',
        color: '#fff',
        fontSize: '12px',
        lineHeight: '1.35',
        fontFamily: 'system-ui,sans-serif',
        fontWeight: '500',
        whiteSpace: 'normal',
        pointerEvents: 'none',
        boxShadow: '0 2px 8px rgba(0,0,0,.22)',
        maxWidth: 'min(280px, calc(100vw - 16px))',
        overflow: 'hidden',
      });
      iconTipEl = tip;
      document.documentElement.appendChild(tip);
      positionIconTip(anchor);
    }, 40);
  }

  function hidePopup() {
    hideIconTip();
    if (autoQueryTimer) {
      clearTimeout(autoQueryTimer);
      autoQueryTimer = null;
    }
    translateInFlight = false;
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
    applyStyles(el, {
      display: 'none',
      width: '100%',
      minWidth: '0',
      maxWidth: 'none',
      alignSelf: 'stretch',
      order: '0',
      marginTop: '0',
      padding: '8px 10px',
      borderRadius: '8px',
      background: '#f8fafc',
      border: '1px solid #e2e8f0',
      fontSize: '13px',
      lineHeight: '1.5',
      color: '#0f172a',
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
    // Keep result nearer selection than the toolbar: result first in DOM;
    // flex-direction flips to column-reverse when popup is above selection.
    if (popupBtnRow && popup.contains(popupBtnRow)) {
      popup.insertBefore(el, popupBtnRow);
    } else {
      popup.appendChild(el);
    }
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
    applyStyles(meta, {
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
    applyStyles(dot, {
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
    el.style.background = '#f8fafc';
    el.style.borderColor = '#e2e8f0';
    localRow.style.display = 'block';
    applyStyles(localRow, {
      marginBottom: '8px',
      paddingBottom: '8px',
      borderBottom: '1px solid #e2e8f0',
    });
    _paintMetaHint(localRow, '本地词库', '#38bdf8');
    const text = document.createElement('div');
    applyStyles(text, {
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
    el.style.background = '#f8fafc';
    el.style.borderColor = '#e2e8f0';
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
    applyStyles(text, {
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

  /**
   * 存本并释义 result — labeled 词义 / 句意 (not the translate dual-out layout).
   * kind: 'ok' | 'loading' | 'error' | 'hint'
   */
  function setSenseGlossResult({ ai_word_sense, ai_sentence_gloss } = {}, kind) {
    const el = ensurePopupResultEl();
    if (!el) return;
    const localRow = el.querySelector('[data-slot="local"]');
    const modelRow = el.querySelector('[data-slot="model"]');
    if (!localRow || !modelRow) return;

    el.style.display = 'block';
    el.style.background = '#f5f3ff';
    el.style.borderColor = '#ddd6fe';

    while (localRow.firstChild) localRow.removeChild(localRow.firstChild);
    while (modelRow.firstChild) modelRow.removeChild(modelRow.firstChild);

    const sense = String(ai_word_sense || '').trim();
    const gloss = String(ai_sentence_gloss || '').trim();
    const k = kind || 'ok';

    if (sense) {
      localRow.style.display = 'block';
      applyStyles(localRow, {
        marginBottom: gloss ? '8px' : '0',
        paddingBottom: gloss ? '8px' : '0',
        borderBottom: gloss ? '1px solid #e9e5ff' : 'none',
      });
      _paintMetaHint(localRow, '词义', '#8b5cf6');
      const text = document.createElement('div');
      applyStyles(text, {
        color: k === 'error' ? '#b91c1c' : '#0f172a',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      });
      text.textContent = sense;
      localRow.appendChild(text);
    } else {
      localRow.style.display = 'none';
      applyStyles(localRow, {
        marginBottom: '0',
        paddingBottom: '0',
        borderBottom: 'none',
      });
    }

    if (gloss || (!sense && k !== 'ok')) {
      modelRow.style.display = 'block';
      applyStyles(modelRow, {
        marginBottom: '0',
        paddingBottom: '0',
        borderBottom: 'none',
      });
      _paintMetaHint(modelRow, '句意', '#a78bfa');
      const text = document.createElement('div');
      applyStyles(text, {
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      });
      if (!gloss && !sense) {
        text.textContent = k === 'loading' ? '存本并释义中…' : (k === 'error' ? '释义失败' : '');
      } else {
        text.textContent = gloss || '';
      }
      if (k === 'error') text.style.color = '#b91c1c';
      else if (k === 'loading') text.style.color = '#6d28d9';
      else if (k === 'hint') text.style.color = '#64748b';
      else text.style.color = '#0f172a';
      modelRow.appendChild(text);
    } else if (!sense) {
      modelRow.style.display = 'none';
    } else {
      modelRow.style.display = 'none';
    }
  }

  /** Translate-path body: translation only (never mix 词义/句意 into the blob). */
  function formatTranslateResult(rec) {
    if (!rec) return '';
    return String(rec.translation || '').trim();
  }

  function _svgIcon(parts, viewBox) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', viewBox || '0 0 24 24');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    const list = Array.isArray(parts) ? parts : [parts];
    for (const part of list) {
      if (!part) continue;
      if (typeof part === 'string') {
        const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p.setAttribute('d', part);
        svg.appendChild(p);
        continue;
      }
      const tag = part.tag || 'path';
      const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
      const attrs = part.attrs || {};
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
      if (part.d && !attrs.d) el.setAttribute('d', part.d);
      svg.appendChild(el);
    }
    return svg;
  }

  const POPUP_ICON = {
    translate: [
      { tag: 'path', attrs: { d: 'M5 8l6 6' } },
      { tag: 'path', attrs: { d: 'M4 14l6-6 2-3' } },
      { tag: 'path', attrs: { d: 'M2 5h12' } },
      { tag: 'path', attrs: { d: 'M7 2h1' } },
      { tag: 'path', attrs: { d: 'M22 22l-5-10-5 10' } },
      { tag: 'path', attrs: { d: 'M14 18h6' } },
    ],
    copy: [
      { tag: 'rect', attrs: { x: '9', y: '9', width: '13', height: '13', rx: '2' } },
      { tag: 'path', attrs: { d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' } },
    ],
    addVocab: [
      { tag: 'path', attrs: { d: 'M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z' } },
      { tag: 'line', attrs: { x1: '12', y1: '8', x2: '12', y2: '14' } },
      { tag: 'line', attrs: { x1: '9', y1: '11', x2: '15', y2: '11' } },
    ],
    ai: [
      { tag: 'path', attrs: { d: 'M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z' } },
      { tag: 'path', attrs: { d: 'M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14z' } },
    ],
    vocab: [
      { tag: 'path', attrs: { d: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20' } },
      { tag: 'path', attrs: { d: 'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z' } },
    ],
  };

  function _clampPopupResultMaxHeight(vh, margin) {
    if (!popup || !popupResultEl) return;
    const btnH = popupBtnRow ? popupBtnRow.offsetHeight : 0;
    const pad = 16; // popup padding + gaps
    // Cap only to remaining viewport: no extra 220px lid, so longer 词义/句意
    // do not internally scroll when the whole popup can still fit.
    const available = Math.max(72, vh - 2 * margin - btnH - pad);
    popupResultEl.style.maxHeight = available + 'px';
  }

  /**
   * Place popup relative to selection: prefer below; flip above when needed;
   * clamp fully into the viewport. Results stay nearer selection than toolbar
   * via flex-direction (column below, column-reverse above).
   */
  function _isCoarsePointer() {
    try {
      return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    } catch {
      return 'ontouchstart' in window;
    }
  }

  /**
   * Frozen pixel width for this popup show. Never mutate after shown — a
   * widening card would slide toolbar hit targets (翻译 → 加入生词本).
   *
   * Mobile / coarse / small viewport (<640): min(100vw - 24px) — 12px gutters.
   * Desktop / fine pointer: min(420px, 90vw) — readable, not full-bleed.
   */
  function _popupFrozenWidthPx(vw, coarse) {
    const width = (vw == null)
      ? (window.innerWidth || (document.documentElement && document.documentElement.clientWidth) || 360)
      : vw;
    const isCoarse = (coarse == null) ? _isCoarsePointer() : !!coarse;
    const viewportCap = Math.max(200, width - 24); // 12px each side
    const desktop = Math.min(420, Math.round(width * 0.90), viewportCap);
    if (isCoarse || width < 640) {
      // Phone-sized: use remaining viewport. Large coarse tablets still cap
      // so landscape iPad is not a 90vw+ slab of 13px text.
      return width < 640 ? viewportCap : desktop;
    }
    return desktop;
  }

  function repositionPopup(rect) {
    if (!popup || !rect) return;
    const margin = 8;
    // Android/iOS system selection bar usually sits above the highlight; keep Sensebook
    // clear of it (prefer below + larger gap on coarse pointers).
    const nativeBarGap = _isCoarsePointer() ? 52 : 0;
    const gapBelow = margin + (_isCoarsePointer() ? 12 : 0);
    const gapAbove = margin + nativeBarGap;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    _clampPopupResultMaxHeight(vh, margin);

    const pw = popup.offsetWidth || 0;
    const ph = popup.offsetHeight || 0;
    const spaceBelow = vh - rect.bottom - gapBelow;
    const spaceAbove = rect.top - gapAbove;
    // Prefer below (away from native bar); flip above only when below cannot fit and above is roomier.
    const placeAbove = ph > spaceBelow && spaceAbove > spaceBelow;

    let top = placeAbove ? (rect.top - ph - gapAbove) : (rect.bottom + gapBelow);
    let left = rect.left + rect.width / 2 - pw / 2;

    if (left < margin) left = margin;
    if (left + pw > vw - margin) left = Math.max(margin, vw - pw - margin);

    if (top + ph > vh - margin) top = vh - ph - margin;
    if (top < margin) top = margin;

    popup.style.top = top + 'px';
    popup.style.left = left + 'px';
    popup.style.flexDirection = placeAbove ? 'column-reverse' : 'column';
    try { popup.dataset.place = placeAbove ? 'above' : 'below'; } catch { /* ignore */ }
  }

  function showPopup(rect) {
    hidePopup();
    popup = document.createElement('div');
    popup.id = 'sensebook-popup';
    const frozenW = _popupFrozenWidthPx();
    applyStyles(popup, {
      position: 'fixed',
      zIndex: '2147483646',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'stretch',
      gap: '4px',
      padding: '6px',
      width: frozenW + 'px',
      minWidth: frozenW + 'px',
      maxWidth: frozenW + 'px',
      boxSizing: 'border-box',
      background: '#fff',
      borderRadius: '10px',
      boxShadow: '0 4px 20px rgba(0,0,0,.18)',
      border: '1px solid #e2e8f0',
      fontFamily: 'system-ui,sans-serif',
    });
    try { popup.dataset.frozenWidth = String(frozenW); } catch { /* ignore */ }

    popupBtnRow = document.createElement('div');
    popupBtnRow.setAttribute('data-sensebook-toolbar', '1');
    applyStyles(popupBtnRow, {
      // Equal columns inside the already-frozen popup width. Do not use
      // space-between on a growing card — that was the moving hit-target bug.
      display: 'grid',
      gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
      justifyItems: 'center',
      alignItems: 'center',
      gap: '4px',
      width: '100%',
      boxSizing: 'border-box',
      order: '1',
    });

    const mkIconBtn = (label, iconKey, onClick, bg, actionId, tip) => {
      const b = document.createElement('button');
      b.type = 'button';
      // Instant custom Chinese hover tip + aria-label (do not rely on native title)
      const tipText = tip || label;
      b.removeAttribute('title');
      b.setAttribute('aria-label', label);
      if (actionId) b.setAttribute('data-action', actionId);
      b.appendChild(_svgIcon(POPUP_ICON[iconKey] || []));
      applyStyles(b, {
        width: '30px',
        height: '30px',
        minWidth: '30px',
        minHeight: '30px',
        padding: '0',
        border: 'none',
        borderRadius: '8px',
        background: bg || '#2563eb',
        color: '#fff',
        cursor: 'pointer',
        touchAction: 'manipulation',
        flex: '0 0 auto',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        lineHeight: '0',
      });
      b.addEventListener('pointerenter', () => showIconTip(b, tipText));
      b.addEventListener('pointerleave', hideIconTip);
      b.addEventListener('blur', hideIconTip);
      // Keep selection; also stop bubbling so document dismiss handlers cannot race.
      b.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      b.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
      });
      b.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        hideIconTip();
        // Auto-query must not block buttons; only heavy enrich uses busy.
        if (busy && actionId === 'ai') return;
        // Translate must never save vocab; ignore duplicate clicks while in flight
        // so rapid re-clicks cannot race UI layout into a mis-hit on 加入生词本.
        if (actionId === 'translate' && translateInFlight) return;
        onClick();
      });
      return b;
    };

    popupBtnRow.appendChild(mkIconBtn(
      '翻译',
      'translate',
      () => doTranslate({ forceRefresh: true }),
      '#2563eb',
      'translate',
      '仅翻译（本地词库 + 模型），不写入生词本'
    ));
    popupBtnRow.appendChild(mkIconBtn('复制文本', 'copy', () => copyLastSelectionText(), '#64748b', 'copy'));
    popupBtnRow.appendChild(mkIconBtn('加入生词本', 'addVocab', () => doSave(false), '#2563eb', 'add', '只加入生词本，不生成释义'));
    popupBtnRow.appendChild(mkIconBtn(
      '存本并释义',
      'ai',
      () => doSave(true),
      '#7c3aed',
      'ai',
      '存入生词本，并生成词义 / 句意（语境释义，非干译）'
    ));
    popupBtnRow.appendChild(mkIconBtn('我的生词本', 'vocab', () => { hidePopup(); showLocalPanel(); }, '#0f766e', 'vocab'));

    // Result nearer selection: append result first, toolbar second.
    ensurePopupResultEl();
    resetPopupResultSlots();
    popup.appendChild(popupBtnRow);
    document.documentElement.appendChild(popup);
    // Width is already frozen to frozenW (px) before paint / first click.
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

  function truncateDisplay(s, maxLen) {
    const str = String(s || '');
    if (str.length <= maxLen) return str;
    return str.slice(0, Math.max(0, maxLen - 1)) + '…';
  }

  function isSafeHttpUrl(url) {
    try {
      const u = new URL(String(url || ''), location.href);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  }

  /** Truncated source URL + 「打开来源」 link; empty string when missing/unsafe. */
  function renderSourceUrlHtml(url) {
    const raw = String(url || '').trim();
    if (!raw || !isSafeHttpUrl(raw)) return '';
    const href = escapeHtml(raw);
    const display = escapeHtml(truncateDisplay(raw, 64));
    return `<div style="font-size:11px;color:#94a3b8;margin-top:6px;display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;">
      <span style="word-break:break-all;min-width:0;flex:1;" title="${href}">${display}</span>
      <a href="${href}" target="_blank" rel="noopener noreferrer" style="color:#2563eb;text-decoration:none;white-space:nowrap;flex-shrink:0;">打开来源</a>
    </div>`;
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

  function hideAppSettingsPanel() {
    if (appSettingsPanelHost) {
      appSettingsPanelHost.remove();
      appSettingsPanelHost = null;
    }
  }

  /**
   * In-page DeepSeek API settings only (Shadow DOM).
   * Auto-query / vocab prefs live in showAppSettingsPanel.
   */
  function showLlmSettingsPanel() {
    hideAppSettingsPanel();
    hideLlmSettingsPanel();

    const host = document.createElement('div');
    host.id = 'sensebook-llm-settings-host';
    applyStyles(host, {
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
<div class="card" role="dialog" aria-label="DeepSeek 设置">
  <h2>DeepSeek 设置</h2>
  <p class="sub">API Key / 模型仅保存在本机油猴存储。自动查询等应用偏好请到「Sensebook 设置」。</p>
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
    <input type="checkbox" id="llmThinking" style="width:18px;height:18px;" />
    开启思考
  </label>
  <div class="hint" style="margin-top:4px;">默认关闭以加快速度、降低费用；难句可开启（翻译 / 存本并释义共用）。</div>

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
    const thinkingInput = $('llmThinking');
    if (thinkingInput) thinkingInput.checked = isLlmThinkingEnabled();
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
      if (thinkingInput) storeSet(LLM_THINKING_KEY, !!thinkingInput.checked);
      updateFabState();
      // Reflect defaults in fields if user cleared
      if (!base) baseInput.value = DEFAULT_LLM_BASE_URL;
      if (!model) modelInput.value = DEFAULT_LLM_MODEL;
      keyStatus.textContent = '当前：' + maskApiKey(key);
      setStatus('已保存（本机）。' + (key ? '可用「测试连接」验证。' : '未填 Key 时「存本并释义」仍用本地 stub。'), 'ok');
      toast(key ? 'DeepSeek 设置已保存' : '已保存（无 Key，将使用 stub）');
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
            thinking: { type: 'disabled' },
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


  /**
   * App prefs (auto-query etc.) — separate from DeepSeek API settings.
   */
  function showAppSettingsPanel() {
    hideLlmSettingsPanel();
    hideAppSettingsPanel();

    const host = document.createElement('div');
    host.id = 'sensebook-app-settings-host';
    applyStyles(host, {
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

    shadow.innerHTML = `
<style>
  * { box-sizing: border-box; }
  .card {
    width: min(400px, 100%);
    max-height: min(92vh, 640px);
    overflow: auto;
    background: #fff;
    border-radius: 14px;
    box-shadow: 0 12px 40px rgba(0,0,0,.28);
    padding: 18px 18px 16px;
    color: #0f172a;
  }
  h2 { margin: 0 0 4px; font-size: 18px; font-weight: 700; }
  .sub { margin: 0 0 14px; font-size: 12px; color: #64748b; line-height: 1.5; }
  label {
    display: block;
    font-size: 13px;
    font-weight: 600;
    margin: 12px 0 6px;
    color: #334155;
  }
  .hint { font-weight: 400; color: #94a3b8; font-size: 11px; line-height: 1.45; }
  .mode-box {
    margin-top: 10px;
    padding: 10px 12px;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    background: #f8fafc;
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
  .primary { background: #0f172a; color: #fff; }
  .ghost { background: transparent; color: #64748b; margin-left: auto; }
  .status {
    margin-top: 12px;
    min-height: 18px;
    font-size: 13px;
    color: #047857;
  }
</style>
<div class="card" role="dialog" aria-label="Sensebook 设置">
  <h2>Sensebook 设置</h2>
  <p class="sub">划词自动查询与生词本偏好（与 DeepSeek API Key 分开）。</p>

  <label style="display:flex;align-items:center;gap:8px;font-weight:600;margin-top:4px;">
    <input type="checkbox" id="autoQuery" style="width:18px;height:18px;" />
    选中自动查询
  </label>
  <div class="hint" style="margin-top:4px;">划词后约 0.35 秒静默查询；结果与缓存可在「查询记录」回看。</div>

  <div class="mode-box" id="autoQueryModeWrap">
    <div style="font-weight:600;font-size:13px;margin-bottom:8px;">自动查询方式</div>
    <label style="display:flex;align-items:center;gap:8px;font-weight:500;margin:0 0 6px;">
      <input type="radio" name="autoQueryMode" id="autoQueryModeSense" value="sense" style="width:16px;height:16px;" />
      语境释义
    </label>
    <label style="display:flex;align-items:center;gap:8px;font-weight:500;margin:0 0 8px;">
      <input type="radio" name="autoQueryMode" id="autoQueryModeTranslate" value="translate" style="width:16px;height:16px;" />
      翻译
    </label>
    <div class="hint" style="margin:0 0 8px;">默认「语境释义」：显示词义/句意（与「存本并释义」同提示词）。「翻译」走本地词库 + 模型双出。</div>
    <label id="autoSaveVocabLabel" style="display:flex;align-items:center;gap:8px;font-weight:600;margin:0;">
      <input type="checkbox" id="autoSaveVocab" style="width:18px;height:18px;" />
      自动加入生词本
    </label>
    <div class="hint" style="margin-top:4px;">默认开启：自动查询成功后写入生词本；关闭后只展示、不自动入库。</div>
  </div>

  <div class="actions">
    <button type="button" class="primary" id="save">保存</button>
    <button type="button" class="ghost" id="close">关闭</button>
  </div>
  <div class="status" id="status"></div>
</div>
`;

    const $ = (id) => shadow.getElementById(id);
    const autoQueryInput = $('autoQuery');
    const modeSenseInput = $('autoQueryModeSense');
    const modeTranslateInput = $('autoQueryModeTranslate');
    const autoSaveVocabInput = $('autoSaveVocab');
    const statusEl = $('status');

    if (autoQueryInput) autoQueryInput.checked = isAutoQueryEnabled();
    const curMode = getAutoQueryMode();
    if (modeSenseInput) modeSenseInput.checked = curMode === AUTO_QUERY_MODE_SENSE;
    if (modeTranslateInput) modeTranslateInput.checked = curMode === AUTO_QUERY_MODE_TRANSLATE;
    if (autoSaveVocabInput) autoSaveVocabInput.checked = isAutoSaveVocabEnabled();

    const card = shadow.querySelector('.card');
    card.addEventListener('click', (e) => e.stopPropagation());

    $('close').onclick = () => hideAppSettingsPanel();
    host.addEventListener('click', (e) => {
      const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
      const trueTarget = path.length ? path[0] : e.target;
      if (trueTarget === host) hideAppSettingsPanel();
    });

    $('save').onclick = () => {
      if (autoQueryInput) setAutoQueryEnabled(!!autoQueryInput.checked);
      if (modeTranslateInput && modeTranslateInput.checked) setAutoQueryMode(AUTO_QUERY_MODE_TRANSLATE);
      else setAutoQueryMode(AUTO_QUERY_MODE_SENSE);
      if (autoSaveVocabInput) setAutoSaveVocabEnabled(!!autoSaveVocabInput.checked);
      statusEl.textContent = '已保存（本机）。';
      toast('Sensebook 设置已保存');
    };

    document.documentElement.appendChild(host);
    appSettingsPanelHost = host;
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
    applyStyles(panel, {
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
    applyStyles(header, {
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
    applyStyles(toolbar, {
      display: 'flex',
      gap: '6px',
      flexWrap: 'wrap',
      alignItems: 'center',
    });
    const search = document.createElement('input');
    search.type = 'search';
    search.placeholder = '按单词过滤…';
    search.value = filterText || '';
    applyStyles(search, {
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
    applyStyles(goBtn, {
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
    vocabBtn.textContent = '我的生词本';
    applyStyles(vocabBtn, {
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
    applyStyles(closeBtn, {
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
    applyStyles(body, {
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
    applyStyles(panel, {
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
    applyStyles(header, {
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
    applyStyles(backBtn, {
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
    applyStyles(body, { overflow: 'auto', padding: '12px', flex: '1' });
    body.innerHTML = `
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px;">
        <div style="font-size:13px;color:#64748b;margin-bottom:4px;">句子</div>
        <div style="font-size:14px;color:#334155;margin-bottom:12px;white-space:pre-wrap;">${escapeHtml(rec.sentence || '')}</div>
        <div style="font-size:13px;color:#64748b;margin-bottom:4px;">翻译</div>
        <div style="font-size:14px;color:#0f172a;margin-bottom:12px;white-space:pre-wrap;">${escapeHtml(rec.translation || '（无）')}</div>
        ${rec.ai_word_sense ? `<div style="font-size:13px;color:#64748b;margin-bottom:4px;">词义</div><div style="font-size:14px;margin-bottom:12px;white-space:pre-wrap;">${escapeHtml(rec.ai_word_sense)}</div>` : ''}
        ${rec.ai_sentence_gloss ? `<div style="font-size:13px;color:#64748b;margin-bottom:4px;">句意</div><div style="font-size:14px;margin-bottom:12px;white-space:pre-wrap;">${escapeHtml(rec.ai_sentence_gloss)}</div>` : ''}
        ${renderSourceUrlHtml(rec.source_url)}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">
        <button type="button" data-act="save" style="min-height:44px;padding:10px 14px;border:none;border-radius:8px;background:#2563eb;color:#fff;cursor:pointer;font-size:14px;">加入生词本</button>
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
        toast('已加入生词本：' + rec.word);
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
    applyStyles(panel, {
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
    applyStyles(header, {
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
      <div style="font-weight:700;font-size:16px;">我的生词本（本地）</div>
      <div style="font-size:12px;color:#64748b;margin-top:2px;">无需登录 · ${llmHint} · 共 ${entries.length} 条</div>
    </div>`;
    const headerActions = document.createElement('div');
    applyStyles(headerActions, {
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
    applyStyles(configBtn, {
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
    applyStyles(histBtn, {
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
    applyStyles(closeBtn, {
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
    applyStyles(body, {
      overflow: 'auto',
      padding: '12px',
      flex: '1',
    });

    if (!entries.length) {
      body.innerHTML = '<div style="padding:16px;color:#64748b;font-size:14px;">暂无本地词条。划词后点「加入生词本」即可保存到本机。</div>';
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
          ${renderSourceUrlHtml(e.source_url)}
          <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">
            <button type="button" data-enrich-local="${escapeHtml(e.id)}" style="min-height:36px;padding:6px 10px;border:none;border-radius:8px;background:#7c3aed;color:#fff;cursor:pointer;font-size:13px;">存本并释义</button>
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
        toast('存本并释义中…');
        try {
          const result = await enrichLocalEntry(entry);
          patchLocalEntry(enrichId, {
            ai_sentence_gloss: result.ai_sentence_gloss,
            ai_word_sense: result.ai_word_sense,
            status: 'ready',
          });
          toast(result.stub ? '已生成本地 stub 释义' : '存本并释义完成');
          // optional server mirror
          if (hasOptionalApi() && !result.stub) {
            optionalServerEnrich({ ...entry, ...result }).catch(() => {});
          }
        } catch (err) {
          patchLocalEntry(enrichId, { status: 'failed' });
          toast('存本并释义失败：' + (err.message || String(err)));
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
    const thinkingFields = llmThinkingBodyFields();
    const body = {
      model,
      temperature: 0.2,
      ...thinkingFields,
      ...(jsonResponse ? { response_format: { type: 'json_object' } } : {}),
      messages,
    };

    let res = await gmRequest(url, { method: 'POST', headers, body });

    // Some providers reject response_format — retry without (keep thinking flag)
    if (jsonResponse && res.status >= 400) {
      const errText = (res.raw || '') + JSON.stringify(res.data || {});
      const formatRejected =
        /response_format|json_object|unsupported|unknown.?param|invalid/i.test(errText);
      if (formatRejected || res.status === 400) {
        const bodyNoFormat = {
          model,
          temperature: 0.2,
          ...thinkingFields,
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

  /**
   * Contextual 词义/句意 lookup (same enrich prompt as 存本并释义).
   * Does not write vocab. Caller handles display / optional save.
   */
  async function runSenseLookup({ word, sentence, source_url, forceRefresh }) {
    if (!word && !sentence) throw new Error('没有可释义文本');
    const cacheKey = makeCacheKey(word, sentence);
    if (!forceRefresh) {
      const hit = getCachedByKey(cacheKey);
      if (hit && (hit.ai_word_sense || hit.ai_sentence_gloss)) {
        return { record: hit, fromCache: true };
      }
    }
    const senseInFlightKey = 'sense::' + cacheKey;
    if (!forceRefresh && inFlightByCacheKey.has(senseInFlightKey)) {
      const record = await inFlightByCacheKey.get(senseInFlightKey);
      return { record, fromCache: false, piggyback: true };
    }

    const work = (async () => {
      let result;
      if (hasLlmConfig()) {
        result = await callLlmEnrich({
          word,
          sentence: sentence || word,
          source_url: source_url || location.href,
        });
        result = { ...result, stub: false };
      } else {
        result = { ...clientStubEnrich(word, sentence || word), stub: true };
      }
      return upsertQueryCache({
        word,
        sentence: sentence || word,
        source_url: source_url || location.href,
        ai_word_sense: result.ai_word_sense,
        ai_sentence_gloss: result.ai_sentence_gloss,
        cacheKey,
        stub: result.stub,
      });
    })();

    inFlightByCacheKey.set(senseInFlightKey, work);
    try {
      const record = await work;
      return { record, fromCache: false, stub: !!record.stub };
    } finally {
      inFlightByCacheKey.delete(senseInFlightKey);
    }
  }

  async function doTranslate(opts) {
    // Translate-only path: never call doSave / createLocalEntry.
    if (translateInFlight) return;
    translateInFlight = true;
    try {
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
        if (lastSel.rect) repositionPopup(lastSel.rect);
        return;
      }

      if (!forceRefresh) {
        const hit = getCachedByKey(makeCacheKey(word, sentence));
        if (hit && hit.translation) {
          setModelRow(formatTranslateResult(hit) || hit.translation || '', 'cache');
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
        const body = formatTranslateResult(record) || '(空)';
        setModelRow(body, fromCache ? 'cache' : 'ok');
        if (lastSel.rect) repositionPopup(lastSel.rect);
      } catch (e) {
        if (reqId !== selectionGen) return;
        if (localHit) {
          setModelRow('模型失败：' + (e.message || String(e)), 'error');
        } else {
          setModelRow('翻译失败：' + (e.message || String(e)), 'error');
        }
        if (lastSel.rect) repositionPopup(lastSel.rect);
      }
    } finally {
      translateInFlight = false;
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

    const mode = getAutoQueryMode();

    // ---- 语境释义 path (default): enrich display; vocab write if auto-save on ----
    if (mode === AUTO_QUERY_MODE_SENSE) {
      const cacheKey = makeCacheKey(word, sentence);
      const cacheHit = getCachedByKey(cacheKey);

      autoQueryTimer = setTimeout(async () => {
        autoQueryTimer = null;
        if (reqId !== selectionGen) return;

        if (cacheHit && (cacheHit.ai_word_sense || cacheHit.ai_sentence_gloss)) {
          setSenseGlossResult({
            ai_word_sense: cacheHit.ai_word_sense,
            ai_sentence_gloss: cacheHit.ai_sentence_gloss,
          }, 'ok');
          if (lastSel.rect) repositionPopup(lastSel.rect);
          return;
        }

        setSenseGlossResult({
          ai_word_sense: '',
          ai_sentence_gloss: hasLlmConfig() ? '语境释义中…' : '生成 stub 释义…',
        }, 'loading');

        try {
          const { record, fromCache } = await runSenseLookup({
            word,
            sentence,
            source_url: location.href,
            forceRefresh: false,
          });
          if (reqId !== selectionGen) return;
          setSenseGlossResult({
            ai_word_sense: record.ai_word_sense,
            ai_sentence_gloss: record.ai_sentence_gloss,
          }, 'ok');
          if (lastSel.rect) repositionPopup(lastSel.rect);

          // Optional vocab write (default on). Skip cache hits to avoid flooding 生词本.
          if (isAutoSaveVocabEnabled() && !fromCache) {
            try {
              const entry = createLocalEntry({
                word,
                sentence,
                source_url: location.href,
                status: 'pending_ai',
              });
              patchLocalEntry(entry.id, {
                ai_sentence_gloss: record.ai_sentence_gloss,
                ai_word_sense: record.ai_word_sense,
                status: 'ready',
              });
              if (hasOptionalApi()) {
                try {
                  await optionalServerEnrich({
                    ...entry,
                    ai_sentence_gloss: record.ai_sentence_gloss,
                    ai_word_sense: record.ai_word_sense,
                    status: 'ready',
                  });
                } catch { /* ignore sync errors on silent auto-save */ }
              }
            } catch { /* ignore auto-save errors */ }
          }
        } catch (e) {
          if (reqId !== selectionGen) return;
          setSenseGlossResult({
            ai_word_sense: '自动释义失败：' + (e.message || String(e)),
            ai_sentence_gloss: '',
          }, 'error');
        }
      }, AUTO_QUERY_DEBOUNCE_MS);
      return;
    }

    // ---- 翻译 path: dual-out local dict + model translation; vocab write if auto-save on ----
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
        setModelRow(formatTranslateResult(cacheHit) || '(空)', 'cache');
        // Still keep local row if present; no forced network refresh.
        return;
      }

      if (!hasLlmConfig()) {
        if (localHit) {
          setModelRow('本地词库已命中；配置 DeepSeek 后可并行显示模型译文', 'hint');
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
        const body = formatTranslateResult(record) || '(空)';
        setModelRow(body, fromCache ? 'cache' : 'ok');
        if (lastSel.rect) repositionPopup(lastSel.rect);

        // Optional vocab write (default on). Skip cache hits to avoid flooding 生词本.
        if (isAutoSaveVocabEnabled() && !fromCache) {
          try {
            const entry = createLocalEntry({
              word,
              sentence,
              source_url: location.href,
              status: record.translation ? 'ready' : 'pending_ai',
            });
            const patch = { status: record.translation ? 'ready' : 'pending_ai' };
            if (record.translation) patch.translation = record.translation;
            patchLocalEntry(entry.id, patch);
            // Mirror manual「加入生词本」sync — do not call optionalServerEnrich
            // (that path would trigger server sense enrich for translation-only saves).
            if (hasOptionalApi()) {
              try {
                await gmFetch(getApiUrl() + '/entries', {
                  method: 'POST',
                  headers: authHeaders(),
                  body: {
                    word: entry.word,
                    sentence: entry.sentence,
                    source_url: entry.source_url,
                  },
                });
              } catch { /* ignore sync errors on silent auto-save */ }
            }
          } catch { /* ignore auto-save errors */ }
        }
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
            toast('已加入生词本（并已可选同步）：' + entry.word);
          } catch (syncErr) {
            toast('已加入生词本（同步失败：' + syncErr.message + '）：' + entry.word);
          }
        } else {
          toast('已加入生词本：' + entry.word);
        }
        hidePopup();
        return;
      }

      // 存本并释义 path — save to vocab + contextual 词义/句意 (not dry translation)
      const reqId = selectionGen;
      busy = true;
      resetPopupResultSlots();
      setSenseGlossResult(
        { ai_word_sense: '', ai_sentence_gloss: hasLlmConfig() ? '存本并释义中…' : '生成 stub 释义…' },
        'loading'
      );

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
        // Cache sense fields only — do not overwrite translation with sense text
        upsertQueryCache({
          word,
          sentence,
          source_url,
          ai_word_sense: result.ai_word_sense,
          ai_sentence_gloss: result.ai_sentence_gloss,
        });
        if (reqId === selectionGen && popup) {
          setSenseGlossResult({
            ai_word_sense: result.ai_word_sense,
            ai_sentence_gloss: result.ai_sentence_gloss,
          }, 'ok');
          if (lastSel.rect) repositionPopup(lastSel.rect);
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
              (result.stub ? '已存本并生成本地 stub 释义（已同步）：' : '已存本并释义（已可选同步）：') + entry.word
            );
          } catch (syncErr) {
            toast(
              (result.stub ? '已存本并生成本地 stub 释义（同步失败）：' : '已存本并释义（同步失败）：') +
                entry.word
            );
          }
        } else {
          toast(
            (result.stub
              ? '已存本并生成本地 stub 释义（请先点「配置 DeepSeek」填写 API Key）：'
              : '已存本并释义：') + entry.word
          );
        }
        busy = false;
        // Keep popup open so structured 词义/句意 result stays visible
      } catch (llmErr) {
        patchLocalEntry(entry.id, { status: 'failed' });
        if (reqId === selectionGen && popup) {
          setSenseGlossResult({
            ai_word_sense: '释义失败：' + (llmErr.message || String(llmErr)),
            ai_sentence_gloss: '',
          }, 'error');
        }
        toast('已加入生词本，但存本并释义失败：' + (llmErr.message || String(llmErr)));
        busy = false;
      }
    } catch (e) {
      busy = false;
      toast(e.message || '加入生词本失败');
      hidePopup();
    }
  }

  function _selectionRect(range) {
    try {
      let rect = range.getBoundingClientRect();
      if (rect && (rect.width || rect.height)) return rect;
      const list = range.getClientRects && range.getClientRects();
      if (list && list.length) {
        const r = list[0];
        if (r && (r.width || r.height)) return r;
      }
    } catch { /* ignore */ }
    return null;
  }

  /** Keep popup near live selection (clamp/flip), or hide if selection is gone. */
  function followSelectionOrHide() {
    if (!popup) return;
    try {
      const sel = window.getSelection && window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) {
        hidePopup();
        return;
      }
      const text = String(sel.toString() || '').trim();
      if (!text) {
        hidePopup();
        return;
      }
      const range = sel.getRangeAt(0);
      const rect = _selectionRect(range);
      if (rect) {
        if (lastSel) {
          lastSel.text = text;
          lastSel.rect = rect;
        }
        repositionPopup(rect);
        return;
      }
    } catch { /* ignore */ }
    if (lastSel && lastSel.rect) repositionPopup(lastSel.rect);
  }

  function onSelectionChange() {
    // Do not gate on busy — auto-query / parallel lookups must allow new selection
    // (stale responses discarded via selectionGen).
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
      hidePopup();
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
      if (el && el.closest && el.closest('#sensebook-popup, #sensebook-panel, #sensebook-fab-root, #sensebook-llm-settings-host, #sensebook-app-settings-host')) {
        return;
      }
    } catch { /* ignore */ }

    const range = sel.getRangeAt(0);
    const rect = _selectionRect(range);
    if (!rect) return;

    // Same selection already shown (e.g. mouseup + selectionchange): refresh position only.
    if (popup && lastSel && lastSel.text === text) {
      lastSel.rect = rect;
      repositionPopup(rect);
      return;
    }

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

  // Android Chrome long-press often skips touchend/mouseup; selectionchange is the reliable signal.
  // Debounce so mid-drag handle moves settle before we show (~50–150ms).
  let selectionCheckTimer = null;
  function scheduleSelectionCheck(delayMs) {
    if (selectionCheckTimer) {
      clearTimeout(selectionCheckTimer);
      selectionCheckTimer = null;
    }
    selectionCheckTimer = setTimeout(() => {
      selectionCheckTimer = null;
      onSelectionChange();
    }, delayMs);
  }

  document.addEventListener('mouseup', () => {
    scheduleSelectionCheck(10);
  });
  document.addEventListener('touchend', () => {
    scheduleSelectionCheck(100);
  }, { passive: true });
  document.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'mouse') return; // mouseup already handles desktop
    scheduleSelectionCheck(100);
  }, { passive: true });
  document.addEventListener('selectionchange', () => {
    // Primary path on Android: fires when selection finalizes / handles settle (no touchend).
    scheduleSelectionCheck(_isCoarsePointer() ? 120 : 150);
  });

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
  // While selection remains, follow it on scroll/resize — do not permanently dismiss.
  document.addEventListener('scroll', () => {
    followSelectionOrHide();
  }, true);

  window.addEventListener('resize', () => {
    followSelectionOrHide();
  });


  function getSelectionTextForCopy() {
    try {
      const live = String(window.getSelection && window.getSelection().toString() || '').trim();
      if (live) return live;
    } catch { /* ignore */ }
    try {
      const cached = String((lastSel && lastSel.text) || '').trim();
      if (cached) return cached;
    } catch { /* ignore */ }
    return '';
  }

  function copyLastSelectionText() {
    const text = getSelectionTextForCopy();
    if (!text) {
      toast('暂无划选文本可复制');
      return;
    }
    const done = () => toast('已复制划选文本');
    const fail = () => toast('复制失败');
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(text).then(done).catch(() => {
          if (copyTextViaExecCommand(text)) done();
          else fail();
        });
        return;
      }
    } catch { /* fall through */ }
    if (copyTextViaExecCommand(text)) done();
    else fail();
  }

  function copyTextViaExecCommand(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      applyStyles(ta, {
        position: 'fixed',
        left: '-9999px',
        top: '0',
        opacity: '0',
      });
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      const ok = document.execCommand('copy');
      ta.remove();
      return !!ok;
    } catch {
      return false;
    }
  }

  /**
   * Hover-expand only when OS is clearly desktop Win/macOS/Linux.
   * Uncertain / Android / iOS => false (tap/click only). Default false.
   */
  function isClearlyDesktopOs() {
    try {
      const uaData = navigator.userAgentData;
      if (uaData) {
        if (uaData.mobile === true) return false;
        const p = String(uaData.platform || '').toLowerCase().replace(/\s+/g, '');
        if (!p) {
          /* fall through to UA / platform */
        } else if (/android|ios|iphone|ipad|ipod/.test(p)) {
          return false;
        } else if (p === 'windows' || p === 'macos' || p === 'linux') {
          return true;
        } else {
          // Known non-desktop or unknown platform string => do not hover-expand
          return false;
        }
      }
    } catch { /* ignore */ }

    try {
      const ua = String(navigator.userAgent || '');
      const plat = String(navigator.platform || '');
      // Mobile / tablet first — never hover-expand
      if (/Android|iPhone|iPod|iPad|webOS|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(ua)) return false;
      if (/iPad|Tablet/i.test(ua)) return false;
      // iPadOS 13+ may report MacIntel with touch
      if (plat === 'MacIntel' && typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1) {
        return false;
      }
      if (/Win(dows|32|64)/i.test(plat) || /Windows NT/i.test(ua)) return true;
      if (/Mac(intosh|Intel|PPC)/i.test(plat) || /\bMac OS X\b/i.test(ua)) return true;
      if (/Linux/i.test(plat) || (/\bX11\b/i.test(ua) && /Linux/i.test(ua))) {
        if (/Android/i.test(ua)) return false;
        return true;
      }
    } catch { /* ignore */ }
    return false; // uncertain => no hover expand
  }

  function canHoverExpandFab() {
    if (!isClearlyDesktopOs()) return false;
    try {
      return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    } catch {
      return false; // uncertain => no hover expand
    }
  }

  function getFabSize() {
    let w = 60;
    let h = 30;
    // Measure the FAB button only — never the expanded sheet (sheet is out-of-flow)
    if (fabButton) {
      const rect = fabButton.getBoundingClientRect();
      if (rect.width > 0) w = rect.width;
      if (rect.height > 0) h = rect.height;
    } else if (fabRoot) {
      w = fabRoot.offsetWidth || w;
      h = fabRoot.offsetHeight || h;
    }
    return { w, h };
  }

  function isFabSheetOpen() {
    return !!(fabSheetOpen && fabSheet && getStyleProp(fabSheet, 'display') !== 'none');
  }

  function clearFabHoverCloseTimer() {
    if (fabHoverCloseTimer != null) {
      clearTimeout(fabHoverCloseTimer);
      fabHoverCloseTimer = null;
    }
  }

  function scheduleFabHoverClose() {
    clearFabHoverCloseTimer();
    fabHoverCloseTimer = setTimeout(() => {
      fabHoverCloseTimer = null;
      if (fabDragging) return;
      hideFabSheet();
    }, FAB_HOVER_CLOSE_DELAY_MS);
  }

  function hideFabSheet() {
    clearFabHoverCloseTimer();
    fabSheetOpen = false;
    if (fabSheet) {
      setStyleProp(fabSheet, 'display', 'none');
      if (fabButton) fabButton.setAttribute('aria-expanded', 'false');
    }
    if (fabHoverBridge) setStyleProp(fabHoverBridge, 'display', 'none');
  }

  /** Place compact sheet upward/inward so it never covers the FAB drag target. */
  function positionFabSheet() {
    if (!fabSheet || !fabRoot || !fabButton) return;
    let btn;
    try { btn = fabButton.getBoundingClientRect(); } catch { return; }
    if (!btn) return;
    const sheetW = fabSheet.offsetWidth || 120;
    const sheetH = fabSheet.offsetHeight || 120;
    // Small visual gap; invisible bridge (+ delayed close) covers hit-testing dead zone.
    const gap = 4;
    const bridgePad = 8; // extends hit area across the gap toward the FAB
    const margin = 8;
    // Prefer expand upward (above FAB); if not enough room, expand downward below FAB.
    const spaceAbove = btn.top - margin;
    const spaceBelow = window.innerHeight - btn.bottom - margin;
    const openUp = spaceAbove >= sheetH + gap || spaceAbove >= spaceBelow;
    if (openUp) {
      applyStyles(fabSheet, {
        left: 'auto',
        right: '0',
        top: 'auto',
        bottom: (btn.height + gap) + 'px',
      });
    } else {
      applyStyles(fabSheet, {
        left: 'auto',
        right: '0',
        bottom: 'auto',
        top: (btn.height + gap) + 'px',
      });
    }
    // Keep sheet inward (toward viewport center) when near left edge
    const spaceRight = window.innerWidth - btn.right - margin;
    let alignLeft = false;
    if (btn.left + btn.width < sheetW && spaceRight < sheetW) {
      // near left: align sheet's left to FAB left via left:0
      setStyleProp(fabSheet, 'right', 'auto');
      setStyleProp(fabSheet, 'left', '0');
      alignLeft = true;
    } else {
      setStyleProp(fabSheet, 'left', 'auto');
      setStyleProp(fabSheet, 'right', '0');
    }
    // Invisible bridge fills FAB↔sheet gap so pointer never leaves the hover unit mid-travel.
    if (fabHoverBridge) {
      const bridgeH = gap + bridgePad;
      if (openUp) {
        applyStyles(fabHoverBridge, {
          display: 'block',
          left: alignLeft ? '0' : 'auto',
          right: alignLeft ? 'auto' : '0',
          top: 'auto',
          bottom: Math.max(0, btn.height - bridgePad / 2) + 'px',
          width: Math.max(btn.width, sheetW) + 'px',
          height: bridgeH + 'px',
        });
      } else {
        applyStyles(fabHoverBridge, {
          display: 'block',
          left: alignLeft ? '0' : 'auto',
          right: alignLeft ? 'auto' : '0',
          bottom: 'auto',
          top: Math.max(0, btn.height - bridgePad / 2) + 'px',
          width: Math.max(btn.width, sheetW) + 'px',
          height: bridgeH + 'px',
        });
      }
    }
  }

  function openFabSheet() {
    if (!fabSheet || !fabButton) return;
    if (fabDragging || Date.now() < fabDragSuppressUntil) return;
    clearFabHoverCloseTimer();
    fabSheetOpen = true;
    setStyleProp(fabSheet, 'display', 'flex');
    positionFabSheet();
    fabButton.setAttribute('aria-expanded', 'true');
  }

  function toggleFabSheet() {
    // Idempotent within one gesture: mobile often fires pointerup then click.
    if (Date.now() < fabToggleSuppressUntil) return;
    if (fabDragging || Date.now() < fabDragSuppressUntil) return;
    fabToggleSuppressUntil = Date.now() + FAB_TOGGLE_SUPPRESS_MS;
    const openNow = fabSheetOpen || !!(fabSheet && getStyleProp(fabSheet, 'display') !== 'none');
    if (openNow) hideFabSheet();
    else openFabSheet();
  }

  /** @deprecated toggle helper kept for call sites that expected open/close flip */
  function showFabSheet() {
    toggleFabSheet();
  }

  function clampFabPosition(left, top) {
    const margin = 8;
    const { w, h } = getFabSize();
    const maxL = Math.max(margin, window.innerWidth - w - margin);
    const maxT = Math.max(margin, window.innerHeight - h - margin);
    return {
      left: Math.min(Math.max(margin, left), maxL),
      top: Math.min(Math.max(margin, top), maxT),
    };
  }

  function applyFabPosition(left, top) {
    if (!fabRoot) return;
    const pos = clampFabPosition(left, top);
    applyStyles(fabRoot, {
      left: pos.left + 'px',
      top: pos.top + 'px',
      right: 'auto',
      bottom: 'auto',
    });
    if (isFabSheetOpen()) positionFabSheet();
    return pos;
  }

  function defaultFabPosition() {
    const { w, h } = getFabSize();
    return {
      left: Math.max(8, window.innerWidth - w - 16),
      top: Math.max(8, window.innerHeight - h - 16),
    };
  }

  function normalizeFabPos(raw) {
    if (raw == null) return null;
    let v = raw;
    if (typeof v === 'string') {
      try { v = JSON.parse(v); } catch { return null; }
    }
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const left = Number(v.left);
    const top = Number(v.top);
    if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
    return { left, top };
  }

  function loadAndApplyFabPosition() {
    if (!fabRoot) return;
    let saved = null;
    try {
      saved = normalizeFabPos(storeGet(FAB_POS_KEY, null));
    } catch { /* ignore */ }
    if (saved) {
      applyFabPosition(saved.left, saved.top);
    } else {
      // Drop corrupt / legacy values so later reads stay clean
      try {
        const raw = storeGet(FAB_POS_KEY, null);
        if (raw != null && !normalizeFabPos(raw)) storeSet(FAB_POS_KEY, null);
      } catch { /* ignore */ }
      const d = defaultFabPosition();
      applyFabPosition(d.left, d.top);
    }
  }

  function persistFabPosition() {
    if (!fabRoot) return;
    let rect;
    try {
      rect = fabRoot.getBoundingClientRect();
    } catch {
      return;
    }
    if (!rect) return;
    const pos = applyFabPosition(rect.left, rect.top);
    if (!pos || !Number.isFinite(pos.left) || !Number.isFinite(pos.top)) return;
    storeSet(FAB_POS_KEY, { left: pos.left, top: pos.top });
  }

  function setupFabDrag() {
    if (!fabRoot || !fabButton) return;
    const THRESH = 6;
    fabButton.addEventListener('pointerdown', (e) => {
      if (e.button != null && e.button !== 0) return;
      // Do NOT hideFabSheet here: that races the following click/pointerup toggle
      // (hide → click opens again = flash-reopen on mobile). Collapse only once
      // drag starts so the sheet cannot steal moves.
      const rect = fabRoot.getBoundingClientRect();
      const startX = e.clientX;
      const startY = e.clientY;
      const origLeft = rect.left;
      const origTop = rect.top;
      let moved = false;
      try { fabButton.setPointerCapture(e.pointerId); } catch { /* ignore */ }

      const onMove = (ev) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (!moved && (Math.abs(dx) > THRESH || Math.abs(dy) > THRESH)) {
          moved = true;
          fabDragging = true;
          // Collapse while dragging (keep sheet off the drag target)
          hideFabSheet();
          // Swallow any trailing click from this gesture
          fabToggleSuppressUntil = Date.now() + FAB_TOGGLE_SUPPRESS_MS;
          setStyleProp(fabButton, 'cursor', 'grabbing');
        }
        if (moved) {
          applyFabPosition(origLeft + dx, origTop + dy);
        }
      };

      const endGesture = (ev, cancelled) => {
        try { fabButton.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
        fabButton.removeEventListener('pointermove', onMove);
        fabButton.removeEventListener('pointerup', onPointerUp);
        fabButton.removeEventListener('pointercancel', onPointerCancel);
        setStyleProp(fabButton, 'cursor', 'grab');
        if (moved) {
          persistFabPosition();
          fabDragSuppressUntil = Date.now() + 350;
          fabDragging = false;
          hideFabSheet();
          try { ev.preventDefault(); } catch { /* ignore */ }
          return;
        }
        fabDragging = false;
        if (cancelled) return;
        // Light tap: toggle once here; suppress the synthetic click that follows
        // on Android Chrome (pointerup + click would otherwise double-toggle).
        if (!hasLlmConfig()) {
          fabToggleSuppressUntil = Date.now() + FAB_TOGGLE_SUPPRESS_MS;
          showLlmSettingsPanel();
        } else {
          toggleFabSheet();
        }
      };
      const onPointerUp = (ev) => endGesture(ev, false);
      const onPointerCancel = (ev) => endGesture(ev, true);

      fabButton.addEventListener('pointermove', onMove);
      fabButton.addEventListener('pointerup', onPointerUp);
      fabButton.addEventListener('pointercancel', onPointerCancel);
    });
  }

  function setupFab() {
    // Re-attach path may reset fabRoot=null while a stale node is gone
    if (fabRoot && document.getElementById('sensebook-fab-root')) return;
    fabRoot = document.createElement('div');
    fabRoot.id = 'sensebook-fab-root';
    applyStyles(fabRoot, {
      position: 'fixed',
      zIndex: '2147483647',
      display: 'block',
      width: 'auto',
      height: 'auto',
      fontFamily: 'system-ui,sans-serif',
      pointerEvents: 'auto',
    });

    fabSheet = document.createElement('div');
    fabSheet.id = 'sensebook-fab-sheet';
    applyStyles(fabSheet, {
      display: 'none',
      position: 'absolute',
      zIndex: '1',
      flexDirection: 'column',
      gap: '2px',
      width: 'max-content',
      maxWidth: '132px',
      minWidth: '92px',
      padding: '3px',
      background: '#fff',
      border: '1px solid #e2e8f0',
      borderRadius: '10px',
      boxShadow: '0 4px 14px rgba(15,23,42,.18)',
      pointerEvents: 'auto',
    });

    fabHoverBridge = document.createElement('div');
    fabHoverBridge.id = 'sensebook-fab-hover-bridge';
    fabHoverBridge.setAttribute('aria-hidden', 'true');
    applyStyles(fabHoverBridge, {
      display: 'none',
      position: 'absolute',
      zIndex: '0',
      pointerEvents: 'auto',
      background: 'transparent',
    });

    const makeAction = (label, onClick) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      applyStyles(button, {
        display: 'block',
        minHeight: '22px',
        width: '100%',
        padding: '2px 7px',
        border: '1px solid #cbd5e1',
        borderRadius: '6px',
        background: '#f8fafc',
        color: '#334155',
        fontSize: '10px',
        fontWeight: '600',
        lineHeight: '1.2',
        cursor: 'pointer',
        textAlign: 'left',
        whiteSpace: 'nowrap',
        touchAction: 'manipulation',
        boxSizing: 'border-box',
      });
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        // Ignore accidental clicks that arrived during/after a drag
        if (fabDragging || Date.now() < fabDragSuppressUntil) return;
        hideFabSheet();
        setTimeout(onClick, 0);
      });
      // Never let sheet items start a FAB drag or block pointer capture on FAB
      button.addEventListener('pointerdown', (event) => {
        event.stopPropagation();
      });
      return button;
    };

    fabSheet.appendChild(makeAction('DeepSeek 设置', showLlmSettingsPanel));
    fabSheet.appendChild(makeAction('Sensebook 设置', showAppSettingsPanel));
    fabSheet.appendChild(makeAction('我的生词本', showLocalPanel));
    fabSheet.appendChild(makeAction('查询记录', () => showQueryHistoryPanel()));

    fabButton = document.createElement('button');
    fabButton.type = 'button';
    fabButton.setAttribute('data-sensebook-fab', 'true');
    fabButton.setAttribute('aria-expanded', 'false');
    applyStyles(fabButton, {
      position: 'relative',
      zIndex: '2',
      minWidth: '60px',
      minHeight: '30px',
      padding: '4px 10px',
      border: '2px solid #fff',
      borderRadius: '999px',
      background: '#7c3aed',
      color: '#fff',
      boxShadow: '0 3px 10px rgba(124,58,237,.4), 0 1px 3px rgba(0,0,0,.18)',
      fontSize: '11px',
      fontWeight: '700',
      letterSpacing: '0.02em',
      cursor: 'grab',
      touchAction: 'none',
      userSelect: 'none',
      lineHeight: '1.15',
    });

    // Hover-to-expand only on clearly-identified desktop OS + fine pointer.
    // Android/iOS/uncertain: click/tap only (no hover auto-open).
    // FAB + sheet (+ invisible bridge) are one hover unit: delay close so a brief
    // gap transit does not collapse the menu before the pointer reaches a chip.
    fabRoot.addEventListener('pointerenter', (e) => {
      if (!canHoverExpandFab()) return;
      if (e.pointerType === 'touch') return;
      if (fabDragging || Date.now() < fabDragSuppressUntil) return;
      if (!hasLlmConfig()) return;
      clearFabHoverCloseTimer();
      openFabSheet();
    });
    fabRoot.addEventListener('pointerleave', () => {
      if (!canHoverExpandFab()) return;
      if (fabDragging) {
        clearFabHoverCloseTimer();
        hideFabSheet();
        return;
      }
      scheduleFabHoverClose();
    });

    fabButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (fabDragging || Date.now() < fabDragSuppressUntil) return;
      // pointerup already toggled on the same gesture → suppress window makes this a no-op.
      // Kept for keyboard / click-only environments that do not emit our pointerup path.
      if (!hasLlmConfig()) {
        if (Date.now() < fabToggleSuppressUntil) return;
        fabToggleSuppressUntil = Date.now() + FAB_TOGGLE_SUPPRESS_MS;
        showLlmSettingsPanel();
        return;
      }
      toggleFabSheet();
    });
    updateFabState();

    // FAB first in tree & higher z-index; sheet/bridge are absolute so they never push/cover the drag handle
    fabRoot.appendChild(fabButton);
    fabRoot.appendChild(fabHoverBridge);
    fabRoot.appendChild(fabSheet);
    const mount = document.body || document.documentElement;
    if (mount) mount.appendChild(fabRoot);

    loadAndApplyFabPosition();
    setupFabDrag();

    // Re-clamp after layout / viewport changes; keep persisted coords valid.
    try {
      if (!window.__sensebookFabResizeBound) {
        window.__sensebookFabResizeBound = true;
        window.addEventListener('resize', () => {
          try {
            if (!fabRoot || !document.getElementById('sensebook-fab-root')) return;
            persistFabPosition();
            if (isFabSheetOpen()) positionFabSheet();
          } catch { /* ignore */ }
        });
      }
    } catch { /* ignore */ }
  }

  function updateFabState() {
    if (!fabButton) return;
    const configured = hasLlmConfig();
    fabButton.textContent = configured ? 'Sensebook' : '配置 DeepSeek';
    setStyleProp(fabButton, 'background', configured ? '#0f172a' : '#7c3aed');
    fabButton.setAttribute(
      'aria-label',
      configured ? '打开 Sensebook 快捷菜单' : '配置 DeepSeek API Key'
    );
    fabButton.title = configured ? '打开 Sensebook 快捷菜单' : '配置 DeepSeek API Key';
  }

  document.addEventListener('mousedown', (e) => {
    if (llmPanelHost && eventInsideLlmSettings(e)) return;
    if (fabSheet && getStyleProp(fabSheet, 'display') !== 'none' && fabRoot && !fabRoot.contains(e.target)) {
      hideFabSheet();
    }
  });

  function setupFabAndOnboarding() {
    try {
      setupFab();
    } catch (err) {
      sensebookAlertError(err, 'setupFabAndOnboarding/setupFab');
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
          sensebookAlertError(err, 'onboarding/showLlmSettingsPanel');
        }
      }, 600);
    }
  }

  function registerSensebookMenus() {
    try {
      gmMenu('Sensebook：我的生词本（本地）', () => {
        showLocalPanel();
      });
      gmMenu('Sensebook：查询记录', () => {
        showQueryHistoryPanel();
      });
      gmMenu('Sensebook：DeepSeek 设置', () => {
        showLlmSettingsPanel();
      });
      gmMenu('Sensebook：Sensebook 设置', () => {
        showAppSettingsPanel();
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
          '【可选】JWT Token（网页登录后复制）\n加入生词本不需要 Token。',
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
            ? '本地优先：加入生词本在本机；已配置 DeepSeek，「存本并释义」将直连模型'
            : '默认本地优先：加入生词本写入油猴存储。菜单「DeepSeek 设置」填写 API Key 后可真实「存本并释义」') +
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
        fabHoverBridge = null;
        fabButton = null;
        fabSheetOpen = false;
        setupFab();
      }
    } catch (err) {
      sensebookAlertError(err, 'ensureFabAttached/setupFab');
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
          fabHoverBridge = null;
          fabButton = null;
          fabSheetOpen = false;
          try { setupFab(); } catch (err) {
            sensebookAlertError(err, 'fabWatchdog/setupFab');
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
    sensebookAlertError(err, 'sensebook-main');
    mountEmergencyFab();
  }

})();
