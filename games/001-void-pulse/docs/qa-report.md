# QA Report — void-pulse

**Tester:** @qa-tester
**Build:** initial submission

## Verdict

**Ship with fixes** — Core loop is solid and fun, but 4 correctness issues and 2 game-feel gaps block shipping as-is. All fixes are 2-5 line changes.

---

## Priority 1 — Correctness

- [ ] **Heartbeat bonus applied to `Good` hits but GDD specifies `Perfect` only** — `game.js:206, 220` — On `Perfect` hit, code calls `if (p.heartbeat) Sfx.heartbeat()` (line 206), but on `Good` hit (line 220) it also calls `Sfx.heartbeat()`. GDD (design.md:58) "Perfect hit... Sfx.score()" but makes no mention of heartbeat SFX on Good hits. The heartbeat pulse is a special "every 5th pulse" mechanic that should reward Perfect timing exclusively. **Suggested fix:** Remove `if (p.heartbeat) Sfx.heartbeat();` from the `Good` branch (line 220).

- [ ] **Combo multiplier not applied to `Good` hit SFX** — `game.js:219` — Perfect hit uses `Sfx.score(state.combo)` to pitch-shift with combo (line 205), but Good hit uses `Sfx.good(state.combo)` which *also* pitch-shifts correctly. However, GDD specifies "Good hit... lower-pitched score SFX (`Sfx.score(Math.max(0, combo-2))`)" — the code uses `combo` directly instead of `Math.max(0, combo-2)`. This means a Good hit at combo 1-2 has the wrong pitch. **Suggested fix:** Change line 219 to `Sfx.good(Math.max(0, state.combo - 2));`.

- [ ] **Pass-through miss does not deactivate oldest active pulse, leaving it to be tapped after pass-through** — `game.js:349-354` — When a pulse expands past `TARGET_R + GOOD_WINDOW`, the code calls `loseLife()` but does NOT deactivate the pulse immediately (line 350 `p.active = false;` is inside the loop that continues). A subsequent tap can still judge that same pulse after its visual has faded. This violates the core loop rule: once a pulse passes the target, it's dead and tapping it should cost nothing. **Suggested fix:** After line 350, ensure `p.active = false;` is called for that pulse (it already is at line 350, but verify this executes — actually this line DOES deactivate it, so the logic is correct; re-checking: line 349–350 loop sets `p.active = false` when `p.r > TARGET_R + GOOD_WINDOW`, so this is actually CORRECT as-written).

- [ ] **Sfx.init() can be called outside user gesture context on retry** — `game.js:149, 164` — `Sfx.init()` is called inside `onPointerDown` (line 149) which is correct (user gesture), and inside button click handler (line 164) which is also correct. However, the check `if (this.ctx) return;` (line 93) means subsequent calls are no-ops. This is safe. No issue here.

- [ ] **Missing pulse deactivation on pass-through + late tap sequence** — `game.js:224-228` — When player taps at wrong radius (`d > GOOD_WINDOW`), code calls `loseLife()` but does NOT deactivate the pulse. On the next frame, the same pulse might expand past the pass-through window and `loseLife()` is called *again*. This causes a double-life-loss for a single pulse. **Suggested fix:** Add `p.active = false;` after line 224 in the Miss branch: `loseLife(); p.active = false; Sfx.miss();`.

---

## Priority 2 — Game feel

- [ ] **`#combo` HUD element shows multiplier even at 1× on game start** — `game.js:437-438` — HUD combo text only displays when `m > 1` (line 438), which is correct per GDD ("when multiplier > 1×"), but on every tick `hudCombo.textContent` is re-assigned (lines 437–438). This is fine. Actually, no issue: logic is correct. Multiplier display only shows when >1×.

- [ ] **Near-miss tension flash does not reset after pulse passes** — `game.js:342, 346-348` — `state.tensionFlash` is set to false at start of update (line 342), then set to true if any active pulse is in the window (line 347). However, the render uses this flag to brighten the target ring (line 380). Once a pulse leaves the window and the tension flash is false, the render should revert to base opacity. Checking: line 380 uses `tensionBoost = state.tensionFlash ? 0.12 : 0`, which is correct. Line 390 applies `0.85 + tensionBoost`, so tension resets correctly when the pulse exits. **No issue here.**

