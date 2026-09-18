# V1 技术方案

- 原 Hono/Node MVP 保留；新增 `worker/index.js`，Workers Static Assets 托管 `web/`，D1 迁移在 `migrations/`。
- `query_events` 保存客户端 UUID、安装实例、实际选中文字、可空上下文、结果、时间、来源、收藏、逻辑删除及服务端版本。 `(user_id,id)` 唯一。上传只覆盖同一设备的查询结果，不能覆盖服务端收藏/删除。
- `reviews` 保存期间、时区、自然语言内容、原始事件 ID 和输入摘要指纹。删除查询时清除关联回顾，避免残留隐私文本。
- 网站读取仅来自服务器认证身份；设备凭据只存 SHA-256 摘要，可撤销，仅能同步绑定安装实例；不能管理其他设备或调用模型。
- Access 只保护 `/login`；Worker 验证 Access JWT 后写入本站 HttpOnly cookie，`/api/*` 每次验证会话。`/sync/*` 通过设备凭据独立认证。默认 fail closed。开发身份只在显式 DEV_AUTH=true 且请求 loopback 时启用。
- 脚本每条事件使用独立 GM 存储键，避免跨标签页整数组写入互相覆盖。查询开始落地，完成更新；开启同步前选择历史范围。先上传后拉取删除标记，服务端 tombstone 防止复活。
- Android 用 SQLiteOpenHelper 存持久查询，EncryptedSharedPreferences 存设备凭据，前台触发同步/手动重试。
- 统一回顾输入：程序计算时间范围、数量和摘要；模型只生成中文正文，原句是数据不是指令。输入超预算明确提示而非静默截断。周/月可直接读原始事件。
- 回顾支持保存的账号模型或临时 DeepSeek Key；代理端点受 allowlist 限制。账号 Key 加密持久化，临时 Key 不持久化；不记录请求正文或上游错误正文。

## 账号模型配置（用户新增要求）
- `model_profiles` 保存多个配置及唯一默认项；API Key 采用 AES-256-GCM + 每次随机 IV，AAD 绑定 user_id/profile_id。`MODEL_CONFIG_KEY` 为 Worker Secret，生产无默认值。本地随机生成到被忽略的 .dev.vars。
- 网站 CRUD 仅返回掩码，更新时 Key 留空表示保留。回顾用 profile_id 在服务端解密；默认不下载到网页存储。
- `/sync/model-config` 仅授权设备读取账号默认配置（返回 Key，TLS，no-store）；设备可独立关闭模型同步，默认开启。查询历史同步独立控制。
- 油猴云端 Key 必须使用 GM 私有存储；Android 沿用加密偏好。云端配置删除会清理该设备上由云端托管的配置；手动本机配置优先取消自动跟随。
- 云端回顾默认仅向 DeepSeek/OpenAI origin 请求，禁止跟随重定向转发 Key；自定义 origin 必须由站点 Secret/配置显式允许。设备仍可使用用户保存的自定义 HTTPS OpenAI 兼容地址。
