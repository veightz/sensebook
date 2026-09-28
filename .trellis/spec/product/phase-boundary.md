# 当前阶段边界（2026-09-28 定案）

## 一句话

**Mac 真机稳 → 跨端生词本 UI。** 其余后置。

## 需求 vs 落地

| 层 | 工具 | 职责 |
| --- | --- | --- |
| 需求 / PRD / spec | Trellis（`.trellis/`） | 写清要什么、验收、阶段边界 |
| 落地 backlog | Beads（`.beads/`） | 认领、依赖、ready；已有单子不拆 |

## 下一阶段必做（对齐 Beads）

1. **Mac 真机稳** — Beads `sensebook-djd.2`：真机验证 M1 并修问题  
2. **跨端生词本 UI** — Beads `sensebook-efc`：在 Mac 真机稳之后推进

顺序：先 1 后 2。

## 默认可不登录

词条与 DeepSeek Key 本机优先。可选邮箱+密码 + JWT 跨端同步（油猴/安卓）已上线；**不要求**用户登录才能用。

## 明确后置

- 邮箱 OTP / magic link（Beads `sensebook-44n`）— 详见 [auth-otp-deferred.md](auth-otp-deferred.md)：首选现有 Worker+JWT + Resend 发信；不立刻改登录栈
- Google 等 OAuth（现阶段不推荐作主登录）
- Mac 接同步登录
- OCR（`sensebook-13d`）、多引擎（`sensebook-ue7`）、悬浮球（`sensebook-sf2`）
- 油猴 UI 清亮化/多服务商（`sensebook-0cy`）、音标小改（`sensebook-aw2`）
- Mac 可配置热键 UI（`sensebook-djd.1`）、与油猴设置对齐属 Mac epic 内后续（`sensebook-djd.3`）

## 验收口诀

本阶段 PR 应服务「Mac 真机可用」或「生词本 UI」；插队 OTP/OAuth/OCR/多引擎/悬浮球一律后置。
