# Sensebook 跨端同步

浏览器油猴脚本与 Android 使用同一个 Cloudflare Worker API 和 D1 数据库。词条始终先写本机；登录后上传本机改动，再按游标拉取服务端改动。未登录或网络中断不影响划词与复习。

线上服务：<https://sensebook-sync.veightz3161.workers.dev>。两端的新账号设置会预填此地址；用同一邮箱和密码登录即可同步。

## 词条与冲突

- `id` 由客户端生成，跨端保持不变；`revision` 由服务端递增。
- `updated_at`、`deleted_at`、`review_due_at`、`review_interval_days`、`review_repetitions`、`review_last_at` 是统一字段。删除保留墓碑，防止另一设备重新拉回。
- 更新发送 `base_revision`。版本不匹配返回 `409` 和服务端当前词条。客户端保留服务端词条，并把本机内容另存为带「同步冲突」标签的副本；不会静默丢弃本机修改。
- 首次登录会上传该设备现有本地词条。设备首次绑定账号后不允许直接切换到另一个账号，以免把前一账号的本地词条上传给别人。
- 同词、同语境、同来源的重复保存会复用本地词条；不同语境保留为独立词条。

## 本地开发

需要 Node.js 20+、JDK 17（Android）与已安装依赖。

```bash
npm install
npm run worker:migrate:local
```

在被 `.gitignore` 排除的 `.dev.vars` 写入 `JWT_SECRET=<至少 32 字符的随机密钥>`，然后启动：

```bash
npm run worker:dev -- --port 8788
npm run test:worker-sync
npm run test:userscript-sync
```

油猴「Sensebook 设置 → 跨端同步」填写服务地址、邮箱和密码。Android 启动图标进入生词本，再点「账号设置」。生产地址必须是 HTTPS；本机联调地址允许 HTTP。Android 模拟器访问电脑本机时使用 `10.0.2.2`，但需在调试环境允许明文连接。

## API

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| POST | `/auth/register` | 注册并返回令牌 |
| POST | `/auth/login` | 登录并返回令牌 |
| GET | `/auth/me` | 校验当前账号 |
| PUT | `/sync/entries/:id` | 幂等创建或按 `base_revision` 更新词条 |
| GET | `/sync/changes?after=<seq>&limit=200` | 分页拉取当前账号的增量与删除墓碑 |
| GET | `/health` | 健康检查 |

所有同步接口使用 `Authorization: Bearer <token>`。令牌在 Android 加密存储，在油猴本地存储；不放在网页 URL 中。

## Cloudflare 部署与维护

[`wrangler.jsonc`](../wrangler.jsonc) 指向独立的 `sensebook-sync` D1 数据库，三项迁移与 `JWT_SECRET` 已配置。后续发布时先应用新增迁移，运行 dry run，再发布 Worker 并验证 `/health` 和账号同步。不要把 `.dev.vars` 或密钥提交到仓库。

本机 Wrangler 已有可用的 OAuth 登录，但环境变量 `CLOUDFLARE_API_TOKEN` 会优先覆盖它。当前注入的 API Token 缺少 D1 权限，运行 D1 命令会收到 Cloudflare `10000` 认证错误；可对该命令使用 `env -u CLOUDFLARE_API_TOKEN npx wrangler ...`，让 Wrangler 使用已保存的 OAuth 凭据。账号里已有的 `sensebook-personal` 数据库含另一套 `users`、`reviews` 等表；新的 `sensebook-sync` 数据库与它隔离。

旧的 `server/` + `web/` 是 Node/SQLite 原型；它的账号和服务端记录不会自动迁入 D1。已有油猴本地词条会在首次登录新同步服务时上传；若旧服务器有独有数据，需要先另行导出并迁移。
