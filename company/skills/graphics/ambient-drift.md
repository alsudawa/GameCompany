# Skill — Theme-Conditional Ambient Drift

**When to use:** any game with a theme picker (skill: `ux/theme-picker.md`) where the gameplay canvas currently looks identical across themes except for foreground colors. A subtle drift layer tied to theme identity (void motes / sunset embers / forest petals) turns a palette swap into an *atmosphere* swap. Cheap to add, distinct per theme, zero-alloc so no perf cost.

This complements but does not replace the foreground particle pool (skill: `graphics/particle-fx.md`). Foreground particles are spawn-and-die (hit burst, miss shake). Ambient drift is persistent — a fixed pool whose members wrap around the viewport instead of dying.

## Pattern — persistent pool with wrap-around (not spawn/die)

```js
const AMBIENT_CAP = 20;
const ambient = [];
for (let i = 0; i < AMBIENT_CAP; i++) {
  ambient.push({
    x: Math.random() * W,
    y: Math.random() * H,
    size: 1.2 + Math.random() * 1.8,
    phase: Math.random() * Math.PI * 2,
    vBase: 18 + Math.random() * 22,    // base magnitude, theme picks sign
    swayAmp: 10 + Math.random() * 18,
    swayRate: 0.6 + Math.random() * 0.9,
  });
}
```

Key choices:
- **Initialize at random y positions, not all at `-14`** — otherwise first 5 seconds of gameplay has a weird empty sky waiting for particles to drift in.
- **Per-particle `vBase` / `swayAmp` / `swayRate`** — fixed at init, not randomized each frame. Keeps the pattern deterministic-looking (not chaotic) while still avoiding visible synchronization.
- **Random `phase` per particle** — prevents the "every particle is at the same point in its sine wave" lockstep look.
- **No `active` flag** — unlike the foreground pool, ambient particles are always alive. Wrapping is simpler than respawning.

## Pattern — theme-parameterized update (sign only, not magnitude)

```js
function updateAmbient(dt) {
  if (currentTheme === 'void') return;
  if (reducedMotion) return;
  const dir = currentTheme === 'forest' ? 1 : -1;   // +down / -up
  const t = state.t;
  for (const a of ambient) {
    a.y += dir * a.vBase * dt;
    a.x += Math.sin(t * a.swayRate + a.phase) * a.swayAmp * dt;
    // horizontal wrap
    if (a.x < -12) a.x = W + 12;
    else if (a.x > W + 12) a.x = -12;
    // vertical wrap = respawn on the opposite side with fresh x/phase
    if (dir < 0 && a.y < -14) { a.y = H + 14; a.x = Math.random() * W; a.phase = Math.random() * Math.PI * 2; }
    else if (dir > 0 && a.y > H + 14) { a.y = -14; a.x = Math.random() * W; a.phase = Math.random() * Math.PI * 2; }
  }
}
```

Why parametrize by sign, not by behavior:
- **Two directions cover three themes** — void = static/none, sunset = upward (dir=-1), forest = downward (dir=+1). One conditional branch, not three.
- **Void exits early** — no update cost when the current theme wants no drift layer. Skip means zero work, not "run but render invisible".
- **Reduced-motion exits early too** — particles freeze at their current positions. Still visible, just not moving.

## Pattern — theme-parameterized render (shape hint + flicker)

```js
function renderAmbient() {
  if (currentTheme === 'void') return;
  const isEmber = currentTheme === 'sunset';
  ctx.fillStyle = getVar('--accent');
  const t = state.t;
  for (const a of ambient) {
    const baseA = 0.10 + (a.size - 1.2) * 0.05;
    const flicker = isEmber ? 0.5 + 0.5 * Math.sin(t * 3.2 + a.phase) : 1;
    ctx.globalAlpha = baseA * (0.6 + 0.4 * flicker);
    if (isEmber) {
      ctx.beginPath();
      ctx.arc(a.x, a.y, a.size, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(a.x - a.size * 0.5, a.y - a.size * 1.1, a.size, a.size * 2.2);
    }
  }
  ctx.globalAlpha = 1;
}
```

Shape-per-theme tells a story without new assets:
- **Circle (ember)** — hot, round, glowy. Flicker via sinusoidal alpha modulation sells the "fire" metaphor.
- **Tall rectangle (petal)** — vertical-oriented, cheaper than ctx.rotate()+ctx.translate() would be, reads as a leaf/petal falling flat-side-to-gravity.
- **No shape (void)** — carry the atmosphere with the starfield layer alone; skip ambient entirely. Over-layering gets noisy.

Opacity choice: `0.10-0.25`. At this range the layer reads as "air texture" rather than foreground objects. Above 0.30 starts competing with pulses for attention.

## Pattern — gate with adaptive-quality flag

```js
if (renderStarfield) {   // Sprint 10 adaptive-quality flag
  // ... draw stars ...
  renderAmbient();        // drop together when device is slow
}
```

Both layers are pure decor. When the median-dt sampler (skill: `graphics/perf-budget.md`) decides the device is under budget, they disappear together. Treating them as one group is simpler than two flags, and perceptually correct — the player notices loss of atmosphere once, not twice.

## Pattern — respects theme change instantly

No cache to invalidate. Both update and render functions read `currentTheme` each call, so toggling theme at runtime via the picker (or `T` shortcut) changes direction/shape on the very next frame. Particles don't reset positions — they just start drifting the new way from where they are, which looks natural (wind shifted).

## Perf budget

- 20 particles × (add + sin + two compares) per frame = < 0.05 ms
- 20 `fillRect`/`arc` calls with no path building = < 0.15 ms on mobile
- Total: rounds to nothing. Safe even on low-end devices (and the adaptive-quality flag catches the outliers).

## Common mistakes

- **Spawning ambient particles from a burst pool on an interval** — leaks memory if the pool isn't big enough; requires lifetime management. The fixed-pool + wrap pattern is simpler and cheaper.
- **All particles at `y = H + 14` at init** — empty sky for the first 2-3 seconds. Spread initial `y` over `[0, H]`.
- **Same `swayRate` / `swayAmp` for every particle** — visible synchronization, looks mechanical. Randomize per-particle at init.
- **Ignoring `prefers-reduced-motion`** — continuous motion triggers nausea in sensitive users. Cheap fix: return early in the update only (not render). Frozen particles still visible, just still.
- **Re-reading `currentTheme` *outside* the loop and not inside** — if you theme-swap during an update, the particles for the rest of the frame behave with mixed direction. Read at the top of the function or per-frame only.
- **Drawing ambient on top of pulses instead of under** — becomes visual noise competing with gameplay. Draw before/under the vignette.
- **Per-theme particle *count*** — makes forest look sparse and sunset look crowded (or vice versa). Keep count uniform; vary behavior.
- **`save`/`restore` + `rotate` for each particle** — `ctx.save()` is not cheap if called 20 times per frame. The tall-rectangle petal fakes "shape" without state save.

<!-- added: 2026-04-17 (001-void-pulse sprint 15) -->
