# SVG Asset Files (canvas drawImage)

**Where used:** `games/002-glyph-siege/assets/*.svg` + `src/assets.js` + `src/render.js`

When inline canvas primitives can't deliver the fidelity a player sees up close (faces, gradients, layered highlights, crowns, fangs), move sprites to standalone **SVG files** and load them via `Image()` + `ctx.drawImage()`. SVG is the one allowed asset format because it is text, hand-authorable, crisp at any zoom, and cached by the browser. No PNG/JPG/WebP — those can't be hand-authored.

## When to graduate from inline to files

Use files when the sprite has **3+ internal shapes** (body + eyes + highlight + shadow). Use inline canvas for:
- HUD icons inside DOM overlays
- Particles (too small to benefit, too many instances)
- Backgrounds that animate procedurally (starfield)
- Debug draws

## File layout

```
games/<id>-<slug>/assets/
├── player.svg           # 64×64 viewBox, ~20 lines
├── enemy-grunt.svg      # 64×64
├── enemy-scout.svg      # 64×64
├── enemy-heavy.svg      # 64×64
├── enemy-elite.svg      # 64×64
├── boss.svg             # 128×128 (bigger detail budget)
├── gem-t1.svg           # 32×32
├── gem-t2.svg           # 32×32
├── gem-t3.svg           # 32×32
└── projectile.svg       # 24×24
```

## Author pattern (per file)

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <defs>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#e6fbff" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="#7cf6ff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="body" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#e8faff"/>
      <stop offset="100%" stop-color="#4bb8cf"/>
    </linearGradient>
  </defs>
  <circle cx="32" cy="32" r="30" fill="url(#glow)"/>       <!-- outer aura -->
  <polygon points="..." fill="url(#body)" stroke="#15324a" stroke-width="2"/>
  <circle cx="28" cy="32" r="2.6" fill="#0a0b1e"/>          <!-- eye -->
  <circle cx="27.2" cy="31.1" r="0.9" fill="#ffffff"/>      <!-- eye shine -->
  <!-- ...more face details... -->
</svg>
```

**Rules:**
- `<defs>` at top for gradients and filters.
- Unique gradient IDs per file, prefix with the sprite name (e.g. `g1-body`, `boss-glow`) to prevent collisions if you ever inline multiple sprites in one DOM.
- One highlight (white-ish at 50–60% opacity) to suggest a light source.
- Dark outline = dark tint of the body color, `stroke-width` scaled to viewBox.
- Shadow ellipse at bottom for 2.5D grounding.

## Loader module (`src/assets.js`)

```js
const FILES = {
  player:     'assets/player.svg',
  enemyGrunt: 'assets/enemy-grunt.svg',
  // ... etc
};
export const sprites = {};
export async function loadAssets() {
  await Promise.all(Object.entries(FILES).map(([k, src]) => new Promise((res) => {
    const img = new Image();
    img.onload = () => { sprites[k] = img; res(); };
    img.onerror = () => { sprites[k] = null; res(); };
    img.src = src;
  })));
}
```

**Boot flow** (`src/main.js`):
```js
doms.start.disabled = true;
doms.start.textContent = 'Loading…';
loadAssets().then(() => {
  doms.start.disabled = false;
  doms.start.textContent = 'Tap to start';
});
```

Pre-load before enabling Start so the first frame never has missing sprites. `Promise.all` keeps it simple; 10 SVGs finish in <100ms on any network.

## Draw call

```js
function drawSprite(ctx, img, x, y, d, flashing, rotate) {
  if (!img || !img.complete) return false;
  ctx.save();
  ctx.translate(x, y);
  if (rotate) ctx.rotate(rotate);
  ctx.drawImage(img, -d / 2, -d / 2, d, d);
  if (flashing) {
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    ctx.fillRect(-d / 2, -d / 2, d, d);
  }
  ctx.restore();
  return true;
}
```

The `flashing` overlay uses `source-atop` so the white only stays inside the sprite's filled pixels — silhouette is preserved, details vanish. Cheap and reads as "just got hit."

## Sizing rule

Pass **diameter** = `radius * SCALE` where SCALE ≈ 2.2–2.5 for entities (sprite outline sits a little outside the hitbox so it breathes). Examples:

```js
const ENEMY_SCALE = 2.4, BOSS_SCALE = 2.25, GEM_SCALE = 3.5, PROJ_SCALE = 3.2;
```

## Performance

- `ctx.drawImage` with an `<img>` source is GPU-accelerated on modern browsers; ~200 sprite draws per frame at 720×960 is well under budget.
- Browsers cache decoded SVG per `<img>` element, so one `Image()` per file is enough — don't create per-frame.
- No re-decoding on window resize — the same `<img>` scales to any `drawImage` size.

## Fallback

The `drawSprite` helper returns `false` if the image isn't ready yet. Callers should fall through to a cheap canvas-primitive shape so a network hiccup or CDN lag doesn't produce a blank frame:

```js
if (!drawSprite(ctx, enemySprite(e.type), e.x, e.y, d, flashing)) {
  ctx.fillStyle = def.color;
  ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2); ctx.fill();
}
```

## Gotchas

- **`file://` blocks SVG loads** due to CORS. Local dev must use `python3 -m http.server`. Production on GitHub Pages is fine.
- **Uppercase in paths.** Linux Pages servers are case-sensitive; keep all filenames lowercase (`enemy-grunt.svg`, not `Enemy-Grunt.svg`).
- **Don't embed animated SVG** (`<animate>`). Use CSS keyframes on DOM elements or `state.t`-driven canvas transforms instead — animated SVG inside `drawImage` won't advance frame-by-frame.
- **Filter primitives** (`<feGaussianBlur>`, etc.) render once when the sprite loads but can be expensive on first decode. Prefer adding glow via `ctx.shadowBlur` at draw time.

## Relationship to `svg-sprites.md`

The sibling `skills/graphics/svg-sprites.md` covers **inline** SVG patterns (for DOM HUD icons and small unchanging shapes). This doc covers **file** SVG patterns (for game entities drawn on canvas). They compose: use inline for UI chrome, files for characters.
