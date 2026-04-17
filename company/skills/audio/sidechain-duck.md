# Skill — Sidechain-Style Duck on Punctuation Events

<!-- added: 2026-04-17 (001-void-pulse, sprint 33) -->

**When to use:** your game has a music layer (BGM loop, generative chart, ambient pad) *plus* hit-reactive SFX (miss, hazard, damage, big-combo burst). The music and the SFX share a frequency range and "talk over" each other at climactic moments. You want the punishment / celebration SFX to land cleanly without permanently lowering music volume.

Different from `audio/audio-dynamics.md` — that doc covers **steady-state** bus switching (normal ↔ beaten ↔ duck for overlays). This doc covers **transient** event-driven ducking: a fast in/out dip timed to a single SFX impact, like a compressor's sidechain in DAW terminology.

Pairs with:
- `audio/synced-bgm.md` — the BGM module gets a `duck()` method
- `audio/web-audio-sfx.md` — the SFX that triggers the duck
- `audio/audio-dynamics.md` — bus-state cousin; don't confuse the two

## Contract

- **Short envelope, not a bus change.** Attack in 20–40ms, hold 50–120ms, release 200–400ms. Faster than a bus swap (~400ms) but longer than a click.
- **Anchor current gain, don't reset.** Use `setValueAtTime(g.value, t)` before the attack ramp. This makes overlapping ducks (two hazards 100ms apart) compose naturally instead of snapping back to full.
- **Return to the bus level, not a hardcoded 1.0.** The release target should be the `MASTER_GAIN` of the layer being ducked — otherwise a duck during mute-fade or pause-fade will override those and leak audio.
- **No-op when not running / muted / paused.** Early-return saves CPU and, more importantly, avoids writing gain ramps that will fight with `setMuted` / `pause()` / `stop()` logic.
- **Tune release to overlap the visual.** If your hit has a 280ms red-wash visual, set release=300–350ms so the music returns just as the wash fades. Audio-visual coupling sells the feel.

## Pattern — method on the music gain

```js
// Drop this into your BGM module (or any per-layer gain wrapper).
duck(amount = 0.35, attackS = 0.03, holdS = 0.09, releaseS = 0.32) {
  if (!this.running || this.paused) return;
  if (state.muted) return;
  if (!this.gain || !this.ctx) return;
  const g = this.gain.gain;
  const t = this.ctx.currentTime;
  const low = MUSIC_BASE_GAIN * amount;     // NOT 1.0 — respects the layer's nominal level
  try {
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);            // anchor wherever we are right now
    g.linearRampToValueAtTime(low, t + attackS);
    g.setValueAtTime(low, t + attackS + holdS);
    g.linearRampToValueAtTime(MUSIC_BASE_GAIN, t + attackS + holdS + releaseS);
  } catch { /* setMuted / stop will repair the schedule */ }
}
```

## Call site

```js
// Inside the hit handler, alongside the punishment SFX:
if (typeof Sfx.hazardHit === 'function') Sfx.hazardHit();
if (typeof BGM.duck === 'function') BGM.duck();
// (optional: haptic, shake, particle burst around here too)
```

## Tuning table

| Knob | Typical | Effect |
|---|---|---|
| `amount` | 0.30–0.45 | Depth of dip. 0.35 ≈ -9dB; drops music noticeably but keeps presence. <0.20 feels like a dropout; >0.60 is barely audible. |
| `attackS` | 0.02–0.05 | How fast music gets out of the way. Faster = punchier SFX land; too fast = audible zipper on some browsers. |
| `holdS` | 0.05–0.15 | Sustained dip while SFX transient + body play. Scale to your SFX length. |
| `releaseS` | 0.25–0.40 | Return curve. Match the visual decay (screen flash, particle burst) for audio-visual coupling. |

## Why anchor current gain (the overlap case)

Two hazard hits 80ms apart:

**Without anchor:**
- t=0: duck fires → ramp 0.26 → 0.09 over 30ms
- t=80ms: gain is at ~0.09 (mid-hold). Second duck fires.
- `cancelScheduledValues` clears the pending release. No anchor. Next ramp starts from... whatever Web Audio decides (undefined intermediate value in some implementations).
- Result: either a click or a snap to full.

**With `setValueAtTime(g.value, t)`:**
- t=80ms: second duck reads current gain (~0.09), anchors it, ramps back down to 0.09 (no-op attack), holds, releases.
- Result: clean extended duck that tracks both hits.

This is the same trick DAW sidechain compressors use internally — the gain reduction state is a latch, not a trigger.

## Don't use for…

- **Continuous events.** If SFX fire every 200ms (rapid-fire weapon, drum roll), the music will feel permanently ducked. Either raise the amount (0.5+) or switch to a proper bus swap.
- **Ambient pads that should *always* bow.** If the music should stay quieter while any SFX plays, just lower `MUSIC_BASE_GAIN`. Don't fight the mix with a thousand ducks.
- **One-shot stingers (gameover riff, victory fanfare).** Those already take center stage — ducking underneath is pointless and often inaudible.

## Interaction with the rest of the audio graph

The duck writes to the music layer's own gain node. It does **not** need to know about:
- `Sfx.master` bus state — the duck ramp is a child of that master, so the absolute output respects whatever the master is doing.
- `setMuted` / `pause` / `stop` — those all use `cancelScheduledValues` on the same gain node, so they'll cleanly override an in-flight duck.

If your music layer *doesn't* have its own gain node between the voices and `Sfx.master`, add one first. Without it, you can't duck music without ducking SFX.

## Cost

- One method, ~15 lines.
- Per-call: `cancelScheduledValues` + `setValueAtTime` + 2 ramps + 1 sustain. Web Audio schedules natively — negligible JS cost.
- Zero allocation per duck.

## Verifying it works

1. Mute + run: hazard tap → no audible change (SFX also silenced by master mute, and duck early-returns).
2. Unmute + run: hazard tap → music noticeably dips under the SFX hit, restores smoothly.
3. Two hazards within 200ms: music stays attenuated across both; no audible pumping-artifact between them.
4. Hazard during pause overlay: paused scheduler → duck() early-returns → no ghost ramp that surfaces on resume.
5. Hazard as the fatal hit: duck fires, then `BGM.stop()` a moment later ramps to zero regardless. No leak.
