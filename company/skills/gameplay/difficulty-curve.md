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
