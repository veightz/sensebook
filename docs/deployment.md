# Cloudflare 个人版部署与试用

## 当前状态（2026-09-19）
部署工作树 `/Users/veightz/Develops/sensebook-cloudflare-v1`，分支 `codex/cloudflare-v1`，继承全部个人版与原生端变更，main 未合并。
Wrangler 4.135.0、cloudflared 2026.9.1 已安装，Cloudflare 官方 cloudflare / wrangler / workers-best-practices / cloudflare-one 技能已安装到本机 Codex skills。
网站已发布到 https://sensebook-personal.veightz3161.workers.dev ，浏览器已确认登录页可见。用户完成 OAuth 授权后，D1 已创建，0001/0002 远端迁移通过，MODEL_CONFIG_KEY 已作为生产 Secret 设置；Access 应用仍返回 403/not_enabled，所以个人数据接口保持关闭。登录邮箱需要用户明确指定，不从 Git 或 Cloudflare 账号邮箱推断。

## 推荐部署入口

在本工作树内执行 `npm ci` 即可恢复锁定的 CLI 依赖。Python 3 无额外依赖。

```sh
npm run cloud:doctor
```

当前凭据不足。请在 [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens) 为目标账号准备包含 Workers Scripts Edit、D1 Edit、Workers 子域读取和 Access 应用/组织读取权限的 Token。Access 本身可在后台手动配置；如需由 API 配置则增加对应 Access 编辑权限。不要将 Token 发到聊天中，使用本机环境变量 `CLOUDFLARE_API_TOKEN` 与 `CLOUDFLARE_ACCOUNT_ID`。

