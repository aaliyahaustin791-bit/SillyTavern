# SillyTavern — Mobile + Native Agents Fork

Fork of [SillyTavern](https://github.com/SillyTavern/SillyTavern) by **aaliyahaustin791-bit**.

Three pillars:
1. **Native helper agents** — Marinara-style AI agents (lorebook keeper, character smith, illustrator) built into the fork, not bolted on.
2. **Formatted for mobile** — one-handed, thumb-zone, safe-area-aware, built and tested from a phone (Termux + Kiwi).
3. **UI overhaul** — a modern dark theme and touch-first layout that ships with the fork.

## Layout

Everything fork-owned lives in isolated spots so upstream merges stay clean:

| Path | What |
|---|---|
| `public/scripts/extensions/fork-mobile/` | Foundation extension: FAB launcher, bottom sheet, mobile CSS hooks |
| `public/scripts/extensions/fork-agents/` | (Phase 2) Helper agent runtime + agents |
| `default/content/themes/` | (Phase 3) Fork-shipped themes |
| `docs/ROADMAP.md` | Build plan |
| `README-FORK.md` | This file |

Upstream files are left untouched wherever possible. `README.md` stays upstream-canonical.

## Branch strategy

- `mobile-overhaul` — the fork's work branch (this one). Based on upstream `release`.
- `release` — sync line with upstream.

Sync with upstream:
```bash
cd ~/ST-Fork
git fetch fork release            # fork = your GitHub fork
git merge fork/release            # resolve small conflicts, keep fork files
git push fork mobile-overhaul
```

## Run on Termux (dev copy, alongside live ST)

```bash
cd ~/ST-Fork
npm install                       # first time only
node server.js --port 8010        # live ST keeps :8000; fork gets its own ./data dir
```
Then open `http://127.0.0.1:8010` in Kiwi (or via literouter tunnel). The fork has a fresh `./data` — config/characters are not shared with the live install.

## Status

v0.1 — foundation extension live (FAB + bottom sheet). See `docs/ROADMAP.md`.
