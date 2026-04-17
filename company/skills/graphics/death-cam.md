# Skill — Death-Cam Slow-Mo

**When to use:** any game with instant-death endings. The problem: a fatal miss in a fast game is over in 16ms. The player barely registers what killed them before the gameover overlay slams down. That breeds confusion and churn.

Death-cam inserts a brief slow-mo beat (~500ms) between the fatal hit and the gameover overlay. Two wins:
1. **Teaching** — the player sees *how* the pulse crossed the ring, learns the timing for next run.
2. **Emotional softening** — abrupt endings feel unfair; a dramatized slow beat lets the loss land on its own weight.

Cost: ~15 lines of code + a touch of CSS.

## Pattern — Time-scaled update with a real-time timer

Separate two clocks: the **world clock** (scaled down during slow-mo) and the **death-cam timer** (real wall-clock). The timer has to use real `dt` so the beat ends on a predictable 550ms regardless of how slow the world gets.

```js
const DEATHCAM_DURATION_S = 0.55;
const DEATHCAM_TIME_SCALE = 0.22;       // world at 22% speed

// State
state.deathCam  = false;
state.deathCamT = 0;

// On fatal miss (guard so it can't re-trigger):
if (state.lives <= 0 && !state.deathCam) {
  state.deathCam = true;
  state.deathCamT = DEATHCAM_DURATION_S;
  // emphasize the fatal hit visually — bigger burst, longer haptic
  spawnBurst(CENTER_X, CENTER_Y, getVar('--danger'), 18, 340);
  app.classList.add('deathcam');
  // NB: don't replay miss SFX here if the caller already did
}

// In update(dt):
if (state.deathCam) {
  state.deathCamT -= dt;                // REAL dt, not scaled
  if (state.deathCamT <= 0) {
    state.deathCam = false;
    app.classList.remove('deathcam');
    gameover();
    return;
  }
}
const simDt = state.deathCam ? dt * DEATHCAM_TIME_SCALE : dt;
// Use simDt for everything world-ish: t, positions, non-timer fx timers
// Use dt for deathCamT and shake/flash (since those are UI wall-clock)
```

## What else to freeze/skip during death-cam

- **Spawn scheduler.** Don't spawn new pulses during the slow-mo — they'd look glitchy.
- **Extra-spawn queue.** Same reason.
- **Late-pulse life loss.** Pulses that expire during slow-mo shouldn't trigger another `loseLife()` cascade — you already entered the fatal state.
- **Input.** Swallow taps; the player tap-spamming during death-cam shouldn't carry into the gameover-retry lockout.

```js
// In judgeTap and pointer handlers:
if (state.deathCam) return;
```

## CSS — desaturate + red vignette

```css
#app.deathcam #stage {
  filter: saturate(.35) brightness(.85);
  transition: filter .18s ease;
}
#app.deathcam::before {
  content: "";
  position: absolute; inset: 0;
  pointer-events: none;
  background: radial-gradient(ellipse at center, transparent 40%, rgba(255, 61, 107, .26) 100%);
  animation: deathcamFade .55s ease-out forwards;
  z-index: 5;
  border-radius: var(--radius);
}
@keyframes deathcamFade {
  0%   { opacity: 0; }
  20%  { opacity: 1; }
  100% { opacity: .78; }
}

@media (prefers-reduced-motion: reduce) {
  #app.deathcam::before { animation: none !important; opacity: .5; }
}
```

The filter on the canvas itself (`saturate`+`brightness`) reads the scene as "this moment is different" without hiding information — the player can still see exactly what killed them.

## Tuning

| Parameter | Value | Why |
|---|---|---|
| Duration | 0.45–0.60s | <0.4s too brief; >0.7s starts feeling slow, players mash to skip |
| Time scale | 0.15–0.30 | Too low = world frozen (can't see the crossing); too high = not dramatic |
| Vignette peak | .78 alpha | Strong enough to feel heavy; weak enough that you can still read the scene |
| Desat | .35 | Keeps enough color to see the pulse; drains the joy |

## Common mistakes

- **Using scaled dt for the death-cam timer** → timer takes forever, beat overstays welcome
- **Re-triggering loseLife during the cam** → cascading misses reset the timer / stack life losses
- **Leaving input active** → player mashes retry → enters the new run during the last frame of death-cam
- **Spawning during the cam** → visuals look glitchy, and the just-spawned pulse is in the way of the retry
- **Skipping reduced-motion override** → the full-screen flash-and-fade is exactly the kind of thing that can trigger motion sensitivity

<!-- added: 2026-04-17 (001-void-pulse sprint 8) -->
