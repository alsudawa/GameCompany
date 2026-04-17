# Skill — Beat-Synced Synthesized BGM

<!-- added: 2026-04-17 (001-void-pulse, sprint 30) -->

**When to use:** your game has a deterministic beat grid (rhythm chart, turn-based tick, procedural spawn rhythm) and you want background music *locked* to that grid rather than an approximate-tempo audio file. Pairs perfectly with a fixed-BPM chart system — the music reinforces the player's perception of the grid instead of fighting it.

This doc is the full bgm-module pattern. It builds on:
- `audio/web-audio-sfx.md` — voice synthesis (oscillator + envelope)
- `audio/web-audio-scheduling.md` — pre-scheduled note dispatch
- `audio/audio-dynamics.md` — routing through the three-state master bus

## Contract

- **One anchor timestamp.** Capture `runAnchorCtxT = ctx.currentTime + LEAD_IN_S` on run start. All note times are derived: `whenT = runAnchorCtxT + slotIdx * EIGHTH_S`.
- **Pre-schedule via setInterval + lookahead window.** Not setTimeout-per-note. A 60ms tick scheduling 250ms ahead keeps the audio thread fed without allocating one timer per note (would be hundreds per minute).
- **Route through a dedicated submix.** `BGM.gain → Sfx.master`. So the three-state bus, the mute suspend, the pause duck all propagate to BGM *for free* — no duplicated logic.
- **Pause/resume must re-align the anchor.** If the game can pause, ctx.currentTime may freeze (on mute-suspend) while state-t keeps advancing — or vice versa. Track pauseStart in `performance.now()` (always advances) and shift the anchor by the elapsed delta on resume.
- **Band-conditional pattern table.** Music thickens as the chart escalates — each band is a 5-voice × 8-slot bitmap, looked up by `bands[bar]`.
- **Cap simultaneous oscillators.** Each voice = 1–2 oscillators. 5 voices × ~4 peak-activation = ~4 concurrent. Don't add a 6th; Web Audio degrades past ~10 on low-end mobile.

## Pattern — module shape (drop-in, single object)

```js
const BGM_PATTERN = {
  warm:   { kick:[1,0,0,0,0,0,0,0], snare:[0,0,0,0,0,0,0,0], hat:[1,0,1,0,1,0,1,0], bass:[0,0,0,0,0,0,0,0], motif:[0,0,0,0,0,0,0,0] },
  easy:   { kick:[1,0,0,0,1,0,0,0], snare:[0,0,0,0,0,0,0,0], hat:[1,0,1,0,1,0,1,0], bass:[0,0,0,0,0,0,0,0], motif:[0,0,0,0,0,0,0,0] },
  mid:    { kick:[1,0,0,0,1,0,0,0], snare:[0,0,0,0,1,0,0,1], hat:[1,1,1,1,1,1,1,1], bass:[1,0,0,0,1,0,0,0], motif:[0,0,0,0,0,0,0,0] },
  hard:   { kick:[1,0,0,1,1,0,0,0], snare:[0,0,0,0,1,0,0,1], hat:[1,1,1,1,1,1,1,1], bass:[1,0,1,0,1,0,1,0], motif:[0,0,0,1,0,0,0,0] },
  climax: { kick:[1,0,1,0,1,0,1,0], snare:[0,0,1,0,1,0,1,0], hat:[1,1,1,1,1,1,1,1], bass:[1,1,1,1,1,1,1,1], motif:[1,0,0,1,0,1,0,0] },
  out:    { kick:[1,0,0,0,1,0,0,0], snare:[0,0,0,0,0,0,0,0], hat:[1,0,0,0,1,0,0,0], bass:[0,0,0,0,0,0,0,0], motif:[0,0,0,0,0,0,0,0] },
};
const BGM_LOOKAHEAD_S = 0.25;    // schedule 250ms out
const BGM_TICK_MS = 60;          // scheduler tick
const BGM_EIGHTH_S = 0.25;       // 120 BPM 8th-note
const BGM_MASTER_GAIN = 0.26;

const BGM = {
  timer: null, anchor: 0, scheduledThrough: -1,
  running: false, paused: false, pauseStartT: 0,
  gain: null, ctx: null, bands: null,

  start(sfx, bands, runAnchorCtxT) {
    if (!sfx || !sfx.ctx) return;          // no AudioContext yet (pre-gesture)
    if (this.running) this.stop();
    this.ctx = sfx.ctx;
    this.gain = this.ctx.createGain();
    this.gain.gain.value = state.muted ? 0 : BGM_MASTER_GAIN;
    this.gain.connect(sfx.master);
    this.anchor = runAnchorCtxT;
    this.bands = bands;
    this.scheduledThrough = -1;
    this.running = true;
    this.paused = false;
    this._scheduleAhead();
    this.timer = setInterval(() => this._scheduleAhead(), BGM_TICK_MS);
  },

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.running = false;
    this.paused = false;
    if (this.gain && this.ctx) {
      try {
        this.gain.gain.cancelScheduledValues(this.ctx.currentTime);
        this.gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.05);
      } catch { this.gain.gain.value = 0; }
      const g = this.gain;
      setTimeout(() => { try { g.disconnect(); } catch {} }, 90);
    }
    this.gain = null;
  },

  pause() {
    if (!this.running || this.paused || !this.ctx) return;
    this.paused = true;
    this.pauseStartT = performance.now();     // WALL CLOCK — ctx may freeze
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  },

  resume() {
    if (!this.running || !this.paused || !this.ctx) return;
    const dtS = (performance.now() - this.pauseStartT) / 1000;
    this.anchor += dtS;                        // re-align with state.t
    this.paused = false;
    this._scheduleAhead();
    this.timer = setInterval(() => this._scheduleAhead(), BGM_TICK_MS);
  },

  setMuted(m) {
    if (!this.ctx) return;
    // If running mid-chart, a mute suspends ctx — which would drift music
    // relative to state.t unless we also pause the scheduler.
    if (this.running && !state.paused) {
      if (m && !this.paused) this.pause();
      else if (!m && this.paused) this.resume();
    }
    if (!this.gain) return;
    const target = m ? 0 : BGM_MASTER_GAIN;
    try {
      this.gain.gain.cancelScheduledValues(this.ctx.currentTime);
      this.gain.gain.linearRampToValueAtTime(target, this.ctx.currentTime + 0.05);
    } catch { this.gain.gain.value = target; }
  },

  _scheduleAhead() {
    if (!this.running || this.paused) return;
    if (!this.ctx || this.ctx.state !== 'running') return;
    const nowT = this.ctx.currentTime;
    const horizon = nowT + BGM_LOOKAHEAD_S;
    const maxSlot = this.bands.length * 8 - 1;
    while (this.scheduledThrough < maxSlot) {
      const nextIdx = this.scheduledThrough + 1;
      const whenT = this.anchor + nextIdx * BGM_EIGHTH_S;
      if (whenT > horizon) break;
      // stale guard — skip any slot that's already in the past
      if (whenT >= nowT - 0.02) this._playSlot(nextIdx, whenT);
      this.scheduledThrough = nextIdx;
    }
    if (this.scheduledThrough >= maxSlot) this.stop();
  },

  _playSlot(idx, whenT) {
    const bar = Math.floor(idx / 8);
    const slot = idx % 8;
    const pat = BGM_PATTERN[this.bands[bar]];
    if (!pat) return;
    if (pat.kick[slot])  this._kick(whenT);
    if (pat.snare[slot]) this._snare(whenT);
    if (pat.hat[slot])   this._hat(whenT);
    if (pat.bass[slot])  this._bass(whenT, /* semis from walk table */ 0);
    if (pat.motif[slot]) this._motif(whenT, /* cycled from arp */ 0);
  },

  // Voices — copy from web-audio-sfx.md, add `t` parameter and schedule at `t`
  _kick(t) { /* sine 120→40Hz 0.18s gain 0.22 */ },
  _snare(t) { /* highpass noise 1800Hz + 320Hz square blip, 0.12s */ },
  _hat(t) { /* highpass noise 7000Hz 0.04s */ },
  _bass(t, semis) { /* triangle at 55*2^(semis/12) Hz 0.24s */ },
  _motif(t, semis) { /* sine at 220*2^(semis/12) Hz 0.22s */ },
};
```

