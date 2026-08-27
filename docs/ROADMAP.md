# Fork Roadmap

**Goal:** SillyTavern with Marinara-style native helper agents, formatted for mobile, with a UI overhaul.

## Phase 1 — Mobile overhaul *(in progress)*

- [x] `fork-mobile` foundation extension (FAB launcher, bottom sheet, safe-area CSS hooks)
- [ ] Input bar: bottom-anchored, thumb-friendly send button, quick-tools row
- [ ] Touch targets ≥ 44px on primary controls (send, edit, swipe, panel buttons)
- [ ] One-handed panel navigation (bottom tab bar / thumb zone)
- [ ] Landscape + small-screen pass (Z Flip cover screen widths)
- [ ] Kiwi + literouter testing loop, real-device tuning
- [ ] Fix: horde.js / connection-manager / settings screens on narrow viewports

## Phase 2 — Helper agents *(Marinara-inspired, native)*

- [x] **Agent core**: launcher UI (FAB sheet), shared runtime (chat context, active-model call, prompt templates, result panel)
- [x] **Lorebook Keeper** — write/expand world info entries from chat; suggest new entries
- [x] **Character Smith** — draft full V2 character cards from a one-line prompt
- [ ] **Illustrator** — scene/character art via connected image backend (Stable Horde / SD WebUI) *(next pass)*
- [ ] *(optional)* **Director** — plot, continuity, and scene suggestions
- [x] Slash commands (`/agent <name> <prompt>`) + one-tap UI buttons

## Phase 3 — UI overhaul & release

- [ ] `fork-dark` theme shipped in `default/content/themes/`
- [ ] Settings screens touch pass
- [ ] First upstream sync as a live workflow test
- [ ] Public release notes + screenshots

## Sync workflow (tested)

```bash
git fetch fork release
git merge fork/release
git push fork mobile-overhaul
```

## Notes

- All fork features are ST extensions in-repo (auto-load with the fork; survive upstream merges).
- Live install at `~/SillyTavern` stays untouched — fork dev happens in `~/ST-Fork` (worktree).
- Mobile detection: ST's `isMobile()` (UA platform type) — fork CSS hooks on `html[data-fork-mobile="1"]`.
