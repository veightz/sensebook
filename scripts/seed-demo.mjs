// 仅写本地开发数据库，用明确标记的示例验证 UI；不上传用户数据。
const base = "http://127.0.0.1:8788";
async function api(path, body, token) {
  const r = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: {
      Origin: base,
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw Error("本地服务不可用：" + r.status);
  return r.json();
}
const me = await api("/api/me");
if (!me.local) throw Error("只允许本地开发身份");
const { config } = await api("/api/devices", { name: "示例 · 电脑阅读" });
const samples = [
  [
    "give way to",
    "Certainty slowly gave way to curiosity.",
    "这里描述一种状态逐渐被另一种状态取代：笃定慢慢变成了好奇。",
  ],
  [
    "in the long run",
    "Small, consistent efforts make a difference in the long run.",
    "把观察的时间拉长：短期看起来很小的投入，长期会带来变化。",
  ],
  [
    "a sense of belonging",
    "The familiar voices gave her a sense of belonging.",
    "这里强调熟悉的人声带来的归属感，而不是 belonging 的物品含义。",
  ],
];
const events = samples.map(([selected_text, context, explanation], i) => ({
  id: crypto.randomUUID(),
  installation_id: "local-demo",
  selected_text,
  context,
  explanation,
  status: "ready",
  source_title: "本地演示内容，非真实查询",
  source_url: "",
  platform: "userscript",
  mode: "sense",
  occurred_at: new Date(Date.now() - i * 1800000).toISOString(),
  timezone: "Asia/Shanghai",
}));
await api("/sync/events", { events }, config.token);
console.log("已添加 3 条明确标记的本地演示查询。");