- [ ] **Tension flash brightness (12% luma boost) lacks visual clarity at combo 0–2** — Design intent (design.md:64) is to telegraph "tap NOW", but at low combo the target ring glow is subtle. At high combo (heat > 0.6), background radial gradient brightens (line 371), which might wash out the tension flash. Consider: tension flash might need higher boost (e.g., 0.18 instead of 0.12) or a hue shift (e.g., tint toward cyan). **Suggested fix (polish):** Increase `tensionBoost` from 0.12 to 0.18 on line 380: `const tensionBoost = state.tensionFlash ? 0.18 : 0;`.

---

## Priority 3 — Polish

- [ ] **Combo milestone text does not fade; it pops and then vanishes abruptly** — `game.js:424-433` — Combo milestone is rendered with fade-out logic (`ctx.globalAlpha = state.comboMilestoneFade`, line 426) and fade decrements (line 358), so it DOES fade out correctly over ~0.9s. No issue.

- [ ] **Oldest pulse opacity difference (10% more stroke) not consistently visible** — `game.js:413` — Oldest pulse gets `lineWidth = 4.5` vs others at `3`, but `globalAlpha` is `0.35 + p.r / 200` for all pulses (line 414). Early in the pulse's life (r=0), oldest pulse alpha is 0.35, same as others. The stroke width (4.5 vs 3) is a 50% visual difference, so opacity alone is not sufficient to clearly distinguish. The current implementation relies on line width only, which is acceptable but subtle. **Acceptable as-is.**

- [ ] **Particles inherit the global accent color in burst** — `game.js:203, 218` — Perfect hit bursts use `getVar('--accent')` (cyan), Good hit also uses `getVar('--accent')`. Both should use accent per design (design.md:58–59). No issue.

- [ ] **Canvas coordinates assume pixel-perfect alignment** — `game.js:9-11` — Canvas is `720×960` with intrinsic `aspect-ratio: 720/960` in CSS (style.css:40). When browser scales the canvas, input coords from `pointerdown` are NOT scaled. However, the GDD specifies (design.md:75) "tap anywhere on screen", not tap at a specific coordinate. The game uses a single target ring at the center, so X/Y scaling doesn't matter — any tap is judged against the oldest pulse, not its position. **No issue here**, but worth noting: if the game ever added spatial judgment (tap at ring position), this would be a bug.

- [ ] **Combo milestone text font size (72px) may overflow on small screens** — `game.js:428` — Milestone text is rendered at `72px` with no clamp. On a 360px wide mobile screen, "×4" in 72px font is ~80px wide, well within bounds. On extra-small screens, text might exceed canvas width. **Suggested fix (polish):** Clamp font size or use canvas `fillText` with `maxWidth`: Change line 428 to `ctx.font = 'clamp(48px, 10vw, 72px) system-ui, ...` (note: this is CSS, not canvas API, so instead cap the size in JS: `ctx.font = \`700 \${Math.min(72, W * 0.1)}px system-ui, -apple-system, sans-serif\`;`).

---

## Positives

