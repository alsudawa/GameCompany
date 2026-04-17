# Skill — DPR-aware Canvas

**When to use:** any Canvas 2D game shipped to mobile / retina displays. Without this, rings and text are blurry on high-density screens.

## The snippet

```js
const W = 720, H = 960;          // logical coords — all draw calls use these
const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');

function setupCanvas() {
  // Cap at 2× — 3× / 4× phones cost fill-rate without looking visibly sharper
  // for most 2D primitives.
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (canvas.width !== W * dpr) {
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
setupCanvas();
window.addEventListener('resize', setupCanvas);
```

After this, every `ctx.arc(x, y, r, ...)` with `x, y, r` in logical coords draws at backing-pixel `(x*dpr, y*dpr, r*dpr)`. CSS sizing (e.g. `aspect-ratio: 720/960; max-width: 100vw`) controls display size; the browser downscales the oversized backing store to fit, which always looks crisp.

## Cap DPR at 2

Phones with DPR 3 (iPhone Plus) or 4 (some Android) exist. For 2D vector graphics (rings, text), 2× is indistinguishable from 3× but uses 44% fewer backing pixels. For pixel-art or photography, raise the cap.

## Common mistakes

- **Setting `canvas.width = W` (no DPR).** Backing store is small; browser upscales to fit CSS display size → blurry.
- **Forgetting `setTransform`.** Backing store is big but you're still drawing to logical-pixel `(0, 0)`, leaving 75% of the canvas empty.
- **Re-scaling on every frame.** `setTransform` is cheap but re-adding it each `render()` compounds if any other transform is active. Call once in `setupCanvas()` and on `resize` only.
- **Not listening to `resize`.** DPR can change when the window moves between monitors with different scales on desktop.

## Interaction with pointer coordinates

If your game uses tap coordinates (not just "any-tap"), scale them in the pointer handler:

```js
canvas.addEventListener('pointerdown', (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) * (W / rect.width);
  const y = (e.clientY - rect.top)  * (H / rect.height);
  // x, y are now in logical W×H space regardless of DPR or CSS zoom
});
```

Note: we scale by `W / rect.width` (logical/display), NOT by `dpr`. The backing store is `W*dpr`, but we want to end up in logical coords — the `dpr` cancels out.

<!-- added: 2026-04-17 (001-void-pulse sprint 3) -->
