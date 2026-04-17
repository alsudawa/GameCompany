# Postmortem — 001 · void-pulse

**Date:** 2026-04-17
**Producer:** @producer (sonnet)

---

## Summary

We built *void-pulse*, a single-screen endless tap-timing game where the player taps as an expanding pulse ring crosses a fixed target ring, with escalating polyrhythm and combo multipliers. The game shipped in good shape — core loop, difficulty curve, and audio all matched the GDD — with two P1 correctness bugs (heartbeat SFX misfire, double life-loss on miss→pass-through) fixed before release.

---

## What went well

- **Designer specified the polyrhythm curve with exact waypoints.** The 4-point piecewise-linear ramp (0s/15s/45s/90s) gave the Lead Developer a deterministic target, and QA confirmed `speedAt()` / `gapAt()` matched the table precisely — no guesswork tuning pass required.
- **Audio was pre-architected as a layered recipe, not an afterthought.** The Sound Designer defined distinct `Sfx.score()` / `Sfx.hit()` / `Sfx.levelup()` / `Sfx.heartbeat()` primitives with explicit pitch-ladder semantics, so Lead Dev could call them at exactly the right moments without understanding Web Audio internals.
- **Particle pooling was zero-allocation from day one.** Pre-allocating 256 particles and reusing them without `.push()` / `.splice()` in the hot path meant no GC jank even at high combo density — a pattern worth preserving for every future canvas game.
- **The "oldest pulse first-judged" rule resolved ambiguity during polyrhythm phases cleanly.** Giving the oldest (largest-radius) pulse 50% heavier stroke width gave players a clear visual cue about which tap was "live," sidestepping a complexity spiral without adding rules.
- **`prefers-reduced-motion` and `touch-action: none` were baked in by the Artist** rather than left as post-ship accessibility fixes — both are single-line additions that cost nothing at build time and expand the addressable audience.

---

## What could be improved

- **The heartbeat SFX bug (firing on Good hits as well as Perfect) slipped through because two parallel branches shared structural similarity.** The Lead Dev copy-pasted the Perfect branch structure for Good and carried the `if (p.heartbeat)` call along. A short comment in the design doc noting "heartbeat SFX: Perfect only" at the exact spec line would have prevented this; the GDD did say it implicitly, but the Lead Dev missed it under the parallel branches.
- **Double life-loss on miss→pass-through was a state-machine gap.** A tapped-but-wrong pulse was not immediately deactivated, so the next update frame could still mark it as a pass-through and fire `loseLife()` again. The fix was one line (`p.active = false` after the miss branch), but it should have been part of the original spec: the GDD described the miss outcome but did not say "deactivate the pulse." Clearer lifecycle language (active → judged → dead) in future GDDs would close this class of bug.
- **The tension-flash brightness (12% luma boost) was too subtle at low combo**, especially on screens where the background radial gradient competes with it at high combo. The QA tester flagged it; a higher default (0.18) or a secondary hue shift would have been better initial calibration. Visual signal strength should be validated on the dimmest expected screen, not just the dev monitor.
- **No explicit "input coordinate scaling" handling was documented**, even though this game happened not to need it (any-tap semantics). A future game that needs to map tap coordinates to canvas space will hit the `devicePixelRatio` / CSS-scale problem. The QA tester noted it as a latent risk worth capturing.
- **Sound and art specs (`docs/art-spec.md`, `docs/sound-spec.md`) are transient by design, but their integration depends entirely on the Lead Dev not missing anything.** There was no structured handoff checklist — the Lead Dev had to read two free-form docs and decide what to pull in. A lightweight integration checklist (3–5 bullet points each) written by the artist/sound designer would reduce missed items.

---

## Reusable patterns discovered

The orchestrator extracted the following patterns into the skills library:

- [`company/skills/audio/web-audio-sfx.md`](../skills/audio/web-audio-sfx.md) — heartbeat upsweep oscillator, staggered dual-layer game-over chord, combo-driven pitch ladder for score SFX
- [`company/skills/gameplay/difficulty-curve.md`](../skills/gameplay/difficulty-curve.md) — piecewise-linear 4-waypoint ramp; polyrhythm scheduling via pre-computed `extraSpawns[]`; grace-widening perfect window after t≥120s
- [`company/skills/graphics/css-animation.md`](../skills/graphics/css-animation.md) — inset box-shadow ring flash; shake / pop keyframe pair; `prefers-reduced-motion` guard block
- [`company/skills/qa/casual-checklist.md`](../skills/qa/casual-checklist.md) — entity lifecycle gotchas (deactivate on all exit paths); audio layering QA (per-branch SFX audit); canvas coordinate scaling latent-risk note

---

## Suggested next game

*void-pulse* proved that a pure timing mechanic — no spatial judgment, no reading, no menus — is immediately legible and highly replayable at the 45–90s session target. The natural next step is to add **spatial judgment**: a game where the player must tap at a *specific location*, not just at the right moment. A strong candidate is a falling-object catcher with a player-controlled basket (drag left/right) and lanes that multiply as difficulty rises — it would teach us canvas pointer-drag input (currently unexplored: the input-handling skill explicitly notes `pointermove` is unused in void-pulse), object spawn pooling across lanes, and column-based collision detection. It would also let us test whether the "no tutorial" principle holds when the player has a movable element: spatial affordance may be self-evident enough that zero-text onboarding still works.

---

## Sprint 2 — "timing feels off" (2026-04-17)

CEO playtest flagged timing perception issues after the initial ship. Root cause was **pixel-based judging against per-pulse-speed entities**: two separate bugs fed the same felt problem.

### Two compounding defects

1. **Pulse overtaking vs. "oldest" judge.** `p.speed = speedAt(bornT)` locks speed at spawn, so a newer-faster pulse can overtake an older slower one. The judge picked oldest-by-`bornT`, but the player's eye went to the pulse actually reaching the ring. These disagreed most during polyrhythm triples (45s+ and 90s+ waypoints), which is the very phase the player needs the judge to feel fair.
2. **Pixel-based windows = shrinking time-windows.** An 8px perfect window at speed 260 (t=0) is 31ms. Same window at speed 720 (t=100+) is 11ms — below the floor of human tap timing resolution. The game was "eating" correct taps at exactly the difficulty peak.

### Fixes

- `findJudgePulse()` — nearest-to-target (by `|r - TARGET_R|`) replaces oldest-by-bornT for both judging and visual highlight. One invariant, one source of truth.
- Windows migrated to ms (`PERFECT_WINDOW_MS_BASE = 55`, `GOOD_WINDOW_MS = 130`); tap distance computed as `|r - TARGET_R| / p.speed * 1000`. Pass-through uses the same metric so miss windows also stay constant in time.
- Tension flash threshold is now `toArriveMs <= 180` — constant 180ms telegraph regardless of pulse speed.
- `Sfx.spawnTick()` — 35ms sine blip at every spawn gives the player an auditory beat to lock onto (higher pitch differentiates heartbeat pulses without stealing the `heartbeat()` bass thump).
- HUD combo now displays `×1.5 12` (multiplier + streak) instead of hiding at combo<5; players see progress immediately.

### Lessons

- **Prefer time-domain metrics for any judgement against speed-varying entities.** Pixel windows are tempting (simple math, no division) but they silently re-tune your difficulty curve. When you ramp entity speed, keep your judgment windows in ms, not px.
- **"Oldest" as a tiebreaker is a trap when entities have independent speeds.** The player's visual model is spatial ("which is about to arrive"), so the judge should be too. Bias toward metrics a spectator could reproduce by eye.
- **Add a spawn-time audio cue even for non-music games.** Rhythm reinforcement cuts perceived difficulty without touching any numeric. Low-volume, short, high-pitched → additive, not competitive, with existing SFX.
- **CEO playtest caught what unit-QA missed.** The initial QA pass verified correctness (state machine, pooling, SFX wiring) but not perception (does the tap feel fair?). Future QA reports should include a separate "felt timing" section — ideally with a speed-sweep playtest (t=0, t=45, t=90 probes).

---

## Sprint 3 — Multi-perspective polish (2026-04-17)

CEO directive: "don't just fix bugs — look for improvements from different angles." Reviewed from five perspectives and shipped ~9 changes across 3 files.

### Perspectives applied

1. **Player / QoL.** Mute toggle (persisted). Keyboard input (Space = tap, works without a pointing device). Early-tap forgiveness — taps within 300ms of pulse arrival are swallowed, not punished, so the game stops "eating" anticipatory taps.
2. **Mobile / Visual.** DPR-aware canvas — backing store `W×dpr / H×dpr`, `ctx.setTransform(dpr,0,0,dpr,0,0)` for logical-coord drawing. Fixes blurry rings on retina displays. `pointerdown.preventDefault()` blocks long-press context menu.
3. **Onboarding.** First 5s has a softer `speedAt` / `gapAt` ramp (200 px/s @ 1100ms gaps). First-time players get a beat to read the mechanic before the 15s waypoint kicks in. No text tutorial.
4. **Retention.** Run-end stats panel (peak combo, perfects, total hits). Gives players sub-score targets. NEW BEST golden-gradient pill on game-over, suppressed on first-ever run to avoid trivial hype.
5. **Distribution.** Inline SVG favicon (same ring-over-ring motif, cyan/magenta) on both landing and game. OG meta tags for social shares. No external files added — still zero-dep.

### Lessons

- **Perspective sweeps find different bugs than correctness sweeps.** A QA that only checks "does it work" misses entire bug classes: DPR blur, missing mute, no keyboard, hostile first-5s. Rotate perspectives during QA: player / mobile / onboarding / retention / distribution — each surfaces issues invisible to the others.
- **Retention features are cheap-per-return.** Adding peak-combo + perfects tracking is ~5 lines of state, ~5 lines of DOM, ~5 lines of CSS. But it creates 3 new mini-goals per session. ROI is asymmetric: tiny implementation, disproportionate replayability.
- **Guard keyboard against focused buttons.** A naive keydown handler fires even when a button is focused — pressing Space toggles mute AND starts the game. Whitelist: `if (target.tagName === 'BUTTON') return;` lets the browser activate focused controls naturally.
- **"First best" is not hype-worthy.** Celebrating the first-ever score as NEW BEST trains players to expect the pill on every run, which devalues it. Gate on `prevBest > 0` so the badge means "you genuinely beat yourself."
- **Early-tap grace has to be bounded by arrival.** Unbounded "no miss for early tap" = spam the whole game. Bounded to `toArriveMs > 0 && toArriveMs <= 300ms` gives forgiveness only where anticipation is reasonable.

### Fixes from this sprint → skills library

- `skills/mobile/dpr-canvas.md` — DPR-aware canvas snippet (new)
- `skills/ux/retention.md` — run-end stats + conditional NEW BEST (new)
- `skills/gameplay/input-handling.md` — keyboard parity, early-tap forgiveness (appended)
- `skills/gameplay/difficulty-curve.md` — onboarding-phase softer ramp (appended)
- `skills/qa/casual-checklist.md` — "multi-perspective sweep" section (appended)

---

## Sprint 4 — Juice, smoothness, hype (2026-04-17)

CEO directive (continued): keep iterating, rotate angles. Sprint 4 attacked perceived-smoothness, in-game hype, and mobile delight.

### Perspectives applied

1. **Smoothness.** Fixed-timestep physics at 60Hz was leaving visible stair-stepping on 120/144Hz displays. Split update and render via interpolation: snapshot `p.prevR` before each step, render at `prevR + (r - prevR) * alpha`. Physics deterministic; display native-refresh. One of the highest-ROI changes a Canvas game can make — five new lines, 2× perceptual smoothness.
2. **HUD feel.** Dead numeric display becomes alive with three layers: per-increase `.pop` retrigger, 80%-of-best glow via `.approaching-best`, beaten-best breathing pulse via `.beaten-best`. No new text, just state-driven class toggles.
3. **Mobile delight.** `navigator.vibrate` guarded by `prefers-reduced-motion` and capability check. Two intensities: short buzz on miss, rhythmic pulse on NEW BEST. Costs nothing on desktop, adds body-feel on phones.
4. **Visual variety.** 40 pre-generated stars with per-star phase offsets, twinkling via `0.5 + 0.5 * sin(t * 1.2 + phase)`. Drawn pre-vignette so they read as depth, not overlay. Pre-allocated array + per-frame alpha = zero allocations.

### Lessons

- **Render interpolation is the single biggest visual polish for 2D games on modern displays.** Developers often skip it because 60Hz feels "fine" on 60Hz monitors — where it was authored. Test on a 120Hz device and the stair-stepping is immediate. Five lines of code; permanent payoff.
- **HUD state-driven class toggles beat imperative DOM churn.** Don't `hudScore.textContent = state.score` every frame — diff it. Don't re-add classes that are already present — compare. Our render is now chatty only on actual state changes, reducing style recalcs from 60/s to a handful per run.
- **Haptics respect `prefers-reduced-motion` too.** Vestibular-sensitive players don't want a vibrating phone any more than they want screen shake. Same media query gates both.
- **Approaching-hype is under-used in casual games.** Most timing games only celebrate at game-over. Showing "you're close" during play converts boredom (score creeping up) into tension (score lighting up). The visual cost is one CSS class.
- **Zero-allocation starfield = 60fps mobile.** The temptation is to randomize positions each frame or allocate star objects per star. Pre-generate once; per-frame math on fixed objects; draw as `fillRect` (faster than `arc`). 40 stars cost < 0.1ms per frame.

### Sprint 4 fixes → skills library

