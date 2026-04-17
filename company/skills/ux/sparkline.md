# Skill — Inline SVG Sparkline (Reusable Across Surfaces)

<!-- added: 2026-04-17 (001-void-pulse, sprint 37) -->

**When to use:** you've got a sequence of recent values (last-N run scores, daily playtime per day, accuracy trend) and want to show the shape of the trend in-line with other stats. Pure SVG, 20-line renderer, no dependencies, runs on any screen.

Especially good for:
- Gameover screen: "how was this run vs your recent ones"
- Stats panel: "am I trending up or down"
- HUD badges: tiny inline progress-over-time cues

Pairs with:
- `ux/progress-feedback.md` — the broader "in-play tier meter + sparkline" parent pattern
- `ux/lifetime-stats.md` — the typical stats surface where sparklines live
- `graphics/svg-sprites.md` — inline SVG principles

## Contract

- **One shared renderer, multiple target SVGs.** Don't write a sparkline function that hardcodes `document.getElementById('historySvg')` — pass the SVG element + dimensions as args. Future you will want a second sparkline somewhere.
- **Normalize to max-in-window, not all-time max.** If the player's best ever is 5000 but their last 8 runs were all 200-400, bar heights normalized to 5000 would look like empty rectangles. Normalize to `Math.max(1, ...scores)` of the current window.
- **Right-align bars.** `now` sits on the right; older runs push left. Matches how people read time-series (Western LTR convention).
- **Role-color the latest bar.** Accent-colored "latest" bar is the eye-anchor ("how did THIS run go?"). Best-of-window gets a secondary accent. All others stay muted.
- **Best-tie rule: prefer the latest.** If the latest run ties the window max, color it `.latest` only (not `.latest.best`). Otherwise you'd double-class and the styling fight isn't worth the complexity.
- **Reuse via shared class, not duplicated CSS.** `#historySvg` and `#statsSparkSvg` both use a `.spark-svg` class; the stylesheet targets `.spark-svg .hbar` once. Future sparklines just add the class.
- **SVG namespace matters.** Use `document.createElementNS('http://www.w3.org/2000/svg', 'rect')` — `createElement('rect')` creates an HTML rect, which SVG ignores.

## Pattern — shared renderer

```js
const SPARK_NS = 'http://www.w3.org/2000/svg';

// Pure DOM writer: clears svgEl, draws baseline + bars sized by viewport.
// `W`, `H` are viewBox units; `SLOTS` is the max number of historical
// entries that fit (right-aligned so shorter arrays leave empty slots
// on the left).
function fillSparkline(svgEl, scores, W, H, SLOTS) {
  while (svgEl.firstChild) svgEl.removeChild(svgEl.firstChild);
  if (!scores || scores.length === 0) return;
  const maxScore = Math.max(1, ...scores);
  const bestIdx  = scores.lastIndexOf(maxScore); // rightmost tie
  const latest   = scores.length - 1;
  const slotW = W / SLOTS;
  const barW  = Math.max(6, slotW - 4);

  // Baseline keeps the bars visually anchored even when values are tiny.
  const base = document.createElementNS(SPARK_NS, 'line');
  base.setAttribute('class', 'hline');
  base.setAttribute('x1', '0'); base.setAttribute('x2', String(W));
  base.setAttribute('y1', String(H - 0.5)); base.setAttribute('y2', String(H - 0.5));
  svgEl.appendChild(base);

  // Right-align: shorter arrays leave empty slots on the left.
  const offset = SLOTS - scores.length;
  for (let i = 0; i < scores.length; i++) {
    const v = scores[i];
    const h = Math.max(2, Math.round((v / maxScore) * (H - 4)));
    const x = (offset + i) * slotW + (slotW - barW) / 2;
    const y = H - h;
    const rect = document.createElementNS(SPARK_NS, 'rect');
    rect.setAttribute('class',
      'hbar' + (i === latest ? ' latest' : '') + (i === bestIdx && i !== latest ? ' best' : ''));
    rect.setAttribute('x', String(x));
    rect.setAttribute('y', String(y));
    rect.setAttribute('width',  String(barW));
    rect.setAttribute('height', String(h));
    rect.setAttribute('rx', '1');
    svgEl.appendChild(rect);
  }
}
```

## Pattern — two callers, shared CSS

```html
<!-- gameover surface — compact -->
<svg id="historySvg" class="spark-svg" viewBox="0 0 120 28" width="120" height="28" aria-hidden="true"></svg>

<!-- stats panel surface — roomier -->
<svg id="statsSparkSvg" class="spark-svg" viewBox="0 0 160 32" width="160" height="32" aria-hidden="true"></svg>
```

