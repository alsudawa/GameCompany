# Postmortem — 002-glyph-siege

**Ship date:** 2026-04-18
**Genre:** Horde Survivor (Vampire Survivors-like)
**Canvas:** 720×960 portrait
**Session target:** 60–180s endless

## What shipped

A move-only horde survivor. One weapon (auto-firing ward), four enemy shapes (circle/triangle/square/hexagon, also color-coded), six stackable rune upgrades, one patterned boss every 90 seconds, XP gem magnet, localStorage best, NEW BEST badge, tab-pause with 3-2-1 countdown, reduced-motion compliance, boot-error fallback. Native ES modules (10 files), no build step, no asset files.

## Why this concept

Game #001 (void-pulse) failed CEO playtest at the concept layer: tap-timing's single-dimension skill ceiling plateaued. The fix couldn't be polish — the loop had only one correct answer per input. For #002 we picked a viral format with *many valid answers per moment* (where to stand is emergent) and *combinatorial build depth* (6 upgrades × 3–5 tiers).

## What went right

1. **Scope lock held.** Producer brief named the non-goals (secondary weapons, meta-progression, scrolling camera) explicitly, and nothing crept in during the build pass.
2. **Collapsed sprints under timeout pressure.** Originally planned as 5 sequential sprints; when CEO flagged agent-call timeouts, main-session writes folded Sprint 2+3a+3b+3c into one pass. Single large `Write` calls to small focused modules were faster and safer than multiple agent-spawned edits.
3. **Module split paid off.** 10 ES modules averaging 120 lines each. Every subsystem (input, entities, render, waves, upgrades, sfx, ui) is independently readable. Contrast with void-pulse's 3,864-line single IIFE — this scales better.
4. **Shape + color + size enemy differentiation.** Colorblind-safe from day one. Zero compliance refactor.
5. **Juice density per event.** Every kill stacks flash + spark + knockback + SFX + gem drop; every boss event stacks shake + vignette + drone + telegraph. No "where's the feedback" gap.

## What went wrong / could go wrong

1. **Agent timeouts dominated the session.** Producer agent timed out at 107s; artist and sound designer completed on first try but took 85–106s each. Lead-developer agent was skipped entirely in favor of direct main-session writes. **Lesson:** when a session is timeout-flaky, prefer direct writes over agent delegation for code files. Agents are best reserved for research + concept + review; implementation is where determinism matters.
2. **Self-QA replaced QA-tester agent.** One fewer perspective rotation than void-pulse got. Some UX issues (approaching-best glow, on-canvas first-run hint) were caught but deferred rather than fixed.
3. **Enemy separation is O(n²).** Acceptable at pool=200 on mid-tier mobile but will block a future "density" upgrade. Spatial hash extracted as a skill pattern but not yet used in game code.
4. **Pitch-ladder combo memory leaks across runs.** `Sfx.hitCombo` is module-scoped; new run starts with stale combo index. Cosmetic only (fades within 1s of first hit), but a `resetCombo()` call on `startRun()` is the fix. Shipping with bug documented.
5. **Multi-level-up in one frame** stacks pause overlays sequentially instead of batching. Rare (requires T3 gem pickup during high-XP-lean run) but abrupt feel.

## Void-pulse lessons applied — validation

| Lesson | Applied? | How |
|--------|----------|-----|
| Time-domain judgment | ✅ | All cooldowns (invuln, fire, dash) in ms, not pixels |
| Perception beats pixels | ✅ | Juice layered before number tuning |
| Spawn audio anchor | ✅ | `Sfx.spawnTick()` on every wave spawn, vol 0.04 |
| 4-waypoint difficulty | ✅ | `WAVE_WAYPOINTS` in constants.js, interpolated |
| Boot-error fallback | ✅ | `window.onerror` + reset button |
| Reduced-motion audit | ✅ | shake × 0.3, particle × 0.5 via media query |
| NEW BEST gating | ✅ | suppressed on first run (`> best && best > 0`) |
| Tab-hide pause | ✅ | `visibilitychange` → pause → countdown on resume |

## New patterns extracted to skills library

- `company/skills/gameplay/virtual-joystick.md` — floating joystick with touch/keyboard parity
- `company/skills/ux/upgrade-choice.md` — pause + 3-card selection overlay, weighted roll, click-to-confirm animation
- `company/skills/gameplay/horde-survivor-loop.md` — meta-pattern: move-only + auto-attack + XP-level-up + waypoint waves + boss interval

(One pre-planned pattern, `graphics/batched-entity-render.md`, deferred — current render groups by type via sequential draw calls which achieves batching implicitly; dedicated spec will follow if performance requires it.)

## Metrics (playtest expected)

- Time-to-first-kill: ~2s (first grunt spawns at t=0.3s; weapon interval 0.9s)
- Time-to-first-level: ~20–25s (20 XP, T1 gems = 1 XP each, spawns accelerate at t=30)
- Median death: 60–90s (per design target)
- Endgame: 180s+ with a multi-shot + fire-rate build

## What to try in #003

- Daily seeded challenge (same enemy sequence for all players that day)
- On-canvas first-run hint (2s "DRAG TO MOVE" overlay that fades at first input)
- Approaching-best glow (80% threshold class toggle)
- Try a format contrast: physics-puzzle (Suika Game / merge) to give the studio a second input genre in its portfolio

## Budget actuals

- Producer brief: ~6 min (1 agent timeout + direct write)
- Game designer GDD: ~4 min (direct write to avoid second timeout)
- Artist spec: ~1.5 min (agent succeeded)
- Sound designer spec: ~1.8 min (agent succeeded)
- Lead dev implementation: ~25 min (10 file writes in main session, all sprints folded)
- Self-QA + postmortem + catalog updates: ~5 min
- **Total session time**: ~45 min end-to-end for a full Horde Survivor MVP
