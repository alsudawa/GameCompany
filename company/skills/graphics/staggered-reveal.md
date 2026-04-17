# Skill — Staggered Timeline Reveal (Inline animation-delay for N elements)

**When to use:** a collection of elements whose x-position on screen encodes *time* — a run-timeline strip, a combo-chain ribbon, a score history sparkline's points. Rendering them all at once dumps the whole data set instantly; revealing them left-to-right with per-element delay re-plays the pacing of the underlying data, turning the visualization from a static readout into a *replay*. The player *feels* the arc before reading the numbers.

Pairs with `ux/ghost-run-comparison.md` (the data layer) — this is the presentation layer that makes the comparison feel like a playback, not just a chart.

## Contract

- **Animation is presentational-only.** Removing it doesn't change any data or interaction. Reduced-motion users skip to the end state; nothing is lost.
- **Delay scales with a normalized time parameter**, not with the element's index. Index-based stagger assumes even spacing; for gameplay events they're clustered — a flurry of perfects at t=30 should reveal as a flurry, not as an evenly-paced drip.
- **Animation replays on every re-render.** Gameover appears → strips animate. Retry + gameover again → strips animate again. The `renderGhost` tear-down-and-rebuild pattern makes this free.

## Pattern — inline animation-delay per element

```js
const REVEAL_MS = 900;
for (const event of events) {
  const dot = document.createElementNS(SVG_NS, 'circle');
  // ... position + color ...
  const delay = (event.t / totalDuration) * REVEAL_MS;
  dot.setAttribute('style', 'animation-delay:' + delay.toFixed(0) + 'ms');
  svg.appendChild(dot);
}
```

Why inline `style` vs. a CSS class per delay bucket:
- **Continuous control.** Each dot gets a precise delay based on its timestamp. Bucketing into `.delay-0`, `.delay-100`, etc. would quantize and flatten the pacing.
- **No class-explosion.** 120 events would need 120 CSS classes. Inline style is a single property on a single element, no CSS indirection.
- **Rounded to integers.** `toFixed(0)` keeps the style string short without affecting perception — human eyes can't distinguish 43ms from 43.7ms of delay.
- **`animation-delay` accepts negative values** if you ever want the animation to start mid-cycle — useful for "these dots should reveal as if the animation already began 200ms ago". Not used here, but good to know.

The keyframes and base animation stay in CSS:

```css
.gdot {
  transform-box: fill-box;
  transform-origin: center;
  animation: ghostDotIn 260ms cubic-bezier(.2, .9, .3, 1.2) both;
}
@keyframes ghostDotIn {
  0%   { opacity: 0; transform: scale(.3); }
  60%  { opacity: 1; transform: scale(1.25); }
  100% { opacity: 1; transform: scale(1); }
}
```

Two notes on SVG transforms:
- **`transform-box: fill-box`** is required on SVG elements so `transform-origin: center` refers to the element's own bounding box, not the SVG viewport's 0,0. Without this, the dot "scales" by actually translating across the canvas.
- **Slight overshoot (`scale(1.25)` at 60%)** gives a "pop" that reads as "arriving" rather than "fading in". Costless visually, adds personality. Tune to taste via the cubic-bezier curve.

## Pattern — total reveal window cap

```js
const GHOST_REVEAL_MS = 900;
const delay = (t / duration) * GHOST_REVEAL_MS;  // ranges 0..900
```

Fixed total, scales by normalized time. Why cap:
- **Long runs don't feel sluggish.** A 120-second run compressed to 900ms is a punchy replay; a 120-second run revealing over 120 × real-time is a nap.
- **Short runs don't feel snappy.** A 15-second run also fills 900ms — same pacing as a long run, so the cadence of the reveal is consistent across run lengths. The *density* of dots still communicates "you didn't make it far".
- **900ms is a sweet spot** — longer than a brief flash (~300ms) but shorter than the player's patience window. Fiddle between 600–1200ms; beyond 1200 the player will have started reading before the reveal finishes.

