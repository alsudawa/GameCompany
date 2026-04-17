# Skill — Daily Streak + First-Run Achievements

**When to use:** any game with a daily-seeded mode (skill: `gameplay/seeded-daily.md`). Top-N leaderboard (skill: `ux/leaderboard-local.md`) gives *within-session* micro-goals; a streak counter gives *cross-day* ritual; achievements give *cross-session milestones*. The three layer cleanly — each targets a different retention horizon.

The trick: all three are cheap to add once you have the daily-seed plumbing, because they share the same "run is complete → persist signals to localStorage → re-render the gameover overlay" flow. The critical design choice is *scoping* — what's per-seed, what's global, what's per-day.

## Scoping matrix

| Signal | Scope | Key pattern | Why |
|---|---|---|---|
| Best score | per-seed | `game-best-seed-{N}` / `game-best` | daily mode should not crowd out free-play best |
| Top-5 board | per-seed | `game-board-seed-{N}` | same story |
| Run history | per-seed | `game-history-seed-{N}` | sparkline should be "my progression on this daily" |
| **Streak** | **global** | `game-streak` | a streak is "consecutive days" — inherently cross-seed |
| **Achievements** | **global** | `game-ach` | "first 500 points" ever, not "first 500 on today's seed" |

Common mistake: namespacing the streak per-seed. Then every daily has its own 1-day streak, which is not a streak.

## Pattern — streak data + bump rule

```js
const STREAK_KEY = 'game-streak';
function yyyymmddOf(d) {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}
function dateFromYyyymmdd(n) {
  const y = Math.floor(n / 10000);
  const m = Math.floor((n % 10000) / 100) - 1;
  const dd = n % 100;
  return new Date(y, m, dd);
}
function readStreak() {
  try {
    const o = JSON.parse(localStorage.getItem(STREAK_KEY));
    if (o && typeof o.streak === 'number' && typeof o.best === 'number'
        && typeof o.lastYyyymmdd === 'number') return o;
  } catch {}
  return { streak: 0, best: 0, lastYyyymmdd: 0 };
}
function bumpStreakForToday() {
  const today = yyyymmddOf(new Date());
  const s = readStreak();
  if (s.lastYyyymmdd === today) return { ...s, changed: false };  // idempotent
  let newStreak;
  if (s.lastYyyymmdd > 0) {
    const lastDate = dateFromYyyymmdd(s.lastYyyymmdd);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = yyyymmddOf(lastDate) === yyyymmddOf(yesterday);
    newStreak = isYesterday ? s.streak + 1 : 1;
  } else {
    newStreak = 1;
  }
  const out = {
    streak: newStreak,
    best: Math.max(s.best, newStreak),
    lastYyyymmdd: today,
  };
  localStorage.setItem(STREAK_KEY, JSON.stringify(out));
  return { ...out, changed: true };
}
```

Bump rules (key decisions):
- **Idempotent within a day** — a player can replay the daily 10 times; the streak bumps on the first score>0 run, not 10 times.
- **Only score > 0 bumps** — quitting the tab after 2 seconds shouldn't count.
- **Gate on "today's canonical daily" only** — if the player loads a `?seed=20260101` from a month ago, it's not "today's daily", so don't bump. Pattern: `if (SEED === todayYyyymmdd())`.
- **Comparison uses calendar days, not 24-hour deltas** — `yyyymmddOf(lastDate) === yyyymmddOf(yesterday)` avoids timezone and daylight-saving edge cases. Midnight crossing is the boundary.

## Pattern — "active" streak vs. dormant streak

