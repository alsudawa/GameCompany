# Skill — Inline SVG Sprites

**When to use:** whenever the game needs distinct visual entities (player, enemies, pickups) without image files.

## Base pattern — one `<symbol>` per sprite

In `index.html`:

```html
<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <defs>
    <symbol id="spr-player" viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="40" fill="currentColor"/>
      <circle cx="36" cy="40" r="6"  fill="#fff"/>
      <circle cx="64" cy="40" r="6"  fill="#fff"/>
    </symbol>
  </defs>
</svg>
```

Then use anywhere (HUD, overlays):

```html
<svg class="icon" style="color: var(--accent)"><use href="#spr-player"/></svg>
```

## Drawing SVG into Canvas

For in-game sprites (performant, scalable):

```js
function svgToImage(svgText) {
  const blob = new Blob([svgText], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => URL.revokeObjectURL(url);
  img.src = url;
  return img;
}

const playerImg = svgToImage(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
    <circle cx="50" cy="50" r="40" fill="#ffc857"/>
  </svg>
`);

// in render:
ctx.drawImage(playerImg, x - 50, y - 50, 100, 100);
```

## Palette as CSS vars

```css
:root {
  --bg:     #0f1226;
  --fg:     #f4f5ff;
  --accent: #ffc857;
  --danger: #ff5d73;
}
```

Reference inside SVG via `fill="currentColor"` and control color from CSS — lets designers rethemed without touching SVG.

## Common mistakes

- Huge SVGs with hundreds of paths → same GPU cost as bitmap. Keep each sprite < 30 lines.
- Using `<image href>` inside SVG → defeats the "no external files" rule.
- Forgetting `viewBox` → sprite scales weirdly.
- Not calling `URL.revokeObjectURL` → memory leak on hot-reload.
