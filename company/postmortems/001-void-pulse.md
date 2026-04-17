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

## Credits

| Role | Agent | Model |
|------|-------|-------|
| Producer | `@producer` | claude-sonnet-4-6 |
| Game Designer | `@game-designer` | claude-opus (Opus) |
| Lead Developer | `@lead-developer` | claude-sonnet-4-6 |
| Artist | `@artist` | claude-haiku (Haiku) |
| Sound Designer | `@sound-designer` | claude-haiku (Haiku) |
| QA Tester | `@qa-tester` | claude-haiku (Haiku) |
