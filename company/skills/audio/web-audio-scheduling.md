# Skill — Web Audio Pre-Scheduling (ctx.currentTime + delay)

**When to use:** you need to play a sequence of sound events at precise offsets — a chord, an arpeggio, audio ticks synced to a CSS animation, a rhythmic cue with sub-frame precision. The naive approach is `setTimeout`, but setTimeout fires on the main thread, drifts under load, and throws off tight rhythmic alignment. Web Audio gives you a dedicated sample-accurate clock (`ctx.currentTime`) and any oscillator / buffer source scheduled with `.start(whenSec)` will fire on that clock, regardless of main-thread activity.

This pairs with `audio/web-audio-sfx.md` (the `_env` one-shot synth pattern). This doc is the *timing* layer — same oscillator, different scheduling discipline.

## Contract

- **Pre-schedule, don't poll.** Decide the whole sequence up front and hand all the `.start()` calls to the audio graph in a single synchronous burst. The audio subsystem plays them on its own clock.
- **Use `ctx.currentTime` as the anchor, not `Date.now()`.** They diverge under tab throttling; CSS animations use the compositor's clock, which is closer to `performance.now()` than `Date.now()`. `ctx.currentTime` is the right peer for anything audio-adjacent.
- **Never mutate scheduled parameters after the fact.** A `setValueAtTime` followed by another `setValueAtTime` at a later time is fine; a `.stop()` after the fact to cancel is fine. But don't try to "reschedule" an already-queued event — cancel and re-queue.

## Pattern — helper with offset parameter

```js
ghostTick(delaySec) {
  if (!this.ctx) return;
  const t0 = this.ctx.currentTime + Math.max(0, delaySec);
  const osc = this.ctx.createOscillator();
  const g = this.ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(1800, t0);
  g.gain.setValueAtTime(0.04, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.06);
  osc.connect(g).connect(this.master);
  osc.start(t0);
  osc.stop(t0 + 0.08);
},
```

Every timestamp in the function is `t0 = currentTime + delay`. The gain envelope, the oscillator lifecycle, the stop — all relative. This means a `ghostTick(0)` behaves identically to an immediate `_env`, while `ghostTick(0.3)` schedules the exact same sound 300ms from now.

