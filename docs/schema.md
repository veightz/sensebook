# Sensebook 数据模型

## 存储模式

| 模式 | 说明 |
|------|------|
| **本地优先（默认）** | 油猴脚本用 `GM_setValue` / `GM_getValue`（或 `localStorage` 回退）持久化，键名 **`sensebook_entries`**。**无需登录、无需 API。** |
| **可选服务端** | 配置 API 地址 + JWT 后，存词可额外同步到 SQLite；鉴权 API 仍可用，但不是 MVP 必需。 |

本地与服务端词条字段对齐；本地条目无 `user_id`，`id` / `created_at` 由客户端生成。

## Entry（词条）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | TEXT (UUID) | 可选* | 主键；服务端或客户端本地生成 |
| `user_id` | TEXT | 可选* | 所属用户，仅服务端鉴权后写入 |
| `word` | TEXT | 是 | 划词选中的单词/短语 |
| `sentence` | TEXT | 是 | 上下文句子 |
| `ai_sentence_gloss` | TEXT | 否 | AI 对整句的释义/翻译（本地无 API 时可为 stub） |
| `ai_word_sense` | TEXT | 否 | AI 对该词在句中的义项（本地 stub 同理） |
| `source_url` | TEXT | 否 | 来源页面 URL |
| `tags` | TEXT / JSON array | 否 | 标签，如 `["tech","novel"]`；本地存为数组 |
| `status` | TEXT | 否 | `pending_ai` \| `ready` \| `failed`，默认 `pending_ai` |
| `created_at` | TEXT (ISO 8601) | 是* | 创建时间 |

\* 服务端创建时可不传由服务端补全；本地模式由客户端生成 `id` 与 `created_at`。

## User（用户）— 仅可选同步

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | TEXT (UUID) | 主键 |
| `email` | TEXT | 唯一 |
| `password_hash` | TEXT | bcrypt |
| `created_at` | TEXT | ISO 8601 |

## 状态流转

1. 存词 → `status = pending_ai`（若同时做 AI 释义则可直接 `ready`）
2. AI 释义成功（用户脚本直连 LLM、服务端 enrich，或无 Key 时 stub）→ `ready`（写入 gloss / sense）
3. enrich 失败 → `failed`（保留词条；无 Key 时 stub 路径直接 `ready`）

## 油猴本地键

| 键 | 说明 |
|----|------|
| `sensebook_entries` | 词条数组（主数据） |
| `sensebook_api_url` | 可选 Sensebook 服务器 API 基址（同步） |
| `sensebook_token` | 可选 JWT（同步） |
| `sensebook_llm_base_url` | LLM Base URL（默认 `https://api.deepseek.com/v1`） |
| `sensebook_llm_api_key` | LLM API Key（仅本机；AI 释义直连用） |
| `sensebook_llm_model` | LLM 模型（默认 `deepseek-chat`） |
