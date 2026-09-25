# Sensebook 数据模型

## 存储模式

| 模式 | 说明 |
|------|------|
| **本地优先（默认）** | 油猴脚本用 `GM_setValue` / `GM_getValue`（或 `localStorage` 回退），Android 用 SharedPreferences。无需登录。 |
| **跨端同步（可选）** | 登录同一账号后，浏览器与 Android 把本地修改同步到 Cloudflare Worker / D1，并按游标拉取其他设备的改动。 |

本地与服务端词条字段对齐；本地条目无 `user_id`，`id` / `created_at` 由客户端生成。

## Entry（词条）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | TEXT (UUID) | 是 | 客户端生成并跨端保持不变 |
| `user_id` | TEXT | 可选* | 所属用户，仅服务端鉴权后写入 |
| `word` | TEXT | 是 | 划词选中的单词/短语 |
| `sentence` | TEXT | 是 | 上下文句子 |
| `ai_sentence_gloss` | TEXT | 否 | 句内搭配效果（修饰语+中心词等组合语气；本地无 API 时可为 stub） |
| `ai_word_sense` | TEXT | 否 | 选中词的独立义项（勿焊入中心词意思；本地 stub 同理） |
| `source_url` | TEXT | 否 | 来源页面 URL |
| `tags` | TEXT / JSON array | 否 | 标签，如 `["tech","novel"]`；本地存为数组 |
| `status` | TEXT | 否 | `pending_ai` \| `ready` \| `failed`，默认 `pending_ai` |
| `created_at` | TEXT (ISO 8601) | 是* | 创建时间 |
| `updated_at` | TEXT (ISO 8601) | 否 | 最近修改时间；新同步接口必填/生成 |
| `deleted_at` | TEXT (ISO 8601) | 否 | 删除墓碑；非空时从词库隐藏并同步删除 |
| `review_due_at` | TEXT (ISO 8601) | 否 | 下次复习时间 |
| `review_interval_days` | INTEGER | 否 | 当前复习间隔天数 |
| `review_repetitions` | INTEGER | 否 | 连续记住次数 |
| `review_last_at` | TEXT (ISO 8601) | 否 | 上次复习时间 |
| `source_app` | TEXT | 否 | Android 来源应用包名 |
| `translation` | TEXT | 否 | 翻译模式缓存的译文 |
| `revision` | INTEGER | 否 | Cloudflare 同步服务端版本号 |

\* 本地模式由客户端生成 `id` 与 `created_at`；服务端补全 `updated_at` 和 `revision`。

## User（用户）— 仅可选同步

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | TEXT (UUID) | 主键 |
| `email` | TEXT | 唯一 |
| `password_hash` | TEXT | PBKDF2-SHA256（旧 Node 原型仍用 bcrypt） |
| `created_at` | TEXT | ISO 8601 |

## 状态流转

1. 加入生词本 → `status = pending_ai`（若同时做 AI 释义则可直接 `ready`）
2. AI 释义成功（用户脚本直连 LLM、服务端 enrich，或无 Key 时 stub）→ `ready`（写入 gloss / sense）
3. enrich 失败 → `failed`（保留词条；无 Key 时 stub 路径直接 `ready`）

## 油猴本地键

| 键 | 说明 |
|----|------|
| `sensebook_entries` | 词条数组（主数据） |
| `sensebook_api_url` | 可选 Sensebook 服务器 API 基址（同步） |
| `sensebook_token` | 可选 JWT（同步） |
| `sensebook_sync_user_id` | 设备已绑定账号，防止误传到其他账号 |
| `sensebook_sync_cursor` | 最近下载的服务端变更游标 |
| `sensebook_llm_base_url` | LLM Base URL（默认 `https://api.deepseek.com/v1`） |
| `sensebook_llm_api_key` | LLM API Key（仅本机；AI 释义直连用） |
| `sensebook_llm_model` | LLM 模型（默认 `deepseek-flash`） |
