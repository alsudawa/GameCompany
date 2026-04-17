# Game Design Document — void-pulse

**Designer:** @game-designer (Opus)
**Status:** approved for build
**Revised:** 2026-04-17 — sprint 2 retuned judgement to time-domain (see bottom)

## Hook
Tap the ring at the exact moment a pulse wave reaches it — survive the void's heartbeat as it speeds up and splits into polyrhythms.

## Core loop (every ~1–2 seconds)
1. A pulse ring is emitted from the center (radius 0) and expands outward.
2. As it passes the **target ring** (fixed radius 260px), the player taps anywhere on screen.
3. Reward on-time hits with score + juice; punish misses with a lost life.

## Input mapping
- `pointerdown` anywhere on canvas → resolve the **oldest active pulse** (first-spawned-first-judged).
- `pointermove` / `pointerup` → **explicitly ignored** (no drag mechanics).
- Two taps inside 120ms → second tap is ignored (debounce).

## Scoring & win/lose

**Hit window** (judged on radial Δ between pulse radius and target radius = 260px at moment of tap):
| Result   | Window        | Base score |
|----------|---------------|-----------:|
| Perfect  | `|Δ| ≤ 8px`   | +100 × mult |
| Good     | `|Δ| ≤ 18px`  | +50 × mult |
| Miss     | `|Δ| > 18px`  | −1 life    |

**Pass-through** (pulse expands past `target_r + 18px` without a tap) → −1 life, pulse fades.

**Combo multiplier:**
```
mult = Math.min(1 + Math.floor(combo / 5) * 0.5, 4)
// combo 0–4 → 1×, 5–9 → 1.5×, 10–14 → 2×, 15–19 → 2.5×, 20–24 → 3×, 25+ → capped 4×
```
Any Miss or pass-through resets combo to 0.

**Lives:** start with 3. Game-over when lives = 0.

**Win condition:** N/A (endless).

## Difficulty curve (4-waypoint)

| Time  | Pulse speed (px/s) | Spawn gap (ms) | Polyrhythm                         |
|-------|-------------------:|---------------:|------------------------------------|
| 0s    | 260                | 900            | single pulses                      |
| 15s   | 340                | 700            | single pulses                      |
| 45s   | 460                | 500            | 30% chance of **double** (500ms apart) |
| 90s+  | 600 → 720 soft cap | 300 floor      | 15% chance of **triple** (400ms apart) |

Interpolation is piecewise linear. Soft cap formula for t≥90s:
```js
speed = Math.min(720, 600 + (t - 90) * 1.2);
gap   = Math.max(300, 500 - (t - 45) * 4.5);  // clamped
```

## Juice moments

1. **Perfect hit** — target ring does `pop` (scale 1.0 → 1.25 → 1.0, 180ms), 12-particle radial burst in `--accent` at target radius, `Sfx.score(combo)` (pitch-shifts up with combo).
2. **Good hit** — target ring flashes `--accent` for 120ms, 6-particle spark, lower-pitched score SFX (`Sfx.score(Math.max(0, combo-2))`).
3. **Miss (tap at wrong radius)** — screen shake 8px for 200ms, red radial flash on target ring (`--danger`, 150ms), `Sfx.hit()`.
4. **Pass-through (no tap)** — target ring dims by 30% for 250ms, `Sfx.hit()` softer, pulse ring inverts color while fading.
5. **Life lost** — one of three HUD "◯" icons (top-right) desaturates and shakes 6px for 300ms.
6. **Combo milestone** (every 5 combo) — `Sfx.levelup()`, target ring emits a secondary slow expanding halo, brief "×2" etc. text pops at center.
7. **Near-miss tension** — when a pulse enters `target_r - 40` window without a tap yet, target ring subtly brightens (12% luma boost) — telegraphs "tap NOW" without crowding the visual.
8. **Game-over** — white flash 400ms (alpha 0.8→0), all pulses fade 500ms, stage shakes 14px/300ms, overlay fades in 250ms with "void silenced" + final score + best + "tap to retry".

## Game feel checklist
- **Anticipation:** pulses visibly expand for 1s+ before reaching the target; player has time to read them. Target ring brightens in the near-miss window.
- **Impact:** shake + flash + particle burst + pitch-shifted SFX stack on perfect. Miss feels "punched" with red flash + low sawtooth.
- **Reaction:** every tap produces a visible + audible response within 1 frame, even a miss.

## Retry path
After game-over, a 400ms input lockout plays while the overlay animates in (prevents accidental restarts from the death-tap). After that, **any** `pointerdown` resets all state (lives=3, combo=0, score=0, t=0, particles cleared, pulses cleared) and spawns the first pulse. Total death-to-playing ≈ 650ms.

## Canvas & layout
- Canvas: **720×960** (template default), rendered centered with `aspect-ratio`.
- Target ring center: `(360, 480)`.
- Target ring radius: **260px**, stroke 6px, color `--accent`.
- HUD: score top-left, lives (3× ◯ glyphs) top-right, combo multiplier center-top when >1×.

## Risks & mitigations

1. **Ambiguous taps with overlapping pulses.** In polyrhythm phases two pulses may be near-target simultaneously. → *Mitigation:* always judge the **oldest** (largest-radius) active pulse; show it with 10% more stroke opacity so the player knows which is "up."
2. **Reaction-time wall past 720 px/s.** Hitting 8px windows at max speed may exceed human reaction bounds. → *Mitigation:* soft cap enforced; Perfect window widens to 10px after t≥120s as a grace gift (`perfectWindow = 8 + Math.max(0, (t-120) * 0.02)`, capped at 12px).
3. **Visual monotony** (just expanding circles). → *Mitigation:* background has a subtle vignette + radial gradient that intensifies with combo; every 5th pulse is a "heartbeat" color (`--danger` tint) that scores +50% — visual variety without rule complexity.

---

## Sprint 2 revisions (2026-04-17)

CEO playtest: "timing feels off." Original pixel-based judging didn't survive the speed ramp. Revisions:

- **Judgement moved to time domain.** Windows now `PERFECT = 55–80 ms` (grace-widened past t=120s) and `GOOD = 130 ms`. Tap distance is computed as `|r − TARGET_R| / pulse.speed × 1000`. This keeps the feel constant across the whole difficulty curve (was collapsing to ~11ms at peak speed).
- **Judge pulse = nearest-to-target, not oldest.** Because each pulse locks its speed at spawn (`p.speed = speedAt(bornT)`), a newer-faster pulse can overtake an older-slower one. Judging "oldest" disagreed with the player's spatial model during polyrhythm triples. Now `findJudgePulse()` returns the pulse with the smallest `|r − TARGET_R|`; the render highlight follows the same query.
- **Pass-through + tension telegraph moved to time.** Pass-through fires at `toArriveMs < -GOOD_WINDOW_MS`. Tension flash activates at `toArriveMs ≤ 180ms`, constant lead regardless of speed.
- **Auditory rhythm anchor.** `Sfx.spawnTick()` — 35ms sine blip at every spawn (520Hz base / 740Hz heartbeat). Gives the player a "tick → arrival" cadence to lock onto.
- **HUD combo shows streak count too.** Format: `×1.5 12`. Visible progress at combo < 5 where the multiplier is still 1×.
