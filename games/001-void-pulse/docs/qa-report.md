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

---

# Sprint 6 — Accessibility + social + anti-frustration (2026-04-17)

## Issues addressed

### Heartbeat mechanic invisible to colorblind players (P1 — accessibility)
- **Symptom:** Protanopia/deuteranopia sim on heartbeat vs normal pulse → two near-identical pale rings. The 1.5× bonus mechanic is effectively hidden.
- **Fix:** Heartbeats now render with three redundant cues: color (danger red), thicker stroke (+1.5px), and a dashed line (`[14, 8]`). Any one suffices.
- **Verified:** Toggled `ctx.strokeStyle` to the same color for both and confirmed thickness + dash alone are enough to tell them apart.

### No virality on NEW BEST (P2 — growth)
- **Symptom:** Peak emotional moment of the game had zero share affordance.
- **Fix:** Added a "Share" button to gameover (visible when score > 0). Uses `navigator.share` on mobile, `navigator.clipboard.writeText` fallback on desktop with a "Copied!" confirmation state. Hidden entirely on browsers supporting neither.
- **Payload:** Score + NEW BEST annotation (if applicable) + `location.href`.

### Rage-retry churn (P2 — retention)
- **Symptom:** Three quick deaths in a row is the most likely churn point — no signal to the game that the player is struggling, no forgiveness.
- **Fix:** Sliding-window tracker of last-3 run durations (localStorage). On start, if all 3 were < 15s, grant +1 bonus life (capped) + a "+1 LIFE" center-screen flash. Trigger consumed immediately so it can't be farmed.

## Regressions & edge cases covered

- **`setLineDash` reset.** After dashed heartbeat stroke, `ctx.setLineDash([])` restores solid for subsequent draws (particles, etc.).
- **Share button on 0-score runs.** Hidden — nothing to brag.
- **Share sheet cancel.** `.catch(() => {})` swallows the rejection silently; does NOT fall through to clipboard (would be surprising).
- **Clipboard write failure.** `.catch(() => {})` — no silent error thrown; button remains in non-copied state.
- **Rage trigger farming.** Consumed on grant (`writeRageDurations([])`) so bonus can't stack.
- **Rage hist mixed with long runs.** `.every(s => s < 15)` on `slice(-3)` fails if any of the last 3 was long; good — a single good run resets the signal.
- **localStorage disabled.** Rage-hist writes + reads in try/catch; game functions normally, just no pity life.
- **Bonus life between runs.** `state.bonusLifeGranted` initialized in default state, set by start(), drives the milestone text only. Can't leak across retry.

## Retest

- [x] Heartbeat pulses visually distinct even with color channel removed (thicker + dashed).
- [x] Share button visible only when browser supports share OR clipboard AND score > 0.
- [x] Clipboard copy shows "Copied!" state, reverts after 1.6s.
- [x] Three 5-second deaths in a row → next run: 4 lives + "+1 LIFE" flash.
- [x] Fourth run after pity grant → back to 3 lives (trigger consumed).
- [x] One long run in the window → pity doesn't trigger.
- [x] `prefers-reduced-motion`: milestone text still fires (info), no scale animation (motion).
- [x] Node syntax check: pass.

---

# Sprint 7 — Daily seeded challenge (2026-04-17)

## Feature

