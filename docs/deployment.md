# Cloudflare 个人版部署与试用

## 当前状态（2026-09-19）
代码在 `codex/personal-review-v1`，独立工作树 `/Users/veightz/Develops/sensebook-personal-review-v1`。
本地 Workers + D1 已可运行，网页支持电脑与手机布局；Android debug APK 可构建。
远程尚未部署：现场 Cloudflare 凭据可读取 Workers 子域，但 D1 返回鉴权错误，Access 应用接口返回未启用。尚缺允许登录的个人邮箱。

## 本地试用

使用 Node 22（package.json 已指定 Volta 22.14.0）。

```sh
npm ci
cp .dev.vars.example .dev.vars
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
6. `npm run deploy:cloud`，使用返回的 workers.dev 地址。若账号后台不支持为该免费地址配置 Access 路径，使用已有 Cloudflare 自定义域名；不要因此购买域名或升级付费方案。
7. 正式域名访问 `/login`，验证邮箱后跳回网站。`/api/me` 必须在未登录时返回 401；设备凭据只能访问 `/sync/*`。

默认部署配置没有 DEV_AUTH，缺少 Access 配置时 API 返回 503，不会以开发身份开放数据。不要将 `.dev.vars` 内容复制为生产环境变量。

## 连接电脑脚本

1. 安装/更新当前分支的 `userscript/sensebook.user.js`。没有合入 main 前，GitHub main 安装链接仍是旧版。
2. 网站“连接与设置”输入设备名，生成连接配置；每个安装实例单独生成一份。
3. 油猴菜单“个人网站与同步（可选）”→ 展开设置 → 粘贴配置。
4. 默认只同步开启后的新查询；勾选“同步已有查询”才导入已有事件、生词本和缓存。历史导入无法恢复真实查询次数。
5. 点击“开启同步”。之后新查询自动上传，联网或前台每分钟重试；可随时关闭。

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

当前版本支持 DeepSeek，Key 只存当前网页的 sessionStorage，正常关闭标签页后清除（浏览器恢复会话可能恢复 sessionStorage）；可主动“清除 Key”。不读取或上传油猴/Android 模型设置。
日期按当前浏览器时区分组，周从周一开始，月按自然月。已有回顾直接阅读；新查询到达后提示可更新。
单次回顾上限 500 条 / 140,000 字符，超出时明确要求缩小期间，不静默遗漏记录。超过限制的整月回顾及分层归纳属于后续迭代。
Key 临时经过自己的 Worker，仅请求固定 DeepSeek 端点；不写数据库、请求日志或缓存。真实模型费用由用户自己的 Key 承担。

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
