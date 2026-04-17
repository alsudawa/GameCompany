# Skill — Ghost Run Comparison (Best-Run Timeline Overlay)

**When to use:** a game with a seeded / daily mode where the same pulse or obstacle sequence replays across sessions. Players can intuit *how much* they improved from the score number, but not *where* they improved — did they get better at the early game, or did they push further into the late-game spike? A ghost strip showing per-event outcomes (hit / good / miss) for the current run next to the stored best run makes the comparison legible without adding gameplay-time HUD noise.

This pairs with `ux/leaderboard-local.md` (per-seed score ranking) and `ux/retention.md` (run-end stats). The ghost is the *qualitative* complement to those *quantitative* views.

## Contract

Ghost data is meaningful only when the seed fixes the sequence:
- **Daily (`?daily=1`) or shared seed (`?seed=N`)** → record and display.
- **Free-play** → don't record, don't display. Apples-to-oranges; the strips would mislead.

The ghost always pairs with the stored `BEST_KEY` for the same seed. On a new best, both update in lockstep. This keeps the comparison honest: "your current attempt" vs. "your best attempt for this exact sequence".

## Pattern — compact event tuples

```js
const GHOST_EVENT_CAP = 240;
state.runEvents = [];
function recordRunEvent(kind) {
  if (GHOST_KEY === null) return;               // free-play = no recorder
  if (state.runEvents.length >= GHOST_EVENT_CAP) return;
  state.runEvents.push([+state.t.toFixed(2), kind]);   // [seconds, 'p'|'g'|'m']
}
```

Tuple, not object:
- `[78.32, 'p']` → 13 JSON bytes
- `{"t": 78.32, "kind": "p"}` → 24 JSON bytes

For a 120-event run that's ~1.5 KB vs. ~3 KB — both fine, but tuples are half as much and JSON-parse faster. Single-letter kinds (`'p'` / `'g'` / `'m'`) stay human-readable without cost.

Cap with a constant, not "best effort". 240 is ~4 minutes at 1 event/sec — well beyond any realistic run. The cap exists to guard pathological long sessions, not to constrain normal play.

## Pattern — per-seed storage key

```js
const GHOST_KEY = SEED !== null ? 'void-pulse-ghost-seed-' + SEED : null;
```

Key discipline:
- **`null` is the sentinel** for "don't record". Every guard is `if (GHOST_KEY === null) return;`. No need for a separate flag.
- **Per-seed scope** mirrors `BEST_KEY` / `HISTORY_KEY` / `LEADERBOARD_KEY`. The four values move together on seed change.
- **Schema versioning in the key** (`ghost-seed-` prefix) — if you ever change the payload shape, bump to `ghost-v2-seed-` and readGhost falls back to null for old keys, which is the correct "no ghost recorded yet" state.

## Pattern — persistence tied to new-best event

```js
const prevBest = state.best;
if (state.score > state.best) {
  state.best = state.score;
  writeBest(state.best);
}
const ghostBefore = readGhost();                // snapshot BEFORE writing
if (GHOST_KEY !== null && state.score > 0 && state.score > prevBest) {
  writeGhost({
    events: state.runEvents.slice(),
    score: state.score,
    duration: +state.t.toFixed(2),
    at: Date.now(),
  });
}
renderGhost(
  { events: state.runEvents, duration: state.t },
  ghostBefore,                                   // ← prior snapshot, not just-written
);
```

Two critical rules:
- **Strict `>`, not `>=`.** A tie doesn't replace the stored ghost (the old one is perfectly valid; no reason to churn). Identical to how `writeBest` behaves.
- **Snapshot BEFORE the write** and render against that. Otherwise, when the current run IS the new best, the "Best" strip shows the current run's events (identical to "This run") — useless comparison.

## Pattern — axis normalization

```js
const axisDur = Math.max(bestGhost.duration || 0, currentRun.duration || 0) || 1;
renderGhostOne(ghostSvgNow,  currentRun.events,  axisDur);
renderGhostOne(ghostSvgBest, bestGhost.events,   axisDur);
```

