import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import app from "../worker/index.js";
let mf, DB, config, event;
const env = () => ({
  DB,
  DEV_AUTH: "true",
  MODEL_CONFIG_KEY: Buffer.alloc(32, 7).toString("base64"),
});
const req = async (
  path,
  {
    method = "GET",
    body,
    token,
    origin = "http://localhost",
    bindings = env(),
  } = {},
) => {
  const headers = { Origin: origin };
  if (body) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = "Bearer " + token;
  const response = await app.fetch(
    new Request("http://localhost" + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    }),
    bindings,
  );
  return { status: response.status, body: await response.json() };
};
before(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default {fetch(){return new Response("ok")}}',
      compatibilityDate: "2026-09-01",
      d1Databases: ["DB"],
    }),
  );
  DB = await mf.getD1Database("DB");
  for (const migration of ["0001_personal.sql", "0002_model_profiles.sql", "0003_passkeys.sql"]) {
    const statements = readFileSync(
      new URL("../migrations/" + migration, import.meta.url),
      "utf8",
    )
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    await DB.batch(statements.map((s) => DB.prepare(s)));
  }
});
after(async () => {
  await mf?.dispose();
});
test("production fails closed and development identity cannot be used on a public hostname", async () => {
  assert.equal((await req("/api/me", { bindings: { DB } })).status, 503);
  const r = await app.fetch(new Request("https://example.com/api/me"), env());
  assert.equal(r.status, 503);
});
test("website mutations require a same-origin request", async () => {
  assert.equal(
    (
      await req("/api/devices", {
        method: "POST",
        body: { name: "x" },
        origin: "https://evil.example",
      })
    ).status,
    403,
  );
});
test("create personal device and reject missing or invalid device credentials", async () => {
  const r = await req("/api/devices", {
    method: "POST",
    body: { name: "测试电脑" },
  });
  assert.equal(r.status, 201);
  config = r.body.config;
  assert.equal((await req("/sync/me")).status, 401);
  assert.equal(
    (await req("/sync/me", { token: "sb_" + "a".repeat(64) })).status,
    401,
  );
  assert.equal(
    (await req("/sync/me", { token: config.token })).body.account_id,
    config.account_id,
  );
});
test("sync retry is idempotent; later result fills the existing event", async () => {
  event = {
    id: crypto.randomUUID(),
    installation_id: "test-installation",
    selected_text: "give way to",
    context: "Certainty gave way to curiosity.",
    explanation: "",
    status: "pending",
    platform: "macos",
    mode: "sense",
    occurred_at: new Date().toISOString(),
    timezone: "Asia/Shanghai",
  };
  const push = (e) =>
    req("/sync/events", {
      method: "POST",
      token: config.token,
      body: { events: [e] },
    });
  assert.equal((await push(event)).status, 200);
  event = {
    ...event,
    status: "ready",
    explanation: "在这里描述一种状态逐渐被另一种状态取代。",
  };
  await push(event);
  await push(event);
  const r = await req("/api/events");
  assert.equal(r.body.events.length, 1);
  assert.equal(r.body.events[0].explanation, event.explanation);
  assert.equal(r.body.events[0].platform, "macos");
  await push({ ...event, status: "pending", explanation: "" });
  assert.equal((await req("/api/events")).body.events[0].status, "ready");
});
test("device credentials cannot authorize website access or another device mutation", async () => {
  assert.equal(
    (await req("/api/devices", { token: config.token, bindings: { DB } }))
      .status,
    503,
  );
  const second = (
    await req("/api/devices", { method: "POST", body: { name: "另一个设备" } })
  ).body.config;
  await req("/sync/events", {
    method: "POST",
    token: second.token,
    body: { events: [{ ...event, explanation: "attempt overwrite" }] },
  });
  assert.equal(
    (await req("/api/events")).body.events[0].explanation,
    event.explanation,
  );
});
test("search, star, period and review generation persist no API key", async () => {
  await req("/api/events/" + event.id, {
    method: "PATCH",
    body: { starred: true },
  });
  assert.equal(
    (await req("/api/events?q=curiosity&starred=1")).body.events.length,
    1,
  );
  assert.equal((await req("/api/events?q=absent")).body.events.length, 0);
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  const p = {
    start: date.toISOString(),
    end: new Date(+date + 86400000).toISOString(),
    kind: "day",
    timezone: "UTC",
  };
  const before = await req("/api/review?" + new URLSearchParams(p));
  assert.equal(before.body.events.length, 1);
  assert.equal(before.body.review, null);
  const realFetch = globalThis.fetch;
  let sent;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.deepseek.com/chat/completions");
    sent = options;
    return Response.json({
      choices: [
        {
          message: { content: "今天的阅读里，give way to 描述了状态的变化。" },
        },
      ],
    });
  };
  try {
    const r = await req("/api/review", {
      method: "POST",
      body: { ...p, api_key: "private-test-key", model: "deepseek-chat" },
    });
    assert.equal(r.status, 200);
    assert.ok(r.body.review.content.includes("give way to"));
    assert.equal(sent.headers.Authorization, "Bearer private-test-key");
    const saved = await DB.prepare("SELECT * FROM reviews").all();
    assert.equal(saved.results.length, 1);
    assert.ok(!JSON.stringify(saved.results).includes("private-test-key"));
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(
    (await req("/api/review?" + new URLSearchParams(p))).body.stale,
    false,
  );
});
test("deletion removes review text and tombstone prevents resurrection on retry", async () => {
  assert.equal(
    (await req("/api/events/" + event.id, { method: "DELETE" })).status,
    200,
  );
  assert.equal(
    (await DB.prepare("SELECT * FROM reviews").all()).results.length,
    0,
  );
  const r = await req("/sync/events", {
    method: "POST",
    token: config.token,
    body: { events: [event] },
  });
  assert.deepEqual(r.body.deleted, [event.id]);
  assert.equal((await req("/api/events")).body.events.length, 0);
  const row = await DB.prepare("SELECT * FROM query_events WHERE id=?")
    .bind(event.id)
    .first();
  assert.equal(row.context, "");
  assert.equal(row.explanation, "");
  assert.equal(
    (await req("/sync/deletions", { token: config.token })).body.deleted[0].id,
    event.id,
  );
});
test("revoked device loses sync access", async () => {
  await req("/api/devices/" + config.device_id, { method: "DELETE" });
  assert.equal((await req("/sync/me", { token: config.token })).status, 401);
});