```css
.spark-svg .hbar        { fill: var(--subtle); transition: fill .12s ease; }
.spark-svg .hbar.latest { fill: var(--accent); }
.spark-svg .hbar.best   { fill: var(--highlight); }
.spark-svg .hline       { stroke: rgba(232,233,255,.18); stroke-width: 1; }
```

```js
// Gameover: compact, wrapper function also handles container hide when empty
function renderHistory(scores) {
  if (!scores || scores.length === 0) { historyEl.style.display = 'none'; return; }
  historyEl.style.display = '';
  fillSparkline(historySvg, scores, 120, 28, RUN_HISTORY_CAP);
}

// Stats panel: larger, empty-state handled by parent `.stats-empty` CSS gate
function renderStatsSparkline(scores) {
  fillSparkline(statsSparkSvg, scores, 160, 32, RUN_HISTORY_CAP);
}
```

## Sizing heuristics

| Context | Dimensions | Reason |
|---|---|---|
| HUD badge | 60×14 | Sits next to a number; minimum legible bar width ~3px |
| Gameover | 120×28 | Secondary info; bar-per-run still individually readable |
| Stats panel | 160×32 | Primary trend view; room to see weekly variance |
| Full-screen chart | 400×120 | A real trend viz — probably needs axes/labels at that scale |

Don't go above ~200px wide unless you're adding axes and labels. The appeal of a sparkline is "bar shape at a glance" — past a certain width that becomes "miniature chart that wants to be a real chart."

## Role-color rules

- **`.latest`** — the newest entry, eye-anchor for "my current run." Always the rightmost bar.
- **`.best`** — the highest value in the window, gives context for "how close is this run to my recent ceiling."
- **`.latest.best`** collision — when the latest run ties/beats the window max. Styling rule: prefer `.latest` only. Reason: the player already sees "that's my newest" and the win is implicit in the bar being tall; double-coloring competes visually.

Implemented via `lastIndexOf(max)` for best-index + a runtime check `i === bestIdx && i !== latest` when assigning `.best`.

## Tuning

- **Bar width vs slot width.** `barW = max(6, slotW - 4)` leaves 4px gap between bars. Less than 2px gap looks like a single dense shape; more than 6px starts feeling sparse.
- **Height floor.** `h = max(2, round((v / maxScore) * (H - 4)))` — even a score of 1 gets a 2px bar, so empty bars are distinct from missing-data empty slots.
- **`H - 4` headroom.** Top 4px of the viewBox is empty space so the tallest bar has visual breathing room.
- **`rx: 1`** — tiny radius on the bar top-corners. Kills the hard-edge-rectangle look without going so round that bars start feeling like pills.

## Anti-patterns

- **`innerHTML = ''` to clear the SVG.** Works but loses any event listeners on children and triggers parse overhead. Use the `while (firstChild) removeChild(firstChild)` loop.
- **Hardcoded colors in the JS.** Put color on CSS classes. Theme-swap (sprint 27 style) means colors should come from CSS vars, not string literals in the renderer.
- **Allocating new SVG elements per frame.** The sparkline redraws only on data change (gameover, stats-open) — not every frame. If you need per-frame updates, pool the rect nodes or use `transform` mutations.
- **No baseline.** A sparkline with only bars and no baseline reads as "floating rectangles" — the 1px baseline anchors them as a series.
- **Fixed absolute pixel sizes in the SVG.** Use `viewBox` for scalable rendering across display densities; width/height attributes can match viewBox or scale up for HiDPI.

## Accessibility

- **`aria-hidden="true"`** on the SVG element. The sparkline is visual reinforcement; the numeric values (best, avg, etc.) in the stats grid carry the semantic content.
- **Parent row uses semantic text** ("Recent trend") so screen-reader users know a chart is present, even if they can't parse the bars.
- **For data-viz-first contexts** (a dashboard, not a game stats panel), add `role="img" aria-label="Score trend over last 8 runs, ranging from X to Y, ending at Z"` with a text description.

## Cost

- 1 renderer function (~20 lines)
- 4 CSS rules (shared `.spark-svg` class)
- 0 dependencies
- Redraw cost: O(n) for n ≤ 8–16 entries; <0.1ms per paint
- Bundle impact: nothing — it's vanilla DOM

## Verifying it works

1. Empty window (0 runs): parent container hidden OR row absent; no residual bars.
2. Single run: one bar at full height on the right, empty slots on the left.
3. Latest run ties window max: bar is accent-colored (`.latest`), NOT gold (`.best`).
4. Latest run below window max: latest is accent, older-best bar is gold.
5. Theme swap: bar colors pick up the new accent/highlight values via CSS vars.
6. Resize (viewBox-based): bars scale with the container without redraw.
