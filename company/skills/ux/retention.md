# Skill — Retention Polish

**When to use:** after the core loop ships and plays fairly. These are the cheap-per-return additions that turn a one-try curiosity into a "one more run" game.

## Pattern — Run-end stats panel

Show per-run achievements beyond raw score. Each adds a sub-goal the player can chase even if their score target feels out of reach.

```html
<div class="stats">
  <div><span>Peak combo</span><span id="statPeak">0</span></div>
  <div><span>Perfects</span><span id="statPerfect">0</span></div>
  <div><span>Hits</span><span id="statHits">0</span></div>
</div>
```

```js
// Track during play
if (isPerfect)        state.perfectCount += 1;
if (isPerfect || isGood) state.hitCount += 1;
if (state.combo > state.peakCombo) state.peakCombo = state.combo;

// Display in gameover()
statPeakEl.textContent    = state.peakCombo;
statPerfectEl.textContent = state.perfectCount;
statHitsEl.textContent    = state.hitCount;
```

Pick 3–4 stats that are orthogonal: raw score, streak-based, precision-based, volume-based. Avoid showing stats that're a function of score (e.g. "score rank" — that's just score).

## Pattern — NEW BEST badge (gated)

Celebrating beats. But celebrating the first-ever run devalues the badge.

```js
const prevBest = state.best;
if (state.score > state.best) {
  state.best = state.score;
  writeBest(state.best);
  // Only show the pill if the player had a prior best to beat.
  state.newBestThisRun = state.score > 0 && prevBest > 0;
}
```

```css
.new-best {
  font-weight: 800;
  letter-spacing: .24em;
  background: linear-gradient(90deg, #ffd24a, #ff8fb1 50%, #8ad6ff);
  color: #061028;
  padding: 5px 14px;
  border-radius: 999px;
  animation: newBestPulse 1.2s ease-in-out infinite;
}
@keyframes newBestPulse {
  0%, 100% { transform: scale(1); }
  50%      { transform: scale(1.06); }
}
```

Layer `Sfx.levelup()` on top of the gameover chord when the badge shows — the arpeggio reads "win" on top of the "end" sound, which is the exact emotional payload you want.

## Pattern — Mute persistence

Every casual web game needs this. The player mutes once and expects it to stick.

```js
function readMuted()  { try { return localStorage.getItem('KEY-muted') === '1'; } catch { return false; } }
function writeMuted(v){ try { localStorage.setItem('KEY-muted', v ? '1' : '0'); } catch {} }

// On Sfx.init(), honor state.muted immediately:
this.master.gain.value = state.muted ? 0 : MASTER_GAIN;

// Toggle handler:
btnMute.addEventListener('click', () => {
  state.muted = !state.muted;
  writeMuted(state.muted);
  if (Sfx.master) Sfx.master.gain.value = state.muted ? 0 : MASTER_GAIN;
  updateMuteIcon();
});
```

Put the mute icon **outside** the canvas (absolute-positioned in the `#app` container) so it doesn't disappear with the game-over overlay and doesn't interfere with tap judging.

## Common mistakes

- **Celebrating first-ever best.** Trains the player to expect the badge. Gate on `prevBest > 0`.
- **Stats that duplicate score.** "Max multiplier reached" = just `score / hits`. Pick orthogonal axes.
- **Mute button inside canvas pointerdown area.** Without `stopPropagation`, a mute tap also registers as a game tap. Put it outside the play surface in z-order.
- **No localStorage try/catch.** Safari private mode throws on `localStorage.setItem`. Guard every call.

<!-- added: 2026-04-17 (001-void-pulse sprint 3) -->