test("account model secrets stay encrypted; default delivery and revocation", async () => {
  const fields = {
    name: "测试模型",
    base_url: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    api_key: "synthetic-account-key",
  };
  const created = await req("/api/model-profiles", {
    method: "POST",
    body: fields,
  });
  assert.equal(created.status, 200);
  const id = created.body.id;
  const listed = await req("/api/model-profiles");
  assert.equal(listed.body.profiles[0].is_default, true);
  assert.ok(!JSON.stringify(listed).includes(fields.api_key));
  assert.ok(!JSON.stringify(listed).includes("ciphertext"));
  const row = await DB.prepare("SELECT * FROM model_profiles WHERE id=?")
    .bind(id)
    .first();
  assert.ok(!row.api_key_ciphertext.includes(fields.api_key));
  const { openApiKey } = await import("../worker/model-profiles.js");
  assert.equal(await openApiKey(env(), row), fields.api_key);
  await assert.rejects(() =>
    openApiKey(env(), { ...row, user_id: "other-owner" }),
  );
  assert.equal(
    (
      await req("/api/model-profiles/" + id, {
        method: "PUT",
        body: { ...fields, api_key: "", name: "改名" },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await req("/api/model-profiles/" + id, {
        method: "PUT",
        body: { ...fields, api_key: "", base_url: "https://other.example/v1" },
      })
    ).status,
    400,
  );
  const device = (
    await req("/api/devices", { method: "POST", body: { name: "模型测试端" } })
  ).body.config;
  assert.equal((await req("/sync/model-config")).status, 401);
  assert.equal(
    (await req("/sync/model-config", { token: device.token })).body.profile
      .api_key,
    fields.api_key,
  );
  const second = await req("/api/model-profiles", {
    method: "POST",
    body: { ...fields, name: "第二模型", is_default: true },
  });
  assert.equal(
    (await req("/api/model-profiles")).body.profiles.filter((p) => p.is_default)
      .length,
    1,
  );
  assert.equal(
    (await req("/sync/model-config", { token: device.token })).body.profile.id,
    second.body.id,
  );
  await req("/api/model-profiles/" + second.body.id, { method: "DELETE" });
  assert.equal(
    (await req("/sync/model-config", { token: device.token })).body.profile,
    null,
  );
  await req("/api/devices/" + device.device_id, { method: "DELETE" });
  assert.equal(
    (await req("/sync/model-config", { token: device.token })).status,
    401,
  );
});

test("model encryption requires deployment secret and proxy rejects arbitrary hosts", async () => {
  const { sealApiKey, reviewEndpoint } =
    await import("../worker/model-profiles.js");
  await assert.rejects(() => sealApiKey({}, "owner", "profile", "test"));
  assert.throws(() => reviewEndpoint({}, "https://untrusted.example/v1"));
  assert.equal(
    reviewEndpoint({}, "https://api.openai.com/v1"),
    "https://api.openai.com/v1/chat/completions",
  );
});
