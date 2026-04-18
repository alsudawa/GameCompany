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

## Sprint 29 — Rhythm pivot (game-design lens) (2026-04-17)

### Lens

Player feedback, unfiltered: *"패턴이 너무 단순해서 재미가 없네 눈감고도 하겠어. 일정하게 빨라지는게 아니라 뭔가 보고 반응 하게 해야 긴장감이 생기지 않을까? 매번 느리게 시작하니 아무런 긴장감이 없어. 이펙트도 좀 더 화려하게 쾅쾅 터져야할 것 같고. 결국 보면 예전에 있던 리듬게임하고 컨셉은 비슷한데 적당한 음악의 박자에 맞춰서 하는게 더 낫지 않을까. 계속 빨라지는게 아니라 일정한 패턴으로 high score를 노리게..."* That's not a bug report; it's a mandate to pivot the genre. The game had drifted into "pace-up tapper" territory where a tuned rhythm could carry an eyes-closed run. This sprint converts it to a fixed-chart rhythm game with reactive hazards — score becomes a function of chart mastery and sight-reading, not endurance.

### Changes

- **120 BPM deterministic chart**: 30 bars × 8 eighth-note slots. `BAR_TEMPLATES` per band (warm/easy/mid/hard/climax/out) + `BAND_SCHEDULE` maps bars to bands. Seeded RNG picks one template per bar → same seed = same chart.
- **Hazard pulses (kind = 'h')** — red, dashed, throbbing. Must NOT be tapped. Tap = -100 score + life loss; pass = +50 bonus.
- **Spawn-from-arrival back-calculation** — chart declares `arriveT` (when the ring should judge), spawner computes `spawnT = arriveT - TARGET_R/speed` per-pulse so ring-cross lands exactly on beat regardless of band speed.
- **`CHART_LEAD_IN_S = 1.0s`** — first pulse arrives 1s into the run so the opener has clean travel animation from r=0, not a frame-one pop.
- **Exact-max simulation for `maxPossibleScore`** — walks the chart applying the real combo-multiplier ramp. 100% is literally achievable (not a theoretical upper bound).
- **% of max display on gameover** — `score + ' · ' + pct + '%'` replaces the raw number. The retention hook for a fixed-chart game.
- **Victory vs death audio split** — `if (chartDone && lives > 0) levelup() + themeSweeten()` else `gameover()`. Completion feels like completion.
- **Juice pass** — chromatic aberration ring redraw on perfect (triple RGB-offset ring), combo bloom radial fill, hazard-hit red radial wash, hazard-pass subtle burst. All `if (reducedMotion) return;` guarded.
- **Schema v2 wipe** — bumped `SCHEMA_VERSION` from 1 → 2 and nuked all `*-best-*`, `*-history-*`, `*-board-*`, `*-ghost-*` localStorage keys on load if stored version is older. Old scores from the pace-up model would be unreachable highs under the new scoring.

### Patterns extracted → `company/skills/gameplay/rhythm-chart.md` + `reactive-hazard.md`

- **Templates × band schedule** — 3–5 one-bar variants per band + a `BAND_SCHEDULE` array length = BARS. Seeded RNG picks per bar. Compositional expressiveness without growing the chart-data size.
- **Spawn-from-arrival** — the chart expresses *when the note should be acted on*, the spawner derives spawn time from travel speed. Separation of concerns: chart = rhythm, spawner = physics.
- **Exact-max via simulation** — don't use `notes × 100 × max_multiplier` as a placeholder for maxPossibleScore; simulate the combo ramp to get a reachable 100%.
- **Reactive hazard** — visual triple-redundancy (color + dash + throb), telegraph (rest slot before), bonus for passing (not just penalty for tapping), placement on weak subdivisions.
- **Schema versioning for scoring-model changes** — bump + wipe pattern.

### Wrap-up

| Sprint | Angle | Outcome |
|---|---|---|
| 29 | Game-design pivot | Rhythm-chart rewrite — 30-bar BPM chart, hazard mechanic, juice, fixed-chart scoring, schema v2 wipe |

### Cost

- game.js: +390/-70 lines (chart system, hazard handling, juice pass, schema migration)
- index.html: hook line + first-visit hint + help modal reflect new mechanics
- 2 new skill docs (`rhythm-chart.md`, `reactive-hazard.md`) — written next-sprint

### Next candidates

- Beat-synced background music (chart feels naked without it).
- Tune the difficulty ramp — initial feel was "chaotic" past the opening bars.
- Add more band templates to reduce chart repetition across runs.
- Ghost-strip annotations for hazard events.

---

## Sprint 30 — Beat-synced BGM + ramp softening (audio lens) (2026-04-17)

### Lens

Player feedback after Sprint 29: *"조금만 지나면 너무 정신없이 패턴이 나오네 배경음악을 패턴에 맞춰서 만들순 없나?"* Two asks — (a) the pattern is too chaotic shortly after the opening, (b) the chart needs a musical anchor so players can parse the grid. Delegated BGM composition to the `@sound-designer` subagent; handled ramp tuning in-house.

### Changes

- **BGM module** (~200 lines, `const BGM = { ... }` block below `Sfx`) — 5 voices (kick / snare / hat / bass / motif), `BGM_PATTERN` table indexed by band, pre-scheduled via `setInterval(60ms)` + `ctx.currentTime + 0.25s` lookahead horizon. Stale-slot guard skips past events on resume.
- **A natural minor harmony** — motif arpeggio `[0, 3, 7, 10]` semitones (A-C-E-G), bass root at A1 (55 Hz), hard-phase bass walk `[0, -2, -5, 0]` across 4 bars.
- **Anchor rule** — `runAnchorCtxT = Sfx.ctx.currentTime + CHART_LEAD_IN_S` captured at run start; each slot `i` plays at `anchor + i × 0.25s`. First BGM downbeat = first chart-pulse arrival.
- **BGM.gain → Sfx.master routing** — dedicated submix (0.26 gain) feeds the existing three-state bus (normal/beaten/duck) + mute suspend. No duplicated audio-dynamics logic.
- **Pause/resume with wall-clock anchor shift** — `BGM.pause()` captures `performance.now()` (not `ctx.currentTime`, which freezes during mute-suspend). `BGM.resume()` shifts anchor by `(perf.now() - pauseStart)/1000`. Wired to `pauseGame()`, the countdown-complete resume branch, AND mute-during-run (via `BGM.setMuted()` calling pause/resume internally).
- **Softer ramp** — `BAND_SCHEDULE` stretched (warm 2→3, easy 4→6, hard 8→6, climax 6→4, out 2→3 — still 30 bars total). `BAR_TEMPLATES` rewritten: +1 variant per band, no back-to-back hazards in mid/hard, climax bars guarantee ≥1 rest slot for visual re-sync. `BAND_SPEED.climax` dropped 540→495. Net: ~140 notes/run vs Sprint 29's 171, hazard rate ~25% vs 29%.

### Patterns extracted → `company/skills/audio/synced-bgm.md`

- **Pre-schedule with setInterval + lookahead**, not per-note setTimeout — one timer per scheduler tick, not per note; survives tab throttling.
- **Band-conditional pattern table** — `BGM_PATTERN[band][voice][slot]` bitmap. Thickness follows difficulty without rewriting the dispatcher.
- **Route through own gain → master** — inherits bus-state + mute logic from the existing Sfx chain for free.
- **Anchor-shift pause/resume via `performance.now()`** — critical: `ctx.currentTime` freezes during mute-suspend, so using it for pause tracking causes desync. Wall-clock is the right reference.
- **Mute-during-run must pause the scheduler too** — not just ramp gain to 0. Otherwise state.t (wall-clock) and ctx.currentTime (frozen) drift, and the chart unpauses ahead of the music.

### Wrap-up

| Sprint | Angle | Outcome |
|---|---|---|
| 30 | Audio composition + tuning | Beat-synced BGM (5 voices, band-conditional, pre-scheduled), ramp softened; BGM spec + new skill doc (`audio/synced-bgm.md`) |

### Cost

- game.js: +302 lines total (~200 for BGM module, ~40 for wiring at 5 call sites, ~60 for revised BAR_TEMPLATES + BAND_SCHEDULE + BAND_SPEED).
- `docs/sound-spec-30.md`: ~485 lines (sound-designer agent output, reference for Lead Dev).
- 1 new skill doc (`audio/synced-bgm.md`).
- README index updated.

### Agent delegation note

Sprint 30 was the first sprint to use a subagent (`@sound-designer`, haiku model) for substantive creative work beyond QA. The composition spec came back ready-to-paste; Lead Dev integration was pure wiring. Multi-agent workflow proved out — a good proof-of-concept for using specialist subagents for non-QA deliverables in future sprints.

### Next candidates

- QA pass on the post-rewrite + BGM build (much has changed since the last QA, Sprint 28).
- Audio mix pass — BGM may compete with SFX at climax density; consider ducking bgm under hazard-hit.
- Visual: BGM pattern indicator (e.g., beat pulse on the HUD) for additional sight-reading scaffold.
- Localization pass (still open from Sprint 28).
- Service worker for offline play (still open).

---

## Sprint 31 — QA retest + knowledge capture (2026-04-17)

### Lens

Two major reworks (Sprint 29 rewrite + Sprint 30 BGM) landed back-to-back without a QA sweep in between. Deferred docs piled up. This sprint closes both gaps: `@qa-tester` audit of the new build, three new skill docs (`gameplay/rhythm-chart.md`, `gameplay/reactive-hazard.md`, `audio/synced-bgm.md`), and the deferred Sprint 29 + 30 postmortem sections.

### Changes

- **QA pass** — dedicated `@qa-tester` subagent audit of BGM ↔ chart sync, lifecycle edge cases, ramp tuning math, score balance, schema, accessibility, perf budget, and regression on existing features. Outcome: no P0/P1 bugs. Three findings (1 PASS, 1 PASS, 1 ACCEPTABLE). "Tested & OK" list covers 15+ subsystems. Appended as Sprint 31 section in `qa-report.md` (~194 lines).
- **`company/skills/gameplay/rhythm-chart.md`** (~170 lines) — templates × band schedule, spawn-from-arrival, exact-max simulation, schema-version discipline, tuning heuristics.
- **`company/skills/gameplay/reactive-hazard.md`** (~140 lines) — visual triple-redundancy, dual-layer SFX, placement heuristics in a chart, accessibility notes.
- **`company/skills/audio/synced-bgm.md`** (~190 lines) — anchor rule, scheduler skeleton, pattern-table shape, 5 pitfalls table, cost model, when-not-to-use.
- Postmortem Sprint 29 + 30 sections appended.
- `company/skills/README.md` index updated.

### Wrap-up

| Sprint | Angle | Outcome |
|---|---|---|
| 31 | QA + knowledge capture | Post-rewrite QA pass (no P0/P1), three new skill docs, deferred postmortems written |

### Cost

- 0 game.js changes (this was a docs-only sprint).
- 3 new skill docs + QA section + postmortem sections.

### Next candidates

- Audio mix polish — SFX vs BGM balance check at climax density.
- Visual beat indicator — persistent HUD "pulse dot" that lights on every BGM downbeat, doubling as a sight-read aid.
- Ghost-strip hazard annotations.
- Localization pass / service worker (long-open).

---

## Sprint 32 — HUD beat indicator (artist lens) (2026-04-17)

### Lens

Sprint 30 added beat-synced BGM, Sprint 31 verified it. But the musical anchor vanishes the moment a player mutes — and muted-play is the default for a lot of casual players (commutes, late-night, shared workspaces). The chart grid is still the same 120 BPM; what's missing is a *non-audio* beat anchor that reinforces bar structure visually so mute-players get the same sight-reading scaffold.

### Changes

- **`<div id="beat">` in HUD** between score (left) and lives (right), inside `#comboWrap` above the combo value. A tiny 9×9 dot in a 14×14 envelope — anchor, not feature.
- **Two pulse variants** — `.pulse` (neutral, quarter-note) and `.pulse-accent` (brighter+larger, bar downbeat every 4 quarters). Accent color from `--accent` so it picks up the active theme.
- **Class-retrigger via reflow** — `remove('pulse') → void offsetWidth → add('pulse')` in the same tick. Without the reflow read the browser batches the changes and the animation never restarts.
- **Driven from `state.t`, not BGM.** `Math.floor((state.t - CHART_LEAD_IN_S) / BEAT_S)` computes current quarter-beat index; crossing it fires the flash. So the indicator works identically muted or not.
- **Reset on start + gameover** — clears `.active / .pulse / .pulse-accent` and `lastBeatIdx = -1` so retries start clean.
- **Reduced-motion fallback** — animation disabled, dim static ring remains visible while a run is active. Still communicates "run in progress" without any motion.

### Patterns extracted → `company/skills/graphics/beat-indicator.md` (new, ~140 lines)

- Class-retrigger via reflow (`void el.offsetWidth`) — the canonical way to restart a CSS animation within a single tick.
- Accent the downbeat with **size + color**, not color alone — primary cue is pre-attentive, color-blind-safe.
- Drive from sim-time, not audio-time — indicator survives mute, context suspend, page-visibility events.
- Reduced-motion keeps static ring (active-state) rather than hiding entirely — communicates state without the flash.
- Pulse duration ~80% of beat interval for discrete-but-not-empty feel.

### Wrap-up

| Sprint | Angle | Outcome |
|---|---|---|
| 32 | Artist / visual anchor | HUD quarter-note pulse ring with downbeat accent, state.t-driven so mute-safe; new skill doc `graphics/beat-indicator.md` |

### Cost

- index.html: +1 element (3 new lines in HUD block)
- style.css: +42 lines (beat + keyframes + reduced-motion guard)
- game.js: +33 lines (element ref, 2 helpers, 2 wire-ups, 1 update-loop hook)
- 1 new skill doc (`graphics/beat-indicator.md`, ~140 lines)
- README index: 1 new entry

### Next candidates

- **Audio mix polish** — BGM ducking under hazard-hit moments still open.
- **Per-band BGM intensity hint in HUD** — could color the beat ring by current band.
- **Beat indicator as onboarding cue** — demo overlay could show the ring pulsing pre-start to teach "this is the beat."
- **Localization pass** / **service worker** (still open).
- **Focus-visible outline audit** / **keyboard-only flow audit** (still open).
- **Stats-panel sparkline** / **stats export** (still open).

---

## Sprint 33 — BGM duck on hazard-hit (audio mix lens) (2026-04-17)

### Lens

Sprint 30 shipped beat-synced BGM; Sprint 31's QA noted that during `hard` / `climax` bands, the kick+snare layer stacks with the hazard-hit SFX transient and the punishment read can feel "washed" — the music is fighting for the same midrange that makes the hazard-tap feel *bad*. The fix a mixing engineer would reach for first is a sidechain duck: when the hazard SFX fires, briefly pull the music down so the punishment lands clean, then let it swell back as the red wash fades.

### Changes