在 [Zero Trust 后台](https://one.dash.cloudflare.com/) 选择 Free、启用 Access 和 One-time PIN，创建 Self-hosted 应用，域名使用账号 Workers 子域下的 `sensebook-personal.<subdomain>.workers.dev/login`，仅允许你的个人邮箱。不要给整个站点加 Access，否则设备同步请求也会被拦截。

随后在终端提供非密钥配置（示例值要替换）：

```sh
export OWNER_EMAIL='你的登录邮箱'
export ACCESS_TEAM_DOMAIN='你的团队.cloudflareaccess.com'
export ACCESS_AUD='Access 应用的 audience'
npm run cloud:prepare
npm run cloud:publish
```

`prepare` 检查 Access 应用与团队后，复用/创建 D1 并生成被 Git 忽略的 `wrangler.production.json`。`publish` 执行 migrations、发布 Worker，只在首次创建模型加密 Secret。既有 Secret 不覆盖，已有加密记录却缺少 Secret 时停止，避免数据无法解密。首次生成的密钥备份保存在 `.cloudflare/model-config-key`，权限 600，请安全备份。脚本不会上传本地预览数据库、设备 Token 或模型 Key。

如果选择 Wrangler 浏览器登录，请注意已设置的 `CLOUDFLARE_API_TOKEN` 优先于 OAuth。可以用 `env -u CLOUDFLARE_API_TOKEN npx wrangler login` 发起登录；此后的手工 Wrangler 命令也要移除旧 Token。Python 自动化也支持 OAuth：先 `export SENSEBOOK_CLOUDFLARE_AUTH=oauth`，脚本会通过 Wrangler 在内存中取得授权，并为后续 CLI 去掉旧 Token。不会打印或另存 OAuth 凭据；Access 管理权限仍需单独确认。

生产发布成功后必须验证首页、`/health`、`/login` 和未登录 `/api/me`（应返回 401）。真实邮箱验证码由用户完成，不能用 DEV_AUTH 绕过。

## 本地试用

使用 Node 22（package.json 已指定 Volta 22.14.0）。

```sh
npm ci
cp .dev.vars.example .dev.vars
node scripts/init-local-key.mjs
npm run db:local
npm run dev:cloud
```

打开 `http://127.0.0.1:8788`。显式 DEV_AUTH 只在 loopback 请求生效，不要将本地开发服务通过公网代理暴露。
另一个终端可运行 `node scripts/seed-demo.mjs` 添加三条带“示例”设备标记的本地测试查询，不包含真实浏览记录。

## Cloudflare 免费部署

1. 选择 Workers Free，准备 Worker 编辑、D1 编辑权限的 API Token，或使用 `npx wrangler login`。不要把 Token 写入代码或发到聊天。
2. 运行 `npx wrangler d1 create sensebook-personal`，将返回的 database_id 填入 wrangler.jsonc（替换全零占位）。
3. 运行 `npx wrangler d1 migrations apply sensebook-personal --remote`。
4. 在 Cloudflare Zero Trust 启用 Free 方案。配置 One-time PIN 身份提供方，创建 Self-hosted Access 应用，**仅保护最终站点域名的 `/login` 路径**（不要保护全部路径，否则脚本和 Android 的设备同步请求会被拦截）。Allow 策略只 Include 个人邮箱。会话时长建议 24 小时。
5. 把 Access 团队域名（如 `my-team.cloudflareaccess.com`，不含 https）、应用 AUD、允许的邮箱填入 wrangler.jsonc 的 ACCESS_TEAM_DOMAIN / ACCESS_AUD / OWNER_EMAIL。
6. 先通过 Cloudflare Secret 设置 `MODEL_CONFIG_KEY`（随机 32 字节的 Base64，勿使用本地开发密钥）：`openssl rand -base64 32 | npx wrangler secret put MODEL_CONFIG_KEY`。妥善备份此密钥；直接替换会导致已有配置无法解密，轮换需先完成数据重加密。手工方案再执行 `npx wrangler deploy --config wrangler.jsonc`，使用返回的 workers.dev 地址。若账号后台不支持为该免费地址配置 Access 路径，使用已有 Cloudflare 自定义域名；不要因此购买域名或升级付费方案。
7. 正式域名访问 `/login`，验证邮箱后跳回网站。`/api/me` 必须在未登录时返回 401；设备凭据只能访问 `/sync/*`。

默认部署配置没有 DEV_AUTH，缺少 Access 配置时 API 返回 503，不会以开发身份开放数据。不要将 `.dev.vars` 内容复制为生产环境变量。

## 连接电脑脚本

1. 安装/更新当前分支的 `userscript/sensebook.user.js`。没有合入 main 前，GitHub main 安装链接仍是旧版。
2. 网站“连接与设置”输入设备名，生成连接配置；每个安装实例单独生成一份。
3. 油猴菜单“个人网站与同步（可选）”→ 展开设置 → 粘贴配置。
4. 新连接默认同步账号默认模型，查询记录上传默认关闭，可分别勾选。开启记录上传后默认只同步开启后的新查询；勾选“同步已有查询”才导入已有事件、生词本和缓存。历史导入无法恢复真实查询次数。
5. 点击“连接账号并应用设置”。启用记录同步后，新查询自动上传，联网或前台每分钟重试；可随时关闭。

旧生词本及旧 Node 同步设置保留兼容，不会被新模式自动删除或启用。网站登录不等于开启任何设备同步。

## 连接 Android

```sh
cd android
./gradlew assembleDebug
```

APK：`android/app/build/outputs/apk/debug/app-debug.apk`。
新版本有启动图标，打开“查询记录与同步”，粘贴网站生成的独立设备配置，可选导入旧生词本。
Android 只接受 HTTPS 网站。查询完成后后台同步，打开历史或手动重试也会同步。进程被系统结束时保留本地队列，下次使用再上传；V1 没有常驻服务。
PROCESS_TEXT 通常没有完整原句与网址，因此原始 context 留空，回顾明确提示缺少语境。

## 回顾

网站设置支持多份 OpenAI 兼容模型配置，Key 以 AES-256-GCM 密文保存到 D1，解密密钥独立置于 Worker Secret。网页列表只返回掩码；回顾通过配置 ID 使用云端 Key。脚本和 Android 连接后自动获取默认配置，也可关闭模型同步。手工修改本机模型会暂停自动跟随。仍保留当前标签页 sessionStorage 临时 Key 模式。
日期按当前浏览器时区分组，周从周一开始，月按自然月。已有回顾直接阅读；新查询到达后提示可更新。
单次回顾上限 500 条 / 140,000 字符，超出时明确要求缩小期间，不静默遗漏记录。超过限制的整月回顾及分层归纳属于后续迭代。
回顾时 Key 在 Worker 请求内解密；默认允许 DeepSeek/OpenAI，其他供应商需设置 `MODEL_PROXY_ORIGINS`（逗号分隔 HTTPS origin）。不记录 Key 或上游错误正文，禁止请求重定向。真实模型费用由用户自己的 Key 承担。

## 数据删除与设备管理

网站删除记录：清空云端正文与来源，保留 ID tombstone，并清除覆盖该记录时间段的回顾。设备下次同步清除对应本地事件；历史缓存/旧生词本的原副本仍保留，不由新事件同步协议管理。
撤销设备立即阻止后续同步，但不远程清除设备本地数据。关闭同步不影响查询。

## 验证

```sh
npm test
npm run test:cloud
node scripts/harness-fab.mjs
npx wrangler deploy --dry-run
```

云端测试使用真实本地 D1 binding，模型请求用测试响应替代；不会消耗模型额度。真实邮箱登录、真实模型生成与 Android 真机跨端同步需部署配置后验收。
