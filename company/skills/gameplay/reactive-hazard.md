# Skill — Reactive "Don't-Tap" Hazard

<!-- added: 2026-04-17 (001-void-pulse, sprint 29) -->

**When to use:** you have a tap-on-beat / tap-at-the-right-time mechanic and it's too predictable — a player can fall into rhythm and auto-tap without looking. You need to force *sight-reading*. Inject hazard events that look similar enough to be tempting but must be withheld; they break the auto-tap pattern and reintroduce tension.

Pairs with:
- `gameplay/rhythm-chart.md` — hazards live inside the chart grid
- `graphics/css-animation.md` — visual differentiation (throb, dash, color)
- `audio/web-audio-sfx.md` — distinct hazard-hit / hazard-pass SFX

## Contract

- **Visual differentiation is non-negotiable.** A hazard that looks like a normal is a gotcha, not a mechanic. Use color (red vs white) AND shape (dashed vs solid) AND motion (throb vs steady) so every accessibility lens picks it up.
- **Telegraph before the first hazard appears.** Ease the player in — no hazards in the first 5–8 seconds. Easy-band templates place hazards on weak slots with a rest-slot before them.
- **Never back-to-back hazards in hard-and-below bands.** Keep a normal between them. Back-to-back is a climax-only move.
- **Tapping a hazard costs lives AND score.** Not just lives — that's a mistake you can shrug off. Score penalty makes hazard management the primary tension source.
- **Passing a hazard grants a bonus.** Small (say ~50 points), but present. Without this, hazards are pure tax and players feel punished for the game's pacing.
- **Scoring budget includes hazard bonuses in maxPossibleScore.** 100% should require every hazard dodged, not just all normals perfect.

## Pattern — constants

```js
const HAZARD_PASS_BONUS = 50;           // points for letting a hazard expire
const HAZARD_TAP_PENALTY = 100;          // score debit when tapping a hazard
const HAZARD_DASH = [14, 8];             // visual dash pattern for hazard rings
```

## Pattern — tap judge

```js
function judgeTap() {
  const p = findJudgedPulse();
  if (!p) return;
  const dMs = Math.abs(arriveTime(p) - state.t * 1000);
  if (p.kind === 'h') {
    // HAZARD: any tap inside the normal GOOD window is a penalty
    if (dMs <= GOOD_WINDOW_MS) {
      p.active = false;
      state.score = Math.max(0, state.score - HAZARD_TAP_PENALTY);
      loseLife();
      spawnBurst(CENTER_X, CENTER_Y, getVar('--danger'), 18, 320);
      Sfx.hazardHit();
    }
    return;
  }
  // … normal tap judging below
}
```

## Pattern — hazard expiry (pass bonus)

```js
if (pulseExpired) {
  p.active = false;
  if (p.kind === 'h') {
    state.score += HAZARD_PASS_BONUS;
    state.hazardClearT = 0.22;                // small UI flash
    spawnBurst(CENTER_X, CENTER_Y, getVar('--subtle'), 6, 140);
    Sfx.hazardPass();
  } else {
    // normal expire → life loss
    loseLife();
  }
}
```

## Pattern — visual render

```js
const isHazard = p.kind === 'h';
ctx.strokeStyle = isHazard ? getVar('--danger') : getVar('--fg');
ctx.lineWidth = 3 + (isHazard ? 2.5 : 0);
if (isHazard) ctx.setLineDash(HAZARD_DASH);
const throb = isHazard ? (0.8 + Math.sin(state.t * 14) * 0.2) : 1;
ctx.globalAlpha = Math.min(1, 0.5 + rDraw / 260) * throb;
```

Three signals — color, dashed stroke, pulsing alpha. Sight-reading even at peripheral-vision distance.

## Pattern — SFX (dual-layer for weight)

```js
hazardHit() {
  this._env('sawtooth', 95, 0.28, 0.30, 48);       // low crunchy hit
  setTimeout(() => this._env('square', 320, 0.16, 0.18), 45);  // mid-slap follow
  this._themeAccent('miss');
},
hazardPass() {
  this._env('sine', 1760, 0.18, 0.10);
  setTimeout(() => this._env('sine', 2637, 0.14, 0.06), 30);   // small chime cue
},
hazardSpawn() {
  this._env('sawtooth', 140, 0.08, 0.14, 90);      // low warn pip at spawn
},
```

## Tuning levers

| Knob | Effect |
|---|---|
| Hazard density in easy band | Sets the "oh god I have to WATCH" onset — 0 hazards for 2 bars, 1 late-slot hazard for 3 bars, then mid-band ramps |
| Speed (via BAND_SPEED.hazard) | Don't make hazards faster than normals — the surprise comes from *restraint*, not reflex |
| HAZARD_PASS_BONUS | Too low → hazards feel like tax. Too high → players avoid normals to fish for hazard bonuses. Aim for ~50% of a perfect normal hit |
| HAZARD_TAP_PENALTY | Must exceed a perfect normal hit — so each hazard tap is a net-negative even if they hit the next pulse perfectly |
| HAZARD_DASH | Dashed stroke reads clearly even in monochrome accessibility mode |

## Accessibility

- **Screen reader** — announce hazard tap ("Hazard tapped. -100.") and hazard pass ("Hazard avoided. +50."). See `ux/screen-reader-announcements.md`.
- **Reduced motion** — throb animation and hazard-hit wash must respect `prefers-reduced-motion`. Color alone should still communicate, but keep the dashed pattern even in reduced-motion.
- **Color-blind** — dashed stroke + shape variation is the fallback. Don't rely on red-green contrast. See `ux/accessibility.md`.

## Placement heuristics in a chart

- **First hazard appears late enough to be learned, not memorized.** Bar 4–6 is the sweet spot in a 30-bar chart.
- **Hazards on slot 3, 5, or 7** — weak subdivisions — so they feel like offbeats the player is tempted to "fill in."
- **Always a rest before a hazard in easy/mid.** The player gets a breath to notice the upcoming color change.
- **Climax allows hazards on slot 1** — the downbeat hazard is the hardest read (player muscle-memories the downbeat as tap-worthy). Save it for peak difficulty.

## When NOT to use

- **Tutorial / first-30-seconds.** Hazards demand sight-reading; a first-time player hasn't yet learned what a normal looks like.
- **Games without a beat grid.** Without a predictable rhythm, "don't-tap" events feel random rather than learnable.
- **Single-input where the input is also the camera.** (E.g., tap-to-turn). The don't-tap mechanic conflicts with navigation inputs.
