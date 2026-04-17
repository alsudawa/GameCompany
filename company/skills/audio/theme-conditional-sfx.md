# Skill — Theme-Conditional SFX Accents

**When to use:** a game that already has (a) a theme picker (skill: `ux/theme-picker.md`) and (b) ambient visual drift per theme (skill: `graphics/ambient-drift.md`). The next layer of personalization is sound — when the player swaps themes, they should hear the change, not just see it. Done right, this is additive (never replaces existing SFX) and respects the "void = baseline" contract so the synth character of the original game is preserved for players who picked it.

The goal is not a full per-theme SFX palette (that's a rewrite). The goal is *accents* — short, low-volume layers added on top of the base tones at dramatic moments (miss, gameover). Combined with the visual ambient drift, they push the theme from "palette swap" toward "atmosphere swap".

## Pattern — lazy white-noise buffer

Oscillators cover tones; noise is the missing primitive for crackle/rustle/rain/wind.

```js
_noiseBuf: null,
_getNoise() {
  if (this._noiseBuf) return this._noiseBuf;
  const sr = this.ctx.sampleRate;
  const buf = this.ctx.createBuffer(1, sr, sr);   // 1 sec mono
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  this._noiseBuf = buf;
  return buf;
},
```

Key choices:
- **1 second is plenty** — accents are 90–400 ms, we clip with the envelope. A longer buffer wastes memory and init time.
- **Mono** — stereo noise doubles memory for no perceived width benefit on a mono accent.
- **Filled once per session** — the first miss pays ~2 ms to fill 48k floats; every subsequent call is free.
- **Lazy-init inside the method** — don't fill it at `new AudioContext()` time; if the player never misses, we never allocate.

## Pattern — filter type does the heavy lifting

The same noise buffer becomes very different sounds depending on the filter:

```js
_noise(dur, vol, filterType, filterFreq) {
  if (!this.ctx) return;
  const t0 = this.ctx.currentTime;
  const src = this.ctx.createBufferSource();
  src.buffer = this._getNoise();
  const filter = this.ctx.createBiquadFilter();
  filter.type = filterType;        // 'highpass' | 'lowpass' | 'bandpass'
  filter.frequency.value = filterFreq;
  const g = this.ctx.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(filter).connect(g).connect(this.master);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
},
```

Filter → character mapping:
- **`highpass` @ 2000–3000 Hz** → dry crackle / ember snap / static pop
- **`lowpass` @ 700–1200 Hz** → leaf rustle / wind / muffled breath
- **`bandpass` @ 1500 Hz, Q=8** → sizzle / spray (not used here, noted for future)

Same envelope shape as `_env` (exponential decay) so mixing noise and tones sounds coherent, not like two different engines.

## Pattern — `_themeAccent(kind)` as the single branch point

```js
_themeAccent(kind) {
  if (currentTheme === 'void') return;
  if (currentTheme === 'sunset') {
    if (kind === 'miss')      this._noise(0.09, 0.18, 'highpass', 2400);
    else if (kind === 'over') this._noise(0.22, 0.14, 'highpass', 1800);
  } else if (currentTheme === 'forest') {
    if (kind === 'miss')      this._noise(0.18, 0.10, 'lowpass', 900);
    else if (kind === 'over') this._noise(0.38, 0.08, 'lowpass', 700);
  }
},
```

Why centralize:
- **One function reads `currentTheme`** — matches the "read at call-time" rule from `graphics/ambient-drift.md`. Mid-run theme swaps are instantly honored without resetting anything.
- **Void returns early** — zero cost for the default theme; no phantom silent buffers allocated.
- **Callers stay trivial** — `miss()` just tacks on `this._themeAccent('miss')` after the base tone. No branching bloats the hot-path methods.
- **Adding a new theme = adding a new `else if` block** — not touching every caller.

## Pattern — additive layer, never replacement

```js
miss() {
  this._env('sawtooth', 180, 0.22, 0.26, 70);   // base — always plays
  this._themeAccent('miss');                     // accent — theme-dependent
},
```

Layer discipline:
- **Base tone is the sound** — what makes a "miss" identifiable as a miss.
- **Accent is the atmosphere** — what makes it a *void* miss vs. *forest* miss.
- **If someone mutes accents, the game still works** — base tone carries the game feel; accent is pure sugar.

Never collapse into `if (theme === 'X') playA(); else playB();`. That makes every theme sound like a completely different game — players who picked void would hear their sound change when a bug puts them in forest mode. Additive avoids that whole category.

## Pattern — volume headroom

Accent volumes are capped at 0.10–0.18 vs. the base tone's 0.26. Two reasons:
- **Don't drown the base** — the base carries the gameplay meaning. If the accent is louder, the miss stops feeling like a miss.
- **Leave room for bus lifts** — the 'beaten' bus state adds +18% master gain. If accents are at base-volume, bus-lifted accent gets clippy. 0.10–0.18 leaves the headroom.

## Pattern — timing offset for death beat

```js
gameover() {
  this._env('sawtooth', 330, 0.5, 0.3, 60);            // attack
  setTimeout(() => this._env('sawtooth', 220, 0.6, 0.25, 40), 120);   // thud
  setTimeout(() => this._themeAccent('over'), 140);     // accent lands WITH thud
},
```

Don't layer the accent on the attack — the attack needs to read clean as "game ended". Layer it on (or just after) the thud, which is the *sustain* phase of the death beat where atmosphere reads best. 140 ms ≈ 20 ms after the thud starts, so you perceive it as "part of the thud" not a second event.

## Perf budget

- BiquadFilter + BufferSource + Gain + 3 `connect()` calls per accent ≈ negligible compared to the base `_env` that already runs.
- Noise buffer allocation: 48k floats × 1 ms once. After that, every call reuses.
- Total: rounds to nothing. No adaptive-quality gate needed — audio cost doesn't scale with particle count.

## Common mistakes

- **Building the noise buffer at module init even when muted** — wastes ~200KB on players who never unmute. Lazy-init inside `_noise()` is basically free.
- **Stereo noise buffers** — 2× memory, no audible width benefit on a 100ms burst. Mono is fine.
- **Reading `currentTheme` once at `Sfx` construction** — theme picker becomes useless for audio. Read inside `_themeAccent` every call.
- **Using the accent to *replace* the base tone per theme** — player feels like they're playing a different game. Layer, don't replace.
- **Accent louder than base** — base tone carries meaning; accent drowns it, miss stops reading as miss.
- **Same filter `Q` for all themes** — adds a 4th parameter and the per-theme distinctness already comes from type+freq. Keep the default Q=1 unless a specific "sizzle" band needs it.
- **Scheduling accent with `setTimeout` when AudioContext time is available** — `setTimeout` drifts under tab-throttling. For ≤200ms offsets inside a user-driven event, `setTimeout` is fine; for precision, schedule via `osc.start(t0 + offset)` in the AudioContext clock.
- **One-shot `createBufferSource()` stored as singleton** — BufferSource is single-use by spec; you must `createBufferSource()` each call. The reusable part is the `AudioBuffer`, not the Source node.

<!-- added: 2026-04-17 (001-void-pulse sprint 16) -->

## Peak-tier sweetener (Sprint 24)

The Sprint 16 pattern covers *negative* / *punish* moments (miss, gameover) — where additive theme atmosphere colors the consequence. The inverse use-case is *peak* / *reward* moments — the top-tier combo milestone, a rare achievement, a streak threshold. Same shape, opposite polarity: the base success tone still plays (everyone hears the celebration), but the theme-conditional layer adds a *signature* that makes "I maxed my combo in void" feel different from "I maxed my combo in forest".

### Pattern — peak-tier gating

```js
if (state.combo > 0 && state.combo % COMBO_STEP === 0) {
  Sfx.levelup();                        // base cascade, all themes
  if (comboMult() >= 3) Sfx.themeSweeten();   // sweetener gated at ≥3x tier
}
```

Gating on the multiplier *tier* rather than on every milestone keeps the sweetener rare. The base cascade fires 5–8 times per run; the sweetener fires 1–3 times, only at the top. That rarity is what makes it feel special — if it played every 5 hits it would blur into the base cascade and lose the "peak moment" read.

Rules of thumb:
- **First-tier milestone** — base only. The player is still climbing; don't spend your reward.
- **Mid-tier** — base only. Still climbing.
- **Penultimate tier** — base only. The cap is the reward.
- **Cap tier and above** — base + sweetener. This is *the moment*.

For void-pulse's 4-tier ladder (1x → 1.5x → 2x → 2.5x → 3x → 3.5x → 4x), sweetener kicks at 3x and fires for every milestone from there up. Three-tier ladders might want to gate even tighter (cap only).

### Pattern — sweetener shape per theme

```js
themeSweeten() {
  if (currentTheme === 'void') return;
  if (currentTheme === 'sunset') {
    this._env('sine', 2093, 0.45, 0.08);     // high shimmer C7
    setTimeout(() => this._env('sine', 2637, 0.38, 0.06), 40);  // E7
  } else if (currentTheme === 'forest') {
    this._env('triangle', 196, 0.55, 0.10, 147);  // low warm G3 -> D3
    setTimeout(() => this._env('triangle', 294, 0.40, 0.07, 220), 70);
  }
}
```

Per-theme design rationale:
- **Void = no-op.** The baseline feel is clean, synthy, minimalist; adding a sustain dilutes that. The *absence* of sweetener becomes void's signature when A/B'd against sunset/forest.
- **Sunset = high bell shimmer.** Sunset already has ember-crackle in its miss/gameover accents; the sweetener is its *positive* counterpart — bright, high, airy. Pitch way above the base cascade (C7/E7 vs. cascade top of C6) creates separation — reads as "halo" not "part of the cascade".
- **Forest = low warm fifth.** Forest has leaf-rustle lowpass in its negative accents; the positive sweetener mirrors with low-register warmth (G3/D4). Slight pitch slide (`147Hz slideTo`) gives organic life — a straight tone would feel synthetic against the forest theme.

The pattern across themes: pick a register the theme *owns* that's far from the base cascade's register. Sunset owns high/bright (C7+); forest owns low/warm (<300Hz); void owns the mid-register (where the cascade lives) and so has nothing left to add.

### Pattern — longer envelopes for sustain, not attack

Sprint 16's accents were *short* (60–200ms) because they punctuated attacks. Sprint 24's sweeteners are *longer* (380–550ms) because they sustain under the base cascade. Two different use cases of the same `_env` helper:

| Use | Length | Volume | Role |
|---|---|---|---|
| Punish accent (miss/over) | 60–200 ms | 0.10–0.18 | punctuation |
| Peak sweetener | 380–550 ms | 0.06–0.10 | sustain/halo |

The sweetener's volume is *lower* than the punish accent's because it rides on top of a louder base (levelup cascade is 0.17/note) vs. the miss accent riding on a single 0.26 sawtooth. Headroom math: base cascade peak ≈ 0.17, sweetener at 0.08 is ~47% of base, comfortably audible as texture but not competing with lead.

### Common mistakes (peak-tier variant)

- **Firing sweetener at every milestone** — it loses the "peak" read, becomes indistinguishable from the base cascade. Gate by multiplier tier.
- **Layering sweetener on the attack of the cascade** — cascade needs its attack clean to communicate "level up". Layer under the *sustain* (40–70ms delay lets the cascade's first 1–2 notes establish).
- **Making void's sweetener a "neutral" tone rather than a no-op** — adds nothing, occupies mental bandwidth ("was that a sweetener?"). Void's signature IS the absence.
- **Using the same register as the base cascade** — the sweetener disappears into the cascade instead of adding. Use a register the theme owns.
- **Forgetting mid-run theme swap honors** — read `currentTheme` at call-time, not at module init. Otherwise swapping theme mid-run gives the wrong sweetener at the next milestone.

<!-- added: 2026-04-17 (001-void-pulse sprint 24) -->

