# Local dictionary data

- **File**: `en-zh-common.json` (full v1 ceiling)
- **对照**: `en-zh-common.half10k.json` (earlier half-size ~10k trial; kept for comparison)
- **Dict `version` field**: independent of userscript `@version` (script bumps must not clear dict GM cache unless expected dict version changes)
- **Source**: [skywind3000/ECDICT](https://github.com/skywind3000/ECDICT) (MIT License)
- **Subset**: ~20k common English headwords (Google 10k-English frequency order + ECDICT frequency/tag boost); single-token Latin words length ≤20; file size ≤ ~1.5MB
- **Fields**: short Chinese gloss (`g`) + optional POS (`p`). No example sentences
- **Build**: see `scripts/build-en-zh-dict.py`

Redistribute with ECDICT MIT attribution.
