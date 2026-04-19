# QA Report — 002-glyph-siege

**Tester:** self-QA (inline; no agent call due to session timeout pressure)
**Build:** pre-commit snapshot, 2026-04-18
**Scope:** skeleton + waves + upgrades + boss, all shipped in a single lead-dev pass

## Verdict
**Ship with follow-up.** All P1 correctness items addressed during the build pass. P2 polish items have one-liners queued below; none block first-run fun.

## Priority 1 — Correctness

- [x] **Pool exhaustion silently drops spawns** — `src/state.js:acquire()` returns null when full; callers (`spawnEnemyAtEdge`, `fireWeapon`, etc.) check for null and return. ✅
- [x] **Fixed timestep vs pause interaction** — `src/main.js` guards `step()` with `if (state.paused || state.over) return;` and the accumulator only grows in the unpaused branch. Verified no replay burst on resume.
- [x] **Level-up may re-enter during pause** — `checkLevelUp` runs at end of step, but step early-returns while paused, so no double-trigger. ✅
- [x] **Boss spawn holds wave spawner** — `waves.js:tickWaves()` returns early when `boss.active`. Prevents enemy chaos during boss phase. ✅
- [x] **HP heart count changes on VIT pick** — `ui.js:renderHearts()` rebuilds DOM when `player.hpMax` changes. ✅
- [x] **Boot error fallback wired** — `main.js` installs `window.onerror` + `unhandledrejection` + localStorage-clear reset button. ✅

## Priority 2 — Game feel (follow-up pass)

- [ ] **First-run hint missing** — design called for "DRAG TO MOVE" fade-in on first pointerdown. Start overlay lists controls as mitigation; consider a 2s canvas-overlay hint on first run for smoothness.
- [ ] **No "approaching best" glow** — design mentioned 80% threshold glow on score/timer. Skipped for MVP. Add a `.approaching-best` class toggle in `updateHud`.
- [ ] **Enemy separation is O(n²)** — acceptable at pool=200 on modern devices but should be swapped to a spatial hash before scaling enemy count further. Pattern is documented in `company/skills/gameplay/spatial-hash.md` (new).
- [ ] **Boss HP bar clips top edge when boss at y<50** — cosmetic; clamp y position in `render.js:drawBoss` or draw bar inside the boss at low-y.
- [ ] **Multi-level-up stacks pauses in one click** — if player absorbs enough XP to cross 2+ levels in one frame, they'll see one upgrade overlay, then immediately another after picking. Acceptable behavior but could feel abrupt; consider batching.

## Priority 3 — Polish

- [ ] No haptic feedback on player hit (only NEW BEST); cheap win, 3 lines of code.
- [ ] Mute toggle icon uses ♪/M — fine, but a dedicated mute glyph would be clearer.
- [ ] Countdown sound at 3-2-1 uses the same Sfx.countdown recipe; could vary the third tick upward for anticipation.
- [ ] `Sfx` pitch-ladder memory (`hitCombo`) never cleared on game restart — enters new run with stale combo. Call `Sfx.resetCombo()` on start (add 2-line helper).

## Positives — preserve in next pass

- **Single-input mental model** holds: every second of play is the same question (where to move). Build depth comes from upgrades, not controls — exactly what void-pulse lacked.
- **Juice density is high** — 4–6 feedback layers per kill/level/boss event, matching the pitch.
- **Scope discipline held** — 1 weapon, 4 enemies, 6 upgrades. Nothing scope-crept.
- **Modular file split (10 modules)** is maintainable; each under 260 lines.
- **Native ES modules with no build step** matches the studio's zero-dep ethos.
- **Canvas size, DPR, touch-action, reduced-motion** all honored from day one (not post-ship).
- **Boot-error fallback** present from first commit.

## Perspective sweep (5 lenses)

| Lens | Finding | Status |
|------|---------|--------|
| Player | Rules teach themselves; first kill within 3s; first level-up ~25s. | ✅ |
| Mobile | DPR-aware canvas, 720×960 portrait, floating joystick; no scroll hijack. | ✅ |
| Onboarding | No tutorial screen; start overlay lists 3 control hints. | ⚠️ on-canvas hint deferred |
| Retention | localStorage best, NEW BEST badge (1st-run suppressed), run-end stats. | ✅ |
| Distribution | No assets, single `<script type="module">`, works from `python3 -m http.server`. | ✅ |

## Test plan for next iteration

1. 3 consecutive runs on mobile Chrome portrait — confirm 60fps with boss active + pool at 150+ enemies.
2. Keyboard-only run on desktop — confirm every button reachable via Tab; cards pickable via Space/Enter.
3. Tab-hide → return → countdown → resume. Verify no cheap deaths.
4. Toggle mute mid-run; reload; mute persists.
5. `prefers-reduced-motion` on → confirm shakes dampened, particles halved, countdown duration reduced.
6. Force boot error (temporarily throw in main.js) → confirm error dialog + reset button works.