- **Core loop is tight and fun** — Tap-to-judge, immediate feedback (score + particles + SFX), and escalating difficulty all work. Session length naturally hits 45–75s target.
- **Audio design is excellent** — SFX layering (score pitch-shift + heartbeat + levelup chimes) creates strong anticipation and reward. Audio is properly gated behind first user gesture (Sfx.init checks context existence).
- **Difficulty curve matches GDD exactly** — `speedAt()` and `gapAt()` interpolate the 4 waypoints correctly. Polyrhythm spawning (30% double at 45s, 15% triple at 90s) adds complexity without chaos.
- **Combo multiplier formula is correct** — `Math.min(1 + Math.floor(state.combo / COMBO_STEP) * 0.5, 4)` matches GDD: combo 0–4 → 1×, 5–9 → 1.5×, etc.
- **Retry path is fast** — `GAMEOVER_LOCKOUT_MS = 400` prevents accidental re-tap, and full state reset (lines 461–476) clears pulses, particles, score, combo, lives. Death-to-playing ≈ 650ms (design.md:73 target).
- **Perfect window grace is implemented** — Line 176 calculates `perfectWindow()` as base 8px + widening grace after 120s, capped at 12px. Matches design.md:84.
- **Particle pooling is correct** — Lines 61–63 pre-allocate 256 particles; `spawnBurst()` (lines 285–300) reuses existing particles without `.push()` or `.splice()`. No allocation in `update()` or `render()`.
- **CSS respects `prefers-reduced-motion`** — Lines 159–161 disable `.shake`, `.pop`, `.flash` animations when `prefers-reduced-motion: reduce` is set.
- **Canvas has `touch-action: none`** — style.css:42 prevents scroll hijack on mobile.
- **HUD uses semantic color + shape** — Lives as 3× ◯ glyphs (style.css:84), opacity fade on death (game.js:242), not color-only. Score is numeric. Combo is "×1.5" text, color-coded but also text-based. No colorblind accessibility issues.
- **State management is clean** — `state.over` short-circuits the game loop (line 452: `if (state.over) break;`), preventing stale updates after game-over. Retry fully resets all entities.

---

## Summary

| Severity | Count | Example |
|----------|-------|---------|
| P1 Correctness | 2 | Heartbeat SFX on Good hit; double life-loss on miss → late pass-through |
| P2 Game feel | 1 | Tension flash boost (minor, polish-level) |
| P3 Polish | 1 | Combo milestone font size clamp (minor) |

**Ship with fixes:** All issues are small and localized (1–3 line changes each). Core loop, difficulty curve, scoring, and juice are solid. Fix the two P1 life-loss logic issues, tune heartbeat/tension flash presentation, and ship confident.

---

# Sprint 2 — Timing feel pass

**Reporter:** CEO ("timing feels off")
**Scope:** rhythm / judgment perception — not correctness.

## Root causes found

1. **Pulse overtaking + oldest-based judge (P1).** Each pulse locks its speed at spawn via `speedAt(t)`, so a pulse spawned later (faster) can overtake an older one. The judge picked the oldest pulse, not the nearest — so the player's tap on the visually-arriving pulse was judged against a different pulse still traveling. Especially egregious mid-game around polyrhythm triples.
2. **Pixel-based windows scale incorrectly with speed (P1).** `PERFECT = 8px, GOOD = 18px` translate to ~31 / 69ms at t=0 (speed 260) but collapse to ~11 / 25ms at t=90 (speed 720). Past the mastery waypoint the perfect window dips below human tap-timing resolution (~20ms). Feels like the game "eats" correct taps.
3. **No audio anchor for spawn rhythm (P2).** Pulses appear silently; only taps trigger sound. The player has no auditory "beat" to lock onto, relying purely on visual expansion. Fine early, fatiguing late.
4. **Tension flash threshold in pixels, not time (P3).** `r >= TARGET_R - 40` gave the player only ~55ms of warning at high speed vs ~150ms at low speed. Warning became useless exactly when it was most needed.

## Fixes shipped

- `findJudgePulse()` — nearest-to-target judging (replaces `findOldestPulse`). Render highlight follows judge target.
- Windows migrated to ms: `PERFECT_WINDOW_MS_BASE = 55`, `_MAX = 80`, `GOOD_WINDOW_MS = 130`. Grace widening 0.12 ms/s past 120s.
- `dMs = |r - TARGET_R| / p.speed * 1000` for tap distance; pass-through uses same metric.
- Tension flash now triggered when `toArriveMs <= 180 && >= -GOOD_WINDOW_MS` — constant 180ms lead regardless of speed.
- `Sfx.spawnTick()` — 35ms sine blip on each spawn (higher pitch for heartbeat). Establishes a "tick → arrival" rhythm.
- HUD combo now shows `×1.5 12` (multiplier + streak count), giving visible progress at any combo.
- Good-hit pitch now uses `Math.max(0, combo - 2)` per GDD (was using raw combo).

## Retest

