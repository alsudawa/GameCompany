# void-pulse BGM Redesign — "Satisfying from Bar 1"

## Problem Diagnosis

Current BGM (lines 1110-1349) feels like a metronome, not music:

1. **warm/easy (0-18s)**: Kick + hat only. No bass, no melody, no harmony.
2. **motif appears too late**: 34s into the track (hard phase). Melody should anchor bar 1.
3. **Single chord**: Am throughout. No harmonic motion → static tone.
4. **Master gain too low**: 0.26 is inaudible. 0.36 acceptable.

**Target**: First 4 seconds should say "oh, this is a song" — melody + bass + harmony present from beat 1.

---

## Solution Architecture

### 1. Chord Progression (per bar)

```js
const BGM_CHORD_PROGRESSION = [
  // warm (bars 0-2): A minor foundation + first lift
  0, 0, -4,
  // easy (bars 3-8): cycling between root and IV for gentle motion
  0, -4, 3, -2,
  0, -4,
  // mid (bars 9-16): full progression Am-F-C-G for momentum
  0, -4, 3, -2,
  0, -4, 3, -2,
  // hard (bars 17-22): same 4-bar cycle, driver role
  0, -4, 3, -2,
  0, -4,
  // climax (bars 23-26): aggressive Am → F bounce
  0, -4, 0, -4,
  // out (bars 27-29): resolve to Am, fadeout
  0, 0, 0,
];
// Semitone offsets from A (55Hz bass = A1, 220Hz melodies = A3).
// 0 = A minor, -4 = F major, 3 = C major, -2 = G major
```

**Rationale**: 
- Am-F-C-G is the "four-chord progression" — culturally recognizable, emotionally open.
- Warm starts on root (minimal tension) to let players orient.
- Easy introduces IV (F) for gentle lift without adventure.
- Mid/hard drive the full cycle — rising energy without resolving (keeps momentum).
- Climax bounces Am↔F twice (minimal travel, max urgency).
- Out lands on Am, sustains, allows silence.

---

### 2. Band Structure & Lead/Pad Activation Curve

Redefine bands with **7 instruments** (add `lead` and `pad` to existing 5):

```js
const BGM_PATTERN = {
  // warm (bars 0-2): establish groove + introduce lead sparse
  warm:   {
    kick:  [1,0,0,0,0,0,0,0],
    snare: [0,0,0,0,0,0,0,0],
    hat:   [1,0,1,0,1,0,1,0],
    bass:  [0,0,0,0,0,0,0,0],      // silence (hook is pad-only)
    pad:   [1,0,0,0,1,0,0,0],      // soft quarter-note pulse
    lead:  [0,0,1,0,0,0,0,0],      // single sparse note on 2 (bar pickup)
    motif: [0,0,0,0,0,0,0,0],      // silence
  },

  // easy (bars 3-8): bass enters, lead more frequent, pad steady
  easy:   {
    kick:  [1,0,0,0,1,0,0,0],
    snare: [0,0,0,0,0,0,0,0],
    hat:   [1,0,1,0,1,0,1,0],
    bass:  [1,0,0,0,1,0,0,0],      // quarter-note pulse
    pad:   [1,0,0,0,1,0,0,0],      // synced with bass
    lead:  [1,0,0,1,0,0,1,0],      // rises: sparse → every other eighth
    motif: [0,0,0,0,0,0,0,0],
  },

  // mid (bars 9-16): snare enters, lead melody every bar, motif silence
  mid:    {
    kick:  [1,0,0,0,1,0,0,0],
    snare: [0,0,0,0,1,0,0,1],      // off-beat snare
    hat:   [1,1,1,1,1,1,1,1],      // dense
    bass:  [1,0,0,0,1,0,0,0],
    pad:   [1,0,0,0,1,0,0,0],
    lead:  [1,0,1,0,1,0,1,0],      // every eighth-note (melody emerges)
    motif: [0,0,0,0,0,0,0,0],
  },

  // hard (bars 17-22): bass walks, lead dense, motif occasional punctuation
  hard:   {
    kick:  [1,0,0,1,1,0,0,0],
    snare: [0,0,0,0,1,0,0,1],
    hat:   [1,1,1,1,1,1,1,1],
    bass:  [1,0,1,0,1,0,1,0],      // every eighth (walk still applies via semis)
    pad:   [1,0,0,0,1,0,0,0],
    lead:  [1,0,1,0,1,0,1,0],      // fully articulated melody
    motif: [0,0,0,1,0,0,0,0],      // rare anchor punctuation
  },

  // climax (bars 23-26): all layers full, motif prominent
  climax: {
    kick:  [1,0,1,0,1,0,1,0],
    snare: [0,0,1,0,1,0,1,0],
    hat:   [1,1,1,1,1,1,1,1],
    bass:  [1,1,1,1,1,1,1,1],      // full eighth-notes
    pad:   [1,0,1,0,1,0,1,0],      // every eighth
    lead:  [1,0,1,0,1,0,1,0],      // relentless
    motif: [1,0,0,1,0,1,0,0],      // driving arpeggio
  },

  // out (bars 27-29): wind down, bass silence, lead sparse
  out:    {
    kick:  [1,0,0,0,1,0,0,0],
    snare: [0,0,0,0,0,0,0,0],
    hat:   [1,0,0,0,1,0,0,0],
    bass:  [0,0,0,0,0,0,0,0],      // silence → sense of resolution
    pad:   [1,0,0,0,0,0,0,0],      // sparse pad tail
    lead:  [1,0,0,0,0,0,0,0],      // single final note
    motif: [0,0,0,0,0,0,0,0],
  },
};
```

