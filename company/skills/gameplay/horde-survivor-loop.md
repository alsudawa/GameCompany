# Horde Survivor Loop

**Where used:** `games/002-glyph-siege/` (the whole folder)

The meta-pattern underlying Vampire Survivors, Brotato, Survivor.io, Magic Survival. When distilled for a single-file web game, it reduces to four systems talking to one state object.

## The four systems

1. **Input** — one vector (dx, dy, mag 0..1). No attack button. See `skills/gameplay/virtual-joystick.md`.
2. **Spawner** — interpolates between waypoints (see `skills/gameplay/difficulty-curve.md`) to output (spawn interval, batch budget, allowed types) at any `t`.
3. **Auto-weapon** — on a cooldown, fires projectile(s) at the nearest enemy. Multi-shot fans angular offsets.
4. **Level-up loop** — kills drop XP gems; gems magnetize to player; accumulated XP triggers a 3-card upgrade choice (see `skills/ux/upgrade-choice.md`), which mutates weapon/player stats.

Plus: **boss** at fixed `t` intervals, which halts spawner and introduces one telegraphed mechanic.

## Why it works

- **One-input mental model** — the player never asks "what button?" They only ask "where should I be?" Every moment of play has *many valid answers* (emergent skill), unlike rhythm-tap which has *one*.
- **Power-fantasy arc within one run** — 90 seconds from "1 damage, 1 projectile" to "5 damage, 5 fan projectiles, 2× fire rate" is a dopamine curve that no meta-progression can match.
- **Combinatorial depth from 6 variables** — 6 upgrades × 3–5 tiers = hundreds of buildstates. Every run feels different without any new content.

## The state shape

```js
state = {
  t: 0, kills: 0, xp: 0, xpNeeded: 20, level: 1,
  running, paused, over,
  hitFlashMs, levelFlashMs, bossVignetteMs, shake,
  spawnAcc, bossNext, bossIndex,
  input: { dx, dy, mag, active, originX, originY, curX, curY },
};
player = {
  x, y, r, hp, hpMax, speed, pickupR,
  fireInterval, fireAcc, damage, projCount,
  invulnMs, rot, ranks: { DMG,RATE,MULTI,SPD,MAGNET,VIT },
};
pools = { enemies, projectiles, gems, particles }; // pre-allocated, reused
boss = { active, x, y, hp, hpMax, r, dashState, dashT, ... };
```

## The step order (deterministic)

Inside `step(dt)`:

1. `state.t += dt`
2. `tickWaves(dt)` — may spawn new enemies
3. `tickBoss()` — may spawn boss, halts wave spawner
4. `updatePlayer(dt)` — movement, weapon cooldown, invuln tick, auto-fire
5. `updateEnemies(dt)` — seek + contact damage + separation
6. `updateBoss(dt)` — state machine + contact
7. `updateProjectiles(dt)` — movement, collision (projectile × enemy, projectile × boss), damage application, death handling
8. `updateGems(dt)` — magnet + pickup
9. `updateParticles(dt)` — pure kinematic drift
10. Decay timers (shake, hit-flash, level-flash, boss-vignette)
11. `if (player.hp <= 0) endRun()`
12. `checkLevelUp()` — if XP crossed, pause and show upgrade overlay

Render is separate and only reads state. The loop uses fixed-timestep (1/60s) with `dt` capped at 1/30s to survive tab-switch bursts.

## Scope lock (what to NOT build)

Horde Survivor is the genre most prone to scope creep. Lock these at brief time:

- **One weapon.** "Multi-shot" is an upgrade to the base weapon, not a second weapon slot. Second weapons double code surface area for 20% more fun.
- **Bounded arena.** Skip the scrolling camera. "Enemies close from all edges" plus "arena is tight" gives the same siege feeling with 0 lines of camera code.
- **No meta-progression.** Persistent unlocks between runs add a save-system, a currency, a shop UI, and 2–3 weeks of balancing. Cut them.
- **One boss pattern.** A boss with one telegraphed mechanic (charge dash, for us) is 50 lines. A boss with multi-phase bullet hell is 500.
- **No secondary weapons / passives.** The 6-upgrade menu IS the depth. Don't fork it into two menus.

## Performance shape

Target: 60fps with 180 enemies + 140 projectiles + 300 particles on mid-tier mobile Chrome.

- Pre-allocate entity pools; never `new` in the hot loop.
- Batch canvas draws by type (all grunts in one arc loop, all projectiles in one lighter-blend loop).
- Collision: O(projectiles × enemies) ≈ 28k/frame is fine; enemy-enemy separation O(n²) ≈ 20k/frame is borderline at 200 enemies — swap to `skills/gameplay/spatial-hash.md` (TODO) if scaling up.
- Render is cheap because everything is a primitive shape; no textures, no text-rendering in the loop.

## Feel checklist

- First kill within 3 seconds of tapping Start. (First enemy spawns at t≈0.3s, weapon fires at t=0.9s.)
- First level-up within 30 seconds. (20 XP / 1 XP-per-grunt at spawn rate 2s/grunt.)
- Median death at 60–90 seconds. (Per void-pulse "design for median loss"' rule.)
- Every kill stacks 3+ feedback layers (flash + spark + SFX + gem drop).
- Boss spawn shakes the screen. No exceptions.

## Pairs well with

- `skills/ux/upgrade-choice.md` — the level-up overlay
- `skills/gameplay/virtual-joystick.md` — the move input
- `skills/gameplay/difficulty-curve.md` — the 4-waypoint wave table
- `skills/gameplay/game-loop.md` — the fixed-timestep spine
- `skills/graphics/particle-fx.md` — the pool shape
- `skills/audio/web-audio-sfx.md` — the Sfx module
- `skills/mobile/dpr-canvas.md` — the DPR-aware canvas
