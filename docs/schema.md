# Sensebook 数据模型

## Entry（词条）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | TEXT (UUID) | 可选* | 主键，服务端生成 |
| `user_id` | TEXT | 可选* | 所属用户，鉴权后写入 |
| `word` | TEXT | 是 | 划词选中的单词/短语 |
| `sentence` | TEXT | 是 | 上下文句子 |
| `ai_sentence_gloss` | TEXT | 否 | AI 对整句的释义/翻译 |
| `ai_word_sense` | TEXT | 否 | AI 对该词在句中的义项 |
| `source_url` | TEXT | 否 | 来源页面 URL |
| `tags` | TEXT (JSON array) | 否 | 标签，如 `["tech","novel"]` |
| `status` | TEXT | 否 | `pending_ai` \| `ready` \| `failed`，默认 `pending_ai` |
| `created_at` | TEXT (ISO 8601) | 是* | 创建时间，服务端生成 |

\* 客户端创建时可不传；服务端补全。

## User（用户）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | TEXT (UUID) | 主键 |
| `email` | TEXT | 唯一 |
| `password_hash` | TEXT | bcrypt |
| `created_at` | TEXT | ISO 8601 |

## 状态流转

1. 存词 → `status = pending_ai`
2. `POST /entries/:id/enrich` 成功 → `ready`（写入 gloss / sense）
3. enrich 失败 → `failed`
