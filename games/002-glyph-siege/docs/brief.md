# Project Brief — 002-glyph-siege

**Status:** draft
**Producer:** @producer
**Date:** 2026-04-18

## Pitch (one sentence)

Hold a shrinking sanctuary against closing waves — survive long enough to stack upgrades into a screen-clearing build.

## Target player

- Mobile-first casual player, portrait hold, one-handed thumb input.
- Commuter / bed-time / queue-killer — wants a 60–180s run with real stakes.
- Already familiar with Vampire Survivors / Survivor.io / Brotato through social clips; expects "move-only, auto-attack, level-up picks."
- Secondary: desktop player who found the catalog link, keyboard-driven.

## Session goal

- **Median death at 60–90s**, endgame 180s+.
- **Target retries per session**: 3–5 (proven "one more try" loop).
- **Time-to-first-fun**: under 10s (first kill + first gem).
- **Time-to-first-upgrade-choice**: under 30s (reward the commitment early).

## Platform

Web (desktop + mobile). Canvas 720×960 portrait. Input:
- **Touch**: floating virtual joystick (drag-anywhere to steer).
- **Keyboard**: WASD / arrow keys (desktop parity).
- **Attack**: fully automatic — targets nearest enemy. Never a button press.

## Why this concept

Game #001 (void-pulse) failed CEO playtest at the concept layer: its single-dimension "tap the ring" skill ceiling plateaued fast. Sprint fixes addressed perception (time-domain windows, nearest-target judge, spawn SFX anchor, time-domain tension flash) but couldn't deepen the loop — because the loop had only one correct answer per input.

Horde Survivor solves this structurally:
- **Many valid answers per moment** (where to stand is emergent, not trained).
- **Build variety** (6 upgrade slots × stackable tiers = combinatorial depth).
- **Power-fantasy arc** (fragile → dominant within one 90s run).
- **Proven viral loop** — Vampire Survivors, Survivor.io, Brotato, Magic Survival have validated the format across demographics.

## Success criteria

- [ ] Player understands the game in under 60s with **no tutorial screen**. The rules teach themselves: enemies close in, projectiles auto-fire, gems drop, level-up overlay explains choices.
- [ ] **Game-over to next run in under 3s** — one clear "RETRY" CTA, no intermediate menus.
- [ ] **First playtest wants to retry within 60s** — emotional hook validated at CEO demo.
- [ ] **3–5 level-ups per 90s run** — build feedback cadence.
- [ ] **60fps maintained** with 180 enemies + 120 projectiles + 300 particles on mid-tier Android.
- [ ] **Accessibility**: `prefers-reduced-motion` dampens shakes; keyboard reaches every button; color is never the only channel.

## Scope lock

**IN** (ship-critical, do not subtract):
- 1 character (single glyph/avatar)
- 1 base weapon: auto-firing nearest-enemy projectile
- 4 enemy types: grunt, scout, heavy, elite
- 6 upgrade slots (damage+, fire rate+, projectile count+, move speed+, pickup radius+, max HP+), each 3–5 tiers
- Boss every 90s (pattern-based, not a bullet-hell)
- XP gems (3 tiers) with magnet radius
- Bounded 720×960 arena — **no camera scroll**; enemies spawn at edges
- Pause-on-tab-hide + 3-2-1 resume countdown (reused from void-pulse)
- Mute toggle persisted to localStorage
- Run-end stats (time survived, kills, max level, gems)

**OUT** (explicit non-goals — refuse to add these during build):
- Multiple weapons / secondary weapons (no passive-active weapon split)
- Meta-progression (no persistent unlock tree between runs)
- Character select / cosmetics
- Multiplayer / leaderboards beyond localStorage best
- Save-state mid-run (permadeath only)
- Camera scroll / larger world
- Boss mechanics requiring anything beyond positional dodging (no QTE, no cutscenes)
- Currency economy / shops
- Custom music tracks (Web Audio only, SFX-based ambience)
- Asset files (all art inline SVG/CSS, all audio Web Audio oscillators)

## Risks seen at brief stage