A 4-day streak from a month ago should not be shown as "4-day streak" on today's start screen — that's misleading (it's really broken). Rule:

```js
const today = yyyymmddOf(new Date());
const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
const yYyyymmdd = yyyymmddOf(yesterday);
const active = s.lastYyyymmdd === today || s.lastYyyymmdd === yYyyymmdd;
```

If `lastYyyymmdd` is today → streak is current. If yesterday → still live (player has until tonight's midnight to preserve it). Older → streak is dormant (hide or show as "past best").

Showing best-only (`"best 7"`) when current is dormant is a nice compromise — it honors the achievement without lying about the current state.

## Pattern — streak UI placement (two places, same rule)

- **Start overlay** — greet the returning player. Hide if no active streak.
- **Gameover overlay** — acknowledge the bump that just happened. Animate on bump (`.streak-bumped` scale-pulse keyframe).

Both read from the same `readStreak()` + same active-check, so the badge is *consistent* — same number, same styling, different animation state. Never show a streak on one screen and not the other for the same state.

## Pattern — achievements as flat unlock map

```js
const ACH_KEY = 'game-ach';
const ACHIEVEMENTS = [
  { id: 'first-pulse', label: 'First Pulse', desc: 'Score your first point', test: c => c.score >= 1 },
  { id: 'combo-25',    label: 'Combo 25',    desc: 'Chain 25 hits in a run', test: c => c.peakCombo >= 25 },
  { id: 'combo-50',    label: 'Combo 50',    desc: 'Chain 50 hits in a run', test: c => c.peakCombo >= 50 },
  { id: 'score-500',   label: '500 Points',  desc: 'Reach 500 in a single run', test: c => c.score >= 500 },
  { id: 'score-1000',  label: '1000 Points', desc: 'Reach 1000 in a single run', test: c => c.score >= 1000 },
  { id: 'streak-3',    label: '3-Day Ritual',desc: 'Finish the daily 3 days in a row', test: c => c.streak >= 3 },
];
function evaluateAchievements(ctx) {
  const unlocked = JSON.parse(localStorage.getItem(ACH_KEY) || '{}');
  const justNow = [];
  for (const a of ACHIEVEMENTS) {
    if (!unlocked[a.id] && a.test(ctx)) {
      unlocked[a.id] = 1;
      justNow.push(a.id);
    }
  }
  if (justNow.length) localStorage.setItem(ACH_KEY, JSON.stringify(unlocked));
  return { unlocked, justNow };
}
```

Key choices:
- **Flat `{ [id]: 1 }` map, not an array** — O(1) lookup, trivial to extend without migration (just add an id).
- **`test(ctx)` is a pure fn on run stats** — the calling code doesn't need to know the criteria; adding an achievement is adding one line.
- **`justNow` is the set that became unlocked *this run*** — used for the "just-unlocked" highlight. Without it the player can't distinguish "this one I got this run" from "this was already unlocked".
- **Never re-lock** — once `unlocked[id] = 1`, it stays. Don't test for "still qualifies" — the player earned it.

## Pattern — achievement chip grid with "just" highlight

```js
function renderAchievements(unlocked, justNow) {
  achListEl.innerHTML = '';
  const justSet = new Set(justNow || []);
  let total = 0;
  for (const a of ACHIEVEMENTS) {
    const li = document.createElement('li');
    li.className = 'ach-chip';
    if (unlocked[a.id]) { li.classList.add('unlocked'); total++; }
    if (justSet.has(a.id)) li.classList.add('just');
    // ... label, desc, dot ...
    achListEl.appendChild(li);
  }
  achProgressEl.textContent = total + ' / ' + ACHIEVEMENTS.length;
}
```

Visual rules:
- **Locked** — 40% opacity, no color. Visible but quiet.
- **Unlocked** — full opacity, accent-color dot, subtle glow.
- **Just-unlocked (`.just`)** — unlocked styling + pulse-scale keyframe. One-shot, not looping.
- **Progress header `3 / 6`** — gives the player a completion metric without spoiling which 3. `X / Y` format is universal.
- **Show locked achievements** with description — this *is* the roadmap. Hiding locked ones is a mistake; they're the "what's next" hint.

## Pattern — SFX collision avoidance

When the player's run triggers both NEW BEST and a new achievement, you'd play two cascading cues back-to-back. They collide and muddy the mix. Rule: pick one, and NEW BEST wins (bigger event):

```js
if (justNow.length && !state.newBestThisRun) {
  setTimeout(() => Sfx.achievement(), 420);   // land after gameover thud
}
```

The `setTimeout` offset is deliberate: the achievement chime lands *after* the gameover sound envelope has decayed, so it reads as punctuation, not simultaneous noise.

## Storage size + migration

- Streak: one JSON object (~60 bytes), doesn't grow.
- Achievements: one flat object, 1 entry per unlocked id (~20 bytes each). Will never exceed a few KB.
- Extending with new achievements: append to `ACHIEVEMENTS`. Old data stays valid (absent ids are locked). No migration needed.

## Common mistakes

- **Per-seed streak** — becomes "days in a row on THIS specific seed" which is meaningless (each daily seed exists one day only).
- **Streak bump on every play, not first play of the day** — turns "7-day streak" into "7 games played today", ruins the ritual.
- **Bumping streak on score-0 runs** — quitting instantly preserves the streak, undermining the whole mechanic.
- **Calendar vs. 24h rolling window** — 24h means if the player plays at 11pm Monday + 10pm Tuesday, they broke their streak (23h). Calendar-day is what players expect.
- **Hiding dormant streaks with no "best" line** — erases the fact that the player ever had a streak. Show "best 7" quietly instead.
- **Hiding locked achievements** — removes the roadmap. Players can't aspire to something they don't see.
- **Re-locking on fail** — "you no longer qualify for Combo 50 because this run only had 30" is punitive. Unlocks are monotonic.
- **Parallel unlock + new-best SFX cues** — collide into mush. Pick one per gameover.
- **Namespacing achievements per-seed** — would require re-earning "first 500 points" for every daily. Ridiculous. Global.

<!-- added: 2026-04-17 (001-void-pulse sprint 13) -->

## Extending the ladder (Sprint 23)

Once the base 5–6 achievements are in, they tend to be easy-medium — stuff most players earn in their first week. The ladder needs a *rare tier* to keep the gameover grid aspirational for returning players, but the addition has to:

1. **Not require a schema migration.** Existing unlock objects must remain valid; new ids get tested against runs starting now.
2. **Cover distinct play styles**, so no single good run sweeps them all. One more "score X" when you already have "score 500" and "score 1000" just moves the ceiling.
3. **Leverage state already tracked**, or add minimal new state. Every new tracking field is a potential bug site in reset-on-start.

### Design — axis diversity

Pick new achievements along axes the existing ladder under-covers. For a pulse-timing game with score + combo + perfect count:

| Axis | Example | State needed |
|---|---|---|
| Skill ceiling | Combo 100 | `peakCombo` — already tracked |
| Endurance | 2500 points | `score` — already tracked |
| Retention | 7-day streak | global streak — already tracked |
| Precision | 20+ perfects, zero goods | `perfectCount`, `hitCount - perfectCount` — already derivable |
| Flawlessness | 60s run with zero misses | `missCount` + `duration` — **new tracking needed** |

Each targets a player archetype: the combo grinder, the marathon runner, the daily ritualist, the precision tapper, the zen cruiser. A player who happens to excel at one typically has a weak spot in another — so the ladder rewards *breadth*, not just a single monster run.

### Pattern — additive context fields

```js
function evaluateAchievements(ctx) {
  const unlocked = readAchievements();
  const justNow = [];
  for (const a of ACHIEVEMENTS) {
    if (!unlocked[a.id] && a.test(ctx)) {
      unlocked[a.id] = 1;
      justNow.push(a.id);
    }
  }
  if (justNow.length) writeAchievements(unlocked);
  return { unlocked, justNow };
}

// Caller
evaluateAchievements({
  score, peakCombo, perfectCount, hitCount,
  missCount,    // NEW in Sprint 23
  duration,     // NEW in Sprint 23
  streak,
});
```

The `ctx` object is always passed whole — tests read the fields they care about, ignore the rest. Adding a new field never breaks existing tests. Removing a field breaks tests that use it (so don't). This is exactly how React props work: declarative, additive, safe to extend.

```js
// Old entry (Sprint 13) — still works
{ id: 'combo-50', test: c => c.peakCombo >= 50 },
// New entry (Sprint 23) — reads the new field
{ id: 'flawless-60', test: c => c.duration >= 60 && c.missCount === 0 },
```

### Pattern — pure-function tests

Every test is a pure function of the context. No state peeks, no DOM reads, no Date.now() calls. Why:

- **Order-independent.** Tests can run in any order; iteration order in the ACHIEVEMENTS array doesn't matter for correctness (only for display).
- **Testable.** A unit test can pass a synthetic `{ score: 1234, ... }` and assert the expected unlocks without any game state.
- **Composable.** Need a "score 500 AND combo 25 in the same run"? `test: c => c.score >= 500 && c.peakCombo >= 25`. No special framework.

Avoid the temptation to make tests async or read persistent state. Always-finite, always-total functions keep the achievement system a leaf, not a graph.

### Pattern — centralize the miss counter

If two code paths trigger a life loss (tap-miss and pulse-expire-miss), route both through a single `loseLife()` and increment the counter there:

```js
function loseLife() {
  state.combo = 0;
  state.missCount += 1;  // single source of truth
  state.lives -= 1;
  // ...
}
```

Rather than `state.missCount += 1` at each call site (two places), which is brittle — a third path added later would forget to increment. The counter lives with the consequence (combo-break + life-loss), not with the cause.

### Pattern — reset all new state in `start()`

Every new tracked field gets a `state.<field> = 0` (or the appropriate zero) in the run-start reset. Forgetting this is the single most common source of "my achievement unlocked when it shouldn't have" bugs: stale state from a prior run carries over. Group all resets in one block near the top of `start()` so they're visually scannable.

### Pattern — update the HTML placeholder count

`<span id="achProgress">0 / 6</span>` — the hardcoded initial text on the gameover overlay. When the ladder grows, update it. Otherwise a first-time visitor sees "0 / 6" momentarily before `renderAchievements` overwrites it at gameover. Small thing, easy to miss.

### When NOT to extend the ladder

- If the existing ladder has <50% global unlock rate. That means even the easy tier is hard enough; rare tier will feel oppressive. Fix the easy tier first.
- If the game is still in active mechanics-balancing. Achievements pinned to specific thresholds lock in "this game rewards X" — hard to re-tune scoring if players have already unlocked "500 points" under a different formula.
- If you're adding them to pad a gameover screen that's already busy. The grid should feel like a reward, not a spreadsheet.

<!-- added: 2026-04-17 (001-void-pulse sprint 23) -->

