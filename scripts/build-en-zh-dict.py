#!/usr/bin/env python3
"""Build half-size EN→ZH common dict JSON from ECDICT (MIT).

Usage:
  python3 scripts/build-en-zh-dict.py \\
    --ecdict /path/to/ecdict.csv \\
    --wordlist /path/to/google-10000-english.txt \\
    --out userscript/dict/en-zh-common.json

Dict `version` inside JSON is independent of userscript @version.
"""
from __future__ import annotations

import argparse
import csv
import json
import re
from pathlib import Path

TARGET = 10000
MAX_LEN = 20
MAX_GLOSS = 36
DICT_VERSION = "0.1.20260916-half10k"
TAG_BONUS = {
    "zk": 50,
    "gk": 40,
    "cet4": 35,
    "cet6": 30,
    "ky": 25,
    "toefl": 20,
    "ielts": 20,
    "gre": 10,
}


def is_short_word(w: str) -> bool:
    if not w or " " in w or "\t" in w:
        return False
    if not (1 <= len(w) <= MAX_LEN):
        return False
    if not re.fullmatch(r"[A-Za-z][A-Za-z\-']*", w):
        return False
    if w.startswith("-") or w.startswith("'"):
        return False
    return True


def clean_gloss(translation: str, pos: str):
    if not translation:
        return None, None
    text = translation.replace("\\n", "\n").replace("\\r", "\n")
    gloss_line = None
    for ln in re.split(r"[\r\n]+", text.strip()):
        ln = ln.strip()
        if not ln or ln.startswith("[网络]"):
            continue
        gloss_line = ln
        break
    if not gloss_line:
        return None, None

    m = re.match(r"^((?:[a-z]+\.)(?:\s*/\s*[a-z]+\.)*)\s*(.+)$", gloss_line, re.I)
    detected_pos = None
    body = gloss_line
    if m:
        detected_pos = m.group(1).replace(" ", "").lower()
        body = m.group(2)
    p = (pos or "").strip() or detected_pos
    if p:
        p = re.split(r"[\s/]+", p)[0][:10]

    body = re.split(r"[；;]", body)[0].strip()
    parts = [x.strip() for x in re.split(r"[，,]", body) if x.strip()]
    kept = []
    for part in parts:
        if not re.search(r"[\u4e00-\u9fff]", part):
            continue
        part = re.sub(r"[（(][^）)]{12,}[）)]", "", part).strip()
        part = re.sub(r"\s+", " ", part)
        if not part:
            continue
        kept.append(part)
        if len(kept) >= 2:
            break
    if not kept:
        return None, None
    body = "，".join(kept)
    body = re.sub(r"^(?:[a-z]+\.\s*)+", "", body, flags=re.I).strip(" ，、；;.…")
    if not body or not re.search(r"[\u4e00-\u9fff]", body):
        return None, None
    if len(body) > MAX_GLOSS:
        body = body[:MAX_GLOSS].rstrip("，、；;,.…") + "…"
    return body, p


def score_row(collins, oxford, tag, bnc, frq):
    s = 0
    for raw, mul in ((collins, 8), (oxford, 20)):
        try:
            s += int(raw or 0) * mul
        except Exception:
            pass
    try:
        s += min(int(frq or 0), 40)
    except Exception:
        pass
    try:
        s += min(int(bnc or 0), 30)
    except Exception:
        pass
    for t in (tag or "").lower().replace(" ", "").split("/") if tag else []:
        s += TAG_BONUS.get(t, 0)
    return s


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ecdict", required=True)
    ap.add_argument("--wordlist", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--version", default=DICT_VERSION)
    ap.add_argument("--target", type=int, default=TARGET)
    args = ap.parse_args()

    priority = []
    seen = set()
    for line in Path(args.wordlist).read_text(encoding="utf-8").splitlines():
        w = line.strip().lower()
        if is_short_word(w) and w not in seen:
            seen.add(w)
            priority.append(w)
    wanted = set(priority)

    index = {}
    with Path(args.ecdict).open("r", encoding="utf-8", errors="replace", newline="") as f:
        for row in csv.DictReader(f):
            w = (row.get("word") or "").strip()
            if not w:
                continue
            key = w.lower()
            if not is_short_word(key):
                continue
            sc = score_row(
                row.get("collins"),
                row.get("oxford"),
                row.get("tag"),
                row.get("bnc"),
                row.get("frq"),
            )
            if key not in wanted and sc < 25:
                continue
            gloss, pos = clean_gloss(row.get("translation") or "", row.get("pos") or "")
            if not gloss:
                continue
            prev = index.get(key)
            if prev is None or sc > prev[2]:
                index[key] = (gloss, pos, sc)

    entries = {}
    for w in priority:
        if w in index:
            gloss, pos, _ = index[w]
            e = {"g": gloss}
            if pos:
                e["p"] = pos
            entries[w] = e
        if len(entries) >= args.target:
            break
    if len(entries) < args.target:
        rest = sorted(
            ((w, v) for w, v in index.items() if w not in entries),
            key=lambda kv: (-kv[1][2], kv[0]),
        )
        for w, (gloss, pos, _) in rest:
            e = {"g": gloss}
            if pos:
                e["p"] = pos
            entries[w] = e
            if len(entries) >= args.target:
                break

    payload = {
        "version": args.version,
        "source": "skywind3000/ECDICT (MIT) https://github.com/skywind3000/ECDICT",
        "license": "MIT",
        "note": "Half-size UX trial (~10k). Dict version is independent of userscript @version.",
        "count": len(entries),
        "entries": entries,
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {out} entries={len(entries)} size={out.stat().st_size}")


if __name__ == "__main__":
    main()
