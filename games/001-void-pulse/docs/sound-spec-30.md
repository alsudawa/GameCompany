# void-pulse BGM Specification (Sprint 30)

## Intent

A dark-neon minor-key synth groove anchors the 60-second run. The beat begins warm and grounded (soft kick + hat pulse over 2 bars), escalates through easy and mid phases (snare enters, hats thicken, bass walks in), crests in a relentless climax (eighth-note kick, full polyphony, arpeggio fills), then decays back to warmth over the out phase. The BGM thickens proportionally to difficulty band, signaling to the player that the ring's demands are rising. Zero audio files — Web Audio oscillators and noise only.

## Grid & Scheduling

- **30 bars × 8 eighth-note slots per bar** = 240 playable slots.
- **120 BPM anchor**: EIGHTH_S = 0.25 seconds. Total duration = 60s (plus 1s lead-in).
- **Anchor rule**: At `startRun()`, capture `runAnchor = audioCtx.currentTime + CHART_LEAD_IN_S (1.0s)`. Each grid index `i` (0–239) plays at `runAnchor + i * 0.25`.
- **Pre-scheduler**: `setInterval(scheduleAhead, 60ms)` looks ahead 250ms from `currentTime` and queues all due notes into the audio graph via `.start(whenT)` calls. Each oscillator self-cleans with `.stop(whenT + duration)`.
- **Stale event guard**: Skip scheduling if `whenT < currentTime - 0.02` (already passed).

## Band Pattern Grids

Six difficulty bands escalate the drum and bass texture. Each band shows a 5-layer ASCII grid (kick K, snare S, hat h, bass B, motif M), 8 slots wide (1 bar). Patterns anchor on downbeats, sprinkle rests on weak subdivisions, place hazard-adjacent drums (snare/kick) to tempt early taps.

### warm (bars 1–2): Establish pulse
```
Kick     K . . . . . . .  |  K . . . . . . .
Snare    . . . . . . . .  |  . . . . . . . .
Hat      h . h . h . h .  |  h . h . h . h .
Bass     . . . . . . . .  |  . . . . . . . .
Motif    . . . . . . . .  |  . . . . . . . .
```
Soft, spacious. Kick lands on 1, hat on all eighth-note upbeats. No snare, no bass.

### easy (bars 3–7): Add density without confusion
```
Kick     K . . . K . . .  |  K . . . K . . .
Snare    . . . . . . . .  |  . . . . . . . .
Hat      h . h . h . h .  |  h . h . h . h .
Bass     . . . . . . . .  |  . . . . . . . .
Motif    . . . . . . . .  |  . . . . . . . .
```
Kick rhythm tightens (now on 1 and 5 per bar); hat unchanged. Still clean.

### mid (bars 8–14): Snare and bass enter
```
Kick     K . . . K . . .  |  K . . . K . . .
Snare    . . . . S . . S  |  . . . . S . . S
Hat      h h h h h h h h  |  h h h h h h h h
Bass     B . . . B . . .  |  B . . . B . . .
Motif    . . . . . . . .  |  . . . . . . . .
```
Hats thicken to eighth-note solid. Snare on offbeat 5 and 7. Bass on root (1 and 5).

### hard (bars 15–21): Syncopation + bass walk
```
Kick     K . . K K . . .  |  K . . K K . . .
Snare    . . . . S . . S  |  . . . . S . . S
Hat      h h h h h h h h  |  h h h h h h h h
Bass     B . B . B . B .  |  B . B . B . B .
Motif    . . . M . . . .  |  . . . M . . . .
```
Kick syncopated (1, 4, 5 per bar). Bass quickens (all eighth-notes on odds). Motif arrives on slot 4 (weak downbeat), foreshadows climax.

### climax (bars 22–25): Maximum density
```
Kick     K . K . K . K .  |  K . K . K . K .
Snare    . . S . S . S .  |  . . S . S . S .
Hat      h h h h h h h h  |  h h h h h h h h
Bass     B B B B B B B B  |  B B B B B B B B
Motif    M . . M . M . .  |  M . . M . M . .
```
Kick and snare interlock (no unison, pure polyrhythm). Bass solid eighth-notes. Motif every 2–3 slots, driven. Peak tension and release.

### out (bars 26–30): Wind-down
```
Kick     K . . . K . . .  |  K . . . K . . .
Snare    . . . . . . . .  |  . . . . . . . .
Hat      h . . . h . . .  |  h . . . h . . .
Bass     . . . . . . . .  |  . . . . . . . .
Motif    . . . . . . . .  |  . . . . . . . .
```
Snare and bass silent. Hat thins to downbeat + beat 3. Kick and hat only. Soft landing.

## Voice Recipes

