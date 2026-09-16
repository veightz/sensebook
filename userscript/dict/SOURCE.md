# Local dictionary data

- **File**: `en-zh-common.json`
- **Dict `version` field**: independent of userscript `@version` (script bumps must not clear dict GM cache)
- **Source**: [skywind3000/ECDICT](https://github.com/skywind3000/ECDICT) (MIT License)
- **Subset**: ~10k common English headwords (Google 10k-English frequency order + ECDICT frequency/tag boost); single-token Latin words length ≤20
- **Fields**: short Chinese gloss (`g`) + optional POS (`p`). No example sentences
- **Build**: see `scripts/build-en-zh-dict.py`

Redistribute with ECDICT MIT attribution.
