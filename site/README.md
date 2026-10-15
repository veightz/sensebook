# site/ — 个人小官网（静态单页）

纯静态：`index.html` + `style.css`，无后端、无统计、无密钥。仅自用，页面带 `noindex`。

## 本地预览

```bash
python3 -m http.server -d site 8080
# 浏览器打开 http://localhost:8080
```

## 部署（Cloudflare Pages）

```bash
export CLOUDFLARE_API_TOKEN=...   # 只放环境变量，不要写进文件或提交
npx wrangler pages deploy site --project-name veight-tools --branch main
```

首次部署时若项目不存在，需要先 `npx wrangler pages project create veight-tools --production-branch main`。
Token 需要 Account → Cloudflare Pages → Edit 权限。不要用 `wrangler login`（交互式 OAuth）。

## 只让自己看（可选）

在 Cloudflare Zero Trust → Access → Applications 里给该 Pages 域名加一个 Self-hosted 应用，
策略 Allow → Emails 填你自己的邮箱；Pages 项目的 `*.pages.dev` 预览域名也要一并覆盖。

## 维护

- 更新日志（`index.html` 里 `#changelog`）为手写，发版后加一行。
- 卡片上的版本号会在浏览器里实时读取脚本头的 `@version`（3 秒超时，失败就显示内置的备用值）。
