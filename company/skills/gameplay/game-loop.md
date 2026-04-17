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
