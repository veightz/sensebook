Sensebook · 原生体验版 0.3.0-preview.1

macOS 13 或更新版本，Apple Silicon / Intel 通用。

1. 打开 DMG，将 Sensebook 拖入 Applications。
2. 从 Applications 打开 Sensebook。应用常驻菜单栏，不显示 Dock 图标。
3. 在设置填入自己的模型 Base URL、模型名与 API Key。默认 DeepSeek。
   或粘贴个人网站生成的设备连接配置，获取账号默认模型。
4. 在任意支持的应用选中文字，按 ⌘⇧D；首次需在系统设置 → 隐私与安全性 → 辅助功能允许 Sensebook，然后重启。
5. ⌘⇧Space 呼出输入窗口，⌘Return 提交，Esc 隐藏。菜单栏可翻译剪贴板或截图识别。

此预发布包使用 ad-hoc 签名，尚无 Apple Developer ID 签名和公证。macOS 可能拦截首次启动；确认下载自 veightz/sensebook 的对应发布页后，可由你在系统设置 → 隐私与安全性中选择「仍要打开」。无需关闭系统安全保护。若系统策略不允许，使用仓库的 scripts/build-macos.sh 本机构建。

隐私：只有主动划词才读取选区与邻近上下文。剪贴板只在点击时读取。截图 OCR 在本机完成，识别后需点击提交才发送模型。没有自动监听、没有整页抓取。Key 与设备凭据保存在 macOS Keychain；查询在 ~/Library/Application Support/Sensebook/events.json。登录与查询上传均可选。

本次默认直连用户选择的模型服务，API 费用由该 Key 的供应商计费。未配置 Key 时不会假装生成结果。历史和设置可离线使用，AI 查询需网络。

账号网站尚需完成 Cloudflare 部署。未连接网站也能独立使用本机模型；不要把 localhost 地址用于其他设备连接。

初版边界：部分 PDF/画布应用不提供 AX 选区，请用复制或截图；无自动更新、无流式输出；截图权限与真实付费模型需要你在自己的环境验收。截图和辅助功能权限不会自动授予。

Android APK：Android 8+，本次为 debug 签名测试包；首次安装需允许当前下载来源安装应用。支持选中文字 → Sensebook、分享文本到 Sensebook，以及打开应用直接输入。无悬浮球或后台剪贴板监听。
