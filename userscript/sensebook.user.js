// ==UserScript==
// @name         Sensebook 划词
// @namespace    https://github.com/veightz/sensebook
// @updateURL    https://raw.githubusercontent.com/veightz/sensebook/main/userscript/sensebook.user.js
// @downloadURL  https://raw.githubusercontent.com/veightz/sensebook/main/userscript/sensebook.user.js
// @version      0.4.2
// @description  划词翻译 / 存词 / AI 释义 — Sensebook（本地优先；DeepSeek LLM 设置面板）
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
// ==/UserScript==

(function () {
  'use strict';

  const ENTRIES_KEY = 'sensebook_entries';
  const API_URL_KEY = 'sensebook_api_url';
  const TOKEN_KEY = 'sensebook_token';
  // LLM settings (local-only; separate from optional server sync)
  const LLM_BASE_URL_KEY = 'sensebook_llm_base_url';
  const LLM_API_KEY_KEY = 'sensebook_llm_api_key';
  const LLM_MODEL_KEY = 'sensebook_llm_model';

  const DEFAULT_LLM_BASE_URL = 'https://api.deepseek.com/v1';
  const DEFAULT_LLM_MODEL = 'deepseek-flash';

  const ENRICH_SYSTEM_PROMPT =
    '你是简洁的语境词汇助教。根据用户给出的单词、句子与来源页，用中文解释。' +
    '只输出 JSON 对象：{"ai_sentence_gloss":"整句中文释义（简洁）","ai_word_sense":"该词在此句中的中文义项（含词性/用法提示，简洁）"}。' +
    '不要输出 Markdown 或其它文字。';

  // ---- storage helpers (GM_* with localStorage fallback) ----
  function storeGet(key, def) {
    try {
      if (typeof GM_getValue === 'function') {
        const v = GM_getValue(key, undefined);
        if (v !== undefined && v !== null) return v;
      }
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
    try {
      if (typeof GM_setValue === 'function') {
        GM_setValue(key, val);
        return;
      }
    } catch { /* ignore */ }
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

  function clientStubEnrich(word, sentence) {
    return {
      ai_sentence_gloss: `[本地 stub] 句意占位：${(sentence || '').slice(0, 80)}`,
      ai_word_sense: `[本地 stub] 「${word}」在句中的义项（未配置 LLM API Key，仅占位）`,
    };
  }

  function clientStubTranslate(text) {
    return `[本地翻译占位] ${text}\n（未配置 DeepSeek Key 或可选同步 API。菜单「LLM 设置」可填写 Key，或配置登录/同步）`;
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

  // ---- menus ----
  GM_registerMenuCommand('Sensebook：我的生词（本地）', () => {
    showLocalPanel();
  });

  GM_registerMenuCommand('Sensebook：LLM 设置', () => {
    showLlmSettingsPanel();
  });

  GM_registerMenuCommand('Sensebook：登录/同步（可选）— API 地址', () => {
    const cur = getApiUrl();
    const v = prompt(
      '【可选】Sensebook API 地址\n本地模式无需填写。填写后用于可选同步/在线翻译。\n例如 http://127.0.0.1:8787',
      cur || 'http://127.0.0.1:8787'
    );
    if (v != null) storeSet(API_URL_KEY, v.trim());
  });

  GM_registerMenuCommand('Sensebook：登录/同步（可选）— Token', () => {
    const cur = getToken();
    const v = prompt(
      '【可选】JWT Token（网页登录后复制）\n本地存词不需要 Token。',
      cur
    );
    if (v != null) storeSet(TOKEN_KEY, v.trim());
  });

  GM_registerMenuCommand('Sensebook：清除可选 Token', () => {
    storeSet(TOKEN_KEY, '');
    toast('已清除 Token（本地词库不受影响）');
  });

  GM_registerMenuCommand('Sensebook：关于本地模式', () => {
    toast(
      hasLlmConfig()
        ? '本地优先：存词在本机；已配置 DeepSeek，AI 释义将直连模型'
        : '默认本地优先：存词写入油猴存储。菜单「LLM 设置」填写 DeepSeek API Key 后可真实 AI 释义'
    );
  });

  let popup = null;
  let panel = null;
  let llmPanelHost = null;
  let lastSel = { text: '', sentence: '', rect: null };
  let busy = false;

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
      document.documentElement.appendChild(el);
    }
    el.textContent = msg;
    el.style.display = 'block';
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.display = 'none'; }, 3200);
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
    if (popup) {
      popup.remove();
      popup = null;
    }
  }

  function setPopupLoading(msg) {
    if (!popup) return;
    popup.innerHTML = '';
    const span = document.createElement('div');
    span.textContent = msg || 'AI 释义中…';
    Object.assign(span.style, {
      padding: '12px 16px',
      fontSize: '14px',
      color: '#4c1d95',
      fontFamily: 'system-ui,sans-serif',
      minWidth: '120px',
      textAlign: 'center',
    });
    popup.appendChild(span);
  }

  function showPopup(rect) {
    hidePopup();
    popup = document.createElement('div');
    popup.id = 'sensebook-popup';
    Object.assign(popup.style, {
      position: 'fixed',
      zIndex: '2147483646',
      display: 'flex',
      gap: '6px',
      padding: '6px',
      flexWrap: 'wrap',
      maxWidth: 'calc(100vw - 16px)',
      boxSizing: 'border-box',
      background: '#fff',
      borderRadius: '10px',
      boxShadow: '0 4px 20px rgba(0,0,0,.18)',
      border: '1px solid #e2e8f0',
      fontFamily: 'system-ui,sans-serif',
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
        if (busy) return;
        onClick();
      });
      return b;
    };

    popup.appendChild(mkBtn('翻译', () => doTranslate()));
    popup.appendChild(mkBtn('存词', () => doSave(false)));
    popup.appendChild(mkBtn('AI释义', () => doSave(true), '#7c3aed'));
    popup.appendChild(mkBtn('设置', () => { hidePopup(); showLlmSettingsPanel(); }, '#475569'));
    popup.appendChild(mkBtn('生词', () => { hidePopup(); showLocalPanel(); }, '#0f766e'));

    document.documentElement.appendChild(popup);

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

  <label>模型 <span class="hint">默认 deepseek-flash，可改</span></label>
  <input type="text" id="model" autocomplete="off" spellcheck="false" />

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
      if (e.target === host) hideLlmSettingsPanel();
    });

    $('save').onclick = () => {
      const { base, key, model } = readForm();
      storeSet(LLM_BASE_URL_KEY, base || DEFAULT_LLM_BASE_URL);
      storeSet(LLM_API_KEY_KEY, key);
      storeSet(LLM_MODEL_KEY, model || DEFAULT_LLM_MODEL);
      // Reflect defaults in fields if user cleared
      if (!base) baseInput.value = DEFAULT_LLM_BASE_URL;
      if (!model) modelInput.value = DEFAULT_LLM_MODEL;
      keyStatus.textContent = '当前：' + maskApiKey(key);
      setStatus('已保存（本机）。' + (key ? '可用「测试连接」验证。' : '未填 Key 时 AI 释义仍用本地 stub。'), 'ok');
      toast(key ? 'DeepSeek LLM 设置已保存' : '已保存（无 Key，将使用 stub）');
    };

    $('clearKey').onclick = () => {
      storeSet(LLM_API_KEY_KEY, '');
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
    header.appendChild(closeBtn);
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
      GM_xmlhttpRequest({
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
      GM_xmlhttpRequest({
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
  async function callLlmChatCompletions(messages) {
    const base = getLlmBaseUrl();
    const key = getLlmApiKey();
    const model = getLlmModel();
    if (!key) throw new Error('未配置 LLM API Key');
    if (!base) throw new Error('未配置 LLM Base URL');

    const url = base + '/chat/completions';
    const headers = { Authorization: 'Bearer ' + key };

    const bodyWithFormat = {
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages,
    };

    let res = await gmRequest(url, { method: 'POST', headers, body: bodyWithFormat });

    // Some providers reject response_format — retry without
    if (res.status >= 400) {
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
    return parseEnrichJson(content);
  }

  async function callLlmEnrich({ word, sentence, source_url }) {
    return callLlmChatCompletions([
      { role: 'system', content: ENRICH_SYSTEM_PROMPT },
      { role: 'user', content: buildEnrichUserPrompt({ word, sentence, source_url }) },
    ]);
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

  async function doTranslate() {
    const text = lastSel.text || lastSel.sentence;
    // Prefer optional Sensebook server translate if configured
    if (hasOptionalApi()) {
      try {
        const { data } = await gmFetch(getApiUrl() + '/translate', {
          method: 'POST',
          headers: authHeaders(),
          body: { text },
        });
        toast(data.translation || '(空)');
        hidePopup();
        return;
      } catch (e) {
        toast(e.message + ' · 已回退本地占位');
        setTimeout(() => toast(clientStubTranslate(text)), 400);
        hidePopup();
        return;
      }
    }
    toast(clientStubTranslate(text));
    hidePopup();
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
              ? '已本地存词并生成 stub 释义（菜单「LLM 设置」可填 Key）：'
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
    if (busy) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
      return;
    }
    const text = sel.toString().trim();
    if (!text || text.length > 200) {
      hidePopup();
      return;
    }
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) return;
    lastSel = {
      text,
      sentence: extractSentence(range),
      rect,
    };
    showPopup(rect);
  }

  document.addEventListener('mouseup', () => {
    setTimeout(onSelectionChange, 10);
  });
  document.addEventListener('touchend', () => {
    setTimeout(onSelectionChange, 50);
  }, { passive: true });

  document.addEventListener('mousedown', (e) => {
    if (busy) return;
    if (popup && !popup.contains(e.target)) hidePopup();
    if (panel && !panel.contains(e.target) && !(popup && popup.contains(e.target))) {
      /* keep panel open unless closed explicitly */
    }
  });
  document.addEventListener('scroll', () => {
    if (!busy) hidePopup();
  }, true);

  // Expose parse helpers for optional page-console smoke (no export in userscript)
  try {
    window.__sensebookParseEnrichJson = parseEnrichJson;
    window.__sensebookBuildEnrichUserPrompt = buildEnrichUserPrompt;
  } catch { /* ignore */ }
})();
