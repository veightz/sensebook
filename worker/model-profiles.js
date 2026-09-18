const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
const encode = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const decode = (value) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
async function encryptionKey(env) {
  let bytes;
  try {
    bytes = decode(env.MODEL_CONFIG_KEY || "");
  } catch {}
  if (bytes?.length !== 32)
    throw fail("站点尚未配置模型密钥加密，请先设置 MODEL_CONFIG_KEY", 503);
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}
// AAD 绑定账号和配置，数据库中的密文不能被交换到另一个账号/配置。
export async function sealApiKey(env, userId, id, plain) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aad = new TextEncoder().encode(`sensebook:model:v1:${userId}:${id}`);
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad },
    await encryptionKey(env),
    new TextEncoder().encode(plain),
  );
  return `v1.${encode(iv)}.${encode(cipher)}`;
}
export async function openApiKey(env, row) {
  const key = await encryptionKey(env);
  try {
    const [version, iv, cipher] = row.api_key_ciphertext.split(".");
    if (version !== "v1") throw Error();
    return new TextDecoder().decode(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: decode(iv),
          additionalData: new TextEncoder().encode(
            `sensebook:model:v1:${row.user_id}:${row.id}`,
          ),
        },
        key,
        decode(cipher),
      ),
    );
  } catch {
    throw fail("模型密钥无法解密，请检查站点加密密钥或重新保存配置", 503);
  }
}
export function profileMetadata(row) {
  return {
    id: row.id,
    name: row.name,
    base_url: row.base_url,
    model: row.model,
    key_hint: row.key_hint,
    thinking: !!row.thinking,
    is_default: !!row.is_default,
    updated_at: row.updated_at,
  };
}
export function profileFields(body) {
  const text = (v, max) =>
    typeof v === "string" && v.trim().length <= max ? v.trim() : "";
  const name = text(body.name, 80),
    model = text(body.model, 100);
  if (!name || !model || /[\r\n]/.test(model))
    throw fail("请填写配置名称和模型名称");
  let url;
  try {
    url = new URL(body.base_url);
  } catch {
    throw fail("请填写有效的 HTTPS Base URL");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw fail("Base URL 必须使用 HTTPS，且不含账号、查询参数或片段");
  if (url.pathname.endsWith("/chat/completions"))
    throw fail("请填写接口根地址，不要包含 /chat/completions");
  const base_url = url.href.replace(/\/+$/, "");
  if (base_url.length > 500) throw fail("Base URL 过长");
  const api_key = text(body.api_key, 4000);
  if (body.api_key && (!api_key || /[\r\n]/.test(api_key)))
    throw fail("API Key 格式不正确");
  return { name, model, base_url, api_key, thinking: body.thinking ? 1 : 0 };
}
// 云端只向明确列出的服务发送 Key；自定义查询端接口可保存，但不会变成开放代理。
export function reviewEndpoint(env, base) {
  const allowed = new Set([
    "https://api.deepseek.com",
    "https://api.openai.com",
  ]);
  for (const origin of (env.MODEL_PROXY_ORIGINS || "")
    .split(",")
    .filter(Boolean)) {
    try {
      const u = new URL(origin.trim());
      if (u.protocol === "https:") allowed.add(u.origin);
    } catch {}
  }
  const url = new URL(base);
  if (!allowed.has(url.origin))
    throw fail(
      "此自定义接口尚未允许云端回顾；查询端可使用，站点需配置 MODEL_PROXY_ORIGINS 后才能生成回顾",
    );
  return base.replace(/\/+$/, "") + "/chat/completions";
}
export async function defaultProfile(DB, userId) {
  return DB.prepare(
    "SELECT * FROM model_profiles WHERE user_id=? AND is_default=1",
  )
    .bind(userId)
    .first();
}
