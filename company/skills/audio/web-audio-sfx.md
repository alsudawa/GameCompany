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

<!-- added: 2026-04-17 (001-void-pulse sprint 2) -->

## Pattern — Spawn-tick audio anchor for timing games

In tap-timing games, players need **auditory beat** to lock onto rhythm — pure-visual timing fatigues. Add a short, quiet high-register blip every time a judgeable entity spawns. It's additive (doesn't compete with score / hit SFX) and it's the cheapest way to make a timing game feel fair.

```js
spawnTick(variant) {
  this._env('sine', variant ? 740 : 520, 0.035, 0.055);
}
```

- **Duration 30–40ms.** Longer bleeds into the score SFX and muddies the mix.
- **Volume 0.04–0.06.** Softer than every other SFX — it's a cue, not an event.
- **Sine only.** Square / saw at this volume sounds like UI errors.
- **Pitch variants for spawn subtypes.** Different frequency (not different waveform) lets the player distinguish bonus / heartbeat pulses by ear with zero added cognitive load.

Call it inside the spawn function so it fires exactly in sync with the entity's first frame of existence:

```js
function spawnPulse(isHeartbeat) {
  // ...allocate from pool, set state...
  Sfx.spawnTick(isHeartbeat);
}
```

## Pattern — Tier-parameterized SFX via musical ratios

<!-- added: 2026-04-17 (001-void-pulse sprint 43) -->

**When to use:** you've already got an SFX that fires on a discrete event (combo milestone, power-up tier, level-up), and the event has **runtime-state tiers** (combo multiplier ×1 / ×2 / ×3; power-up bronze/silver/gold; difficulty easy/hard/peak). Players should *hear* the tier, not just see it — especially when eyes are off the HUD (busy targeting).

The cheap approach is to branch inside the SFX: "if tier high, play a different cue." The better approach: accept a `tier` param and **pitch-shift by a musical ratio**. One function, one arpeggio pattern, N tonal anchors that feel like modulations upward rather than random detune.

```js
levelup(tier = 1) {
  // Musical intervals: 9/8 (whole step), 5/4 (major third)
  // Low (default): C-E-G-C
  // Mid (tier ≥ 2):  D-F#-A-D (up a whole step)
  // Peak (tier ≥ 3): E-G#-B-E (up a major third)
  const shift = tier >= 3 ? 1.25 : (tier >= 2 ? 1.125 : 1.0);
  [523, 659, 784, 1047].forEach((f, i) => {
    setTimeout(() => this._env('triangle', f * shift, 0.09, 0.17), i * 65);
  });
},
```

### Why musical ratios, not arbitrary multipliers

- **1.125 (9/8)** — whole step up. D feels like "a step higher than C," not "detuned C." Perceptually clean.
- **1.25 (5/4)** — major third up. Resolves to a chord-like relationship with the base pattern.
- **1.5 (3/2), 2.0 (2/1)** — fifth and octave; use for bigger "rank up" jumps (e.g. difficulty tiers, not per-combo).
- Avoid 1.1, 1.2, 1.3 style "round decimal" shifts — they land on dissonant microtonal intervals. Cheap, grating, telegraphs "programmer audio."

### Default the tier so non-tier callers stay anchored

```js
Sfx.levelup();     // gameover victory: defaults to tier=1, base pitch
Sfx.levelup(m);    // combo milestone: pitches up as m hits ×2, ×3
Sfx.levelup();     // +1-life unlock: base pitch, not affected by combo state
```

The gameover/unlock celebrations should feel **tonally anchored** — they're bookending events. If they pitched up based on whatever combo tier the player happened to end at, the finale would feel random. Param default = 1 keeps the non-tier callers safe.

### When to use this pattern vs an additive overlay

Two ways to tier-reinforce an SFX:

1. **Pitch-shift the existing cue (this pattern).** Good when the tiers are a *continuous progression* (×1 → ×2 → ×3) and you want the same "shape" of SFX, just higher. The listener hears one melody, modulating upward.
2. **Layer an additive overlay gated on high tier.** Good when peak is a *qualitative* shift, not just "more of the same" — e.g. add a theme-colored overtone, a bass hit, a reverb tail. Fires *alongside* the base cue, not instead of.

These stack: void-pulse pitches up the arpeggio (this pattern) AND adds a theme-sweetener overtone at `mult >= 3` (additive overlay). The pitch shift carries the per-tier info; the overlay celebrates crossing the peak threshold. Two channels of signal, one event.

### Anti-patterns

- **Branching to entirely different patterns per tier** — now you maintain N SFX functions; changes to the base don't propagate.
- **Random detune per call** — "sounds different each time!" reads as "unstable audio engine" to players. Tiers should be deterministic.
- **Pitching an already-high cue further up** — a bright score blip pushed up a third can pass 2kHz and sound shrill. Test the peak-tier pitch on laptop speakers before shipping.
- **Skipping the default param** — callers that don't care about tier shouldn't have to pass `1` explicitly. Let the signature encode the anchor.