- `skills/gameplay/game-loop.md` — render interpolation with accumulator alpha (appended)
- `skills/mobile/haptics.md` — vibrate() patterns, reduced-motion gating (new)
- `skills/graphics/backdrop.md` — zero-alloc starfield, pre-gen + twinkle (new)
- `skills/ux/retention.md` — approaching-best / beaten-best HUD states (appended)

---

## Sprint 5 — Robustness + progression + trend (2026-04-17)

**Lens used:** systems (what goes wrong outside pure gameplay?) + progression (what makes "hit 5/10/15 combo" visible?) + retention (what tells the player they're improving?).

### Problems diagnosed

1. **Hostile tab-switch.** Phone notification or alt-tab during a run = uncapped dt and continuing spawns while offscreen. Even with `MAX_DT` cap, it feels wrong: when the player returns, spawns advance but muscle memory hasn't caught up. Classic "why did I lose 3 lives from a glance at Slack" frustration.
2. **Combo is a number, not tension.** The multiplier jumps at 5/10/15 combo, but during the 0→5 stretch there's no visible progress. The mechanic is invisible while it's most impactful (building up).
3. **Score + best is not a trend.** Single gameover showed only "Score: X / Best: Y". Players reason about improvement — a returning player wants to know "am I better than last time?" — and can't.

### Ships

- **Tab-hide pause + 3-2-1 resume.** `visibilitychange` + `blur` → freeze sim, show pause ring. On return: countdown in the same ring, then lastTime/acc cleared so there's no dt spike. Input swallowed throughout — first tap after return doesn't accidentally consume a pulse.
- **Combo progress meter.** 72×3px bar under the combo number; fills from 0→100% across each `COMBO_STEP` (5) tap, then resets. Gradient cyan→gold telegraphs "the higher you go, the richer it gets". Hidden when combo==0 to avoid idle-state noise.
- **Run history sparkline.** Last 8 scores persisted to `localStorage`, rendered as an SVG bar chart in the gameover overlay. Latest run = accent (you, just now). Best-of-window = gold (the bar to beat). Normalized to max-in-window, right-aligned so "now" sits on the right edge.

### What the extraction surfaced (skills)

- New `skills/gameplay/pause-visibility.md` — pause/resume pattern that any timing game should copy. The `lastTime = now` trick during pause frames is the actual bug most implementations miss.
- New `skills/ux/progress-feedback.md` — tier meter + sparkline patterns, including the right-align + color-coding rationale.

### Lens rotation worked

Sprint 4 tackled smoothness/juice (visual). Sprint 5 found improvements nowhere near visuals — a robustness issue (pause), a readability issue (meter), a retention issue (history). Proves the multi-perspective discipline from the sprint-3 QA checklist: what you find depends on the lens you hold up, not the game itself. Each sprint should deliberately rotate.

### Next candidates

- **Daily seeded challenge** (`?seed=YYYYMMDD`) — deterministic spawn sequence players can compare to each other ("my 540 on Apr 17")
- **Death-cam: 0.5s slow-mo on fatal miss** — softens the sting, teaches the timing

---

## Sprint 6 — Accessibility + social + anti-frustration (2026-04-17)

**Lens used:** inclusive design (who currently can't play this game?) + virality (what costs 60 seconds of code and saves 60 minutes of marketing?) + player psychology (what makes a struggler stay instead of churn?).

### Problems diagnosed

1. **Heartbeat pulses fail for colorblind players.** The only visual distinguisher between regular pulses (white) and heartbeat pulses (danger red) was color. A protanopic or deuteranopic player sees two rings of near-indistinguishable grays-with-a-tint, erasing the 1.5× bonus mechanic entirely. This is the single biggest accessibility gap we had.
2. **NEW BEST has no viral surface.** The player hits a new best, sees the gold pill, and… closes the tab. No path out of the game to friends, no URL sharing, no clipboard assist. The highest emotional-payload moment in the game had zero affordance for spread.
3. **Three quick deaths = churn.** The difficulty curve is tuned for a 60-90s session, but a new player can easily lose all lives in <15s on the first couple tries. Without any forgiveness mechanic, the third quick loss is often the last run the player will ever do.

### Ships

- **Redundant heartbeat encoding.** Heartbeat pulses now draw with color (danger red) + thicker stroke (+1.5px) + dashed line pattern (`[14, 8]`). Any one of the three cues is enough to tell them apart, so colorblind players get the mechanic.
- **Web Share API with clipboard fallback.** New "Share" button on gameover (shown when score > 0). Native share sheet on mobile, clipboard copy on desktop with a "Copied!" confirmation. Button is hidden entirely if the browser supports neither — no dead affordance.
- **Pity life on rage-retry.** After three <15s deaths in a row, the next run starts with +1 life and a "+1 LIFE" flash. Trigger is consumed on grant so it can't be farmed. Persisted via localStorage in a capped sliding window.

### What the extraction surfaced (skills)

- New `skills/ux/accessibility.md` — redundant color coding, keyboard parity reminder, reduced-motion gating, semantic HTML. Framed as defaults, not a polish pass.
- New `skills/ux/share.md` — feature-gated share pattern, visual confirmation for the silent clipboard path, URL inclusion rationale.
- New `skills/gameplay/anti-frustration.md` — the pity-life pattern with the "consume on grant" rule + a broader table of forgiveness levers.

### Lens rotation still working

Sprint 4: smoothness/juice (visual).
Sprint 5: robustness / readability / trend (systems + in-play + retention).
Sprint 6: inclusion / social / psychology.

Each sprint has targeted improvements invisible to the one before — confirming that the bottleneck is not "game quality" but "which lens am I holding up this week." Every ship-ready game has another three sprints of non-trivial improvements if you rotate deliberately.

### Next candidates

- **Death-cam slow-mo on fatal miss** — teaches timing + softens the sting
- **Per-seed local leaderboard** — tie shared URL to a ranked comparison
- **Sprint 7+ lens candidate: performance** — profile canvas draw costs on low-end Android

---

## Sprint 7 — Daily seeded challenge (2026-04-17)

**Lens used:** recurrence / ritual. What feature makes someone bookmark the game? Not better timing, not better polish — a **reason to come back tomorrow**.

### Problems diagnosed

1. **No ritual hook.** Free-play endless runs are exhausting by their own logic: you play until you beat your best, and then you close the tab. There's nothing waiting for you tomorrow.
2. **Zero social proof.** "I scored 540" is noise — the recipient has no context. "I scored 540 on today's daily" is a challenge. Same score, different framing, vastly different virality.
3. **Best-score semantics ambiguous in shared mode.** If we added dailies naively, a hot daily run would overwrite the player's free-play best. Need separate namespaces.

### Ships

- **Seeded RNG (mulberry32).** Replaces the polyrhythm roll in `scheduleNext()` when in seeded mode. Reset at every retry so each run in a seeded session is identical.
- **URL parsing.** `?seed=20260417` = explicit seed; `?daily=1` or `?seed=daily` = today (device-local YYYYMMDD).
- **Per-seed best.** `void-pulse-best-seed-{seed}` key. Daily scores don't touch free-play best.
- **UI markers.** Gold `DAILY · 2026-04-17` pill top-center of the canvas + matching subtitle in the start overlay. Cross-link: in seed mode, "Back to free play"; in free play, "Try today's daily →".
- **Canonical share URL.** When sharing a seeded score, rewrite `?daily=1` → `?seed=YYYYMMDD` so recipients get *that* exact seed, not their own today's.

### What the extraction surfaced (skills)

- New `skills/gameplay/seeded-daily.md` — full daily-challenge pattern: seeded PRNG, URL parsing with the daily shortcut, per-seed best key, share-URL canonicalization, UI cues. Treats "replace all Math.random with seeded" as an anti-pattern — only gameplay-critical rolls need determinism.

### Why this is a force multiplier for the company

The daily pattern is game-agnostic. Any future GameCompany title with run-based scoring can copy the skill doc and have a daily-challenge mode in an afternoon. The cumulative effect — every title is instantly a recurring-visit product — is exactly why the skill library exists.

### Next candidates

- **Per-seed local leaderboard** — with the seed infrastructure in place, add a top-5 list per seed
- **Tomorrow's preview** — on gameover, "Come back tomorrow for a fresh daily"
- **Death-cam** — 0.5s freeze on fatal miss (still unaddressed)

---

## Sprint 8 — Moment-of-death + daily progression (2026-04-17)

**Lens used:** moment-of-death (the single highest-emotion 500ms in the game) + longitudinal progression (what I see when I come back to today's daily five times?) + ritual (why come back tomorrow?).

### Problems diagnosed

1. **The fatal hit is too fast to register.** 16ms from miss → overlay. Players don't see what killed them, so they don't learn. A key feedback loop — "what did I do wrong?" — is broken.
2. **Daily history mixed with free-play.** Sprint 5 shipped run-history sparkline using a single `void-pulse-history` key. In Sprint 7 daily mode, that same sparkline was a meaningless mashup of daily + free-play scores. Per-seed score had its own key; per-seed history did not.
3. **Daily mode has no return hook.** Player finishes today's daily, sees "Daily progress", and has no idea when the next daily drops. Missed opportunity at the peak emotional moment.

### Ships

- **Death-cam slow-mo.** On the fatal hit, sim slows to 22% for 550ms with a red vignette + desaturated canvas filter + larger red particle burst. Timer uses real wall-clock dt so the beat ends on schedule regardless of sim scale. Input swallowed throughout. Reduced-motion override disables the flash animation.
- **Per-seed history.** `void-pulse-history-seed-{seed}` key. Daily sparkline now shows only this seed's runs, labeled "Daily progress" instead of "Last runs".
- **Tomorrow-teaser.** `Next daily in 6h 12m` on daily-mode gameover. Countdown to device-local midnight, recomputed fresh on each gameover, coarse h+m format so it's not a ticking distraction.

### What the extraction surfaced (skills)

- New `skills/graphics/death-cam.md` — the two-clock pattern (world clock scaled, timer on real dt), what to freeze during the cam (spawns, cascade-losses, input), CSS filter + vignette recipe, tuning table for duration / time-scale / vignette peak.
- Appended `skills/gameplay/seeded-daily.md` — per-seed history key, re-labeled history ("Daily progress"), tomorrow-teaser pattern.

### Cumulative sprint arc

The lens rotation keeps producing non-trivial work:

| Sprint | Lens | Representative addition |
|---|---|---|
| 2 | Perceived timing | Time-domain judge windows |
| 3 | Multi-perspective sweep | DPR, mute, keyboard, onboarding |
| 4 | Smoothness + juice | 120Hz interpolation, haptics, starfield |
| 5 | Robustness + trend | Tab-pause, combo meter, run-history |
| 6 | Accessibility + virality | Colorblind dashing, Share API, pity life |
| 7 | Ritual | Daily seeded challenge |
| 8 | Moment-of-death + progression | Death-cam, per-seed history, tomorrow teaser |

Each feature individually is small; together they've quadrupled the game's depth without changing the single-tap mechanic.

### Next candidates

- **Per-seed local leaderboard** — top-5 on today's daily, unlocks after 3+ attempts
- **Audio dynamics** — master bus rises ~2dB when in "beaten-best" state; subtle but felt
- **Help modal** — `?` shortcut surfaces a one-screen "what does this combo bar mean" reference

---

## Sprint 9 — Onboarding + power-user keys (2026-04-17)

### Lens
- **First-30-seconds clarity**: the start screen describes the game in one sentence ("Tap the ring when the void pulses through it") but reading is slower than seeing. New players hit Start without a mental model, miss the first 2-3 pulses, and bounce.
- **Power-user friction**: returning players who play with headphones at work want a one-key mute. Players who get a phone call want a one-key pause. Forcing a tab-switch to pause is hostile to keyboard users.

### Changes shipped

1. **CSS-animated demo on start overlay** — a 160×160 demo embedded above the start button: a static target ring, a danger-pink pulse expanding in a 2.6s loop, and a "TAP!" prompt that fades in at the 62%-78% phase (the moment the pulse aligns with the ring). The pulse border briefly turns gold at the 70% mark, mirroring the in-game perfect-color cue. Pure CSS — zero JS, zero canvas, auto-pauses when the tab hides. Reduced-motion freezes the animation in its "successful tap" pose.
2. **Keyboard shortcuts: M (mute) and P (pause)** — added next to the existing Space shortcut. M works any time; P only mid-run. P cycles: play → pause-indefinite → countdown → (press again) cancel-back-to-pause-indefinite → countdown → resume. Uses `e.code` (`KeyM`/`KeyP`) for layout independence and an `inField` guard so focused buttons don't double-fire.
3. **Pause overlay copy update** — "Return to the tab to resume" → "Return to the tab — or press P — to resume". Discoverable hint at the moment of need.
4. **Start-screen `kbhint` line expanded** — `Space · M mute · P pause` in a single tight line with `<kbd>` semantics. Matches casual-game conventions players already know from itch.io / browser games.

### Patterns extracted

- **Wordless onboarding with timing-matched demo** — the demo's animation duration must match real-game pulse timing within ~10%, otherwise players build the wrong reflex. The "TAP!" prompt fires *during* the success window (post-arrival), not before.
- **Layout-independent shortcuts via `e.code`** — never use `e.key` for game shortcuts; AZERTY users get a different letter. `KeyM`/`KeyP` are physical-position keys.
- **Three-state pause cycle** — not paused / paused-indefinitely / paused-with-countdown is a useful tri-state. The middle state lets the player perceive "paused" as a stable thing they can trust before initiating resume; the third state gives them a brace-yourself moment.

### Sprint 2-9 wrap-up table

| Sprint | Lens | Representative addition |
|---|---|---|
| 2 | Perceived timing | Time-domain judge windows |
| 3 | Multi-perspective sweep | DPR, mute, keyboard, onboarding |
| 4 | Smoothness + juice | 120Hz interpolation, haptics, starfield |
| 5 | Robustness + trend | Tab-pause, combo meter, run-history |
| 6 | Accessibility + virality | Colorblind dashing, Share API, pity life |
| 7 | Ritual | Daily seeded challenge |
| 8 | Moment-of-death + progression | Death-cam, per-seed history, tomorrow teaser |
| 9 | Onboarding + power-user | CSS demo loop, M/P shortcuts |

### Cost

- index.html: +6 lines (demo div + expanded kbhint + pause-hint kbd)
- style.css: +60 lines (demo + keyframes + reduced-motion + kbd styling)
- game.js: +25 lines (extended keydown listener)
- One new skill doc (`ux/onboarding.md`)

Net effect: a 360px-wide phone now sees the rule of the game without reading, and a desktop player can mute/pause without touching the mouse. Both are zero-friction wins layered on an already-shipped game.

---

## Sprint 10 — Performance + HUD scannability + bug discovery (2026-04-17)

### Lens
- **Low-end mobile**: the game runs at 144fps on a desktop M-series Mac, but we've never opened DevTools on a Galaxy A12. A 2-3ms allocation budget per frame is invisible on fast hardware and a stutter generator on slow.
- **HUD perception**: the player's eye spends most of the run on the canvas, not the HUD. Hits and bonuses need to telegraph at the HUD level *too*, not only on the canvas.
- **Audit-as-improvement**: a perf pass forces a top-to-bottom code re-read, which is exactly when latent bugs surface.

### Changes shipped

1. **Per-frame allocation audit** —
   - `ctx.createRadialGradient(...)` for the combo vignette was allocating one CanvasGradient + 2 colorStops + 1 rgba string every frame. Now bucket-cached into 6 heat-bucket gradients; cache fills in ≤6 frames, then zero allocations forever.
   - `ctx.setLineDash([14, 8])` and `ctx.setLineDash([])` per heartbeat-pulse per frame replaced with module-level `HEARTBEAT_DASH` / `NO_DASH` constants. At 5+ heartbeats × 60fps that's 300+ saved allocations/sec.
   - Hoisted `state.t * 1.2` out of the starfield loop (40 iterations per frame).
2. **Adaptive quality** — sample dt for the first 60 frames after start; if median > 22ms (~45fps), drop the starfield. Median-not-mean so JIT warmup hitches don't trigger downgrade. Cosmetic-only — pulses, lives, score never dim.
3. **Dev FPS overlay** behind `?fps=1` URL flag. Smoothed over 0.5s. Tags `· low` when adaptive quality has kicked in. Lazily built on first call so production runs pay zero cost.
4. **HUD scannability** —
   - `.life` glyph gets a `lost-flash` keyframe (red pulse + scale 1.4 → settle dim) when a life is lost. Previously the only feedback was a CSS opacity transition — easy to miss in peripheral vision.
   - Pity-life bonus glyph gets a `bonus-glow` keyframe (gold pulse, 1.4s) at run-start so the player learns "the gold one is the freebie."
   - `#combo` got `min-width: 5ch` + `text-align: right` + explicit `tabular-nums` so the multiplier badge ("×2 12") doesn't bounce the layout when text length changes.
5. **Latent bug fix** — discovered during HUD audit: `state.lives` could reach 4 with the bonus life, but the HUD only had 3 hard-coded `<span class="life">` elements, so the 4th life was *invisible* — players had a phantom life they could lose without seeing. Replaced with `ensureLifeGlyphs(n)` that dynamically grows/shrinks the glyph list to match `state.lives`.

### Patterns extracted

- **Bucket-cached gradients** — discretize any continuous parameter to 4-8 buckets and the visual diff is imperceptible while the alloc cost goes to zero.
- **Median-dt adaptive quality** — single-shot sampling, not continuous; drop cosmetic layers, never gameplay.
- **Bug-find by audit lens** — perf audits force re-reading code with a different question, which exposes bugs unrelated to perf. Three of the last seven sprints found a non-trivial bug this way.

### Sprint 2-10 wrap-up table

| Sprint | Lens | Representative addition |
|---|---|---|
| 2 | Perceived timing | Time-domain judge windows |
| 3 | Multi-perspective sweep | DPR, mute, keyboard, onboarding |
| 4 | Smoothness + juice | 120Hz interpolation, haptics, starfield |
| 5 | Robustness + trend | Tab-pause, combo meter, run-history |
| 6 | Accessibility + virality | Colorblind dashing, Share API, pity life |
| 7 | Ritual | Daily seeded challenge |
| 8 | Moment-of-death + progression | Death-cam, per-seed history, tomorrow teaser |
| 9 | Onboarding + power-user | CSS demo loop, M/P shortcuts |
| 10 | Perf + HUD scannability + bug | Gradient cache, adaptive quality, dynamic lives glyphs |

### Cost

- game.js: +90 lines (cache + adaptive sampler + FPS overlay + dynamic lives + life-loss flash trigger)
- style.css: +25 lines (lost-flash, bonus-glow keyframes, combo min-width)
- One new skill doc (`graphics/perf-budget.md`)
- One latent bug eliminated (invisible 4th life)

### Next candidates

- **Local leaderboard top-5 per seed** — small, satisfying retention loop on top of the daily mode
- **Theme picker** — let players choose between 3 palettes (the void / sunset / forest)
- **Achievements** — first 100 perfects, 5-day daily streak, etc.

---

## Sprint 11 — Audio dynamics + help discoverability (2026-04-17)

### Lens
- **Audio mix as game state**: the run sounds the same whether the player is at 12 points or 1200. SFX are flat, the moment of crossing best is unmarked, and overlays leave residual SFX-tail competing with HUD focus. The mix should *respond* to game state.
- **Discoverability of stacked mechanics**: nine sprints have layered combo multipliers, pity life, daily mode, death-cam, polyrhythm spawns, redundant heartbeat coloring. New players don't know any of this; returning players forgot. A `?` shortcut closes the gap for ~50 lines of code.

### Changes shipped

1. **Three-state master bus** — `normal` / `beaten` / `duck`. `beaten` lifts gain by +1.4dB the moment the player surpasses their best (felt as "rising stakes," not louder). `duck` drops by -9dB whenever an overlay opens (pause / gameover / help) so any leftover SFX-tail tucks under the UI. Transitions ramp `linearRampToValueAtTime` over 400ms — same time scale as overlay opacity transitions, so audio tracks visual.
2. **`?` key help modal** — opens a centered card explaining tap rules, perfect/good/heartbeat scoring, combo bar, pity life, daily mode. Auto-pauses the run on open; on close, resumes with the standard 3-2-1 countdown. Backdrop click closes; `Esc` closes; visible `?` icon-button next to the mute button surfaces it for non-keyboard users.
3. **Help button placement** — top-right corner, 60px in from the edge so it sits one button-width left of mute. Same visual weight; new players notice it within ~3 seconds without any callout.
4. **Shortcut hint refresh** — start-overlay `kbhint` now reads `Space · M mute · P pause · ? help`. P shortcut gated to no-op while help modal is open (prevents weird state where countdown runs behind a help screen).

### Patterns extracted

- **Bus dynamics without a real mixer** — `setBus(name)` over a single `GainNode` covers 90% of "music dynamics" wins for a casual game without pulling in an audio engine. The trick is `cancelScheduledValues` + `setValueAtTime(currentValue, t0)` before the ramp, so successive calls don't stack.
- **Help modal as auto-pause + auto-resume** — opening help mid-run shouldn't burn the player. Track `helpOpenedDuringRun` so we only auto-resume if the help itself induced the pause.
- **`?` key cross-layout** — `e.key === '?' || (e.key === '/' && e.shiftKey)` covers ~99% of layouts. The visible button is the failsafe.
- **Mute-aware bus state** — `setBus` short-circuits when muted, but the bus state is still tracked. When the player unmutes, gain lands at the right level for the current bus state.

### Sprint 2-11 wrap-up table

| Sprint | Lens | Representative addition |
|---|---|---|
| 2 | Perceived timing | Time-domain judge windows |
| 3 | Multi-perspective sweep | DPR, mute, keyboard, onboarding |
| 4 | Smoothness + juice | 120Hz interpolation, haptics, starfield |
| 5 | Robustness + trend | Tab-pause, combo meter, run-history |
| 6 | Accessibility + virality | Colorblind dashing, Share API, pity life |
| 7 | Ritual | Daily seeded challenge |
| 8 | Moment-of-death + progression | Death-cam, per-seed history, tomorrow teaser |
| 9 | Onboarding + power-user | CSS demo loop, M/P shortcuts |
| 10 | Perf + HUD scannability + bug | Gradient cache, adaptive quality, dynamic lives glyphs |
| 11 | Audio dynamics + discoverability | Three-state bus, `?` help modal, auto-pause/resume |

### Cost

- game.js: +75 lines (bus `setBus` + 4 trigger sites + help open/close + key wiring)
- index.html: +30 lines (help modal markup + help button)
- style.css: +90 lines (help modal + help-btn position)
- Two new skill docs (`audio/audio-dynamics.md`, `ux/help-modal.md`)

---

## Sprint 12 — Local top-5 per-seed leaderboard (2026-04-17)

### Lens
- **Micro-goal density**: best-only is binary feedback. After the first run sets a personal best, every subsequent run is "did I beat it" (1 bit of information). A top-5 turns each retry into a measurable micro-goal — "can I knock the 5th-place line off?" — giving 4 extra targets to chase within a session.
- **Storytelling via timestamps**: scores without temporal context are scoreboards of strangers. Adding "yesterday" / "2h ago" to each entry turns the board into a tiny diary: *yesterday I had sharper reflexes than today.*

### Changes shipped

1. **Per-seed top-5 leaderboard**, namespaced same as `BEST_KEY` / `HISTORY_KEY` (`void-pulse-board-seed-{N}` in daily mode, `void-pulse-board` in free-play). Capped at 5 entries; sorted descending by score with tiebreak = earliest `atMs` wins.
2. **Relative-time formatter** with coarse buckets — "just now" / "Nm ago" / "Nh ago" / "yesterday" / "Nd ago" / "30+d ago". No second-precision noise.
3. **`lb-new` highlight** on the just-set score — accent-color background + 1.6s one-shot pulse animation. Player can locate their run instantly within the list.
4. **`lb-top` gold tint** on the rank-1 row — a player who just set a #2 score still sees the gold #1 looming above them.
5. **Empty-state hides** — wrapper `hidden` if `board.length === 0`. No "you haven't played" guilt trip on first visit.
6. **Daily mode label switch** — "Top runs" → "Top daily runs". Same wording shift as the history sparkline did in sprint 7.
7. **Leaderboard primed at init**, not only at gameover — so a returning player who tabs in sees their daily board even before playing.

### Patterns extracted

- **Top-N store: each entry has `atMs`** — temporal context is half the storytelling. Score-only is a wall, score+time is a diary.
- **Earliest-wins tiebreak** — rewards first achievement, more honest than latest-wins for a personal leaderboard.
- **Coarse relative-time buckets** — precise seconds invite comparison of trivia. Group at minute / hour / day boundaries.
- **Score-0 doesn't enter board** — prevents an immediate-mistap on the first run from leaving a 0 sitting at #5 forever.
- **Per-seed namespace** — same convention as best/history keys. Daily and free-play maintain independent leaderboards.

### Sprint 2-12 wrap-up table

| Sprint | Lens | Representative addition |
|---|---|---|
| 2 | Perceived timing | Time-domain judge windows |
| 3 | Multi-perspective sweep | DPR, mute, keyboard, onboarding |
| 4 | Smoothness + juice | 120Hz interpolation, haptics, starfield |
| 5 | Robustness + trend | Tab-pause, combo meter, run-history |
| 6 | Accessibility + virality | Colorblind dashing, Share API, pity life |
| 7 | Ritual | Daily seeded challenge |
| 8 | Moment-of-death + progression | Death-cam, per-seed history, tomorrow teaser |
| 9 | Onboarding + power-user | CSS demo loop, M/P shortcuts |
| 10 | Perf + HUD scannability + bug | Gradient cache, adaptive quality, dynamic lives glyphs |
| 11 | Audio dynamics + discoverability | Three-state bus, `?` help modal, auto-pause/resume |
| 12 | Micro-goal density | Per-seed top-5 leaderboard with relative timestamps |

### Cost

- game.js: +85 lines (board read/write + insertScore + formatRelative + renderLeaderboard + hookups)
- index.html: +6 lines (leaderboard wrapper + ol + label)
- style.css: +60 lines (leaderboard rows, lb-top, lb-new keyframe)
- One new skill doc (`ux/leaderboard-local.md`)

### Next candidates

- **Theme picker** — let players choose between 3 palettes (the void / sunset / forest)
- **Achievements / streaks** — Wordle-style daily streak ("3 days in a row"), "first 100 perfects"
- **Replay scrubber** — record the last run's pulse positions for a ghost replay on the gameover overlay

---

## Sprint 13 — Daily streak + first-run achievements (2026-04-17)

### Lens

**Multi-horizon retention.** The daily mode (Sprint 7) builds the ritual, top-5 (Sprint 12) builds within-session micro-goals. Missing: cross-day ritual reinforcement (streak), and cross-session milestones (achievements). Wordle's whole moat is the 3-day-streak dopamine loop — and we already have all the plumbing for it.

### Changes

- **Global streak counter** — `localStorage: void-pulse-streak = { streak, best, lastYyyymmdd }`. Bumped on the first score-0+ run of the day *when* the seed is today's canonical daily (not arbitrary `?seed=` links).
- **Active-vs-dormant rule** — streak badge visible only if `lastYyyymmdd` is today or yesterday. Older → hide (but `best N` is preserved for the next time a streak becomes active).
- **Idempotent within-day bump** — playing the daily 5x does not give you a 5-day streak; first-of-day wins, remaining runs pass through.
- **Calendar-day rollover, not 24h** — uses `yyyymmddOf(Date)` equality, so timezone/DST don't corner-case the player.
- **Achievements flat-map** — `localStorage: void-pulse-ach = { [id]: 1 }`. 6 achievements shipped:
  - `first-pulse` (score ≥ 1), `combo-25`, `combo-50`, `score-500`, `score-1000`, `streak-3`
- **Unlock pulse** — a newly-unlocked chip gets `.just` class with a one-shot scale-pulse keyframe so the player can find what's new in the grid. Progress header `N / 6`.
- **New `Sfx.achievement()` cue** — triangle-wave major-6th triad (880 / 1175 / 1568 Hz), 90ms stagger, played 420ms after gameover thud — *and only if NEW BEST didn't also fire*. Two cascading chimes muddy the mix; NEW BEST wins.
- **Badge placement: two screens, one rule** — the same active-streak check drives both the start-overlay greeting and the gameover acknowledgement. No inconsistent states across entry points.

### Patterns extracted → `company/skills/ux/streak-and-achievements.md`

- **Scoping matrix** table (per-seed vs. global vs. per-day) — answers the "where does this signal live?" question for every retention signal in one glance.
- **Bump rule with calendar-day comparison** — avoids timezone-edge bugs that break a player's 30-day streak because they played in a different timezone.
- **Active vs. dormant streak display** — graceful degradation to "best N" line when streak is broken, preserving the honor without lying about current state.
- **`justNow` set for new unlocks** — the one piece of data the UI actually needs but the data layer forgets to return; named out explicitly.
- **SFX collision rule** — NEW BEST wins over achievement when both would fire. Simple, but easy to miss until playtesting reveals the muddy mix.

### Wrap-up

| Sprint | Angle | Outcome |
|---|---|---|
| 13 | Multi-horizon retention | Global daily-streak + 6 achievements + scoped-unlock skill doc |

### Cost

- game.js: +110 lines (streak read/write/bump + achievements eval + two render fns + Sfx.achievement + gameover hook)
- index.html: +11 lines (streak badges × 2 overlays, achievements grid container)
- style.css: +130 lines (streak badge + streakBump keyframe + ach-grid + ach-chip states + achJust keyframe)
- One new skill doc (`ux/streak-and-achievements.md`)

### Next candidates

- **Theme picker** — player personalization lens, 3 CSS-variable palettes selectable from start overlay; persists in localStorage.
- **Ghost replay scrubber** — record last run's pulse positions, replay as low-alpha ghost overlay on the gameover screen.
- **Rarer / harder achievements** — "no-miss 60s", "5-day streak", "3 perfects in one heartbeat" — needs additional run-stat tracking but plumbing is ready.
- **Share-card upgrade** — bake streak + achievement progress into the share payload so "3-day streak · Combo 50 ✓" shows up on social.

---

## Sprint 14 — Theme picker + canvas-cache invalidation (2026-04-17)

### Lens

**Player personalization.** After 13 sprints of gameplay/retention polish, the palette was still fixed. "Void" (cyan on deep blue) is striking but any single palette fatigues over ten-plus sessions. A theme picker is a classic casual-game personalization lens — cheap to add, zero gameplay risk, and it forces a useful audit of color-token discipline.

The actual engineering meat is not choosing swatches — it's the **cache invalidation** that the canvas render demands. We already have a `cssVar` cache (Sprint 10 perf work) and a bucketed `CanvasGradient` cache for the vignette. Both snapshot colors. Both must be invalidated on theme swap, or the overlay updates cleanly while the gameplay canvas keeps painting yesterday's palette.

### Changes

- **Three palettes** — `void` (current cyan/deep-blue), `sunset` (amber/plum), `forest` (teal/dark-green). Declared as `:root` + `[data-theme="sunset"]` + `[data-theme="forest"]` CSS variable blocks.
- **New token `--highlight`** (was hardcoded `#ffd24a` everywhere) — carries the celebration-gold role, now theme-adaptive (gold → pink → lime).
- **New tokens `--vignette-near-rgb` + `--vignette-far-rgb`** — raw RGB triplets consumed by the canvas render for rgba() composition with runtime alpha. `CanvasGradient` can't take `color-mix`, and storing `rgb(...)` strings can't add alpha, so triplets are the pattern.
- **`invalidateThemeCaches()`** — clears both `cssVar` and `vignetteCache`. Registered as a checklist for future additions.
- **`applyTheme(t)`** — writes `document.documentElement.dataset.theme`, invalidates caches, syncs picker radio aria-state. Called synchronously before first `requestAnimationFrame` so no default-palette flash.
- **Theme picker UI** — three circular swatch buttons on the start overlay; each swatch background uses hardcoded preview colors (NOT `var()`) so every theme shows its own preview regardless of active theme.
- **`T` keyboard shortcut** — cycles void → sunset → forest → void. Works anywhere (start overlay, mid-run, gameover) so the player can A/B palettes quickly.
- **Target-ring pulse on theme change** — `state.targetPopT = 1` plays the existing hit-pop animation, giving canvas-side proof that the swap reached gameplay rendering, not just overlay chrome.
- **Purged dead code** — `--accent-alt` was written in Sprint 7 but never read; removed.

### Patterns extracted → `company/skills/ux/theme-picker.md`

- **`[data-theme="..."]` over classes** — specificity hygiene, single-value semantics, stackable with component selectors.
- **RGB-triplet vars for canvas rgba() composition** — the "store `82, 92, 180` not `rgb(82, 92, 180)`" trick.
- **Cache-invalidation checklist** — every color-derived cache (`cssVar`, `CanvasGradient`, offscreen canvas, etc.) must be registered in `invalidateThemeCaches()`. This is the non-obvious engineering burden of a theme picker on canvas games.
- **Hardcoded swatch previews** — each swatch shows its own theme's colors. Counterintuitive until you notice the alternative (all swatches matching the active theme) is useless.
- **Feedback pulse into canvas** — a one-frame gameplay-render gesture on theme change proves the swap reached the canvas layer.
- **What NOT to theme** — celebration gradients (NEW BEST), shadow, radius, intrinsic-meaning reds (life-lost) all stay fixed. Over-theming makes palettes feel washy.

### Wrap-up

| Sprint | Angle | Outcome |
|---|---|---|
| 14 | Player personalization | 3 palettes + `T` cycle + canvas-cache invalidation plumbing + skill doc |

### Cost

- game.js: +55 lines (readTheme/writeTheme + applyTheme + invalidateThemeCaches + cycleTheme + picker click handler + T shortcut + vignette rgb-triplet swap)
- index.html: +6 lines (theme picker radio group in start overlay + kbhint + help-modal entry)
- style.css: +45 lines (sunset + forest `[data-theme]` blocks + .theme-picker + swatch previews) — plus ~15 in-place refactors from `#ffd24a` to `var(--highlight)`
- One new skill doc (`ux/theme-picker.md`)

### Next candidates

- **Per-theme background particles** — sunset could have ember drift, forest could have falling petals. Zero-alloc particle pool (skill: `graphics/particle-fx.md`) is already sized for this; just need theme-gated spawn rules.
- **Theme-conditional SFX** — forest theme's miss sfx could be a lower-register rustle instead of the sawtooth thud. Cheap to plumb through the existing `Sfx._env` interface.
- **Ghost replay scrubber** — record last run's pulse positions, replay as low-alpha ghost overlay on the gameover screen.
- **Share-card theme badge** — include theme name in share payload, maybe a small unicode-circle color hint.
- **System-preference auto-theme** — `prefers-color-scheme` + candidate `prefers-contrast` hooks → default to a theme that matches the OS.

---

## Sprint 15 — Theme-conditional ambient drift (2026-04-17)

### Lens

**Atmosphere as theme signature.** Sprint 14 added three palettes, but the gameplay-canvas layer was still visually identical across them once pulses started flying. Void, sunset, and forest all had the same starfield behind the action. A proper theme swap should feel like a weather change, not a tinted screenshot.

### Changes

- **New ambient particle pool** — 20 persistent particles with pre-randomized `x/y/size/phase/vBase/swayAmp/swayRate`. Not spawn-and-die; they wrap around the viewport, so the pool is constant-size.
- **Theme-parameterized behavior**:
  - **Void** → no ambient layer (starfield alone carries it)
  - **Sunset** → upward ember drift, flickering circle dots
  - **Forest** → downward petal drift, tall thin rectangles (elongated oval via cheap fillRect, no save/restore/rotate)
- **Per-particle unique `vBase` + `swayAmp` + `swayRate`** — set once at init, never re-randomized. Prevents lockstep look while keeping the pattern deterministic and cheap.
- **Initialized across the whole viewport at start** (not at `y = H+14`) — no "empty sky" first-seconds gap.
- **Gated by the same adaptive-quality flag as the starfield** (`renderStarfield`) — both are decor, both drop together when median-dt samples exceed budget.
- **`reducedMotion` branch in `updateAmbient`** — returns early, particles freeze at their current positions (still rendered, just still).
- **Zero cache to invalidate on theme change** — both update and render read `currentTheme` each call, so the `T` shortcut or picker click changes direction/shape on the very next frame. Wind-shift, not reset.

### Patterns extracted → `company/skills/graphics/ambient-drift.md`

- **Persistent pool + wrap-around** as the right structure for ambient (vs. spawn/die pool for foreground burst).
- **Theme-parametrize by sign, not by behavior** — `dir = theme === 'forest' ? 1 : -1` collapses three themes to one branch.
- **Shape hint per theme** — circle/ember vs. tall-rect/petal tells a story without adding assets.
- **Tall fillRect as faux-oval** — avoids per-particle `ctx.save`/`rotate`/`restore` overhead at the cost of a tiny geometric white-lie.
- **Gate ambient + starfield as one decor group** — perceptually one "atmosphere" from the player's view.
- **Per-particle uniqueness from fixed random at init, not per-frame** — keeps look varied without chaos or cost.

### Wrap-up

| Sprint | Angle | Outcome |
|---|---|---|
| 15 | Atmosphere as theme signature | 20-particle ambient pool, 2-direction branch, reduced-motion gated, new skill doc |

### Cost

- game.js: +65 lines (ambient pool + updateAmbient + renderAmbient + update/render hookups)
- index.html: +0 (pure canvas layer)
- style.css: +0 (no chrome)
- One new skill doc (`graphics/ambient-drift.md`)

### Next candidates

- **Theme-conditional SFX** — still open from Sprint 14 backlog. Forest miss → low rustle; sunset miss → dry crackle.
- **Ghost replay scrubber** — unchanged from prior sprints. Record `{t, heartbeat, hit/miss}` per pulse in best-run storage, replay on gameover as a faded silhouette ring.
- **Rarer / harder achievements** — "no-miss 30s", "5-day streak", "3 perfects in one heartbeat" — needs additional stat tracking but plumbing is ready.
- **System-preference auto-theme** — first-load default from `prefers-color-scheme` + possibly `prefers-contrast`.
- **Ambient density preference** — some players may want the drift layer off without going to reduced-motion. A settings toggle could expose it.

---

## Sprint 16 — Theme-conditional SFX accents (2026-04-17)

### Lens

**Theme as an audible signature, not just a visual one.** Sprint 14 gave the player three palettes; Sprint 15 gave them three atmospheres on the canvas. Close your eyes during gameplay and all three themes still sounded identical — the synthesizer palette (sawtooth miss, triangle score, sine heartbeat) read as "void" regardless of which theme was live. This sprint closes that gap: the player now *hears* the theme at the two most emotionally-loaded moments (miss, gameover), while every other SFX stays exactly as it was. Additive, not replacing.

### Changes

- **New `_getNoise()` lazy white-noise buffer** — 1 second mono, built on first use, then reused for every subsequent accent. Memory cost ≈ 180KB @ 48kHz, paid only if the player misses at least once.
- **New `_noise(dur, vol, filterType, filterFreq)` helper** — `createBufferSource()` → BiquadFilter → Gain → master. Same exponential envelope as `_env` so oscillator tones and noise bursts mix coherently.
- **New `_themeAccent(kind)` branch point** — single function reads `currentTheme` at call-time (mid-run theme swap works instantly, matching the Sprint 15 `ambient-drift` contract). `kind ∈ {'miss', 'over'}` today; extensible to more kinds without touching callers.
- **`miss()` now plays `_themeAccent('miss')` after the base tone**:
  - Void → no accent (baseline sawtooth unchanged)
  - Sunset → dry ember crackle (`highpass @ 2400 Hz`, 90 ms, vol 0.18)
  - Forest → leaf rustle (`lowpass @ 900 Hz`, 180 ms, vol 0.10)
- **`gameover()` schedules `_themeAccent('over')` 140 ms after the initial attack** — lands on the sustain/thud phase of the death beat so atmosphere reads without muddying the "game ended" attack:
  - Void → no accent
  - Sunset → long ember hiss (`highpass @ 1800 Hz`, 220 ms, vol 0.14)
  - Forest → settling rustle (`lowpass @ 700 Hz`, 380 ms, vol 0.08)

### Patterns extracted → `company/skills/audio/theme-conditional-sfx.md`

- **Lazy white-noise buffer** as a reusable primitive for crackle/rustle/wind/rain accents — build on first use, mono, 1-second length clipped by envelope.
- **Filter type as character** — `highpass` ≈ crackle/pop, `lowpass` ≈ rustle/muffle, `bandpass` ≈ sizzle/spray. Same buffer, three different sounds via one parameter.
- **`_themeAccent(kind)` centralization** — one function holds the theme branch; callers stay one-liners. Adding a new theme = adding an `else if` in one place.
- **Additive layer, never replacement** — base tone always plays; accent is pure sugar. A player who picked void hears exactly the original game.
- **Volume headroom 0.10–0.18 vs. base 0.26** — leaves room for the 'beaten' bus +18% lift without clipping, and keeps the base tone readable as "the miss sound".
- **Schedule accent on the sustain phase, not the attack** — for compound SFX (gameover's two-thud beat), the attack carries meaning and the accent rides the sustain for atmosphere.

### Wrap-up

| Sprint | Angle | Outcome |
|---|---|---|
| 16 | Theme as audible signature | Additive noise-accent layer for miss + gameover, lazy-init buffer, new audio skill doc |

### Cost

- game.js: +52 lines (noise buffer + `_noise` + `_themeAccent` + two call-sites)
- index.html: +0
- style.css: +0
- One new skill doc (`audio/theme-conditional-sfx.md`)

### Next candidates

- **Ghost replay scrubber** — record `{t, heartbeat, hit/miss}` per pulse into best-run storage, overlay as a faded silhouette on subsequent runs.
- **System-preference auto-theme** — on first visit, default from `prefers-color-scheme` (light → sunset, dark → void) and `prefers-contrast`.
- **Rarer / harder achievements** — "no-miss 30s", "5-day streak", "3 perfects in one heartbeat". Stat plumbing is mostly there.
- **Theme-conditional hit/spawn accents** — extending the accent layer into the high-frequency SFX. Needs care: spawnTick plays 15–30×/second, easy to overdo.
- **Ambient density preference toggle** — give the drift layer its own on/off independent of reduced-motion.
- **Per-theme score-sweetener** — bright bell for sunset, wood-tock for forest, on high-combo score events only (rarity keeps it from wearing out).

---

## Sprint 17 — System-preferred defaults (2026-04-17)

### Lens

**The OS already knows what the player needs.** Three sprints into the theme story, the first-visit default was still hardcoded 'void' — which meant a player on a bright-room iPad with `prefers-color-scheme: light` got slammed with a dark palette and had to hunt for the picker to get something less jarring. And a low-vision user with `prefers-contrast: more` was stuck on whatever our designer chose as ship-theme, which wasn't necessarily the highest-contrast option. This sprint reads the signals the OS is already broadcasting and chooses accordingly, while the explicit-pick UX stays intact.

### Changes

- **Split `readTheme()` into three functions:**
  - `readStoredTheme()` — returns the localStorage value or `null`. `null` is the authoritative signal for "auto mode".
  - `sniffSystemTheme()` — reads `prefers-contrast: more` (→ void, a11y priority) and `prefers-color-scheme: light` (→ sunset). Purely derived; never writes.
  - `readTheme()` — the composite: `readStoredTheme() || sniffSystemTheme()`. Drop-in compatible with existing call-sites.
- **`setTheme()` remains the only writer.** Sniff results are never persisted. That means auto-mode is always reachable by clearing storage, and the first-ever explicit click is what "locks in" a choice.
- **Live media-query listeners** — `(prefers-color-scheme: light)` and `(prefers-contrast: more)`. A mid-session OS theme flip or system-wide contrast toggle updates the game's theme on the next change event if (and only if) the user hasn't picked explicitly yet. `onSystemThemeChange` guards on `readStoredTheme()` — once there's a stored value, the listener becomes a no-op for eternity.
- **Safari ≤13 compatibility** — `addListener`/`removeListener` fallback alongside the modern `addEventListener` branch. Branched once at init for cleanliness.
- **Priority ordering** — contrast beats color scheme. A low-vision user in a light room still gets void, because legibility is the higher-order concern.

### Patterns extracted → `company/skills/ux/system-preferred-defaults.md`

- **Three-state contract** — auto (null in storage) / explicit (stored pick wins forever) / never-mixed (we never auto-persist).
- **`readStoredTheme() === null` as the auto-mode bit** — single source of truth, survives devtools edits and cross-tab flips.
- **Split stored from resolved** — keeps the "has user picked?" check reusable in listeners and future features (e.g., a reset-to-default button).
- **Priority-ordered sniff** — contrast → color scheme → fallback. Accessibility wins over aesthetics when they conflict.
- **Branch `addEventListener` vs. legacy `addListener` once at init** — not per-fire.
- **Never store a flag like `isAutoMode`** — JS state can desync; localStorage can't.
- **Fallback is the designer's ship theme, not a system preference** — "no preference" means "give me what you shipped".

### Wrap-up

| Sprint | Angle | Outcome |
|---|---|---|
| 17 | First-visit sensibility | OS-aware auto-default, live listeners, auto-vs-explicit captured in storage presence, new ux skill doc |

### Cost

- game.js: +40 lines (split readTheme, sniff function, onSystemThemeChange, listener wiring)
- index.html: +0
- style.css: +0
- One new skill doc (`ux/system-preferred-defaults.md`)

### Next candidates

- **Ghost replay scrubber** — record `{t, heartbeat, hit/miss}` per pulse into best-run storage; render a faded silhouette ring on subsequent runs showing last-best pacing.
- **Rarer / harder achievements** — "no-miss 30s", "5-day streak", "3 perfects in one heartbeat". Stat plumbing is mostly already in place.
- **First-run onboarding softness** — a 3-tap tutorial pulse before the real run starts on first-ever visit.
- **Per-theme score-sweetener** — high-combo overtone layer, only fires at combo ≥10, rarity keeps it fresh.
- **"Reset to system default" link** — tiny surface in the help modal: `localStorage.removeItem(THEME_KEY)`; returns to auto-mode.
- **Ambient density preference** — still open from Sprint 15 backlog.

---

## Sprint 18 — PWA-lite install surface + theme-responsive chrome (2026-04-17)

### Lens

**From "website" to "app-on-the-home-screen" without touching the build pipeline.** The game is already a single HTML + CSS + JS + inline-SVG bundle. It is install-ready — it just hasn't declared itself. A manifest, a few meta tags, and a runtime `theme-color` sync are enough to (a) let users add it to their home screen with a proper name/icon, (b) launch it in standalone mode (no URL bar, own task-switcher card), and (c) keep the OS chrome color synced with the active in-game theme. No service worker, no offline layer — just the identity layer.

### Changes

- **New `games/001-void-pulse/manifest.webmanifest`** — name, short_name, description, start_url + scope pinned to `./`, display `standalone`, portrait orientation, theme/background color matching `--bg` default. Two inline-SVG icons: one `purpose: any` and one `purpose: maskable` with a solid background rect for launcher-crop safety.
- **Icons are URL-encoded data URIs, not base64** — SVG compresses better URL-encoded, and JSON-embedded strings need escaped `<`/`>`/`"` anyway.
- **`<link rel="manifest">` wired in index.html** plus a set of iOS/Android compatibility metas (`mobile-web-app-capable`, `apple-mobile-web-app-capable`, `apple-mobile-web-app-title`, `apple-mobile-web-app-status-bar-style: black-translucent`).
- **New `<link rel="apple-touch-icon">` with inline SVG** — 180×180 viewBox, unescaped SVG inside the href attribute (works in Safari 13+). iOS Safari ignores manifest `icons` so this sidecar is mandatory.
- **`syncThemeColorMeta()` helper** reads `getComputedStyle().getPropertyValue('--bg')` and pushes it into `<meta name="theme-color">`. Called from `applyTheme()` alongside cache invalidation and radio-group sync.
- **Zero image files introduced** — still the project-long constraint. Every icon rasterizes from inline SVG.

### Patterns extracted → `company/skills/mobile/pwa-lite-install.md`

- **Lite-tier PWA = install-ready without offline** — a manifest + meta tags does 80% of what players want without the service-worker complexity or the stale-cache failure mode.
- **Two icons, two purposes** — `any` for launchers that don't mask, `maskable` with solid-background padding for Android.
- **`scope: "./"` pins the install to the game folder** — critical for multi-game repos where a root scope would capture every other URL.
- **`apple-mobile-web-app-capable: yes` is mandatory for iOS** — without it, iOS add-to-home-screen silently opens Safari instead of standalone.
- **`theme_color` in manifest is install-time only** — post-install changes require updating the `<meta name="theme-color">` at runtime via `applyTheme`.
- **Read `--bg` via `getComputedStyle` on every apply** — don't duplicate the palette in JS; CSS is the source of truth.
- **URL-encode SVG data URIs in JSON manifests; don't base64** — 33% smaller, human-readable, parseable by old JSON consumers.

### Wrap-up

| Sprint | Angle | Outcome |
|---|---|---|
| 18 | Distribution / identity | Manifest + install-ready metas + theme-responsive OS chrome, new mobile skill doc |

### Cost

- manifest.webmanifest: +30 lines (new file)
- index.html: +6 lines (link + 4 metas + apple-touch-icon)
- game.js: +13 lines (themeColorMeta + syncThemeColorMeta + applyTheme hookup)
- style.css: +0
- One new skill doc (`mobile/pwa-lite-install.md`)

### Next candidates

- **Service worker for offline play** — would complete the PWA story, but the 3 files are ~60KB total so the value-vs-complexity trade-off is debatable.
- **Ghost replay scrubber** — record `{t, outcome}` per pulse into best-run storage; overlay as a faded silhouette on the next run for the same seed.
- **Rarer / harder achievements** — "no-miss 30s", "5-day streak", "3 perfects in one heartbeat". Stat plumbing is already there.
- **First-run onboarding softness** — 3 tutorial pulses with a floating hint arrow for first-ever visitors.
- **Per-theme score-sweetener** — high-combo overtone layer (≥10), rarity keeps it fresh.
- **"Reset to system default" link** — small help-modal surface closing out Sprint 17's auto-mode discoverability.
- **Ambient density preference** — still open.

---

## Sprint 19 — Ghost run comparison on gameover (2026-04-17)

### Lens

**Score tells you how much better you got. The ghost tells you where.** The leaderboard from Sprint 12 and the run-history sparkline from Sprint 8 both live on the score axis; neither shows *pacing*. On a seeded run with a fixed pulse sequence, the same player can score 800 by hitting the early game cleanly and flaming out fast, or 800 by missing early then grinding to the late game — identical number, very different experiences. This sprint adds a two-strip timeline to the gameover overlay so the player sees both runs' outcomes spread across shared time, color-coded by hit/good/miss. Only appears on seeded modes; free-play has no peer to compare against.

### Changes

- **New `state.runEvents` array + `recordRunEvent(kind)`** — pushes `[t, 'p'|'g'|'m']` tuples from `judgeTap` for every scored pulse or miss (not swallowed early-taps). Early-returns in free-play (`GHOST_KEY === null`). Capped at 240 events to guard pathological long sessions.
- **New `GHOST_KEY` + `readGhost()` + `writeGhost()` helpers** — per-seed storage keyed parallel to `BEST_KEY` / `HISTORY_KEY` / `LEADERBOARD_KEY`. Defensive validator filters corrupted event tuples without dropping the whole run.
- **Ghost persist at gameover** — only when `state.score > prevBest` (strict). Snapshot of `state.runEvents` written alongside score, duration, and `Date.now()` for the "Xd ago" label.
- **Snapshot-before-write rule** — `readGhost()` is called BEFORE any potential `writeGhost()`, then rendered against. Without this, a new-best run would show two identical strips (current vs. itself).
- **`renderGhost(current, best)` into two SVG strips** with shared axis (max of the two durations). Dots at `cx = t / axisDur * innerW`, colored green/yellow/red by outcome semantic — hardcoded, not themed, because "perfect" means the same in every palette.
- **Hidden when:** free-play mode, or no stored ghost yet (first visit to a seed). The strip appears starting on the second seeded run.
- **New `<div id="ghost">` on the gameover overlay** — placed between `#history` (score sparkline) and `#leaderboard` (top-N), sliding into an existing rhythm.
- **New CSS** — `.ghost-strip`, `.ghost-row`, `.ghost-row-label`. Uses the same muted-label treatment as the existing history sparkline for visual coherence.

### Patterns extracted → `company/skills/ux/ghost-run-comparison.md`

- **`[t, kind]` tuples beat `{t, kind}` objects** — half the JSON bytes, still readable, parse-cheaper.
- **`null` GHOST_KEY as the free-play sentinel** — no separate "enabled" flag. Every guard becomes `if (GHOST_KEY === null) return;`.
- **Snapshot-before-write** — critical for any "show prior best alongside current" UI where the current run can itself become the prior best.
- **Shared x-axis from `Math.max(bestDur, currentDur)`** — keeps time alignment honest when one run ended early.
- **Semantic-colored dots, not themed** — gameplay outcomes are theme-independent by definition.
- **Defensive readGhost validator** — localStorage is a hostile input; whitelist kinds, filter corrupt tuples, reject malformed shapes.
- **Strict `>` for ghost write** — matches `writeBest` discipline; avoids tie-churn.

### Wrap-up

| Sprint | Angle | Outcome |
|---|---|---|
| 19 | Qualitative run comparison | Per-seed event timeline strips at gameover, hidden outside seeded modes, new ux skill doc |

### Cost

- game.js: +95 lines (const + state slot + recordRunEvent + readGhost/writeGhost + renderGhost + gameover hookup + start reset)
- index.html: +10 lines (ghost container with two SVG rows + labels)
- style.css: +34 lines (strip + row + label + track styles)
- One new skill doc (`ux/ghost-run-comparison.md`)

### Next candidates

- **Animated ghost dots** — fade in left-to-right when the gameover overlay appears, replaying the run's pacing. Uses `prefers-reduced-motion` to skip.
- **Tap-to-zoom strip** — tap on the strip to expand; shows timestamps, enables precise comparison of segments.
- **Per-segment comparison labels** — "early (0-30s): 2 misses vs. best 0" bite-sized deltas under the strip.
- **Service worker for offline play** — still the cleanest next distribution step.
- **Rarer / harder achievements** — "no-miss 30s", "5-day streak", "3 perfects in one heartbeat".
- **First-run onboarding softness** — a tutorial pulse for new visitors.
- **Per-theme score-sweetener** — high-combo audio overtone.

---

## Sprint 20 — First-visit onboarding hint (2026-04-17)

### Lens

**The start overlay is obvious on the 2nd run and opaque on the 1st.** Sprint 9 added the looping CSS demo (ring + pulse + "TAP!"), and Sprint 11 added the help modal behind `?`. Both help — but the first-run player still has to *recognize* the demo as a demo, and discover the help key. This sprint closes the final gap with a literal one-line hint ("New here? Tap at the moment the pulse meets the ring.") and a subtle pulse on the Start button. Shown only on the very first page load; after the first Start tap the flag is written and the treatment is never rendered again for that profile. Clearing the flag in devtools restores the first-visit treatment — correct behavior for a fresh profile.

### Changes

- **New `SEEN_KEY` + `readSeen()` + `writeSeen()` helpers** — single-bit localStorage (`'1'` sentinel), try/catch on both sides, returns `false` on read error (fail-safe toward re-showing the hint rather than silently suppressing).
- **Boot-time class decision** — `if (!readSeen()) overlay.classList.add('first-visit');` right after the streak-badge priming. One-line JS; CSS selectors do the rest.
- **Teardown at the commit moment** — inside `start()`, after the overlay is hidden: check `contains('first-visit')`, then `remove` + `writeSeen()` in a single guarded block. Ensures exactly one Storage API write per profile ever.
- **New `#firstVisitHint` element in the start overlay** — static HTML + `hidden` attribute by default, CSS-revealed via `.overlay.first-visit #firstVisitHint { display: block; }`.
- **New CSS rules** — `.first-visit-hint` base style (uses `var(--highlight)` so it theme-swaps), `.overlay.first-visit #start` pulse via `box-shadow` + `@keyframes firstVisitPulse`, reduced-motion fallback to a static ring of equivalent meaning.
- **No changes to gameplay, audio, or scoring paths** — pure chrome-layer addition.

### Patterns extracted → `company/skills/ux/first-visit-hint.md`

- **One-shot localStorage bit** — single-string `'1'` sentinel, cheapest possible payload. No versioning envelope.
- **Write on commit, not on view** — bounce visitors keep the hint for next session; only actual play dismisses it.
- **Parent-class CSS reveal** — `.first-visit` on the overlay propagates via selectors to every element that cares. Adding another first-visit-only element is a pure-CSS change.
- **Atomic reveal/teardown** — one `classList.add` / `.remove` pair. No risk of half-applied state.
- **Reduced-motion fallback as equivalent-meaning static pose** — not "no animation", but "static ring of the same color". Preserves the "look here" cue for users who opt out of motion.
- **Semantic token for theme-sensitive color + hardcoded value for decorative polish** — hint text uses `var(--highlight)`, text-shadow glow is fixed warm amber.
- **Fail-safe read returns `false`** — storage error → show the hint (mild redundancy) beats silent suppression of onboarding.

### Wrap-up

| Sprint | Angle | Outcome |
|---|---|---|
| 20 | First-run onboarding softness | One-shot hint banner + Start-button pulse, CSS-driven, new ux skill doc |

### Cost

- game.js: +19 lines (SEEN_KEY const + readSeen/writeSeen + boot class + start-teardown block)
- index.html: +1 line (`#firstVisitHint` paragraph with `hidden` default)
- style.css: +25 lines (`.first-visit-hint` + `.overlay.first-visit` scoped selectors + `@keyframes firstVisitPulse` + reduced-motion override)
- One new skill doc (`ux/first-visit-hint.md`)

### Next candidates

- **Service worker for offline play** — still open; would complete the PWA-lite → PWA journey.
- **Animated ghost dots** — fade in left-to-right when the gameover overlay appears, replaying run pacing. Gated on `prefers-reduced-motion`.
- **Tap-to-zoom ghost strip** — expand the strip on tap to show precise timestamps.
- **Rarer / harder achievements** — "no-miss 30s", "5-day streak", "3 perfects in one heartbeat".
- **Per-theme score-sweetener** — high-combo audio overtone.
- **Second-visit graduation** — on the second visit, show a *different* hint ("Try `?` for keyboard controls") that auto-expires after a few visits. A multi-step hint queue would need a different skill doc than this one-shot pattern.
- **Ambient-density preference** — a slider for the drift particle count on underpowered devices.

---

## Sprint 21 — Ghost-dot reveal animation (2026-04-17)

### Lens

**Sprint 19 gave us the data; Sprint 21 makes it a replay.** The two ghost strips currently appear fully-rendered the instant the gameover overlay opens — the player gets the information but has to scan left-to-right mentally to re-create the pacing. A staggered left-to-right reveal, with per-dot delay scaled by the dot's normalized timestamp, turns the static chart into a playback of the run's arc. The shared axis means the current-run strip's reveal stops early when the current run died early — "you didn't make it this far" becomes felt, not read. Gated on `prefers-reduced-motion`: motion-sensitive players see all dots at the end state instantly.

### Changes

- **New `GHOST_REVEAL_MS` constant (900ms)** — total window for the left-to-right stagger. Capped so long runs don't feel sluggish and short runs don't feel flicker-fast.
- **Inline `animation-delay` per dot** — `dot.setAttribute('style', 'animation-delay:' + delay + 'ms')`. Delay = `(t / duration) * 900ms`. Uses the normalized timestamp so shared-axis strips share reveal pacing.
- **New `@keyframes ghostDotIn`** — opacity 0 → 1 with a slight scale overshoot at 60% (`scale(1.25)`), easing to `scale(1)`. Reads as "arriving" not "fading".
- **New `@keyframes ghostTrackIn`** — baseline track fades in over 220ms, no delay. The track appears first, establishing "this is a timeline" before the dots populate it.
- **`transform-box: fill-box` + `transform-origin: center`** on `.gdot` — required for SVG elements so scale transforms pivot around each dot's center instead of the viewport's 0,0 origin.
- **Reduced-motion fallback** — `@media (prefers-reduced-motion: reduce) { .gdot, .gtrack { animation: none; } }`. Motion-sensitive users get the final state immediately. No motion workaround; outright skip.
- **No JS timing logic** — setTimeout / requestAnimationFrame would fight browser throttling, ignore the reduced-motion media query, and miss compositor optimizations. Pure CSS stagger.

### Patterns extracted → `company/skills/graphics/staggered-reveal.md`

- **Inline `animation-delay` per element** — continuous control by data value, no class-per-delay explosion.
- **Delay from normalized time, not element index** — clusters reveal as clusters; lulls reveal as lulls. Pacing is preserved.
- **Capped total reveal window** — 600–1200ms range; shorter feels like a flicker, longer tries players' patience.
- **Shared axis = shared pacing** — two normalized strips reveal at different visible rates based on their actual run lengths; the stagger itself narrates "this run stopped early".
- **Track reveals before dots** — mental model of "timeline" is set before the data lands.
- **Rebuild-on-render auto-replays animations** — no class-toggle dance needed; fresh DOM = fresh animation.
- **`transform-box: fill-box` is required for SVG scale transforms** — otherwise the scale looks like translation because origin defaults to viewport 0,0.
- **Reduced-motion override is outright `animation: none`** — don't try to provide a "gentler" motion; the user preference is "no motion".

### Wrap-up

| Sprint | Angle | Outcome |
|---|---|---|
| 21 | Data-replay presentation | Left-to-right staggered reveal on ghost strips, reduced-motion fallback, new graphics skill doc |

### Cost

- game.js: +10 lines (REVEAL_MS const + inline animation-delay on each dot)
- style.css: +27 lines (animation declaration + two @keyframes + reduced-motion gate + transform-box)
- One new skill doc (`graphics/staggered-reveal.md`)

### Next candidates

- **Tap-to-zoom ghost strip** — expand the strip on tap to show precise timestamps + per-segment deltas.
- **Service worker for offline play** — still open; completes the PWA-lite → PWA journey.
- **Rarer / harder achievements** — "no-miss 30s", "5-day streak", "3 perfects in one heartbeat".
- **Per-theme score-sweetener** — high-combo audio overtone.
- **Reveal animation on history sparkline too** — the same stagger pattern applies; would tie visual language across the gameover overlay.
- **Sound-design pulse synced to ghost reveal** — a soft tick per dot as it appears, gated on sound-enabled + reduced-motion.
- **Ambient-density preference** — a slider for drift particle count.

---

## Sprint 22 — Ghost-reveal audio chord (2026-04-17)

### Lens

**Sprint 21 made the ghost strip a visual replay; Sprint 22 gives it an audible peer.** A soft high-register tick per *perfect* in the player's own current run, each scheduled on the Web Audio clock with the same normalized delay as the visual pop, produces an audiovisual chord on gameover. The player hears their perfects as a little trill as they fade into view — a small dopamine hit layered on the chart they already had. Gated on `prefers-reduced-motion`: if the visual stagger is skipped, the audio is skipped too, because ticks over an already-rendered chart would be confusing.

### Changes

- **New `Sfx.ghostTick(delaySec)` method** — schedules a sine tone at `ctx.currentTime + delay`, envelope `0.04 vol` → `0.001` over 60ms, freq 1800Hz. Pre-scheduling means the audio rides the sample-accurate audio clock, not the main thread's setTimeout queue that drifts under load.
- **`renderGhost` schedules one tick per perfect** — filtered on `e[1] === 'p'` (goods and misses are already audible in-play; this layer celebrates the peaks). Uses the same `(t / axisDur) * 900ms` normalization as the visual delay — guaranteed lockstep with the Sprint 21 animation.
- **Current-run strip only, not best** — ticking both would double-up. The current run is the player's own achievement; that's what the audio celebrates.
- **Gate on `!reducedMotion && Sfx.ctx && currentRun.events`** — motion-sensitive users skip both visual and audio; missing audio context is tolerated (pre-first-interaction); missing events is safe.
- **No mute-state check** — the master-bus gain already silences when `state.muted`, so the ticks generate silent nodes (cheap, GC'd on `.stop()`). Keeps gating to a single source of truth.
- **Sparse, textural envelope** — 0.04 vol + 60ms + 1800Hz sine keeps the ticks from stepping on the gameover thud while sitting above the ambient drift texture.

### Patterns extracted → `company/skills/audio/web-audio-scheduling.md`

- **`ctx.currentTime + delay` vs. setTimeout** — Web Audio clock is sample-accurate and independent of main-thread throttling; setTimeout drifts under load and fights tab-throttling. Critical for tight rhythmic audio.
- **Pre-schedule the whole sequence synchronously** — one burst of `.start()` calls; playback becomes clock-driven and unaffected by subsequent main-thread activity.
- **Gate visual-synced audio on `prefers-reduced-motion`** — the audio layer inherits the visual's timing contract; if visual is skipped, audio should be too.
- **Don't gate on mute-state in per-event schedulers** — the master gain is the single source of truth for muting; duplicating the check duplicates potential bugs.
- **Sparse over dense audio reveals** — pick a semantic subset (perfects only) rather than ticking every event. Density creates wash; sparseness creates melody.
- **Fire-and-forget is fine for one-shot sequences** — no cancellation plumbing needed; let overlapping runs coexist briefly.
- **Short, quiet envelopes + high register** — audio textures that layer with gameplay SFX without competing. Reserve louder/lower for in-play events.

### Wrap-up

| Sprint | Angle | Outcome |
|---|---|---|
| 22 | Audiovisual chord on gameover | Per-perfect audio tick scheduled via Web Audio clock in sync with Sprint 21 visual reveal, reduced-motion gated, new audio skill doc |

### Cost

- game.js: +32 lines (Sfx.ghostTick method + per-perfect schedule loop in renderGhost)
- style.css: 0 (pure audio layer)
- One new skill doc (`audio/web-audio-scheduling.md`)

### Next candidates

- **Tap-to-zoom ghost strip** — expand for precise timestamps, still open.
- **Service worker for offline play** — still open.
- **Sound-design pulse on track fade-in** — a single soft "ready" sustain when the baseline track appears (before the ticks). Would bookend the audio reveal.
- **Rarer / harder achievements** — "no-miss 30s", "5-day streak", "3 perfects in one heartbeat".
- **Per-theme score-sweetener** — high-combo audio overtone.
- **Ghost strip at mid-run** — a tiny always-on preview in the corner during play?
- **Ambient-density preference** — a slider for drift particle count.

---

## Sprint 23 — Rare achievement tier (2026-04-17)

### Lens

**The base 6 achievements were all earnable in the first week; returning players had nothing left to chase.** This sprint adds 5 rare-tier entries, each targeting a distinct play axis so no single "good run" sweeps them all:

- **Combo 100** — skill-ceiling (peakCombo)
- **2500 Points** — endurance (score)
- **Week Zealot** — retention (7-day streak)
- **Perfect Purity** — precision (20+ perfects with zero goods)
- **Flawless 60** — flawlessness (60s run with zero misses)

Deliberately along five different axes: a combo-grinder, a marathon runner, a daily ritualist, a precision tapper, and a zen cruiser don't share a single "gold-star" run. The ladder rewards *breadth* over raw score.

### Changes

- **5 new `ACHIEVEMENTS` entries** — appended to the base array (order matters only for display, since tests are pure functions). Labels and descriptions kept terse to fit the 3-column grid.
- **New `state.missCount` field** — tracked alongside `perfectCount` / `hitCount`. Incremented inside `loseLife()` so *both* miss paths (tap-miss + pulse-expire-miss) feed the same counter. Reset to 0 in `start()`.
- **`missCount` + `duration` now in achievement context** — pure additive extension: existing tests ignore the new fields, new tests read them. No schema migration needed.
- **Updated HTML placeholder** — `0 / 6` → `0 / 11` for the first-paint moment before `renderAchievements` overwrites it.
- **Refactor note**: moved `state.missCount += 1` from `judgeTap` into `loseLife()` — single source of truth. A future fourth path that calls `loseLife()` will automatically increment.

### Patterns extracted → `company/skills/ux/streak-and-achievements.md` (extended section)

- **Axis-diversity rule** — new achievements should hit a play style the existing ladder under-covers. One more "score X" when you have "score 500/1000" is just ceiling-raising.
- **Additive context fields** — pass a whole object to the test; tests read what they need, ignore the rest. Adding a field never breaks existing tests.
- **Pure-function tests** — no state peeks, no async, no Date.now(). Composable (`&&`), testable, order-independent.
- **Centralize the miss counter in `loseLife()`** — two call sites becomes zero manual increments at call sites.
- **Reset all new state in `start()`** — every new field needs a reset line; forgetting this is the #1 source of "achievement unlocked when it shouldn't".
- **Update the static HTML placeholder** — small thing, easy to miss; first-paint flash of wrong count.
- **Don't extend the ladder when global unlock rate on the easy tier is still low** — rare tier oppresses a struggling player. Fix the bottom before adding a top.

### Wrap-up

| Sprint | Angle | Outcome |
|---|---|---|
| 23 | Content / retention ladder | 5 rare achievements across diverse play axes, new miss tracking, extended streak-and-achievements skill doc |

### Cost

- game.js: +13 lines (5 ACHIEVEMENTS entries + missCount field/reset + centralized increment)
- index.html: 1 char changed (placeholder count)
- style.css: 0 (grid auto-scales)
- Extended `ux/streak-and-achievements.md` with a new "Extending the ladder" section

### Next candidates

- **Tap-to-zoom ghost strip** — still open.
- **Service worker for offline play** — still open.
- **Per-theme score-sweetener** — high-combo audio overtone.
- **Achievement unlock toast during gameplay** — currently deferred to gameover; a mid-run flash for the rare-tier unlocks could be exciting (gated on non-combo-break moments).
- **Stats page** — lifetime perfect count, miss count, longest streak, total plays. New gameover sub-overlay.
- **Challenge achievements** — "Beat the ghost by 500 points" — dynamic, seed-aware, re-earnable weekly.
- **Ambient-density preference** — a slider for drift particle count.

---

## Sprint 24 — Per-theme score sweetener (2026-04-17)

### Lens

**Sprint 16 gave themes an audible signature on the *punish* side (miss/gameover accents); Sprint 24 gives them a signature on the *peak* side.** At combo milestones of ×3 multiplier or higher (combo ≥ 20), a theme-conditional overtone layers on top of the base levelup cascade. Void stays as-is — its synth minimalism is preserved, and the *absence* of sweetener becomes its signature. Sunset gets a bright high-register bell shimmer (C7+E7 sine sustains); forest gets a deep warm fifth (G3+D4 triangle with pitch slide). Additive, not replacive — the base cascade still plays, and the sweetener is a halo.

### Changes

- **New `Sfx.themeSweeten()` method** — reads `currentTheme` at call-time, early-returns on void, plays two-note sustain per theme via the existing `_env` helper.
- **Milestone trigger gated on `comboMult() >= 3`** — fires only when the player has climbed to 3x tier (combo ≥ 20), not on every ×1.5/×2/×2.5 step. Keeps the sweetener rare and rewarding.
- **Fires *after* `Sfx.levelup()`** — base cascade's attack establishes the celebration moment, sweetener sustains underneath (40–70ms delays on the second note of each theme).
- **No new state, no HUD changes, no CSS** — pure audio layer.
- **Sunset sweetener spec**: sine C7 (2093Hz) 0.45s @ 0.08 vol, then sine E7 (2637Hz) 0.38s @ 0.06 vol after 40ms.
- **Forest sweetener spec**: triangle G3 (196Hz) sliding to D3 (147Hz) 0.55s @ 0.10 vol, then triangle D4 (294Hz) sliding to A3 (220Hz) 0.40s @ 0.07 vol after 70ms.

### Patterns extracted → `company/skills/audio/theme-conditional-sfx.md` (extended section)

- **Peak-tier gating by multiplier tier** — sparse firing preserves the "peak moment" read. Cap tier and above earn the sweetener; climbing tiers don't.
- **Void-is-no-op for peak moments too** — the absence becomes void's signature; a "neutral" sweetener for void adds mental bandwidth without feel.
- **Theme picks its register** — sunset owns high/bright, forest owns low/warm, void owns mid. Sweetener lives where the theme has room, not where the base cascade already is.
- **Longer sustain for halo, shorter attack for punctuation** — same `_env` helper, different envelope discipline per role (punch vs. sustain).
- **Volume math against base layer** — sweetener at 0.06–0.10 vs. cascade peak at 0.17 → ~50% ratio: audible texture, not competing lead.
- **Read `currentTheme` at call-time** — mid-run theme swaps take effect on the next milestone (same as Sprint 16's punish accents).

### Wrap-up

| Sprint | Angle | Outcome |
|---|---|---|
| 24 | Audio theme-signature on peaks | `themeSweeten()` overtone at ≥3x combo tier, extended theme-conditional-sfx skill doc |

### Cost

- game.js: +27 lines (themeSweeten method + single milestone-hook line)
- style.css / index.html: 0
- Extended `audio/theme-conditional-sfx.md` with "Peak-tier sweetener" section

### Next candidates

- **Tap-to-zoom ghost strip** — still open.
- **Service worker for offline play** — still open.
- **Achievement unlock toast during gameplay** — mid-run chip flash for rare-tier unlocks.
- **Stats page** — lifetime perfect count, miss count, longest streak.
- **Per-theme heartbeat variant** — the current heartbeat ping could also go through a theme-conditional layer.
- **Sweetener pulse on achievement unlock** — when an achievement fires, hint the theme signature as part of the cue.
- **Ambient-density preference** — slider for drift particle count.

---

## Sprint 25 — Juice / mid-run reward (2026-04-17)

### Lens

Mid-run feedback loop. Achievements currently reveal only on the gameover stats screen — the player earns them, then finds out 30+ seconds later. For common-tier milestones (combo-25, combo-50) this is fine: the combo meter and score already telegraph the moment. But for *rare-tier* unlocks — score-2500, combo-100, perfect-purity, flawless-60 — the "I just earned that!" signal is delayed so long that the dopamine spike misses the moment. This sprint adds a mid-run toast for rare-tier unlocks only, preserving the gameover summary for the full ladder.

### Changes

- **`midRun: true` flag** on the 4 rare-tier entries in `ACHIEVEMENTS` (`score-2500`, `combo-100`, `perfect-purity`, `flawless-60`). Common-tier entries stay unflagged and reveal only at gameover as before.
- **`evaluateMidRunAchievements(ctx)`** in game.js: filters on the flag, reads localStorage, tests each, writes immediately on unlock (banks credit even if the player dies the next tap), returns just-unlocked entries. Cheap enough to call every frame (4 integer comparisons).
- **Frame-loop hook** in `update(dt)` after the particle/ambient update, gated off `state.deathCam`. The loop is the only path that reliably catches time-based unlocks like `flawless-60` (fires at t=60 with no tap event).
- **Toast queue machinery** — `toastQueue[]` + `toastShowing` flag + `showAchievementToast(ach)` entry point + `_drainToastQueue()` worker. Serial presentation: each toast holds for 2.2s then slides out over 220ms before the next drains. Handles the rare case of two simultaneous unlocks on the same frame.
- **`#achievementToast` DOM element** in index.html: top-center positioned, badge + "Achievement" headline + label. Hidden by default, `role="status"` + `aria-live="polite"` for screen readers.
- **`.ach-toast` CSS** — slide-from-above transform (`translateY(-18px) → 0`), 220ms transition, opacity fade, reduced-motion fallback (opacity-only, no translate). Mobile-responsive padding.
- **`Sfx.achievementToast()`** — softer single-note variant of the full `achievement()` cascade. Plays only the middle note (1175Hz triangle, 0.14s, 0.11 vol) so mid-run it reads as "bonus!" not "ceremony". Full cascade stays reserved for the gameover context where it plays alone.
- **Haptic cue** — `haptic([12, 22, 40])` tri-pulse; distinct rhythm from the score/miss haptics so it's tactilely recognizable.

### Patterns extracted → `company/skills/ux/mid-run-toast.md` (new)

- **`midRun: true` flag on entry** — single source of truth; flag decides whether the toast fires, evaluation stays centralized.
- **Frame-loop evaluation** — 4 integer comparisons at 60Hz is free, catches time-based unlocks that event-hooks can't reach, avoids hook proliferation.
- **Bank on unlock, not at gameover** — writes localStorage the instant the test passes; credit is safe even if the next input crashes the run. Breaking the "you earned it" promise is worse than never showing the toast.
- **Serial toast queue** — one DOM element, content-swap per toast, 2.2s hold + 220ms transition, `void el.offsetWidth` reflow trick to re-trigger the transition on back-to-back unlocks.
- **Soft SFX variant for mid-run context** — the full ceremony cascade competes with ongoing gameplay audio; a single middle note at 80% volume reads as related-but-lighter.
- **Top-center slide, not corner** — corners are claimed by mute/help; center reads as "announcement"; transform animation only (GPU-composited) with reduced-motion fallback to opacity-only.

### Wrap-up

| Sprint | Angle | Outcome |
|---|---|---|
| 25 | Juice / mid-run reward | Rare-tier achievement toast during play, queue-serialized, bank-on-unlock; 71-line skill doc |

### Cost

- game.js: +19 lines (Sfx.achievementToast method + frame-loop hook + achToastEl lookup)
- index.html: +7 lines (toast element)
- style.css: +64 lines (.ach-toast + children + reduced-motion + mobile)
- New `ux/mid-run-toast.md` (~115 lines); README index updated

### Next candidates

- **Tap-to-zoom ghost strip** — still open.
- **Service worker for offline play** — still open.
- **Stats page** — lifetime perfect count, miss count, longest streak.
- **Per-theme heartbeat variant** — heartbeat ping through theme-conditional layer.
- **Sweetener pulse on achievement unlock** — hint theme signature as part of the unlock cue.
- **Ambient-density preference** — slider for drift particle count.
- **Social proof counter** — "N people played today" tiny HUD line (needs backend; out of scope for local-only build).
- **Keyboard-only tutorial mode** — discover keyboard controls without launching the help modal.
- **Replay-my-best** — stash the best run's event log and offer a one-shot replay on the start screen.

---

## Sprint 26 — Data lens / lifetime progression (2026-04-17)

### Lens

Long-arc retention. Every existing UI surface is per-run: gameover shows *this run's* peak combo, the sparkline shows the *last 8 runs*, achievements are gating flags, the per-seed leaderboard is current-day. No surface answers "how invested am I in this game overall?" or "have I improved over weeks?" — the kind of data that makes a returning player feel like their time is accumulating into something.

This sprint adds a **lifetime stats panel** — a cross-mode, cross-theme aggregate view that grows every session. It's deliberately not a leaderboard (that's the per-seed table) and not an achievement grid (that's the binary ladder). It's the *boring totals* — runs played, total time, lifetime perfects, accuracy rate — that casual players surprisingly love because they make effort visible.

### Changes

- **`LIFETIME_KEY = 'void-pulse-lifetime'`** — single JSON blob. Fields: `runs`, `totalScore`, `totalPerfects`, `totalHits`, `totalMisses`, `totalSeconds`, `peakComboEver`, `bestScoreEver`, `bestPerTheme: { void, sunset, forest }`, `firstPlayedAt`, `lastPlayedAt`.
- **`readLifetime()` / `writeLifetime()`** — default-fill reader that merges stored keys over `lifetimeDefaults()`, so adding a field later is forward-compatible without migrations. Numeric coerce + negative clamp + nested-object merge protect against tampered data.
- **`bumpLifetime(run)`** — called once per gameover with the run payload. Increments counters, maxes the peak fields, sets `firstPlayedAt` if unset, always updates `lastPlayedAt`. Pure function of its input (theme passed in, not read from outer scope).
- **Gate on "real run"** — skip bumps for score=0 AND duration<3s. Accidental reloads don't pollute counters.
- **Stats panel overlay** — `#statsPanel` with a `.stats-card` matching help-modal styling (backdrop-blur, gradient bg, border, centered). Grid of rows: volume → peaks → averages → totals → rates → segments (per-theme bests) → timestamps.
- **"Lifetime stats →" button** on start overlay (between keyboard hints and daily link).
- **Keyboard `S`** toggles the stats panel; Esc closes it.
- **Two-step reset** — first click arms (`Tap again to confirm`, pulse animation), second within 4s fires, otherwise auto-disarms.
- **Empty state** — first-time opener sees "No runs yet. Play one to start tracking." over a faded grid (35% opacity) so the shape is visible but not populated.
- **Rate derivation** — perfect rate / accuracy computed at render time from totals (never stored as a rate). `—` dash fallback for zero denominators.
- **`formatDuration` three-tier** — `3h 15m` / `15m 22s` / `22s` — elides smaller unit at higher tiers.

### Patterns extracted → `company/skills/ux/lifetime-stats.md` (new)

- **Single JSON blob with default-fill reads** — atomic, forward-compatible, no migration code.
- **One bump per gameover** — never mid-run, never per-event; single commit point prevents double-count.
- **Gate on "real run"** — min-score-or-duration prevents reload pollution.
- **Derived rates, not stored rates** — perfect/accuracy computed from counts; impossible states prevented by construction.
- **Empty state with actionable message + faded shape** — not a wall of zeros, not a blank panel.
- **Two-step reset with auto-disarm** — armed state visible via class, 4s timeout prevents stuck-armed sessions.
- **Per-theme nested object** — new themes zero-fill via default merge, no code change to support.
- **Group rows by psych axis** — volume / peak / avg / totals / rates / segments / timestamps.
- **Open/close parity with help modal** — same .hidden/.visible pattern, same auto-pause, same bus-duck.

### Wrap-up

| Sprint | Angle | Outcome |
|---|---|---|
| 26 | Data / lifetime progression | Cross-mode aggregate stats panel, two-step reset, empty state, S hotkey; new skill doc (~220 lines) |

### Cost

- game.js: +178 lines (lifetime reader/writer/bump/reset + formatters + render + open/close + reset wiring + keydown binds)
- index.html: +31 lines (stats panel overlay + start-screen entry button + S kbhint)
- style.css: +155 lines (.stats-overlay + .stats-card + .stat-row + .stat-theme-* + reset button + armed animation + mobile)
- New `ux/lifetime-stats.md` (~220 lines); README index updated

### Next candidates

- **Tap-to-zoom ghost strip** — still open.
- **Service worker for offline play** — still open.
- **Per-theme heartbeat variant** — heartbeat ping through theme-conditional layer.
- **Sweetener pulse on achievement unlock** — hint theme signature as part of the unlock cue.
- **Ambient-density preference** — slider for drift particle count.
- **Stats-panel sparkline** — overlay the last-N run scores as a mini sparkline inside the stats card, separate from the gameover sparkline.
- **Accessibility sprint** — focus-ring visibility audit, high-contrast mode, keyboard-only flow from first tap to stats reset.
- **Distribution sprint** — Open Graph image, Twitter card meta, dynamic per-seed title for shareable preview cards.
- **Performance sprint** — battery/heat on long sessions, audio-context close on mute+hidden, ambient-drift cap on mobile.
- **Milestone reveal** — add a "next milestone" line to the stats panel (e.g., "50 runs ▾ 14 to go").
- **Stats export** — JSON copy-to-clipboard button for players who care to archive their numbers.

---

## Sprint 27 — Accessibility lens / screen-reader discipline + contrast (2026-04-17)

### Lens

Accessibility. Auditing the current HTML surfaced a silent-majority bug: `<div id="hud" aria-live="polite">` meant every single score update (2–10 per second during active play) was being queued into screen readers, producing an unusable machine-gun of numbers. A screen-reader user can't see the HUD; what they were hearing was a completely different (and broken) game. This sprint fixes the announcement discipline and adds a `prefers-contrast: more` pass for low-vision users.

### Changes

- **Silenced the HUD** — `#score` and `#comboWrap` got `aria-hidden="true"`; `#lives` kept its semantic meaning via `aria-label="Lives remaining"`. Removed the HUD-wide `aria-live="polite"`.
- **Added `#srAnnounce`** — a single `sr-only` visually-hidden `<div role="status" aria-live="polite" aria-atomic="true">` positioned adjacent to the HUD.
- **`announce(msg)` helper** with the empty-first / setTimeout(0) re-read trick and in-frame coalesce via `_srPending`.
- **`announceMilestoneTier(mult)`** — tier-change gating (1 → 1.5 → 2 → 2.5 → 3 → 3.5 → 4). Fires only on integer/half-integer transitions, not every ×5 combo step. Reset to 1 on `loseLife()`.
- **Life-lost announcement** — `"2 lives left"` / `"1 life left"`; gameover is handled separately.
- **Gameover composed line** — single announce call composes (NEW BEST? + streak bump? + score + peak combo) as one reader utterance. Priority-ordered so an interrupted read still delivers the headline.
- **Start announcement** — `"Run started. 3 lives."` at the top of `start()`.
- **Achievement toast re-routed** — removed the toast's own `role="status"` / `aria-live`; added `announce('Achievement unlocked: ' + label)` to the toast queue path. Single live region, consistent prefix.
- **`.sr-only` utility class** — standard WCAG `clip: rect(0,0,0,0)` visually-hidden pattern.
- **`@media (prefers-contrast: more)`** — pumps border colors from ~.14 opacity to full `var(--fg)`, forces `.kbhint / .seed-subtitle / .stat-k` opacity to 1, adds 2px outline on selected theme swatch, adds 1-2px black text-shadow to canvas-overlaid HUD numbers.

### Patterns extracted → `company/skills/ux/screen-reader-announcements.md` (new)

- **Silence the HUD, add one announcer** — single live region is predictable; multiple regions have inconsistent queue semantics across AT.
- **Announce moments, not state** — `aria-live` on fast-updating numbers is always a bug; cue only transitions.
- **Tier-change gating, not every-N gating** — fire at integer-multiplier transitions, reset on combo break.
- **Compose gameover as a single line** — highest-salience first; periods for reader pauses; one `announce()` call.
- **Empty-first textContent trick** — forces re-read of identical strings across AT de-duplication.
- **Re-route secondary live regions through central announcer** — prefix context, single queue, avoids dialog-focus suppression edge cases.
- **`prefers-contrast: more` as secondary pass** — pump borders and opacity, don't rewrite palette; add text-shadow for canvas-overlaid text.
- **`sr-only` via clip:rect** — canonical visually-hidden; avoids `display:none` (hides from AT) and `visibility:hidden` (same).

### Wrap-up

| Sprint | Angle | Outcome |
|---|---|---|
| 27 | Accessibility / SR discipline | HUD silenced, single polite announcer with tier-change gating; contrast-preference pass; new skill doc (~180 lines) |

### Cost

- game.js: +55 lines (announcer helper + tier gate + hooks at milestone/loseLife/gameover/start/toast)
- index.html: +2 lines (live region), -1 aria-live from HUD, -1 from toast
- style.css: +51 lines (.sr-only + prefers-contrast block)
- New `ux/screen-reader-announcements.md` (~190 lines); README index updated

### Next candidates

- **Tap-to-zoom ghost strip** — still open.
- **Service worker for offline play** — still open.
- **Per-theme heartbeat variant** — heartbeat ping through theme-conditional layer.
- **Sweetener pulse on achievement unlock** — hint theme signature as part of the unlock cue.
- **Ambient-density preference** — slider for drift particle count.
- **Focus-visible outline audit** — some buttons (daily-link, theme-swatch) may have invisible focus rings; sprint-28 candidate.
- **Keyboard-only flow audit** — can a keyboard-only user navigate from cold-load → play → gameover → retry → stats → reset without a mouse?
- **Distribution sprint** — Open Graph image, Twitter card meta, dynamic per-seed title.
- **Performance sprint** — close AudioContext when hidden+muted, adaptive ambient-drift cap on mobile.
- **Stats-panel sparkline** — overlay the last-N run scores inside the stats card.
- **Localization pass** — externalize UI strings for future translations.

---

## Sprint 28 — Performance / power lens / runtime lifecycle (2026-04-17)

### Lens

Runtime power. Void-pulse's `requestAnimationFrame` loop and its `AudioContext` both run as long as the tab is open — even when the tab is hidden, even when the user has muted. On desktop that's nearly free; on mobile it's the shape of "why did my battery die" complaints. Browsers throttle hidden-tab `rAF` to ~1Hz but the callback still executes the full draw path (clear, starfield, ambient, particles, pulses, overlay). A muted `AudioContext` with gain=0 still samples its graph. These are both invisible background taxes. This sprint adds three cheap knobs that fix the bulk of it.

### Changes

- **`POWER_SAVE` detection at boot** — reads `navigator.connection.saveData` OR `prefers-reduced-data: reduce`; either triggers. Single const, no polling.
- **`AMBIENT_CAP = POWER_SAVE ? 10 : 20`** — halves the persistent drift particle pool (ember / petal) under power-save. Keeps theme identity intact; doesn't erase.
- **`Sfx._suspend()` / `Sfx._resume()`** — promise-returning `ctx.suspend()` / `ctx.resume()` with `.catch(() => {})` guards for iOS transition-state edge cases. `_resume()` re-checks `state.muted` so a visibility-return doesn't override a deliberate mute.
- **`Sfx.applyMute()` wired to suspend/resume** — muting releases the audio hardware claim; unmuting re-acquires it. Complements the existing gain-zero ramp (both happen together for smooth + cheap).
- **`visibilitychange` handler suspends audio on hidden, resumes on visible** — released hardware claim during backgrounded tabs. Kept separate from the existing `pauseGame()` call (visibility is a separate axis from player-initiated pause).
- **`frame()` early-return when `document.hidden`** — sets `lastTime = now` to prevent dt-accumulation on return, re-requests `rAF` to keep the chain live so the loop resumes instantly on visible. Skips the clear+starfield+ambient+particles+pulses+overlay draw path entirely.
- **Did NOT suspend on `pauseGame()`** — the pause overlay already ducks the master bus to 35% with a smooth 0.4s ramp; suspending would make resume audibly pop and would drop the 3-2-1 countdown's pre-scheduled ticks.

### Patterns extracted → `company/skills/graphics/power-lifecycle.md` (new)

- **Render-skip when `document.hidden`** — throttled `rAF` still runs your draw code; early-return with `lastTime` reset and `rAF` re-chain cuts background CPU to near-zero.
- **Suspend AudioContext on mute AND on visibility hidden** — gain-zero still samples the graph; `suspend()` releases the hardware claim. Two triggers, one release path.
- **Promise-returning `suspend/resume` with empty catch** — iOS rejects during certain state transitions; silent catch means worst case is "optimization didn't apply," not a crash.
- **Respect user's mute intent on resume** — re-check `state.muted` in `_resume()` so visibility-return doesn't undo a deliberate mute.
- **`prefers-reduced-data` + `navigator.connection.saveData` as power-save hint** — two signals, either triggers; read once at boot.
- **Halve, don't erase** — ambient particles halved under power-save; theme identity preserved. Zeroing would remove the character users paid for in attention.
- **DON'T suspend on pause overlay** — duck bus (smooth 0.4s ramp) ≠ suspend (hardware release). Conflating them loses the smooth-ramp UX and drops pre-scheduled 3-2-1 ticks.
- **Lifecycle audit table** — Start/Active/Pause/Hidden/Mute/Gameover × running/paused/hidden/update-fires/render-fires/audio-state. Three invariants derived: `audio running ⇔ (not muted AND tab visible)`; `render fires ⇔ (tab visible AND state.running)`; `update fires ⇔ (state.running AND !paused AND tab visible)`.

### Wrap-up

| Sprint | Angle | Outcome |
|---|---|---|
| 28 | Performance / power / lifecycle | AudioContext suspend on mute+hidden, rAF render-skip when hidden, power-save ambient halving; new skill doc (~135 lines) |

### Cost

- game.js: +35 lines (Sfx._suspend/_resume, applyMute wiring, visibilitychange suspend/resume, frame() hidden early-return, POWER_SAVE const, AMBIENT_CAP branch)
- index.html: 0
- style.css: 0
- New `graphics/power-lifecycle.md` (~135 lines); README index updated

### Next candidates

- **Tap-to-zoom ghost strip** — still open.
- **Service worker for offline play** — still open.
- **Per-theme heartbeat variant** — heartbeat ping through theme-conditional layer.
- **Sweetener pulse on achievement unlock** — hint theme signature as part of the unlock cue.
- **Ambient-density preference slider** — user control over drift particle count.
- **Distribution sprint** — Open Graph image, Twitter card meta, dynamic per-seed title for shareable preview cards.
- **Focus-visible outline audit** — some buttons may have invisible focus rings under certain themes.
- **Keyboard-only flow audit** — cold-load → play → gameover → retry → stats → reset without a mouse.
- **Localization pass** — externalize UI strings for future translations.
- **Stats-panel sparkline** — overlay the last-N run scores inside the stats card.
- **Milestone reveal** — add a "next milestone" line (e.g., "50 runs ▾ 14 to go") to stats.
- **Stats export** — JSON copy-to-clipboard button for players who care to archive their numbers.

---

## Credits

| Role | Agent | Model |
|------|-------|-------|
| Producer | `@producer` | claude-sonnet-4-6 |
| Game Designer | `@game-designer` | claude-opus (Opus) |
| Lead Developer | `@lead-developer` | claude-sonnet-4-6 |
| Artist | `@artist` | claude-haiku (Haiku) |
| Sound Designer | `@sound-designer` | claude-haiku (Haiku) |
| QA Tester | `@qa-tester` | claude-haiku (Haiku) |
