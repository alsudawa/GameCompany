# Skill — Accessibility Defaults

**When to use:** every game. Accessibility is not a special-request feature — it's the baseline, and getting it into the default loop means it doesn't get dropped when schedules tighten.

The patterns below cost minutes to add, and each one opens up the game to a real population of players who otherwise silently can't play it.

## Pattern — Redundant color coding

Never encode game-critical information in color alone. Roughly 8% of men and 0.5% of women have some form of color vision deficiency. For a global casual game that's millions of players per title.

Casual-game offenders:
- "danger" pulse = red vs "normal" = white → protan/deutan see them as the same ring
- "good" zone green + "bad" zone red in a trajectory game → indistinguishable
- "your color" in a color-matching game → devastating if that's the whole loop

**Rule:** if you use color for semantic meaning, pair it with at least one of: shape, pattern, line style, size, position.

```js
// BAD — only color distinguishes the threat:
ctx.strokeStyle = p.heartbeat ? '#ff3d6b' : '#fff';
ctx.lineWidth = 3;
ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();

// GOOD — color + thickness + dash pattern, all redundant:
const isHb = p.heartbeat;
ctx.strokeStyle = isHb ? '#ff3d6b' : '#fff';
ctx.lineWidth   = 3 + (isHb ? 1.5 : 0);
if (isHb) ctx.setLineDash([14, 8]);
ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
if (isHb) ctx.setLineDash([]);     // reset for subsequent strokes
```

Protanopia sim test: remove the color channel, see if you can still tell the two apart. If yes, you're good.

## Pattern — Keyboard parity for all interactive affordances

Every pointer-triggered action needs a keyboard equivalent. See `gameplay/input-handling.md` for the full Space/Enter pattern + BUTTON whitelist.

## Pattern — `prefers-reduced-motion` gating

Shake, flash, scale pulses, rapid color flickers — all triggers for vestibular-sensitive players. Gate them on the media query, not just in CSS but also in JS for things like haptic feedback and particle counts.

```css
@media (prefers-reduced-motion: reduce) {
  .shake, .pop, .flash, .pulse-anim { animation: none !important; }
}
```

```js
const reducedMotion = window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;
if (!reducedMotion) spawnBurst(...);        // skip particle bursts entirely
if (!reducedMotion && navigator.vibrate) navigator.vibrate(20);
```

**Don't make the reduced-motion version unplayable.** Goal is less movement, not "no feedback." Color flashes on score still work. Scale-on-tap is fine if you trim the magnitude.

## Pattern — Semantic HTML for screen readers

Use `<button>` for tappable controls, not `<div onclick>`. Provide `aria-label` for icon-only buttons. Use `aria-live="polite"` on the HUD so score updates are announced. Mark decorative SVGs with `aria-hidden="true"`.

```html
<!-- Icon button — screen readers announce the label -->
<button id="mute" class="icon-btn" type="button"
        aria-label="Toggle sound" aria-pressed="false">
  <svg viewBox="0 0 24 24" aria-hidden="true">...</svg>
</button>

<!-- HUD — announces score changes automatically -->
<div id="hud" aria-live="polite">
  <div id="score">0</div>
</div>
```

## Pattern — Focus visibility

Never `outline: none` without a replacement. Keyboard users need a visible focus ring. The browser default is fine for most casual games; only override if it clashes with theme, and then replace with `:focus-visible { box-shadow: 0 0 0 3px var(--accent); }`.

## Common mistakes

- **Color-coded threat with no backup signal** → colorblind players have a hostile game
- **Shake / flash not gated** → motion-sensitive players get nauseated
- **Icon-only mute button with no aria-label** → screen reader reads "button"
- **`tabindex="-1"` on everything** → keyboard users can't navigate
- **Treating accessibility as a sprint-3 polish pass** → ships late or not at all; bake it into the `index.html` template so new games inherit it

<!-- added: 2026-04-17 (001-void-pulse sprint 6) -->