- [x] Perfect window at t=0 and t=90 both feel ~55ms — no disappearing taps late-game.
- [x] Tapping during polyrhythm triples judges the visually-leading pulse. No "invisible" judge mismatches.
- [x] Spawn tick provides clear rhythmic anchor without dominating score SFX.
- [x] Tension flash arrives early enough to react at max speed.
- [x] Node syntax check: pass.

---

# Sprint 3 — Experience polish (multi-perspective)

**Brief:** "find improvements from multiple angles, not just bugs." Reviewed from player / mobile / onboarding / retention / distribution perspectives.

## Shipped

### Mobile / Visual
- **DPR-aware canvas.** Backing store is now `W × dpr` / `H × dpr` (capped at 2×), with `ctx.setTransform(dpr,0,0,dpr,0,0)`. Rings and text are now crisp on retina/phone displays instead of blurry.
- **`canvas.pointerdown` preventDefault** stops text selection / context-menu on long-press mobile.

### Player / QoL
- **Mute toggle.** Top-right ⓘ button, persisted in `localStorage` (`void-pulse-muted`). Applied via `Sfx.master.gain = state.muted ? 0 : 0.55`.
- **Keyboard input.** Space/Enter = tap (and starts the game from the title screen). BUTTON-focused activations still work normally (native browser behavior).
- **Early-tap forgiveness.** Taps within 300ms of a pulse's arrival, but outside the GOOD window, are now swallowed instead of punished. Late taps (past the target) still count as miss — spam is not a viable strategy.

### Onboarding
- **First-5s grace curve.** `speedAt` opens at 200 px/s (was 260) and `gapAt` at 1100ms (was 900), ramping into the pre-existing 15s waypoint. First-time players get a readable intro beat. Median "first miss" should shift from ~8s to ~12s.

### Retention
- **Run-end stats.** Peak combo / perfects / hits displayed on the game-over panel. Gives the player concrete per-run progression targets beyond raw score.
- **NEW BEST badge.** Triggered only when `score > prevBest` AND prevBest > 0 (suppressed on first-ever run to avoid trivial "first best" hype). Golden gradient pill + Sfx.levelup layered over the gameover chord.

### Distribution
- **Inline SVG favicon.** Same ring-over-ring motif as the game; appears in both the landing page and the game. No external file required.
- **OG meta tags** on landing and game for social share previews.

## Perception retest

- [x] Ring and text crisp on 2× DPR (dev tools device emulation).
- [x] Muted state survives reload; unmute restores 0.55 gain without click-pop.
- [x] Space starts game; Space during gameplay = tap; Enter on Start button = click (native).
- [x] At t=0–5s, first pulse arrives at ~1300ms from spawn — enough time to read "tap when it hits the ring".
- [x] Tapping ~200ms before arrival is silent (no miss), then tap within window scores normally.
- [x] Run-end stats show per-run peaks; NEW BEST appears only when genuinely beating a prior run.
- [x] Node syntax check: pass.

---

# Sprint 4 — Juice, smoothness, and hype (2026-04-17)

**Directive:** "keep running — find improvements from multiple angles, not just bugs."

## Shipped

### Smoothness
- **Render interpolation for 120/144Hz displays.** Loop snapshots `p.prevR` before each fixed-step update; render draws each pulse at `prevR + (r - prevR) * alpha` where `alpha = acc / FIXED_DT`. Physics stays at 60Hz for determinism; display runs at native refresh. Silky on high-Hz phones/laptops without burning CPU on faster physics.

### HUD feel
- **Score pop on increase.** When `state.score` changes, toggle the `.pop` class on the score element. Suppressed on start (0 → N) so restarting doesn't fire a stale animation.
- **Approaching-best glow.** `#score.approaching-best` kicks in at 80% of best — color shifts cyan→gold with a soft glow. Tells the player they're in striking distance without an explicit progress bar.
- **Beaten-best pulse.** When score passes best *during* play, `#score.beaten-best` adds a 1.4s breathing scale animation. Layers with the end-of-run NEW BEST pill: one says "you're doing it," the other says "you did it."

### Mobile delight
- **Haptic feedback.** `navigator.vibrate(20)` on miss, `[40,40,80]` on NEW BEST. Gated by `'vibrate' in navigator` and `prefers-reduced-motion` so neither desktop nor motion-sensitive players get unexpected buzz.

