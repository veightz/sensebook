# PRD：油猴词义旁音标

对齐 Beads：`sensebook-aw2`（近期，非后置）

## 目标

本地词库带上 ECDICT 音标；油猴在展示**单词含义**时一并显示音标（划词浮层 / 本地双出路径优先）。

## 验收

- [ ] `scripts/build-en-zh-dict.py`（或等价）把音标字段打进 `en-zh-common.json`（体积可接受）
- [ ] 有音标的词在含义旁可见（如 `/ˈæp.əl/` 或 ECDICT 原格式，统一一种）
- [ ] 无音标时不留空白坑、不报错
- [ ] 朗读（speechSynthesis）行为不变

## 序

Mac 真机优先；本项可并行。跨端生词本 UI 仍在其后。

## 非目标

安卓 / Mac 音标 UI 可随后对齐，不本单必做。
