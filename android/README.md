# Android V1 更新

新增启动图标“Sensebook”，可查看本地查询、粘贴网站设备连接配置、选择导入历史、开启/关闭同步和打开回顾网站。系统划词入口继续可免登录使用。

记录独立保存到 SQLite，完成解释后异步同步，不阻塞翻译展示。API Key 与同步凭据分别加密保存，并排除系统云备份。

部署和安装见 [个人版说明](../docs/deployment.md)。以下是原划词 MVP 的历史说明。

---

# Sensebook Android

Package: `com.veightz.sensebook` · `versionName` **0.1.1**  
Entry: **system text selection → `ACTION_PROCESS_TEXT` only** (no floating bubble / accessibility / share sheet).

## Milestone 2 (current)

| Done | Later |
|------|-------|
| DeepSeek dual-out: short word = local dict + model enrich in parallel; sentence = model only | Vocab list screen |
| Model UI split **词义 / 搭配效果** (userscript enrich prompt) | Full 20k dict sync |
| API Key in **EncryptedSharedPreferences** (on-device only) | Phonetics when dict field exists |
| Editable settings: Key / Base URL / model / thinking (default off) | |
| Save vocab with `source_app` when calling package available | |
| PROCESS_TEXT entry kept | |

Defaults align with userscript: Base `https://api.deepseek.com/v1`, model `deepseek-flash`, thinking disabled.

## Open in Android Studio

1. Install [Android Studio](https://developer.android.com/studio) with Android SDK 34.
2. **File → Open** → select this `android/` directory (not the monorepo root).
3. Let Gradle sync; use JDK 17 if prompted.
4. Device/emulator: API 26+.

## Build debug APK

```bash
./gradlew :app:assembleDebug
# APK: app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

No launcher icon on purpose (PROCESS_TEXT-only).

## How to test on device

1. Install the debug APK (API 26+).
2. Open Chrome / Notes / Keep → long-press → select a **short English word** (e.g. `example`).
3. Tap **Sensebook** in the text-selection menu.
4. You should see:
   - **本地词库** fill quickly if the word is in the bundled dict
   - **词义** / **搭配效果** show「查询中…」then DeepSeek enrich (or stub if Key unset)
5. Tap **DeepSeek 设置** → paste API Key → Save → model rows refresh.
6. Select a **full sentence** → local row says 整句跳过; only model fills.
7. **加入生词本** stores word + sense/collocation + `source_app` (package when available).

If Sensebook does not appear:

- `adb shell pm list packages | grep sensebook`
- `adb shell dumpsys package com.veightz.sensebook | grep -A2 PROCESS_TEXT`
- Some OEMs hide PROCESS_TEXT behind overflow — expand fully; reboot once after first install.

## Security

- Never commit API keys. Prefs file is encrypted and excluded from cloud backup.
- Key lives only on device (`EncryptedSharedPreferences`).

## Dict asset

`app/src/main/assets/dict/en-zh-common.json` is the **half10k** trial copy (ECDICT MIT). App `versionName` and dict `version` are independent.

## Boundaries (薇尔莉特)

- **In**: `ACTION_PROCESS_TEXT`, local + DeepSeek dual-out, settings UI, save vocab with source  
- **Out (v1)**: floating bubble, AccessibilityService, share sheet
