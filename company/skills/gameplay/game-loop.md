# Skill — Game Loop (fixed timestep)

**When to use:** every GameCompany project. This is the default loop.

## Why fixed-timestep

- Physics stays deterministic regardless of framerate
- Tab-switching (which sends huge `dt`) can't explode state
- Render is decoupled → variable framerate is fine

## Snippet

```js
const FIXED_DT = 1 / 60;   // physics step
const MAX_DT   = 1 / 30;   // tab-switch cap

let lastTime = 0, acc = 0;
function frame(now) {
  if (!state.running) return;
  const dt = Math.min((now - lastTime) / 1000, MAX_DT);
  lastTime = now;
  acc += dt;
  while (acc >= FIXED_DT) {
    update(FIXED_DT);
    acc -= FIXED_DT;
    if (state.over) break;   // don't keep stepping after game-over
  }
  render();
  if (!state.over) requestAnimationFrame(frame);
}

function start() {
  state.running = true;
  state.over = false;
  lastTime = performance.now();
  acc = 0;
  requestAnimationFrame((t) => { lastTime = t; frame(t); });
}
```

## Common mistakes

- Forgetting `MAX_DT` cap → tab-switch for 10s, come back, entities teleport
- Using `dt` from `frame` arg directly without smoothing
- Allocating inside `update` / `render` → GC pauses
- Not early-exiting when `state.over` inside the catch-up `while`

## Tuning

- `FIXED_DT = 1/60` is the default. Use `1/120` only if you need high-precision collision.
- Cap `acc` at `FIXED_DT * 5` if you're paranoid about spiral-of-death on slow devices.

<!-- added: 2026-04-17 (001-void-pulse sprint 4) -->

## Pattern — Render interpolation for 120/144Hz displays

Fixed-step physics at 60Hz + `requestAnimationFrame` running at 120/144Hz = visible stair-stepping. Each frame, physics hasn't advanced since the previous frame, so positions repeat. Fix: snapshot previous positions before each update step, render at the interpolated value using the leftover accumulator.

```js
function frame(now) {
  if (!state.running) return;
  const dt = Math.min((now - lastTime) / 1000, MAX_DT);
  lastTime = now;
  acc += dt;
  while (acc >= FIXED_DT) {
    // Snapshot every moving entity's last position before stepping.
    for (const p of pulses) { if (p.active) p.prevR = p.r; }
    update(FIXED_DT);
    acc -= FIXED_DT;
    if (state.over) break;
  }
  // acc ∈ [0, FIXED_DT); use it as an interpolation factor.
  const alpha = Math.min(1, acc / FIXED_DT);
  render(alpha);
  if (!state.over) requestAnimationFrame(frame);
}

// In render:
for (const p of pulses) {
  if (!p.active) continue;
  const rDraw = p.prevR + (p.r - p.prevR) * alpha;
  ctx.arc(CENTER_X, CENTER_Y, rDraw, 0, Math.PI * 2);
  ctx.stroke();
}
```

Also initialize `prevR = 0` at spawn so a new pulse renders cleanly from frame 1 without "popping" from an old `prevR` of an inactive slot.

**Physics stays deterministic** (still 60Hz fixed-step); **display runs native-refresh**. This is one of the highest-ROI visual upgrades a Canvas game can ship.

**Don't interpolate everything.** Particles / timers / flash overlays are too short-lived for interpolation to matter — stick to the main entities (player, projectiles, enemies, pulses).
