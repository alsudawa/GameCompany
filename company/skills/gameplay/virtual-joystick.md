# Virtual Joystick (floating)

**Where used:** `games/002-glyph-siege/src/input.js`

A touch-first direction control that establishes its origin at the first pointer-down location and reads a unit direction vector + magnitude (0..1) from pointer-move. Plays cleanly with keyboard as an alternate input path.

## Why floating (not fixed)

Fixed-position joysticks force thumb travel across the screen; floating joysticks put control exactly where the user tapped. On a 720×960 portrait canvas, the player is often near the center, so a fixed joystick in the corner creates a long, imprecise reach.

## Shape

```js
state.input = {
  active: false,        // touch held
  originX, originY,     // established on pointerdown (canvas coords)
  curX, curY,           // latest pointermove position
  dx, dy,               // unit direction (0..1 × ±1)
  mag,                  // 0..1 magnitude (clamped by JOY_RADIUS)
};
```

## Core recipe

```js
const JOY_RADIUS = 60;

function canvasCoord(e, canvas) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (W / rect.width),
    y: (e.clientY - rect.top)  * (H / rect.height),
  };
}

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  const p = canvasCoord(e, canvas);
  state.input.active = true;
  state.input.originX = p.x;
  state.input.originY = p.y;
  state.input.curX = p.x; state.input.curY = p.y;
  recompute();
  e.preventDefault();
});

canvas.addEventListener('pointermove', (e) => {
  if (!state.input.active) return;
  const p = canvasCoord(e, canvas);
  state.input.curX = p.x; state.input.curY = p.y;
  recompute();
});

canvas.addEventListener('pointerup', onUp);
canvas.addEventListener('pointercancel', onUp);
canvas.addEventListener('lostpointercapture', onUp);

function onUp() { state.input.active = false; state.input.dx = 0; state.input.dy = 0; state.input.mag = 0; }

function recompute() {
  const dx = state.input.curX - state.input.originX;
  const dy = state.input.curY - state.input.originY;
  const d = Math.hypot(dx, dy);
  if (d < 6) { state.input.dx = 0; state.input.dy = 0; state.input.mag = 0; return; }
  const clamped = Math.min(d, JOY_RADIUS);
  state.input.dx = dx / d;
  state.input.dy = dy / d;
  state.input.mag = clamped / JOY_RADIUS;
}
```

## Keyboard parity

Treat WASD + arrows as an 8-way unit vector with magnitude 1. Touch takes precedence — if `state.input.active`, ignore keyboard updates.

```js
const keys = new Set();
const keyMap = { ArrowUp:'U', ArrowDown:'D', ArrowLeft:'L', ArrowRight:'R',
                 KeyW:'U', KeyS:'D', KeyA:'L', KeyD:'R' };

window.addEventListener('keydown', (e) => {
  const k = keyMap[e.code];
  if (k) { keys.add(k); if (!state.input.active) recomputeKeyboard(); e.preventDefault(); }
});
window.addEventListener('keyup', (e) => {
  const k = keyMap[e.code];
  if (k) { keys.delete(k); if (!state.input.active) recomputeKeyboard(); }
});

function recomputeKeyboard() {
  let dx=0, dy=0;
  if (keys.has('L')) dx--; if (keys.has('R')) dx++;
  if (keys.has('U')) dy--; if (keys.has('D')) dy++;
  if (!dx && !dy) { state.input.dx=0; state.input.dy=0; state.input.mag=0; return; }
  const d = Math.hypot(dx, dy);
  state.input.dx = dx / d; state.input.dy = dy / d; state.input.mag = 1;
}
```

## Visual feedback (required, not optional)

Floating joysticks ONLY work if the origin ring is visible the instant the touch lands. Render every frame while `active`:

```js
function drawJoystick(ctx) {
  if (!state.input.active) return;
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = '#7cf6ff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(state.input.originX, state.input.originY, JOY_RADIUS, 0, Math.PI*2);
  ctx.stroke();
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = '#7cf6ff';
  ctx.beginPath();
  ctx.arc(state.input.curX, state.input.curY, 14, 0, Math.PI*2);
  ctx.fill();
  ctx.restore();
}
```

## Dead zone

A 6px dead zone on the origin prevents jitter when the thumb barely moves. Smaller dead zone → twitchy; larger → sluggish. 6px is the sweet spot on 720px-wide portrait.

## Gotchas

- **`touch-action: none`** on the canvas CSS — without it, iOS treats drag as a scroll.
- **Blur the window handler** — clear the keys set when the tab loses focus, otherwise the player "keeps moving" when they tab away.
- **Pause before input** — if the game is paused or over, return early on pointerdown to prevent the joystick showing over overlays.
- **Scale factor** — `canvasCoord` must translate client-space pointer to logical canvas coords using `getBoundingClientRect()`. DPR is separate and lives in the backing store.

## When to use a *fixed* joystick instead

- Landscape games where the thumb is always at the bottom corner (fixed is discoverable).
- Twin-stick games where two joysticks must coexist (can't both float or they fight).
- Games where the active zone needs to be visible as an affordance (new-player tutorial).

For portrait casual, **default to floating.**
