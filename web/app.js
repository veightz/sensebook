const $ = (id) => document.getElementById(id);
const state = {
  events: [],
  next: null,
  starred: false,
  kind: "day",
  review: null,
  sources: [],
  period: null,
  historyRequest: 0,
  reviewRequest: 0,
};
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const fmt = (s) =>
  new Date(s).toLocaleString("zh-CN", {
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
const localDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const statusLabel = {
  pending: "查询中",
  failed: "查询未完成",
  stub: "未配置模型",
  local: "本地词典",
  ready: "语境解释",
};
function notice(text, error = false) {
  $("notice").textContent = text;
  $("notice").hidden = !text;
  $("notice").classList.toggle("error", error);
}
async function api(path, { method = "GET", body } = {}) {
  const r = await fetch("/api" + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let data;
  try {
    data = await r.json();
  } catch {
    throw new Error("服务未正确响应，请检查部署配置");
  }
  if (!r.ok) {
    if (r.status === 401) {
      $("workspace").hidden = true;
      $("signed-out").hidden = false;
    }
    throw new Error(data.error || "请求失败");
  }
  return data;
}
function run(fn) {
  return async (e) => {
    try {
      await fn(e);
    } catch (err) {
      notice(err.message, true);
    }
  };
}
function tab(name) {
  document.querySelectorAll(".page").forEach((e) => (e.hidden = e.id !== name));
  document
    .querySelectorAll("[data-tab]")
    .forEach((e) => e.classList.toggle("active", e.dataset.tab === name));
  if (name === "review") loadReview().catch((e) => notice(e.message, true));
  if (name === "settings") loadDevices().catch((e) => notice(e.message, true));
}
document
  .querySelectorAll("[data-tab]")
  .forEach((b) => (b.onclick = () => tab(b.dataset.tab)));
$("today").textContent = new Date().toLocaleDateString("zh-CN", {
  year: "numeric",
  month: "long",
  day: "numeric",
});
$("review-date").value = localDate(new Date());
$("api-key").value = sessionStorage.getItem("sensebook_review_key") || "";
$("model").value =
  localStorage.getItem("sensebook_review_model") || "deepseek-chat";
function recordHtml(e) {
  return `<article class="record"><div class="record-top"><h2 class="record-word">${esc(e.selected_text)}</h2><button class="star ${e.starred ? "on" : ""}" data-star="${esc(e.id)}" aria-label="${e.starred ? "取消收藏" : "收藏"}" aria-pressed="${!!e.starred}">${e.starred ? "★" : "☆"}</button></div><p class="context">${esc(e.context || "本次查询没有取得完整原句。")}</p><p class="explanation">${esc(e.explanation || statusLabel[e.status] || "暂无解释")}</p><div class="record-bottom"><span class="tag">${esc(e.device_name || e.platform || "查询")}</span><span class="meta">${esc(fmt(e.occurred_at))}</span>${e.from_cache ? '<span class="tag">缓存回看</span>' : ""}${e.origin === "legacy" ? '<span class="tag">历史导入</span>' : ""}<button class="quiet" data-detail="${esc(e.id)}">原句与来源 ↗</button></div></article>`;
}
async function loadHistory(more = false) {
  const request = ++state.historyRequest;
  $("refresh-history").disabled = true;
  $("load-more").disabled = true;
  try {
    const p = new URLSearchParams({
      q: $("search").value,
      starred: state.starred ? "1" : "0",
    });
    if (more && state.next) p.set("before", state.next);
    const data = await api("/events?" + p);
    if (request !== state.historyRequest) return;
    state.events = more ? [...state.events, ...data.events] : data.events;
    state.next = data.next;
    $("history-list").innerHTML = state.events.length
      ? state.events.map(recordHtml).join("")
      : `<div class="empty"><span class="empty-icon">“ ”</span><h2>${$("search").value || state.starred ? "还没有匹配的记录" : "你的下一次查询，是这里的开始。"}</h2><p>在电脑脚本或 Android 中开启可选同步，<br>你查过的表达和原句就会出现在这里。</p><button class="quiet" id="connect-empty">连接一个查询设备 ↗</button></div>`;
    if ($("connect-empty")) $("connect-empty").onclick = () => tab("settings");
    $("history-count").textContent = `已显示 ${state.events.length} 条`;
    $("load-more").hidden = !state.next;
  } finally {
    $("refresh-history").disabled = false;
    $("load-more").disabled = false;
  }
}
$("refresh-history").onclick = run(() => loadHistory());
$("load-more").onclick = run(() => loadHistory(true));
let searchTimer;
$("search").oninput = () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(
    () => loadHistory().catch((e) => notice(e.message, true)),
    250,
  );
};
$("star-filter").onclick = run(async () => {
  state.starred = !state.starred;
  $("star-filter").setAttribute("aria-pressed", state.starred);
  await loadHistory();
});
$("history-list").onclick = run(async (e) => {
  const star = e.target.closest("[data-star]"),
    detail = e.target.closest("[data-detail]");
  if (star) {
    const item = state.events.find((x) => x.id === star.dataset.star);
    await api("/events/" + encodeURIComponent(item.id), {
      method: "PATCH",
      body: { starred: !item.starred },
    });
    await loadHistory();
  }
  if (detail)
    showDetail(state.events.find((x) => x.id === detail.dataset.detail));
});
function showDetail(e) {
  if (!e) return;
  const url = safeUrl(e.source_url);
  $("event-detail").innerHTML =
    `<span class="eyebrow">${esc(fmt(e.occurred_at))}</span><h2>${esc(e.selected_text)}</h2><p class="detail-heading">当时的原句</p><p class="detail-text">${esc(e.context || "没有完整语境，不能据此推断具体用法。")}</p><p class="detail-heading">当时的解释 · ${esc(statusLabel[e.status])}</p><p class="detail-text">${esc(e.explanation || "没有保存解释")}</p><p class="detail-heading">${esc(e.device_name || e.platform || "")} · ${esc(e.source_title || e.source_app || "未记录页面标题")}</p><div class="detail-actions">${url ? `<a class="quiet" href="${esc(url)}" target="_blank" rel="noopener noreferrer">打开原始来源 ↗</a>` : ""}<button class="quiet danger" id="delete-event">删除此记录</button></div>`;
  $("delete-event").onclick = run(async () => {
    if (
      !confirm(
        "删除此查询记录？包含它的回顾也会清除，设备同步后不会恢复此记录。",
      )
    )
      return;
    await api("/events/" + encodeURIComponent(e.id), { method: "DELETE" });
    $("event-dialog").close();
    notice("记录已删除，相关回顾已清除。");
    await loadHistory();
    if (!$("review").hidden) await loadReview();
  });
  $("event-dialog").showModal();
}
function safeUrl(s) {
  try {
    const u = new URL(s);
    return ["http:", "https:"].includes(u.protocol) ? u.href : "";
  } catch {
    return "";
  }
}
$("close-dialog").onclick = () => $("event-dialog").close();
function getPeriod() {
  const parts = $("review-date").value.split("-").map(Number);
  if (parts.length !== 3 || parts.some((x) => !x))
    throw new Error("请选择日期");
  let start = new Date(parts[0], parts[1] - 1, parts[2]);
  if (state.kind === "week")
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  if (state.kind === "month") start.setDate(1);
  let end = new Date(start);
  if (state.kind === "month") end.setMonth(end.getMonth() + 1);
  else end.setDate(end.getDate() + (state.kind === "week" ? 7 : 1));
  return {
    kind: state.kind,
    start: start.toISOString(),
    end: end.toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}
function renderReview(data) {
  state.review = data.review;
  state.sources = data.events;
  $("source-count").textContent = `${data.events.length} 次查询`;
  $("review-meta").textContent = data.review
    ? `${fmt(data.review.created_at)} 生成`
    : "";
  $("review-content").textContent =
    data.review?.content ||
    (data.events.length
      ? "这些原句已经准备好了。\n点击下方生成回顾，把这一段阅读中的表达重新串联起来。"
      : "这段时间还没有同步的查询记录。\n可以选择其他日期，或先连接你的查询设备。");
  $("generate-review").disabled = !data.events.length;
  $("generate-review").textContent = data.review
    ? "✧ 重新生成回顾"
    : "✧ 生成回顾";
  $("generation-hint").textContent = data.stale
    ? "本期记录已变化，可以更新回顾"
    : "使用你自己的 DeepSeek Key";
  $("source-list").innerHTML = data.events
    .map(
      (e) =>
        `<button class="source-item" data-source="${esc(e.id)}"><strong>${esc(e.selected_text)}</strong><span>${esc((e.context || "没有完整原句").slice(0, 130))}</span></button>`,
    )
    .join("");
}
async function loadReview() {
  const request = ++state.reviewRequest,
    p = getPeriod();
  state.period = p;
  const start = new Date(p.start),
    last = new Date(new Date(p.end).getTime() - 1);
  $("period-label").textContent = {
    day: "每日回顾",
    week: "每周回顾",
    month: "每月回顾",
  }[state.kind];
  $("review-title").textContent =
    state.kind === "day"
      ? `${start.getMonth() + 1} 月 ${start.getDate()} 日的阅读线索`
      : `${localDate(start)} — ${localDate(last)}`;
  $("generate-review").disabled = true;
  $("review-content").textContent = "正在整理这段时间的查询…";
  const data = await api("/review?" + new URLSearchParams(p));
  if (request !== state.reviewRequest) return;
  renderReview(data);
}
document.querySelectorAll("[data-kind]").forEach(
  (b) =>
    (b.onclick = run(async () => {
      state.kind = b.dataset.kind;
      document
        .querySelectorAll("[data-kind]")
        .forEach((x) => x.classList.toggle("active", x === b));
      await loadReview();
    })),
);
$("load-review").onclick = run(loadReview);
$("review-date").onchange = run(loadReview);
$("source-list").onclick = (e) => {
  const b = e.target.closest("[data-source]");
  if (b) showDetail(state.sources.find((x) => x.id === b.dataset.source));
};
$("generate-review").onclick = run(async () => {
  const key = $("api-key").value.trim();
  if (!key) {
    notice("请先在「连接与设置」填写当前浏览器的 DeepSeek Key。");
    tab("settings");
    $("api-key").focus();
    return;
  }
  const p = state.period,
    request = ++state.reviewRequest;
  $("generate-review").disabled = true;
  $("generate-review").textContent = "正在生成，请稍候…";
  notice("正在使用你的 Key 生成回顾。查询内容将发送至 DeepSeek。");
  try {
    const data = await api("/review", {
      method: "POST",
      body: { ...p, api_key: key, model: $("model").value.trim() },
    });
    if (request === state.reviewRequest) renderReview(data);
    notice("回顾已保存，其他设备登录后也能阅读。");
  } finally {
    if (request === state.reviewRequest) {
      $("generate-review").disabled = !state.sources.length;
      $("generate-review").textContent = state.review
        ? "✧ 重新生成回顾"
        : "✧ 生成回顾";
    }
  }
});
$("model-form").onsubmit = (e) => {
  e.preventDefault();
  sessionStorage.setItem("sensebook_review_key", $("api-key").value.trim());
  localStorage.setItem("sensebook_review_model", $("model").value.trim());
  notice("已保存到当前标签页，Key 不会同步到云端。");
};
$("clear-key").onclick = () => {
  sessionStorage.removeItem("sensebook_review_key");
  $("api-key").value = "";
  notice("当前标签页的 Key 已清除。");
};
async function loadDevices() {
  const { devices } = await api("/devices");
  $("devices").innerHTML = devices.length
    ? devices
        .map(
          (d) =>
            `<div class="device-row"><div><strong>${esc(d.name)}</strong><span class="meta">${d.revoked_at ? "已撤销" : d.last_seen_at ? "最近同步 " + esc(fmt(d.last_seen_at)) : "等待设备连接"}</span></div>${d.revoked_at ? "" : `<button class="quiet danger" data-revoke="${esc(d.id)}">撤销连接</button>`}</div>`,
        )
        .join("")
    : '<p class="meta">还没有连接设备。翻译工具不登录也能使用。</p>';
}
$("device-form").onsubmit = run(async (e) => {
  e.preventDefault();
  const b = e.submitter;
  b.disabled = true;
  try {
    const { config } = await api("/devices", {
      method: "POST",
      body: { name: $("device-name").value },
    });
    $("config-value").value = JSON.stringify(config);
    $("new-config").hidden = false;
    await loadDevices();
  } finally {
    b.disabled = false;
  }
});
$("copy-config").onclick = run(async () => {
  await navigator.clipboard.writeText($("config-value").value);
  notice("连接配置已复制，请只粘贴到你自己的查询设备。");
});
$("hide-config").onclick = () => {
  $("config-value").value = "";
  $("new-config").hidden = true;
};
$("refresh-devices").onclick = run(loadDevices);
$("devices").onclick = run(async (e) => {
  const b = e.target.closest("[data-revoke]");
  if (b && confirm("撤销后，此设备将停止同步；本地查询仍可使用。")) {
    await api("/devices/" + encodeURIComponent(b.dataset.revoke), {
      method: "DELETE",
    });
    await loadDevices();
  }
});
$("logout").onclick = run(async () => {
  await api("/logout", { method: "POST" });
  sessionStorage.removeItem("sensebook_review_key");
  $("api-key").value = "";
  location.assign("/");
});
try {
  const user = await api("/me");
  $("identity").textContent = user.email;
  $("workspace").hidden = false;
  if (user.local) notice("本地预览模式：数据保存在本机，尚未连接 Cloudflare。");
  await loadHistory();
} catch (e) {
  $("signed-out").hidden = false;
  notice(e.message, true);
}
