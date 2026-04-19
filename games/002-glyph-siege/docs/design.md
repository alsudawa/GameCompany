# Game Design Document — 002-glyph-siege

**Designer:** @game-designer
**Status:** draft v1
**Date:** 2026-04-18

## Hook

**Hold a shrinking sanctuary. Move to survive. Stack six runes into a build that erases the horde.**

You are the last glyph of light in a bounded sigil-ring. Dark shapes close in from every edge. Your ward fires automatically at the nearest threat. Every fallen shape drops an ember; every five embers you level and choose one of three upgrades. Survive.

## Core loop (every ~2 seconds)

1. **Steer** — drag thumb (or hold direction) to move within the 720×960 arena.
2. **Auto-fire** — your ward emits a projectile at the nearest enemy every `fireInterval` seconds.
3. **Kills drop embers** — small XP motes with a magnet radius.
4. **Every ~5–8 kills** → level up → game pauses → pick 1 of 3 upgrade cards → resume.
5. **Every 90s** → boss spawns at one edge, enters arena with a telegraphed pattern.
6. Death → run-end screen (time, kills, level, embers) → RETRY in under 3s.

## Input mapping

**Touch (primary):**
- `pointerdown` on canvas → establishes floating joystick origin at tap point; visible ring fades in.
- `pointermove` (held) → vector from origin to current touch = direction; magnitude clamped to joystick radius (60px) = speed 0..1.
- `pointerup` → joystick fades out; player decelerates (keeps current velocity, no snap-stop — prevents cheap deaths on accidental release).

**Keyboard (desktop parity):**
- `W/A/S/D` or arrow keys → 8-way unit vector direction, magnitude 1.
- Space / Enter → activate buttons in overlays (start, retry, upgrade card focus).
- `M` → mute toggle.
- `Esc` → pause overlay.

**Attack:** never player-controlled. Projectile auto-fires at nearest enemy every `fireInterval`.

## Scoring & win/lose

- **Score** = time survived (seconds, integer) × 10 + kills × 5 + level × 100.
- **Displayed HUD metric**: time survived (primary), kills (secondary small), level (tertiary badge).
- **Lose condition**: player HP reaches 0. Enemies deal contact damage with a 400ms invuln grace after hit.
- **Win condition**: none. Endless. Leaderboard is localStorage best score.

## Arena

- 720×960 portrait, bounded by hard walls (player clamped, cannot exit).
- Visual frame: glowing sigil ring around edges, subtle pulse on boss spawns.
- Enemies spawn just outside visible area (16px off-edge) and walk inward.

## Entities

### Player ("the Glyph")
- Radius: 14px hitbox.
- Visual: central rune/glyph (inline SVG rotating slowly).
- Base speed: 200 px/s.
- Base HP: 5.
- Hit grace: 400ms invulnerability after contact (flashing).
- Pickup radius: 60px (magnetizes gems within).

### Weapon (base: "Ward Bolt")
- Fires every `fireInterval` seconds (base 0.9s).
- Projectile count: 1 (upgradable to 5).
- Projectile speed: 420 px/s.
- Projectile damage: 1 (upgradable).
- Projectile lifetime: 1.2s or on first hit.
- Targeting: nearest enemy at spawn; locked direction after spawn (no homing).
- Multi-shot pattern (2+ projectiles): fanned spread centered on target, ±10° per extra projectile.

### Enemies (4 types)

| Type | HP | Speed | Contact dmg | Drop (ember tier) | Spawn cost |
|------|----|----|------|-------------------|------------|
| Grunt | 1 | 70 | 1 | T1 (1 XP) | 1 |
| Scout | 1 | 140 | 1 | T1 (1 XP) | 1 |
| Heavy | 4 | 50 | 1 | T2 (3 XP) | 3 |
| Elite | 2 | 100 | 1 | T2 (3 XP, 2 drops) | 4 |

- All enemies seek the player (steering toward current position, no pathfinding — arena is open).
- Separation force: mild repulsion between overlapping same-type enemies (prevents infinite stacking on one pixel).
- Elite has a subtle glow halo and leaves a ground marker on death (no hazard — purely juice).

### Boss (patterned, every 90s)
- HP: `40 × bossIndex` (first boss = 40, second = 80, third = 120...).
- Spawn: clear telegraph — 2s red vignette pulse + audio drone, boss enters from top.
- Movement: slow (60 px/s) seek, with a charge-dash every 4s (telegraphed 600ms red line toward player, then dash at 280 px/s for 400ms).
- Contact dmg: 2.
- Drop: 15 T2 gems in a radial burst + guaranteed 1 level-up equivalent.

### Embers (XP gems)
- Tiers: T1 (1 XP, cyan), T2 (3 XP, purple), T3 (10 XP, gold — boss-only).
- Idle: sit at drop point with slow bob.
- Magnetism: when player within pickup radius, accelerate toward player at up to 400 px/s.
- Collection: on contact with player, add XP to level bar.

