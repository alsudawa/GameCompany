# Skill — Per-Frame Allocation Audit + Adaptive Quality

**When to use:** any canvas game that ships to mobile. Casual games run on millions of phones, including 5-year-old Androids with 60Hz screens and aggressive thermal throttling. A 60fps win on your M2 MacBook can be a 28fps slog on a Galaxy A12 — and the player gets no warning, just stutter. Two cheap interventions catch most of it: zero-allocation render + adaptive quality.

## Anti-pattern: per-frame `new` in render

The render loop runs 60-144 times per second. Anything you allocate inside it ends up on the GC heap, and one round of GC mid-frame produces visible jank. Common offenders:

```js
function render() {
  // BAD — creates a new CanvasGradient every frame (≈80 bytes + 2 stops + GC)
  const grad = ctx.createRadialGradient(cx, cy, r0, cx, cy, r1);
  grad.addColorStop(0, `rgba(80, 90, 180, ${0.2 + 0.2 * heat})`);
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

  // BAD — creates a new array every frame
  ctx.setLineDash([14, 8]);

  // BAD — string concat per pulse per frame
  ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${a})`;
}
```

## Pattern — bucket-and-cache for parameter-driven gradients

If the gradient depends on a continuous value (e.g. combo "heat"), discretize into 4-8 buckets and cache one gradient per bucket. The visual difference is imperceptible because the colors are already smooth radial blends.

```js
const VIGNETTE_BUCKETS = 6;
const vignetteCache = new Array(VIGNETTE_BUCKETS);

function render() {
  const heatBucket = Math.min(VIGNETTE_BUCKETS - 1,
    Math.floor(Math.min(1, state.combo / 30) * VIGNETTE_BUCKETS));
  let grad = vignetteCache[heatBucket];
  if (!grad) {
    const a = 0.22 + 0.2 * (heatBucket / (VIGNETTE_BUCKETS - 1));
    grad = ctx.createRadialGradient(CENTER_X, CENTER_Y, 80, CENTER_X, CENTER_Y, 640);
    grad.addColorStop(0, 'rgba(82, 92, 180, ' + a.toFixed(3) + ')');
    grad.addColorStop(1, 'rgba(15, 18, 38, 0)');
    vignetteCache[heatBucket] = grad;
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
}
```

After the cache fills (≤6 frames), no allocations happen on this path forever.

## Pattern — hoist tiny arrays/strings out of the loop

```js
const HEARTBEAT_DASH = [14, 8];
const NO_DASH = [];

for (const p of pulses) {
  if (p.heartbeat) ctx.setLineDash(HEARTBEAT_DASH);
  // ...draw...
  if (p.heartbeat) ctx.setLineDash(NO_DASH);
}
```

`setLineDash([])` was creating one new array per heartbeat per frame. With 5+ heartbeats on screen at high combo, that's 300+ allocations per second.

## Pattern — cache `getComputedStyle` once

CSS variables are cheap to read but `getComputedStyle()` is not — it forces style recalc.

```js
const cssVar = {};
function getVar(name) {
  if (cssVar[name]) return cssVar[name];
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  cssVar[name] = v || '#ffffff';
  return cssVar[name];
}
```

Costs one style flush at first call per variable, then a hash lookup forever after.

## Pattern — adaptive quality (median-dt sampling)

Don't ship a "low quality" toggle and hope the player finds it. Detect slow devices in the first ~60 frames after start and quietly drop the cheapest cosmetic layer.

```js
const ADAPTIVE_SAMPLE_FRAMES = 60;
const ADAPTIVE_BUDGET_MS = 22;        // ~45fps cutoff
const dtSamples = new Float32Array(ADAPTIVE_SAMPLE_FRAMES);
let dtSampleIdx = 0;
let dtSamplesFull = false;
let renderStarfield = true;          // the "drop me first" layer

function sampleFrameDt(dt) {
  if (dtSamplesFull) return;
  dtSamples[dtSampleIdx++] = dt * 1000;
  if (dtSampleIdx >= ADAPTIVE_SAMPLE_FRAMES) {
    dtSamplesFull = true;
    const arr = Array.from(dtSamples).sort((a, b) => a - b);
    const median = arr[arr.length >> 1];
    if (median > ADAPTIVE_BUDGET_MS) renderStarfield = false;
  }
}
```

Three rules:
1. **Median, not mean.** A single 200ms hitch (JIT warmup, GC pause) shouldn't trigger downgrade.
2. **Drop pure-cosmetic layers first.** Background starfield, particle density, vignette resolution — never gameplay-relevant rendering.
3. **One-shot sampling, not continuous.** Once we've decided "this device is slow", stop sampling. Thermal throttling could re-trigger downgrades, which would feel glitchy.

## Pattern — dev FPS overlay behind URL flag

When debugging perf, you don't want a permanent FPS counter cluttering the UI. Gate it behind `?fps=1` so devs and curious players can opt in:

```js
const SHOW_FPS = (() => {
  try { return new URLSearchParams(location.search).get('fps') === '1'; } catch { return false; }
})();

// In frame():
if (SHOW_FPS) updateFpsOverlay(dt);
```

The overlay element is built lazily on first call so non-debug runs pay zero cost.

```js
let fpsEl = null;
let fpsAccum = 0, fpsFrames = 0, fpsAccumTime = 0;
function updateFpsOverlay(dt) {
  if (!fpsEl) {
    fpsEl = document.createElement('div');
    fpsEl.id = 'fpsOverlay';
    fpsEl.style.cssText = 'position:absolute;top:6px;left:6px;z-index:99;font:11px ui-monospace;color:#9eb;background:rgba(0,0,0,.45);padding:2px 6px;border-radius:4px;pointer-events:none';
    app.appendChild(fpsEl);
  }
  fpsAccum += dt; fpsFrames++; fpsAccumTime += dt;
  if (fpsAccumTime >= 0.5) {
    fpsEl.textContent = (fpsFrames / fpsAccum).toFixed(0) + ' fps' + (renderStarfield ? '' : ' · low');
    fpsAccum = fpsFrames = fpsAccumTime = 0;
  }
}
```

Aggregate over 0.5s (not per-frame) so the displayed value is stable enough to read.

## What NOT to optimize

- **Object pools for things that spawn ≤10/sec.** A pool of 256 particles is good; a pool of 5 milestone-text objects is over-engineering.
- **Inlining hot functions.** Modern JIT inlines aggressively. Manual inlining usually hurts readability without measurable speedup.
- **Replacing `for (const x of arr)` with `for (let i = 0; i < arr.length; i++)`.** V8 optimizes both equally.
- **Using `Float32Array` for everything.** Real wins only on >1k element arrays touched per frame.

## Common mistakes

- **Profiling on the dev machine only.** Always test on a real low-end Android. CrUX percentile data shows the median Android web user is on ≤4GB RAM.
- **Adaptive quality based on FPS instantly.** Triggers downgrade on every JIT warmup. Use median over a window, and only sample once.
- **Dropping gameplay-relevant rendering for adaptive quality.** Pulses, score, lives — never dim these. Only cosmetic layers.
- **`will-change` everywhere.** Each `will-change` allocates a GPU layer. Apply only to elements that animate continuously (e.g. score `pop`), not to everything.
- **Forgetting that `console.log` is slow.** Inside render, even a single log per frame can drop you from 60→45fps in DevTools.

<!-- added: 2026-04-17 (001-void-pulse sprint 10) -->
