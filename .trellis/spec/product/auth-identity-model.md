# 账号体系设计（统一身份 · 多登录方式）

> 状态：设计稿，**盖章后再动 OAuth/改表代码**。  
> 薇尔莉特 2026-09-30：按「一个 Sensebook 用户 + 多登录方式」盖章方向。  
> OTP 仍见 [auth-otp-deferred.md](auth-otp-deferred.md)，本文件不提前开 OTP。

## 1. 目标

- **一个 Sensebook 用户**（现有 `users` + JWT），不是 Google 一个号、Telegram 一个号、邮箱又一个号。
- **邮箱注册/登录、Google、Telegram** 都只是挂到同一用户上的 **登录方式（identity）**。
- 默认可不登录；DeepSeek Key 永不经账号同步。
- Drive 不当主同步（最多后置「网盘备份/导出」）。

## 2. 概念

| 概念 | 含义 |
| --- | --- |
| User | Sensebook 账号主体；同步数据挂 `user_id` |
| Identity | 一种登录证明：`email_password` / `google` / `telegram`（以后可加） |
| Session | 现有 JWT；登录成功后仍签同一套 JWT（claim 指向 User，不指向某个 Identity） |

原则：**Identity 证明「是谁」；User 拥有数据。**

## 3. 数据模型（提案）

在现有 D1 `users` 上增量，不推倒 JWT：

```
users
  id, created_at, …
  primary_email TEXT NULL   -- 可选展示/找回；可与 email identity 对齐

user_identities
  id
  user_id          -- FK → users
  provider         -- 'email_password' | 'google' | 'telegram'
  provider_subject -- 稳定唯一键（email 小写 / Google sub / Telegram user id）
  email            -- 可选，来自该 provider
  created_at
  UNIQUE(provider, provider_subject)
```

- 现有「邮箱+密码」迁成一条 `email_password` identity（或首版兼容：`users.password_hash` 仍保留，同时写 identity 行）。
- Google / Telegram **禁止**在没有合并策略时直接 `INSERT users` 成第二条账号（见 §5）。

## 4. 登录流（提案）

### 4.1 邮箱注册 / 登录（已有，保留）

- `POST /auth/register`、`/auth/login` 行为保持；成功后确保存在 `email_password` identity。
- 「也可以直接邮箱注册登录」= **一等公民**，不是临时兼容。

### 4.2 Google / Telegram（设计后实现）

1. 客户端完成 Google OAuth / Telegram Login Widget，把 id_token 或 signed payload 交给 Worker。
2. Worker 校验签名 → 得到 `(provider, subject, email?)`。
3. 查 `user_identities`：
   - **已有** → 签发该 `user_id` 的 JWT。
   - **没有**：
     - 若当前已有 Bearer（已登录）→ **绑定**到当前用户（§5.1）。
     - 若未登录且 `email` 能唯一匹配已有 `email_password` 用户 → **自动绑定**到该用户（可选开关；默认开，需产品确认）。
     - 否则 **新建一个 User** + 一条 identity（仅此一条路径允许建号）。

### 4.3 设置页「绑定」

已登录用户可绑定尚未占用的 Google / Telegram / 邮箱密码（补绑）。

## 5. 绑定与合并规则（必盖章）

### 5.1 绑定（已登录 → 加登录方式）

- 目标 identity 的 `(provider, subject)` **未被其他用户占用** → 挂到当前用户。
- 若已被 **另一用户** 占用 → 拒绝绑定，引导走 **合并**（§5.2），禁止静默抢绑。

### 5.2 合并（两个 User 合成一个）

触发：用户已有 A（如邮箱），又曾用 Google 建了 B；或两设备各自注册。

规则提案：

1. 用户在已登录 A 时发起「合并 B」：用 B 的一种登录方式再认证一次证明拥有 B。
2. **保留用户**：默认保留 **当前登录的** User；另一条标 `merged_into`。
3. **生词本等数据**：默认 **并集去重**（按词条规范化键）；冲突字段取较新 `updated_at`；打审计日志。不做静默丢数据。
4. **Identity**：全部迁到保留用户；`UNIQUE(provider, subject)` 保证不双挂。
5. 合并后 B 的 JWT 作废；客户端需重新登录。

### 5.3 禁止的默认行为

- ❌ 同一个人用 Google、Telegram 各点一次登录 → **自动变成两个互不相干的号**（无提示、无合并入口）。
- ❌ 仅凭「邮箱字符串像」但未验证邮箱归属就合并（除 §4.2 明确的「已验证 Google email == 已有账号 email」自动绑定，若开启）。

## 6. 与现网、后置项关系

| 项 | 关系 |
| --- | --- |
| 现有邮箱+密码+JWT+Worker 同步 | **保留**，作为 User 与主同步通道 |
| OTP / magic link | 仍后置；以后作为又一种 identity 或邮箱验证手段 |
| Google Drive 同步 | **不当主同步**；最多后置备份/导出 |
| Mac 同步登录 | 仍后置；账号模型预留即可 |
| 油猴音标、静默 5 分钟 | **不跟本设计抢主线**；继续小改并行 |

## 7. 开做门槛（代码）

1. 本文件开放问题盖章（§8）。
2. 迁移脚本：`user_identities` + 现有用户回填。
3. 再实现 Google / Telegram 校验与绑定 UI；**禁止**先上 OAuth 再建拆号表。

## 8. 开放问题（待二次盖章）

1. 未登录时，Google 返回的 email 与已有邮箱账号相同：是否 **自动绑定**（默认建议：是）？
2. 合并时保留哪边：固定「当前登录」还是「创建更早」？（默认建议：当前登录）
3. Telegram 无邮箱时：是否允许无 `primary_email` 的纯 TG 用户？（建议：允许，设置里可后补邮箱）
4. 首版是否必须 Google+TG 一起上，还是先 Google 后 Telegram？

## 9. 非目标（本设计）

- 第三方托管 Auth 长期绑死（Clerk 等）
- 社交关系、公开主页
- 用登录同步 DeepSeek Key
