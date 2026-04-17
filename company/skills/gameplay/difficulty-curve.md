# Skill — Difficulty Curve

**When to use:** every endless casual game.

## The 4-waypoint rule

Design difficulty at 4 timestamps and interpolate:

| Time | Phase | Feeling |
|---|---|---|
| 0s   | Intro    | "Oh, I get it." |
| 15s  | Engage   | "Whoa, speeding up." |
| 45s  | Stretch  | "I need to focus." |
| 90s+ | Mastery  | "One more try" after losing |

## Snippet — speed multiplier

```js
function speedAt(t) {
  // Piecewise linear, easier to tune than a formula
  if (t < 15)  return 1.0 + t / 15 * 0.3;       // 1.0 → 1.3
  if (t < 45)  return 1.3 + (t - 15) / 30 * 0.5; // 1.3 → 1.8
  if (t < 90)  return 1.8 + (t - 45) / 45 * 0.4; // 1.8 → 2.2
  return Math.min(2.8, 2.2 + (t - 90) * 0.005);  // soft cap
}
```

## Principles

- **Lose-at-45s median** — tune so the median player dies between 30–60s. Shorter = frustrating, longer = boring.
- **One axis at a time** — ramp speed, OR spawn rate, OR entity size. Ramping all three is chaos.
- **Visible milestones** — show a combo/multiplier so the player *feels* progress, not just statistics.
- **Fail-fast** — game-over-to-retry should be < 3s. A long death animation is the enemy of retries.

## Common mistakes

- Exponential ramps → every game feels the same shape
- Ramping from t=0 → feels unfair; give 5–10s grace
- No soft cap → skilled players hit an un-beatable wall, rage-quit

<!-- added: 2026-04-17 (001-void-pulse) -->

## Pattern — Polyrhythm via scheduled extras

Once the base spawn interval gets below ~500ms, you can't just shorten it further — it becomes input spam. Instead, keep the base rhythm and inject **extra** spawns at sub-beat offsets.

```js
const extraSpawns = []; // absolute game-times

function scheduleNext() {
  state.nextSpawnAt = state.t + gapAt(state.t) / 1000;
  const roll = Math.random();
  if (state.t >= 90 && roll < 0.15) {
    extraSpawns.push(state.t + 0.4, state.t + 0.8);  // triple
  } else if (state.t >= 45 && roll < 0.30) {
    extraSpawns.push(state.t + 0.5);                 // double
  }
}

// In update():
for (let i = extraSpawns.length - 1; i >= 0; i--) {
  if (state.t >= extraSpawns[i]) {
    spawnEntity();
    extraSpawns.splice(i, 1);
  }
}
```

**Tuning:** Start polyrhythms at the 45s waypoint, escalate to triples at 90s. Probabilities 30%/15% keep them surprising.

## Pattern — Grace-widening on late waypoints

For timing games, widen the Perfect window past the mastery waypoint so skilled players aren't punished by reaction-time physics:

```js
function perfectWindow() {
  return Math.min(12, 8 + Math.max(0, (state.t - 120) * 0.02));
}
```
Starts at 8px, widens 2px over 100s of play past the 120s mark. Invisible to casual players, appreciated by masters.

<!-- added: 2026-04-17 (001-void-pulse sprint 2) -->

## Pattern — Time-domain judge windows (never pixel-domain)

Any game with speed-varying entities (falling items, expanding rings, scrolling notes) must express judge windows in **time**, not distance. Pixel-based windows silently shrink as speed ramps, turning your designed 31ms perfect into an 11ms inhuman window at the difficulty peak.

```js
// WRONG — pixel-based. Collapses with speed.
const PERFECT_WINDOW_PX = 8;
if (Math.abs(entity.r - TARGET_R) <= PERFECT_WINDOW_PX) {...}

// RIGHT — time-based. Constant in human terms.
const PERFECT_WINDOW_MS = 55;
const dMs = Math.abs(entity.r - TARGET_R) / entity.speed * 1000;
if (dMs <= PERFECT_WINDOW_MS) {...}
```

Rule of thumb:
- Perfect: **40–80ms** (percussive-feeling; ≥ 50ms unless your game is specifically a precision tester)
- Good: **100–150ms**
- Grace widening: +0.1 to +0.15 ms per second past the mastery waypoint

The same rule applies to pass-through detection (`toArriveMs < -GOOD_WINDOW_MS`) and tension telegraphs (`toArriveMs <= 180`) — any threshold touching a moving entity should live in ms, not px.

## Pattern — Nearest-entity judging (not oldest)

When multiple entities can be live simultaneously and each has an independent speed, **the player's visual model is spatial**: they tap the thing that's arriving. Judging "oldest" (by spawn time or array index) disagrees with that model whenever a newer fast entity overtakes an older slow one — exactly what happens during polyrhythm phases or lane-based games.

```js
function findJudgeEntity() {
  let chosen = null, bestD = Infinity;
  for (const e of entities) {
    if (!e.active) continue;
    const d = Math.abs(e.pos - TARGET);
    if (d < bestD) { bestD = d; chosen = e; }
  }
  return chosen;
}
```

Use the same query for the visual "live entity" highlight — one query, one invariant. If the render says "this is live" and the judge says "that is live," the player feels cheated.

<!-- added: 2026-04-17 (001-void-pulse sprint 3) -->

## Pattern — Onboarding phase (softer first 5s)

A difficulty curve that starts at "normal" feels hostile to first-timers who haven't read the mechanic yet. Prepend an **onboarding phase** of 5 seconds that's explicitly easier than the "intro" waypoint.

```js
const ONBOARDING_T = 5;

function speedAt(t) {
  if (t < ONBOARDING_T) return 200 + (t / ONBOARDING_T) * 60;        // 200 → 260
  if (t < 15) return 260 + ((t - ONBOARDING_T) / (15 - ONBOARDING_T)) * 80;
  // ...existing waypoints...
}

function gapAt(t) {
  if (t < ONBOARDING_T) return 1100 - (t / ONBOARDING_T) * 200;       // 1100 → 900
  if (t < 15) return 900 - ((t - ONBOARDING_T) / (15 - ONBOARDING_T)) * 200;
  // ...existing waypoints...
}
```

Rules:
- **Onboarding < Intro.** Speed and spawn rate both below the intro-waypoint values, then merge into intro cleanly.
- **Last 5s of onboarding = intro baseline.** No discontinuity at `t = ONBOARDING_T` — both `speedAt` and `gapAt` must evaluate the same at the boundary.
- **Don't show a label.** No "TUTORIAL" text. Softer numbers are invisible to returning players but give first-timers 2–3 free successful taps before the real curve begins.
