# Sensebook

浏览器优先的划词词汇工具（中文界面）。在任意网页划词 → 翻译 / 存词 / AI 释义。

> **默认可不登录**：油猴脚本将词条保存在浏览器本地存储（`GM_setValue` / `localStorage`）。服务器与账号仅用于**可选**同步，不是 MVP 必需。

本仓库为本地 MVP 脚手架：Tampermonkey 用户脚本（主路径）+ 可选 Node/Hono/SQLite 后端。无 Android 应用。



## Chrome 上看不到按钮？

Chrome 138+ 需要单独打开油猴的用户脚本权限，否则脚本显示已安装但**不会在页面执行**：

1. 打开 `chrome://extensions`
2. Tampermonkey → **详情**
3. 启用 **允许运行用户脚本（Allow user scripts）**
4. 旧版 Chrome：在扩展页打开右上角 **开发者模式**
5. 刷新普通网页（如 https://example.com）后再看右下角


## 安装油猴脚本（一次安装，之后自动更新）

1. 浏览器安装 [Tampermonkey](https://www.tampermonkey.net/) 或 Violentmonkey  
2. 打开安装链接（公开仓库 raw）：  
   https://raw.githubusercontent.com/veightz/sensebook/main/userscript/sensebook.user.js  
   油猴会弹出安装页，确认安装即可。  
3. 之后每次推送 `main` 前更新 `@version`，油猴会按 `@updateURL` 检查更新（也可在插件里手动「检查更新」）。v1 之前统一使用 `0.1.<时间>`，时间为 Asia/Shanghai 的 `YYYYMMDDHHmm`；每次推送只递增时间部分。
4. 划词弹层点 **DeepSeek**，填 DeepSeek API Key；也可在页面右下角 **Sensebook** FAB 中选择「DeepSeek 设置」或「我的生词」。未配置时右下角显示「配置 DeepSeek」，首次自动弹出。

> **若右下角仍看不到 Sensebook 按钮**：打开浏览器控制台，看是否弹出 `Sensebook 脚本错误: …`（请把报错内容发出来）；并在 Tampermonkey/Violentmonkey 中确认该脚本已启用，且对当前网站没有被排除。也可在插件里对该脚本点「检查更新」。

本地开发若已手动粘贴过旧脚本：删掉旧脚本后改用上面的链接重装，才能挂上自动更新。

## 最快上手（仅油猴，无需后端）

1. 安装 [Tampermonkey](https://www.tampermonkey.net/)。
2. 新建脚本，粘贴 [`userscript/sensebook.user.js`](userscript/sensebook.user.js) 全文并保存。
3. 打开任意网页划选单词：
   - **存词** → 写入本地（键名 `sensebook_entries`），**无需 API / Token**
   - **AI释义** → 已在「LLM 设置」配置 DeepSeek Key 时直连生成真实释义；未配置时使用本地 stub
   - **翻译** → 未配置可选同步 API 时显示占位提示
4. 油猴菜单 **「Sensebook：我的生词（本地）」** 可查看 / 删除本地词库；**「Sensebook：LLM 设置」** 配置 DeepSeek。也可从划词弹层的 **DeepSeek** 按钮、词库面板顶部的 **配置 DeepSeek** 按钮，或右下角 Sensebook FAB 进入。

本地模式说明也会在菜单「关于本地模式」中提示。登录相关菜单标注为 **「登录/同步（可选）」**。

## 配置真实 AI 释义（DeepSeek）

AI 释义走油猴 **直连** DeepSeek 的 OpenAI 兼容接口（`GM_xmlhttpRequest` → `{base}/chat/completions`），**不经过** Sensebook 服务器。Key 仅保存在本机油猴存储。当前 P0 **仅支持 DeepSeek**。

1. 打开油猴菜单 **「Sensebook：LLM 设置」**，或使用划词弹层 **DeepSeek** 按钮、词库面板顶部 **配置 DeepSeek**、右下角 Sensebook FAB，弹出页内设置面板（Shadow DOM）。
2. 面板字段：
   - **供应商**：DeepSeek（固定）
   - **Base URL**：默认 `https://api.deepseek.com/v1`（高级可改；须为 OpenAI 兼容的 **`/v1` 根**，脚本会追加 `/chat/completions`，勿填完整 completions 路径）
   - **API Key**：从 [DeepSeek 开放平台](https://platform.deepseek.com/) 复制；密码框 + 可显示；下方显示是否已设置（脱敏）
   - **模型**：默认 `deepseek-flash`（可改）
3. 点 **保存** 写入本机（键名仍为 `sensebook_llm_base_url` / `sensebook_llm_api_key` / `sensebook_llm_model`）。
4. 可选点 **测试连接**：向 `{base}/chat/completions` 发一条极小请求，面板内显示成功 / 鉴权失败 / 网络错误。
5. **清除 Key** 只删 Key，保留 URL 与模型。

未配置 Key 时 AI 释义仍走本地 stub，本地存词不受影响。配置好后划词点 **AI释义**，成功则 `status=ready`；失败保留词条且 `status=failed`。

> **安全提醒**：API Key 只存在你本机的油猴/`GM_setValue` 中，请勿提交到仓库或发给他人。

可选同步用的「登录/同步 — API 地址 / Token」与 LLM 设置相互独立，不要混填到本面板。

## 可选：启动本地服务器（同步 / 词库页）

若需要账号同步或 Web 词库页：

```bash
# 1. 安装依赖
npm install

# 2. 配置环境（可选）
cp .env.example .env
# 编辑 JWT_SECRET；若需服务端真实 AI，填入 OPENAI_COMPATIBLE_BASE_URL / API_KEY / MODEL

# 3. 启动服务
npm run dev
# 默认 http://127.0.0.1:8787
```

打开浏览器访问 http://127.0.0.1:8787 ，可注册并登录（可选）。登录后 Token 保存在浏览器 `localStorage`（键名 `sensebook_token`）。

健康检查：

```bash
curl http://127.0.0.1:8787/health
```

油猴菜单中可填写（均为可选，与 LLM 无关）：

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

1. 只安装用户脚本，**不要**配置 API / Token / LLM Key。
2. 任意网页划词 → **存词** → toast 提示已本地存词。
3. 菜单打开 **我的生词（本地）**，可见刚存的词条。
4. **AI释义**（无 Key）应写入 stub 句意/词义，`status` 为 `ready`。

### B. 真实 LLM（油猴直连 DeepSeek）

1. 菜单打开 **「Sensebook：LLM 设置」**，填入 DeepSeek API Key（URL/模型可用默认），保存；可用「测试连接」。
2. 划词 → **AI释义** → 等待加载 → 本地词库出现中文句意/词义，`status=ready`。
3. 故意填错 Key → 应 toast 失败且词条 `status=failed`（词条仍保留）。

### C. 可选服务端联调

1. `npm run dev`，确认 `/health` 返回 `ok`（`llm` 字段表示是否配置了服务端 OPENAI_COMPATIBLE_*）。
2. 打开 http://127.0.0.1:8787 注册并登录。
3. 油猴配置可选 API + Token。
4. 划词存词后，本地列表与服务器词库页均可看到（服务器路径仍需登录）。
5. `POST /entries/:id/enrich` 与油猴直连使用同一套 JSON 字段：`ai_sentence_gloss` / `ai_word_sense`。

### 单元烟测（无需真实 Key）

```bash
npm test
# 或 npm run test:llm-parse
```

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
userscript/sensebook.user.js  # 主路径：本地优先划词 + 可选直连 LLM
scripts/test-llm-parse.mjs    # prompt / JSON 解析烟测
.env.example
```

## 环境变量

见 `.env.example`。未配置 `OPENAI_COMPATIBLE_*` 时，服务端 enrich / translate 返回 stub 文本；油猴在无 LLM Key 时使用客户端 stub，有 Key 时直连供应商。

## 许可

私有仓库 · Sensebook MVP
