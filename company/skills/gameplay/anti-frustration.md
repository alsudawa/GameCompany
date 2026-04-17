# Skill — Anti-Frustration Mechanics

**When to use:** any game where a player can die quickly and repeatedly. Casual players churn after ~3 rage-retries if nothing changes. Small forgiveness mechanics buy you another 2-3 attempts of goodwill without dumbing the game down.

The key constraint: **forgiveness must be invisible or celebratory, never explicit**. A popup saying "You're struggling — want an easier mode?" is infantilizing. A silent third life, or a "+1 LIFE" badge without explanation, is warm.

## Pattern — Pity life on rage-retry

Detect three quick deaths in a row → next run starts with one bonus life. Consume the trigger so it can't repeat every run.

```js
const RAGE_DURATION_S = 15;     // "fast" death = <15s run
const RAGE_REQUIRED   = 3;       // N quick deaths triggers
const BONUS_LIFE_MAX  = 1;       // cap on bonus (prevents stacking)

function readRageDurations() {
  try {
    const raw = localStorage.getItem('KEY-rage');
    const a = raw ? JSON.parse(raw) : [];
    return Array.isArray(a) ? a.filter(n => typeof n === 'number').slice(-RAGE_REQUIRED) : [];
  } catch { return []; }
}
function writeRageDurations(a) {
  try { localStorage.setItem('KEY-rage', JSON.stringify(a.slice(-RAGE_REQUIRED))); } catch {}
}

// At gameover:
const rage = readRageDurations();
rage.push(+state.t.toFixed(2));   // run duration in seconds
writeRageDurations(rage);

// At start():
const rageHist = readRageDurations();
let bonusLife = 0;
if (rageHist.length >= RAGE_REQUIRED &&
    rageHist.slice(-RAGE_REQUIRED).every(s => s < RAGE_DURATION_S)) {
  bonusLife = BONUS_LIFE_MAX;
  writeRageDurations([]);        // consume — can't be farmed
}
state.lives = STARTING_LIVES + bonusLife;

// Celebrate the grant with a brief center-screen milestone:
if (bonusLife > 0) {
  state.comboMilestoneText = '+1 LIFE';
  state.comboMilestoneFade = 1.1;
}
```

## Why consume the trigger immediately

If you didn't clear the rage history after granting the bonus, a player who died quickly three times in a row would get a bonus life **every run** forever after — turning a difficulty mechanic into a permanent buff. Clearing on grant means the player must earn the bonus again through fresh frustration.

## Why cap at +1

Scaling bonuses (+1, +2, +3…) creates a "the longer you struggle, the more you get" loop that encourages deliberately dying to farm lives. Fixed +1 says "we noticed, here's a hand up" without distorting the meta.

## Other anti-frustration levers

| Lever | When | Watch out for |
|---|---|---|
| Onboarding-phase softer ramp (first N seconds slower) | Every game | Don't stretch past 5-10s or it feels patronizing |
| Early-tap forgiveness (swallow preemptive taps) | Timing games | Don't swallow late taps — those are real misses |
| Input-debounce (ignore <120ms repeat) | Tap-spam games | <80ms feels lagged; >200ms feels broken |
| Wider Good window than Perfect | All rhythm | See `difficulty-curve.md` |
| Second-chance pulse / checkpoint | Puzzle-ish | Careful: can feel cheap if overused |

## Common mistakes

- **Popup asking "want it easier?"** → insulting; players churn faster than without the question
- **Farmable bonuses** → speedrunners and meta-gamers break the system
- **Silent grant with no feedback** → player doesn't notice and the warmth is wasted; a small +1 LIFE flash is enough
- **Forgetting to consume the trigger** → permanent buff, trivializes the game
- **Triggering on single bad run** → over-eager; 3-in-a-row is the right threshold; two could be noise

<!-- added: 2026-04-17 (001-void-pulse sprint 6) -->