## Pattern — reduced-motion fallback

```css
@media (prefers-reduced-motion: reduce) {
  .gdot, .gtrack { animation: none; }
}
```

Flat override — no animation means elements render in their final state immediately (the `both` fill mode in the base declaration doesn't matter once `animation: none` wins). One property, one place.

**Do not try to provide a "gentler" animation for reduced-motion.** The whole point of the user preference is "no movement". A slower scale is still scale. Kill it outright.

## Pattern — shared axis means shared pacing

When two strips use the same `axisDur` for x-positioning, they also share the reveal cadence:

```js
const axisDur = Math.max(bestDur, currentDur) || 1;
renderGhostOne(nowSvg, currentEvents, axisDur);
renderGhostOne(bestSvg, bestEvents, axisDur);
```

Consequence: if the current run ended at 30s and the best ran 80s, the current run's dots all reveal in the first ~340ms (30/80 × 900). The best run's reveal continues for the full 900ms. The visual *pacing* of the reveal itself tells the story: "this run stopped here, the best kept going". You don't need any labels to feel that.

This only works because the delay uses the *normalized* `t / axisDur` — if it used raw `t`, dots past the shared axis would reveal outside the window or the window would be the max of the two individual durations. Normalize.

## Pattern — track baseline reveals first

```css
.gtrack {
  animation: ghostTrackIn 220ms ease-out both;
}
@keyframes ghostTrackIn {
  from { opacity: 0; }
  to   { opacity: 1; }
}
```

The baseline track (the thin spine under the dots) fades in over ~220ms with no delay. Result: at t=0 the overlay appears, at t=220 the track is fully visible, at t=0..900 the dots pop in along it. The track appearing *first* establishes "this is a timeline" before the data arrives — the mental model is in place by the time the first dot lands.

A simpler choice is no track animation at all; use this only if the track feels jarringly present on overlay open.

## Pattern — re-animate on re-render automatically

The renderer tears down and rebuilds elements each call:

```js
function renderGhostOne(svg, events, duration) {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  // ... build fresh line + dots ...
}
```

CSS animations are bound to the element's lifecycle. Fresh elements = fresh animations, always. No need for `classList.remove → void offsetHeight → classList.add` dance or animation-iteration-count juggling.

The cost: allocating + inserting a few dozen SVG elements per gameover. Negligible — a ghost strip is a once-per-death render, not a per-frame concern.

## Common mistakes

- **Index-based stagger (`animation-delay: ${i * 50}ms`)** — works but assumes even spacing, flattening the pacing signal. A flurry of events and a lull would reveal identically. Use the actual time value.
- **Staggering with JS `setTimeout`** — blocks if the tab is throttled, interferes with `prefers-reduced-motion`, can't take advantage of the compositor's animation optimizations. Use CSS.
- **Forgetting `transform-box: fill-box` on SVG elements** — scale transforms look like translations because the origin is 0,0 in viewport space.
- **Using `display: none → display: block` to trigger reveal** — CSS animations don't play from `display: none`. Use opacity + transform; the element is always rendered.
- **Animating `transform` and `opacity` separately in two rules** — browsers already compositor-optimize both; one combined keyframe is fine and keeps the timing synchronized by construction.
- **Leaving the animation running on an unchanged render** — not a concern if you always rebuild the DOM, which you should anyway for a data-driven strip.
- **Hard-coding delay cap too low (e.g., 300ms)** — the reveal blurs past before the eye can track it; players perceive a flicker, not a timeline. 600–1200ms is the usable range.
- **Forgetting the reduced-motion override** — motion-sensitive players get a janky scale-pop instead of a clean appearance.
- **Adding a slow parent-container fade-in on top of per-dot reveal** — double-fade-in; the dots look muddy. Either the container fades in OR the dots reveal; not both.

<!-- added: 2026-04-17 (001-void-pulse sprint 21) -->