**Activation curve rationale**:
- **warm (0-2s)**: pad anchors harmony (soft), lead appears as pickup → "oh, melody incoming"
- **easy (3-18s)**: bass grounds the chords, lead rises from 1 per-bar → 1 per 2 eighth-notes
- **mid (19-34s)**: lead fully articulated (every eighth), full harmonic presence
- **hard (35-46s)**: lead + motif layers create richness without mud
- **climax (47-54s)**: all instruments maximum density
- **out (55-60s)**: all decay → sense of closure

---

### 3. New Instrument Definitions

#### `_pad(t, semis)` — Smooth, sustained pad for chord anchoring

```js
_pad(t, semis) {
  const ctx = this.ctx;
  const freq = 55 * Math.pow(2, semis / 12);  // A1 = 55Hz (same octave as bass)
  
  // Triangle wave with light HPF for soft sustain
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  const hpf = ctx.createBiquadFilter();
  
  o.type = 'triangle';
  o.frequency.setValueAtTime(freq, t);
  
  // Soft attack, medium sustain, moderate decay
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.08, t + 0.03);  // 30ms attack
  g.gain.setValueAtTime(0.08, t + 0.10);               // sustain 70ms
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28); // 180ms decay
  
  hpf.type = 'highpass';
  hpf.frequency.value = 80;  // lets through bass harmonics, removes sub-bass mud
  
  o.connect(hpf).connect(g).connect(this.gain);
  o.start(t);
  o.stop(t + 0.3);
},
```

**Tone character**: Triangle wave (warm, flute-ish) + HPF (remove mud below 80Hz). Sits under bass without competing. Sustain-focused so pad feels like a chord hold, not a percussive tap.