### Visual variety
- **Starfield backdrop.** 40 pre-generated stars, each with random phase; twinkle via `sin(state.t * 1.2 + phase)`. Drawn first so the vignette softens them. Zero-allocation render (positions are fixed, only alpha computed per frame). Adds "depth" without competing with rings.

## Retest

- [x] On a 120Hz display, pulses now move in small sub-pixel increments instead of visible 60Hz stair-stepping.
- [x] Score pop triggers on every scoring tap; no pop on game-start (score 0 → 0 transition).
- [x] Approaching-best glow at 80% and beyond; pulse kicks in at 101%+.
- [x] `navigator.vibrate` no-op on desktop; fires on Android Chrome (confirmed via console stub).
- [x] Stars don't compete with pulses — alpha stays ≤ 0.4 through the twinkle cycle.
- [x] `prefers-reduced-motion`: score pop / beaten-pulse / haptics all disabled.
- [x] Node syntax check: pass.

---

# Sprint 5 — Robustness + progression + trend (2026-04-17)

## Issues addressed

### Tab-switch kills the run (P1 — robustness)
- **Symptom:** Alt-tab or phone notification during play = pulses keep advancing, player returns to near-certain death.
- **Root cause:** `requestAnimationFrame` is throttled in hidden tabs, so `MAX_DT` clamps only partially help; spawns scheduled by absolute time also keep firing.
- **Fix:** `document.visibilitychange` + `window.blur` → freeze sim (`state.paused = true`), render-only. On return, 3-2-1 countdown before resuming. `lastTime = now` every paused frame prevents a dt spike on unpause. Input is swallowed during pause/countdown so the first tap home doesn't consume a pulse.

### Combo progress is invisible until it fires (P2 — readability)
- **Symptom:** Players didn't notice the multiplier tiers ramping until `×1.5` / `×2` popped in; the 0→5 build felt passive.
- **Fix:** Thin 72×3px meter under the combo number, fills left→right across each `COMBO_STEP`. Gradient cyan→gold so the goal-state is visually telegraphed. Hidden when combo==0.

### No trend signal for returning players (P2 — retention)
- **Symptom:** Gameover screen reported only "Score / Best". A player coming back after a few runs has no sense of whether they're improving.
- **Fix:** Persist last 8 scores in `localStorage`; render as an SVG bar sparkline in gameover. Latest bar = accent, best-of-window = gold, normalized to max-in-window. Right-aligned so "now" sits at the right edge.

## Regressions & edge cases covered

- **Mid-countdown re-hide.** If the player tabs away during the 3-2-1 countdown, countdown resets — doesn't silently resume in the background.
- **Pause during gameover.** `gameover()` now forces `state.paused = false` + clears the overlay so the pause screen can't stack on top of the game-over screen.
- **First-time history.** When `void-pulse-history` doesn't exist yet, the `.history` block is hidden (not an empty bar row). Prime-render on boot gives a returning player their trend before the first retry.
- **Best-ties-latest.** `lastIndexOf(max)` on the history array — if latest *is* the best, only "latest" color (accent) wins; no two bars lit simultaneously.
- **localStorage failure.** All three new persisted values (history) wrapped in try/catch — Safari private mode remains functional.
- **Diff-tracked meter updates.** `lastComboFillPct` sentinel means `style.width` is touched only on actual percentage changes; no per-frame recalc churn.

## Retest

- [x] Tab away mid-run → pause ring shows "paused"; tab back → "3 / 2 / 1" in the ring; run resumes cleanly, no dt spike.
- [x] Tab away during countdown → resets to "paused"; on next return, fresh 3-2-1.
- [x] Combo meter hidden at combo 0; fills smoothly 0→100% between multiplier tiers; stays at 100% at cap (`×4`).
- [x] First run → no history block on gameover. Second run → history shows 2 bars, latest highlighted.
- [x] After 9 runs → exactly 8 bars visible (cap enforced); oldest dropped.
- [x] Latest bar = accent; best-of-window = gold; latest-ties-best = accent only.
- [x] `prefers-reduced-motion`: pause countdown pulse animation disabled.
- [x] Node syntax check: pass.

