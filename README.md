# Sensebook

浏览器优先的划词词汇工具（中文界面）。在任意网页划词 → 翻译 / 存词 / AI 释义。

> **默认可不登录**：油猴脚本将词条保存在浏览器本地存储（`GM_setValue` / `localStorage`）。服务器与账号仅用于**可选**同步，不是 MVP 必需。

本仓库为本地 MVP 脚手架：Tampermonkey 用户脚本（主路径）+ 可选 Node/Hono/SQLite 后端。无 Android 应用。

## 最快上手（仅油猴，无需后端）

1. 安装 [Tampermonkey](https://www.tampermonkey.net/)。
2. 新建脚本，粘贴 [`userscript/sensebook.user.js`](userscript/sensebook.user.js) 全文并保存。
3. 打开任意网页划选单词：
   - **存词** → 写入本地（键名 `sensebook_entries`），**无需 API / Token**
   - **AI释义** → 本地 stub 释义（未配置 API 时）
   - **翻译** → 未配置 API 时显示占位提示
4. 油猴菜单 **「Sensebook：我的生词（本地）」** 可查看 / 删除本地词库。

本地模式说明也会在菜单「关于本地模式」中提示。登录相关菜单标注为 **「登录/同步（可选）」**。

## 可选：启动本地服务器（同步 / 词库页）

若需要账号同步或 Web 词库页：

```bash
# 1. 安装依赖
npm install

# 2. 配置环境（可选）
cp .env.example .env
# 编辑 JWT_SECRET；若需真实 AI，填入 OPENAI_COMPATIBLE_BASE_URL / API_KEY

# 3. 启动服务
npm run dev
# 默认 http://127.0.0.1:8787
```

打开浏览器访问 http://127.0.0.1:8787 ，可注册并登录（可选）。登录后 Token 保存在浏览器 `localStorage`（键名 `sensebook_token`）。

健康检查：

```bash
curl http://127.0.0.1:8787/health
```

油猴菜单中可填写（均为可选）：

- **登录/同步（可选）— API 地址** → 例如 `http://127.0.0.1:8787`
- **登录/同步（可选）— Token** → 从词库页 Local Storage 复制 `sensebook_token`

配置后，存词会在本地保存之外**额外**尝试同步到服务器。

也可临时用接口拿 Token：

```bash
curl -s -X POST http://127.0.0.1:8787/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"yourpass"}'
```

## 测试流程

### A. 纯本地 MVP（推荐先测）

1. 只安装用户脚本，**不要**配置 API / Token。
2. 任意网页划词 → **存词** → toast 提示已本地存词。
3. 菜单打开 **我的生词（本地）**，可见刚存的词条。
4. **AI释义** 应写入 stub 句意/词义，`status` 为 `ready`。

### B. 可选服务端联调

1. `npm run dev`，确认 `/health` 返回 `ok`。
2. 打开 http://127.0.0.1:8787 注册并登录。
3. 油猴配置可选 API + Token。
4. 划词存词后，本地列表与服务器词库页均可看到（服务器路径仍需登录）。

## API 一览（可选后端）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| POST | `/auth/register` | 注册 `{email,password}` |
| POST | `/auth/login` | 登录，返回 JWT |
| GET/POST | `/entries` | 列表 / 创建（需 Bearer） |
| GET/PATCH/DELETE | `/entries/:id` | 读写删 |
| POST | `/entries/:id/enrich` | AI 句意+词义 |
| POST | `/translate` | 翻译 `{text}` |

数据字段见 [docs/schema.md](docs/schema.md)。本地存储使用相同字段（无 `user_id`，`id` 由客户端生成）。

## 目录结构

```
docs/schema.md           # 数据模型（含本地优先说明）
server/                  # Hono API + SQLite（可选）
web/index.html           # 词库页（可选；支持未登录时浏览本页 localStorage）
userscript/sensebook.user.js  # 主路径：本地优先划词
.env.example
```

## 环境变量

见 `.env.example`。未配置 `OPENAI_COMPATIBLE_*` 时，服务端 enrich / translate 返回 stub 文本；油猴在无 API 时使用客户端 stub。

## 许可

私有仓库 · Sensebook MVP
