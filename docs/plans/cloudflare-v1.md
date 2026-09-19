# Cloudflare 独立部署分支

目标：在免费 Workers + D1 上发布已有网页版；Access 只保护 /login，应用 API 验证 JWT；账号模型密钥使用独立 Worker Secret 加密。生产不使用 DEV_AUTH，不同步本机测试数据。

分支：codex/cloudflare-v1，基于 codex/native-v1，包含此前个人回顾、模型配置与原生端协议。main 保持不变。

流程：检查当前凭据权限 → 用户提供允许邮箱及启用 Access → 生成被忽略的生产配置 → 复用/创建 D1 → migrations → 配置模型加密 Secret → Worker 发布 → 匿名访问验证。

2026-09-19 现场：Wrangler 4.135.0、cloudflared 2026.9.1 可运行。当前 API Token 可读 Workers 子域；D1 401/code 10000；Access apps 403/not_enabled，组织接口 403。不能用本地开发身份绕过。部署工具不足与账号授权不足明确区分。

新增工具：cloud:doctor 只读诊断；cloud:prepare 验证必要身份配置并准备 D1/生产配置；cloud:publish 应用 migrations、发布、只在首次设置模型密钥（禁止覆盖已有密钥）。生产配置和密钥备份均忽略，不入 Git。暂不自动接受套餐条款或开通付费服务。

后续进展：用户完成 OAuth 登录。已创建专用 sensebook-personal D1、应用两份迁移、发布 Worker 与静态资源、设置首次生产模型加密 Secret。公网站点 https://sensebook-personal.veightz3161.workers.dev 浏览器可见，登录提示尚未配置。Access 仍未启用且 OWNER_EMAIL 未提供，未开放个人数据。脚本新增显式 OAuth 模式，不输出/另存 OAuth token。

邮箱登录配置（2026-09-19）：用户已开通 Zero Trust Free 并确认个人邮箱（仅写入被忽略的生产配置）。创建 One-time PIN 身份源及仅该邮箱可用的可复用策略；Access 应用只覆盖 Worker /login。团队域名以后台实测为准；组织 API 的 403 不等同于未开通。保留现有 D1 和模型加密 Secret，发布后检查匿名 API 拒绝与登录跳转。

后台已保存可复用个人策略与 One-time PIN 身份源。应用草稿已填好：仅 /login、仅 One-time PIN、24小时会话，等待浏览器安全要求的最终访问授权确认后提交。生产配置已记录邮箱与团队域名；AUD 未产生，不发布不完整配置。

Passkey V1：保留 Access 邮箱验证作首次绑定与恢复入口，在本站提供 WebAuthn 登录。D1 保存公钥、单次挑战和散列后的随机会话，不保存私钥。账号 ID 沿用 Access 身份，避免数据分裂。挑战绑定浏览器 HttpOnly Cookie，五分钟过期且原子消费；所有认证写请求校验 Origin，验证 RP/Origin/签名及 userVerification。凭据管理要求五分钟内认证，撤销凭据同步撤销由其建立的会话。默认24小时会话；不支持域名迁移自动继承。网站支持凭据列表/添加/撤销；同步设备协议保持兼容。先用现有 workers.dev 域名试用。部署后首次 Passkey 必须由用户在设备上创建，不能代替用户操作生物识别。