`Math.max(0, delaySec)` guards against negative delays that would silently land in the past (which Web Audio tolerates but probably isn't what you want).

## Pattern — schedule the whole sequence in one loop

```js
if (!reducedMotion && Sfx.ctx && currentRun.events) {
  for (const e of currentRun.events) {
    if (e[1] !== 'p') continue;            // filter
    const delaySec = (e[0] / axisDur) * 900 / 1000;
    Sfx.ghostTick(delaySec);
  }
}
```

One synchronous loop → dozens of scheduled audio events. The loop itself might take 1–2ms on the main thread (allocate oscillators + gain nodes), but the *playback* is entirely clock-driven afterward. Main-thread hiccups don't affect what you hear.

Contrast the `setTimeout` version:
```js
// DON'T do this for tight timing
for (const e of events) {
  setTimeout(() => Sfx.tick(), delayMs);
}
```
Each setTimeout fires on the main thread; browser throttling (background tab, heavy layout), GC, or another long task can delay them. Audio drifts out of sync with the visual animation. On a 900ms window with 60 events that's very noticeable.

## Pattern — gate on the same conditions as the visual peer

```js
if (!reducedMotion && Sfx.ctx && currentRun.events) { ... }
```

If this audio is *paired* with a visual animation:
- **Gate on `prefers-reduced-motion`.** Motion-sensitive users skip the animation; if you play the audio anyway, they hear ticks against an already-rendered chart. Confusing.
- **Gate on `Sfx.ctx` exists.** The audio context may not have been created yet (before first user interaction). Don't throw — just skip.
- **Don't gate on `state.muted` here.** The master-bus gain is already set to 0 when muted; oscillators still allocate/run but produce silence. That's fine for a one-shot sequence. For per-frame audio work gating earlier matters; for a one-time burst it's irrelevant and coupling to mute state creates a second source of truth.

## Pattern — sparse over dense

For a 60-event run with ~40 perfects, 40 ticks spread over 900ms is 45ms average spacing — fast enough to feel like a trill, too fast to count. That's the goal: a textural *impression* of the run, not a roll-call.

Picking "perfects only" is both sparser and semantically meaningful — it celebrates the player's hits, doesn't mark misses (which already have a miss SFX at play-time). If you ticked every event, the sound would be noise; picking a subset by gameplay salience keeps the audio layer editorial.

Rules of thumb:
- **< 10 ticks over 900ms** → feels like discrete notes, each readable.
- **10–30 ticks** → feels like a trill or flourish.
- **30+** → feels like a wash, a single sustained texture.

Design around which feel you want. Perfects-only puts most runs in the 5–25 range, landing in "trill" territory.

## Pattern — short, quiet envelope

```js
g.gain.setValueAtTime(0.04, t0);
g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.06);
osc.stop(t0 + 0.08);
```

- **0.04 vol** (vs. 0.15–0.26 for play-time SFX) — these are *texture*, not events. Any louder and they dominate the post-death silence.
- **60ms envelope** — short enough that back-to-back ticks don't blur, long enough to register as a tone rather than a click.
- **`stop(t0 + 0.08)`** — 20ms past the envelope end frees the node. Without stop, oscillators run forever and the audio graph grows.
- **Sine wave at 1800Hz** — high register, non-intrusive, cuts through the synth bed without stepping on the gameover thud.

Tune pitch to sit above your game's base SFX range. If the ticks collide frequency-wise with other sounds, they blur into muddiness.

## Pattern — schedule cancellation not required for fire-and-forget

Because each scheduled event owns its own oscillator + gain nodes, and the nodes GC after `.stop()` fires, there's no cleanup required. If the player immediately retries and triggers a new gameover mid-reveal, the old ticks keep playing (briefly, for up to 900ms) alongside the new ones. In practice that's fine — the two reveals overlap by a fraction of a second and the result isn't jarring.

If overlap IS a problem:
- Track the scheduled oscillators in an array.
- On re-trigger, call `.stop()` with `currentTime` as the argument (immediate stop) on each.
- Or route them through a dedicated gain node per-sequence that you can tear down.

For casual one-shot reveals this is overkill; just let them run.

## Common mistakes

- **Using `setTimeout` for tight rhythmic audio.** Drifts under load, fights throttling, can't match a CSS animation's compositor-driven timing.
- **Anchoring to `Date.now()` or `performance.now()` instead of `ctx.currentTime`.** The audio clock is its own thing; mixing clocks creates audible drift.
- **Scheduling in the past.** Events with `t < ctx.currentTime` fire immediately (mostly harmless, but may glitch depending on browser). Clamp with `Math.max(0, delay)`.
- **Forgetting `.stop()` on oscillators.** They run forever without it; the audio graph grows; eventually the browser may throttle or kill the context.
- **Mutating envelope params after scheduling.** Works sometimes, creates audible glitches others. Schedule once per node.
- **Not gating on `prefers-reduced-motion` when the audio is synced to a visual.** The audio plays against a pre-rendered visual → confusing.
- **Ignoring the `ctx` existence check.** If the user hasn't clicked anywhere yet, there's no audio context; calling start() on nothing throws.
- **Packing too much** — audio reveal becomes cacophony. Curate by semantic relevance (perfects only, bar lines only, etc.).
- **Using short notes with sharp attacks for back-to-back ticks** — the square/sawtooth attacks click unpleasantly at <50ms spacing. Prefer sine or triangle for tight sequences.

<!-- added: 2026-04-17 (001-void-pulse sprint 22) -->
