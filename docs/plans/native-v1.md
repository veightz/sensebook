# Native V1 · 2026-09-19

产品：菜单栏常驻、轻量悬浮窗口，选中 → 快捷键 → 原句解释。保留手动输入与剪贴板入口，权限被拒绝仍可用。Mac 原生 SwiftUI/AppKit，macOS 13+，Apple Silicon + Intel 通用包。独立实现，不复制 Bob/Easydict 源码与素材。

交互：⌘⇧D 读取当前应用选区；⌘⇧Space 输入；菜单截图识别；Esc 隐藏，图钉保持窗口。输入区独立原句字段，能取到则预填，取不到不编造。语境解释/整句翻译切换。历史可搜索、复制、重新打开。设置支持 OpenAI 兼容模型，Keychain 保存 Key；设备连接配置同步默认模型，记录上传默认关闭。回顾打开网站。

技术：AX 只在用户快捷键时读取选区与邻近文本，不模拟复制、不监控剪贴板。剪贴板只在点击时读取。截图由系统交互式截图 + Vision 本地 OCR，临时图片用后删除。模型 HTTPS URLSession，禁止重定向携带 Key；失败保留事件并允许重试。事件原子 JSON 文件存 Application Support，协议沿用 /sync/*，设备凭据也进 Keychain。无开发者证书时 ad-hoc 签名，明确未公证；不绕过 Gatekeeper。

Android：保留系统选中文字入口，增加 ACTION_SEND 分享文本与首页直接输入、粘贴。复用查询、模型配置、历史能力。预发布 APK 明确为 debug 签名。

交付：构建 Universal .app、DMG、ZIP、APK、SHA256；验证启动、页面、API fixture 测试与现有回归；推送功能分支，GitHub prerelease 提供稳定下载链接。真实付费模型仅在用户配置后调用，不盗用现有 Key 做测试。

参考：https://bobtranslate.com/guide/quickstart/translate.html 和 https://github.com/tisfeng/Easydict 。用户所说 Alice 尚未确认对应项目。

## 验证结果

- Swift 6 项测试：接口校验、语境 prompt、响应解析、事件编码、fixture 请求/401、重定向阻断。
- Node 15 项集成/单元测试及 6 项解析 smoke checks 通过，包含 macos 来源入库。
- Mac arm64 + x86_64 编译，Mach-O 两架构最低系统均为 macOS 13；ad-hoc 签名验证通过。
- Android assembleDebug 通过；现场无 adb 真机，未做真机验证。
- Mac 实际启动并读取到原生窗口控件。后续 CUA 原生操作连接超时，GUI 点击流程未完成；进程采样正常等待事件，无崩溃报告。
- 未调用用户真实付费 Key；划词/截图权限由用户在安装后授予，尚未验证真实跨应用选区/OCR。
