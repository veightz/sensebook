# Sensebook 0.3.0-preview.1 · Mac / Android 原生体验版

Mac 现在可从菜单栏在阅读现场呼出语境翻译窗口；Android 增加分享文本和直接输入，离开网页也能使用。

## 下载与安装

- **Mac：**下载 `Sensebook-0.3.0-preview.1-macOS-universal.dmg`，打开后拖入 Applications。支持 macOS 13+、Apple Silicon 和 Intel；ZIP 为备用。
- **Android：**下载 `Sensebook-0.3.0-preview.1-android-debug.apk`，支持 Android 8+，这是 debug 签名测试包。
- `SHA256SUMS.txt` 为安装包校验值。

**Mac 尚未获得 Developer ID 签名和公证。**这是 ad-hoc 签名预发布包。如果首次打开被系统拦截，在确认下载来源后，由你在系统设置 → 隐私与安全性选择「仍要打开」。不需要关闭系统安全功能。

## 怎么开始

1. 打开 Mac 应用的「设置」，填写自己的 OpenAI 兼容模型地址、模型名称和 Key（默认 DeepSeek）。API Key 保存在系统 Keychain。
2. 选中文字后按 **⌘⇧D**：需要辅助功能权限；无法读到选区时，可从菜单栏翻译剪贴板。
3. **⌘⇧Space** 打开输入窗口，补充原句，**⌘Return** 查询，**Esc** 隐藏。图钉可让窗口保持可见。
4. 菜单栏「截图识别」使用系统截图与本机 OCR，识别文字可编辑，点击提交后才发送模型。
5. 所有查询先保存到本机。在设置连接个人网站后，可自动获取账号默认模型；查询上传默认关闭，可独立开启。回顾仍在网站进行。
6. Android 可从其他应用的文字选择菜单或分享面板打开 Sensebook，也可打开 App 直接输入。

## 本次验证与边界

Swift 6 项测试、现有 Node 15 项测试及解析 smoke checks 通过；Universal Mac 包签名与最低系统检查通过，Android APK 构建通过。Mac 已实际启动并确认原生窗口；后续界面自动化工具超时，未完成 GUI 操作验收。

本次没有调用真实付费模型，没有 Android 真机连接，划词权限与截图权限未代替用户授予。部分 PDF/画布应用不提供选区，请用复制或截图。初版无流式输出、自动更新或 Android 悬浮球。

个人网站尚未完成 Cloudflare 部署；这不影响独立使用本机模型。模型服务可能收费，使用你的供应商额度；应用本身不收取费用。

参考 Bob 与 Easydict 的快捷呼出形态，界面与代码独立实现，不包含它们的代码或素材。
