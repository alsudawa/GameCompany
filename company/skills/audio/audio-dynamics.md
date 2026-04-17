# Skill — Audio Dynamics (Bus States Without a Mixer)

**When to use:** any game with a Web Audio master gain node, where you want the mix to *respond* to game state without writing a real audio engine. Three named bus states, smooth ramps between them, ~30 lines of code.

The trap that motivates this: you ship SFX, the game sounds fine, and then the player tabs back from a phone call to the gameover screen and the lingering miss-tail is louder than the UI music-card. Or: a player breaks their best by 200 points and the audio sounds *exactly the same as a normal run*. Both moments deserve dynamics.

## Pattern — three-state master bus

```js
const MASTER_GAIN = 0.55;
const BUS_LEVELS = {
  normal: 1.0,    // baseline
  beaten: 1.18,   // +1.4dB lift when player is past their best
  duck:   0.35,   // -9dB attenuation when an overlay is open
};

const Sfx = {
  ctx: null,
  master: null,
  busState: 'normal',
  init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.master.gain.value = state.muted ? 0 : MASTER_GAIN * BUS_LEVELS[this.busState];
    this.master.connect(this.ctx.destination);
  },
  setBus(name) {
    if (!BUS_LEVELS[name] || this.busState === name) return;
    this.busState = name;
    if (!this.master || state.muted) return;
    const t0 = this.ctx.currentTime;
    const target = MASTER_GAIN * BUS_LEVELS[name];
    try {
      this.master.gain.cancelScheduledValues(t0);
      this.master.gain.setValueAtTime(this.master.gain.value, t0);
      this.master.gain.linearRampToValueAtTime(target, t0 + 0.4);
    } catch {
      this.master.gain.value = target;
    }
  },
};
```

## Where to call `setBus`

```js
// score crosses best → lift
if (beaten !== hudScoreBeaten) {
  hudScore.classList.toggle('beaten-best', beaten);
  hudScoreBeaten = beaten;
  Sfx.setBus(beaten ? 'beaten' : 'normal');
}

// pause overlay opens / gameover overlay opens → duck
function pauseGame() { /* … */ Sfx.setBus('duck'); }
function gameover() { /* … */ Sfx.setBus('duck'); }

// resume from pause / start a new run → un-duck
function clearPauseOverlay() {
  /* … */
  if (state.running && !state.over) {
    Sfx.setBus(hudScoreBeaten ? 'beaten' : 'normal');
  }
}
function start() { /* … */ Sfx.setBus('normal'); }
```

## Tuning — why these numbers

| State | Multiplier | dB | Felt as |
|---|---|---|---|
| normal | 1.0 | 0 | baseline |
| beaten | 1.18 | +1.43dB | "rising stakes" — perceptible but not louder, more *forward* |
| duck | 0.35 | -9.12dB | "muted under UI" — still audible for SFX-tail continuity |

Anything beyond +2dB starts feeling shouty. Anything less than -6dB on duck and the player thinks the game crashed. These are the conservative defaults.

## Why ramp, not jump

`linearRampToValueAtTime(target, t0 + 0.4)` over 400ms is the sweet spot:
- <100ms feels like a dropout (zipper-click on some browsers)
- >800ms feels like the player is dragging through molasses on rapid pause→unpause
- 400ms is the same time scale as a CSS opacity transition for an overlay — the audio tracks the visual

## Critical: respect mute

`setBus` short-circuits when `state.muted` is true, so the player toggling mute later still gets `MASTER_GAIN * BUS_LEVELS[busState]` (correct level, just `gain = 0`). When they unmute via `applyMute()`, the bus level reads from `busState` and lands at the right place.

## Common mistakes

- **Setting `master.gain.value` directly during a ramp.** Schedule a `setValueAtTime` first, then the ramp — otherwise the in-flight ramp keeps running underneath.
- **Forgetting `cancelScheduledValues`.** Successive `setBus` calls can stack without it, producing weird ladders.
- **Ducking without an unduck path.** Verify every overlay-open path has a matching overlay-close that calls `setBus('normal')`. Once dropped, audio that doesn't come back is the most user-hostile bug.
- **Lifting beyond +2dB.** Players with headphones get hurt; players on phone speakers get distortion.
- **Triggering `beaten` lift on the start screen.** If `state.score > state.best` is computed before a run begins (when both are 0), avoid a false lift. Guard with `state.best > 0 && state.score > state.best`.

<!-- added: 2026-04-17 (001-void-pulse sprint 11) -->
