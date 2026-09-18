# V1 技术方案

- 原 Hono/Node MVP 保留；新增 `worker/index.js`，Workers Static Assets 托管 `web/`，D1 迁移在 `migrations/`。
- `query_events` 保存客户端 UUID、安装实例、实际选中文字、可空上下文、结果、时间、来源、收藏、逻辑删除及服务端版本。 `(user_id,id)` 唯一。上传只覆盖同一设备的查询结果，不能覆盖服务端收藏/删除。
- `reviews` 保存期间、时区、自然语言内容、原始事件 ID 和输入摘要指纹。删除查询时清除关联回顾，避免残留隐私文本。
- 网站读取仅来自服务器认证身份；设备凭据只存 SHA-256 摘要，可撤销，仅能同步绑定安装实例；不能管理其他设备或调用模型。
- Access 只保护 `/login`；Worker 验证 Access JWT 后写入本站 HttpOnly cookie，`/api/*` 每次验证会话。`/sync/*` 通过设备凭据独立认证。默认 fail closed。开发身份只在显式 DEV_AUTH=true 且请求 loopback 时启用。
- 脚本每条事件使用独立 GM 存储键，避免跨标签页整数组写入互相覆盖。查询开始落地，完成更新；开启同步前选择历史范围。先上传后拉取删除标记，服务端 tombstone 防止复活。
- Android 用 SQLiteOpenHelper 存持久查询，EncryptedSharedPreferences 存设备凭据，前台触发同步/手动重试。
- 统一回顾输入：程序计算时间范围、数量和摘要；模型只生成中文正文，原句是数据不是指令。输入超预算明确提示而非静默截断。周/月可直接读原始事件。
- 初版只支持 DeepSeek API 的安全代理（已获用户确认）；不开放任意 URL 代理。Key 不持久化，不记录请求正文或上游错误正文。