## Integration — 5 call sites in the host game

```js
// 1. Run start — after chart is built
const runAnchorCtxT = Sfx.ctx.currentTime + CHART_LEAD_IN_S;
BGM.start(Sfx, BAND_SCHEDULE, runAnchorCtxT);

// 2. Game over / chart done
BGM.stop();

// 3. Pause overlay
pauseGame() { ...; BGM.pause(); }

// 4. Resume (countdown complete branch)
if (remainMs <= 0) { state.paused = false; clearPauseOverlay(); BGM.resume(); }

// 5. Mute toggle
onMuteToggle() { Sfx.applyMute(); BGM.setMuted(state.muted); }
```

## Scheduling pitfalls

| Pitfall | Symptom | Fix |
|---|---|---|
| Use `setTimeout(() => osc.start(), delay)` | Notes drift 5–20ms under tab throttling | Schedule with `.start(t)` where `t = ctx.currentTime + delay` |
| Anchor to `Date.now()` | Music tempo changes with clock skew | Anchor to `ctx.currentTime` (sample-accurate) |
| Track pause in `ctx.currentTime` | On mute-suspend, ctx freezes — resume dt is 0 — anchor doesn't shift → desync | Track pause in `performance.now()` |
| Reschedule already-queued notes | Silent corruption on some browsers | Cancel (stop(), disconnect) and re-queue |
| Create oscillator per note without `.stop(t+dur)` | Accumulating zombies → CPU climb | Always call `osc.stop(t + duration + 0.02)` right after `.start(t)` |

## Harmonic content guidance

Keep it in a minor key — it sits under SFX (which tend to be bright/neutral) without fighting. Common picks:
- **A natural minor** — arpeggio `[0, 3, 7, 10]` semitones (A, C, E, G), bass root A1 (55Hz) or A2 (110Hz).
- **D Dorian** — slightly more hopeful — `[0, 3, 7]` plus `[0, -2, -5, 0]` bass walk for tension.

Use a **walking bass** on the second-hardest band (not the peak). It signals "things are getting serious" without maxing the texture before the climax arrives.

## Cost

Peak 4 concurrent oscillators (kick + snare + bass + motif on a climax downbeat). Across a 60s run with the reference pattern table: ~1100 oscillator allocations (all short-lived, GC-friendly). On Chrome desktop: inaudible CPU. On iOS Safari low-end: keep below ~0.5% CPU per check.

## When NOT to use

- **Game without a fixed grid** — free-tempo actions (shooters, platformers). Use ambient loops instead.
- **Music needs to be a recorded track** — licensing, full band, vocals. This pattern is for synth-only generative music.
- **Extremely short sessions (< 10s)** — overhead of scheduler setup not worth it; one-shot SFX is enough.
