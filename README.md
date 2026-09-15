# Sensebook

浏览器优先的划词词汇工具（中文界面）。在任意网页划词 → 翻译 / 存词 / AI 释义，词库可在本地 Web 页查看。

> 本仓库为本地 MVP 脚手架：Node + Hono + SQLite + Tampermonkey 用户脚本。无 Android 应用。

## 快速开始

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

打开浏览器访问 http://127.0.0.1:8787 ，注册账号并登录。登录后 Token 会保存在浏览器 `localStorage`（键名 `sensebook_token`）。

健康检查：

```bash
curl http://127.0.0.1:8787/health
```

## 安装用户脚本

1. 安装 [Tampermonkey](https://www.tampermonkey.net/)（桌面或移动浏览器扩展）。
2. 新建脚本，粘贴 `userscript/sensebook.user.js` 全文并保存。
3. 油猴菜单：
   - **Sensebook：设置 API 地址** → 例如 `http://127.0.0.1:8787`
   - **Sensebook：设置 Token** → 从词库页 DevTools → Application → Local Storage 复制 `sensebook_token`，或调用登录接口获取。

也可临时用接口拿 Token：

```bash
curl -s -X POST http://127.0.0.1:8787/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"yourpass"}'
```

## 测试流程

1. `npm run dev` 启动服务，确认 `/health` 返回 `ok`。
2. 打开 http://127.0.0.1:8787 注册并登录。
3. 安装用户脚本并配置 API + Token。
4. 打开任意英文网页，划选单词：
   - **翻译** → 调用 `POST /translate`（无 LLM 时为 stub）
   - **存词** → `POST /entries`
   - **AI释义** → 存词后 `POST /entries/:id/enrich`
5. 回到词库页刷新，可见词条；可再点「AI 释义」或删除。

## API 一览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| POST | `/auth/register` | 注册 `{email,password}` |
| POST | `/auth/login` | 登录，返回 JWT |
| GET/POST | `/entries` | 列表 / 创建（需 Bearer） |
| GET/PATCH/DELETE | `/entries/:id` | 读写删 |
| POST | `/entries/:id/enrich` | AI 句意+词义 |
| POST | `/translate` | 翻译 `{text}` |

数据字段见 [docs/schema.md](docs/schema.md)。

## 目录结构

```
docs/schema.md           # 数据模型
server/                  # Hono API + SQLite
web/index.html           # 词库页（由服务端托管）
userscript/sensebook.user.js
.env.example
```

## 环境变量

见 `.env.example`。未配置 `OPENAI_COMPATIBLE_*` 时，enrich / translate 返回明确标记的 stub 文本，便于本地联调。

## 许可

私有仓库 · Sensebook MVP