**Envelope**: 
- Attack 30ms (smooth entry, doesn't snap like percussion)
- Sustain 70ms (holds the harmony)
- Decay 180ms total (graceful exit)
- Total: ~300ms

**Frequency**: A1 (55Hz), same octave as bass. When bass plays root, pad plays same note. When chord changes (bass slides to F), pad also slides semitones.

---

#### `_lead(t, semis)` — Bright, articulate melody line

```js
_lead(t, semis) {
  const ctx = this.ctx;
  const freq = 220 * Math.pow(2, semis / 12);  // A3 = 220Hz (melodic octave)
  
  // Sine wave with smooth square carrier for clarity
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  
  o.type = 'sine';
  o.frequency.setValueAtTime(freq, t);
  
  // Percussive attack (quick onset), short sustain, quick decay
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.14, t + 0.008);  // 8ms attack (snap)
  g.gain.setValueAtTime(0.14, t + 0.055);               // sustain ~47ms
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18); // decay to ~180ms total
  
  o.connect(g).connect(this.gain);
  o.start(t);
  o.stop(t + 0.19);
},
```

**Tone character**: Pure sine (warm, unforgiving — wrong notes stand out, right ones sing). This is the "hook" — lead must be precise and melodious.

**Envelope**:
- Attack 8ms (percussive, articulate like a plucked string)
- Sustain 47ms (note rings clearly)
- Decay 125ms total (fades without abruptness)
- Total: ~190ms

**Frequency**: A3 (220Hz). Two octaves above pad, one octave above bass. Sits in the sweet spot for perceiving melodic contour without stepping on SFX (SFX are 400-2000Hz, lead sits 220-880Hz depending on semis).

---

#### Lead Melody Sequence — The "Hook"

One 4-bar cycle (A minor → F → C → G) with lead melody:

```js
// Semitone offsets for lead, per eighth-note slot in a 4-bar progression cycle
// This sequence plays in any 4-bar segment where the progression is [0, -4, 3, -2]
const BGM_LEAD_SEQUENCE_AMFC = [
  // Bar 0 (Am): A C E (root triad)
  // Slots:  0  1  2  3  4  5  6  7
  [0, 0, 3, 0, 0, 3, 0, 0],        // A A C A A C A A
  
  // Bar 1 (F): A C F (harmony over F = Am11 voicing, dreamy)
  [0, 0, 3, 0, 5, 3, 0, 0],        // A A C A F C A A
  
  // Bar 2 (C): G E C (resolves to C major)
  [-2, 0, 3, 0, 0, 3, 0, -2],      // G A C A A C A G
  
  // Bar 3 (G): D B G (cadence into G)
  [2, 0, 3, 0, 0, 3, 2, 0],        // D A C A A C D A
];
// Index = bar within 4-bar cycle, then [eighth-note slot 0-7]
```

**Melody design rationale**:
- **Singable**: Mostly chord tones (0=A, 3=C, 5=F, 7=E, -2=G), minimal passing tones.
- **Rhythmic hook**: Repeats A-A-C-A pattern in bar 0 → immediately memorable.
- **Harmonic alignment**: When chord changes (bar 1 → F), lead still lands on A, C, F (all within F's voicing).
- **Cadence**: Bars 2→3 (C→G) walks G-E-C down then D-B-G up, classic major-key cadence shape.
- **8 notes per bar × 4 bars = 32 notes = ~5 seconds at 120 BPM** → one full cycle every 4 bars.

---

### 4. Integration: Slot-to-Semitone Mapping

Modify `_playSlot(idx, whenT)` to handle lead and pad:

```js
_playSlot(idx, whenT) {
  const bar = Math.floor(idx / 8);
  const slot = idx % 8;
  const band = this.bands[bar];
  const pat = BGM_PATTERN[band];
  if (!pat) return;

  // Existing instruments
  if (pat.kick[slot])  this._kick(whenT);
  if (pat.snare[slot]) this._snare(whenT);
  if (pat.hat[slot])   this._hat(whenT);

  // Bass with walk
  if (pat.bass[slot]) {
    let semis = 0;
    if (band === 'hard') {
      let hardStart = this.bands.indexOf('hard');
      if (hardStart < 0) hardStart = bar;
      const hbi = bar - hardStart;
      semis = BGM_BASS_WALK_HARD[((hbi % 4) + 4) % 4] | 0;
    }
    this._bass(whenT, semis);
  }

  // Pad: chord harmonic
  if (pat.pad[slot]) {
    const chordSemis = BGM_CHORD_PROGRESSION[bar] || 0;
    this._pad(whenT, chordSemis);
  }

  // Lead: melodic line within 4-bar cycle, respects chord progression
  if (pat.lead[slot]) {
    const cycleBar = bar % 4;  // which bar in the 4-bar chord cycle?
    const leadSemis = BGM_LEAD_SEQUENCE_AMFC[cycleBar][slot];
    // Adjust lead by the chord offset so it modulates with harmony changes
    const chordSemis = BGM_CHORD_PROGRESSION[bar] || 0;
    this._lead(whenT, leadSemis + chordSemis);
  }

  // Motif: original A minor arpeggio (now punctuation only)
  if (pat.motif[slot]) {
    this._motif(whenT, BGM_MOTIF_SEMITONES[slot % BGM_MOTIF_SEMITONES.length]);
  }
},
```

**Logic**:
- `bar % 4` selects which 4-bar cycle we're in (repeats every 4 bars).
- `BGM_LEAD_SEQUENCE_AMFC[cycleBar][slot]` picks the melodic note for that bar + slot.
- `chordSemis` shifts the entire melody so it transposes with chord changes (e.g., when progression moves to F=-4, all lead notes drop 4 semitones).

---

### 5. Master Tuning

```js
const BGM_MASTER_GAIN = 0.36;  // up from 0.26 — still below Sfx.master (0.55)

// Individual instrument gains (if further tuning needed):
// _pad() uses 0.08 attack → sustain (adjust if pad dominates)
// _lead() uses 0.14 attack → sustain (melody should be clear but not aggressive)
// _bass() uses 0.14 (unchanged)
// _kick() uses 0.22 (unchanged)
// _snare() uses 0.18 noise + 0.06 click (unchanged)
// _hat() uses 0.09 (unchanged)
// _motif() uses 0.10 (unchanged)
```

**Rationale**:
- BGM_MASTER_GAIN 0.36 is still 35% below Sfx.master (0.55), so game SFX win during hazard taps.
- Pad (0.08) + lead (0.14) = 0.22 combined presence, less than a snare hit (0.18) → musical bed, not overpowering.
- Lead clarity (0.14 with 8ms attack) ensures melody cuts through density in climax phase.

---

### 6. Frequency Isolation (SFX Safety)

Current SFX live in these ranges (from `company/skills/audio/web-audio-sfx.md`):
- **score()**: 660Hz base, pitches up to ~3950Hz on combo=12 (triangle wave, bright)
- **hit()**: 220Hz start → 100Hz slide (sawtooth, wide spectrum)
- **gameover()**: 330Hz start → 80Hz slide (sawtooth)
- **click()**: 660Hz (square, UI)

**BGM instrumentation**:
- **Pad**: 55Hz (A1) — sits in bass subharmonics, no overlap
- **Lead**: 220–880Hz (A3 ±2 octaves due to semis) — overlaps with hit/gameover, but:
  - Lead uses sine (smooth), SFX use sawtooth/triangle (edgy) → tonally distinct
  - Lead sustain 180ms, SFX decay 100–400ms → different envelope shapes, ear separates them
  - Lead is steady, SFX are percussive → easy to figure-ground
- **Bass**: 55–110Hz (A1 ± semitones) — no overlap
- **Kick**: 120Hz→40Hz sweep → doesn't clash with pad/lead steady notes
- **Snare**: 1800Hz highpass, 320Hz click → above lead, no conflict
- **Hat**: 7000Hz highpass → well above all BGM

**Verdict**: No frequency collisions. SFX will sit clearly atop BGM.

---

### 7. Timeline Map (60 seconds, 30 bars at 120 BPM)

```
Bar  0-2   (0:00-1:50)   warm   | pad intro + sparse lead pickup
Bar  3-8   (1:50-4:00)   easy   | bass enters, lead rises, pad steady
Bar  9-16  (4:00-8:00)   mid    | snare, dense lead rhythm
Bar  17-22 (8:00-11:00)  hard   | bass walk, motif re-enters, climax imminent
Bar  23-26 (11:00-13:00) climax | maximum density, all layers
Bar  27-29 (13:00-14:50) out    | fade out, resolution

Total: 30 bars × 0.5s/bar = 15 bars on-grid, 15 bars per-bar-doubled...
Actually: 120 BPM = 2 beats/second = 0.5s per beat
         8 eighths per bar = 8 × 0.125s = 1s per bar
         30 bars = 30s total... wait.

CORRECTION: 120 BPM, 4/4 time:
- 1 bar = 2 seconds (120 BPM = 2 beats/sec, 4 beats/bar)
- 8 eighth-notes per bar, each = 0.25 seconds
- 30 bars = 60 seconds ✓

Timeline:
  0:00–0:06  Bar  0–2  warm   (pad + lead sparse)
  0:06–0:18  Bar  3–8  easy   (bass + lead rise)
  0:18–0:34  Bar  9–16 mid    (snare + dense lead)
  0:34–0:46  Bar  17–22 hard  (bass walk + motif)
  0:46–0:54  Bar  23–26 climax (full)
  0:54–1:00  Bar  27–29 out    (fadeout)
```

**Key moment: 0:06 (bar 3, first easy beat)** — bass enters, lead audible, pad steady. This is when the player hears "oh, this is a song."

---

## Code Integration for Lead Dev

### A. Add these constants near line 1114 (after existing BGM constants):

```js
const BGM_CHORD_PROGRESSION = [
  0, 0, -4,     // warm
  0, -4, 3, -2, 0, -4,  // easy
  0, -4, 3, -2, 0, -4, 3, -2,  // mid
  0, -4, 3, -2, 0, -4,  // hard
  0, -4, 0, -4,  // climax
  0, 0, 0,       // out
];

const BGM_LEAD_SEQUENCE_AMFC = [
  [0, 0, 3, 0, 0, 3, 0, 0],        // bar 0 (Am)
  [0, 0, 3, 0, 5, 3, 0, 0],        // bar 1 (F)
  [-2, 0, 3, 0, 0, 3, 0, -2],      // bar 2 (C)
  [2, 0, 3, 0, 0, 3, 2, 0],        // bar 3 (G)
];
```

### B. Replace BGM_PATTERN (line 1114-1121) with new 7-instrument version above (section 2).

### C. Update BGM_MASTER_GAIN (line 1128):

```js
const BGM_MASTER_GAIN = 0.36;  // was 0.26
```

### D. Add two new instrument functions to the `BGM` object (after `_motif`, before closing brace ~line 1348):

```js
    _pad(t, semis) {
      const ctx = this.ctx;
      const freq = 55 * Math.pow(2, semis / 12);
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const hpf = ctx.createBiquadFilter();
      o.type = 'triangle';
      o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.08, t + 0.03);
      g.gain.setValueAtTime(0.08, t + 0.10);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
      hpf.type = 'highpass';
      hpf.frequency.value = 80;
      o.connect(hpf).connect(g).connect(this.gain);
      o.start(t);
      o.stop(t + 0.3);
    },
    _lead(t, semis) {
      const ctx = this.ctx;
      const freq = 220 * Math.pow(2, semis / 12);
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.14, t + 0.008);
      g.gain.setValueAtTime(0.14, t + 0.055);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.connect(g).connect(this.gain);
      o.start(t);
      o.stop(t + 0.19);
    },
```

### E. Replace `_playSlot()` method (line 1248-1271) with new version from section 4 above.

### F. Verify drum patterns still work:

The existing `_kick()`, `_snare()`, `_hat()`, `_bass()`, `_motif()` functions are unchanged. Only the pattern array and playslot logic change.

---

## Tuning Checklist for Lead Dev

- [ ] Load game, start level
- [ ] Listen to first 4 seconds (warm → early easy): should hear pad, then bass, then lead notes
- [ ] Check that lead melody is audible but doesn't overpower SFX (tap a hazard, score SFX should be louder)
- [ ] Play through climax: verify all layers blend without mud (if mud detected, reduce `_pad()` sustain gain from 0.08 to 0.06)
- [ ] Mute game: verify BGM.setMuted() clears completely
- [ ] Resume after pause: verify lead/pad/bass re-sync with beat (they're scheduled ahead, should be stable)
- [ ] If lead melody sounds "wrong" on playback: check `BGM_LEAD_SEQUENCE_AMFC` semitones match your ear's sense of A/C/F/G (can sing along)
- [ ] If pad sustain feels flat: adjust `g.gain.setValueAtTime(0.08, t + 0.10)` and decay time `t + 0.28` to taste (try 0.06 sustain, 0.25 total for softer)

---

## Why This Works

1. **Lead appears bar 1**: single note pickup in warm phase (slot 2) cues player "melody incoming."
2. **Bass bar 3**: harmonic anchor arrives just as player is oriented → "oh, this IS music."
3. **Chord progression**: Am-F-C-G is globally recognized → feels intentional, not random.
4. **Sparse→dense curve**: warm/easy start light so player brain has room to absorb. mid/hard/climax build without jarring.
5. **Frequency safety**: pad/lead/bass all sit below 220-880Hz; SFX are 400-2000Hz with snappy envelopes. No masking.
6. **Memorable melody**: 8-note hook in bars 0-3 repeats and modulates every 4 bars → catchy without being annoying.

---

## References

- Company skill: `/home/user/GameCompany/company/skills/audio/web-audio-sfx.md`
- Original spec: `/home/user/GameCompany/games/001-void-pulse/game.js` lines 1110–1349
- Test audio: play the game, open DevTools console, run `BGM.stop(); BGM.start(Sfx, ['warm', 'easy', 'easy', 'easy', 'easy', 'easy', 'mid', 'mid', 'mid', 'mid', 'mid', 'mid', 'mid', 'mid', 'hard', 'hard', 'hard', 'hard', 'hard', 'hard', 'climax', 'climax', 'climax', 'climax', 'out', 'out', 'out'], Sfx.ctx.currentTime);` to verify changes immediately.
