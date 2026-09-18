import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
function harness() {
  const source = readFileSync(
    new URL("../userscript/sensebook.user.js", import.meta.url),
    "utf8",
  );
  const block = source.slice(
    source.indexOf("  // ---- 持久查询事件"),
    source.indexOf("  // ---- query cache"),
  );
  const storage = new Map();
  let uid = 0;
  const sandbox = {
    storeGet: (k, d) => storage.get(k) ?? d,
    storeSet: (k, v) => storage.set(k, structuredClone(v)),
    GM_getValue: (k, d) => storage.get(k) ?? d,
    GM_setValue: (k, v) => storage.set(k, structuredClone(v)),
    GM_listValues: () => [...storage.keys()],
    coerceStoreValue: (x) => x,
    uuid: () => `query-id-${++uid}`,
    location: { href: "https://example.com/article" },
    document: { title: "文章" },
    Intl,
    Date,
    Map,
    TextEncoder,
    setTimeout: () => 0,
    clearTimeout: () => {},
    selectionGen: 1,
    LLM_API_KEY_KEY: "model-key",
    LLM_BASE_URL_KEY: "model-base",
    LLM_MODEL_KEY: "model-name",
    LLM_THINKING_KEY: "model-thinking",
    saveQueryCache: () => {},
    makeCacheKey: (w, s) => w + "::" + s,
  };
  vm.createContext(sandbox);
  vm.runInContext(
    block +
      "\nthis.history={beginQueryEvent,finishQueryEvent,recordCompletedQuery,recordedLookup,allQueryEvents,syncQueryHistory};",
    sandbox,
  );
  return { storage, sandbox, history: sandbox.history };
}
test("cache hits remain separate events and more than 250 records survive", () => {
  const { history } = harness();
  for (let i = 0; i < 270; i++)
    history.recordCompletedQuery(
      { word: "give way", sentence: "Things give way." },
      { translation: "让步" },
      "translate",
      true,
    );
  assert.equal(history.allQueryEvents().length, 270);
  assert.ok(history.allQueryEvents().every((e) => e.from_cache));
});
test("failed lookup is retained and concurrent callbacks create only one event", async () => {
  const { history } = harness();
  let resolve;
  const operation = () =>
    new Promise((r) => {
      resolve = r;
    });
  const args = { word: "term", sentence: "a term" };
  const a = history.recordedLookup(args, "sense", operation),
    b = history.recordedLookup(args, "sense", operation);
  resolve({ record: { ai_word_sense: "词语" }, fromCache: false });
  await Promise.all([a, b]);
  assert.equal(history.allQueryEvents().length, 1);
  await assert.rejects(() =>
    history.recordedLookup(args, "sense", async () => {
      throw new Error("offline");
    }),
  );
  assert.equal(
    history.allQueryEvents().filter((e) => e.status === "failed").length,
    1,
  );
});
test("sync remains opt-in; successful retry marks current revision and receives deletions", async () => {
  const { history, storage, sandbox } = harness();
  const id = history.recordCompletedQuery(
    { word: "term" },
    { translation: "词语" },
    "translate",
  );
  let calls = 0;
  sandbox.gmFetch = async () => {
    calls++;
    throw Error("unexpected network");
  };
  await history.syncQueryHistory();
  assert.equal(calls, 0);
  storage.set("sensebook_personal_sync", {
    enabled: true,
    endpoint: "https://site.example",
    token: "private",
    account_id: "owner",
    device_id: "device",
    include_history: true,
  });
  sandbox.gmFetch = async (url, opts) => {
    calls++;
    if (url.endsWith("/me"))
      return { data: { account_id: "owner", device_id: "device" } };
    if (url.endsWith("/events"))
      return { data: { accepted: [id], deleted: [] } };
    return { data: { deleted: [], has_more: false } };
  };
  await history.syncQueryHistory();
  assert.equal(
    storage.get("sensebook_event_v1_" + id).synced_revision,
    storage.get("sensebook_event_v1_" + id).revision,
  );
  sandbox.gmFetch = async (url) => ({
    data: url.endsWith("/me")
      ? { account_id: "owner", device_id: "device" }
      : { deleted: [{ id, seq: 1 }], has_more: false },
  });
  await history.syncQueryHistory();
  assert.equal(history.allQueryEvents().length, 0);
});
test("switching account does not upload another account’s local records", async () => {
  const { history, storage, sandbox } = harness();
  const id = history.recordCompletedQuery(
    { word: "private" },
    { translation: "secret" },
    "translate",
  );
  storage.get("sensebook_event_v1_" + id).account_id = "first-owner";
  storage.set("sensebook_personal_sync", {
    enabled: true,
    endpoint: "https://site.example",
    token: "private",
    account_id: "second-owner",
    device_id: "device",
    include_history: true,
  });
  sandbox.gmFetch = async (url) => {
    assert.ok(!url.endsWith("/events"));
    return {
      data: url.endsWith("/me")
        ? { account_id: "second-owner", device_id: "device" }
        : { deleted: [], has_more: false },
    };
  };
  await history.syncQueryHistory();
});

test("model-only connection configures device without uploading history; manual override survives", async () => {
  const { history, storage, sandbox } = harness();
  storage.set("sensebook_personal_sync", {
    enabled: true,
    endpoint: "https://site.example",
    token: "private",
    account_id: "owner",
    device_id: "device",
    sync_records: false,
  });
  history.recordCompletedQuery(
    { word: "private" },
    { translation: "private" },
    "translate",
  );
  sandbox.gmFetch = async (url) => {
    if (url.endsWith("/me"))
      return { data: { account_id: "owner", device_id: "device" } };
    assert.ok(url.endsWith("/model-config"));
    return {
      data: {
        profile: {
          id: "p",
          name: "test",
          updated_at: "v1",
          api_key: "synthetic-key",
          model: "test-model",
          base_url: "https://api.example/v1",
        },
      },
    };
  };
  await history.syncQueryHistory();
  assert.equal(storage.get("model-key"), "synthetic-key");
  assert.equal(storage.get("sensebook_personal_sync").model_error, "");
  storage.get("sensebook_personal_sync").model_sync = false;
  storage.set("model-key", "manual");
  await history.syncQueryHistory();
  assert.equal(storage.get("model-key"), "manual");
});