Each voice is a self-contained oscillator + gain chain. Envelopes use `setValueAtTime` → `exponentialRampToValueAtTime` for smooth attack/decay. All routes through `this.gain` (BGM's own submix) which connects to `Sfx.master`.

### Kick: 120→40 Hz sine sweep, 0.18s
```js
_kick(t) {
  const ctx = this.ctx;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(120, t);
  o.frequency.exponentialRampToValueAtTime(40, t + 0.16);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.22, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
  o.connect(g).connect(this.gain);
  o.start(t);
  o.stop(t + 0.2);
}
```
Punchy click attack (5ms), deep body (frequency sweep creates that "boom" feel), quick body decay by 180ms. Peak gain 0.22 — present but not loud.

### Snare: Noise burst + square blip, 0.12s
```js
_snare(t) {
  const ctx = this.ctx;
  // Noise component (highpass ~1800Hz)
  const buf = BGM._noiseBuf(ctx);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 1800;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.18, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
  src.connect(hp).connect(g).connect(this.gain);
  src.start(t);
  src.stop(t + 0.14);
  // Body blip (square 320Hz)
  const o = ctx.createOscillator();
  const og = ctx.createGain();
  o.type = 'square';
  o.frequency.setValueAtTime(320, t);
  og.gain.setValueAtTime(0.0001, t);
  og.gain.exponentialRampToValueAtTime(0.06, t + 0.005);
  og.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
  o.connect(og).connect(this.gain);
  o.start(t);
  o.stop(t + 0.1);
}
```
Two-layer snare: noise breath (crisp texture, bandpass-limited to avoid muddiness) and square blip (pitch anchor, adds punch). Both decay by 0.12s. Total perceived duration ~140ms (noise sustains longest).

### Hat: Noise burst, highpass ~7000 Hz, 0.04s
```js
_hat(t) {
  const ctx = this.ctx;
  const buf = BGM._noiseBuf(ctx);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 7000;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.09, t + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
  src.connect(hp).connect(g).connect(this.gain);
  src.start(t);
  src.stop(t + 0.05);
}
```
Bright, short. Highpass at 7kHz cuts all mids/bass, leaving a crisp metallic sizzle. Attack 3ms, decay 40ms — feels like a real hi-hat. Gain 0.09 — quieter than kick/snare so they remain perceptually dominant.

### Bass: Triangle wave, semitone-driven, 0.25s
```js
_bass(t, semis) {
  const ctx = this.ctx;
  const freq = 55 * Math.pow(2, semis / 12);  // A1 = 55 Hz root
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'triangle';
  o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.14, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
  o.connect(g).connect(this.gain);
  o.start(t);
  o.stop(t + 0.26);
}
```
Triangle wave (warmer than sine, less aggressive than square). Root A1 (55 Hz). Called with `semis` offset (0 = root A1, 3 = C2, 7 = E2, etc.). Attack 10ms, body ~240ms. Gain 0.14 — sits underneath kick/snare but adds harmonic weight.

### Motif: Sine arpeggio note, semitone-driven, 0.22s
```js
_motif(t, semis) {
  const ctx = this.ctx;
  const freq = 220 * Math.pow(2, semis / 12);  // A3 = 220 Hz root
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.10, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
  o.connect(g).connect(this.gain);
  o.start(t);
  o.stop(t + 0.24);
}
```
Sine (clear, melodic). Root A3 (220 Hz), one octave above bass root. Attack 10ms, decay 220ms. Gain 0.10 — texture, not statement. Runs the arpeggio `[0, 3, 7, 10]` (A, C, E, G — minor 7 chord) cycling with slot index.

## Harmonic Language

**Key**: A natural minor (no chromatic flats, pure intervals).
**Root frequencies**:
- Bass: A1 = 55 Hz
- Motif: A3 = 220 Hz

**Arpeggio**: `[0, 3, 7, 10]` semitones from A.
- 0 → A
- 3 → C (minor third)
- 7 → E (perfect fifth)
- 10 → G (minor seventh)

This 4-note cell cycles through the motif slots, creating a hypnotic, minor-inflected harmonic wash.

**Bass movement**:
- Default (warm, easy, mid, climax, out): Anchor root A1 (0 semitones), play on marked beat slots.
- Hard phase (bars 15–21): Bass *walks* in a 4-bar cycle: `[0, -2, -5, 0]` semitones.
  - Bar 15–18: Slot 1 = root (A1), slot 5 = -2 (G1), bar 19–22 slot 1 = -5 (E1), slot 5 = root.
  - Creates a descending, then returning motion. Adds harmonic tension.

## JavaScript Skeleton (paste into game.js)

```js
const BGM_PATTERN = {
  warm:   { kick:[1,0,0,0,0,0,0,0], snare:[0,0,0,0,0,0,0,0], hat:[1,0,1,0,1,0,1,0], bass:[0,0,0,0,0,0,0,0], motif:[0,0,0,0,0,0,0,0] },
  easy:   { kick:[1,0,0,0,1,0,0,0], snare:[0,0,0,0,0,0,0,0], hat:[1,0,1,0,1,0,1,0], bass:[0,0,0,0,0,0,0,0], motif:[0,0,0,0,0,0,0,0] },
  mid:    { kick:[1,0,0,0,1,0,0,0], snare:[0,0,0,0,1,0,0,1], hat:[1,1,1,1,1,1,1,1], bass:[1,0,0,0,1,0,0,0], motif:[0,0,0,0,0,0,0,0] },
  hard:   { kick:[1,0,0,1,1,0,0,0], snare:[0,0,0,0,1,0,0,1], hat:[1,1,1,1,1,1,1,1], bass:[1,0,1,0,1,0,1,0], motif:[0,0,0,1,0,0,0,0] },
  climax: { kick:[1,0,1,0,1,0,1,0], snare:[0,0,1,0,1,0,1,0], hat:[1,1,1,1,1,1,1,1], bass:[1,1,1,1,1,1,1,1], motif:[1,0,0,1,0,1,0,0] },
  out:    { kick:[1,0,0,0,1,0,0,0], snare:[0,0,0,0,0,0,0,0], hat:[1,0,0,0,1,0,0,0], bass:[0,0,0,0,0,0,0,0], motif:[0,0,0,0,0,0,0,0] },
};
const BGM_MOTIF_SEMITONES = [0, 3, 7, 10];
const BGM_BASS_WALK_HARD = [0, -2, -5, 0];

const BGM = {
  timer: null,
  anchor: 0,
  scheduledThrough: -1,
  running: false,
  gain: null,
  ctx: null,
  bands: null,
  LOOKAHEAD_S: 0.25,
  TICK_MS: 60,
  EIGHTH_S: 0.25,

  start(sfx, bands, runAnchor) {
    if (!sfx.ctx) return;
    if (this.running) this.stop();
    this.ctx = sfx.ctx;
    this.gain = this.ctx.createGain();
    this.gain.gain.value = state.muted ? 0 : 0.30;
    this.gain.connect(sfx.master);
    this.anchor = runAnchor;
    this.bands = bands;
    this.scheduledThrough = -1;
    this.running = true;
    this._scheduleAhead();
    this.timer = setInterval(() => this._scheduleAhead(), this.TICK_MS);
  },

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.running = false;
    if (this.gain && this.ctx) {
      try {
        this.gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.05);
      } catch {}
      setTimeout(() => {
        try {
          this.gain.disconnect();
        } catch {}
      }, 80);
    }
  },

  setMuted(m) {
    if (!this.gain || !this.ctx) return;
    const target = m ? 0 : 0.30;
    try {
      this.gain.gain.linearRampToValueAtTime(target, this.ctx.currentTime + 0.05);
    } catch {}
  },

  _scheduleAhead() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const nowT = this.ctx.currentTime;
    const horizon = nowT + this.LOOKAHEAD_S;
    const maxSlot = this.bands.length * 8 - 1;
    while (this.scheduledThrough < maxSlot) {
      const nextIdx = this.scheduledThrough + 1;
      const whenT = this.anchor + nextIdx * this.EIGHTH_S;
      if (whenT > horizon) break;
      if (whenT >= nowT - 0.02) {
        this._playSlot(nextIdx, whenT);
      }
      this.scheduledThrough = nextIdx;
    }
    if (this.scheduledThrough >= maxSlot) this.stop();
  },

  _playSlot(idx, whenT) {
    const bar = Math.floor(idx / 8);
    const slot = idx % 8;
    const band = this.bands[bar];
    const pat = BGM_PATTERN[band];
    if (!pat) return;
    if (pat.kick[slot]) this._kick(whenT);
    if (pat.snare[slot]) this._snare(whenT);
    if (pat.hat[slot]) this._hat(whenT);
    if (pat.bass[slot]) {
      let semis = 0;
      if (band === 'hard') {
        const hardBarIdx = bar - 14;
        semis = BGM_BASS_WALK_HARD[((hardBarIdx % 4) + 4) % 4] || 0;
      }
      this._bass(whenT, semis);
    }
    if (pat.motif[slot]) {
      const motifIdx = slot % BGM_MOTIF_SEMITONES.length;
      this._motif(whenT, BGM_MOTIF_SEMITONES[motifIdx]);
    }
  },

  _kick(t) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.16);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g).connect(this.gain);
    o.start(t);
    o.stop(t + 0.2);
  },

  _snare(t) {
    const ctx = this.ctx;
    const buf = BGM._noiseBuf(ctx);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    src.connect(hp).connect(g).connect(this.gain);
    src.start(t);
    src.stop(t + 0.14);
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(320, t);
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.06, t + 0.005);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    o.connect(og).connect(this.gain);
    o.start(t);
    o.stop(t + 0.1);
  },

  _hat(t) {
    const ctx = this.ctx;
    const buf = BGM._noiseBuf(ctx);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    src.connect(hp).connect(g).connect(this.gain);
    src.start(t);
    src.stop(t + 0.05);
  },

  _bass(t, semis) {
    const ctx = this.ctx;
    const freq = 55 * Math.pow(2, semis / 12);
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.14, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
    o.connect(g).connect(this.gain);
    o.start(t);
    o.stop(t + 0.26);
  },

  _motif(t, semis) {
    const ctx = this.ctx;
    const freq = 220 * Math.pow(2, semis / 12);
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.10, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g).connect(this.gain);
    o.start(t);
    o.stop(t + 0.24);
  },

  _noiseBuf(ctx) {
    if (BGM._noise) return BGM._noise;
    const sr = ctx.sampleRate;
    const buf = ctx.createBuffer(1, sr * 0.25, sr);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    BGM._noise = buf;
    return buf;
  },
};
```

## Integration Notes for Lead Dev

### Insertion Points in `game.js`

1. **Paste the `BGM_PATTERN`, `BGM_MOTIF_SEMITONES`, `BGM_BASS_WALK_HARD` constants** above the `Sfx` object (around line 830).

2. **Paste the entire `BGM` object** after `Sfx` (around line 950).

3. **In `startRun()`** (around line 500 in the current game.js, after chart generation):
   ```js
   state.chart = generateChart().events;
   state.runStartCtxT = Sfx.ctx.currentTime + CHART_LEAD_IN_S;
   // <-- ADD THIS LINE:
   BGM.start(Sfx, BAND_SCHEDULE, state.runStartCtxT);
   ```
   Ensure `BAND_SCHEDULE` is the array of 30 band strings (e.g., `['warm','warm','easy',...,'out']`). This array is pre-computed by `generateChart()` or passed alongside the chart events.

4. **In `gameover()`** (around line 650):
   ```js
   BGM.stop();  // silence the BGM loop
   Sfx.gameover();
   // ... rest of gameover logic
   ```

5. **In the mute toggle handler** (currently in `_toggleMute()` or similar):
   ```js
   state.muted = !state.muted;
   Sfx.setMuted(state.muted);
   BGM.setMuted(state.muted);  // <-- ADD THIS
   Sfx.master.gain.setValueAtTime(...);
   // ... visual update
   ```

6. **On visibility/tab return** (AudioContext suspend is already wired):
   - No change needed. `_scheduleAhead()` has a guard: if `ctx.state !== 'running'`, it returns early, so the timer doesn't queue stale events.

### Expected Call Signature

```js
BGM.start(Sfx, bandScheduleArray, audioContextTimeOffset);
```
- `Sfx`: The Sfx object (for access to `ctx`, `master`, `muted`).
- `bandScheduleArray`: Array of 30 strings — e.g., `['warm', 'warm', 'easy', 'easy', ..., 'out']`. Order must match the chart bars.
- `audioContextTimeOffset`: `Sfx.ctx.currentTime + CHART_LEAD_IN_S` — the moment the first grid slot plays.

### Tuning Handles

All parameters are in the voice methods (`_kick`, `_snare`, etc.). Designer can tweak:
- **Frequency sweeps** (kick: 120→40 Hz; snare body: 320 Hz; hat highpass: 7000 Hz).
- **Gain values** (kick: 0.22; snare: 0.18; hat: 0.09; bass: 0.14; motif: 0.10).
- **Envelope timings** (attack/decay points in `setValueAtTime` and `exponentialRamp`).
- **Oscillator types** (sine, triangle, square, noise).
- **Master BGM gain** (`this.gain.gain.value = 0.30` in `start()`).

### Common Issues & Fixes

1. **BGM plays but is inaudible**: Check master gain (should be 0.30 by default) and ensure `Sfx.master` is not muted or zero.
2. **Audio pops/clicks at notes**: Already mitigated by exponential ramps with attack/decay. If still present, increase attack time (e.g., 10ms → 15ms).
3. **BGM doesn't stop cleanly**: `BGM.stop()` is idempotent; safe to call multiple times.
4. **Scheduler skips notes after tab return**: `_scheduleAhead()` automatically catches up because lookahead reads the current time; as long as `_scheduleAhead()` is called within ~60ms of resumed playback, the queue will rebuild.
5. **Memory leak (oscillators not cleaning up)**: Each oscillator calls `.stop()` explicitly; no manual cleanup needed.

---

**Spec completed 2026-04-17. Ready to paste into game.js.**
