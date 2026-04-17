# Skill — Input Handling (unified pointer)

**When to use:** whenever the game needs click/tap/drag input. Our games are single-input, so this is always.

## Why pointer events

One handler works for mouse + touch + pen. Avoids the `touchstart`/`mousedown` branching hell.

## Snippet — basic tap

```js
canvas.addEventListener('pointerdown', (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) * (canvas.width  / rect.width);
  const y = (e.clientY - rect.top)  * (canvas.height / rect.height);
  onTap(x, y);
});
```

Note the scaling: the canvas has intrinsic `width`/`height` (e.g. 720×960) but CSS-scaled size differs. Always convert.

## Snippet — drag

```js
let dragging = false, dragX = 0, dragY = 0;
canvas.addEventListener('pointerdown', (e) => { dragging = true;  update(e); });
canvas.addEventListener('pointermove', (e) => { if (dragging) update(e); });
canvas.addEventListener('pointerup',   ()  => { dragging = false; });
canvas.addEventListener('pointercancel',() => { dragging = false; });

function update(e) {
  const r = canvas.getBoundingClientRect();
  dragX = (e.clientX - r.left) * (canvas.width  / r.width);
  dragY = (e.clientY - r.top)  * (canvas.height / r.height);
}
```

## CSS requirement

```css
#stage { touch-action: none; }   /* prevents mobile scroll-hijack */
```

Also set `user-select: none` on body so long-press doesn't trigger text selection.

## Common mistakes

- Skipping the rect-scale math → input feels offset on resize
- Forgetting `touch-action: none` → mobile scroll steals the game's drag
- Attaching to `window` instead of `canvas` → clicks on HUD text trigger game input
- Starting audio without a user-gesture handler → browser blocks it
