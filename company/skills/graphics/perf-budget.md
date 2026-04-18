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

## Pattern — memoize `localStorage` reads called from the frame loop

<!-- added: 2026-04-18 (001-void-pulse, sprint 54) -->

If your render or update path calls a function that does `localStorage.getItem` + `JSON.parse` per frame, that's **synchronous I/O on the hot path**. On low-end mobile, `getItem` alone is 30-100µs; a JSON.parse of even a small object adds another 10-30µs. At 60Hz that's a baseline 2-8ms/frame eaten before anything else happens. At 144Hz it can be 5-19ms — over a third of the frame budget on storage I/O.

The fix is a **lazy in-memory cache** with sync-on-write:

```js
// Cache the parsed map; first call populates from storage, subsequent calls
// return the same reference. Mutations propagate via writeAchievements()
// which keeps cache + storage in lockstep.
let _achCache = null;
function _readAchievementsFromStorage() {
  try {
    const raw = localStorage.getItem(ACH_KEY);
    const o = raw ? JSON.parse(raw) : null;
    if (!o || typeof o !== 'object' || Array.isArray(o)) return {};
    const out = {};
    for (const id of Object.keys(o)) if (o[id]) out[id] = 1;
    return out;
  } catch { return {}; }
}
function readAchievements() {
  if (_achCache === null) _achCache = _readAchievementsFromStorage();
  return _achCache;
}
function writeAchievements(o) {
  _achCache = o;   // both eval functions mutate the returned map in place;
                   // assigning the same reference keeps cache coherent.
  try { localStorage.setItem(ACH_KEY, JSON.stringify(o)); } catch {}
}
```

> **Coherence rule.** The eval functions mutate the returned map in place (`unlocked[a.id] = 1`), so the cache is naturally always up to date. The `writeAchievements(unlocked)` call is for *persistence*, not for cache sync. If your eval pattern instead allocates a new map every call, set `_achCache = newMap` explicitly inside the writer.

> **Devtools tampering trade-off.** A user who edits `localStorage` mid-session won't see changes reflected until the next reload — the in-memory cache wins. This is the right behavior for game state (no hostile interruption mid-run), wrong for true settings (theme, mute) which are read once at boot anyway.

### When to apply this

Run a `grep -n 'localStorage\.\(get\|set\)Item' game.js` audit. For each read site, ask: **how often is this called?** If the answer is "every frame" or "every input event", memoize. If the answer is "once at boot" or "once per gameover", leave it alone — the read is fine and avoids cache-invalidation burden.

Common hot-path culprits found in casual games:
- Achievement evaluators called from update() per frame.
- "Is muted?" checks inside SFX play paths (each tap reads storage).
- Theme palette lookups inside render() (theme rarely changes; cache one variable).
- Stats panel that opens during a paused run but re-reads storage every render-tick of the open panel.

## Pattern — diff-guard HUD `textContent` writes

<!-- added: 2026-04-18 (001-void-pulse, sprint 54) -->

DOM `textContent` setters are surprisingly expensive — they invalidate layout for the containing element (and parent if `display: inline`) and trigger a paint pass. Worse, building the *string* you assign often involves template-literal concatenation, which allocates per call. Both costs disappear if the displayed value hasn't changed.

```js
// 🚩 RED FLAG — string concat + DOM write per frame even when combo is steady
const m = comboMult();
if (state.combo > 0) {
  const multStr = m > 1 ? '×' + m.toFixed(1) + ' ' : '';
  hudCombo.textContent = multStr + state.combo;   // every frame, 60-144 times/sec
} else {
  hudCombo.textContent = '';
}

// ✅ Diff-guarded — string built only when combo or multiplier changed
let lastDisplayedCombo = -1;
let lastDisplayedComboMult = -1;
const m = comboMult();
if (state.combo !== lastDisplayedCombo || m !== lastDisplayedComboMult) {
  if (state.combo > 0) {
    const multStr = m > 1 ? '×' + m.toFixed(1) + ' ' : '';
    hudCombo.textContent = multStr + state.combo;
  } else {
    hudCombo.textContent = '';
  }
  lastDisplayedCombo = state.combo;
  lastDisplayedComboMult = m;
}
```

The score HUD already had this pattern (`if (state.score !== lastDisplayedScore)`); the win is finding the HUD elements that *don't* and adding the same guard. Sentinel values (`-1` for numbers, `null` for tiers, `''` for strings) ensure the first frame still renders.

## Pattern — hoist scratch context + result objects out of the frame loop

<!-- added: 2026-04-18 (001-void-pulse, sprint 54) -->

A common per-frame pattern: build a small `{score, peakCombo, ...}` context object and pass it to a check function that returns a list of "things that just happened." The object literal + the `[]` allocation both hit the GC heap each frame.

```js
// 🚩 RED FLAG — fresh object literal + fresh array per frame
const justUnlocked = evaluateMidRunAchievements({
  score: state.score,
  peakCombo: state.peakCombo,
  perfectCount: state.perfectCount,
  hitCount: state.hitCount,
  duration: state.t,
});
for (const ach of justUnlocked) showAchievementToast(ach);

// ✅ Hoisted scratch — mutate fields, reset array length
const _midRunCtx = { score:0, peakCombo:0, perfectCount:0, hitCount:0, duration:0 };
const _midRunJustNow = [];

function evaluateMidRunAchievements(ctx) {
  const unlocked = readAchievements();
  _midRunJustNow.length = 0;     // reset, don't reallocate
  for (const a of ACHIEVEMENTS) {
    if (a.midRun && !unlocked[a.id] && a.test(ctx)) {
      unlocked[a.id] = 1;
      _midRunJustNow.push(a);
    }
  }
  if (_midRunJustNow.length) writeAchievements(unlocked);
  return _midRunJustNow;
}

// caller (in update()):
_midRunCtx.score = state.score;
_midRunCtx.peakCombo = state.peakCombo;
// ... etc ...
const justUnlocked = evaluateMidRunAchievements(_midRunCtx);
for (const ach of justUnlocked) showAchievementToast(ach);
```

> **Safety rule.** A hoisted scratch array is only safe to return when the caller consumes it **synchronously** before the next frame. `for…of` is fine. Storing `justUnlocked` somewhere for later use (e.g. queueing it for an async toast animation that fires next frame) breaks the assumption — the next frame's `length = 0` will wipe what was queued. In our case `showAchievementToast` enqueues references to the ach *objects* (not the array slot), so it's safe.

## Pattern — cache template-literal canvas font strings

<!-- added: 2026-04-18 (001-void-pulse, sprint 54) -->

```js
// 🚩 RED FLAG — template literal allocated per frame during a 0.5s milestone
const fontPx = Math.min(72, Math.floor(W * 0.1));
ctx.font = `700 ${fontPx}px system-ui, -apple-system, sans-serif`;

// ✅ Cache by canvas width (the only input; only changes on resize)
let _milestoneFont = '';
let _milestoneFontW = -1;
if (W !== _milestoneFontW) {
  const fontPx = Math.min(72, Math.floor(W * 0.1));
  _milestoneFont = '700 ' + fontPx + 'px system-ui, -apple-system, sans-serif';
  _milestoneFontW = W;
}
ctx.font = _milestoneFont;
```

Lower-priority than the HUD-textContent or localStorage fixes (since it only fires during the milestone window), but the same general lesson: any template literal inside a per-frame branch can be cached by its inputs. If the inputs are stable (W only changes on resize), the cache stays warm forever after the first call.

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
