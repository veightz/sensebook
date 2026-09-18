# Sensebook Android (MVP scaffold)

Package: `com.veightz.sensebook`  
Entry: **system text selection → `ACTION_PROCESS_TEXT` only** (no floating bubble / accessibility; share sheet later).

## Milestone 0 → 1 (current)

| Done | Next |
|------|------|
| Gradle + Kotlin single-Activity project (`minSdk 26`) | DeepSeek dual-out network call |
| `PROCESS_TEXT` intent-filter → appears in selection menu as **Sensebook** | Editable DeepSeek settings UI |
| UI: selected text / local gloss / model placeholder / save | Full dict download or sync with userscript 20k |
| Bundled half10k EN→ZH JSON + light stem lookup | Phonetics when dict field exists (POS already shown) |
| Local vocab `SharedPreferences` save | Vocab list screen |
| DeepSeek settings **placeholder** dialog | |

## Open in Android Studio

1. Install [Android Studio](https://developer.android.com/studio) (Ladybug / Koala+ OK) with Android SDK 34.
2. **File → Open** → select this `android/` directory (not the monorepo root).
3. Let Gradle sync; use JDK 17 if prompted.
4. Device/emulator: API 26+.

## Build debug APK

From this directory:

```bash
./gradlew :app:assembleDebug
# APK: app/build/outputs/apk/debug/app-debug.apk
```

Or Android Studio: **Build → Build Bundle(s) / APK(s) → Build APK(s)**.

Install:

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

The app has **no launcher icon** on purpose (PROCESS_TEXT-only). It still installs and registers the intent.

## Verify PROCESS_TEXT entry

1. Install the debug APK on a phone/emulator (API 26+).
2. Open any app with selectable text (Chrome, Messages, Keep, Notes).
3. Long-press → select a word (e.g. `example`).
4. Tap **⋯** / **Share** overflow / text selection toolbar until you see **Sensebook** (label from `process_text_label`).
5. Tap **Sensebook** → dialog shows selected text + local gloss if the word is in the bundled dict; **加入生词本** writes local prefs; **DeepSeek 设置** shows the placeholder.

If Sensebook does not appear:

- Confirm package installed: `adb shell pm list packages | grep sensebook`
- Confirm exported activity: `adb shell dumpsys package com.veightz.sensebook | grep -A2 PROCESS_TEXT`
- Some OEMs hide PROCESS_TEXT behind a overflow “Text” / “Translate” menu — expand fully.
- Reboot once after first install if the menu was cached.

## Dict asset

`app/src/main/assets/dict/en-zh-common.json` is the **half10k** trial copy of `userscript/dict/en-zh-common.half10k.json` (ECDICT MIT). App `versionName` and dict `version` are independent.

## Boundaries (薇尔莉特)

- **In**: `ACTION_PROCESS_TEXT`, local gloss, save vocab stub, DeepSeek settings stub  
- **Out (v1)**: floating bubble, AccessibilityService, share sheet (later)