1. **Performance wall** — 200+ entities + particles at 60fps on mobile is the hard technical bar. Spatial hash grid + entity pooling + batched draws are required from day one, not post-ship.
2. **Scope creep via "just one more weapon"** — Vampire Survivors fans expect weapon variety. Brief locks to 1 weapon; Lead Dev and Game Designer must push back on any expansion request until ship.
3. **Joystick ambiguity** — floating joysticks can confuse first-timers. Must show visible ring the instant drag starts; must be forgiving on drift.
4. **Upgrade choice paralysis** — 3 cards is standard, but small screen + fast-paced context means cards must be scannable in 2 seconds max. Icon + 2-word name + single-line delta.
5. **"Single mechanic deeply" principle stretch** — Horde Survivor has movement, waves, upgrades, boss, gems. We reconcile by treating *movement* as the only input mechanic; upgrades are a turn-layer strategy pause, not a second input system.
6. **Mobile device fragmentation** — low-end Android may not hit 60fps even with pooling. Mitigate with soft-cap auto-throttle (dynamic spawn rate if frame time >18ms rolling).

## Void-pulse lessons applied

Carried forward from `/home/user/GameCompany/company/postmortems/001-void-pulse.md`:

- **Time-domain judgment over pixel-domain**: projectile hit windows, enemy contact grace, gem pickup all measured in ms, never pixels that shrink invisibly with speed.
- **Perception beats pixels**: if a kill "feels unfair," the fix is visual/audio feedback, not rule change. Layer juice before tuning numbers.
- **Spawn has audio anchor**: enemy spawn tick (35ms low blip) gives rhythmic awareness without stealing from kill SFX — directly reuses void-pulse spawn-tick pattern.
- **Perspective rotation QA**: pre-ship QA must sweep player / mobile / onboarding / retention / distribution lenses, not just correctness.
- **Difficulty as 4 waypoints**: 0s / 30s / 90s / 180s+ tuple on every difficulty axis (spawn rate, batch size, enemy mix, boss presence).
- **Boot-error fallback**: `window.onerror` + `unhandledrejection` + localStorage-clear reset button is mandatory.
- **Reduced-motion audit**: animations fade but don't disappear; haptics gated by capability + media query.
- **NEW BEST gating**: suppressed on first run (`score > prevBest && prevBest > 0`).

## Handoff artifacts expected

| Role | Deliverable | Path |
|------|-------------|------|
| @producer | This brief | `games/002-glyph-siege/docs/brief.md` |
| @game-designer | GDD — mechanics, formulas, waypoint tables, juice stack | `games/002-glyph-siege/docs/design.md` |
| @lead-developer | `game.js`, `index.html` wiring, multi-sprint build | `games/002-glyph-siege/{index.html,game.js,style.css,...}` |
| @artist | Art spec — palette, SVG glyphs, particle colors, animations | `games/002-glyph-siege/docs/art-spec.md` (deleted after integration) |
| @sound-designer | Sound spec — SFX recipes, pitch ladders, envelope shapes | `games/002-glyph-siege/docs/sound-spec.md` (deleted after integration) |
| @qa-tester | QA report — prioritized bugs + UX findings | `games/002-glyph-siege/docs/qa-report.md` |
| @producer | Postmortem + README catalog update | `company/postmortems/002-glyph-siege.md`, root `README.md`, root `index.html` |
| Orchestrator | Extract new patterns to skills library | `company/skills/gameplay/spatial-hash.md`, `company/skills/gameplay/virtual-joystick.md`, `company/skills/ux/upgrade-choice.md`, `company/skills/graphics/batched-entity-render.md` |

## Execution rhythm (timeout-aware)

Per CEO direction, each agent call is **scoped small** (one file or one subsystem). Lead Developer is split into 3 build sprints + 1 integration + 1 QA-fix pass. Art and sound specs run in parallel with the initial skeleton. No single agent call attempts the full game.

## File structure policy

Defer to Lead Developer. Native ES modules permitted (no build step required — `<script type="module">` + relative `import`s). Given scope, module split likely beats single-file `game.js`. Shipped folder must remain self-contained (no cross-game imports).

## Ship criteria checklist

- [ ] All 6 success criteria met
- [ ] QA report P1/P2 resolved
- [ ] Postmortem written
- [ ] Skills library updated with new patterns
- [ ] README catalog + root index.html link updated
- [ ] Committed to `claude/new-game-concept-OWaoA` branch and pushed

## Folder slug
`002-glyph-siege` — at `games/002-glyph-siege/`
