# Skill — Web Audio SFX

**When to use:** every GameCompany game. We never ship audio files.

## `Sfx` module template

```js
const Sfx = {
  ctx: null,
  master: null,

  init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.6;
    this.master.connect(this.ctx.destination);
  },

  _env(type, freq, dur, vol, slideTo = null) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  },

  click()      { this._env('square',   660,   0.05, 0.15); },
  score(combo = 0) {
    const f = 660 * Math.pow(1.06, Math.min(combo, 12));
    this._env('triangle', f, 0.09, 0.2);
  },
  hit()        { this._env('sawtooth', 220,   0.12, 0.25, 100); },
  gameover()   {
    this._env('sawtooth', 330, 0.4, 0.28, 80);
  },
  levelup() {
    // arpeggio
    [523, 659, 784, 1047].forEach((f, i) => {
      setTimeout(() => this._env('triangle', f, 0.1, 0.2), i * 70);
    });
  },
};
```

## Autoplay policy — always init on gesture

```js
document.getElementById('start').addEventListener('click', () => {
  Sfx.init();   // must be inside a click/touch handler, not on page load
  startGame();
});
```

## Oscillator cheatsheet

| Waveform   | Feels like              | Use for           |
|------------|-------------------------|-------------------|
| `sine`     | pure, smooth            | ambient pings     |
| `triangle` | soft, flute-ish         | scores, pickups   |
| `square`   | chiptune, punchy        | clicks, UI        |
| `sawtooth` | buzzy, aggressive       | hits, gameover    |

## Envelope intuition

- Attack (built in via `setValueAtTime`) should be 0–5ms for percussive
- Decay via `exponentialRampToValueAtTime(0.001, t + dur)` — never ramp to 0 (crashes)
- 80–250ms is the sweet spot. Longer SFX need a musical reason.

## Common mistakes

- Creating `AudioContext` on page load → browser blocks, silent game
- Forgetting `osc.stop()` → leaking oscillators, eventual glitches
- Using the same `Sfx` node across sessions → always create fresh nodes per trigger
- No master gain → can't mute or balance easily

<!-- added: 2026-04-17 (001-void-pulse) -->

## Pattern — Upswept "heartbeat" thump

Low sine + short upward slide gives a bass kick that **stacks harmoniously** with a simultaneous melodic SFX. Great for reinforcing a "special hit" without stealing the lead.

```js
heartbeat() { this._env('sine', 110, 0.12, 0.22, 165); }
// A1 → E2 over 120ms, sine wave, volume 0.22
```

Trigger it **alongside** `Sfx.score()` on bonus pulses (not instead of):
```js
Sfx.score(combo);
if (pulse.isBonus) Sfx.heartbeat();  // stacks fine, different octave
```

## Pattern — Staggered dual-layer gameover

A single descending sweep can feel thin. Stagger **two** layered sweeps by ~120ms for weight:

```js
gameover() {
  this._env('sawtooth', 330, 0.5, 0.30, 60);
  setTimeout(() => this._env('sawtooth', 220, 0.6, 0.25, 40), 120);
}
```
First layer punches, second layer anchors the finality. Master gain ~0.55 keeps both clean.

## Pattern — Combo-driven pitch ladder

For score SFX that pitch-shift with combo, use exponential scaling capped at a ceiling:

```js
score(combo = 0) {
  const f = 660 * Math.pow(1.06, Math.min(combo, 12));
  this._env('triangle', f, 0.09, 0.18);
}
```
1.06× per combo ≈ one semitone. Capping at combo=12 prevents inaudible frequencies past ~3 octaves.
