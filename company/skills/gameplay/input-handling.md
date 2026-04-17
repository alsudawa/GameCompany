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

<!-- added: 2026-04-17 (001-void-pulse sprint 3) -->

## Pattern — Keyboard parity

Desktop players (and accessibility users) expect Space/Enter to mirror tap. Share the same action function between pointer and keyboard paths — no behavioral drift.

```js
function handleInputAction() {
  if (state.over) { maybeRetry(); return; }
  if (!state.running) return;
  if (performance.now() - state.lastTapMs < TAP_DEBOUNCE_MS) return;
  state.lastTapMs = performance.now();
  judgeTap();
}

canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); handleInputAction(); });

document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' && e.code !== 'Enter') return;
  // Let the browser activate focused buttons naturally (Start, Mute, etc.)
  const t = e.target;
  if (t && (t.tagName === 'BUTTON' || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
  e.preventDefault();
  if (!state.running && !state.over) { start(); return; }
  handleInputAction();
});
```

Why the BUTTON whitelist: without it, Space-while-mute-focused both toggles mute AND fires a game tap. The browser's default Space-activates-focused-button is the right behavior; don't override it globally.

## Pattern — Early-tap forgiveness (anticipation grace)

In timing games, players anticipate. If they tap 200ms before the pulse arrives, a strict judge calls it a miss — which feels like the game stole the tap. Forgive early taps that fall within a bounded anticipation window; let late taps (past the target) still miss so spam isn't a strategy.

```js
const EARLY_TAP_LEAD_MS = 300;

// Inside judgeTap, after computing dMs and failing both windows:
const toArriveMs = (TARGET - entity.pos) / entity.speed * 1000;
if (toArriveMs > 0 && toArriveMs <= EARLY_TAP_LEAD_MS) {
  return; // silently swallowed
}
// else: it's a genuine late/wild tap — miss.
entity.active = false;
loseLife();
```

Keep the debounce (`TAP_DEBOUNCE_MS`) in place — it prevents the player from tapping through rapid successive attempts within a ~120ms window, which would otherwise convert anticipation grace into spam immunity.
