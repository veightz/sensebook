# Sensebook Android

Package: `com.veightz.sensebook` · `versionName` **0.2.0**
Entries: system text selection (`ACTION_PROCESS_TEXT`) and launcher vocabulary book.

## Current capabilities

| Done | Later |
|------|-------|
| DeepSeek dual-out: short word = local dict + model enrich in parallel; sentence = model only | Full 20k dict sync |
| Model UI split **词义 / 搭配效果** | Phonetics when dict field exists |
| API Key and sync token in separate encrypted preferences | Physical-device QA and release signing |
| Launcher vocabulary book: search, edit, delete, review, import/export | |
| Cloudflare sync client: login/register, offline-first upload/pull, conflict copies | |

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

The launcher icon opens the vocabulary book. `PROCESS_TEXT` still opens the quick selection dialog.

The API 36.1 emulator passed account registration, selection save → Cloudflare upload, remote pull, deletion tombstone, and review sync checks. Physical-device QA remains pending.

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
8. Tap the app icon → **账号设置**. The deployed Cloudflare sync URL is prefilled; use the same email and password as the browser userscript, then tap **立即同步**. Search, edit, review, and delete are available from this screen.

If Sensebook does not appear:

- `adb shell pm list packages | grep sensebook`
- `adb shell dumpsys package com.veightz.sensebook | grep -A2 PROCESS_TEXT`
- Some OEMs hide PROCESS_TEXT behind overflow — expand fully; reboot once after first install.

## Security

- Never commit API keys or sync tokens. Both encrypted preference files are excluded from cloud backup.
- DeepSeek Key remains only on device; it is not uploaded to the sync server.

## Dict asset

`app/src/main/assets/dict/en-zh-common.json` is the **half10k** trial copy (ECDICT MIT). App `versionName` and dict `version` are independent.

## Boundaries (薇尔莉特)

- **In**: `ACTION_PROCESS_TEXT`, local + DeepSeek dual-out, settings UI, save vocab with source  
- **Out (v1)**: floating bubble, AccessibilityService, share sheet
