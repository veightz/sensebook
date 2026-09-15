// ==UserScript==
// @name         Sensebook 划词
// @namespace    https://github.com/veightz/sensebook
// @version      0.1.0
// @description  划词翻译 / 存词 / AI 释义 — Sensebook
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

  const DEFAULT_API = 'http://127.0.0.1:8787';

  function getApiUrl() {
    return GM_getValue('sensebook_api_url', DEFAULT_API).replace(/\/$/, '');
  }
  function getToken() {
    return GM_getValue('sensebook_token', '');
  }

  GM_registerMenuCommand('Sensebook：设置 API 地址', () => {
    const cur = getApiUrl();
    const v = prompt('Sensebook API 地址（如 http://127.0.0.1:8787）', cur);
    if (v != null && v.trim()) GM_setValue('sensebook_api_url', v.trim());
  });

  GM_registerMenuCommand('Sensebook：设置 Token', () => {
    const cur = getToken();
    const v = prompt('粘贴登录后的 JWT Token', cur);
    if (v != null) GM_setValue('sensebook_token', v.trim());
  });

  GM_registerMenuCommand('Sensebook：清除 Token', () => {
    GM_setValue('sensebook_token', '');
    toast('已清除 Token');
  });

  let popup = null;
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
    el._t = setTimeout(() => { el.style.display = 'none'; }, 2500);
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

    const mkBtn = (label, onClick) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      Object.assign(b.style, {
        minHeight: '44px',
        minWidth: '64px',
        padding: '8px 12px',
        border: 'none',
        borderRadius: '8px',
        background: '#2563eb',
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
    const aiBtn = mkBtn('AI释义', () => doSave(true));
    aiBtn.style.background = '#7c3aed';
    popup.appendChild(aiBtn);

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
    if (!t) throw new Error('请先在油猴菜单设置 Sensebook Token（网页登录后复制）');
    return { Authorization: 'Bearer ' + t };
  }

  async function doTranslate() {
    try {
      const data = await gmFetch(getApiUrl() + '/translate', {
        method: 'POST',
        headers: authHeaders(),
        body: { text: lastSel.text || lastSel.sentence },
      });
      toast(data.translation || '(空)');
      hidePopup();
    } catch (e) {
      toast(e.message);
    }
  }

  async function doSave(enrich) {
    try {
      const entry = await gmFetch(getApiUrl() + '/entries', {
        method: 'POST',
        headers: authHeaders(),
        body: {
          word: lastSel.text,
          sentence: lastSel.sentence || lastSel.text,
          source_url: location.href,
        },
      });
      if (enrich && entry.id) {
        toast('已存词，正在 AI 释义…');
        await gmFetch(getApiUrl() + '/entries/' + entry.id + '/enrich', {
          method: 'POST',
          headers: authHeaders(),
          body: {},
        });
        toast('已存词并完成 AI 释义');
      } else {
        toast('已存词：' + entry.word);
      }
      hidePopup();
    } catch (e) {
      toast(e.message);
    }
  }

  function onSelectionChange() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
      // don't hide immediately on mobile if tapping popup
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
  });
  document.addEventListener('scroll', () => hidePopup(), true);
})();