Use the longer of the two durations as the shared x-axis. Why:
- **Same-axis lets the player read pacing directly.** A dot at x=50 on "This run" lines up visually with x=50 on "Best" → same moment in time.
- **Dying early ≠ ran out of time.** If the current run ended at 30s and the best ran 80s, the "This run" strip's dots bunch on the left third — that's meaningful signal ("you didn't make it as far"), not a bug.
- **Fallback `|| 1`** prevents divide-by-zero on a 0-second run (shouldn't happen, but robust).

## Pattern — color by semantic, not theme

```js
const GHOST_COLOR = { p: '#5de4b4', g: '#ffd24a', m: '#ff3d6b' };
```

Perfect / good / miss are *gameplay-semantic* — they mean the same thing in every theme. Using hardcoded colors (not `var(--accent)` etc.) keeps the strip readable across theme swaps. A green dot always means "perfect" even in sunset mode where the ring is amber.

This is the inverse of `ambient-drift.md`'s theme-conditional approach: there the visual IS the theme signature, so it parametrizes; here the visual is the game state, which is theme-independent.

## Pattern — hide when noisy or irrelevant

```js
function renderGhost(currentRun, bestGhost) {
  if (GHOST_KEY === null || !bestGhost) {
    ghostEl.hidden = true;
    return;
  }
  ghostEl.hidden = false;
  // …
}
```

Hide conditions:
- **Free-play mode** — no ghost concept applies.
- **First visit to this seed** — no stored best yet. Don't show a "This run" strip alone because it's not a comparison, just a decoration.
- **(Optional) corrupted ghost data** — the defensive filter in `readGhost` returns an object with empty events. You could guard on `bestGhost.events.length > 0` too, but an empty Best strip is self-explanatory.

## Pattern — defensive readGhost validation

```js
function readGhost() {
  if (GHOST_KEY === null) return null;
  try {
    const raw = localStorage.getItem(GHOST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.events)) return null;
    parsed.events = parsed.events.filter(e =>
      Array.isArray(e) && typeof e[0] === 'number' && (e[1] === 'p' || e[1] === 'g' || e[1] === 'm')
    );
    return parsed;
  } catch { return null; }
}
```

localStorage is a hostile input — users edit it, other tabs write there, an older version of the game may have stored a different shape. The validator:
- **Rejects the whole object on bad shape** (missing events array).
- **Filters individual events** on bad shape rather than dropping the run entirely — one corrupt entry doesn't kill the strip.
- **Whitelists kinds** — a new kind added in a future version doesn't silently poison the current render.

## Rendering

A single `<svg>` per strip with:
1. **A thin baseline track** (`stroke: rgba(…, .14)`) — gives the dots a visual spine even when sparse.
2. **Circle dots at `cx = (t / axisDur) * innerW`** — inset by the dot radius on both sides so end-of-run dots aren't clipped.
3. **Inline `fill` attribute** (not CSS class + selector chain) — tiny XML string, easy to inspect in devtools, no cascading surprises.

Width 220 × height 10 reads as "sparkline" not "chart". Anything taller invites "so what data is this?" confusion. The label row handles context.

## Common mistakes

- **Recording events in free-play** — free-play events have no peer to compare against. Waste of storage and CPU. Early-return on `GHOST_KEY === null`.
- **Writing the ghost on every run, not just new bests** — the ghost would drift to your last run, not your best run. Violates the contract.
- **Using `>=` to write the ghost** — ties churn storage. Harmless functionally, but the leaderboard already handles tie visibility.
- **Rendering both strips against their own durations** — x-positions no longer align in time, the comparison becomes meaningless. Normalize to the longer axis.
- **Coloring dots with `var(--accent)`** — theme swap changes what "perfect" looks like in the strip. Use hardcoded semantic colors.
- **Persisting `state.runEvents` directly** instead of `.slice()` — if anything later mutates the array (a refactor, a debug tool), the stored ghost mutates with it. Snapshot at write-time.
- **Running the render every frame** — gameover UI only needs render once at gameover. The ghost data doesn't change during the overlay's lifetime.
- **Hiding the strip with `display: none` in CSS** when you want the ghost hidden. Use the `hidden` attribute — accessible to screen readers, works without CSS, consistent with the rest of the gameover overlay.
- **Reading ghost post-writeGhost when the current run was a new best** — both strips become identical. Snapshot BEFORE the write.

<!-- added: 2026-04-17 (001-void-pulse sprint 19) -->