## Leveling

- XP required for level N → N+1: `20 + (N-1) × 8` (level 1→2 = 20 XP, 2→3 = 28, 3→4 = 36...).
- On level-up: game enters pause mode, overlay animates in with 3 randomly rolled upgrade cards.
- Max level: 50 (soft cap; all upgrades eventually max out).

## Upgrades (6 slots, each 3–5 tiers)

| ID | Name | Effect per tier | Max tiers |
|----|------|-----------------|-----------|
| DMG | Keen Edge | +1 projectile damage | 5 |
| RATE | Quick Sigil | ×0.85 fireInterval (compounding) | 5 |
| MULTI | Echo Ward | +1 projectile (fanned) | 4 (1→5) |
| SPD | Swift Foot | +30 player speed | 4 |
| MAGNET | Wide Reach | +30 pickup radius | 3 |
| VIT | Inner Light | +2 max HP and heal to full | 3 |

**Card rolling rules:**
- Always roll 3 distinct upgrades.
- Weight: at rank 0, each upgrade has weight 1; at rank N, weight `max(0.2, 1 - N/maxTier)`.
- Maxed upgrades rolled → replaced with "Small Vigor" (+1 current HP, no tier).
- Each card shows: inline-SVG icon + 2-word name + 1-line delta text ("Damage 1 → 2").

## Spawner / Wave composition

Difficulty is a continuous curve interpolated between 4 waypoints. At each tick (every 0.25s):
1. Compute `budget = waveBudget(t)` (spawn points available this batch).
2. Pick enemy types allowed at time `t`.
3. Fill batch: random enemies summing spawn cost ≤ budget, placed around arena perimeter.

### 4-Waypoint difficulty curve

| t (s) | Types | Spawn interval | Batch budget | Feel |
|-------|-------|----------------|--------------|------|
| 0     | Grunt | 2.0s | 1 | Intro. Enemies sparse. First kill within 2s. |
| 30    | Grunt, Scout | 1.2s | 3 | Velocity creeps in. First level-up fired. |
| 90    | Grunt, Scout, Heavy + **Boss #1** | 0.8s | 5 | Build must matter. Boss teaches positioning. |
| 180+  | All + Elite + **Boss #2,#3…** | 0.5s | 8 | Screen-clearing fantasy. Number-go-up dopamine. |

Interpolation: linear on all axes (spawn interval, batch budget, enemy mix weights).

Soft cap: if rolling 1s frame-time average > 18ms, scale `batch budget × 0.7` until recovered.

### Example spawn at t=60s (midway between 30 and 90)
- Spawn interval ≈ 1.0s
- Batch budget ≈ 4
- Types: Grunt (weight 2), Scout (weight 2), Heavy (weight 0.5)
- Example batch: 2 Grunt + 1 Scout + 1 Heavy

## Juice moments (layered per action)

**Projectile hit enemy:**
- Enemy flash white 80ms.
- Small 2-particle spark pool burst (same color as enemy outline).
- Micro-knockback 4px away from projectile direction.
- SFX: short triangle tick, pitch ladder per consecutive hit in 1s window.

**Enemy death:**
- 6–10 particle radial burst (color by type: grunt=gray, scout=yellow, heavy=red, elite=purple).
- Ember drop with small "pop" scale animation (0.0→1.1→1.0 over 180ms).
- SFX: soft sawtooth thud, pitched lower for larger enemies.
- Kill count HUD ticks (scale 1.0→1.1→1.0).

**Ember collected:**
- 150ms magnet swoop (interpolated curve).
- XP bar fills with easing animation.
- SFX: chime — sine wave, pitch scaled to ember tier (T1=C5, T2=E5, T3=G5).

**Level up:**
- Full-screen flash 120ms, cyan tint.
- Time freezes (game paused, particles slow to 0.1× for 200ms fade).
- Upgrade overlay slides in from top (220ms cubic-out).
- SFX: 3-note ascending arpeggio (C, E, G) sine + light reverb via delay node.

**Upgrade picked:**
- Card scales up 1.0→1.15→0.0 with fade, 280ms.
- Side effect: brief particle halo around player in card color.
- SFX: confirmed tone (square 440Hz, 80ms) + echo.

**Boss spawn:**
- 600ms red vignette pulse.
- Screen shake 6px (reduced-motion: 2px).
- SFX: low bass drone (sawtooth 55Hz, 1.2s, slow fade).
- HUD "!" indicator flashes at spawn edge.

**Boss charge telegraph:**
- Red line from boss to player, 600ms, pulsing.
- SFX: rising siren (oscillator frequency ramps 200→400Hz over 600ms).

