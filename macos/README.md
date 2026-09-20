# Sensebook macOS (M1)

Package: `com.veightz.sensebook` · version **0.1.0** (build 1)  
Menu-bar app (`LSUIElement` / no Dock) · Swift + SwiftUI · macOS 13+ (Apple Silicon OK).

> **Build on a Mac with Xcode.** This Linux CI/box cannot compile macOS binaries; the tree under `macos/` is a complete Xcode project meant to open and build on macOS.

## Milestone 1 (current)

| Done | Later / stub |
|------|----------------|
| Menu bar icon + menu | Floating ball |
| Global hotkey **⌥D** (Option+D) | Configurable hotkey UI |
| Selection → popup (Accessibility + ⌘C pasteboard fallback) | OCR |
| Local dict gloss (short word) + DeepSeek **词义 / 搭配效果** | Multi-engine |
| Settings: API Key (**Keychain**), Base URL, model (`deepseek-flash`), thinking off | Vocab list |
| Accessibility (辅助功能) help copy in Settings / menu | |

Defaults align with userscript / Android: Base `https://api.deepseek.com/v1`, model `deepseek-flash`, thinking disabled. Enrich prompts reuse `ai_word_sense` / `ai_sentence_gloss`.

## Open in Xcode

1. Install [Xcode](https://developer.apple.com/xcode/) 15+ on a Mac (Apple Silicon recommended).
2. **File → Open** → select `macos/Sensebook.xcodeproj` (not the monorepo root).
3. Select scheme **Sensebook** → My Mac (Apple Silicon).
4. Signing: enable **Automatically manage signing** and pick your Team (personal team is fine for local Run). App Sandbox is **off** so Accessibility / global hotkey work during MVP.

## Run / verify

1. ⌘R to build & run. Confirm a **menu bar** book icon appears (no Dock icon).
2. Grant **辅助功能 (Accessibility)**:
   - Menu bar → Sensebook → **辅助功能说明…**, or Settings section, or  
   - 系统设置 → 隐私与安全性 → 辅助功能 → enable **Sensebook**
3. Menu bar → **设置…** → paste DeepSeek API Key → 保存（Key 只进本机钥匙串）。
4. In Notes / Safari / Chrome, select an English **short word** (e.g. `example`) → press **⌥D**.
5. Popup should show:
   - **选中** text  
   - **本地词库** gloss quickly if hit  
   - **词义** / **搭配效果** from DeepSeek (or stub if Key unset)
6. Select a **full sentence** → local row says 整句跳过; model still fills.

Without Accessibility, Sensebook falls back to simulating ⌘C (may briefly touch the clipboard). Prefer enabling Accessibility.

## Build from CLI (on a Mac)

```bash
cd macos
xcodebuild -scheme Sensebook -configuration Debug -derivedDataPath ./build
open ./build/Build/Products/Debug/Sensebook.app
```

## Security

- Never commit API keys. Key is stored in Keychain (`service=com.veightz.sensebook`).
- No secrets in source or `Info.plist`.

## Dict asset

`Sensebook/Resources/dict/en-zh-common.json` is the **half10k** trial copy (ECDICT MIT), same as Android. App version and dict `version` are independent. See `SOURCE.md`.

## Layout

```
macos/
  README.md
  Sensebook.xcodeproj/
  Sensebook/
    SensebookApp.swift          # @main, Settings scene
    AppDelegate.swift           # menu bar + hotkey + lookup flow
    Info.plist                  # LSUIElement=true
    Sensebook.entitlements
    Selection/                  # AX + pasteboard, Carbon hotkey
    Dict/LocalDict.swift
    LLM/DeepSeekClient.swift
    Settings/                   # Keychain + SettingsView
    UI/                         # popup panel
    Resources/dict/
    Assets.xcassets/
```

## Boundaries (M1)

- **In**: menu bar, ⌥D, selection→popup, local dict, DeepSeek HTTP, Keychain, Accessibility help  
- **Out**: OCR, multi-engine, vocab list UI, floating ball
