# Skill — HUD Beat Indicator

<!-- added: 2026-04-17 (001-void-pulse, sprint 32) -->

**When to use:** your game has a fixed-BPM grid (rhythm chart, turn-based tick, a procedural-but-metered spawn rhythm) and you want a permanent visual anchor that helps players *see* the beat. Especially useful when:
- BGM may be muted (the indicator does the anchoring alone)
- The on-canvas action is busy enough that the beat is hard to parse
- Accessibility: a secondary non-audio cue for the grid

Pairs with:
- `gameplay/rhythm-chart.md` — chart provides the BPM + lead-in
- `audio/synced-bgm.md` — BGM optional layer; this indicator is non-audio
- `graphics/css-animation.md` — CSS keyframe retrigger pattern

## Contract

- **Drive from game-time, not audio-time.** Tie to `state.t` (same clock as the chart) — if you sync to `AudioContext.currentTime` you lose the indicator when audio is muted/suspended.
- **Retrigger animations via class-toggle + reflow.** Don't use `animation-iteration-count: infinite` — a continuously-looping CSS animation won't re-sync if the game pauses. Explicit per-beat trigger keeps alignment with the sim.
- **Accent the downbeat.** Beat 1 of each bar should be visually distinguishable (bigger, brighter, accent color). Otherwise every beat looks identical and the bar structure is invisible.
- **Reduced-motion: keep the static ring.** Don't hide the indicator under reduced-motion — just disable the scale/brightness animation. The steady dim ring still signals "a run is active."
- **Clear on run start + gameover.** Reset `lastBeatIdx = -1` and remove `.active` / `.pulse*` classes. Prevents stale flashes across retries.

## Pattern — HTML

```html
<div id="beat" class="beat" aria-hidden="true">
  <span class="beat-dot"></span>
</div>
```

Use `aria-hidden="true"` — the beat is visual feedback only; screen readers don't need 120 flashes per minute.

## Pattern — CSS

```css
#beat {
  width: 14px;
  height: 14px;
  display: flex; align-items: center; justify-content: center;
  opacity: 0;
  transition: opacity .2s ease;
}
#beat.active { opacity: 1; }
#beat .beat-dot {
  width: 9px; height: 9px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--fg) 28%, transparent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--fg) 22%, transparent);
  transform: scale(1);
}
#beat.pulse .beat-dot        { animation: beatPulse 420ms ease-out; }
#beat.pulse-accent .beat-dot { animation: beatPulseAccent 520ms ease-out; }

@keyframes beatPulse {
  0%   { transform: scale(0.95); background: color-mix(in srgb, var(--fg) 28%, transparent); }
  18%  { transform: scale(1.35); background: var(--fg);
         box-shadow: 0 0 12px color-mix(in srgb, var(--fg) 65%, transparent), 0 0 0 1px var(--fg); }
  100% { transform: scale(1);    background: color-mix(in srgb, var(--fg) 28%, transparent); }
}
@keyframes beatPulseAccent {
  0%   { transform: scale(0.95); background: color-mix(in srgb, var(--accent) 35%, transparent); }
  14%  { transform: scale(1.6);  background: var(--accent);
         box-shadow: 0 0 18px color-mix(in srgb, var(--accent) 75%, transparent), 0 0 0 2px var(--accent); }
  100% { transform: scale(1);    background: color-mix(in srgb, var(--fg) 28%, transparent); }
}

@media (prefers-reduced-motion: reduce) {
  #beat.pulse .beat-dot,
  #beat.pulse-accent .beat-dot { animation: none !important; }
}
```

## Pattern — JS driver

```js
const BEAT_S = 60 / BPM;          // 0.5s at 120 BPM
let lastBeatIdx = -1;

function resetBeatIndicator() {
  lastBeatIdx = -1;
  beatEl.classList.remove('active', 'pulse', 'pulse-accent');
}

function tickBeatIndicator() {
  const offsetS = state.t - CHART_LEAD_IN_S;
  if (offsetS < 0) return;                   // pre-lead-in, no beats yet
  const beatIdx = Math.floor(offsetS / BEAT_S);
  if (beatIdx === lastBeatIdx) return;        // already flashed this beat
  lastBeatIdx = beatIdx;
  if (!beatEl.classList.contains('active')) beatEl.classList.add('active');
  // Retrigger: remove class, force reflow, add class.
  beatEl.classList.remove('pulse', 'pulse-accent');
  void beatEl.offsetWidth;                    // force reflow
  const isDownbeat = (beatIdx % 4) === 0;     // 4 quarters per bar
  beatEl.classList.add(isDownbeat ? 'pulse-accent' : 'pulse');
}

// Call in update(): `tickBeatIndicator();`
// Call in start() + gameover(): `resetBeatIndicator();`
```

## Why the reflow hack

`element.classList.remove('pulse'); element.classList.add('pulse')` in the same tick is a no-op because the browser batches class changes and runs animations on the *final* state. Forcing a reflow between the remove and re-add (`void el.offsetWidth` reads layout, forcing a sync) makes the browser see the transition as remove → add, which restarts the keyframe animation.

Alternative: use two separate classes (`pulse-a` / `pulse-b`) and alternate between them. Works without reflow but doubles the CSS.

## Tuning levers

| Knob | Effect |
|---|---|
| `BEAT_S` | Pulse frequency — at 120 BPM, 0.5s gives quarter-notes. Eighth-notes (0.25s) are too fast for the eye to parse. Half-notes (1.0s) feel sluggish. |
| `isDownbeat` divisor | `% 4` = every 4th quarter (bar downbeat). `% 2` = every half-bar for songs in 2/4. `% 3` for 3/4 waltzes. |
| Accent color | Use `--accent` (bright) vs `--fg` (regular). Accent should be the player's most-eye-catching color so the bar structure is pre-attentive. |
| Pulse duration | Keep shorter than the beat interval (~80% of BEAT_S×1000). At 120 BPM, 420ms pulse + 500ms beat interval = ~80ms of "rest" between pulses — enough to feel discrete, not enough to feel empty. |

## Placement

HUD corner or inside the combo cluster — wherever the player's eye naturally flicks during play. Avoid the center of the screen (competes with the gameplay area) and avoid the edge (out of peripheral vision).

Size: 12–18px outer ring. Smaller than a score number, larger than a punctuation mark. It's an anchor, not a feature.

## Accessibility

- **Color-blind.** The pulse *scale* is the primary cue — color is secondary. Accent beats are larger, not just a different hue. (Don't make downbeats only accent-colored with no size change.)
- **Reduced motion.** Animation disabled but the dim static ring remains visible during runs. Signals "active" without flashing.
- **Low vision.** Shadow/glow on the pulse makes the flash visible even at low contrast.
- **Screen readers.** `aria-hidden="true"` — the indicator has no semantic meaning beyond the visual metronome.

## When NOT to use

- **Endless / procedural-pace games.** No fixed BPM = no anchor point = an indicator that flashes at arbitrary moments is noise.
- **Stealth / tension-focused games.** A visible metronome implies rhythm gameplay; putting one in a thriller breaks atmosphere.
- **Games already saturated with HUD.** Another flashing element in an already-busy HUD adds cognitive load. Budget the HUD before adding.

## Cost

- HTML: 2 elements (`<div>` + `<span>`)
- CSS: ~30 lines
- JS: ~20 lines
- Perf: one class-toggle + one reflow read per beat. At 120 BPM that's 2/s — negligible.