**Boss defeated:**
- Screen flash white 200ms.
- 30-particle confetti burst at boss center, multi-color.
- Time dilation: 150ms slow-mo (all entity speeds ×0.2).
- 15 T2 gems radial-spread.
- SFX: major triad fanfare (C-E-G-C ascending, triangle waves).

**Player hit:**
- Screen shake 10px (reduced-motion: 3px).
- Red radial flash fading out 300ms.
- Player flashes red + invuln-state alpha blink (6 Hz).
- HP bar heart ticks (HP=N heart outline, HP=N-1 filled heart breaks to outline).
- SFX: dissonant minor tone (sawtooth 220Hz, 180ms).

**New best (run-end):**
- Gold ring around score, breathing animation.
- Haptic double-pulse (navigator.vibrate([40,40,80])).
- SFX: extended fanfare.

## Game feel checklist

- **Anticipation:** boss charge has 600ms telegraph (red line); enemy batches spawn with 35ms tick SFX per enemy; approaching-best score glows at 80% threshold.
- **Impact:** every hit stacks enemy-flash + spark + knockback + SFX; death stacks 4 feedback layers minimum.
- **Reaction:** input is acknowledged instantly — joystick ring appears on first touch frame; direction vector updates every render tick; projectile fires at spawn tick with visible launch particle.

## Accessibility

- `prefers-reduced-motion: reduce` → screen shake amplitude × 0.3, time-dilation durations × 0.3, particle counts × 0.5.
- Colorblind consideration: enemies differ in **shape** (grunt=circle, scout=triangle, heavy=square, elite=hexagon) and **size**, not only color.
- Keyboard reaches all UI: Tab order = start → mute → help → (during game) upgrade cards in order.
- HUD uses `aria-live="polite"` for level-up announcements and game-over stats.
- Joystick not required — keyboard is equal-class input. Both modes documented in start overlay.
- System font stack only (`system-ui, -apple-system, 'Segoe UI'`).

## Risks

1. **Scope creep toward weapon variety** — mitigation: the "Echo Ward" upgrade delivers the multi-shot fantasy within one weapon. No secondary slot.
2. **First 10 seconds feel empty** — single grunt every 2s at start. Mitigation: first enemy spawns at t=0.3s, not at t=2s; tutorial text "MOVE" fades at first pointerdown or arrow press (removed at first level-up).
3. **Upgrade cards too abstract for 2-second scan** — mitigation: the delta text (e.g., "Damage 1 → 2") shows current and next value explicitly. Icon uses consistent SVG language per category.
4. **Boss feels like a numbers wall** — mitigation: boss has **one** telegraphed mechanic (charge dash) that rewards positioning. Skill expression, not HP sponge.
5. **Performance**: lean on entity pools, spatial hash, batched `ctx.fill()` per enemy type, capped active entities, soft-cap throttle.
6. **Joystick vs tap-to-move confusion**: mitigation: immediate visible joystick ring on first drag; brief first-run hint "DRAG TO MOVE" under canvas, dismissed at first pointerdown.

## Ship tunings (starting values — subject to playtest)

```
PLAYER_SPEED_BASE = 200    // px/s
PLAYER_HP_BASE = 5
PLAYER_INVULN_MS = 400
PLAYER_PICKUP_R_BASE = 60

WEAPON_INTERVAL_BASE = 0.9 // s
WEAPON_DAMAGE_BASE = 1
WEAPON_PROJ_COUNT_BASE = 1
WEAPON_PROJ_SPEED = 420
WEAPON_PROJ_LIFETIME = 1.2

XP_TO_LEVEL = (n) => 20 + (n-1) * 8

SPAWN_WAYPOINTS = [
  { t: 0,   interval: 2.0, budget: 1, types: ['grunt'] },
  { t: 30,  interval: 1.2, budget: 3, types: ['grunt','scout'] },
  { t: 90,  interval: 0.8, budget: 5, types: ['grunt','scout','heavy'] },
  { t: 180, interval: 0.5, budget: 8, types: ['grunt','scout','heavy','elite'] },
]

BOSS_INTERVAL = 90         // s
BOSS_HP = (n) => 40 * n    // n = 1,2,3...

UPGRADE_TIERS = { DMG:5, RATE:5, MULTI:4, SPD:4, MAGNET:3, VIT:3 }
```

## Open questions (resolved in build)

- [x] Bounded arena vs scrolling camera → **bounded** (simpler, matches mobile portrait, fits "closing siege" reinterpretation).
- [x] Weapon count → **1** (Echo Ward upgrade delivers multi-shot).
- [x] Enemy count → **4** (shape + size differentiated).
- [x] Boss mechanics → **one telegraphed charge dash** (no bullet patterns).
- [ ] Mute toggle placement → Lead Dev to decide (corner icon or keyboard-only).
- [ ] Joystick radius (currently 60px) → playtest to tune, may change to 50 or 75.
- [ ] Starting HP (5) vs (3) for tension → playtest decision.
