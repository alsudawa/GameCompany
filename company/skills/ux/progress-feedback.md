# Skill — In-Play Progress Feedback

**When to use:** any game with tiers, multipliers, or threshold mechanics where the player's next reward isn't immediate. The player knows the mechanic exists but can't feel how close they are to the next tier — so they under-attend to the mechanic itself.

Classic example: a combo multiplier that jumps every N hits. Without a progress indicator, "combo = 7" is a number, not tension. Add a skinny bar underneath and suddenly each hit is a visible step toward something.

## Pattern — Tier progress meter

```html
<div id="comboWrap">
  <div id="combo">×2 12</div>
  <div id="comboMeter"><div id="comboMeterFill"></div></div>
</div>
```

```css
#comboMeter {
  width: 72px;
  height: 3px;
  background: rgba(232, 233, 255, .12);
  border-radius: 2px;
  overflow: hidden;
  opacity: 0;                         /* hide when idle — no combo to meter */
  transition: opacity .18s ease;
}
#comboMeter.active { opacity: 1; }
#comboMeterFill {
  height: 100%;
  width: 0%;
  background: linear-gradient(90deg, var(--accent), #ffd24a);
  border-radius: 2px;
  transition: width .14s ease-out;
}
```

```js
// In render. Diff-track to avoid DOM thrash.
const capped  = comboMult() >= COMBO_MULT_MAX;
const active  = state.combo > 0;
const pct     = capped ? 100 : Math.round((state.combo % COMBO_STEP) / COMBO_STEP * 100);
if (active !== lastComboActive) {
  comboMeter.classList.toggle('active', active);
  lastComboActive = active;
}
if (pct !== lastComboFillPct) {
  comboMeterFill.style.width = pct + '%';
  lastComboFillPct = pct;
}
```

## Pattern — Run history sparkline

Most casual games show only the current score + best. But players reason about **trend** — am I getting better? A tiny sparkline of the last N runs answers that question in one glance.

```html
<div id="history" class="history" aria-label="Last runs">
  <span class="history-label">Last runs</span>
  <svg id="historySvg" viewBox="0 0 120 28" width="120" height="28" aria-hidden="true"></svg>
</div>
```

```js
const RUN_HISTORY_CAP = 8;
function writeHistory(arr) {
  try { localStorage.setItem('KEY-history', JSON.stringify(arr.slice(-RUN_HISTORY_CAP))); } catch {}
}
function readHistory() {
  try {
    const raw = localStorage.getItem('KEY-history');
    const a = raw ? JSON.parse(raw) : [];
    return Array.isArray(a) ? a.filter(n => typeof n === 'number').slice(-RUN_HISTORY_CAP) : [];
  } catch { return []; }
}

const SPARK_NS = 'http://www.w3.org/2000/svg';
function renderHistory(scores) {
  while (historySvg.firstChild) historySvg.removeChild(historySvg.firstChild);
  if (!scores.length) { historyEl.style.display = 'none'; return; }
  historyEl.style.display = '';
  const max = Math.max(1, ...scores);
  const bestIdx = scores.lastIndexOf(max);
  const latest  = scores.length - 1;
  const [W, H, SLOTS] = [120, 28, RUN_HISTORY_CAP];
  const slotW = W / SLOTS, barW = Math.max(6, slotW - 4);
  const offset = SLOTS - scores.length;  // right-align: latest on the right
  for (let i = 0; i < scores.length; i++) {
    const h = Math.max(2, Math.round((scores[i] / max) * (H - 4)));
    const x = (offset + i) * slotW + (slotW - barW) / 2;
    const rect = document.createElementNS(SPARK_NS, 'rect');
    rect.setAttribute('class',
      'hbar' + (i === latest ? ' latest' : '') +
      (i === bestIdx && i !== latest ? ' best' : ''));
    rect.setAttribute('x', x); rect.setAttribute('y', H - h);
    rect.setAttribute('width', barW); rect.setAttribute('height', h);
    historySvg.appendChild(rect);
  }
}
```

**Color coding** (critical — without this it's just bars):
- Latest run → accent color ("this is what you just did")
- Best run in window → gold ("this is what you're chasing")
- Others → muted subtle color (context, not signal)

**Normalize to max-in-window, not all-time best.** Otherwise after one big run every subsequent sparkline is a row of near-zero nubs. Scaling to the visible window means every run is readable.

## Why right-align the bars

Latest-run always sits in the rightmost slot. Players read left-to-right → early bars = "past runs" → rightmost = "you, now". Left-aligning with blank slots on the right reads as "you haven't played enough yet" which is demoralizing for a 2-run returning player.

## When NOT to show a history sparkline

- < 3 runs in history → the trend story is too noisy; show only score + best
- Single-run games / tutorials → irrelevant
- Games with per-level scores (rather than per-run) → need a different aggregation

## Common mistakes

- **Showing the meter when combo is 0** → permanent UI noise; hide when idle
- **Not diff-tracking the fill %** → setting `style.width` every frame forces style recalc even when unchanged
- **Normalizing sparkline to all-time best** → one record run flattens every subsequent sparkline to nothing
- **Latest-bar colored same as others** → the whole point of the sparkline is "where is now" — make it pop
- **Omitting the `lastIndexOf` tiebreaker** → when latest run ties the best, both lit gold looks buggy; pick one

<!-- added: 2026-04-17 (001-void-pulse sprint 5) -->
