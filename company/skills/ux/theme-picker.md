# Skill — Theme Picker via `data-theme` + Canvas-Cache Invalidation

**When to use:** any canvas-based game with more than 2 color tokens where players play long enough that the palette starts to fatigue (~ten+ sessions). A theme picker is a cheap personalization lens that doesn't touch gameplay — but there's a classic trap when canvas colors cache across paints, so this doc focuses on the invalidation plumbing, not the palette taste.

## Pattern — declare palettes as CSS variables under `[data-theme="..."]`

```css
:root {
  --bg:     #0a0e1f;
  --fg:     #e8e9ff;
  --accent: #00d4ff;
  --danger: #ff3d6b;
  --highlight: #ffd24a;
  --vignette-near-rgb: 82, 92, 180;   /* triplet for rgba() composition */
  --vignette-far-rgb:  15, 18, 38;
}
[data-theme="sunset"] {
  --bg:     #1a0b1a;
  --fg:     #ffe9d6;
  --accent: #ffb84a;
  --danger: #ff4d6d;
  --highlight: #ff8fb1;
  --vignette-near-rgb: 180, 92, 120;
  --vignette-far-rgb:  38, 15, 28;
}
[data-theme="forest"] { /* ... */ }
```

Why `[data-theme="..."]` on `<html>` and not a class?
- Class would be `.theme-sunset` etc. → specificity collides with other classes.
- Data attribute is semantically "this is a preference/mode", which is what it is.
- Only one value can be set, so you can't accidentally stack two themes.
- Selector is low-specificity so component styles still override cleanly.

## Pattern — RGB triplets for canvas rgba() composition

Canvas `addColorStop` wants `'rgba(r, g, b, a)'` strings. If you stored `--vignette-near: rgb(82, 92, 180)`, you can't tack on an alpha. Instead store the triplet raw:

```css
--vignette-near-rgb: 82, 92, 180;
```

```js
const near = getVar('--vignette-near-rgb');
grad.addColorStop(0, 'rgba(' + near + ', ' + alpha + ')');
```

One small string-concat at render time, and the alpha is fully parametric. Alternative (`color-mix` in canvas) is not supported in any browser.

## Pattern — cache invalidation on theme change (the real trap)

If your canvas render reads theme colors via a cached getter:

```js
const cssVar = {};
function getVar(name) {
  if (cssVar[name]) return cssVar[name];
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  cssVar[name] = v || '#ffffff';
  return cssVar[name];
}
```

…then the cache prevents a re-read after `data-theme` changes. You'll swap the overlay colors but the canvas will keep painting yesterday's palette. Any cached `CanvasGradient` objects (e.g. the perf-budget vignette cache) are also stale — a `CanvasGradient` is a snapshot of color stops.

Fix: **invalidate every downstream cache on theme apply**.

```js
function invalidateThemeCaches() {
  for (const k in cssVar) delete cssVar[k];
  for (let i = 0; i < vignetteCache.length; i++) vignetteCache[i] = null;
}
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  invalidateThemeCaches();
  // sync picker radio state, etc.
}
```

Checklist — whenever you cache a color-derived value, register it here:
- `cssVar` string cache
- `CanvasGradient` instances (linear or radial)
- `Path2D` with baked-in stroke colors (rare, but possible)
- Offscreen canvases used as sprite buffers
- Particle color strings stored per-spawn (these are fine; they're reset per particle on next spawn, so no invalidation needed — but don't reuse them across theme boundaries if the particle is still active)

## Pattern — apply the persisted theme **before first paint**

```js
const currentTheme = readTheme();
applyTheme(currentTheme);   // run before your render loop starts
```

If you apply after the first `requestAnimationFrame`, the player sees a one-frame flash of the default theme, then a swap. Subtle but noticeable on slower devices.

## Pattern — swatch previews ≠ theme tokens

The theme picker buttons need to show each theme's preview colors **regardless of which theme is currently active**. If you use `var(--accent)` in a swatch, the player on sunset sees three amber swatches — useless.

Solution: hardcode each swatch's preview colors:

```css
.swatch-void   { background: radial-gradient(circle at 35% 35%, #00d4ff 0 40%, #0a0e1f 70% 100%); }
.swatch-sunset { background: radial-gradient(circle at 35% 35%, #ffb84a 0 40%, #1a0b1a 70% 100%); }
.swatch-forest { background: radial-gradient(circle at 35% 35%, #5de4b4 0 40%, #081613 70% 100%); }
```

Yes, you're duplicating color values. That's correct — the palettes are declared once in `[data-theme=...]` and previewed once in `.swatch-*`. Two touchpoints per color, not one. Mechanical duplication beats conditional CSS hackery.

## Pattern — visible feedback that the swap reached the canvas

On theme change, pulse the target ring:

```js
state.targetPopT = 1;
```

This plays the existing "hit" pop animation on canvas. The player sees a gesture that *proves* the swap reached gameplay rendering, not just the chrome. Without it, players on low-contrast swaps (two teal-adjacent themes) sometimes aren't sure the button worked.

## Pattern — storage + keyboard shortcut

```js
const THEMES = ['void', 'sunset', 'forest'];
function readTheme() {
  try {
    const t = localStorage.getItem('game-theme');
    return THEMES.includes(t) ? t : 'void';
  } catch { return 'void'; }
}
function cycleTheme() {
  const i = THEMES.indexOf(currentTheme);
  setTheme(THEMES[(i + 1) % THEMES.length]);
}
```

Bind a keyboard shortcut (`T` is free, memorable); otherwise theme-cycling requires returning to the start overlay between runs, which is friction for A/B comparison.

## What to theme vs. what to keep fixed

**Theme:**
- `--bg`, `--fg`, `--accent`, `--danger`, `--highlight` — the emotional palette
- Vignette RGB triplets — big visual surface, needs to coordinate with bg
- Subtle accents (lost-life color, combo meter gradient second stop)

**Don't theme:**
- Rainbow/celebration gradients (NEW BEST) — meant to be dramatic and cross-theme neutral
- `--shadow` — a black-drop shadow looks correct in every theme
- `--radius` — geometry, not color
- Life-lost red tint (`rgba(255,61,107,...)` keyframe) — is it worth making `--danger-rgb`? Probably, but the return is small; leave hardcoded unless a theme actually needs red to not be red.

## Common mistakes

- **Not invalidating `cssVar` cache** → canvas stays on the previous palette until full reload. Symptom: overlay flips correctly, gameplay doesn't.
- **Not invalidating cached `CanvasGradient` / offscreen canvases** → vignette or pre-rendered sprites stay stale even though `cssVar` re-reads. Symptom: HUD colors update but the radial background doesn't.
- **Referencing `var(--accent)` in the swatch previews** → previews all show the active theme, not their own. Symptom: theme picker looks identical between themes.
- **Reading themes with no validation** → a corrupted localStorage value becomes the `data-theme`, breaking every selector. Fix: `THEMES.includes(t) ? t : 'void'`.
- **Theme applied after first render** → one-frame default-color flash. Fix: `applyTheme` runs synchronously before `requestAnimationFrame`.
- **Storing RGB as `rgb(...)` strings instead of triplets** → can't compose alpha at paint time. Fix: store raw triplets.
- **Transition animations on `color` properties across theme swaps** → players see a 200ms color-lerp on every HUD element when cycling. Cute once, distracting by the third cycle. Leave the swap instant.

<!-- added: 2026-04-17 (001-void-pulse sprint 14) -->
