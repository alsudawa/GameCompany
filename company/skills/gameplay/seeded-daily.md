# Skill — Seeded Daily Challenge

**When to use:** any endless / run-based game. Daily seeded mode is the single highest-ROI retention feature a casual game can ship: it turns "one-and-done curiosity" into a recurring ritual, creates organic social-proof ("my 540 on Apr 17"), and costs ~100 lines of code.

Core idea: replace non-deterministic randomness in spawn/scenario logic with a **seeded PRNG** whose seed derives from the URL (`?seed=YYYYMMDD` or `?daily=1`). Every player on the same seed gets the same spawn sequence. Per-seed best is tracked separately from free-play best.

## Pattern — Seeded RNG (mulberry32)

Small, fast, cryptographically-weak but statistically-good. Perfect for casual-game determinism.

```js
function makeRng(seed) {
  let a = seed >>> 0;
  return function() {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// In seeded mode: deterministic. In free play: Math.random.
let rng = SEED !== null ? makeRng(SEED) : Math.random;

// CRITICAL: reset on every retry so each run in a seeded session is identical.
function resetRng() {
  if (SEED !== null) rng = makeRng(SEED);
}
function start() {
  resetRng();
  // …rest of start…
}
```

**Replace only gameplay-critical randomness.** Particle angles, starfield phases, twinkle offsets — leave as `Math.random()`. Two players on the same seed don't need identical particle sprays; they need identical pulse timing and polyrhythm rolls.

## Pattern — URL parsing with daily shortcut

```js
function todayYyyymmdd() {
  const d = new Date();
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}
function parseSeedFromUrl() {
  try {
    const params = new URLSearchParams(location.search);
    const raw = params.get('seed');
    if (raw === 'daily' || params.get('daily') === '1') return todayYyyymmdd();
    if (raw && /^\d+$/.test(raw)) return parseInt(raw, 10) | 0;
  } catch {}
  return null;
}
const SEED = parseSeedFromUrl();
```

Accepts:
- `?daily=1` → today's YYYYMMDD (for a stable "today's daily" link)
- `?seed=daily` → same
- `?seed=20260417` → explicit historical seed (for shared scores)

## Pattern — Per-seed best

Namespace the best-score localStorage key by seed so daily scores have their own independent leaderboard:

```js
const BEST_KEY = SEED !== null
  ? 'game-best-seed-' + SEED
  : 'game-best';
// readBest / writeBest use BEST_KEY unchanged.
```

This means each daily has its own best → players can "solve" a particular seed over multiple tries without grinding a new free-play max.

## Pattern — Share URL canonicalization

When the player shares a seeded score, **don't share `?daily=1`** — that re-resolves to the recipient's today, which is a different seed. Always serialize to `?seed=YYYYMMDD` explicitly.

```js
function shareUrl() {
  if (SEED === null) return location.href;
  const url = new URL(location.href);
  url.searchParams.delete('daily');
  url.searchParams.set('seed', String(SEED));
  return url.toString();
}
```

## UI cues for seed mode

Without a visible indicator, players won't realize they're on a daily and wonder why their free-play best didn't update. Three cheap reinforcements:

1. **HUD pill.** `DAILY · 2026-04-17` in gold, top-center, pointer-events: none.
2. **Start-overlay subtitle.** Same gold badge above the title.
3. **Cross-link.** In seed mode, show "← Back to free play" (href `./`). In free play, show "Try today's daily →" (href `?daily=1`). One-click toggle.

## Why 8-digit integer, not ISO date string

- Sortable, easy to validate (`^\d{8}$`), easy to `parseInt` for the RNG seed
- Stable across timezones if you use device-local `Date` (which is what players intuitively expect — "today's" puzzle should match their calendar, not UTC)
- Caveat: two players in different timezones may see different "dailies" at the same wall-clock moment. For casual games that's fine; for competitive leaderboards pick one zone and stick to it.

## Common mistakes

- **Forgetting to reset RNG on retry** → second run of the "daily" has a different sequence than the first → scores aren't comparable
- **Using `Date.now()` as seed** → technically random, but two players never share a seed → defeats the whole feature
- **Sharing `?daily=1` URLs** → recipient plays *their* today, not yours
- **Replacing all `Math.random()` calls** → ties cosmetic particle patterns to gameplay determinism for no benefit; just do spawn logic
- **No visible daily indicator** → players don't know they're in daily mode, wonder why their best "reset"
- **Same best key across seeds** → daily score overwrites free-play score, frustrates returning players

<!-- added: 2026-04-17 (001-void-pulse sprint 7) -->
