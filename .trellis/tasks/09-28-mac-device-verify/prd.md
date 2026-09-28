# PRD：Mac 真机验证 M1

对齐 Beads：`sensebook-djd.2`（必做①）

## 目标

在真实 Mac 上跑通 `macos/Sensebook.xcodeproj`（菜单栏、⌥D 划词、辅助功能、Keychain、本地词典 + DeepSeek），问题随报随修。

## 验收

- [ ] Xcode 能编过并启动
- [ ] 划词 / 热键路径可用
- [ ] Key 存 Keychain、本地查询与 DeepSeek 至少一条端到端成功
- [ ] 阻塞级问题已修或记入后续子任务

## 非目标

本任务不接跨端同步登录，不做生词本完整 UI（见下一任务）。