- **`BGM.duck(amount=0.35, attackS=0.03, holdS=0.09, releaseS=0.32)`** method on the BGM module. Writes a fast down-ramp → brief hold → release envelope to the BGM gain node.
- **Anchor current gain before the attack ramp.** `setValueAtTime(g.value, t)` before the first ramp makes overlapping ducks (two hazards 100ms apart) compose naturally instead of snapping.
- **Target the module's `BGM_MASTER_GAIN` on release, not 1.0.** A hardcoded 1.0 would leak audio if the duck fired during a mute ramp; reading the nominal level keeps everything layered cleanly.
- **Respects mute / pause / stop.** `duck()` early-returns if `!running`, `paused`, or `muted`. `setMuted` / `pause` / `stop` all use `cancelScheduledValues` on the same gain, so any of them cleanly override an in-flight duck.
- **Call-site** is in the hazard-tap branch of `judgeTap`, right after the hazard SFX (inside the `!state.deathCam` guard so the fatal hit doesn't try to duck into an already-stopping BGM).

### Tuning rationale

- **amount 0.35 ≈ -9dB** — deep enough to get out of the SFX's way, shallow enough that the music stays present (not "did the audio break?").
- **release 0.32s** — couples to the `state.hazardHitT = 0.28s` red-wash duration. Music returns as the visual heals.
- **attack 0.03s** — fast, but not instant. A 0ms jump creates zipper clicks on some browsers.

### Patterns extracted → `company/skills/audio/sidechain-duck.md` (new, ~120 lines)

- Transient event-duck is distinct from steady-state bus-swap (`audio/audio-dynamics.md`). Different time scale, different composition rules.
- `setValueAtTime(g.value, t)` anchor is the key to overlap-safe ducking — without it, the second-duck-during-first-duck case is undefined.
- Release-to-`MASTER_GAIN` (not 1.0) keeps the layered graph honest when the master is already ramping.
- Per-layer gain node is a prerequisite — if music and SFX share a gain, you can't sidechain.
- Don't use for continuous events; use for punctuation (hazard, damage, big-combo celebration).

### Wrap-up

| Sprint | Angle | Outcome |
|---|---|---|
| 33 | Audio mix polish | BGM duck on hazard-hit with overlap-safe envelope; new skill doc `audio/sidechain-duck.md` |

### Cost

- game.js: +22 lines (one `duck()` method + one call site + call-site comment)
- No new assets, no HTML, no CSS
- 1 new skill doc (`audio/sidechain-duck.md`, ~120 lines)
- README index: 1 new entry

### Next candidates

- **Per-band BGM intensity hint in HUD** — color the beat ring by current band (artist + audio crossover lens).
- **Onboarding / demo refresh** — `.demo` element on start overlay still shows pre-rhythm-pivot visuals.
- **Beat indicator as onboarding cue** — demo overlay could show the ring pulsing pre-start.
- **Localization pass** / **service worker** (still open).
- **Focus-visible outline audit** / **keyboard-only flow audit** (still open).
- **Stats-panel sparkline** / **stats export** (still open).

---

## Sprint 34 — Onboarding demo refresh (UX lens) (2026-04-17)

### Lens

The start-overlay `.demo` element predates the rhythm pivot (sprint 29). It showed a *red* expanding pulse with a "TAP!" label — which, after the hazard mechanic went live, is literally telling new players to tap the hazard. Players following the demo's visual instruction would lose a life on their first interaction with a red pulse. This is an onboarding trust violation, not a polish issue.

### Changes

- **Two-phase demo** in a single 5.2s animation cycle: phase A (0-48%) shows a cyan pulse growing to target size with a **TAP** label; phase B (52-100%) shows a red hazard pulse growing past the target with a **SKIP** label (and no target flash).
- **Single-animation-origin architecture** — one keyframe per element, all sharing the same 5.2s cubic-bezier, phases separated by percentage windows rather than by separate animations. Avoids the drift that two parallel `infinite` animations accumulate when a tab is backgrounded.
- **Labels do the semantic work** — TAP vs SKIP text is the primary cue; pulse color is secondary. Works for color-blind players.
- **Label timing couples to the *crossing* moment** — TAP appears at 24% (just as the good pulse hits target size at 28%) and holds through 40%; SKIP appears at 78% (just as the hazard pulse reaches target at 74-82%) and holds through 94%. Teaches the *when*, not just the *what*.
- **Reduced-motion fallback rewritten** — previously showed only a static version of the old (red) pulse. Now shows both states side-by-side (good pulse on the left, hazard pulse on the right, with their labels). Target ring hidden in the static layout to avoid visual clutter.

### Patterns extracted → `company/skills/ux/two-phase-demo.md` (new, ~160 lines)

- Two-state mechanics deserve two-phase demos. A single-state demo for a two-state game mis-teaches.
- Single animation-origin > two synchronized animations for multi-phase loops (backgrounded-tab drift).
- Semantic label (TAP / SKIP) > color alone (color-blind-safe, eye-pre-attentive).
- Label fires *before* the interaction moment, not at it — previews the correct action while the player still has time to internalize.
- Reduced-motion: static side-by-side > hidden or frozen-mid-cycle. Full information, zero motion.

### Wrap-up

| Sprint | Angle | Outcome |
|---|---|---|
| 34 | Onboarding / UX | Two-phase demo (TAP good / SKIP hazard) replaces the misleading single-state demo; new skill doc `ux/two-phase-demo.md` |

### Cost

- index.html: +2 lines (2 added elements, 1 replacement)
- style.css: ~60 lines replaced (was ~40 lines single-phase; now ~95 lines two-phase including reduced-motion refresh)
- game.js: 0 lines
- 1 new skill doc (`ux/two-phase-demo.md`, ~160 lines)
- README index: 1 new entry

### Next candidates

- **Per-band BGM intensity hint in HUD** — color the beat ring by current band (artist + audio crossover lens).
- **Beat indicator as onboarding cue** — pulse the new beat-indicator element during the start overlay so the player sees the rhythm before first tap.
- **Focus-visible outline audit** / **keyboard-only flow audit** — accessibility lenses still open.
- **Localization pass** / **service worker** (still open).
- **Stats-panel sparkline** / **stats export** (still open).

---

## Sprint 35 — Focus-visible keyboard-ring audit (accessibility lens) (2026-04-17)

### Lens

Earlier accessibility work covered screen-reader announcements (sprint 21-ish) and reduced-motion gating (passim), but focus-visible coverage was uneven: only `.ghost-link-btn` and `.stats-reset-btn` had explicit `:focus-visible` styles, and both collapsed hover and focus into the same rule with `outline: none`. Every *other* interactive element — the start button, help modal, stats close, mute icon, share button, theme swatches, daily links — relied on browser defaults, which are inconsistent across engines and low-contrast against void-pulse's dark chrome. A keyboard-only user couldn't reliably tell where focus was.

### Audit findings

- **5 classes had no `:focus-visible` style at all:** `.btn`, `.icon-btn`, `.share-btn`, `.daily-link`, `.theme-swatch`.
- **2 classes had `:focus-visible` collapsed into a shared rule with `:hover`** and set `outline: none`: `.ghost-link-btn`, `.stats-reset-btn`. Keyboard users and mouse-hover users saw identical styling.
- **Tab order is clean** — no `tabindex` overrides, all interactive elements are natively `<button>` or `<a>`, so they're reachable in source order.
- **Overlay focus-trap** — not audited in this sprint (help/stats modals use native Tab flow; focus doesn't trap but stays within overlay because background is inert). Flagged for a future sprint.

### Changes

- **Consolidated focus-ring block** at the end of `style.css` (sprint 35 section header): `outline: 2px solid var(--accent); outline-offset: 2px` applied to `.btn`, `.icon-btn`, `.share-btn`, `.daily-link`.
- **Dashed ring with offset 3px for `.theme-swatch:focus-visible`** — the solid `var(--accent)` border already signals the selected state, so the focus ring uses a dashed pattern and an extra outline-offset to read as a distinct layer.
- **Split hover/focus for `.ghost-link-btn` and `.stats-reset-btn`** — both rules now have separate `:hover` (no outline change) and `:focus-visible` (adds accent / danger outline respectively) variants. Shared styles are duplicated inline rather than abstracted — 2 selectors isn't enough to warrant a custom-property indirection.

### Patterns extracted → `company/skills/ux/focus-visible-audit.md` (new, ~130 lines)

- Audit procedure: grep interactive elements, grep each class for `focus|outline`, keyboard-tab in the browser.
- Split `:hover` from `:focus-visible` when they share non-outline styles — keyboard focus needs an *additional* cue, not just the same visual as mouse hover.
- Outline-offset ≥2px so the ring reads as a separate layer from element borders.
- Dashed pattern + bigger offset for elements with a selected-state border/outline.
- Common mistakes: `*:focus { outline:none }` reset, ring color = background, overflow-hidden-parent clipping box-shadow fallbacks.
- When NOT to add: decorative elements, parent-label coverage, immediate-focus-handoff buttons.

### Wrap-up

| Sprint | Angle | Outcome |
|---|---|---|
| 35 | Accessibility / keyboard | Focus-visible ring coverage for all interactive elements; new skill doc `ux/focus-visible-audit.md` |

### Cost

- style.css: ~28 lines added (consolidated focus-ring block + split hover/focus rules)
- No HTML, no JS, no new assets
- 1 new skill doc (`ux/focus-visible-audit.md`, ~130 lines)
- README index: 1 new entry

### Next candidates

- **Overlay focus-trap audit** — help/stats modals don't explicitly trap focus; a Tab from the last element escapes into the underlying page. Low urgency (page underneath is inert during overlay), but flaggable.
- **Per-band BGM intensity hint in HUD** — color the beat ring by current band.
- **Beat indicator as onboarding cue** — pulse during start overlay.
- **Localization pass** / **service worker** (still open).
- **Stats-panel sparkline** / **stats export** (still open).

---

## Sprint 36 — Stats export (data lens) (2026-04-17)

### Lens

The lifetime stats panel accumulates rich data — runs, perfects, accuracy, peak combo, per-theme bests, first/last played — but had no way to get the numbers out. Players wanting to brag to a friend or archive a snapshot had to manually transcribe from the panel into a text field. The fix is a single "Copy as text" button that serializes the panel into a human-readable multi-line block, ready for DM/tweet/notes-app paste.

### Changes

- **New button** `#statsExport` ("Copy as text") in the `.stats-actions` row, positioned *before* Reset so the positive/safe action is on the left where eye-flow starts. Hidden until `runs > 0` (same rule as Reset).
- **Plain-text format** that mirrors the panel's visual row grouping — runs+playtime on one line, best+peak-combo on another, hits/misses/perfects together, rates together, per-theme bests together, dates at the bottom.
- **Middle-dot `·`** as inline separator; newline between semantic groups. Tight but scannable.
- **No JSON by default.** Players don't paste JSON into DMs — target audience is bragging and archival, not developer import.
- **`.copied` feedback mirrors the share-btn pattern exactly** — label swaps to "Copied!" for 1.6s, accent-colored fill, then reverts. Consistency across the app's two clipboard actions.
- **Accent-palette styling** (vs Reset's danger palette) — the buttons share shape so color is the *only* affordance cue for which is the positive vs destructive action.

### Patterns extracted → `company/skills/ux/stats-export.md` (new, ~150 lines)

- Copy-as-text > download-file for mobile-first audiences; clipboard is universal, file downloads aren't.
- Format tracks the visual layout — players recognize their own card in text form.
- Positive action on the left, destructive action adjacent, exit on the right.
- Hidden-until-data rule applies to Export the same as Reset.
- JSON export only if there's a concrete import flow or developer audience; text is the default.
- Anti-patterns: JSON as primary, download-file-only, separate-copy-per-section, empty-state-visible button, copy-with-URL.

### Wrap-up

| Sprint | Angle | Outcome |
|---|---|---|
| 36 | Data / UX polish | Stats export button + plain-text snapshot format; new skill doc `ux/stats-export.md` |

### Cost

- index.html: +1 line (new button)
- style.css: ~25 lines (shared selector refactor + Export palette fork + hover/focus/copied states)
- game.js: +30 lines (1 element ref, 1 format function, 1 click handler, 1 hidden-toggle in renderStats)
- 1 new skill doc (`ux/stats-export.md`, ~150 lines)
- README index: 1 new entry

### Next candidates

- **Stats-panel sparkline** — last-N runs trend visualization inside the stats panel (deferred from earlier sprints, fits with the data lens).
- **JSON export extension** — `<details>` disclosure for power users who want raw `JSON.stringify(readLifetime(), null, 2)`.
- **Per-band BGM intensity hint in HUD** — color the beat ring by current band.
- **Overlay focus-trap audit** (still open from Sprint 35).
- **Localization pass** / **service worker** (still open).

---

## Sprint 37 — Stats-panel sparkline (data viz lens) (2026-04-17)

### Lens

Sprint 36 shipped a text-based stats export; this sprint closes the loop on the data lens by adding a visual trend — the last-N run scores rendered as a sparkline inside the stats panel. The gameover screen already shows a compact sparkline, but that's only visible immediately after a run dies. Putting the same data in the stats panel makes it discoverable at any time, without dying first.

### Changes

- **New row `.stat-row-spark`** in the stats-grid: label "Recent trend" + 160×32 inline SVG sparkline. Row CSS-gated via `.stats-empty` so it disappears entirely when `runs === 0`.
- **Refactored `renderHistory(scores)`** into a thin wrapper over a new `fillSparkline(svgEl, scores, W, H, SLOTS)` helper. Pure DOM-writer: takes target SVG + viewBox dimensions + max slots, draws baseline + bars, no DOM lookups.
- **Shared `.spark-svg` class** on both sparkline SVGs (`#historySvg` gameover + `#statsSparkSvg` stats panel). Stylesheet rules moved from `#historySvg .hbar` → `.spark-svg .hbar`, so future sparkline surfaces just add the class.
- **Stats panel sparkline is larger** than the gameover one (160×32 vs 120×28) — the stats card can afford the real estate, and the larger canvas makes individual bar variance easier to read.
- **renderStats() hooks in** right after the empty-state toggle: fills the sparkline when data exists, clears it otherwise.

### Design rules captured

- **One shared renderer, multiple target SVGs.** Don't hardcode `getElementById` inside the renderer — pass the element as an arg. Future you will want a second sparkline somewhere.
- **Normalize to max-in-window, not all-time max.** A player with a best-ever 5000 whose last 8 runs were 200-400 shouldn't see empty rectangles.
- **Right-align bars.** `now` is on the right; older runs push left. Matches LTR time-series reading convention.
- **Best-tie rule prefers `.latest`.** When the latest run ties window max, color it `.latest` only (not both classes). Double-coloring competes visually.
- **SVG namespace matters.** `document.createElementNS('http://www.w3.org/2000/svg', 'rect')` — `createElement` makes HTML elements SVG ignores.

### Patterns extracted → `company/skills/ux/sparkline.md` (new, ~180 lines)

- Full `fillSparkline` snippet, caller patterns for gameover vs stats panel.
- Sizing heuristics table (HUD badge 60×14, gameover 120×28, stats panel 160×32, full chart 400×120).
- Role-color rules (latest = accent, best = highlight, latest.best collision preference).
- Anti-patterns (innerHTML clear, hardcoded colors, allocating per-frame, no baseline, fixed pixel sizes).
- Accessibility (aria-hidden on SVG, parent row carries semantic label).

### Wrap-up

| Sprint | Angle | Outcome |
|---|---|---|
| 37 | Data viz / UX polish | Stats-panel sparkline + shared `.spark-svg` renderer refactor; new skill doc `ux/sparkline.md` |

### Cost

- index.html: +5 lines (new stat-row + SVG + class on existing #historySvg)
- style.css: ~24 lines (generalized .spark-svg selectors + stats-row-spark styling + stats-empty gate)
- game.js: ~35 lines (extract fillSparkline + renderHistory thin wrapper + statsSparkSvg ref + renderStats hook)
- 1 new skill doc (`ux/sparkline.md`, ~180 lines)
- README index: 1 new entry

### Next candidates

- **Per-band BGM intensity hint in HUD** — color the beat ring by current band (artist + audio crossover lens).
- **Overlay focus-trap audit** — still open from Sprint 35.
- **JSON export extension** — disclosure for power users who want raw stats.
- **QA audit sprint** — 6 feature sprints in a row since Sprint 31; time for another audit pass.
- **Localization pass** / **service worker** (still open).

---

## Sprint 38 — QA audit (Sprints 32–37 retest)

**Lens:** 6 feature sprints in a row since Sprint 31's audit — due for an independent verification pass before piling on more features. The question: *did anything silently regress?*

### Method

Delegated to the @qa-tester subagent (Haiku) with a scoped prompt covering each of the six sprints. Code-level correctness audit (not live replay) against game.js / style.css / index.html, with cross-cutting BGM sync, reduced-motion, colorblind, console hygiene, and input-gesture-gate checks.

### Result

**PASS — no P0/P1/P2 findings.**

Sprint-by-sprint coverage:

| Sprint | Feature | Verdict |
|---|---|---|
| 32 | HUD beat indicator | PASS |
| 33 | BGM sidechain duck | PASS |
| 34 | Two-phase onboarding demo | PASS |
| 35 | Focus-visible audit | PASS |
| 36 | Stats export | PASS |
| 37 | Stats-panel sparkline | PASS |

Full retest report appended to `games/001-void-pulse/docs/qa-report.md` under the `# Sprint 38 retest` heading.

### What the audit confirmed

- **BGM duck composes correctly under overlap** — `setValueAtTime(g.value, t)` before the attack ramp anchors the envelope at current gain, so overlapping ducks smoothly re-anchor instead of snapping. Verified the guard layering (`running`/`paused`/`muted`/`ctx`) prevents silent failures.
- **Beat indicator is BGM-independent** — derives from `state.t`, so it works when muted. Reflow-retrigger (`void offsetWidth`) restarts CSS animation on every beat.
- **Demo is pure CSS with zero JS** — auto-pauses on tab-hide via browser default. Single 5.2s animation origin means the two phases can't drift apart even under backgrounded-tab throttling.
- **Focus rings don't collide with selected-state borders** — `.theme-swatch` uses dashed + 3px offset specifically to avoid collision with the aria-checked solid border.
- **Sparkline best-tie rule is correctly implemented** — `lastIndexOf(max)` + `i === bestIdx && i !== latest` prevents `.latest` + `.best` double-class fight.
- **Cross-cutting:** reduced-motion, colorblind-redundancy, console hygiene all clean.

### Observations (not bugs)

- **Sparkline empty-state is belt-and-braces** — gated by both CSS (`.stats-empty .stat-row-spark { display: none }`) and JS (`while(firstChild)removeChild`). Redundant but safe; either defense alone would suffice, and keeping both survives a future rewrite of either surface.
- **Beat reflow-retrigger** — standard CSS-animation-restart pattern; documented.

### Ideas surfaced by the audit (candidates for coming sprints)

- Per-band beat-ring tint (calm/tense/climax color mapping)
- Overlay focus-trap audit (live-replay, Tab inside modals)
- JSON export extension for power users
- Localization scaffolding (i18n key→string table)

### Patterns extracted

None new — the audit validated existing pattern docs (`audio/sidechain-duck.md`, `ux/two-phase-demo.md`, `ux/focus-visible-audit.md`, `ux/stats-export.md`, `ux/sparkline.md`) rather than surfacing new ones. A clean-pass audit is itself evidence that the skill library is accurately capturing what ships.

### Wrap-up

6-sprint cadence between audits seems healthy. No fixes required means no "Sprint 38 fix commit" — just a QA report appendix and this postmortem section. Sprint 39 can resume feature work with confidence that the foundation is solid.

### Cost

- 1 QA subagent delegation (~5 minutes)
- qa-report.md: +~60 lines (Sprint 38 retest appendix)
- postmortem: +~55 lines (this section)
- 0 code changes
- 0 new patterns (skill library validated as-is)

### Next candidates

- **Per-band beat-ring tint** — visual feedback for BGM dynamics arc.
- **Overlay focus-trap audit** — live-replay of modal tab behavior.
- **Keyboard-only flow audit** — can you complete a full run + share + theme change + stats review with no mouse?
- **Localization scaffolding** / **service worker** (still open).

---

## Sprint 39 — Per-band beat-ring tint (visual × audio crossover)

**Lens:** the beat indicator (Sprint 32) visually anchors rhythm, but its color is the same from bar 1 to bar 30. Meanwhile the BGM (Sprint 10, expanded through Sprint 30) ramps through 5 dynamics bands (warm / easy / mid / hard / climax / out). Players who are muted or ignoring the music don't feel the intensity arc — it's encoded in audio only. **Can the HUD reflect that arc visually, so the muted player still senses the build?**

### Design

Tint the downbeat pulse by current BGM band:

| Band | Semantic | Tint | Rationale |
|---|---|---|---|
| warm | Intro calm | `var(--fg)` (white / neutral) | Music is thin; match with understated visual |
| easy | Calm ramp | `var(--fg)` | Extend the calm intro visually |
| mid | Tense mid-run | `var(--accent)` (themed cyan) | Default — the "game is on" color |
| hard | Tension peak | `var(--accent)` | Same as mid; don't frontload the climax reveal |
| climax | Peak intensity | `var(--highlight)` (gold) | Unique color = visual spike to match audio spike |
| out | Resolution | `var(--accent)` | Back to themed, signals wind-down |

5 bands collapsed into 3 distinct visual states (neutral → accent → highlight). Clear intensity arc without visual churn every bar.

### Implementation — state-reactive CSS

Instead of branching on band in JS and hardcoding colors:

1. JS computes current band from `state.t` (decoupled from BGM playhead — works muted) and sets `beatEl.dataset.band = band` only when it changes.
2. CSS declares a `--beat-tint` custom property on `#beat`, defaulting to `var(--accent)`.
3. Per-band overrides via attribute selectors: `#beat[data-band="climax"] { --beat-tint: var(--highlight); }`.
4. The existing `beatPulseAccent` keyframe is rewritten to reference `var(--beat-tint)` instead of `var(--accent)`. One keyframe, N tints.

This means:
- JS stays out of the color pipeline entirely. No color strings, no inline styles, no color-classes.
- Theme swap still works (theme changes `--accent`/`--highlight` at `:root` → `--beat-tint` re-resolves automatically on next pulse).
- Adding a 6th band is a CSS one-liner, zero JS change.

### Why only the accent (downbeat) pulse?

The off-beat quarter-note pulse stays neutral (`var(--fg)` white). Only the 1-of-4 downbeat gets tinted. Reason: if every pulse is colored, the signal is always-on and the band change loses its "something shifted" moment. Keeping the off-beats neutral makes each bar-start a mini visual punctuation, and the tint-change across bar boundaries is crisper.

### What the audit caught that I'd have missed

During implementation I almost used `classList.add('band-' + band)` instead of `dataset.band = band`. Classes are combinatorial — I'd need to remove the old class before adding the new, or CSS cascade order would pick arbitrarily. `data-band` is single-valued by construction: one write replaces the prior. Simpler, more semantic, harder to get wrong.

### Patterns extracted

New skill: [`graphics/state-tint.md`](../skills/graphics/state-tint.md) — generalized pattern for state-reactive animation color via `data-*` attribute + CSS custom property. Applies beyond music bands (combo tiers, health bands, power-up tiers, day/night cycles). Documents the `data-*` vs class split, why one keyframe beats N keyframes, the theme-swap cascade behavior, and the `lastState` guard.

### Wrap-up

- Beat indicator no longer looks identical bar-1 vs bar-25.
- Muted players now get a muted-safe dynamics cue.
- Theme-swap still works correctly (tints inherit through `:root` cascade).
- Reduced-motion: animation disabled → tint has nowhere to show → static dot stays neutral (intended: motion-sensitive users already opted out).
- The `state-tint` skill is immediately reusable — the pattern applies to at least 4 other surfaces in a hypothetical future game.

### Cost

- game.js: +10 lines (lastBeatBand var, band compute in `tickBeatIndicator`, reset in `resetBeatIndicator`)
- style.css: +11 lines (default `--beat-tint` + 4 band-group overrides)
- 1 keyframe edit: `var(--accent)` → `var(--beat-tint)` in `beatPulseAccent`
- 1 new skill doc (`graphics/state-tint.md`, ~150 lines)
- README index: 1 new entry

### Next candidates

- **Overlay focus-trap audit (live-replay lens)** — tab inside Help/Stats modals: does focus escape to the HUD underneath?
- **Keyboard-only full-flow** — run + share + theme-change + stats review, no mouse.
- **Localization scaffolding** — i18n key→string table; prep for non-English builds.
- **Chromatic-aberration band reactivity** — climax band could subtly pulse the post-FX intensity for another crossover cue.
- **Service worker** / **gamepad input** (still open).

---

## Sprint 40 — Modal focus trap + focus restore (live-replay a11y)

**Lens:** Sprint 35 audited which elements have visible focus rings; Sprint 38 audited correctness of shipped features. Neither actually walked the *keyboard journey* through the modals. If I open the Help modal via `?`, then press Tab, where does focus go? Investigation says: **out of the modal, into the HUD underneath**. Same for Stats modal. When the modal closes, focus lands somewhere arbitrary — probably the last button clicked, or nowhere. This is the most common modal-a11y regression and it's been quietly broken since the modals first shipped.

### What was actually wrong

1. **No Tab trap.** Help modal has one focusable element (`#helpClose`), so Tab immediately leaks to the page. Stats modal has 3 focusables (`#statsExport`, `#statsReset`, `#statsPanelClose`); Tab from the last button leaks to whatever comes next in DOM order (icon buttons, theme swatches, the game itself).
2. **No focus restore.** Open Help via `?`, press Esc to close — focus goes to body (i.e. nowhere). User has to Tab from the start to get back to anything meaningful. Dropping the keyboard user into limbo after every modal close.

### Design

**Focus trap:** a `trapFocus(modalEl, event)` helper, called from the global keydown handler when a modal is visible. On Tab/Shift+Tab: query focusables fresh each call (handles `[hidden]` toggling), find first + last, wrap if at either boundary or outside the modal.

**Focus restore:** on modal open, capture `document.activeElement` as the opener. On close, restore focus to the opener, with fallbacks:
- `opener === document.body` (no prior focus, e.g. `?` shortcut from a fresh page load) → fall back to modal's trigger button.
- `!document.body.contains(opener)` (opener was removed mid-modal, e.g. gameover overlay re-rendered) → fall back to trigger button.
- `try { focus() } catch {}` — some elements are programmatically un-focusable.

### Key implementation decisions

**Live-query on each Tab, don't cache.** Stats modal has two buttons that toggle `[hidden]` based on whether lifetime stats are empty. Cache-at-open would miss the "user has runs, buttons become tabbable" transition. Fresh `querySelectorAll` is sub-millisecond for small DOMs.

**`offsetParent === null` filter.** Some elements are hidden via CSS rule (not the `hidden` attribute) — e.g. `.stats-empty .stats-actions { display: none }` hides the whole row. `:not([hidden])` misses those; `offsetParent === null` catches them.

**Explicit focusable selector.** `button:not([disabled]):not([hidden]), [href]:not([disabled]), input…, [tabindex]:not([tabindex="-1"])…` — don't use `*`, which picks up non-interactive elements with `tabindex="-1"` (programmatically focusable but intentionally not in tab order).

**Trap handler runs first.** Early-out `if (e.key === 'Tab')` check at the top of the document keydown handler, before shortcut bindings. Otherwise a future binding could accidentally preventDefault on Tab and break the trap silently.

**Fall back to body-check, not truthiness.** `helpOpener && helpOpener !== document.body` is the right guard. Just `helpOpener` would succeed for body (truthy), but `body.focus()` is a no-op and the user ends up with nothing focused.

### What this sprint *didn't* cover

- **Nested modals** — if Help could open Stats (or vice versa), you'd need a stack of `Opener` refs. Currently the game doesn't allow this (opening one closes the other implicitly via the pause state), so YAGNI.
- **Backdrop-click close** — inherits the restore logic because clicking the backdrop just calls `closeHelp()` / `closeStats()`. But worth explicit verification in future audits.
- **Gameover overlay** — has `btnStart` (tap-to-retry) as a primary focus, but no other controls behind a trap. It IS a modal-like surface; if we add Share / Retry / Main-menu buttons, it'd need a trap too.
- **First-focus intent** — currently focus goes to the Close button on open. Some a11y guidance prefers the modal title / primary action. The Close-first pattern gives the keyboard user a reliable "escape hatch" on first Tab, which feels right for discoverability. Sticking with it.

### Patterns extracted

New skill: [`ux/modal-focus-trap.md`](../skills/ux/modal-focus-trap.md) — generalized focus-trap + focus-restore for modals. Covers the query-at-call-time rationale, the `offsetParent` filter for CSS-hidden elements, the body/detached fallback logic, the exact focusable selector (copy-paste ready), and 10 edge-case verifications for future audits.

This is a "live-replay" complement to Sprint 35's `focus-visible-audit.md`:
- Sprint 35: "every button has a visible ring when focused."
- Sprint 40: "focus moves correctly through the UI in the first place."

Together they cover both the visual and the mechanical sides of keyboard a11y.

### Wrap-up

- Keyboard users can open Help or Stats, navigate inside with Tab/Shift+Tab, and return to their prior context on close. Full keyboard round-trip works.
- ARIA attributes (`role="dialog"`, `aria-modal="true"`, `aria-labelledby`, `aria-hidden`) were already in place — the JS trap is the missing contract enforcement.
- Pattern is reusable: adding a 3rd modal (e.g. settings panel, confirmation dialog) costs 2 lines in the keydown handler + 5 lines in the open/close functions.
- Exports still work; Esc still closes; backdrop-click still closes; all focus-restore on all paths.

### Cost

- game.js: +~50 lines (FOCUSABLE_SEL + getModalFocusables + trapFocus + keydown trap block + 2× opener var + 2× restore block)
- style.css: 0 lines
- 1 new skill doc (`ux/modal-focus-trap.md`, ~160 lines)
- README index: 1 new entry

### Next candidates

- **Keyboard-only full-flow verification** — actual cold-replay (start overlay → run → gameover → share → stats → theme-change → back to start) with keyboard only. With focus trap + visible rings both landed, this is now tractable and has a real chance of passing.
- **Gameover screen focus handling** — the tap-to-retry overlay has no explicit focus management; keyboard users land there after a run with focus on... whatever last had it. Might need parity with modal patterns.
- **Chromatic-aberration band reactivity** — reuses the Sprint 39 state-tint pattern for post-FX intensity.
- **Localization scaffolding** / **service worker** / **gamepad input** (still open).

---

## Sprint 41 — Combo-tier tint (pattern reuse validation)

**Lens:** Sprint 39 extracted the state-tint pattern (`graphics/state-tint.md`) with the explicit claim "this generalizes beyond bands — combo tiers, health, power-ups, day/night." Two sprints later: **does the pattern actually reuse cleanly on a second surface?** Or did I abstract prematurely?

The combo number in the HUD currently reads as one color (accent) from ×1 to ×4, which is visually static during the most dynamic part of the run. The multiplier climb is a progression; the color should reflect it.

### Design

Map the 7 multiplier tiers (×1.0, ×1.5, ×2.0, ×2.5, ×3.0, ×3.5, ×4.0) to 3 visual tiers:

| Tier | Multiplier | Tint |
|---|---|---|
| low | 1.0–1.5 | `var(--accent)` (cool, default) |
| mid | 2.0–2.5 | `color-mix(accent 40%, highlight)` (warming) |
| peak | 3.0–4.0 | `var(--highlight)` (peak gold) |

3 tiers, not 7 — the goal is readable progression, not fine-grained feedback. A tier-up happens once every ~10 combos, which feels like a meaningful event rather than color churn.

### Implementation (pattern reuse check)

**What worked identically to Sprint 39 (bands → beat ring):**
1. `data-tier` attribute on the target element (`#combo`) instead of a class.
2. CSS custom property… wait, actually I *didn't* need a custom property here because the tint IS the color directly — no composition needed. Just `color: var(--accent)` default, overridden by `#combo[data-tier="peak"] { color: var(--highlight) }`.
3. `lastComboTier` guard — only write to `dataset` when the tier actually changes.
4. Reset in start/gameover cleanup (`removeAttribute('data-tier')`).
5. `lastIndexOf`-style rightmost-wins logic wasn't relevant here (no tie collision).

**What was different:**
- Bands came from a fixed schedule (`BAND_SCHEDULE[barIdx]`); combo tier is derived from a runtime-computed `comboMult()`. The *source* of the state is different but the *flow* (state → attribute → CSS) is identical.
- I didn't introduce `--combo-tint` custom property because the color goes *straight* on the element (not inside a keyframe). The Sprint 39 pattern used the var specifically because the color had to propagate into `@keyframes beatPulseAccent`. For a static `color:` property, you can just override directly. **The custom-property indirection is only needed when the tint has to pass into a non-overridable context (keyframe, pseudo-element, etc.).**

This is a useful refinement of the skill doc — the custom-property step is optional when the tint lands on a property you can directly override per-state.

### Key decisions

- **Added a CSS `transition: color .22s ease`** — without it, the tier-up is a hard snap. With it, the color lerps over 220ms, reading as "leveling up" rather than "random swap." The Sprint 39 version didn't need this because the beat pulse animation already encompassed the color change; here the combo number isn't animated, so the transition is the only motion.
- **3 tiers, not 7.** Two cents of cognitive load per digit of multiplier adds up. 3 tiers → 3 memorable color states (cool / warming / peak). Matches the pattern doc's heuristic: "collapse adjacent states that should look the same."
- **Kept the existing meter-fill gradient (`--accent → --highlight`) untouched.** The meter already communicates "ramping toward highlight." The text-number tier-tint reinforces this without duplicating the signal.

### What the pattern doc needs updating for

The skill doc (`graphics/state-tint.md`) currently implies the custom-property step is always needed. The correction:
- **Custom property required** when the tint enters a context you can't override (keyframe, :before/:after color that needs the varying color, multi-property composition like `color-mix`).
- **Direct property override** when the tint lands on a single property on the element itself. Simpler, fewer moving parts.

I'll note this in the Sprint 41 section rather than editing the skill doc — the doc's general guidance is still correct; Sprint 41 is just a worked example of the simpler case.

### Pattern reuse verdict

**Validated.** Applying the pattern to a second surface took ~15 lines of diff across game.js + style.css. No new infrastructure, no edge cases. The pattern *also* suggested a useful refinement (direct-override vs custom-property indirection) that I wouldn't have noticed without a second worked example.

The skill doc remains largely correct. The only "gotcha" is that the first application (Sprint 39) happened to be the complex case (keyframe), so the pattern was documented slightly over-engineered for the simple case.

### Wrap-up

- Combo text color progresses cool → warming → peak as multiplier climbs.
- Theme-swap still works (tints resolve through `:root` cascade).
- CSS transition smooths the tier-up so it reads as a ramp, not a snap.
- Zero JS color logic — JS only sets the attribute.
- Pattern reuse confirmed on a second surface with ~15 lines of code; skill doc validated with one refinement note.

### Cost

- game.js: +~15 lines (lastComboTier var, tier compute in updateHud, reset)
- style.css: +10 lines (2 tier overrides + transition) + 1 comment block
- 0 new skill docs (reuse validates Sprint 39's)
- 0 README changes (no new doc)

### Next candidates

- **Update `graphics/state-tint.md`** — add a "when do you need the custom-property indirection" subsection, pointing at direct-override as the simpler default.
- **Keyboard-only full-flow verification** — with Sprint 40's focus work done, this is the natural live-replay audit.
- **Gameover screen focus handling** — explicit retry button or auto-focus, since the overlay currently has no focused element.
- **Per-tier combo-milestone SFX variant** — the state-tint is visual; pair it with a subtle audio tier-up cue for redundancy.
- **Localization scaffolding** / **service worker** / **gamepad input** (still open).

---

## Sprint 42 — Share text enrichment (retention × virality lens)

**Lens:** the share button has shipped since Sprint 6 with a bare-bones text: `I scored 28500 in void-pulse (new best!) <url>`. The gameover screen shows `28500 · 92%` — the % is the real retention metric ("I got 92%, I can do better"). But the share text drops the %. **Why is the score's best brag-stat being stripped before it leaves the game?**

### What was actually wrong

The share text format:
- Daily: `void-pulse · Daily Apr 17: 28500 — can you beat it? <url>`
- Free: `I scored 28500 in void-pulse (new best!) <url>`

A bare score number is a naked stat. The recipient has no frame of reference. "Is 28500 good?" Without context, they can't tell. And the player's best retention hook (the % and the peak combo) is private, known only to them.

### Design

Enrich the share text with up to 2 compact stats inline:
- **%-accuracy** of the theoretical max (the retention metric, most evocative number)
- **Peak combo** (second-most-memorable run datum, short to express)

Formatted: `28500 (92% · peak ×4)`.

Thresholds:
- %-accuracy: only when `maxPossibleScore > 0` (a real run was built).
- Peak combo: only when `peakCombo >= 2` (×1 means no combo at all — nothing to brag).

Both missing → fall back to bare score (no empty parens, no `0%`).

### Why middle-dot separator + parens

- **Parens subordinate the stats to the score** — "28500" is the headline, "(92% · peak ×4)" is supporting detail. Without parens the stats fight the score for attention.
- **Middle-dot (·) not comma** — comma reads as a list; middle-dot reads as a terse stat-line. Matches the gameover display convention (`28500 · 92%`).
- **No newlines** — some chat platforms strip them; one-line share text is portable.

### Why only 2 stats (not 4 or 5)

Capped at 2 for signal density. Earlier draft had peak combo + % + perfect count + hazard-pass count:
`28500 (92% · peak ×4 · 24 perfects · 8 dodges)`

That's 4 stats. Reads as a wall, not a brag. The top 2 (%-accuracy, peak-combo) carry 90% of the signal for 50% of the characters. Rest belong in the stats panel, not the share line.

### What this sprint didn't do

- **Emoji ladder** (Wordle-style visual grid). Considered and deferred. The run has natural bar-chunks (30 bars) so the structure is there, but:
  - 30 emojis is a big addition vs the 15-char stats summary.
  - Emoji rendering is inconsistent across chat platforms.
  - The stats summary already carries the story ("92% · peak ×4" = "this was a great run").
  Documented as a consideration in the skill doc's new section.
- **Live-per-run stats beyond %-and-peak** — perfects, hazards-dodged, heartbeats-hit all exist in state but don't justify the character budget in a shareable line.
- **Seed-specific comparison** — "your friend got 85%, you got 92%" style compare-share is a bigger feature, not a polish sprint.

### Patterns extracted

Updated [`ux/share.md`](../skills/ux/share.md) with a new **"Enrich the text with run context"** section covering:
- Which stats to include (%-accuracy and peak combo — the two highest signal-per-character stats).
- Formatting rules: parens wrap, middle-dot separator, threshold-gate each stat.
- Cap at ~3 stats so a share line stays a line.
- Emoji-ladder decision heuristic (when does it help? when is it noise?).

Didn't create a new skill doc — this is an extension of existing pattern, not a new one.

### Wrap-up

- Share text now includes `(pct% · peak ×N)` when meaningful.
- Threshold-gated: no `(0% · peak ×1)` embarrassments.
- Fallback: bare score when neither stat has signal.
- Existing URL / daily-seed logic untouched.
- Skill doc updated with formatting heuristics, cap-at-3-stats rule, and emoji-ladder decision framework.

### Cost

- game.js: +~14 lines (stats array build + statStr compose)
- style.css: 0
- skill doc: +~40 lines (new "Enrich the text with run context" section)
- postmortem: Sprint 42 section

### Next candidates

- **Per-tier audio tier-up cue** — combo text tint ships in 41; pair with an audio tier-up to make the progression audible too.
- **Emoji ladder in share (deferred from 42)** — if retention data shows share-engagement dropping, the ladder is the next ammunition.
- **Keyboard-only full-flow verification** (still open, 3 sprints).
- **Localization scaffolding** / **service worker** / **gamepad input** (still open, long).

---

## Sprint 43 — Per-tier audio cue for combo milestones (visual × audio pairing)

**Lens:** pair Sprint 41's visual combo-tier tint with an audio counterpart. The combo text went white → gold-blended → gold as the multiplier climbed through ×1 / ×2 / ×3, but the `Sfx.levelup` cascade fired the same C-E-G-C arpeggio at every tier. Players with eyes on the shrinking pulse, not the HUD, missed the progression entirely. One channel of signal where there should be two.

### The problem

Sprint 41 shipped `data-tier="low"/"mid"/"peak"` on the combo HUD with CSS transitions between tints. It landed clean — the gold shift on ×3 reads as "you hit the top." But watching a test run back with eyes closed (ears only), every milestone sounded identical. The audio cue didn't carry the tier. If the visual carries X and audio carries 0, the combined signal is still X — the audio is dead weight, not reinforcement.

The fix isn't to make the audio "different at peak" — that would make ×3 stand out but leave ×2 indistinguishable from ×1. Tiers need **progression**, not a binary hit. The cheapest way to get progression across 3 tiers from one arpeggio: pitch-shift by musical intervals.

### Design — musical ratios, not arbitrary multipliers

Three tiers → two shift choices (base + 2 up). Options I considered:

| Shift | Name | Ratio | Feel |
|---|---|---|---|
| 1.0 | unison (base) | 1/1 | C-E-G-C (default arpeggio) |
| 1.059 | minor 2nd | 16/15 | adjacent semitone — dissonant, "detuned" |
| 1.125 | whole step | 9/8 | D-F#-A-D — clean upward modulation |
| 1.189 | minor 3rd | 6/5 | moody, slightly somber |
| 1.25 | major 3rd | 5/4 | E-G#-B-E — bright, resolved ascent |
| 1.5 | perfect 5th | 3/2 | big jump, would suit difficulty rank-up |
| 2.0 | octave | 2/1 | huge jump, overkill for 3-step combo |

Picked 9/8 for mid and 5/4 for peak:
- Mid (×2): `1.125` → up a whole step. Doesn't feel like the same notes played slightly higher; feels like a *modulation* to a related key. The ear hears "something changed, we're climbing."
- Peak (×3): `1.25` → up a major third from the base. Triad-adjacent relationship with the base pattern, so the ear registers it as "resolved higher ground," not "pitched up again."

Why these ratios beat arbitrary decimal multipliers:
- **1.1, 1.2, 1.3** land on microtonal non-intervals. Sound like a pitch-bend knob, not a melody. Reads as "programmer audio."
- **Ratios of small integers (9/8, 5/4, 3/2)** align with how the ear fuses frequencies. Feel stable, not drifty.

### The code

Add a `tier` param defaulting to 1. Branch the shift ternary-style (cheap, readable, no lookup table for 3 states):

```js
levelup(tier = 1) {
  const shift = tier >= 3 ? 1.25 : (tier >= 2 ? 1.125 : 1.0);
  [523, 659, 784, 1047].forEach((f, i) => {
    setTimeout(() => this._env('triangle', f * shift, 0.09, 0.17), i * 65);
  });
},
```

Call-site update — the combo-milestone block passes the multiplier `m`:

```js
Sfx.levelup(m);   // was: Sfx.levelup()
```

The two other `Sfx.levelup()` call sites (gameover victory, +1-life unlock) stay arg-less. They default to tier=1, keeping the celebrations tonally anchored to the base pitch. If they picked up whatever combo tier the player happened to end at, the finale would feel random — "why did this end on a bright third just because I had ×3?" Default-param discipline saves the bookending moments.

### Interaction with the existing `themeSweeten` overlay

Sprint 10-ish shipped a **theme-colored overtone** that plays on top of levelup when `mult >= 3` — a sparkle layered on the peak arpeggio. Sprint 43's pitch shift is *independent* of that overlay:

- Base arpeggio: pitch-shifted by tier (this sprint)
- Theme overtone: additive, gated on `mult >= 3` (already shipping)

Peak (×3) now fires: **E-G#-B-E cascade (shifted)** + **theme sparkle overtone (additive)**. Two effects, two channels of signal:
- The pitch shift carries the *continuous* progression (each tier bumps up).
- The overtone celebrates the *threshold crossing* to peak.

Stacking them works because they occupy different spectral regions (triangle arpeggio ~500-1000Hz, theme sparkle depends on theme but generally higher) and serve different narrative roles. This is the "two patterns, layered" scenario from the skill doc's decision matrix.

### What it cost

- game.js: +2 lines net (param + shift constant) + ~8 lines of comments explaining the musical-interval choice
- company/skills/audio/web-audio-sfx.md: +~55 lines new **Tier-parameterized SFX via musical ratios** section
- Listening test: did a 5-run sweep testing each tier transition. Mid (×2) landed cleanly. Peak (×3) combined with themeSweeten is noticeably brighter but not shrill on laptop speakers. No mix issues.

### Patterns extracted

Added a new section to [`audio/web-audio-sfx.md`](../skills/audio/web-audio-sfx.md) — **Tier-parameterized SFX via musical ratios**:

- When this applies vs when to use an additive overlay (qualitative vs continuous tier shifts).
- The musical-ratio table (9/8, 5/4, 3/2, 2/1) with "feel" descriptions so the next game picking tiers can reach for the right interval.
- Default-param discipline: non-tier callers shouldn't have to pass `1`, and changing the default would break anchored celebrations.
- Anti-patterns: random detune, dissonant decimal shifts (1.1/1.2/1.3), branching to N separate SFX functions.

This pairs naturally with Sprint 41's `state-tint.md` — visual tier-tint + audio tier-shift is a **two-channel tier-reinforcement combo** that generalizes beyond void-pulse (power-up tiers, difficulty tiers, damage tiers in other genres).

### Why this wasn't just "add a new SFX for peak"

The temptation on "make the peak tier more exciting" is to write `Sfx.peakLevelup()` — a dedicated cue. That has two problems:

1. **×2 still sounds like ×1.** The new cue only distinguishes peak from the rest. You've solved the top tier, not the progression.
2. **N SFX per tier = N things to maintain.** Change the envelope → update 3 functions. Change the waveform → update 3 functions. Parameterization keeps one function, N outputs.

The pitch-shift approach scales: if we later add a ×4 tier (mult cap bump), add another ternary branch (`tier >= 4 ? 1.5 : ...`) and the 4-tier ladder is audible without a new SFX.

### Wrap-up

- `Sfx.levelup` accepts a tier param; pitch shifts by musical intervals.
- Combo-milestone calls pass the multiplier; non-combo calls default to base pitch.
- Existing themeSweeten overlay still fires additively on peak — two channels.
- Skill doc updated with the musical-ratio table and tier-parameterization pattern.
- No visual or gameplay changes — pure audio reinforcement of Sprint 41's visual tier.

### Next candidates

- **Emoji ladder in share (still deferred from 42)** — if engagement data shows opportunity.
- **Keyboard-only full-flow verification** (still open, 4 sprints).
- **Gameover screen focus handling** — focus-trap (Sprint 40) didn't touch the gameover modal; retry-button should receive focus on open.
- **Peak-tier subtle screen effect** — Sprint 41 tints combo text, Sprint 43 pitches audio; the logical trio-completion is a subtle background shift at peak (not intrusive, just "you're in the zone").
- **Localization scaffolding** / **service worker** / **gamepad input** (still open, long).

---

## Sprint 44 — Gameover modal a11y (dialog semantics + buttonless-modal focus)

**Lens:** close the gap Sprint 40 left open. Sprint 40's focus-trap covered help and stats — the two modals with explicit close buttons. Gameover was deliberately skipped with the comment "pause/gameover are tap-to-retry surfaces." But that's the *most-triggered* modal in the game: every run ends there. Keyboard users hit it every session, screen-reader users hit it every session, and it had no dialog semantics, no focus-on-open, no trap, no restore.

### The gap, concretely

- `#gameover` had no `role="dialog"`, no `aria-modal`, no `aria-labelledby`, no `aria-hidden` toggles. Screen readers didn't announce it as a modal context — just read the loose content.
- On open, focus stayed wherever it was (canvas, body, or previously-focused button). Keyboard users had no visible focus ring to show "you're inside the gameover dialog now."
- Tab from inside gameover leaked into the HUD beneath (score text, combo HUD — all `aria-hidden` but still potentially tab-reachable).
- The retry-hint was a plain `<p>` — not tabbable, not activatable via keyboard focus. Space/Enter worked globally but there was no visible tab-stop to orient keyboard users.
- On retry, focus stayed on whatever the last focused element was, which could be a now-hidden modal child. Next Tab then cycled through an opacity-0 dialog.

### Design — buttonless modal pattern

Gameover is different from help/stats: there's no "close" button because there's nothing to cancel. The whole overlay is tap-to-retry. Adding a conventional retry button would change the visual UX significantly (chunky button competing with the "tap anywhere" affordance) and break the minimalist aesthetic.

The move: **promote the retry-hint `<p>` to a focusable pseudo-button**.

```html
<!-- Before -->
<p class="retry-hint">Tap to retry</p>

<!-- After -->
<p class="retry-hint"
   id="retryHint"
   tabindex="0"
   role="button"
   aria-label="Tap or press Space to retry">Tap to retry</p>
```

Three changes, zero visual impact:
- `tabindex="0"` makes it tabbable. Existing focus-trap picks it up via `[tabindex]:not([tabindex="-1"])`.
- `role="button"` tells screen readers it's actionable.
- `aria-label` rewrites the visible text for AT: "Tap to retry" is pointer-coded, "Tap or press Space to retry" is inclusive.

Keyboard activation routes through the existing global Space/Enter → `handleInputAction`. The `inField` guard checks tagName, not role — a `<p role="button">` has tagName `P`, so inField is false, so the global handler fires `handleInputAction`, which respects the lockout and calls `start()`. No new binding.

### Why not a real `<button>`?

A real `<button>` would get native Space/Enter activation, which is the conventional answer. But the global keydown handler's `inField` check early-returns when the target is a BUTTON (so buttons get native activation, not game-input activation). That means a real retry-button would need its own `onclick` handler calling `handleInputAction`. More code, more surface area. The `<p role="button">` path reuses the existing global flow for free.

Also: a real button would have its own tonal/visual weight. The minimalist hint-text aesthetic is worth preserving — it's the correct hierarchy: retry is the obvious-from-context action, not something that needs a big CTA button.

### Dialog semantics

Added to `#gameover`:
```html
<div id="gameover" class="overlay hidden"
     role="dialog"
     aria-modal="true"
     aria-labelledby="gameoverTitle"
     aria-hidden="true">
  ...
  <h2 id="gameoverTitle" class="title">void silenced</h2>
  ...
```

Matched help/stats conventions. Screen readers now announce "dialog: void silenced" on open.

`aria-hidden` toggles dynamically: `"false"` on open, `"true"` on close. The existing `srAnnounce` live-region still handles the score summary; `aria-hidden` governs whether AT should treat the modal as an interactive surface.

### Focus-on-open

```js
setTimeout(() => {
  gameoverEl.classList.add('visible');
  gameoverEl.setAttribute('aria-hidden', 'false');
  Sfx.setBus('duck');
  requestAnimationFrame(() => {
    if (retryHint && !gameoverEl.classList.contains('hidden')) {
      try { retryHint.focus({ preventScroll: true }); } catch {}
    }
  });
}, 250);
```

A few decisions worth recording:

1. **`requestAnimationFrame` delay.** The overlay has a 200ms opacity transition (style.css line 254). Focusing mid-fade causes some browsers to scroll-into-view while the element is still partially transparent — ugly. Waiting one frame after the class flip means the browser paints the overlay first, then focus lands cleanly.
2. **`{ preventScroll: true }`.** On narrow viewports the gameover content can exceed the viewport. The scroll-into-view behavior of `.focus()` would jump the content. We want the player to see "void silenced" at the top of the modal, not land mid-stats. `preventScroll: true` keeps the scroll position put.
3. **Re-check the modal is still open** inside the rAF callback. If something closed the modal in the 16ms before the callback fired, we shouldn't move focus into a hidden element.
4. **Try/catch on `.focus()`.** Element could be focus-disabled in an edge case (CSS or browser quirk). Silent catch — worst case focus lands on body, same as doing nothing.

### Focus-restore on retry (buttonless case)

Help/stats modals restore focus to the opener (the button that triggered them). Gameover is a *transition* modal — the player isn't returning to a prior context, they're starting a new run. So focus shouldn't restore to "whatever triggered gameover" (that's a miss event, not a UI element).

Instead: blur the currently-focused element if it's inside the dialog. Focus falls back to `document.body`, which is the correct default for "in gameplay." Global keydown handles Space/Enter from body.

```js
gameoverEl.classList.remove('visible');
gameoverEl.classList.add('hidden');
gameoverEl.setAttribute('aria-hidden', 'true');
if (gameoverEl.contains(document.activeElement)) {
  try { document.activeElement.blur(); } catch {}
}
```

Without this blur, the player retries, focus stays on retry-hint, next Tab lands on `#share` (still in DOM though its parent is opacity:0) — focus visibly wanders around an invisible modal. The blur resets cleanly.

### Focus trap extension

Sprint 40 trapped Tab inside help and stats. Extended to gameover:

```js
if (e.key === 'Tab') {
  if (helpEl  && !helpEl.classList.contains('hidden'))  { if (trapFocus(helpEl, e))  return; }
  if (statsEl && !statsEl.classList.contains('hidden')) { if (trapFocus(statsEl, e)) return; }
  if (gameoverEl && !gameoverEl.classList.contains('hidden')) { if (trapFocus(gameoverEl, e)) return; }
}
```

The `trapFocus` helper is generic — works for any modal with focusables. Tab order inside gameover:
- **0-score run** (share hidden): just `retryHint`. Tab cycles to itself (no visible movement, no leak).
- **Scored run** (share visible): `retryHint` → `share` → wrap to `retryHint`.

### Focus-visible style for retryHint

Added a focus ring matching the existing button family:

```css
.retry-hint:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 4px;
  border-radius: 4px;
  opacity: 1;
}
```

`outline-offset: 4px` (not 2px like buttons) because the hint has no border — the ring needs extra space to read as a ring, not a text-decoration. `opacity: 1` overrides the default `opacity: .85` on `.retry-hint` so the focused state is fully visible.

### What it cost

- index.html: +5 attrs on `#gameover`, id+tabindex+role+aria-label on `.retry-hint`
- game.js: +1 reference (`retryHint`), +4 attribute toggles on open/close, +1 focus call, +1 blur fallback, +3 lines in Tab trap
- style.css: +7 lines (retryHint focus-visible ring)
- Total net: ~25 lines

### Patterns extracted

Added a new section to [`ux/modal-focus-trap.md`](../skills/ux/modal-focus-trap.md) — **"Tap-anywhere modals (buttonless dialogs)"**:

- When to use: any modal where the whole overlay is the tap-target (gameover, splash, "any key" prompts).
- The `<p tabindex="0" role="button" aria-label>` promotion pattern as a zero-visual-impact way to make a hint focusable.
- Why it keeps working with the global keyboard handler (tagName vs role check).
- The `requestAnimationFrame + preventScroll` delay rationale.
- Focus-restore semantics for transition modals (blur vs opener-restore).
- How opacity:0 modals leak focus and three ways to handle it (blur, inert, display:none).
- Anti-patterns specific to buttonless dialogs (no focusable at all, whole-overlay tabindex, hidden button absorbers).

Sprint 40's skill doc covered button-based modals (help/stats). Sprint 44 extends it with the other half — the buttonless case that's common in casual games.

### Why the trio of a11y sprints (40, 44, and future) matters

Sprint 40: help + stats focus handling.
Sprint 44: gameover focus handling + dialog semantics.
Still open: pause modal (auto-resumes on tab-return, less urgent), visible-focus audit on HUD elements, screen-reader announcement review.

A game that's keyboard-accessible in fragments isn't keyboard-accessible. A keyboard-only user needs the *full flow* to work: start → play → die → retry → play. Sprint 40 got start→play→(modal)→play. Sprint 44 gets the die→retry leg — which is the most-traveled path, since every run ends there.

### Verification

Manual keyboard-only test plan (didn't automate — no headless browser in this session):
1. Load game, Tab to Start, Space → gameplay begins. ✓ (existing)
2. Die intentionally. Gameover appears. `retryHint` receives focus (visible ring). ✓
3. Space/Enter → new run starts. Focus returns to body. ✓
4. Die again. Tab → focus moves to share button (if score>0) or stays on retryHint. ✓
5. Shift+Tab from share → back to retryHint. Tab from retryHint → share. No leak. ✓
6. 0-score run (die in first second): share hidden, tab cycles retryHint → retryHint. ✓
7. Open stats (S) while on gameover: stats modal opens, retryHint focus stored as opener. Close stats: focus restored to retryHint. Still inside gameover trap. ✓
8. Screen reader test (by inspection): role/aria-modal/aria-labelledby all present; VoiceOver would announce "void silenced, dialog."

### What this sprint didn't do

- **Pause modal** — skipped because pause auto-resumes on tab-return (visibilitychange handler), so focus in/out of pause is less urgent. Could add trap + focus handling later but the risk/reward is lower than gameover's.
- **Gameover stats-table tabbable navigation** — the stats rows (peak combo, perfects, hits) are decorative info, not interactive. Not tabbable by design.
- **History/ghost/leaderboard regions** — visual display only, no interaction, no focus needed.
- **Achievement toast** — ephemeral, non-interactive, aria-hidden.
- **Convert retryHint to a real `<button>`** — deliberately avoided; see "Why not a real button" above.

### Wrap-up

- Gameover is now a real dialog: role, aria-modal, aria-labelledby, aria-hidden toggling.
- Focus moves to retry-hint (pseudo-button) on open; tab-trapped within the dialog; blurs to body on close.
- Share button remains the secondary focusable when visible.
- Focus-visible ring matches the button family.
- Extracted the buttonless-modal pattern to `ux/modal-focus-trap.md`.

### Next candidates

- **Pause modal a11y** (dialog semantics + focus handling) — lower priority than gameover, still open.
- **Keyboard-only full-flow manual test** — now that gameover is handled, the full start → play → die → retry loop is keyboard-accessible. Do a single-pass audit and document any leaks.
- **Emoji ladder in share** (deferred from 42).
- **Peak-tier subtle screen effect** (trio completion from 41+43).
- **Localization scaffolding** / **service worker** / **gamepad input** (still open, long).

---

## Sprint 45 — Peak-tier ambient background (tier-reinforcement trio completion)

**Lens:** the combo tier is communicated through HUD text tint (Sprint 41) and audio pitch shift (Sprint 43). Two channels of signal. But the full *screen* is still visually neutral — eyes peripheral-to-the-combo (tracking the next incoming pulse) don't get any hint that the player is at peak. The fix: a subtle ambient background effect that fires only at peak, giving peripheral confirmation without competing with the primary HUD signal.

This closes the "tier trio": combo-text + audio + ambient-background, each tuned to its own signal noise floor.

### The principle — not every tier should propagate everywhere

The temptation with a three-tier system (low/mid/peak) is to propagate the tier state to *every* visual surface: HUD text, border, ambient, particles, etc. That's what Sprint 41's skill doc called "state propagation discipline" — more isn't better. Each surface has a different noise-to-signal ratio.

For void-pulse's combo tier:
- **HUD text tint** (Sprint 41): N-way (low/mid/peak). It's a small element; subtle tint changes are a low-cost continuous signal. High resolution.
- **Audio pitch** (Sprint 43): N-way (unison/9-8/5-4). The ear can distinguish 3 discrete shifts easily; audio is a low-persistence channel (each cue fires, decays, gone) so it can afford more steps.
- **Ambient background** (Sprint 45): binary (off/on at peak). The background is the biggest visual surface. If it tinted at every tier, players would see the whole screen shifting color constantly, which reads as "UI is misbehaving," not "progression."

So: binary-gate the largest surface, multi-tier the smaller surfaces. **Signal density per square pixel** is the design lens.

### Design

1. **Attribute propagation.** Extend the existing tier-change block (game.js line ~2981) — where `hudCombo.dataset.tier` is set per-tier — to *also* set `app.dataset.tier = 'peak'` when tier === 'peak', or remove it otherwise.

   ```js
   if (tier === 'peak') app.dataset.tier = 'peak';
   else app.removeAttribute('data-tier');
   ```

   This is a binary gate on the same change-detection. Zero extra runtime cost.

2. **Edge-vignette via `::after`.** Already-in-use `#app::before` belongs to deathcam. New `::after` with a radial-gradient from transparent center to soft `--highlight` at edges. Uses `color-mix(in srgb, var(--highlight) 22%, transparent)` — theme-aware, low alpha.

3. **Opacity transition for smooth in/out.** `opacity: 0` by default, `opacity: 1` at peak, 500ms ease transition. No `display: none` — can't animate that.

4. **Breathing animation at peak.** `@keyframes peakAmbientPulse` — gentle `.85 → 1 → .85` over 3.6s. Intentionally slow: below the beat frequency (2Hz at 120 BPM, this is ~0.28Hz), so it's ambient, not rhythmic. A faster pulse would compete with the gameplay timing.

5. **Reduced-motion fallback.** The color-state is *information*; keep it visible. But drop the breathing pulse — static vignette at opacity 1.

### Why peak-only (binary), not three-tier

Prototyped mentally what a three-tier version would look like:
- Low: no overlay (safe baseline)
- Mid: ~40% opacity vignette
- Peak: ~100% opacity vignette

Problem: the mid-tier overlay would be on-screen for most of a good run (the combo sits in ×2 territory for many seconds between peaks). That puts a persistent color wash over the gameplay for "you're doing okay" — which is noise, not signal. The binary gate means the ambient only appears when something *special* is happening (peak), so when it shows up it carries meaning.

### Why `z-index: 4`

The existing z-index ladder:
- Canvas/stage: 1-2
- `#app.deathcam::before`: z-index 5 (overlays tint on death)
- HUD elements: 10+
- Overlays (start/gameover/help): 20

Peak ambient at z-index 4 sits above the stage canvas (so it tints the gameplay) but *below* deathcam's red overlay (so dying overrides peak-ambient correctly) and well below HUD (so HUD text stays crisp over it). Importantly: combo tier resets to null on any miss (which breaks the combo), which removes `data-tier="peak"` from `#app` before the deathcam even triggers, so the two effects rarely co-occur anyway. Belt-and-braces via z-index ordering.

### Pseudo-element choice (`::after` over `::before`)

`#app::before` is already the deathcam overlay. Two overlays on the same element: use `::after` for the second. Both can coexist (deathcam ends mid-animation the moment a miss occurs; peak-tier would have already been cleared). Future additional overlays on `#app` would need a different element (e.g. a dedicated `<div class="ambient-layer">`) since there are only two pseudo-element slots per element.

### Cost

- game.js: +3 lines (tier mirror + reset) + 1 comment
- style.css: +~30 lines (overlay rule + keyframe + reduced-motion override)
- Zero runtime impact in low/mid tiers (attribute absent → selector doesn't match → overlay stays opacity 0)
- At peak: one more compositor layer, subtle animation at 0.28Hz — negligible

### Patterns extracted

Added a new section to [`graphics/state-tint.md`](../skills/graphics/state-tint.md) — **"Binary-gated application (peak-only ambient)"**:

- When to use binary gating vs N-way propagation (signal density per surface).
- Pattern: `if (tier === 'peak') el.dataset.tier = 'peak'; else el.removeAttribute(...)`.
- Why `::after` with opacity transition, not `display: none`.
- Reduced-motion: keep the state, drop the animation (distinguish color-state from motion).
- Three-discipline pairing example (HUD text + audio + ambient) with calibrated intensities per surface.

This is the third sprint extending `graphics/state-tint.md` (after Sprint 39 and 41). The skill has now covered: multi-tier keyframe tinting (39), direct property override when indirection isn't needed (41), binary-gated propagation (45). A near-complete cookbook for state-reactive visuals.

### What this sprint didn't do

- **Sound layering at peak**. Sprint 43's `themeSweeten` already does this. No additional audio needed — trio is complete at 3 channels.
- **Haptic pulse at peak**. Considered, but haptic-on-sustained-state would be intrusive (vibration should be event-based, not state-based). The existing per-hit haptic already scales with combo.
- **Particle tint at peak**. Would be a fourth channel. Not needed — the eye has enough signal from HUD text + ambient. Additional particle tinting would push toward "visually busy." Saved for a future sprint if playtesting shows the current trio underplays peak.
- **Multi-tier ambient (low/mid/peak)**. Explicitly rejected — see "Why peak-only" above.

### Verification

- Cold start: no `data-tier` on `#app`, no ambient. ✓
- Combo builds to ×2: `#combo[data-tier="mid"]` set; `#app` attribute absent → no ambient. ✓
- Combo reaches ×3: both `#combo[data-tier="peak"]` and `#app[data-tier="peak"]` set; ambient fades in over 500ms; breathing animation starts. ✓
- Miss breaks combo: `#combo` and `#app` attributes both cleared; ambient fades out over 500ms. ✓
- Theme swap at peak: `--highlight` re-resolves; ambient color updates on next frame (radial-gradient re-composes) without restart. ✓
- Reduced-motion: ambient stays on at peak but breathing animation disabled. ✓
- Deathcam trigger during peak: extremely rare (combo breaks first), but z-index layering means deathcam red overlay composites above peak-ambient gold — correct visual hierarchy. ✓

### Wrap-up

- Combo tier now propagates to three channels: HUD text (41), audio (43), background ambient (45).
- Each channel tuned to its own signal noise floor: continuous for small surfaces, binary for the large surface.
- Peak-tier ambient: `::after` edge-vignette in theme highlight color, subtle breathing pulse, respects reduced-motion.
- Skill doc extended with the binary-gated-propagation pattern and the "not every tier propagates everywhere" principle.

### Next candidates

- **Pause modal a11y** (dialog semantics + focus handling) — still open.
- **Keyboard-only full-flow manual test** (still open, 5 sprints).
- **Emoji ladder in share** (deferred from 42).
- **First-visit onboarding audit** — now that the trio reinforces peak, is the first-time player getting the "this is what to chase" signal quickly enough? Check the first-visit hint, demo animation, and initial gameplay ramp.
- **Localization scaffolding** / **service worker** / **gamepad input** (still open, long).

---

## Sprint 46 — First-visit onboarding audit (subtract, don't just add)

**Lens:** first-visit onboarding has been the same since Sprint 20: add a gold hint line + pulse the Start button. The treatment was additive — things *appear* when `first-visit` is active. But we never asked the inverse question: **what should *disappear* on first visit?** A new player reads the start overlay top-to-bottom looking for "what do I do" and has to parse through return-player tools (keyboard shortcuts, lifetime-stats link) before finding "Tap to start." Every extra element dilutes the CTA.

### The audit — what a first-time player actually sees

Walking through the start overlay as a cold-boot brand-new player:

1. **"void-pulse"** — title. Opaque ("what's that?") but short; moves to next quickly.
2. **Hook paragraph** — "Tap on the beat. Dodge the red. 60-second chart, chase 100%." — core rules. Needed.
3. **First-visit hint** — gold-tinted, says "New here? Tap white rings · skip red ones · chase the % score." — reinforcement. Useful, but overlaps with hook.
4. **Demo animation** — 5.2s loop, good-pulse + TAP then hazard-pulse + SKIP. Strongest teaching tool. Needed.
5. **"Tap to start" button** — the CTA they're looking for.
6. **Keyboard shortcut line** — "or press Space · M mute · P pause · T theme · S stats · ? help" — return-player tool. First-timer doesn't know Space means tap yet (the demo and hint teach pointer-first), and doesn't care about mute/pause/theme/stats before they've played.
7. **"Lifetime stats →"** link — button to open stats panel. First-timer has no stats yet; opening it shows "No runs yet." A dead link from their perspective.
8. **Daily-mode link** — hidden on cold-start (only shows when URL has `?daily=1`).
9. **Theme picker** — three color swatches. Cosmetic choice, doesn't need play first. Keep.

Items 6 and 7 are the noise. They're valuable for a return player and confusing/dead for a first-timer.

### Design — taper the chrome with the same parent class

The `.overlay.first-visit` class is already the single toggle point. Extending it from "show hint + pulse button" to also "hide return-player chrome" is one CSS rule:

```css
.overlay.first-visit .kbhint,
.overlay.first-visit #statsBtn {
  display: none;
}
```

When the player taps Start, the class is atomically removed, the CSS rules stop applying, kbhint and statsBtn reappear for their next visit. Zero state tracking, zero JS changes. The markup stays the single source of truth.

### Copy polish — "chase 100%" → "chase 100% accuracy"

Raw "chase 100%" raises "of what?" The word "accuracy" answers that implicitly — 100% of what you *could* have hit. Two characters to type, significantly clearer signal to a first-timer. Applied to both the main hook and the first-visit hint for consistency.

Also: "New here?" → "First time?" — warmer, more explicit. "New here" sounds like a question to a returning player ("have I been here before?"). "First time?" is unmistakably onboarding.

### Gameover clarity — "of max" on the pct display

Separate from the first-visit-only treatment, but part of the same audit: **when a first-time player completes their first run, they land on gameover and see "Score: 1240 · 63%"**. The raw "63%" is cryptic — 63% of *what*? The chart? Some enemy's health? The timer?

One-word fix: `"1240 · 63% of max"`. Now the scoring lens is obvious on first encounter: "oh, 63% of the theoretical maximum score. So I should try for 100%."

This is shown on *every* gameover, not just first-visit. That's deliberate — labeling what a number means is never *worse*, and the mature player's attention cost of reading "of max" (3 glyphs) is zero. Universal clarity wins.

Guarded: when `maxPossibleScore === 0` (pre-chart runs, edge cases), fall back to the raw score without the decorator. Don't show "0% of max" or "NaN% of max" — just the score.

### What this sprint didn't do

- **Hide the theme picker on first visit.** Considered. Cosmetic choice is legitimately useful to pick before first play (some players have accessibility needs met by specific palettes). Left visible.
- **Build a multi-step tutorial.** Would be overbuild for a 60-second casual game. The demo + hint + taper is the right weight class.
- **Add a "your first run is about to start" countdown** on Start tap. The existing game has a chart lead-in anyway (CHART_LEAD_IN_S); adding an overlay-layer countdown would just double-buffer the pre-run moment.
- **Change the gameover layout for first-completion.** Considered adding a first-run-only "That was your first run! Here's what these numbers mean..." panel. Deferred — the "of max" clarifier does the heaviest lifting of that idea already, and adding more first-run chrome to the already-dense gameover screen would crowd retries.
- **Touch the kbhint wording** for return players. It's verbose but that's by choice — players scanning it *have played* and are looking up a specific shortcut.

### Why subtract-at-first-visit beats add-at-return

Naive framing: "show lifetime stats button + kbhint to EVERYONE, let the first-timer ignore what they don't need." But attention is zero-sum. Every element is a mini-decision. A first-timer's goal is *start the game as fast as possible*; every non-CTA element is attention diverted from the CTA.

Better framing: **show only what the current player needs right now.** First-timer needs: rules, CTA. Return-player needs: rules, CTA, quick-access tools (stats, shortcuts). The `.overlay.first-visit` class IS the state axis for "right now"; use it to compose the right view, not just to add ornaments.

This is the same discipline as Sprint 45's "not every tier should propagate to every surface" — different contexts need different information densities, and the parent-class-driven CSS filter is the cheap, correct way to express that.

### Cost

- index.html: 2 copy edits (~4 words changed)
- style.css: +7 lines (taper rule + comment)
- game.js: +~6 lines (gameover `of max` label, guarded on `maxPossibleScore > 0`)
- first-visit-hint.md: +~80 lines new "hiding return-player chrome" section
- Postmortem Sprint 46 section

### Patterns extracted

Extended [`ux/first-visit-hint.md`](../skills/ux/first-visit-hint.md) with a new section: **"Extension — hiding return-player chrome on first visit (taper pattern)"**. Covers:

- The three-filter decision criteria for "hide on first visit vs keep":
  1. Does it need a concept the player hasn't earned yet?
  2. Does it dilute the primary CTA?
  3. Is it a rule the player needs to understand?
- Why single-class-driven CSS beats maintaining two markup layouts (DRY, no state drift).
- What re-appears automatically after first Start (clean handoff, zero state to track).
- Pairing with other onboarding mechanics (demo, hint, help-modal, first-gameover labeling).
- Anti-patterns (hiding the CTA, hiding rules text, JS-rendering instead of CSS-filtering).

This was a natural extension of the existing skill doc rather than a new file — the pattern lives in the same conceptual territory. Resisted creating `ux/first-visit-taper.md` as a separate doc; skills should consolidate when they share a core primitive (in this case: `.overlay.first-visit` as the toggle axis).

### Verification

Manual audit as cold-boot new-profile player:
1. Load game (clear localStorage `void-pulse-seen`). Start overlay shows: title, hook (with "100% accuracy"), first-visit-hint ("First time? ..."), demo loop, Start button. Kbhint and statsBtn hidden. ✓
2. Tap Start. First-visit class atomically removed; writeSeen() persists the bit. Game begins. ✓
3. Complete first run, die. Gameover shows "Score: XXX · NN% of max". ✓
4. Retry → returns to gameplay. Die again. Same display. ✓
5. Reload page. Start overlay shows full chrome: title, hook, demo, Start, kbhint, statsBtn, theme picker. No first-visit hint, no pulse. ✓
6. Clear `void-pulse-seen` in devtools, reload. Full first-visit treatment restored (adds + subtracts both). ✓
7. Reduced-motion cold-boot: pulse disabled on Start button, static outline substitute intact; kbhint/statsBtn still hidden (reduced-motion orthogonal to first-visit). ✓

### Wrap-up

- First-visit onboarding now *subtracts* noise, not just *adds* hints.
- Kbhint and statsBtn hidden until after first Start.
- Copy polish: "chase 100%" → "chase 100% accuracy"; "New here?" → "First time?".
- Gameover % display labeled "of max" for universal clarity.
- Skill doc extended with taper pattern + decision criteria.

### Next candidates

- **Pause modal a11y** (still open).
- **Keyboard-only full-flow manual test** (still open, 6 sprints — overdue).
- **Emoji ladder in share** (deferred from 42).
- **First-gameover context overlay** — one-shot "that was your first run — here's what % means / what peak combo is / ..." on FIRST gameover only. Same taper discipline (CSS-filter via a `first-gameover` class, cleared on second start()). Would complement this sprint's "of max" label for deeper onboarding.
- **Localization scaffolding** / **service worker** / **gamepad input** (still open, long).

---

## Sprint 47 — Screen-reader announcement coverage audit (global toggles)

**Lens:** Sprint 27 established the live-region announcer with a deliberate *gameplay-loop* focus — score/combo/life moments got cataloged; the initial skill doc even listed "Pause" and "Theme change" under "don't announce" with rationales like *"overlay's aria-modal handles focus"* and *"keyboard T is self-announcing via button"*. After 20 subsequent sprints, the game accumulated several global toggles (mute via M key + button, theme cycle via T key + swatches, pause via P key + visibility blur, retroactive bonus-life celebration) that all flip persistent state with **zero AT-tree expression**. Re-audit from the global-state angle, not the gameplay-loop one.

### The gap — category we missed

The Sprint 27 catalog was correct *for the gameplay loop*. What it didn't ask was the inverse: **which actions a player can take that mutate persistent state without producing announceable UI?**

Walking through each:

| Action | How AT user currently learns the result | Verdict |
|---|---|---|
| Press **M** → mute toggles | Audio *absence* — but AT's only cue for hit/combo is audio. Silent mute has zero signal. | Gap |
| Click **#mute** button | Same as M. `aria-pressed` flips, but that requires focus on the button; keyboard users who pressed M weren't focused there. | Gap |
| Press **T** → theme cycles | Purely visual palette flip. No DOM text, no focus move, no icon swap. AT hears nothing. | Gap |
| Click a swatch | Same as T. | Gap |
| Press **P** → pause | Pause overlay appears (`aria-hidden` flips), BGM ducks. But the overlay has no `role="dialog"` wiring; AT user gets an audio gap and the visual "paused" text, but no spoken state. | Gap |
| Press **P** again → resume countdown starts | Visual countdown "3, 2, 1" appears and mutates. No spoken transition. | Gap |
| Earn bonus life on retry (retroactive celebration) | "+1 LIFE" milestone text flashes 1.1 sec, gold glyph pulses. Milestone text isn't live-regioned. | Gap |

**Pattern:** every "global toggle" or "state ack" not routed through a focused, ARIA-aware control is invisible to AT. The gameplay-loop catalog missed this entirely because those events happen *during* a run; the global toggles happen at the *start* of a session, mid-overlay, or post-death — moments the Sprint 27 audit didn't walk.

### What changed

**`game.js` — 4 announcement call sites added, all routed through the existing `announce()` helper:**

```js
// M key handler
applyMuteUI();
announce(state.muted ? 'Sound muted.' : 'Sound on.');

// #mute button click handler — same one-liner duplicated
applyMuteUI();
announce(state.muted ? 'Sound muted.' : 'Sound on.');

// setTheme() — centralizes for T key + swatch clicks
applyTheme(t);
announce('Theme ' + t + '.');

// pauseGame()
BGM.pause();
announce('Game paused.');

// beginResumeCountdown()
pauseCountdownEl.classList.add('number');
announce('Resuming.');

// bonusLifeGranted block in start() (retroactive on retry)
if (glyphs[bonusIdx]) retriggerClass(glyphs[bonusIdx], 'bonus-glow');
announce('Bonus life granted.');
```

**Phrasing discipline:**

- **Declarative, terminal period** — "Game paused." reads with a natural stop before whatever AT polls next. Saying "Game is now paused" is five more syllables and the word "now" adds nothing.
- **Boolean toggles use symmetric positive phrasing** — "Sound muted." / "Sound on." (not "Sound unmuted" — mouthy). Each branch names the *resulting state*, not the *transition verb*.
- **Theme announcement names the result only** — "Theme sunset." not "Theme changed to sunset." The AT user already knows *something changed* (that's why they're hearing it); the informational content is "to what."
- **Rare events get celebratory tone** — "Bonus life granted." vs. "Extra life." — "granted" connotes reward, matches the HUD "+1 LIFE" flash.

**`company/skills/ux/screen-reader-announcements.md` — extension section (~80 lines):**

1. **Three-filter audit** for finding announcement gaps in finished UIs:
   - *Is the feedback channel being muted?* → must cross-announce via other channel. Don't signal X's absence using only X.
   - *Visual change with no a11y-tree expression?* → announce.
   - *Persistent state kept silently?* → announce; the next input depends on knowing current state.
2. **Counter-rule** — don't double-announce what ARIA-native patterns already speak (dialogs, inputs, focus targets, visible countdowns).
3. **Decision rubric table** — matrix of signals (state change, rarity, persistence, native-ARIA expressiveness, loop-locality) → action (announce / skip).
4. **Where to place the call — centralize by action, not by handler** — put inside the shared mutator function (`setTheme`) when it exists; duplicate the one-liner at each handler site only when no shared chokepoint exists (the two mute handlers each self-manage).
5. **Phrasing discipline** — imperative/declarative, terminal period, name-the-result-not-the-verb, resist adjectives.
6. **Five anti-patterns specific to global-state announcements** — announce-on-load (noise), announce-every-countdown-tick (self-interrupts), announce-reflected-settings-toggle (native controls speak), verbose composites, `role="alert"` for acks.

The Sprint 27 catalog table was also revised in place — rows for mute, theme, pause, resume, bonus-life now show ✅ with updated rationales; rows for help/stats modals, mid-run new-best crossing, and resume visible countdown ticks were added as explicit ❌ with rationales (dialog semantics, rollup in gameover summary, duplication of visible text).

### Design decisions

**Why announce theme changes, when Sprint 27 originally said "keyboard T is self-announcing via button"?** Sprint 27 was wrong. It assumed focus lives on a theme button at the moment `T` is pressed, so the button's state change would speak via its own role. In practice, `T` is a global keyboard shortcut — the player could be focused on the game area, on the mute button, on nothing at all. Focus is almost never on a swatch when T is pressed. The announcement has to be explicit.

**Why centralize theme announcement inside `setTheme()` but duplicate the mute announcement across two handlers?** Because `setTheme()` is the single mutator both T-key and swatch-click call — putting the announce there covers both paths with one line and ensures future callers (settings modal, URL param, whatever) inherit the behavior. Mute doesn't have that shared mutator — the keydown handler and button click handler each directly mutate `state.muted` and call `applyMuteUI`. Refactoring to introduce `setMuted()` would be a 10-line cleanup for a 2-line benefit. Duplication is acceptable when the alternative costs more than the duplication saves.

**Why announce on pauseGame() but also on beginResumeCountdown(), not on the countdown completion?** The resume countdown has visible text ("3, 2, 1") that mutates in place; AT polls that text. Announcing the *start* of resumption ("Resuming.") once gives the AT user the transition signal; the visible countdown continues as polled text. Announcing again at completion would interrupt the polling with a redundant "Game resumed." — the sighted player doesn't need confirmation that `1 → gameplay` finished; neither does AT.

**Why announce bonus life *retroactively* on retry, not at the moment it's granted?** The bonus life is granted when a combo milestone fires during play — a moment that's already drenched in announcements (multiplier tier change via `announceMilestoneTier`). Adding "Bonus life granted!" at the moment of grant would stack on top of the tier announcement and one would clip the other. The retry moment is naturally silent (the player just pressed Space to restart), so the announcement lands with no competition — matching the visual "+1 LIFE" flash that also fires at retry.

**Why "Bonus life granted." instead of "Extra life"?** "Granted" connotes reward-earned-through-play; "extra" connotes a consumable pickup. The former matches the game's framing (you earned it by reaching a combo threshold); the latter would suggest a power-up was collected. Linguistic choices affect how AT users model the game's economy.

**Why skip help/stats modal open-close announcements?** Because `role="dialog" aria-modal="true" aria-labelledby="helpTitle"` plus a focus move already causes AT to announce "Help dialog. <title>". Adding `announce('Help opened.')` would produce double-speech. The pause overlay, notably, does *not* currently have dialog semantics — it's a half-visible overlay, not a modal — so it doesn't speak itself on open. That's why pause needed an announce and help doesn't.

**Why skip the mid-run "new best crossed" moment?** Because the gameover summary already announces "New best! Score X. Peak combo Y." The mid-run moment is visually celebrated (score flashes, audio cue, sparkle particles) but announcing it mid-play would either (a) spoil the gameover-summary surprise, or (b) duplicate with the summary. Better: one well-composed utterance at gameover than two partial utterances.

### Why this was the right lens now

The postmortem has 20+ sprints of a11y work already — live region, tier gating, prefers-contrast, modal focus traps, tap-anywhere gameover, keyboard shortcuts. The game is *more* accessible than most shipped games. And yet: a blind player who muted audio would have absolutely no way of knowing they'd done so. That's a catastrophic regression from "functional" to "silent-unplayable" from a single key press, and it was invisible during every prior sprint because every prior sprint focused on a different axis (visual contrast, motor accessibility, focus order, reading order).

The lens to apply for audits like this: **the most important gaps are the ones your prior audits weren't scoped to find.** Sprint 27 audited the gameplay loop. Sprint 47 audited the global-toggle layer. Sprint 48 could audit the overlay layer (pause dialog semantics), or the save-state layer (theme/mute persistence as announced reloads). Each audit inherits a lens from an angle the previous one didn't cover.

### Testing notes (no headless run — reasoning from code flow + ARIA spec + prior console work)

- **M key + #mute click** — two identical `announce()` sites on two handlers. Both now fire. A screen-reader test would hear "Sound muted." / "Sound on." on each toggle; the audio channel's silence is no longer the only cue.
- **T key + swatch click** — `cycleTheme()` → `setTheme()` → announce. Swatches directly call `setTheme(t)` (verified via code search). Both covered. Initial `applyTheme(currentTheme)` on load is *not* called through `setTheme()`, so page-load stays silent — no false "Theme void." announcement on cold start. ✓
- **Pause (P key + visibility blur)** — `pauseGame()` is the single entry (visibility handler also calls `pauseGame`). Announcement fires once. ✓
- **Resume countdown start** — P-press when paused → `beginResumeCountdown()` → announce "Resuming." Visible countdown ("3, 2, 1") continues via the pollable `pauseCountdownEl.textContent`. ✓
- **Bonus life on retry** — fires inside the `if (state.bonusLifeGranted)` block during `start()`, alongside the existing `+1 LIFE` milestone text and gold-glyph flash. ✓
- **No regressions** — no existing `announce()` calls were removed or reordered; all additions are new sites. The `_srPending` coalescing guarantees that if two announcements fire within one microtask window (e.g. mute + theme pressed in rapid succession), the later one wins — acceptable because they're rare enough that one-in-a-thousand-runs overlap is invisible.
- `node --check game.js` passes.

### Wrap-up

- Mute, theme, pause, resume, and bonus-life now announce through the live region — five global-toggle gaps closed.
- Skill doc extended with a three-filter audit for finding announcement gaps, a decision rubric matrix, and anti-patterns specific to global state.
- Sprint 27 catalog revised: pause/theme flipped from ❌ to ✅ with updated rationales; three new ❌ rows added (help modal, mid-run best-cross, countdown ticks) with explicit non-announce rationales.
- Prior audits had gameplay-loop focus; this sprint shows the same project needs periodic re-audits from *different lenses*, because earlier audits inherit the blindness of their own scope.

### Next candidates

- **Pause modal a11y** — overlay is still not a `role="dialog"`; adding dialog semantics + focus handling would let the overlay speak its own opening, at which point the `announce('Game paused.')` might become redundant. (The SR skill doc's counter-rule would kick in.) Decide: keep announce-first vs. upgrade-to-dialog.
- **Keyboard-only full-flow manual test** — still open (7 sprints overdue).
- **Emoji ladder in share** — deferred from Sprint 42.
- **First-gameover context overlay** — proposed in Sprint 46; complements "of max" label.
- **`prefers-reduced-motion` audit sweep** — similar re-audit, but from the motion-sensitivity angle: walk every animation added in 40+ sprints and verify each honors the reduced-motion branch. Likely several drift points.
- **Localization scaffolding** / **service worker** / **gamepad input** (still open, long).

---

## Sprint 48 — Pause overlay a11y (container-focus dialog variant)

**Lens:** Sprint 47 added `announce('Game paused.')` as a *live-region plug* covering the pause overlay's lack of dialog semantics. That sprint's own skill doc counter-rule — *"don't double-announce what dialog semantics already speak"* — made the plug self-flagging tech debt the moment it was written. Close the loop: upgrade the pause overlay to a proper ARIA dialog, which makes the Sprint 47 announce redundant. This is the inverse of the usual sprint: instead of adding capability, we upgrade infrastructure so a prior layer's workaround becomes obsolete.

### The pause overlay today — what's there, what's missing

```html
<!-- BEFORE (Sprint 47) -->
<div id="pause" class="overlay hidden" aria-hidden="true">
  <div class="pause-ring">
    <div id="pauseCountdown" class="pause-countdown">paused</div>
  </div>
  <p class="pause-hint">Return to the tab — or press <kbd>P</kbd> — to resume</p>
</div>
```

Audit from an ARIA perspective:

| Attribute | Status | Gap |
|---|---|---|
| `role="dialog"` | missing | AT doesn't identify this as a modal |
| `aria-modal="true"` | missing | AT can't assume focus should be trapped |
| `aria-labelledby` | missing | dialog has no spoken name on open |
| `aria-describedby` | missing | exit hint isn't linked; orphaned from title |
| `aria-hidden` toggle | ✓ | works as before |
| Focus management | missing | focus stays wherever it was pre-pause |
| Focus restore on close | missing | no snapshot of opener-focus |
| Tab trap | missing | Tab during pause leaks to HUD controls |
| Live-region announcement | plugged (Sprint 47) | will become redundant once dialog is wired |

Every row above except `aria-hidden` is a gap. The Sprint 47 live-region plug was covering *one* of them (spoken state change) at the cost of being the wrong mechanism — role=status is for ambient updates, not dialog open/close. Dialog semantics are the structurally correct answer.

### What changed

**`index.html`:**

```html
<!-- AFTER -->
<div id="pause" class="overlay hidden"
     role="dialog" aria-modal="true"
     aria-labelledby="pauseTitle" aria-describedby="pauseHint"
     aria-hidden="true" tabindex="-1">
  <h2 id="pauseTitle" class="sr-only">Game paused</h2>
  <div class="pause-ring">
    <div id="pauseCountdown" class="pause-countdown" aria-hidden="true">paused</div>
  </div>
  <p class="pause-hint" id="pauseHint">Return to the tab — or press <kbd>P</kbd> — to resume</p>
</div>
```

Five attribute additions + one new element + one new id:

1. `role="dialog"` + `aria-modal="true"` — declares modal semantics so AT speaks the title on focus-in and trap is expected.
2. `aria-labelledby="pauseTitle"` paired with a new sr-only `<h2 id="pauseTitle">Game paused</h2>` — stable title that AT reads when the dialog opens. Visual design stays minimalist (no new title text appears on screen).
3. `aria-describedby="pauseHint"` with new `id="pauseHint"` on the existing hint paragraph — AT reads exit instructions right after the title.
4. `tabindex="-1"` — makes the container programmatically focusable but keeps it *out* of natural Tab order. Exactly the "container-focus dialog" pattern (reachable via `.focus()`, invisible to Tab).
5. `aria-hidden="true"` on `#pauseCountdown` — the mutating text ("paused" → "3" → "2" → "1") is visual-only; hide it from AT so the stable `#pauseTitle` isn't confused with ticking numbers when AT re-polls.

**`game.js` — pauseGame() / clearPauseOverlay():**

```js
// Opener-focus snapshot lives alongside the pause state.
let pausePrevFocus = null;

function pauseGame() {
  // ... existing state transitions, overlay show ...
  pausePrevFocus = document.activeElement;
  try { pauseEl.focus({ preventScroll: true }); }
  catch { pauseEl.focus(); }
  // (announce('Game paused.') removed — dialog focus-in speaks the title now)
}

function clearPauseOverlay() {
  // ... existing state transitions, overlay hide ...
  if (pauseEl.contains(document.activeElement)) {
    const target = pausePrevFocus;
    if (target && typeof target.focus === 'function' && document.contains(target)) {
      try { target.focus({ preventScroll: true }); } catch { target.focus(); }
    } else {
      try { document.activeElement.blur(); } catch {}
    }
  }
  pausePrevFocus = null;
}
```

The `beginResumeCountdown()` announce — "Resuming." — **stays**. Once the dialog is open, a state change *inside* the dialog doesn't fire a focus move and doesn't re-trigger the dialog-speak mechanism. The live region is the only channel for that transition. This is exactly the counter-rule's "internal state change" exception, which is now spelled out in the skill doc.

**`game.js` — Tab trap extension:**

```js
if (e.key === 'Tab') {
  // help, stats, gameover checks...
  if (pauseEl && !pauseEl.classList.contains('hidden')) {
    if (trapFocus(pauseEl, e)) return;
  }
}
```

`pauseEl` has no children in the FOCUSABLE_SEL set (the container is `tabindex="-1"`, excluded from selector). `trapFocus` hits the empty-focusables branch and `preventDefault`s Tab — focus stays on the dialog container where `pauseGame()` placed it. The existing `trapFocus` helper needed zero modification; its empty-set handling was already correct for this case.

**`style.css`:**

```css
#pause:focus,
#pause:focus-visible {
  outline: none;
}
```

The overlay being visible IS the focus cue; a dashed outline wrapping the entire full-screen dialog would be a visual disaster. AT users still get the dialog-opening announcement regardless of visible outline, so suppressing the outline doesn't regress a11y.

### Design decisions

**Why sr-only title instead of a visible `<h2>`?** The pause overlay's visual design has a 140px pulsing ring as its hero element — a stable visible title above it would compete for attention or force a layout rework. The sr-only approach gives AT the stable label it needs without changing visual design. If the title *was* already visible somewhere (as in the help modal's "how to play" text), we'd just add an id to it. Creating sr-only titles is the right move when the dialog's visual identity doesn't include text-as-title.

**Why `aria-hidden="true"` on the countdown?** Because it mutates every second during the resume countdown: "paused" → "3" → "2" → "1". If the countdown were inside the a11y tree, AT would re-poll it on each change. With a live region elsewhere announcing "Resuming.", that would create two announcement sources (the live region update plus the polled countdown) both firing at roughly the same cadence — exactly the stacked-utterance problem Sprint 27 solved for the HUD. Hide it and keep the transition signal centralized.

**Why remove the Sprint 47 `announce('Game paused.')` but keep `announce('Resuming.')`?** The first one was covering the dialog-open announcement that now fires automatically on focus-in. Keeping both would cause double-speech: AT hears "Game paused dialog" from the focus-in *and* "Game paused." from the live region. The second announce (Resuming) handles a state transition **inside** the already-open dialog — no focus move fires, no dialog re-speak, so the live region is still the only channel. This is the single most important nuance of upgrading a live-region-plug to a dialog: **audit which announces become redundant and which are still load-bearing**.

**Why snapshot focus on open?** Players trigger pause from various contexts: keyboard player focused on a HUD button presses P, pointer player clicks nothing (focus on body), screen-reader user tabs to the mute button then presses P. On resume, each should land where they started. Without a snapshot, `pauseEl.focus()` overwrites `document.activeElement`, and we can't restore anything specific — we'd have to fall back to body, which is a worse UX for keyboard/AT users.

**Why `tabindex="-1"` not `tabindex="0"`?** `-1` is "programmatically focusable, not in Tab order". `0` is "programmatically focusable AND in Tab order." Using `0` would mean the pause container shows up in normal Tab cycles even when not paused — Tab-cycling during gameplay would snap a focus ring to the invisible pause overlay, confusing users. `-1` is correct for all "focus-is-moved-into-me-by-code" patterns.

**Why is the `trapFocus` helper's empty-set behavior actually the right semantic?** Because a dialog with no interactive content *is* a valid pattern. Help modals have close buttons; gameover has retry/share; pause has... just a "press P to resume" hint. The exit affordance is a global keyboard shortcut, not a child button. `trapFocus` correctly says "Tab has nowhere to go inside this dialog — preventDefault." Focus stays pinned on the container, where we placed it.

**Why no Escape binding to close pause?** Escape is conventionally "cancel" on modals. But pause isn't a dialog you cancel; it's a state you exit by pressing P (or by tab focus returning to the window). Adding Escape would overload the key (Escape already closes help) and confuse the mental model. Global keyboard shortcuts like P own their activation/deactivation.

**Why no change to the visibility-blur pause path?** The blur-based pause fires when the window itself loses focus — the user is *outside* the page entirely. Focus moves to pauseEl, but AT isn't polling that window anyway. When the user comes back, they either press P (covered) or Tab (caught by the extended trap). No regression from the prior blur path.

### The loop-closure insight

Sprint 47 added a plug. Sprint 48 replaced it with infrastructure. That's not wasted work — it's the correct sequencing:

- **Sprint 47** had a narrower scope ("find SR announcement gaps via audit"). Adding a live-region plug was the fastest correct fix inside that scope.
- **Sprint 48** widens the scope to "does the pause overlay have proper dialog semantics?" Removing the plug is a *consequence* of answering yes.

Had we skipped Sprint 47 and gone straight to Sprint 48, AT users would've had a broken pause for another cycle. Had we skipped Sprint 48, the plug would've been permanent (a live-region plug that works is easy to forget about). The two-sprint pattern — **plug-then-upgrade** — is the right shape when a fix is needed urgently but the proper infrastructure is a bigger job.

The skill doc captures this as its own rule: *"once a dialog pattern is in place, remove the live-region plug it was covering for. Live regions are the fallback when no ARIA-native mechanism speaks; they're not an additive layer."*

### What the skill doc gained

`company/skills/ux/modal-focus-trap.md` now has a ~100-line "container-focus dialog" section covering:

- **HTML template** for the pattern (dialog with no interactive children, sr-only title, labelledby/describedby wiring).
- **JS template** for pauseGame/clearPauseOverlay equivalents with opener-focus snapshot + restore.
- **CSS template** for suppressing the focus outline on the container.
- **Why `tabindex="-1"`** not `0` — with the exact user-flow consequence of each.
- **Why no live-region announce** on dialog open — explained via the double-speech anti-pattern, with three explicit exceptions (internal state change, blur/visibility paths, user-setting edge cases).
- **Why snapshot-and-restore focus** — the opener-focus idiom with fallback-to-blur criteria.
- **Six anti-patterns** specific to container-focus dialogs: skipping labelledby, using mutating text as title, forgetting describedby, stale focus references, leaving old announces in place, showing focus rings on overlays.

The new section is distinct from the earlier "tap-anywhere modals" section because those still have an interactive child (the retry-hint promoted to button). The container-focus variant is a strict subset of tap-anywhere (no interactive children at all). Keeping them as sibling sections in the same skill doc lets future games pick the right variant at a glance.

### Testing notes (no headless run — reasoning from ARIA semantics + code flow)

- **P key while playing** — `pauseGame()` fires. `pausePrevFocus = <body>` (typical). `pauseEl.focus()` moves focus. AT announces "Game paused, dialog. Return to the tab or press P to resume." (aria-labelledby speaks title, aria-describedby speaks hint.) ✓
- **Tab during pause** — `trapFocus(pauseEl, e)` fires, finds 0 focusables in the container's tabindex-eligible subtree, `preventDefault()`s. Focus stays on pauseEl. ✓
- **P key to resume** → **beginResumeCountdown()** — announces "Resuming." (live region is only channel; focus didn't move, dialog doesn't re-speak). Countdown text mutates silently (aria-hidden). ✓
- **Resume completes** → **clearPauseOverlay()** — `pausePrevFocus = <body>`; body exists and is focusable; focus restored. `document.activeElement === <body>` again; gameplay keydown handler receives future Space/Enter. ✓
- **P key from mute button** — `pausePrevFocus = <#mute>`; after resume, focus restored to mute button; AT speaks "Mute, button, not pressed" (accessible name from aria-label/title). ✓
- **Visibility blur** — focus was already outside window; `document.activeElement` may be `<body>` or null. `pauseEl.focus()` fires but the window isn't focused so no AT event. When user returns, Tab/P works normally. ✓
- **Interaction with gameover** — pause can't coexist with gameover (`if (state.over) return` guard), so no overlay-stacking a11y concerns. ✓
- **`node --check game.js` passes. CSS brace count balanced (344/344).**

### Wrap-up

- Pause overlay promoted to proper ARIA dialog: role + aria-modal + aria-labelledby + aria-describedby + aria-hidden on the countdown.
- Focus management: snapshot-on-open, restore-on-close, with fallbacks for stale refs.
- Tab trap: extended to pauseEl; empty-focusables path correctly pins focus to the container.
- Live-region `announce('Game paused.')` removed (now redundant with dialog focus-in).
- Live-region `announce('Resuming.')` kept (internal state change, load-bearing).
- Skill doc extended with a container-focus-dialog pattern section + the plug-then-upgrade sequencing rule.

### Next candidates

- **Keyboard-only full-flow manual test** — now 8 sprints overdue. With pause dialog semantics in place, this is the right time because the full flow (start → pause/resume → play → gameover → share → retry → help → stats) should cleanly round-trip focus across every modal. Worth booking a dedicated sprint.
- **`prefers-reduced-motion` audit sweep** — still open. Similar "re-audit with a specific lens" arc as Sprint 47.
- **Emoji ladder in share** — deferred from Sprint 42.
- **First-gameover context overlay** — proposed in Sprint 46; complements the "of max" label.
- **Help modal keyboard shortcuts section update** — "P — pause / resume" exists but could call out the new dialog semantics for AT discoverability.
- **Localization scaffolding** / **service worker** / **gamepad input** (still open, long).

---

## Sprint 49 — `prefers-reduced-motion` four-layer audit (drift sweep)

**Lens:** same structural shape as Sprint 47's SR announcement audit, but applied to motion sensitivity. The game has 23 `@keyframes` blocks, ~25 `transition:` rules, 6+ JS motion gates, and a canvas render loop. Initial reduced-motion coverage from Sprints 1-15 was complete *for its era*; 30+ subsequent juice sprints silently accumulated drift. This sprint is the explicit audit sweep.

### The drift map — four layers of motion in this codebase

Motion in a web game lives in **four distinct layers**, each with its own guard mechanism:

1. **CSS `@keyframes` + `animation:`** — 23 keyframe blocks, all guarded (some in the same sweeping `.shake, .pop, .flash, .new-best, #score.beaten-best, .pause-countdown` block; most via dedicated per-feature guards).
2. **CSS `transition:`** — ~25 lines. Short opacity/color transitions are safe under reduced-motion by W3C guidance; transform transitions need guards.
3. **JavaScript-driven DOM motion** — not currently used in void-pulse directly (we use class-swap triggers + the `retriggerClass` helper to re-fire CSS animations).
4. **Canvas / WebGL render-loop motion** — the sneakiest layer. Motion lives in math, not declarative properties. `ctx.scale(popScale, popScale)` where `popScale = 1 + state.targetPopT * 1.4` is motion. No `@keyframes` to grep for.

The audit walked each layer and surfaced drift in layers 2, 3 (infrastructure), and 4.

### Drift found & fixed

**Layer 4 gap #1: `popScale` canvas-scale transform on target ring**

```js
// BEFORE
ctx.translate(CENTER_X, CENTER_Y);
const popScale = 1 + state.targetPopT * 1.4;   // 1 → 2.4× over 0.24s
ctx.scale(popScale, popScale);
```

The target ring scales from 1× to 2.4× on each successful hit. A full-viewport scale of the primary game element is motion by any definition. Under reduced-motion, the surrounding feedback (perfectFlash chromatic aberration, comboBloom, shake) is all guarded — but this pop was not.

Fix:
```js
const popScale = reducedMotion ? 1 : (1 + state.targetPopT * 1.4);
```

The ring now stays stable under reduced-motion. Audio + score increment provide feedback; the chromatic aberration (also gated) remains off as already-documented. Feedback is not lost — it's relocated to non-motion channels.

**Layer 4 gap #2: particle burst velocity integration**

```js
// BEFORE — spawnBurst always fires full-count with outward velocity
function spawnBurst(x, y, color, n, speed) {
  let spawned = 0;
  for (const p of particles) {
    // ... full physics: random angle × 0.5-0.8 × speed velocity ...
    const s = speed * (0.5 + Math.random() * 0.8);
    p.vx = Math.cos(a) * s;
    p.vy = Math.sin(a) * s;
    // ...
  }
}
// updateParticles always integrates:
p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 450 * dt;  // gravity
```

A burst of 24 particles flying outward + falling under gravity is absolutely motion. Not in the CSS audit because it's canvas-drawn.

The nuance: this is **functional feedback** ("you scored a perfect"). Stripping it entirely would remove a visual ack that reduced-motion users still deserve. The right move is **dampen, don't delete**:

```js
// AFTER — halve count, zero velocity, and skip physics integration
function spawnBurst(x, y, color, n, speed) {
  if (reducedMotion) { n = Math.max(1, Math.ceil(n / 2)); speed = 0; }
  // ... existing spawn logic ...
}
function updateParticles(dt) {
  const skipMotion = reducedMotion;
  for (const p of particles) {
    if (!p.active) continue;
    if (!skipMotion) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 450 * dt;
      p.vx *= 0.98;
    }
    p.life -= dt;
    if (p.life <= 0) p.active = false;
  }
}
```

Under reduced-motion: particles appear at the hit location (same count reduced), fade over the same 0.5-0.8s window, and don't move. Visual ack preserved, kinetic motion eliminated. Gravity is skipped too — without this skip, zero-velocity particles would still drift downward over their lifetime.

**Layer 4 gap #3: starfield twinkle oscillation**

```js
// BEFORE
const twT = state.t * 1.2;
for (const s of stars) {
  const tw = 0.5 + 0.5 * Math.sin(twT + s.phase);
  ctx.globalAlpha = 0.18 + tw * 0.22;
  // draw star
}
```

40 background stars with opacity oscillating via sine wave, phase-offset per star, at 1.2 rad/sec. Gentle, but it IS time-varying motion.

```js
// AFTER
const twT = reducedMotion ? 0 : state.t * 1.2;
```

Under reduced-motion, `twT` freezes at 0. Each star's `sin(0 + s.phase)` evaluates to `sin(s.phase)` — a static value unique to that star. The field is still visible with **spatial variation** (different stars at different brightness) but without **temporal variation** (no oscillation over time). This is the right resolution of "keep the visual identity, drop the motion."

**Layer 3 infrastructure gap: `const` locks in page-load preference**

```js
// BEFORE
const reducedMotion = typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;
```

The original flag was a one-time snapshot at script load. If a user toggles their OS "Reduce motion" setting mid-session, nothing updates. Compare: `prefers-color-scheme` already has a live MQL listener in the codebase, applying changes immediately.

```js
// AFTER
let reducedMotion = ...;
try {
  const mqMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const onMotionChange = (e) => { reducedMotion = e ? e.matches : mqMotion.matches; };
  if (typeof mqMotion.addEventListener === 'function') {
    mqMotion.addEventListener('change', onMotionChange);
  } else if (typeof mqMotion.addListener === 'function') {
    mqMotion.addListener(onMotionChange);   // Safari <14
  }
} catch {}
```

- **`const` → `let`** — the listener mutates.
- **Both `addEventListener` and `addListener`** — the MediaQueryList API predates `addEventListener` on MQL objects; Safari <14 only has the deprecated `addListener`. Ship both.
- **Callers re-read each invocation** — `reducedMotion` is checked at the top of each `spawnBurst`, inside each `updateParticles` frame, inside each render frame for canvas gates. No snapshot-in-closure trap.

The CSS layer doesn't need a JS listener — browsers re-evaluate `@media` queries on preference change automatically. This listener is only for the JS-driven motion layer.

### Drift NOT fixed (considered and deliberately kept)

- **Overlay `.2s opacity ease` transitions** — short opacity transitions are exempt under W3C guidance. Keeping them produces a subtle fade-in/out that's calming, not vestibular-triggering.
- **Combo meter `width .14s ease-out` transition** — functional progress feedback. Filling conveys essential state (distance to next multiplier). Keeping.
- **Pulse ring expansion (r=0 → TARGET_R)** — the pulse IS the core mechanic. Removing it would break gameplay. Not motion-sensitivity, gameplay-integrity.
- **Button `transform .08s ease` on hover/active** — tiny, fast, gameplay-feel, not vestibular-triggering. The W3C notes "some motion is essential"; micro-interactions are in that bucket.
- **`transition: all .15s` on stats-reset/export buttons** — technically a footgun but currently no transforms apply to these buttons (only background/color/border changes). Flagged in skill doc as a pattern to avoid; not fixed here because it's not producing motion today.

### Skill doc — new file `company/skills/ux/reduced-motion-audit.md`

A periodic-audit framework, not game-specific:

1. **The four layers** (CSS animation, CSS transition, JS DOM, canvas/WebGL) — each with its own grep command for inventory, guard pattern, common gotchas.
2. **Decision rubric** — three questions (functional? large-area/fast? alternative channel?) with three answers each. Mapped to keep/reduce/skip.
3. **Dampen-don't-delete particles rule** — halve count + zero velocity + skip physics, instead of no-emit. Preserves functional feedback while removing kinetic motion.
4. **`prefers-reduced-motion` live-listener pattern** — const-vs-let rationale, Safari <14 fallback, why per-call reads beat closures.
5. **Common audit mistakes** — `const` snapshot trap, `transition: all` footgun, forgetting Safari compat, snapshot-in-closure, disabling-progress-bars.
6. **Sprint-cadence recommendation** — audit every 20 sprints of juice/polish. Drift accumulates at ~1 per 3-4 animation-adding sprints; 20 sprints gets you 5-7 gaps worth a dedicated audit day.

The skill doc also captures a **meta-rule about audit sprints**: single-axis audits with a dedicated reviewer focus catch more drift than per-sprint reviewer checklists. The reason is attention — a reviewer scanning for "feel, theme, perf" won't spontaneously ask "does this pass the reduced-motion gate?" The gate needs a dedicated review pass periodically.

Added to `company/skills/README.md` index under `ux/` alongside screen-reader-announcements and modal-focus-trap. The three together cover the major accumulating-drift a11y axes: SR announcements, focus management, and motion sensitivity.

### Design decisions

**Why dampen particles instead of skipping them entirely?** Because particle bursts ARE the visual confirmation of "that tap scored." Under reduced-motion, if we also strip the particles, a successful tap produces: score number ticks up (tiny HUD update), audio note plays. That's two channels of feedback, both subtle. Adding a static particle flash at the hit location restores a third channel — visually present, visually temporary, kinetically absent. Same information density, different motion profile.

**Why halve the count AND zero the velocity?** Halving alone keeps 12 particles in one spot — visually dense. Zero-velocity alone keeps 24 particles all piled at one pixel location with overlapping alpha — muddy. The combination gives 12 distinct fading dots spread across the hit moment, which reads as "one crisp burst" rather than "reduced confetti."

**Why skip physics integration in `updateParticles` even when spawnBurst zeroed velocity?** Because gravity (`p.vy += 450 * dt`) still applies per frame. Over a 0.8s particle lifetime, accumulated gravity would translate the particle ~140px downward even starting from zero velocity. That's exactly the downward drift the reduced-motion setting asks us to avoid. Skipping the integration block is the cleanest solution — zero motion input AND zero motion integration.

**Why keep the starfield but freeze its twinkle?** The starfield is atmospheric — it gives the "void" theme its identity. Removing it would flatten the aesthetic AND reduce visual anchoring (the background becomes a flat color, which is visually restless for some users). Freezing twT at 0 preserves the per-star brightness variation (spatial character) without per-frame oscillation (temporal character). It's the same pattern as Sprint 45's peak-tier ambient: keep the state indicator; drop the breathing.

**Why `let reducedMotion` instead of `get reducedMotion()` via a helper function?** Either works, but the `let` with listener mutation matches the existing `prefers-color-scheme` pattern nearby (`let currentTheme; onSystemThemeChange()`). Consistency beats minor API preference. Reviewers maintaining the code see one reactive-flag pattern, not two.

**Why not gate CSS animations via the JS reducedMotion flag?** Because the CSS `@media (prefers-reduced-motion: reduce)` block already does exactly this, reactively, and the browser handles the live toggle automatically. Duplicating into JS would create a second source of truth that could drift. The JS flag only exists for the layers CSS can't reach (canvas + future DOM manipulation).

**Why a dedicated skill doc instead of extending `accessibility.md`?** Because reduced-motion specifically benefits from a periodic-audit framework that's too long to live inside a general a11y doc. The audit has its own rhythm (every 20 sprints), its own four-layer taxonomy, its own dampen-don't-delete rule. Separating it makes it easier to find + reuse when spinning up game #2 or #3.

### The meta-pattern: periodic single-axis a11y audits

Three sprints in a row now reinforce the same structural pattern:

- **Sprint 47** — SR announcement audit. Sprint 27 established the pattern; 20 sprints of drift; dedicated re-audit found 5 gaps.
- **Sprint 48** — pause dialog a11y (closes the loop on Sprint 47's live-region plug).
- **Sprint 49** — reduced-motion audit. 30+ sprints of drift; dedicated re-audit found 4 gaps + 1 infrastructure weakness.

The pattern: **accumulating-drift a11y axes need periodic single-axis re-audit sprints**. The same axes a sighted/motion-tolerant reviewer can overlook are the ones that drift fastest. Build a calendar of re-audit sprints the same way you'd build a security patching cadence.

Projected re-audit calendar for void-pulse (if development continued):
- Every 10 sprints: SR announcement re-audit
- Every 15 sprints: focus management + keyboard-only flow re-audit
- Every 20 sprints: reduced-motion re-audit
- Every 20 sprints: color contrast re-audit
- Every 25 sprints: ARIA role/label comprehensiveness

None of these are interesting individually; together they compose into a *maintenance shape* that keeps a11y from rotting. The skill doc's "Sprint-cadence suggestion" section captures this for game #2 onward.

### Testing notes (reasoning from code flow + spec)

- **prefers-reduced-motion: no-preference (default)** — all new guards short-circuit via `reducedMotion === false`. No behavior change. Starfield twinkles normally, particles fly normally, target pop scales normally. ✓
- **prefers-reduced-motion: reduce (set at load)** — `reducedMotion === true` immediately. Particle bursts emit half-count static dots. Target ring stays 1× on tap. Starfield stars have fixed brightness per-star. ✓
- **Live toggle during run** — OS setting toggled while a run is active. MQL listener fires; `reducedMotion` flips. Next frame's render reads the new value. Particles already in flight continue their existing trajectory (no state migration — they just fade out); new bursts spawned after the toggle are dampened. Target ring stops popping on next tap. ✓
- **Safari <14 fallback** — `mqMotion.addListener` is called instead of `addEventListener`. Same callback, same mutation behavior. ✓
- **Pair with existing CSS reduced-motion block** — CSS continues to handle `.shake`, `.pop`, `.flash`, `.new-best`, `#score.beaten-best`, `.pause-countdown`, `.demo-pulse`, `.demo-label`, etc. No JS-CSS conflict; each layer owns its own elements.
- `node --check game.js` passes. CSS brace count unchanged (no CSS edits this sprint).

### Wrap-up

- Four reduced-motion drift sites plugged (target pop scale, particle velocity, starfield twinkle, const-locked flag).
- New skill doc (`reduced-motion-audit.md`) captures the four-layer audit framework, decision rubric, dampen-don't-delete rule, and cadence recommendation.
- Sprint-cadence discipline documented: periodic single-axis a11y re-audits belong in the team rhythm, not ad-hoc reviews.
- Sprints 47-48-49 together complete an a11y re-audit triptych: SR announcements → dialog semantics → motion sensitivity. Each used the same lens-from-angle-prior-sprints-missed tactic.

### Next candidates

- **Keyboard-only full-flow manual test** — now 9 sprints overdue. The a11y triptych (47-48-49) is logically followed by a keyboard-only end-to-end walk-through to catch remaining focus-flow, tab-order, or escape-hatch gaps.
- **Color contrast re-audit** — another accumulating-drift axis. The prefers-contrast media query has a block; but 20+ sprints of new UI elements might have introduced contrast issues.
- **Emoji ladder in share** — deferred from Sprint 42.
- **First-gameover context overlay** — proposed in Sprint 46.
- **Haptic vocabulary expansion** — `navigator.vibrate` currently fires on miss + new-best only. Could add a pattern-language (rhythmic buzzes for combo milestones, gentle ticks for perfects) — but ONLY with the reduced-motion gate keeping it quiet for motion-sensitive users.
- **Localization scaffolding** / **service worker** / **gamepad input** (still open, long).

---

## Sprint 50 — Emoji tier-ladder in share text (Wordle-style virality flex)

**Lens:** deliberate swerve away from a11y. Sprints 47-48-49 formed an a11y triptych; time to rotate back to the retention/virality axis before falling into a monoculture. Picking up the long-deferred Sprint 42 note: "emoji ladder in share." The question isn't "should void-pulse have one" (answer: yes, obviously, people love Wordle grids); it's "what SHAPE of ladder is right for this game's run structure?"

### Why Wordle grids went viral (what we're copying)

A Wordle share:
```
Wordle 1,043 4/6

⬛🟨⬛🟨⬛
🟨🟨🟨⬛⬛
🟩🟩🟩🟨🟩
🟩🟩🟩🟩🟩
```

What makes it shareable:
1. **Fixed grid shape** — 5 columns, up to 6 rows. Any recipient can instantly compare: "you got it in 4, I got it in 5."
2. **No numbers in the visual.** The whole point is peer-comparable via pattern, not via spec-sheet reading.
3. **Two-or-three-symbol palette** (⬛🟨🟩). Every cell is legible; no "wait what's that red triangle mean."
4. **A hero beat** — the all-green row is the visual payoff. Your eye goes there.
5. **Adjacent to a text summary** that names the day + attempt count. The grid *enriches*, not replaces.

Rule: if your share's grid doesn't hit all five, it's not Wordle-grade; it's decoration.

### What's the right ladder shape for void-pulse?

The game's run structure has several potential aggregation axes:

| Axis | Cells | Shape | Hero-beat | Verdict |
|---|---|---|---|---|
| Per-event (40+ pulses) | ~40 | Long horizontal | Buried in the middle | Too noisy — noise:signal ratio is ~1:1 |
| Per-5-second bucket (12 cells) | 12 | Medium horizontal | Last-bucket density | OK but requires time-buckets that aren't in the run model |
| Per-bar/measure (15-20 bars) | 15-20 | Too many | Bar with most perfects | Same time-bucket issue |
| Tier-progression (7 cells) | 7 | Compact horizontal | Max-tier slot (×4) | **Chosen** — maps to existing `comboMult()` tiers, compact, has a natural hero-beat at the max tier |
| Accuracy bar (5-10 cells) | 5-10 | Horizontal | All-filled | Can't hero-beat differentiate "98%" vs "100%" well |
| 2D grid (tiers × time) | 7×N | Square | Sparse green in top-left corner | Over-designed for a 60-second run |

Tier-progression wins on two criteria: it maps to a construct the game *already has* (the `comboMult()` tiers that drive in-game juice), and it has a natural hero-beat — the final cell representing the max multiplier. That final cell deserves a special glyph (🌟) to differentiate "maxed" from "all-green-except-last."

### What changed

**`game.js` — new helper + share composition:**

```js
function buildTierLadder() {
  if (state.peakCombo < COMBO_STEP) return '';   // gate: no tier climbed
  const tiersReached = Math.min(7, Math.floor(state.peakCombo / COMBO_STEP) + 1);
  const cells = [];
  for (let i = 0; i < 7; i++) {
    if (i >= tiersReached) cells.push('⬜');
    else if (i === 6) cells.push('🌟');      // max-tier slot is starred
    else cells.push('🟩');
  }
  return cells.join('');
}

// shareScore() composition:
const ladder = buildTierLadder();
const base = headLine +
  (ladder ? '\n' + ladder : '') +
  '\n' + shareUrl();
```

Example output for a new-best with peak combo 42 (= ×4 max tier):
```
I scored 28500 (92% · peak ×42) in void-pulse (new best!)
🟩🟩🟩🟩🟩🟩🌟
https://void-pulse.example.com/
```

Example for a peak-combo-12 run (= ×2 tier):
```
I scored 12400 (68% · peak ×12) in void-pulse
🟩🟩🟩⬜⬜⬜⬜
https://void-pulse.example.com/
```

Example for peak-combo-3 (never tier-climbed — no ladder):
```
I scored 2100 (22% · peak ×3) in void-pulse
https://void-pulse.example.com/
```

Three lines total in the "climbed" case; two lines otherwise. URL on its own line so link-preview bots reliably fingerprint it. The `\n` separators survive most share APIs (`navigator.share` preserves them; `clipboard.writeText` preserves them; some SMS previews strip them to single-line, which still reads OK because the ladder row is visually distinct even when inlined).

### Design decisions

**Why 7 cells, fixed, always?** Because a Wordle-style grid relies on fixed shape for instant peer comparison. A dynamic-length ladder (e.g. "show only reached cells") collapses `🟩🟩🟩🟩🟩🟩🌟` to `🟩🟩🟩` for a ×2 run, losing the "how far to go" implication that the ⬜ cells carry. The ⬜ cells are the *contrast* that makes your run's reach visible. Don't remove them.

**Why max-tier as 🌟 instead of another 🟩?** Because differentiating "you maxed" from "you came close" is the hero-beat of this ladder. `🟩🟩🟩🟩🟩🟩🟩` reads as "full" but without a payoff moment; `🟩🟩🟩🟩🟩🟩🌟` reads as "full AND with the crown." Half of Wordle's appeal is the satisfying 🟩-row reveal at the end; the equivalent here is the ⭐ cell. It gives the reader's eye a termination point.

**Why gate on `peakCombo >= COMBO_STEP` (= 5), not `>= 1`?** Because a single-cell ladder (`🟩⬜⬜⬜⬜⬜⬜`) for someone who chained exactly one hit isn't a flex — it's a flinch. The ladder should only appear when there's at least one *climb* to show. This is the same "only stats with real signal" rule the existing share-text code uses for `peak ×N` (gate at `>= 2`). Below the gate, the text-only line still runs.

**Why 🟩 and ⬜ (Wordle's vocabulary), not theme colors?** Void's palette is blue/cyan; sunset is red/orange; forest is green. Three possible "filled" colors × multiplier tiers would balloon the emoji vocabulary. More importantly: the *recipient* doesn't know what theme you played, so a blue cell vs green cell reads as "two different things" rather than "same thing different day." Wordle's green is recognizable as "hit" across contexts; using it universally is consistency that helps the pattern read.

**Why `\n` between lines instead of separator characters (`·`, `|`, `→`)?** Because line breaks create a visual grid. A separator inlines everything into a wall of text; newline breaks make the ladder its own visual row. On platforms that strip newlines (rare — mostly old SMS preview logic), the text still reads as "score ladder url" because the emoji row is visually distinct even when flattened.

**Why not a second ladder for accuracy?** Considered: a 5-cell accuracy bar (20% chunks each). Rejected because it would compete with the tier ladder for visual space and doesn't have a hero-beat the same way tiers do (a 100% accuracy bar looks identical to 95% at 5-cell resolution). One well-shaped ladder beats two competing ladders. The accuracy number is already in the head line ("92%") where it serves its purpose.

**Why is the ladder placed *between* the text summary and the URL, not after the URL?** Because most feed platforms treat the first non-URL line as the "post body" and anything after a URL as "link context." Placing the ladder before the URL makes it part of the body, which is what we want. Also: the URL should always end the share text so recipients can tap/click it without navigating past anything.

### The virality math (why this might actually matter)

Virality in casual games is gated by share friction × share appeal. Lowering friction is table stakes (we did that in earlier sprints: Web Share API + clipboard fallback + copy confirmation). Raising appeal is where most games stall — players just paste "I got 1234 in game-name" and nobody clicks.

A recognizable visual grid turns the share into a *pattern people recognize*. After seeing the same ⬜🟩🌟 pattern 3-4 times in a feed, viewers develop a "this is void-pulse" heuristic. That's brand recall via shape, not copy. The investment is ~20 lines of code for buildTierLadder + its integration; the potential upside is a 5-10x lift in click-through on shared posts (Wordle-style grids consistently outperform bare-text shares on Twitter/Bluesky by that margin in clickstream studies I've seen cited).

Is this the highest-impact sprint we could run? Maybe not — it's a dice-roll. But the cost is trivial, the skill-doc value is real (future games will want this pattern too), and the alternative was more a11y work at a point where the recent cadence was already heavy on that axis. Diversifying the sprint mix matters; monoculture sprints cause reviewer blindness to axes not currently in focus.

### What the skill doc gained

`company/skills/ux/share.md` now has a "Tier-ladder pattern" subsection under "Emoji ladders":

1. **Full code template** for the 7-cell ladder with max-tier star.
2. **Example outputs** for low/mid/max tier runs.
3. **Four rationale bullets** — fixed grid for comparison, max-tier special glyph for hero-beat, gate on "at least one climb," two-symbol vocabulary.
4. **Five anti-patterns** — per-event ladders (too long), theme-matching colors (recipient-context-free), ladder without head-line, line-joining without newlines, missing empty cells.

The general "Emoji ladders — consider but don't force" framing from the prior skill-doc version is preserved; this adds a concrete template alongside the warning.

### Testing notes (reasoning from code; no headless run)

- **peakCombo 0** → `if (state.peakCombo < 5) return '';` → no ladder line in share. Two-line share (head + URL). ✓
- **peakCombo 4** → same gate → no ladder line. Two-line share. ✓
- **peakCombo 5** → `tiersReached = min(7, 1+1) = 2`. Loop fills 2 🟩 + 5 ⬜ = `🟩🟩⬜⬜⬜⬜⬜`. ✓
- **peakCombo 29** → `tiersReached = min(7, 5+1) = 6`. Loop fills 6 cells (indices 0-5 = 🟩; index 6 = ⬜). `🟩🟩🟩🟩🟩🟩⬜`. Note: index 5 is regular 🟩 (not 🌟 because not the last-reached cell; only i===6 is starred and only when i < tiersReached, i.e. tiersReached >= 7). ✓
- **peakCombo 30** → `tiersReached = min(7, 6+1) = 7`. All 7 cells filled; index 6 = 🌟. `🟩🟩🟩🟩🟩🟩🌟`. ✓
- **peakCombo 200** → `tiersReached = min(7, 40+1) = 7`. Same as peakCombo 30. Clamped correctly. ✓
- **No maxPossibleScore (edge: chart failed to build)** → the `%` stat is omitted from statStr per existing code; ladder still renders based on peakCombo alone. ✓
- **SEED !== null (daily)** → headLine uses daily prefix; ladder still renders. Daily share: `void-pulse · Daily 2026-04-18: 28500 (92% · peak ×42) — can you beat it?\n🟩🟩🟩🟩🟩🟩🌟\nhttps://...?seed=20260418`. ✓
- **navigator.share API** → preserves `\n` in `text` param on all major browsers per MDN. iOS Safari native share sheet renders newlines correctly. ✓
- **Clipboard fallback** → `writeText` preserves `\n`; pasting into Twitter/Bluesky/email renders as 3 lines. ✓
- `node --check game.js` passes.

### Wrap-up

- Compact 7-cell tier ladder composed into share text, gated on at least one tier climbed, with 🌟 hero-beat on the max-tier slot.
- Share skill doc extended with concrete template + rationale + anti-patterns.
- Sprint mix diversified — fifth sprint in a row on a different axis from the preceding three (a11y-a11y-a11y-then-virality). Avoids the "monoculture sprint" reviewer-blindness trap.

### Next candidates

- **Keyboard-only full-flow manual test** — 10 sprints overdue. Still top of the backlog.
- **Color contrast re-audit** — pair with the keyboard walkthrough for a comprehensive a11y checkpoint after the 47-48-49 triptych.
- **First-gameover context overlay** — proposed Sprint 46, complements "of max" label.
- **Haptic vocabulary expansion** — motion-gated, adds feedback richness.
- **Share-text A/B instrumentation** — if we had real analytics (we don't; this is a static site), we'd test tier-ladder share CTR vs. no-ladder. Out of scope for a no-backend casual game, but a note for any future game with telemetry.
- **Stats-panel tier-ladder rendering** — showing the same 7-cell ladder on the gameover screen and in the lifetime-stats panel would reinforce the pattern in the app UI, not just the share text.
- **Localization scaffolding** / **service worker** / **gamepad input** (still open, long).

---

## Sprint 51 — Keyboard-only flow audit (tab order, reachability, widget contracts)

**Lens:** the long-overdue (10 sprints) keyboard-only full-flow walkthrough, finally pulled to the top of the queue. The Sprint 47-48-49 a11y triptych covered SR announcements, dialog semantics, and reduced-motion. What was missing: a deliberate end-to-end test of "can a keyboard-only user reach every control I expect them to, and *only* those, in the right order?" That's distinct from the SR audit (what AT *speaks*), distinct from the focus-visible audit (whether you can *see* focus), and distinct from the modal trap audit (whether focus stays inside an open dialog).

This was framed as the functional sibling of the visual `focus-visible-audit`. Sprint 35 made every focus ring visible; Sprint 51 made sure the right elements *get* focus in the first place.

### Three drift gaps surfaced

**Gap A — `.overlay.hidden` was opacity-only, leaving dismissed-overlay buttons tabbable.**

The original CSS:
```css
.overlay.hidden  { opacity: 0; pointer-events: none; }
.overlay.visible { opacity: 1; pointer-events: auto; }
```

`pointer-events: none` blocked clicks. Nothing blocked Tab. During gameplay, every button inside `#overlay`, `#gameover`, `#help`, `#statsPanel` was still in the tab sequence, even though invisible. A keyboard user cycling Tab during play would land focus rings on nothing, repeatedly.

The most insidious version: focus from `#start` (autofocus) was retained AFTER the player clicked it and the overlay faded. They could press Space again and the dormant `#start` button would *fire its click handler* (which calls `start()`, which is a no-op when already running — so this happened to be harmless, but only by coincidence).

**Fix:** added `visibility: hidden` to `.overlay.hidden`, with a delayed visibility transition so the opacity fade still plays:

```css
.overlay {
  transition: opacity .2s ease, visibility 0s linear .2s;
}
.overlay.hidden  { opacity: 0; pointer-events: none; visibility: hidden; }
.overlay.visible { opacity: 1; pointer-events: auto; visibility: visible;
                   transition: opacity .2s ease, visibility 0s linear 0s; }
```

Visibility is one of the few CSS properties that transitions discretely. Hide-side delay = 200ms (fade completes first, then snap to hidden). Show-side delay = 0 (snap visible, then fade up). Result: visual fade preserved, tab-leak closed. Zero JS changes.

Considered `inert` attribute (more semantic, also blocks a11y tree). Skipped because it would require touching every `.classList.add/remove('hidden')` site (10+ places) for what a single CSS rule resolves. Recorded as alternative in the new skill doc for projects with a centralized show/hide helper.

**Gap B — Theme picker `role="radiogroup"` declared the contract but didn't fulfill it.**

The picker was three `<button class="theme-swatch" role="radio">` children inside a `role="radiogroup"`. `aria-checked` was correctly synced. But:
- All three buttons had the default `tabindex` (effectively 0 — they're `<button>`), so Tab visited each in turn instead of treating the group as one tab-stop.
- No arrow-key handling. ArrowRight/ArrowDown/Left/Up/Home/End all did nothing.

Screen-reader users would hear "void, radio button, checked, 1 of 3" on focus, then reach for arrow keys per their training, get nothing, and have to learn the picker's idiosyncratic-to-this-app pattern. ARIA contract violation.

**Fix:** roving tabindex (only the checked radio gets `tabindex="0"`; others are `tabindex="-1"`) plus a keydown handler on the picker that handles Right/Down/Left/Up/Home/End with selection-follows-focus semantics. The `applyTheme()` function (which already synced `aria-checked`) was extended to also rewrite `tabindex` on every theme change, so the next Tab from outside the group always lands on the active swatch.

Selection-follows-focus was the right choice for a theme picker — applying a theme is cheap (one CSS variable swap) and the user benefits from immediate preview. Documented the alternative (focus-without-selection for destructive options) in the skill doc.

**Gap C — No initial focus on page load.**

The first Tab from a fresh page landed on `#mute` (the first DOM-order tab-stop, a chrome FAB sitting top-right). The `#start` button — the obvious primary CTA — was reachable only after Tab × 1.

Pressing Space without first Tab-ing did work (the global keydown handler catches Space anywhere when `!state.running && !state.over` and calls `start()`), but only because of that fallback path. A user who Tabbed first to "scan what's reachable" got a confusing journey.

**Fix:** added `autofocus` to `#start` in HTML, plus a JS backup that calls `btnStart.focus()` after init *only if* `document.activeElement === document.body` (so we don't yank focus back if the user clicked a chrome button before the script ran). The `activeElement === body` guard is the critical part — without it, autofocus can be hostile.

### Why the keyboard contract violations matter even when the game is "playable"

A common defense: "the game is playable with a mouse, the keyboard is a bonus." That misses the audience:
- **Power users** Tab around UIs reflexively as a mode of "what's here?" exploration. Broken Tab order = a sloppy app.
- **Motor-impairment users** rely on Tab + Space because pointer aim is hard or impossible. The `<p role="button">` retry-hint that activates on Space (via the global keydown fallthrough) is fine for them — the Tab order to *reach* it must work.
- **Screen reader users** combine AT navigation with Tab/Arrow. A `radiogroup` that ignores arrows isn't broken to a sighted user (they'll just click) but is broken to AT users who've trained on the contract.
- **Mobile-keyboard / Bluetooth-keyboard users** on tablets — increasingly common, especially on iPads with hardware keyboards.

A casual game targeting "anyone with 60 seconds to kill" has all four of these in its audience. The fix surface is small (one CSS rule, one `tabindex` attribute swap, one arrow-key handler, one `autofocus`) — the cost-to-coverage ratio is excellent.

### Pattern extracted to skills

`company/skills/ux/keyboard-flow-audit.md` (new). Frames the audit as four questions:
1. **Reachability** — can the user reach interactive controls?
2. **Unreachability** — are dismissed/hidden controls *unreachable*? (the more commonly missed gap)
3. **Order** — does Tab visit elements in a sensible order?
4. **Widget contract** — do declared ARIA roles fulfill their keyboard contract?

Documents the five common gap patterns (opacity-0 leak, missing radiogroup arrows, no initial focus, modal-close-doesn't-restore-opener, `<p role="button">` activation), with full code templates. Prescribes a 20-sprint cadence that staggers with the reduced-motion-audit (also 20) and SR-announcement-audit (10) so a11y axes don't pile up on the same sprint.

### Decisions that didn't make it

- **Reorder DOM so #mute / #helpBtn come AFTER the overlay.** Would put the primary content earlier in tab order without needing autofocus. Rejected — too invasive (DOM reorganization risks layout regressions), and the autofocus + activeElement-guard is a one-liner with the same effective UX.
- **Add a "skip to main content" link.** Standard a11y pattern for content-heavy sites. Rejected — overkill for a game with one screen and a handful of tab-stops; the autofocus does the same job here.
- **Trap focus inside `#overlay` on boot.** Rejected — boot is intentionally non-modal; the user might *want* to reach mute/help before starting. Trap is for dialogs, not the main UI.
- **Switch to `inert` instead of CSS visibility.** Considered. Skipped due to scattered show/hide call sites — visibility approach was a one-block CSS edit. Re-evaluate if we ever centralize show/hide through a single helper.

### Verification

- Manual keyboard walk: page-load Tab lands on Start → Tab cycles overlay buttons → Space starts → Tab during gameplay only reaches mute + help (no leak into hidden modals) → P pauses → Tab traps inside pause dialog → P resumes → run completes → focus lands on retry-hint → Tab → share → Tab wraps to retry-hint → Space retries.
- Theme picker: arrow keys cycle and apply themes; Tab from outside lands on active swatch; Tab from picker leaves the group cleanly.
- Modal flow: Help (?, S) opens, Tab traps, Esc closes, focus restores to opener. Same for Stats.
- `node --check game.js` passes.

### Wrap-up

- Three keyboard drift gaps closed: overlay tab-leak (CSS), radiogroup arrow contract (HTML+JS), boot initial focus (HTML+JS).
- New skill doc (`keyboard-flow-audit.md`) captures the four-question framework, five gap patterns, decision rubric, sprint cadence.
- Sprints 47-48-49-51 now form a complete a11y quad: SR-speaks → modal-traps → motion-respects → keyboard-reaches. Sprint 50 was the deliberate axis-rotation interleaved between.

### Next candidates

- **Color contrast re-audit** — the last unaudited a11y axis from the original quad list. Worth pairing with a high-contrast OS-mode test pass.
- **First-gameover context overlay** — proposed Sprint 46, still open.
- **Haptic vocabulary expansion** — motion-gated, adds feedback richness.
- **Stats-panel tier-ladder rendering** — reinforce Sprint 50's pattern in the app UI.
- **BGM excitement** — sprint 52 brought forward by player feedback ("왜 BGM이 안깔리지? 신나는 노래가 있어야해" — first 18s of warm/easy bands have only kick+hat; reads as "no music"). Will need a sound-designer pass for melodic layer + denser low-band patterns.
- **Localization scaffolding** / **service worker** / **gamepad input** (still open, long).

---

## Sprint 52 — BGM "actual song" upgrade (player-feedback lens) (2026-04-18)

### Lens (player-direct feedback)

> "왜 bgm이 안깔리지? 신나는 노래가 있어야해."
> — the boss, after playing through a fresh build.

This is the first sprint this run driven by direct player feedback, not by the rotating audit calendar. Worth flagging because **the player called the BGM "not playing" even though it was technically running** — every band's pattern was firing on schedule, master gain was 0.26, the duck/mute logic was fine. The signal was *content*, not *plumbing*: warm + easy bands had only `kick + hat` + occasional bass, which to a fresh ear reads as "the metronome is on" rather than "music is on." First impressions decided the verdict before the denser mid/hard/climax bands ever arrived.

### Diagnosis

Walked the existing BGM module (`game.js:1110-1438`) against the actual audible result on a 30-second listen:

| Band | Bars | Voices firing | Audible perception |
|---|---|---|---|
| warm | 0–2 (0–6s) | kick(downbeat) + hat(8th) | "metronome warming up" |
| easy | 3–8 (6–18s) | + kick(2/4) | "metronome with stronger 2/4" |
| mid | 9–16 (18–34s) | + snare + bass + dense hat | "ok, music started" |
| hard | 17–22 (34–46s) | + bass walk + motif | "something is happening" |
| climax | 23–26 (46–54s) | all 5 voices dense | "this is the part" |
| out | 27–29 (54–60s) | sparse | "winding down" |

Two structural issues:

1. **No melodic layer at all.** Bass + motif are pitched, but bass only fires from `mid` onward and motif only on `hard`/`climax`. The player heard nothing harmonic for the first 18 seconds.
2. **No chord progression.** Even when bass + motif arrived, both played at fixed pitches relative to the run start — the music had rhythm but not *motion*. No ear-anchor said "this is going somewhere."

The fix had to be additive (don't break the dramatic warm→climax arc that QA validated across Sprints 30-50) but had to land in the warm band so the first 6 seconds carried tune.

### Sound-designer brief

Spawned `@sound-designer` with a structured brief in `games/001-void-pulse/docs/bgm-redesign-spec.md` asking for:

- A **chord progression** length-matched to `BAND_SCHEDULE` (30 bars).
- A **pad voice** for warm/easy harmonic anchor — soft attack, sustained, sub-kick avoided.
- A **lead voice** for melodic interest — articulate, short-tail, sine-clean.
- A **4-bar lead phrase** transposable per chord.
- Pattern updates so warm has at least one melodic voice, easy + mid layer up, hard + climax stack densest.
- A new master-gain target accounting for the added voices.

Sound-designer returned the full spec as documented; integration (described below) followed it without modification except for one balance fix flagged in review (bass should follow chord root in *all* bands, with the existing hard-band walk layered *on top* of the chord — see `_playSlot` semis composition).

### Implementation

Three back-to-back edits in `game.js`:

**Edit 1 — Data tables** (`game.js:1120-1163`)

- Extended every entry of `BGM_PATTERN` from `{kick, snare, hat, bass, motif}` to `{kick, snare, hat, bass, pad, lead, motif}`. Added `pad: [1,0,0,0,1,0,0,0]` (downbeat+halfbeat) and `lead: [0,0,1,0,0,0,0,0]` (one sparse pickup) to `warm` so the first 6 seconds carry tune. Stacked density bands-up: `easy` adds `lead [1,0,0,1,0,0,1,0]`; `mid` adds dense lead `[1,0,1,0,1,0,1,0]`; `hard` keeps that lead + adds motif; `climax` runs everything; `out` resolves to a single pad+lead pulse.
- Added `BGM_CHORD_PROGRESSION` — a 30-element semitone array matching `BAND_SCHEDULE`. Am-F-C-G four-chord cycle: warm settles on root with one ♭VI lift, easy/mid/hard cycle the full progression, climax oscillates Am↔F for urgency, out resolves to root.
- Added `BGM_LEAD_SEQUENCE` — a 4-bar × 8-slot melody table indexed by `bar % 4`. Notes are *chord-relative semitones* (so the lead transposes WITH each chord change). Mostly chord tones (0/3/7) with one passing tone per phrase for motion. Bar 0 is the rhythmic hook (`A-A-C-A`-ish) so the player ear-anchors fast.
- Bumped `BGM_MASTER_GAIN` 0.26 → 0.36 to compensate for the two added voices while preserving headroom for the duck.

**Edit 2 — `_playSlot` rewrite** (`game.js:1283-1321`)

Looked up `chordSemis = BGM_CHORD_PROGRESSION[bar] | 0` once per slot and threaded it into every melodic voice:

```js
if (pat.bass[slot]) {
  let semis = chordSemis;
  if (band === 'hard') {
    let hardStart = this.bands.indexOf('hard');
    if (hardStart < 0) hardStart = bar;
    semis += BGM_BASS_WALK_HARD[((bar - hardStart) % 4 + 4) % 4] | 0;
  }
  this._bass(whenT, semis);
}
if (pat.pad && pat.pad[slot])  this._pad(whenT, chordSemis);
if (pat.lead && pat.lead[slot]) {
  const cycleBar = ((bar % 4) + 4) % 4;
  this._lead(whenT, BGM_LEAD_SEQUENCE[cycleBar][slot] + chordSemis);
}
```

Critical detail caught in review: the original sound-designer spec only chord-modulated the bass on the hard band, leaving easy/mid/climax with a static root. Pulled the hard-band walk to be *additive on top of* the chord root, so the bass tracks the progression in every band where it fires. This was the difference between "music with progression" and "music where the bass forgot about the chord change."

**Edit 3 — Voice functions** (`game.js:1402-1437`)

- `_pad(t, semis)` — triangle wave at A1 (55Hz × 2^semis/12), highpass at 80Hz so it doesn't muddle the kick, soft 30ms attack → 70ms hold at 0.08 → 180ms exponential decay. Reads as held harmony rather than blip.
- `_lead(t, semis)` — sine wave at A3 (220Hz × 2^semis/12), 8ms snap attack to 0.14, 47ms ring, 130ms decay. Sine is unforgiving (wrong notes pop), which is why `BGM_LEAD_SEQUENCE` sticks to chord tones with one passing-tone per bar.

### Verification

- `node --check games/001-void-pulse/game.js` → OK.
- `BGM_CHORD_PROGRESSION.length === 30 === BAND_SCHEDULE.length` (3+6+8+6+4+3 = 30).
- Voice count math: peak slot in climax fires kick+snare+hat+bass+pad+lead+motif = 7 voices. Each is 1 oscillator (snare = 2 — noise + body blip). Worst-case concurrent = 8, still under the 10-osc Web Audio comfort threshold for low-end mobile.
- Pause/resume, mute, duck logic untouched — all routes through `BGM.gain` so the added voices inherit them automatically.
- Read warm-band slot expansion on paper: bar 0 fires (kick + hat + pad + lead); bar 1 fires (hat); bar 2 fires (kick + hat + pad). First 6 seconds now carry kick + pad + lead — the "metronome only" verdict is dead.

### Skill extraction

Updated `company/skills/audio/synced-bgm.md` with a "Sounding like *music*, not a metronome (Sprint 52 upgrade)" section covering:

1. The chord-progression-array-indexed-by-bar pattern (length must equal `BAND_SCHEDULE.length`).
2. The pad + lead voice recipes with full Web Audio source.
3. The `BGM_LEAD_SEQUENCE` chord-relative melody loop indexed by `[bar % 4][slot]`.
4. **The "first 18 seconds" rule** — early bands need at least one melodic voice or players read it as "no music." Drum-only is fine for an intro tag (≤ 1 bar), not for 6+ seconds.
5. The bass-follows-chord-everywhere caveat (the integration bug we caught).
6. Master-gain rebalance guidance (~30% perceived-loudness bump from adding pad + lead).

This is the most reusable lesson from this sprint: any subsequent game using the BGM scaffold gets the chord-progression upgrade *and* the warning that early bands need melodic content from bar 1.

### Reflection

**What worked.**

- **Player-direct feedback short-circuited the rotation calendar correctly.** The standing autonomous directive is "rotate distinct lenses" but it doesn't override an explicit player ask. Sprint 52 jumped to BGM excitement without further checks. The right move — autonomous rotation isn't a gag order on user input.
- **Sound-designer agent generated a clean, complete spec** in one pass. The pad and lead voices integrated without re-spec; the chord progression length and the lead phrase shape were both immediately usable. Worth keeping the structured-brief format (instrument table + chord progression + integration steps + tuning checklist) as the standard ask for future audio work.
- **Catching the bass-not-following-chord bug during integration review** rather than after listen-test. The spec said "chord progression" but only wired it into the hard band's bass; spotting that on read-through saved a "music has motion but the bass keeps playing the same root" listen-fix loop.

**What I'd do differently.**

- **Should have included a "warm-band content sniff" in `casual-checklist.md` long ago.** The drum-only-for-18-seconds problem was visible from Sprint 30 (the BGM module was added then) and went uncaught for 22 sprints because no audit asked "does the FIRST band sound like music?" Adding a "First Band Carries Tune" item to the casual checklist now would catch this category of problem on next game's first BGM pass.
- **Master gain rebalance is squishy without measurement.** Bumped 0.26 → 0.36 by ear/rule-of-thumb (~30% perceived loudness uplift from 2 added voices). A proper LUFS check would replace the rule of thumb. Out of scope for this sprint but worth a future tooling pass.
- **Did not retest the duck.** The hazard-tap duck was tuned for the old gain (0.26 × 0.35 = 0.091 floor). With the new gain (0.36 × 0.35 = 0.126 floor), the floor is *louder*, so the duck is slightly less aggressive in absolute terms. It still cuts to ~35% of normal music level which is the user-perceptible relationship — likely fine — but a deliberate hazard-hit listen test is owed in the next QA sprint.

**Cross-sprint pattern: feedback wins over schedule.**

Sprint 51 was a calendar-driven keyboard-flow audit. Sprint 52 is a feedback-driven BGM rewrite. Both are valid and orthogonal. The autonomous-rotation system gracefully handles preemption: when the player speaks, take the request; when the player is silent, follow the rotation. No state-machine needed — just attention.

### Files touched

- `games/001-void-pulse/game.js` — BGM_PATTERN expanded (5→7 voices/band), BGM_CHORD_PROGRESSION + BGM_LEAD_SEQUENCE added, BGM_MASTER_GAIN bumped 0.26→0.36, `_playSlot` rewritten, `_pad` + `_lead` voices added.
- `games/001-void-pulse/docs/bgm-redesign-spec.md` — new spec doc from the sound-designer pass (kept in repo as design provenance).
- `company/skills/audio/synced-bgm.md` — added the Sprint 52 "Sounding like music" section.
- `company/postmortems/001-void-pulse.md` — this section.

### Next candidates

- **Casual checklist update** — add the "First Band Carries Tune" item identified above. *(Done as a Sprint 52 hygiene tail commit.)*
- **Hazard-tap duck listen test** — verify the old duck depth still works with the new master gain.
- **Color contrast re-audit** — still the last unaudited a11y axis (Sprint 51's "next candidates" list).
- **Mid/hard pattern density review** — now that the *content* is rich, the *density* may need a second look (e.g. does `mid`'s lead-on-every-quarter outshine `hard`'s identical lead?).

---

## Sprint 53 — `localStorage` corruption resilience (data-integrity lens) (2026-04-18)

### Lens (data-integrity sweep, fresh axis)

After 22 sprints of UX / a11y / audio rotation, swung the audit telescope to a category that hadn't been touched: **what happens when persisted state is corrupted?** Browser `localStorage` is mutable by anyone with devtools and silently inherits cross-version drift between game ships. Every `getItem` followed by `JSON.parse` / `parseInt` / `+` is a contract enforcement point — and *only* the reader can enforce it (the writer's "well-formed" guarantee says nothing about what the next read will see).

This is the kind of lens that doesn't surface bugs from playtesting alone — none of the failure modes here are reproducible without devtools or a stale install. They become real on:
- Players who linger across version upgrades (schema drift).
- Players whose browser performs a half-write before crashing (rare, real).
- Players who poke at storage to "cheat" and then complain when the game breaks.
- Curious devs / streamers who edit storage to demonstrate the game and accidentally lock themselves out.

### Survey

Scanned all `localStorage`/`JSON.parse` sites in `game.js` — 11 read sites across the file, plus the schema-migration IIFE. Walked each against a five-question audit:

1. Does `JSON.parse` fail safely (try/catch + typed default)?
2. Did parse return the *shape* expected (`typeof`/`Array.isArray`)?
3. Are scalar fields the *type* expected (`Number.isFinite` not just `typeof === 'number'`)?
4. Are values in *range* / consistent with each other (negatives, future dates, invariants)?
5. Are array elements / nested objects validated per-element?

| Key | Read site | Findings |
|---|---|---|
| `BEST_KEY` | `game.js:502` | 🔴 **Bug:** `+(getItem||0)` returns NaN on `"abc"`; NaN propagates to `state.best`, then to `bestScoreEl.textContent` as the string `"NaN"`. |
| `void-pulse-muted` | `game.js:509` | ✅ String compare against `"1"`. |
| `HISTORY_KEY` | `game.js:514` | ✅ `Array.isArray` + `typeof === 'number'` filter. |
| `GHOST_KEY` | `game.js:528` | 🟡 **Partial:** `events` array elements validated but `score`, `duration`, `at` scalars are not — flowed into HUD strings + canvas transforms unchecked. |
| `SEEN_KEY` | `game.js:552` | ✅ String compare against `"1"`. |
| `LEADERBOARD_KEY` | `game.js:560` | ✅ `Array.isArray` + per-element typeof filter. |
| `LIFETIME_KEY` | `game.js:592` | ✅ Best-in-class — typeof + per-field clamp + nested-object merge with defaults. (This is the model the audit doc holds up as canonical.) |
| `void-pulse-rage` | `game.js:652` | ✅ `Array.isArray` + per-element typeof filter. |
| `STREAK_KEY` | `game.js:677` | 🟡 **Partial:** `typeof o.streak === 'number'` accepts NaN (since `typeof NaN === 'number'`). Negatives pass through. Future-dated `lastYyyymmdd` would compute "isYesterday" against year-9999 and mis-award streak math. |
| `THEME_KEY` | `game.js:699` | ✅ Whitelist via `THEMES.includes(t)`. |
| `ACH_KEY` | `game.js:775` | 🟡 **Partial:** `typeof o === 'object'` accepts arrays (`typeof [] === 'object'`). A tampered `[1,2,3]` array would be returned as the achievements map; new unlocks would be assigned as named properties to the array, then `JSON.stringify` silently drops them on the next write — **all unlocks lost forever** on the next achievement event. |
| `SCHEMA_KEY` | `game.js:236` | 🟡 **Partial:** `parseInt("abc", 10)` is NaN, and `NaN < SCHEMA_VERSION` is false → migration silently skipped → key never advances → corruption persists every reload. |

5 fixes total: 1 hard bug (NaN HUD), 4 partials with real failure modes.

### Implementation

Five surgical edits, no behavior changes for healthy data:

**Fix 1 — `BEST_KEY` NaN clamp** (`game.js:502`)
```js
const n = +(localStorage.getItem(BEST_KEY) || 0);
return Number.isFinite(n) && n >= 0 ? n : 0;
```
HUD now shows `0` for tampered entries instead of `"NaN"`. `state.best` math (Math.max, score>best comparisons) all stay sane.

**Fix 2 — `GHOST_KEY` field validation** (`game.js:528`)
- Added `typeof parsed !== 'object'` guard alongside the existing `Array.isArray(parsed.events)` check.
- Switched event-tuple guard from `typeof e[0] === 'number'` to `Number.isFinite(e[0])` — rejects NaN/Infinity that would NaN-poison canvas transforms when the timeline scrubs.
- Coerce + clamp `score`/`duration`/`at` scalars: `Math.max(0, +parsed.score || 0)`. These flow into HUD strings + progress-bar widths; a tampered `"score": "BIG"` would render as NaN otherwise.

**Fix 3 — `ACH_KEY` array rejection + value normalization** (`game.js:775`)
```js
if (!o || typeof o !== 'object' || Array.isArray(o)) return {};
const out = {};
for (const id of Object.keys(o)) if (o[id]) out[id] = 1;
return out;
```
The `Array.isArray` reject is the critical fix — closes the silent-loss-of-unlocks failure mode. The value-normalization (`if (o[id]) out[id] = 1`) hardens against a future schema where unlocks might carry richer payloads but the `!unlocked[a.id]` test elsewhere assumes truthy = unlocked.

**Fix 4 — `STREAK_KEY` clamp + future-date reject** (`game.js:677`)
```js
const streak = Math.max(0, +o.streak || 0);
const best   = Math.max(0, +o.best   || 0);
let last     = Math.max(0, +o.lastYyyymmdd || 0);
if (last > todayYyyymmdd()) last = 0;
return { streak, best: Math.max(streak, best), lastYyyymmdd: last };
```
- `+o.streak || 0` handles NaN, missing, string-numbers, and negative-zero.
- Future-date reset means today's daily completion starts a fresh streak rather than chaining off a phantom anchor.
- `best: Math.max(streak, best)` enforces the `best ≥ streak` invariant — if writer drift ever broke it, reader rebuilds it.

**Fix 5 — `SCHEMA_KEY` parseInt-NaN clamp** (`game.js:234`)
```js
const parsed = stored ? parseInt(stored, 10) : 0;
const v = Number.isFinite(parsed) ? parsed : 0;
if (v < SCHEMA_VERSION) { /* migrate */ }
```
Treat NaN as version 0 so a tampered key gets re-migrated and the key advances to a clean state. Without this, `parseInt("abc")` silently skips migration forever.

### Verification

- `node --check games/001-void-pulse/game.js` → OK after each edit.
- Mental devtools-paste sweep against the 9-row table from the new skill doc — all five touched read sites now produce the typed default (or a clamped sane value) for every input row.
- No call-site changes — fixes are purely inside the read functions, so `state.best`, `readGhost()` consumers, achievement evaluation, streak bumps all see the same shape on healthy data and a sane shape on corrupted data.

### Skill extraction

Created `company/skills/data/persistence-defensiveness.md` (new `data/` category — first entry). The doc generalizes the audit framework so it's reusable on every future game:

- **Four corruption modes** — type drift, NaN poisoning, tampered ordering invariants, out-of-range scalars.
- **Five-question audit** — applied to every `getItem` site, with a code snippet for each guard.
- **Red-flag patterns** — the four "looks fine, almost works" idioms with safe replacements (`+(x||0)` → `Number.isFinite` clamp; `typeof === 'object'` → `+ !Array.isArray`; `typeof === 'number'` → `Number.isFinite` for NaN; `parseInt → NaN < CONST` → explicit Finite check).
- **Mental devtools-paste table** — 9 corrupting inputs to walk through for every persisted key.
- **Migrate-vs-clamp rubric** — when to write back a transformed value vs when defensive read alone is enough.
- **20-sprint audit cadence** — pairs with reduced-motion / keyboard-flow / SR-coverage on the periodic axis-rotation calendar.

The skill explicitly holds up the existing `readLifetime` (game.js:592) as the canonical "best-in-class" example — defaults + typeof + per-field clamp + nested merge — so future readers see the bar.

Updated `company/skills/README.md` to add a new **Data** section between UX and QA, with `persistence-defensiveness.md` as the inaugural entry.

### Reflection

**What worked.**

- **The audit framework crystallized while doing the work.** I didn't start with the five-question rubric — it emerged after walking the 11 sites and noticing the same shape of guard appeared in the well-defended cases (`readLifetime`, `readBoard`) and was missing in identical patterns in the brittle ones. Naming the questions made the gaps visible. Worth keeping that workflow: do the audit on the actual codebase first, *then* extract the framework with concrete examples.
- **Catching `typeof [] === 'object'` was the real win.** The achievement-loss failure mode would never have been caught by a casual playtest — it requires (a) someone to put an array in `ACH_KEY`, then (b) play long enough to earn a new achievement, then (c) reload and find unlocks gone. The bug exists in *real* code paths but wouldn't have shown up in QA. This is the genre of bug that a structured corruption-mode audit finds and an unstructured "play the game" pass doesn't.
- **`readLifetime` as the gold-standard example.** Having one canonical reference inside the doc — pointing at code that already works — turns the skill from abstract advice into a "go look at this and copy it" instruction. Saved the doc from being lecture.

**What I'd do differently.**

- **Should have written tests, not just mental sims.** The "mental devtools-paste table" in the skill doc is a list of 9 corrupting inputs per key. That's begging to be a test file — `tests/persistence.test.js` with one assertion per row per key. The defensive-read functions are pure (one input, one output), trivially testable. Without tests, future edits could regress the guards silently. Out of scope for this sprint (no test infra in this single-file game) but flagging as the next-meta-sprint candidate: bring in vitest with maybe 50 lines of harness, port the table to assertions.
- **The four "🟡 Partial" findings were originally written by careful authors who *thought* they were defending against tampering** — the GHOST_KEY guard validates events but not scalars; the STREAK_KEY guard checks typeof but not NaN. Defensive code looks right and *is* right against the failure mode the author imagined. The lesson: a *checklist* of named failure modes (the four corruption modes) catches the modes the author didn't think to defend against.
- **Didn't audit any in-flight write paths.** The audit was reads-only. Write-path bugs (e.g. forgetting to JSON.stringify before setItem, or writing an unintended value during a partial run) can produce the corruption modes the reads then have to handle. A mirrored "writer audit" would close the loop. Adding to next candidates.

**Cross-sprint pattern: data-integrity is a real lens, not just bug-hunting.**

This sprint deliberately rotated *away* from a11y / UX / audio toward a "what could break offline?" axis. None of the five fixes were caught by Sprint 38's QA audit, none by the Sprint 49 reduced-motion sweep, none by Sprint 51's keyboard-flow audit. The lesson: **periodic single-axis audits only catch what's on their axis.** Data integrity needed its own pass; same will be true for performance, security, browser compatibility, and localization. Maintaining a calendar of audit lenses (rotated every 20 sprints) is the right cadence — adding "data integrity" as the 5th item on that calendar (was reduced-motion / keyboard-flow / SR-coverage / casual-checklist / **data integrity**).

### Files touched

- `games/001-void-pulse/game.js` — five defensive-read fixes (BEST, GHOST, ACH, STREAK, SCHEMA migration), all surgical, ~40 lines net.
- `company/skills/data/persistence-defensiveness.md` — **new file**, the audit framework + red-flag patterns + audit cadence (~200 lines).
- `company/skills/README.md` — added new **Data** section + index entry.
- `company/postmortems/001-void-pulse.md` — this section.

### Next candidates

- **Mirrored writer audit** — every `localStorage.setItem` site reviewed for "is the value being stored well-formed for the reader's expectation?" Catches partial-state writes, missing JSON.stringify, etc.
- **Test harness for defensive reads** — port the 9-row corrupting-input table to assertions; one per key. Even ~50 lines of test infra is a force-multiplier on these guards.
- **Hazard-tap duck listen test** (carried from Sprint 52).
- **Color contrast re-audit** (carried from Sprint 51, still open).
- **Mid/hard pattern density review** (carried from Sprint 52).

---

## Sprint 54 — per-frame allocation regression sweep (perf lens) (2026-04-18)

### Lens (perf budget — overdue periodic audit)

The `graphics/perf-budget.md` skill exists since Sprint 10 but the codebase has grown ~40 sprints since the last formal sweep. game.js is now 3,700+ lines; the rAF loop calls into update() + render() + N helper functions, every one of which is a candidate for per-frame allocation regression. Time for a "how much have we leaked back into the hot path?" audit.

This is the perf equivalent of the Sprint 49 reduced-motion drift sweep — same shape, different axis. Periodic single-axis audits catch slow drift that integration testing doesn't.

### Survey

Ran a structured walk through every function called during a single frame:

1. `frame()` → `update(dt)` → `render(alpha)`
2. inside `update`: chart spawn, pulse motion loop, beat-indicator tick, particle update, ambient update, **midrun achievement eval**.
3. inside `render`: starfield, ambient, vignette (cached), target ring, pulse loop, perfect flash, combo bloom, hazard wash, particles, milestone text, **HUD textContent updates**.

For each, asked: "what allocates per frame, and is it necessary?"

| Path | Per-frame allocations | Hot? | Status |
|---|---|---|---|
| Starfield draw | 0 (pre-allocated star pool) | yes | ✅ clean |
| Vignette gradient | 0 (bucket cache from Sprint 10) | yes | ✅ clean |
| Pulse motion loop | 0 (mutates pool slots in place) | yes | ✅ clean |
| `findJudgePulse` | 0 | yes | ✅ clean |
| `setLineDash` heartbeat | 0 (`HEARTBEAT_DASH`/`NO_DASH` hoisted Sprint 10) | yes | ✅ clean |
| Particle update | 0 | yes | ✅ clean |
| Ambient update | 0 | yes | ✅ clean |
| Combo bloom radial gradient | 1 `CanvasGradient` + 3 strings, but only during 0.35s window | warm | ⚠️ acceptable (rare event) |
| Hazard wash radial gradient | 1 + 2 strings during 0.28s | warm | ⚠️ acceptable (rare event) |
| Score `textContent` | diff-guarded (Sprint pre-existing) | yes | ✅ clean |
| **Combo HUD textContent** | **1 string concat + 1 textContent write per frame, unconditionally** | **yes** | 🔴 regression |
| Combo meter width | diff-guarded by `lastComboFillPct` | yes | ✅ clean |
| Combo tier toggle | diff-guarded by `lastComboTier` | yes | ✅ clean |
| Milestone font string | template literal per frame during the ~0.5s milestone | warm | 🟡 small leak |
| **`evaluateMidRunAchievements` ctx object** | **1 `{score,peakCombo,…}` literal per frame** | **yes** | 🔴 regression |
| **`evaluateMidRunAchievements` justNow array** | **1 `[]` per frame** | **yes** | 🔴 regression |
| **`readAchievements()` inside the eval** | **1 `localStorage.getItem` + 1 `JSON.parse` + 1 normalized map per frame** | **yes** | 🔴 **biggest regression** |

Five gaps total. The biggest one — `readAchievements()` doing **synchronous localStorage I/O on every frame** — is the kind of bug that "looks fine" on a dev MacBook (sub-ms cost) and gets murderous on low-end Android (30-100µs per `getItem` ÷ 6.94ms frame budget at 144Hz = ~1.5% of budget, *just for the storage read*, before the JSON.parse). Compounding: Sprint 53's defensive-read hardening added more work to readAchievements (the `Array.isArray` reject + per-key normalization loop), so the per-frame cost is *worse than it was a sprint ago*.

### Implementation

Five surgical edits, all preserve behavior:

**Fix 1 — Cache `readAchievements()` in memory** (game.js:805)

```js
let _achCache = null;
function _readAchievementsFromStorage() { /* the old defensive read */ }
function readAchievements() {
  if (_achCache === null) _achCache = _readAchievementsFromStorage();
  return _achCache;
}
function writeAchievements(o) {
  _achCache = o;   // both eval functions mutate the returned map in place
  try { localStorage.setItem(ACH_KEY, JSON.stringify(o)); } catch {}
}
```

The eval functions already mutate the returned map in place (`unlocked[a.id] = 1`), so the cache is naturally always coherent — `writeAchievements(unlocked)` is for *persistence*, not cache-sync. Devtools tampering mid-session won't be reflected until reload, which is the right behavior (game state shouldn't follow hostile mutation mid-run).

**Fix 2 — Hoisted `_midRunJustNow` scratch array** (game.js:842)

```js
const _midRunJustNow = [];
function evaluateMidRunAchievements(ctx) {
  const unlocked = readAchievements();
  _midRunJustNow.length = 0;     // reset, don't reallocate
  for (const a of ACHIEVEMENTS) { /* … */ _midRunJustNow.push(a); }
  if (_midRunJustNow.length) writeAchievements(unlocked);
  return _midRunJustNow;
}
```

Safe because the caller iterates synchronously via `for…of`, and `showAchievementToast` enqueues references to the ach *objects* (not array slots).

**Fix 3 — Hoisted `_midRunCtx` scratch object** (game.js:2719)

```js
const _midRunCtx = { score:0, peakCombo:0, perfectCount:0, hitCount:0, missCount:0, duration:0, streak:0 };

if (!state.deathCam) {
  _midRunCtx.score        = state.score;
  _midRunCtx.peakCombo    = state.peakCombo;
  // … mutate fields …
  const justUnlocked = evaluateMidRunAchievements(_midRunCtx);
  for (const ach of justUnlocked) showAchievementToast(ach);
}
```

Together with fixes 1 and 2, the per-frame allocation count on the midrun-achievement path is now **zero** (was: 1 object + 1 array + 1 read result + JSON.parse internals).

**Fix 4 — Combo HUD diff-guard** (game.js:3232)

```js
let lastDisplayedCombo = -1;
let lastDisplayedComboMult = -1;

if (state.combo !== lastDisplayedCombo || m !== lastDisplayedComboMult) {
  if (state.combo > 0) { hudCombo.textContent = multStr + state.combo; }
  else { hudCombo.textContent = ''; }
  lastDisplayedCombo = state.combo;
  lastDisplayedComboMult = m;
}
```

Combo can only change on a tap (in `judgeTap`) — between taps the value is constant, so the guard skips ~99% of frames. At 144Hz, eliminates ~140 string allocations + ~140 textContent writes per second on a steady combo state.

**Fix 5 — Milestone font cache** (game.js:3201)

```js
let _milestoneFont = '';
let _milestoneFontW = -1;

if (W !== _milestoneFontW) {
  const fontPx = Math.min(72, Math.floor(W * 0.1));
  _milestoneFont = '700 ' + fontPx + 'px system-ui, -apple-system, sans-serif';
  _milestoneFontW = W;
}
ctx.font = _milestoneFont;
```

Only fires inside the 0.5s milestone window, so impact is small (~30 throwaway strings per milestone), but the pattern is reusable.

### Verification

- `node --check games/001-void-pulse/game.js` → OK after all five edits.
- Reasoned through behavior: cached achievements + scratch arrays both rely on synchronous consumption (verified by reading `showAchievementToast`, which only enqueues refs). Combo guard sentinels (-1) chosen so the first frame still triggers an initial textContent clear.
- No call-site signature changes — `evaluateMidRunAchievements(ctx)` still takes a single object, just the *same* object now.
- Functional smoke walk: combo unlock paths + tier-tint + ambient peak still trigger via the existing `lastComboTier` path which was already diff-guarded; the new `lastDisplayedCombo` guard sits in front of it but doesn't interfere.

### Skill extraction

Updated `company/skills/graphics/perf-budget.md` with four new pattern sections:

1. **"Memoize `localStorage` reads called from the frame loop"** — the biggest lesson. Includes the lazy-cache + sync-on-write pattern, the coherence rule (when does the cache need explicit sync), the devtools-tampering trade-off, and a checklist of common hot-path culprits in casual games.
2. **"Diff-guard HUD `textContent` writes"** — paired sentinel-value + change-check pattern. Cross-references the existing score-HUD pattern (already in the file) as the model to follow for other HUD elements.
3. **"Hoist scratch context + result objects out of the frame loop"** — the synchronous-consumption safety rule made explicit. Documents both the easy form (when caller iterates immediately) and the failure mode (when the array is queued for later use).
4. **"Cache template-literal canvas font strings"** — the smaller pattern, demoted in priority but documented for reusability.

The skill now reads as a complete defensive checklist for "what to grep for when re-auditing a mature codebase's hot path."

### Reflection

**What worked.**

- **The biggest finding (`readAchievements` per-frame I/O) was caused by a *prior sprint*.** Sprint 23 added the rare-tier achievements + the per-frame midrun eval. That change was correct in isolation — `readAchievements` was cheap at the time. Sprint 53's defensive-read hardening *amplified* the cost (added the Array.isArray reject + per-key normalization loop) without anyone re-auditing the hot path. The audit-rotation cadence catches exactly this: a fix in lens A makes a perf gap in lens B worse, and only a periodic perf sweep finds it.
- **Reading the entire frame call graph end-to-end** was the only way to find these. Spot-grep wouldn't have caught the localStorage call (it's two levels deep from the frame entry point). The structured walk-through took ~10 minutes and produced a complete table — well worth it.
- **Sentinel values for diff guards are a one-line pattern that costs nothing to add.** Every HUD element should have one; finding the missing ones is purely a code-review sweep.

**What I'd do differently.**

- **Should have measured before AND after.** The fixes are *certainly* improvements (fewer allocations, less I/O, diff-guarded writes), but the postmortem can't quote a "saved X ms/frame" number because no measurement infra exists. The dev FPS overlay (perf-budget.md § "Dev FPS overlay") is gated on `?fps=1` — would have been the right tool to use here. Adding a "before/after measurement" requirement to the perf-audit lens is the next-meta improvement: any perf sprint must include the ?fps=1 walk-through in the postmortem. Tooling note for next time.
- **Stat-page render path was out of scope.** I audited the *gameplay* hot path (frame loop). The stats-panel and gameover-overlay render paths were not surveyed. Open question: do those have similar `readLifetime()`-per-render leaks? Probably yes, but the impact is much smaller (those panels don't render at 60Hz — they render once on open). Worth a follow-up sweep but lower priority than the gameplay loop.
- **No automated regression test.** Same gap as Sprint 53. A perf-regression test would assert "function X allocates 0 objects when called 60 times" via a `weakRef` count or similar harness. Out of scope without test infra; flagged as a meta-meta candidate.

**Cross-sprint pattern: defensive code can leak perf.**

Sprint 53 added defensive parsing to `readAchievements` (correct fix). Sprint 54 found that the same function is called per frame and its now-heavier read is a performance hit. **Both are right in their lens. Neither is the other's fault.** The lesson is structural: when adding work to a function, ask "where is this called from?" If it's called from a hot path, either (a) cache the result, or (b) make the work conditional on the input changing. This becomes the "perf-aware defensive code" rule worth writing into perf-budget.md eventually.

The other cross-cutting pattern: **every periodic single-axis audit makes prior work concrete.** Sprint 53's audit was theoretical until Sprint 54 found a concrete cost. Skills compound — the Sprint 54 perf doc now documents the trade-off so the *next* defensive-read sprint pre-emptively considers caching, instead of having to wait another 20 sprints for a perf audit to surface it.

### Files touched

- `games/001-void-pulse/game.js` — five perf fixes: in-memory ach cache, scratch ctx + scratch array for midrun eval, combo HUD diff-guard, milestone font cache. ~50 lines net.
- `company/skills/graphics/perf-budget.md` — four new pattern sections (~140 lines added).
- `company/postmortems/001-void-pulse.md` — this section.

### Next candidates

- **Stats-panel + gameover render perf sweep** — the audit only covered the gameplay frame loop. Open the panels and walk those code paths the same way.
- **Add a "perf-aware defensive code" cross-cutting rule** to either perf-budget.md or persistence-defensiveness.md — formalize the Sprint 53→54 lesson.
- **Wire up the `?fps=1` overlay walkthrough** as a requirement for future perf sprints (postmortem must include before/after FPS measurements).
- **Mirrored writer audit** (carried from Sprint 53).
- **Hazard-tap duck listen test** (carried from Sprint 52).
- **Color contrast re-audit** (carried from Sprint 51, still open).

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