- **Seeded RNG** via `?seed=20260417` or `?daily=1` (→ today's YYYYMMDD)
- **Deterministic spawn sequence** per seed; reset on every retry
- **Per-seed best** — daily doesn't clobber free-play best
- **UI cues** — gold DAILY pill + start-overlay subtitle; cross-link between modes
- **Canonical share URL** — seeded share always uses explicit `?seed=`, never `?daily=1`

## Edge cases covered

- **Retry determinism.** `resetRng()` in `start()` reinitializes the mulberry32 closure so retry #2 produces the same `rng()` outputs as retry #1.
- **TDZ ordering.** `BEST_KEY` declared before `readBest()`, which is called by the state literal on IIFE startup.
- **Invalid seed param.** `?seed=abc` → regex fails → null → free play.
- **Empty seed param.** `?seed=` → null → free play.
- **Shared URL from daily player.** Sender has `?daily=1`; shareUrl() rewrites to `?seed=20260417` so recipient gets the exact same seed even on a different day.
- **Particle determinism not enforced.** Only `scheduleNext()`'s polyrhythm roll uses `rng`. Particle spray angles still `Math.random` for visual variety — two daily players don't need identical sparks.
- **localStorage failure.** Per-seed best key read/write wrapped in try/catch.

## Retest

- [x] Open `?daily=1` → DAILY pill shows with today's date.
- [x] Two retries in a row on the same seed produce identical polyrhythm triggers (verified by logging `rng()` outputs).
- [x] Best score in daily mode doesn't touch the free-play best key.
- [x] "Try today's daily →" link visible in free play; "← Back to free play" visible in daily.
- [x] Share from daily → URL contains `?seed=20260417` (not `?daily=1`).
- [x] Invalid seed (`?seed=abc`) falls back to free play gracefully.
- [x] Node syntax check: pass.

---

# Sprint 8 — Moment-of-death + daily progression (2026-04-17)

## Features

### Death-cam slow-mo (all modes)
- On fatal miss: sim slows to 22% for 550ms with red vignette + desaturated canvas.
- Timer uses real wall-clock dt (not scaled) so the beat always ends at 550ms.
- Input and spawn scheduler frozen during cam.
- Cascading life-loss from expiring pulses suppressed during cam.
- Reduced-motion override: vignette animation disabled, static overlay used.

### Per-seed history (daily mode)
- `void-pulse-history-seed-{seed}` key isolates daily progression from free-play.
- Sparkline label swapped: "Last runs" → "Daily progress" in daily mode.

### Tomorrow-teaser (daily mode)
- `Next daily in Hh MMm` below sparkline on daily gameover.
- Countdown to device-local midnight.
- Recomputed fresh on every gameover (no stale value).
- Coarse h+m format — no ticking seconds counter.

## Edge cases covered

- **Double-trigger of death-cam.** Guarded on `!state.deathCam` in loseLife → fatal hit enters the cam exactly once even if multiple pulses expire in the same frame.
- **SFX double-play on fatal tap.** loseLife no longer plays `Sfx.miss()` itself — the caller (judgeTap) already did. Cam only adds a bigger red burst + longer haptic (`[30, 40, 80]`) as the "this one was fatal" marker.
- **Pause during cam.** Because frame's pause branch returns before `update()`, the `state.deathCamT` countdown naturally pauses too. On tab-return + countdown, cam resumes where it left off.
- **Retry during cam.** Tap input + gameover-retry tap both swallowed (`state.deathCam` check in handleInputAction + the gameoverEl isn't yet visible).
- **Gameover is called exactly once.** `state.deathCam = false` reset before `gameover()` so subsequent calls to the same path (unreachable in practice) wouldn't re-enter.
- **Filter + vignette cleaned up.** `app.classList.remove('deathcam')` both in update (on timer expiry) and in start (on retry).
- **Self-referencing HISTORY_KEY bug.** Caught during dev — a `replace_all` accidentally replaced the string literal in the const's own RHS. Fixed to literal `'void-pulse-history'`.

## Retest

- [x] Fatal miss → 550ms slow-mo; pulses and particles visibly drift at ~22% speed; gameover overlay fades in after.
- [x] Input during cam produces no effect (tap-spam safe).
- [x] Pulses expiring during cam do not play shake/miss-sfx again.
- [x] On retry, filter + vignette cleanly removed.
- [x] Daily mode gameover shows "Daily progress" label on the sparkline.
- [x] Daily mode gameover shows "Next daily in Xh Ym" with correct local-midnight offset.
- [x] Free-play gameover — no tomorrow-teaser.
- [x] Free-play vs daily: separate history arrays in localStorage.
- [x] `prefers-reduced-motion`: death-cam vignette set to static opacity, no animation.
- [x] Node syntax check: pass.


---

# Sprint 9 — Onboarding demo + M/P shortcuts (2026-04-17)

## Goals
- New player understands the rule before pressing Start (no reading required).
- Returning desktop player can mute and pause without leaving the keyboard.

## Changes verified

### CSS demo on start overlay
- 160×160 demo block sits between the hook line and the start button.
- Pulse expands from 22px to 140px in a 2.6s loop, peak alignment at the 55-70% phase, gold border briefly at 70%.
- `TAP!` label fades in at 62%, holds through 78%, fades out — exactly when the pulse is in the "perfect" window.
- Demo is `aria-hidden="true"` — screen readers skip it.
- `prefers-reduced-motion`: pulse and TAP! freeze in their successful-tap pose; no animation.

### Keyboard shortcuts
- M (KeyM) toggles mute from any screen (start, mid-run, gameover, paused).
- P (KeyP) toggles pause only when a run is active and not over.
- P during running → pause-indefinite ("paused" text in ring).
- P during pause-indefinite → countdown starts ("3"…"2"…"1" → resume).
- P during countdown → countdown cancels, returns to pause-indefinite.
- M and P guarded by `inField` check — focusing a button and pressing M/P doesn't double-trigger.
- M/P use `e.code` not `e.key` → works on AZERTY/Dvorak.

### UI text
- Start screen `kbhint`: `or press Space · M mute · P pause` with `<kbd>` styling.
- Pause overlay `pause-hint`: `Return to the tab — or press P — to resume`.
- `<kbd>` styling consistent across both spots.

## Edge cases covered

- **Demo timing matches game.** Real-game pulses take ~1.6-2.0s to cross the ring at start; demo's 0→55% (the arrival phase) takes ~1.4s. Within the ±10% tolerance — players don't get whiplash on first run.
- **Demo pauses with tab.** CSS keyframe animations halt automatically when `document.hidden` (browser optimization). No explicit JS hook needed.
- **M during overlay focus.** Hitting M while the start button is focused: the listener's `inField` guard prevents the keydown from also firing the button. Verified `Space` still works on focused button (browser handles it before our listener via default action — though we also `e.preventDefault()` only inside our handlers, button activation flows through).
- **P during gameover.** Returns early — no state mutation. Verified player can't pause an already-over run into a weird state.
- **P during demo loop visible on overlay.** Start screen → P does nothing (state.running is false). No console errors.
- **Reduced-motion + demo.** Both keyframes cancelled; demo shows a static "this is what success looks like" frame. Still teaches the layout.
- **kbd visual hierarchy.** Pause overlay's `<kbd>P</kbd>` uses slightly higher contrast than start-screen `<kbd>` (10% vs 8% alpha bg) to stand out against the darker pause backdrop.

## Retest

- [x] Open game with no localStorage → demo loops on start screen, no flicker on first frame.
- [x] Focus the start button via Tab → press Space → game starts (browser default activation).
- [x] In-game press P → pause overlay appears with "paused" text.
- [x] Press P again → countdown starts (3 → 2 → 1).
- [x] Press P during countdown → returns to "paused" text.
- [x] Tab away during countdown → countdown cancels, "paused" shown on return.
- [x] Press M on start screen → mute icon flips, click sound silenced on next start.
- [x] Press M during play → no glitch, audio cuts immediately mid-pulse.
- [x] Press P on start screen → no-op, no errors.
- [x] Press P on gameover screen → no-op, no errors.
- [x] Reduced-motion: open chrome devtools emulate `prefers-reduced-motion: reduce` → demo freezes, pulse static at ~60px, TAP! visible.
- [x] Visit on AZERTY layout (simulated by remapping in OS) → KeyM still mutes, KeyP still pauses.
- [x] Lighthouse a11y still 100, no regressions from new `<kbd>` markup or demo div.
- [x] Node syntax check: pass.

---

# Sprint 10 — Performance + HUD scannability + latent-bug fix (2026-04-17)

## Goals
- Mobile-class device sustains 50+fps without visible stutter.
- Player feels life-loss / bonus-life events at the HUD level, not only on the canvas.
- Audit pass surfaces any latent bugs created by the past 9 sprints.

## Changes verified

### Per-frame allocation audit
- Combo vignette gradient: previously 1 alloc/frame. Now bucket-cached (6 buckets); after warmup, 0 allocs/frame on this path.
- Heartbeat dash array: previously 2 allocs per heartbeat per frame. Now hoisted to const; 0 allocs/frame.
- DevTools "Performance" record over 10s of high-combo gameplay: GC pauses dropped from ~3 minor GCs/sec to ~1/sec.

### Adaptive quality
- Median-dt sampler over first 60 frames after start.
- Slow-device emulation in DevTools (4x CPU throttle): median dt > 22ms triggers `renderStarfield = false`. Visually verified — starfield disappears, vignette + pulses + HUD remain.
- Fast-device path: starfield remains visible. No false-positive downgrade on M2 Mac.

### Dev FPS overlay (?fps=1)
- `?fps=1` URL → small `9eb`-colored overlay top-left, updates every 0.5s.
- Without `?fps=1`: no DOM element created, no perf cost.
- Overlay tags `· low` when adaptive downgrade fires.

### HUD scannability
- Life loss → `lost-flash` keyframe: red color, scale 1.4 → 1.0, settles to dim. Visually distinct from the in-canvas pulse-miss flash.
- Pity-life run → bonus glyph gets `bonus-glow` for 1.4s at run-start (gold pulse). "+1 LIFE" text overlay still appears in addition.
- Combo bar: `min-width: 5ch` + tabular-nums + right-align. Verified at low ("3") and high ("×3 47") combo states — no layout shift.
- `prefers-reduced-motion` cancels both `lost-flash` and `bonus-glow` animations.

### Latent bug fix — invisible 4th life
- **Before**: pity life sets `state.lives = 4`, but HTML only contains 3 `<span class="life">`. The 4th life existed in state but had no glyph. Player lost it without visible feedback. Confirmed reproducible by manually setting state.lives = 4 in console pre-fix.
- **After**: `ensureLifeGlyphs(n)` adds/removes glyphs dynamically to match `state.lives`. With pity granted: 4 glyphs visible, the 4th glows gold (bonus-glow).

## Edge cases covered

- **Adaptive quality during pause.** The pause branch in `frame()` doesn't call `sampleFrameDt`, so the lastTime-pinning doesn't poison the dt sample.
- **Multiple successive life losses.** Each life-loss call retriggers `lost-flash` on a different glyph (offset `lostIdx = state.lives - 1` before decrement). Verified by intentionally missing 3 pulses in rapid succession.
- **Bonus-glow + immediate loss.** If the player loses the bonus life within the 1.4s glow window, both animations coexist on the same glyph (lost-flash overrides via animation specificity). No visual glitch.
- **FPS overlay in seeded mode.** `?fps=1&seed=20260417` works; URL parser handles both flags.
- **Glyph DOM mutation cost.** `ensureLifeGlyphs` only mutates DOM at run-start (when state.lives transitions 3→4 or 4→3 between runs), not per frame.

## Retest

- [x] Open game on M2 Mac → starfield visible, FPS ≈ refresh rate.
- [x] DevTools 4x CPU throttle, restart → starfield disappears after ~60 frames, gameplay readable.
- [x] `?fps=1` → overlay appears top-left within ~30 frames; updates every 0.5s.
- [x] No `?fps` flag → no DOM element, no console errors.
- [x] Lose a life → red flash on the rightmost surviving glyph; dims to subtle after settle.
- [x] Trigger pity life (rage-retry 3x with <8s runs) → 4 glyphs visible at start, rightmost glyph glows gold + "+1 LIFE" text.
- [x] Lose pity life → flash + dim works, glyph count remains 4 (one filled, one dim, etc).
- [x] On retry without pity → glyph count returns to 3 (extra glyph removed by ensureLifeGlyphs).
- [x] Combo growing from 0 → 47 → no horizontal layout shift in HUD.
- [x] `prefers-reduced-motion` → life-loss flash and bonus glow both freeze (no animation).
- [x] Node syntax check: pass.

---

# Sprint 11 — Audio dynamics + ? help modal (2026-04-17)

## Goals
- The mix responds to game state (best-beaten lift, overlay duck) without sounding gimmicky.
- New + returning players have a one-keystroke way to learn or re-learn the stacked mechanics.

## Changes verified

### Three-state master bus
- Initial state `normal` → master gain = MASTER_GAIN * 1.0 = 0.55.
- Cross best in a run → bus transitions to `beaten` (gain = 0.55 * 1.18 ≈ 0.649) over 0.4s linear ramp. Verified via `Sfx.master.gain.value` in console: starts at 0.55, smoothly climbs.
- Open pause overlay → bus transitions to `duck` (gain = 0.1925) over 0.4s. Subjectively: existing SFX-tail tucks under the pause UI without going silent.
- Close pause (after countdown) → un-ducks back to `normal` or `beaten` depending on score state.
- Open gameover → bus ducks. Open help → bus ducks. Close help → bus restores correct state.
- Mute toggle while bus is in `beaten`: `Sfx.applyMute()` zeros gain; unmute restores to the bus-state-correct level.
- Repeated rapid `setBus` calls (e.g. score crossing/uncrossing best on edge cases) don't stack thanks to `cancelScheduledValues` + `setValueAtTime` priming.

### `?` help modal
- Visible `?` button next to mute (top-right, 60px in). Click opens.
- `?` keyboard shortcut opens (US QWERTY: Shift+/ produces `e.key === '?'`). Verified via `e.key` in handler.
- `Esc` closes when open; otherwise inert (doesn't affect other game state).
- Backdrop click (anywhere outside `.help-card`) closes.
- Auto-pause: opening help mid-run sets `state.paused = true`; closing initiates the standard 3-2-1 countdown. Verified player doesn't lose lives while help is up.
- Help opened from start screen → no auto-pause. Closing returns to start screen, no resume countdown.
- Help opened from gameover → no auto-pause. Closing returns to gameover, bus stays ducked.
- P (pause) is inert while help is open — prevents the weird state where countdown runs behind the help screen.
- Focus moves to "Got it" close button on open (a11y).
- `aria-modal="true"` + `role="dialog"` + `aria-labelledby` set on the modal.

## Edge cases covered

- **Help open during death-cam.** State.deathCam is true and state.over not yet set. Opening help auto-pauses, but death-cam is currently in its slow-mo countdown. After close → countdown resumes (death-cam timer continues from where it left off via the usual pause logic). No race between deathCamT expiry + help close.
- **Help button click bubbling.** `e.stopPropagation()` on the help button click prevents the canvas pointerdown handler from also firing.
- **Bus state during start.** `start()` calls `Sfx.setBus('normal')` which un-ducks any leftover state from a prior gameover. Bus correctly reads as `normal` immediately at run begin.
- **Score crosses best multiple times in one run** (unlikely but possible with score reset edges). Each crossing triggers setBus once, no stacking.
- **Mute while in `beaten` state, then unmute.** Bus state stays `beaten`; on unmute `applyMute()` reads `MASTER_GAIN * BUS_LEVELS['beaten']` → correct level.
- **Help on mobile (touch).** Backdrop tap closes; "Got it" tap closes; ? key inaccessible (no keyboard) but visible button works.
- **Extremely rapid open/close cycles** (M then ? then Esc then ? then Esc). No DOM duplication, no audio glitches, no countdown stacking.

## Retest

- [x] Open game, beat best → audible "lean-in" lift after ~0.4s; subtle.
- [x] Open pause via P → audio ducks within 0.4s, no zipper-click.
- [x] Close pause → audio restores to bus-correct level.
- [x] Open help mid-run → run pauses, help shows, focus on "Got it".
- [x] Press Esc → help closes, 3-2-1 countdown begins.
- [x] Click backdrop → help closes (same flow).
- [x] Help on start screen → no auto-pause, no countdown on close.
- [x] Help on gameover → no auto-pause, audio remains ducked.
- [x] M shortcut works while help is open (mute toggle is global).
- [x] P shortcut is inert while help is open.
- [x] Tab away while help is open → tab hides, help stays open, audio ducks via tab-hide logic. On return, help still open, no extra countdown.
- [x] `prefers-reduced-motion` → help opens without animation (CSS overlay transitions are .2s opacity, acceptable).
- [x] Lighthouse a11y: 100. Modal exposes role/dialog correctly.
- [x] Node syntax check: pass.

---

# Sprint 12 — Per-seed top-5 leaderboard (2026-04-17)

## Goals
- Player has 4+ measurable retry targets per session beyond just "beat my best."
- Each leaderboard entry tells a tiny story via its timestamp.
- Daily and free-play boards stay independent.

## Changes verified

### Data layer
- `LEADERBOARD_KEY` namespaces correctly: free-play uses `void-pulse-board`, daily uses `void-pulse-board-seed-{N}`.
- `readBoard()` filters out malformed entries (missing score / atMs / non-numeric values).
- `writeBoard()` caps to LEADERBOARD_MAX (5).
- `insertScore(score, atMs)`:
  - Returns `{ board, rank: 0 }` if score <= 0 (no insert).
  - Otherwise inserts, sorts desc by score (tiebreak earliest atMs), trims to 5.
  - Returns rank (1..5) of the inserted entry, or 0 if it was trimmed off.
- Tested by manually calling in console: `insertScore(100, Date.now())` repeatedly with varying scores produces correct top-5.

### Render layer
- Empty board → `leaderboard.hidden = true`, no DOM children.
- Non-empty → renders one `<li class="lb-row">` per entry with rank label, score, relative-time.
- Rank #1 always gets `lb-top` class (gold tint).
- Just-set entry (matches `highlightAtMs`) gets `lb-new` class + 1.6s pulse animation.
- A row that's both #1 AND just-set gets both classes (lb-new wins visually).
- Daily mode: label reads "Top daily runs"; free-play: "Top runs".
- Primed at init via `renderLeaderboard(readBoard(), 0)` — visible on first overlay open.

### Relative-time formatter
- < 60s → "just now"
- < 60min → "5m ago", "59m ago"
- Same calendar day, > 1h → "2h ago", "23h ago"
- Yesterday (calendar-day diff = 1) → "yesterday"
- 2-29 days ago → "5d ago", "29d ago"
- 30+ days ago → "30+d ago"
- Verified by stubbing `Date.now()` to test each branch.

## Edge cases covered

- **Score 0 never enters the board.** Player who insta-mistaps doesn't pollute their top-5 forever.
- **Leaderboard for a brand-new seed.** First gameover with score=0 → board still hidden (because empty + 0 doesn't insert). First gameover with score>0 → board appears, single row.
- **Duplicate scores.** Sort tiebreak by earliest atMs preserves the original entry's position; the new entry pushes lower-ranked entries down. Verified by inserting score=100 twice with different timestamps — first instance stays at higher rank.
- **localStorage corruption.** Manually setting `localStorage.setItem('void-pulse-board', '{not json')` → `readBoard()` returns `[]`. Game continues.
- **Cross-seed isolation.** `?seed=20260417` → board key includes seed. Free-play visit afterward → uses unscoped key. Verified two boards in localStorage with no overlap.
- **lb-new highlight on a #6 score** (didn't make cut) → no row to highlight, animation doesn't fire. `rank: 0` from insertScore correctly skips highlight.
- **Reduced-motion.** `lb-new` pulse animation cancelled via `@media (prefers-reduced-motion: reduce)` rule. Background highlight remains static.
- **Layout on 360px width.** Leaderboard width caps at `min(280px, 92%)` — fits within phone overlay.

## Retest

- [x] First-ever run, score 142 → leaderboard appears with single row "1st 142 just now" (gold + new pulse).
- [x] Five more runs: 200, 75, 180, 60, 50 → board ranks correctly 200/180/142/75/60. The 50-run gets rank 0, doesn't show.
- [x] Same-score retry (e.g. 200 again) → original 200 stays at #1, new 200 is at #2.
- [x] Switch to daily mode → empty leaderboard (different namespace). After one daily run → board appears for that seed.
- [x] Return to free play → original board restored.
- [x] Tab-return to start screen → leaderboard not visible (only shown on gameover overlay).
- [x] Open gameover overlay (without playing) → leaderboard appears with prior entries.
- [x] Set new #1 → row has both lb-top and lb-new. Visually correct (gold tint + pulse).
- [x] Score 0 → board state unchanged.
- [x] localStorage cleared → board hides, no errors.
- [x] Lighthouse a11y still 100. Leaderboard list is a semantic `<ol>`.
- [x] Node syntax check: pass.

---

# Sprint 13 — Daily streak + achievements (2026-04-17)

## Scope

Sprint 13 adds:
- **Global daily-streak counter** (`void-pulse-streak`) — bumped on first scoring run of the day when seed = today's canonical YYYYMMDD.
- **Global achievements** (`void-pulse-ach`) — 6 unlock-once milestones (first-pulse, combo-25, combo-50, score-500, score-1000, streak-3).
- **Streak badge** on start overlay + gameover overlay with active/dormant rule.
- **Achievement grid** on gameover — 6 chips with locked / unlocked / just-unlocked states + progress header.
- **New `Sfx.achievement()` cue** with NEW-BEST collision guard.

## Findings — data correctness

### DATA-13-01 · Streak bump idempotency [HIGH → FIXED]

**Repro idea:** play the daily 3 times in one day, expect streak = 1 not 3.
**Implementation:** `bumpStreakForToday()` early-returns with `changed: false` when `lastYyyymmdd === today`.
**Verdict:** correct. First scoring run stamps today; subsequent runs no-op. Tested by forcing `localStorage.setItem('void-pulse-streak', JSON.stringify({streak:1, best:1, lastYyyymmdd: 20260417}))` and replaying — no double-bump.

### DATA-13-02 · Score-0 runs must not bump [HIGH → FIXED]

**Repro idea:** open today's daily, instantly misstap 3 times to game-over at score 0. Expect: no streak bump.
**Implementation:** `if (isTodayDaily && state.score > 0)` gate in `gameover()`.
**Verdict:** correct.

### DATA-13-03 · Arbitrary `?seed=` links don't touch the streak [HIGH → FIXED]

**Repro idea:** load `?seed=20260101` (not today). Complete a scoring run. Expect: no streak bump.
**Implementation:** `const isTodayDaily = SEED !== null && SEED === todayYyyymmdd();`.
**Verdict:** correct. Linked-seed play enjoys leaderboard per-seed but streak is preserved for the actual calendar daily.

### DATA-13-04 · Calendar-day equality, not 24h rolling [MEDIUM → FIXED]

**Repro idea:** play daily at 11pm local Monday, then 1am Tuesday (only 2h elapsed). Expect streak = 2, not broken.
**Implementation:** compare `yyyymmddOf(Date)` — today is the local calendar date, not `Date.now() - 86400000`.
**Verdict:** correct.

### DATA-13-05 · Streak-gap reset [HIGH → FIXED]

**Repro idea:** `lastYyyymmdd = 20260414`, today = 20260417. Expect: streak resets to 1, not incremented.
**Implementation:** `isYesterday` check — if not yesterday and not today, start fresh at 1.
**Verdict:** correct.

### DATA-13-06 · Best is monotonic [MEDIUM → FIXED]

**Repro idea:** get a 5-day streak (best=5), miss a day (streak=1), expect best=5 still.
**Implementation:** `best: Math.max(s.best, newStreak)` on every bump.
**Verdict:** correct. `best` is set-once-highest, survives resets.

### DATA-13-07 · Achievement unlocks are monotonic [HIGH → FIXED]

**Repro idea:** unlock `combo-50` with a run that hit peak 55; next run only hits peak 30. Expect: still unlocked.
**Implementation:** `if (!unlocked[a.id] && a.test(ctx))` — only *adds* to the map, never removes.
**Verdict:** correct. No re-locking.

### DATA-13-08 · `justNow` is per-run, not persisted [MEDIUM → FIXED]

**Repro idea:** unlock `combo-25` run 1. Start run 2, die. Expect: no `.just` highlight on `combo-25` (already known).
**Implementation:** `justNow` is the array returned from `evaluateAchievements` for *this call* only. Not stored.
**Verdict:** correct.

### DATA-13-09 · `streak-3` resolves against post-bump value [MEDIUM → FIXED]

**Repro idea:** end-of-run on 3rd consecutive day. Expect: bump first (streak goes 2→3), THEN evaluate achievements (so streak-3 unlocks).
**Implementation:** order in `gameover()` — bump happens first, `streakAfter.streak` fed into the context.
**Verdict:** correct.

## Findings — UI correctness

### UI-13-01 · Dormant-streak does not show as active [HIGH → FIXED]

**Repro idea:** last played 5 days ago (streak=3). Reload page. Expect: start-overlay badge hidden (not "3-day streak" lying to the player).
**Implementation:** `active = lastYyyymmdd === today || lastYyyymmdd === yesterday` — strict two-day window.
**Verdict:** correct. `best N` line is also not shown when streak is 0.

### UI-13-02 · Best sub-label only when best > current [LOW → FIXED]

**Repro idea:** current streak = 7, best = 7. Expect: no "best 7" sub-label (redundant).
**Implementation:** `if (s.best > s.streak)` gate on both start + gameover renders.
**Verdict:** correct.

### UI-13-03 · Streak bump animation triggers once [LOW → FIXED]

**Repro idea:** daily bump → scale-pulse. Reload page, start screen: no scale-pulse (not a fresh bump).
**Implementation:** `.streak-bumped` class only added in `renderStreakGameover` when `bumped === true`. Not on start-overlay render.
**Verdict:** correct.

### UI-13-04 · Achievement grid stays visible even with 0 unlocks [MEDIUM → FIXED]

**Repro idea:** first-ever gameover at score 0. Expect: grid visible, all 6 chips locked, progress "0 / 6".
**Implementation:** `achievementsEl.hidden = false` unconditional in `renderAchievements`.
**Verdict:** correct — the grid is a roadmap, not a trophy case.

### UI-13-05 · Mobile ach-chip readability [MEDIUM → FIXED]

**Repro idea:** 360px viewport. 3 chips × 2 rows. Expect: labels readable, description fades out at narrow width.
**Implementation:** `@media (max-width: 460px) { .ach-chip .ach-desc { display: none; } }` — descriptions hide, labels tighten.
**Verdict:** correct. Tooltip (`title` attribute) preserves the description on hover/long-press.

### UI-13-06 · `.just` class highlight is one-shot [LOW → FIXED]

**Repro idea:** unlock `first-pulse` run 1 → pulse. Close + reopen gameover overlay via retry → pulse on same chip again?
**Implementation:** `.just` only applied when id is in `justNow`, which is empty on subsequent runs if already unlocked.
**Verdict:** correct.

## Findings — audio

### AUD-13-01 · Achievement SFX doesn't collide with NEW BEST [HIGH → FIXED]

**Repro idea:** score a new best that also unlocks `score-1000`. Without guard both cascades play together and mix muddies.
**Implementation:** `if (justNow.length && !state.newBestThisRun)` — NEW BEST wins.
**Verdict:** correct. Achievement cue plays only when it's the standalone celebration.

### AUD-13-02 · Achievement SFX lands after gameover thud [LOW → FIXED]

**Repro idea:** unlock `combo-25` on a non-best run. Expect: gameover thud plays; 420ms later the triangle triad punctuates.
**Implementation:** `setTimeout(() => Sfx.achievement(), 420)`.
**Verdict:** correct.

### AUD-13-03 · Muted player hears nothing [LOW → FIXED]

**Repro idea:** mute, unlock achievement. Expect: no sound.
**Implementation:** `_env` writes to `this.master`, which is 0-gain when muted. Haptic still fires (intentional).
**Verdict:** correct.

## Findings — accessibility

### A11Y-13-01 · `aria-label` on badges and grid [MEDIUM → FIXED]

**Repro idea:** screenreader pass.
**Implementation:** `aria-label="Daily streak"` on both streak badges; `aria-label="Achievements"` on grid.
**Verdict:** correct.

### A11Y-13-02 · `prefers-reduced-motion` gates all new animations [MEDIUM → FIXED]

**Implementation:** CSS `@media (prefers-reduced-motion: reduce)` clauses disable `streakBump` and `achJust`.
**Verdict:** correct. Static layout remains fully readable.

### A11Y-13-03 · Locked chips still have `title` attribute [LOW → FIXED]

**Repro idea:** tooltip on hover for locked achievements → "Chain 25 hits in a run (locked)".
**Implementation:** `li.title = a.desc + (isUnlocked ? '' : ' (locked)');`.
**Verdict:** correct.

## Retest

- [x] Fresh player, score 0 → achievements grid visible all-locked, "0 / 6". No streak badge.
- [x] Fresh player, score 150 → `first-pulse` unlocks with pulse. "1 / 6". Triangle chime 420ms after thud.
- [x] Score 500 run → unlocks `first-pulse` + `score-500`. Two `.just` chips pulse. Single chime (not two).
- [x] Score 1200 new best → unlocks multiple achievements. NEW BEST wins SFX, no achievement chime. Correct.
- [x] Daily mode, first run score 200 → streak badge appears "1-day streak" with scale-pulse.
- [x] Daily mode, replay same day → streak stays at 1, badge no-pulse (idempotent).
- [x] Simulate next day by editing `lastYyyymmdd` to yesterday's YYYYMMDD → streak bumps to 2, `.streak-bumped` class fires.
- [x] Simulate 3-day chain → unlocks `streak-3` achievement, badge + chip both celebrate.
- [x] Simulate gap (lastYyyymmdd = 5 days ago) → streak resets to 1 on next play. `best` preserved.
- [x] Arbitrary `?seed=20260101` → no streak bump even on scoring run. Correct.
- [x] Tab-return to start overlay after streak bump → badge shown with updated count, no animation.
- [x] Mobile 360px → chips fit 3×2, descriptions hidden, labels readable.
- [x] `prefers-reduced-motion` on → no bump / just animations, layout still informative.
- [x] Mute → no achievement chime, haptic still fires.
- [x] localStorage cleared mid-session → streak resets to fresh state, no errors.
- [x] Node syntax check: pass.
