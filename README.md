# Sensebook

浏览器优先的阅读词汇工具（中文界面）。在网页或 Android 划词 → 理解语境 → 存入生词本 → 跨端同步 → 复习。

> **默认可不登录**：词条先保存在设备本地。登录同一同步账号后，浏览器与 Android 通过 Cloudflare Worker / D1 互通；断网仍可保存与复习。

本仓库包含 Tampermonkey 用户脚本、[`android/`](android/) 原生应用、[`macos/`](macos/) 菜单栏划词 MVP、Cloudflare 同步服务，以及保留的 Node/Hono/SQLite 原型。



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
4. 划词弹层点 **DeepSeek**，填 DeepSeek API Key；也可在页面右下角 **Sensebook** FAB 中选择「DeepSeek 设置」或「我的生词本」。未配置时右下角显示「配置 DeepSeek」，首次自动弹出。

> **若右下角仍看不到 Sensebook 按钮**：打开浏览器控制台，看是否弹出 `Sensebook 脚本错误: …`（请把报错内容发出来）；并在 Tampermonkey/Violentmonkey 中确认该脚本已启用，且对当前网站没有被排除。也可在插件里对该脚本点「检查更新」。

本地开发若已手动粘贴过旧脚本：删掉旧脚本后改用上面的链接重装，才能挂上自动更新。

## 最快上手（仅油猴，无需后端）

