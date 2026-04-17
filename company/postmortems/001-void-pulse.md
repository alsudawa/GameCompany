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

## Credits

| Role | Agent | Model |
|------|-------|-------|
| Producer | `@producer` | claude-sonnet-4-6 |
| Game Designer | `@game-designer` | claude-opus (Opus) |
| Lead Developer | `@lead-developer` | claude-sonnet-4-6 |
| Artist | `@artist` | claude-haiku (Haiku) |
| Sound Designer | `@sound-designer` | claude-haiku (Haiku) |
| QA Tester | `@qa-tester` | claude-haiku (Haiku) |
