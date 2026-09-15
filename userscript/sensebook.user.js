// ==UserScript==
// @name         Sensebook 划词
// @namespace    https://github.com/veightz/sensebook
// @version      0.2.0
// @description  划词翻译 / 存词 / AI 释义 — Sensebook（本地优先，可不登录）
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

  function createLocalEntry({ word, sentence, source_url, enrich }) {
    const now = new Date().toISOString();
    const entry = {
      id: uuid(),
      word: word || '',
      sentence: sentence || word || '',
      ai_sentence_gloss: null,
      ai_word_sense: null,
      source_url: source_url || '',
      tags: [],
      status: enrich ? 'ready' : 'pending_ai',
      created_at: now,
    };
    if (enrich) {
      const stub = clientStubEnrich(entry.word, entry.sentence);
      entry.ai_sentence_gloss = stub.ai_sentence_gloss;
      entry.ai_word_sense = stub.ai_word_sense;
      entry.status = 'ready';
    }
    const list = loadEntries();
    list.unshift(entry);
    saveEntries(list);
    return entry;
  }

  function clientStubEnrich(word, sentence) {
    return {
      ai_sentence_gloss: `[本地 stub] 句意占位：${(sentence || '').slice(0, 80)}`,
      ai_word_sense: `[本地 stub] 「${word}」在句中的义项（未配置 API，仅占位）`,
    };
  }

  function clientStubTranslate(text) {
    return `[本地翻译占位] ${text}\n（未配置 API，请在菜单「登录/同步（可选）」中填写地址与 Token 以启用在线翻译）`;
  }

  // ---- menus ----
  GM_registerMenuCommand('Sensebook：我的生词（本地）', () => {
    showLocalPanel();
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
    toast('默认本地优先：存词写入油猴存储，无需登录 / API');
  });

  let popup = null;
  let panel = null;
  let lastSel = { text: '', sentence: '', rect: null };

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
    el._t = setTimeout(() => { el.style.display = 'none'; }, 2800);
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
        onClick();
      });
      return b;
    };

    popup.appendChild(mkBtn('翻译', () => doTranslate()));
    popup.appendChild(mkBtn('存词', () => doSave(false)));
    popup.appendChild(mkBtn('AI释义', () => doSave(true), '#7c3aed'));
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
    header.innerHTML = `<div>
      <div style="font-weight:700;font-size:16px;">我的生词（本地）</div>
      <div style="font-size:12px;color:#64748b;margin-top:2px;">无需登录 · 油猴/本地存储 · 共 ${entries.length} 条</div>
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

    body.addEventListener('click', (ev) => {
      const enrichId = ev.target.getAttribute && ev.target.getAttribute('data-enrich-local');
      const delId = ev.target.getAttribute && ev.target.getAttribute('data-del-local');
      if (enrichId) {
        const list = loadEntries();
        const idx = list.findIndex((x) => x.id === enrichId);
        if (idx >= 0) {
          const stub = clientStubEnrich(list[idx].word, list[idx].sentence);
          list[idx].ai_sentence_gloss = stub.ai_sentence_gloss;
          list[idx].ai_word_sense = stub.ai_word_sense;
          list[idx].status = 'ready';
          // optional server enrich if configured
          if (hasOptionalApi()) {
            optionalServerEnrich(list[idx]).then((updated) => {
              if (updated) {
                const cur = loadEntries();
                const i = cur.findIndex((x) => x.id === enrichId);
                if (i >= 0) {
                  cur[i] = { ...cur[i], ...updated, status: 'ready' };
                  saveEntries(cur);
                }
                showLocalPanel();
              }
            }).catch(() => { /* keep stub */ });
          }
          saveEntries(list);
          toast('已生成本地 AI 释义（stub）');
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
          if (res.status >= 200 && res.status < 300) resolve(data);
          else reject(new Error(data.error || `HTTP ${res.status}`));
        },
        onerror: () => reject(new Error('网络错误，请检查 API 地址与 CORS')),
      });
    });
  }

  function authHeaders() {
    const t = getToken();
    if (!t) throw new Error('未配置 Token');
    return { Authorization: 'Bearer ' + t };
  }

  async function optionalServerEnrich(entry) {
    try {
      // Prefer updating an existing server entry only if we have one synced; for local id, create then enrich
      const created = await gmFetch(getApiUrl() + '/entries', {
        method: 'POST',
        headers: authHeaders(),
        body: {
          word: entry.word,
          sentence: entry.sentence,
          source_url: entry.source_url,
        },
      });
      if (created && created.id) {
        const enriched = await gmFetch(getApiUrl() + '/entries/' + created.id + '/enrich', {
          method: 'POST',
          headers: authHeaders(),
          body: {},
        });
        return {
          ai_sentence_gloss: enriched.ai_sentence_gloss || created.ai_sentence_gloss,
          ai_word_sense: enriched.ai_word_sense || created.ai_word_sense,
        };
      }
    } catch {
      return null;
    }
    return null;
  }

  async function doTranslate() {
    const text = lastSel.text || lastSel.sentence;
    if (!hasOptionalApi()) {
      toast(clientStubTranslate(text));
      hidePopup();
      return;
    }
    try {
      const data = await gmFetch(getApiUrl() + '/translate', {
        method: 'POST',
        headers: authHeaders(),
        body: { text },
      });
      toast(data.translation || '(空)');
      hidePopup();
    } catch (e) {
      toast(e.message + ' · 已回退本地占位');
      setTimeout(() => toast(clientStubTranslate(text)), 400);
    }
  }

  async function doSave(enrich) {
    // Primary path: always save locally (no login required)
    try {
      const entry = createLocalEntry({
        word: lastSel.text,
        sentence: lastSel.sentence || lastSel.text,
        source_url: location.href,
        enrich,
      });

      // Optional: also push to server when API+token configured
      if (hasOptionalApi()) {
        try {
          const remote = await gmFetch(getApiUrl() + '/entries', {
            method: 'POST',
            headers: authHeaders(),
            body: {
              word: entry.word,
              sentence: entry.sentence,
              source_url: entry.source_url,
            },
          });
          if (enrich && remote && remote.id) {
            const enriched = await gmFetch(getApiUrl() + '/entries/' + remote.id + '/enrich', {
              method: 'POST',
              headers: authHeaders(),
              body: {},
            });
            const list = loadEntries();
            const idx = list.findIndex((x) => x.id === entry.id);
            if (idx >= 0) {
              list[idx].ai_sentence_gloss = enriched.ai_sentence_gloss || list[idx].ai_sentence_gloss;
              list[idx].ai_word_sense = enriched.ai_word_sense || list[idx].ai_word_sense;
              list[idx].status = 'ready';
              saveEntries(list);
            }
            toast('已本地存词并可选同步 + AI 释义：' + entry.word);
          } else {
            toast('已本地存词（并已可选同步）：' + entry.word);
          }
        } catch (syncErr) {
          toast(
            enrich
              ? '已本地存词+stub 释义（同步失败：' + syncErr.message + '）：' + entry.word
              : '已本地存词（同步失败：' + syncErr.message + '）：' + entry.word
          );
        }
      } else {
        toast(
          enrich
            ? '已本地存词并生成 stub 释义：' + entry.word
            : '已本地存词：' + entry.word
        );
      }
      hidePopup();
    } catch (e) {
      toast(e.message || '存词失败');
    }
  }

  function onSelectionChange() {
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
    if (popup && !popup.contains(e.target)) hidePopup();
    if (panel && !panel.contains(e.target) && !(popup && popup.contains(e.target))) {
      /* keep panel open unless closed explicitly */
    }
  });
  document.addEventListener('scroll', () => hidePopup(), true);
})();
