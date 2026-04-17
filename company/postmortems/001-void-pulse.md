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

## Credits

| Role | Agent | Model |
|------|-------|-------|
| Producer | `@producer` | claude-sonnet-4-6 |
| Game Designer | `@game-designer` | claude-opus (Opus) |
| Lead Developer | `@lead-developer` | claude-sonnet-4-6 |
| Artist | `@artist` | claude-haiku (Haiku) |
| Sound Designer | `@sound-designer` | claude-haiku (Haiku) |
| QA Tester | `@qa-tester` | claude-haiku (Haiku) |