1. 安装 [Tampermonkey](https://www.tampermonkey.net/)。
2. 新建脚本，粘贴 [`userscript/sensebook.user.js`](userscript/sensebook.user.js) 全文并保存。
3. 打开任意网页划选单词：
   - **选中自动查询**（默认开）→ 短词先出「本地词库」释义，模型并行补第二行（「查询中…」）；整句仅模型。可在 LLM 设置或 FAB 中开关（键名 `sensebook_auto_query`）
   - **翻译** → 仅翻译（本地词库 + 模型双出），**不**写入生词本；命中本地缓存则即时回看，可再点翻译强制刷新
   - **加入生词本** → 写入本地生词本（键名 `sensebook_entries`），**无需 API / Token**
   - **存本并释义** → 存入生词本，并生成语境「词义 / 搭配效果」（非干译）；已配置 DeepSeek Key 时直连模型，否则本地 stub；结果区与翻译布局区分显示
   - **朗读** → 浮层与生词本小喇叭，用浏览器 `speechSynthesis` 读单词/句子（无云端 TTS）
4. 油猴菜单 / FAB：**「我的生词本」**（搜索、编辑、复习）、**「查询记录」**（本地缓存 `sensebook_query_cache`，约 250 条 LRU）、**「DeepSeek 设置」**、**「Sensebook 设置」**（账号同步、导入导出）。

本地模式说明也会在菜单「关于本地模式」中提示。登录相关菜单标注为 **「登录/同步（可选）」**。


## 本地词库（EN→ZH，与脚本版本独立）

划选**短词**（单 token、无空格、长度 ≤~20、拉丁字母为主）时：

1. **本地词库**行立刻显示简洁中文释义（GM 缓存；轻量词干 `-s/-ed/-ing`）
2. **模型**行并行查询，先显示「查询中…」，完成后单独占一行，**不会覆盖**本地行
3. 本地未命中或整句/多词 → 仅模型

词库文件：[`userscript/dict/en-zh-common.json`](userscript/dict/en-zh-common.json)（约半量 UX 试装：~10k 词 / ≤~0.8MB）。脚本启动后通过 `GM_xmlhttpRequest` 异步下载并写入 `GM_setValue`：

| 存储键 | 用途 |
|--------|------|
| `sensebook_local_dict_data` | 词库 JSON 正文 |
| `sensebook_local_dict_meta` | 仅记录 **dict `version`**、条目数、拉取时间 |

**重要**：油猴脚本的 `@version`（如 `0.1.YYYYMMDDHHmm`）与 JSON 内的 **`version`（dict version）相互独立**。推送脚本只改 `@version` **不会**清空词库缓存；只有菜单「清除本地词库缓存」或词库文件自身 `version` 变化后的刷新才会动到这两把键。

数据来源与许可见 [`userscript/dict/SOURCE.md`](userscript/dict/SOURCE.md)（ECDICT · MIT）。下载失败时静默回退为仅模型。油猴菜单提供「刷新本地词库」「清除本地词库缓存」。


## 配置真实「存本并释义」（DeepSeek）

「存本并释义」走油猴 **直连** DeepSeek 的 OpenAI 兼容接口（`GM_xmlhttpRequest` → `{base}/chat/completions`），**不经过** Sensebook 服务器。Key 仅保存在本机油猴存储。当前 P0 **仅支持 DeepSeek**。

1. 打开油猴菜单 **「Sensebook：LLM 设置」**，或使用划词弹层 **DeepSeek** 按钮、词库面板顶部 **配置 DeepSeek**、右下角 Sensebook FAB，弹出页内设置面板（Shadow DOM）。
2. 面板字段：
   - **供应商**：DeepSeek（固定）
   - **Base URL**：默认 `https://api.deepseek.com/v1`（高级可改；须为 OpenAI 兼容的 **`/v1` 根**，脚本会追加 `/chat/completions`，勿填完整 completions 路径）
   - **API Key**：从 [DeepSeek API Keys 页面](https://platform.deepseek.com/api_keys) 创建或复制；面板也提供「去 DeepSeek 官网创建 API Key」链接；密码框 + 可显示；下方显示是否已设置（脱敏）
   - **模型**：默认 `deepseek-flash`（可改）
   - **选中自动查询**：默认开启；关闭后仅手动点「翻译」才会请求
3. 点 **保存** 写入本机（键名仍为 `sensebook_llm_base_url` / `sensebook_llm_api_key` / `sensebook_llm_model`，以及 `sensebook_auto_query`）。
4. 可选点 **测试连接**：向 `{base}/chat/completions` 发一条极小请求，面板内显示成功 / 鉴权失败 / 网络错误。
5. **清除 Key** 只删 Key，保留 URL 与模型。

未配置 Key 时「存本并释义」仍走本地 stub，本地加入生词本不受影响。配置好后划词点 **存本并释义**，成功则 `status=ready`；失败保留词条且 `status=failed`。

> **安全提醒**：API Key 只存在你本机的油猴/`GM_setValue` 中，请勿提交到仓库或发给他人。

账号同步在「Sensebook 设置」里配置，与 DeepSeek Key 分开。



## Android（划词 + 生词本）

系统划词菜单入口使用 `ACTION_PROCESS_TEXT`；启动图标打开本地生词本，可搜索、编辑、复习、导入导出和登录同步。无悬浮球或无障碍服务。

| | |
|--|--|
| 工程路径 | [`android/`](android/)（包名 `com.veightz.sensebook`） |
| 双出 | 短词：本地词库 + DeepSeek 词义/搭配效果并行；整句：仅模型 |
| Key | 本机 EncryptedSharedPreferences；设置里可改 Key / Base URL / 模型 / thinking |
| 同步 | 账号令牌加密存储；划词保存后后台同步，生词本可手动同步 |
| 打开方式 | Android Studio → **Open** → 选 `android/` 目录 |
| 构建 | `cd android && ./gradlew :app:assembleDebug` → `app/build/outputs/apk/debug/app-debug.apk` |
| 验证入口 | 安装 APK → 长按选词 → **Sensebook** → 保存；点启动图标打开生词本 |

详情、里程碑与排障见 [`android/README.md`](android/README.md)。

## macOS（菜单栏 · M1）

菜单栏划词（`LSUIElement` / 无 Dock）。包名 `com.veightz.sensebook` · version **0.1.0**。默认快捷键 **⌥D**。短词：本地词库 + DeepSeek 词义/搭配效果；整句：仅模型。API Key 存 **钥匙串**。

| | |
|--|--|
| 工程路径 | [`macos/`](macos/)（打开 `Sensebook.xcodeproj`） |
| 系统 | macOS 13+ · 需在 **Mac + Xcode** 上编译（Linux 盒子无法出 macOS 二进制） |
| 权限 | 系统设置 → 隐私与安全性 → **辅助功能** 启用 Sensebook |

详见 [`macos/README.md`](macos/README.md)。



## 跨端同步

浏览器「Sensebook 设置 → 跨端同步」和 Android 生词本「账号设置」使用**同一个账号**。服务地址默认是已部署的 [Cloudflare 同步服务](https://sensebook-sync.veightz3161.workers.dev)，两端均可修改。首次登录会上传设备上已有的本地词条；之后本地修改先保存，再上传并按游标拉取另一端的修改。删除同步为墓碑，版本冲突保留本地副本。

同步服务采用 Cloudflare Worker + D1，已上线；本机联调与部署维护见 [同步开发与协议说明](docs/sync.md)。`server/` 与 `web/` 是旧 Node/SQLite 原型，账号和服务端记录不会自动迁到新服务。

## 测试流程

### A. 纯本地 MVP（推荐先测）

1. 只安装用户脚本，**不要**配置 API / Token / LLM Key。
2. 任意网页划词 → **加入生词本** → toast 提示已加入生词本。
3. 菜单打开 **我的生词本（本地）**，可见刚存的词条。
4. **存本并释义**（无 Key）应写入 stub 搭配效果/词义，`status` 为 `ready`；结果区应分栏显示「词义」「搭配效果」。

### B. 真实 LLM（油猴直连 DeepSeek）

1. 菜单打开 **「Sensebook：LLM 设置」**，填入 DeepSeek API Key（URL/模型可用默认），保存；可用「测试连接」。
2. 划词 → **存本并释义** → 等待加载 → 本地词库出现中文搭配效果/词义，`status=ready`。
3. 故意填错 Key → 应 toast 失败且词条 `status=failed`（词条仍保留）。

### C. 同步联调

1. `npm run worker:migrate:local`，在 `.dev.vars` 设置本机 `JWT_SECRET`，运行 `npm run worker:dev -- --port 8788`。
2. 运行 `npm run test:worker-sync` 与 `npm run test:userscript-sync`。
3. 浏览器脚本在「Sensebook 设置」注册账号并同步；Android 在生词本「账号设置」登录同一账号。
4. 分别在两端保存、编辑、复习和删除词条，手动同步后核对结果。

### 单元烟测（无需真实 Key）

```bash
npm test
# 或 npm run test:llm-parse
```

## 同步 API 一览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| POST | `/auth/register` | 注册 `{email,password}` |
| POST | `/auth/login` | 登录，返回 JWT |
| GET | `/auth/me` | 当前账号（需 Bearer） |
| PUT | `/sync/entries/:id` | 创建或按版本更新词条（需 Bearer） |
| GET | `/sync/changes` | 游标分页拉取改动与删除墓碑（需 Bearer） |

数据字段见 [docs/schema.md](docs/schema.md)，同步行为见 [docs/sync.md](docs/sync.md)。

## 目录结构

```
docs/schema.md                    # 数据模型（含本地优先说明）
server/                           # Hono API + SQLite（可选）
web/index.html                    # 旧 Node/SQLite 原型页面
worker/                           # Cloudflare Worker + D1 迁移（跨端同步）
wrangler.jsonc                    # Worker 配置；D1 ID 上线前替换
userscript/sensebook.user.js      # 主路径：本地优先划词 + 本地词库/模型双出
userscript/dict/en-zh-common.json # 半量 EN→ZH 本地词库（dict version ≠ @version）
userscript/dict/SOURCE.md         # 词库来源与许可（ECDICT MIT）
android/                          # PROCESS_TEXT 划词 MVP（Kotlin）
macos/                            # 菜单栏划词 MVP（Swift / SwiftUI，需 Mac+Xcode）
scripts/build-en-zh-dict.py       # 从 ECDICT 构建词库子集
scripts/test-llm-parse.mjs        # prompt / JSON 解析烟测
scripts/test-worker-sync.mjs      # 同步接口集成测试
scripts/test-userscript-sync.mjs  # 浏览器本地与同步集成测试
.env.example
```

## 环境变量

Worker 的 `JWT_SECRET` 用 Wrangler secret 管理；本机使用被忽略的 `.dev.vars`。旧 Node 原型的环境变量见 `.env.example`。DeepSeek Key 始终只保存在各设备，不经同步服务。

## 许可

私有仓库 · Sensebook MVP
