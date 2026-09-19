# Cloudflare 独立部署分支

目标：在免费 Workers + D1 上发布已有网页版；Access 只保护 /login，应用 API 验证 JWT；账号模型密钥使用独立 Worker Secret 加密。生产不使用 DEV_AUTH，不同步本机测试数据。

分支：codex/cloudflare-v1，基于 codex/native-v1，包含此前个人回顾、模型配置与原生端协议。main 保持不变。

流程：检查当前凭据权限 → 用户提供允许邮箱及启用 Access → 生成被忽略的生产配置 → 复用/创建 D1 → migrations → 配置模型加密 Secret → Worker 发布 → 匿名访问验证。

2026-09-19 现场：Wrangler 4.135.0、cloudflared 2026.9.1 可运行。当前 API Token 可读 Workers 子域；D1 401/code 10000；Access apps 403/not_enabled，组织接口 403。不能用本地开发身份绕过。部署工具不足与账号授权不足明确区分。

新增工具：cloud:doctor 只读诊断；cloud:prepare 验证必要身份配置并准备 D1/生产配置；cloud:publish 应用 migrations、发布、只在首次设置模型密钥（禁止覆盖已有密钥）。生产配置和密钥备份均忽略，不入 Git。暂不自动接受套餐条款或开通付费服务。
