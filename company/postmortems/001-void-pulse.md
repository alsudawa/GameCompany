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

- **Daily seeded challenge** (`?seed=YYYYMMDD`) — biggest remaining retention + social-proof lever
- **Death-cam slow-mo on fatal miss** — teaches timing + softens the sting
- **Per-seed local leaderboard** — tie shared URL to a ranked comparison
- **Sprint 7+ lens candidate: performance** — profile canvas draw costs on low-end Android

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
