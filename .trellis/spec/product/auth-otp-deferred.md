# 登录 / OTP 后置定案（2026-09-28）

调研结论与薇尔莉特定案。不立刻改现有登录栈。

## 现状（保持）

- 可选邮箱 + 密码 + JWT（Cloudflare Worker / D1）
- 默认可不登录；DeepSeek Key 本机
- Beads：`sensebook-44n`

## 没有的路

免自有域名 + 平台官方 from + 免费随便给任意用户发验证码 — **不存在**可靠方案。

## 以后做 OTP / magic link

| 优先级 | 方案 | 说明 |
| --- | --- | --- |
| **首选** | 现有 CF Worker + D1 用户/JWT **不动**，发信接 **Resend** | 免费约 3000 封/月；生产须验自有域名。发信可插拔，迁移成本最低 |
| 备选 | 域名已在 CF 且愿 Workers Paid → **CF Email Sending** | 与现网 CF 同栈 |
| 仅急试点 | Clerk 等托管 Auth | 耦合高；正式仍应回到自建 + Resend |

**不推荐现阶段**：Supabase / Auth0 / Firebase / Google OAuth 当主登录。

## 迁移预案（留后路）

1. 用户表与 JWT 继续在自有 D1；只把「发信」做成可替换适配器（先 Resend）。
2. OTP 校验接口挂在现有 Worker（`/auth/otp/request`、`/auth/otp/verify` 一类），通过后仍签现有 JWT。
3. 邮箱+密码可与 OTP 并存一段时间，再决定是否弱化密码。
4. 若曾试点 Clerk：只迁移「身份证明」结果到自有 `users`，不长期绑 Clerk 会话。

## 开做门槛

有可用发送域名（或明确接受 Paid / 试点范围）后再开小范围 OTP 试点；此前不进必做。
