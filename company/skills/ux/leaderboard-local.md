# Skill — Local Top-N Leaderboard (Per-Seed)

**When to use:** any run-based game with a daily seeded mode. Best-only is too binary ("you got this score, you got it once"); a top-5 list gives the player 4 more "almost there" lines to chase, plus a clear "this run was your 3rd best" feedback that doesn't require beating the all-time best.

The combination is potent: the daily mode (skill: `gameplay/seeded-daily.md`) creates the recurring ritual; the top-5 turns each retry within a session into a measurable micro-goal — *can I knock off the 5th-place line?* That's worth ~3 extra retries per session in casual playtest.

## Pattern — store + insert + rank

```js
const LEADERBOARD_KEY = SEED !== null
  ? 'game-board-seed-' + SEED
  : 'game-board';
const LEADERBOARD_MAX = 5;

function readBoard() {
  try {
    const raw = localStorage.getItem(LEADERBOARD_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(e => e && typeof e.score === 'number' && typeof e.atMs === 'number')
      .slice(0, LEADERBOARD_MAX);
  } catch { return []; }
}
function writeBoard(arr) {
  try { localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(arr.slice(0, LEADERBOARD_MAX))); } catch {}
}

// Returns { board, rank }. rank is 1..N, or 0 if the score didn't make the cut.
function insertScore(score, atMs) {
  if (score <= 0) return { board: readBoard(), rank: 0 };
  const board = readBoard();
  const entry = { score, atMs };
  board.push(entry);
  board.sort((a, b) => b.score - a.score || a.atMs - b.atMs);   // tiebreak: earlier wins
  const trimmed = board.slice(0, LEADERBOARD_MAX);
  const rank = trimmed.indexOf(entry) + 1;
  writeBoard(trimmed);
  return { board: trimmed, rank };
}
```

Key choices:
- **Each entry has `atMs`**, not just score. The relative time ("yesterday", "2h ago") is half the storytelling — without it, a top-5 from 30 days ago feels like a wall the player can never climb.
- **Tiebreak: earlier `atMs` wins.** If the same score is achieved twice, the player keeps their original timestamp. Rewards "first achieved" and feels more honest.
- **Score 0 doesn't enter the board.** Otherwise an immediate-mistap on the first run leaves a 0 sitting at #5 forever.
- **Per-seed namespacing identical to `BEST_KEY`/`HISTORY_KEY`** (see `seeded-daily.md`) — daily and free-play maintain independent leaderboards.

## Pattern — relative-time formatter (coarse buckets)

```js
function formatRelative(atMs, now) {
  const diffMs = Math.max(0, now - atMs);
  if (diffMs < 60000) return 'just now';
  const min = Math.floor(diffMs / 60000);
  if (min < 60) return min + 'm ago';
  const at = new Date(atMs);
  const today = new Date(now);
  const sameDay = at.getFullYear() === today.getFullYear()
    && at.getMonth() === today.getMonth()
    && at.getDate() === today.getDate();
  if (sameDay) return Math.floor(min / 60) + 'h ago';
  const startOfTodayMs = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const startOfAtDayMs = new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
  const days = Math.round((startOfTodayMs - startOfAtDayMs) / 86400000);
  if (days === 1) return 'yesterday';
  if (days >= 30) return '30+d ago';
  return days + 'd ago';
}
```

Why coarse buckets and not "12s ago / 47s ago"?
- Precise seconds invite the player to compare exact times — irrelevant to gameplay
- Coarse grouping reads as a story ("yesterday I got 540, today my best is 410 — yesterday-me was sharp")
- Same-day is calendar-day, not 24h-rolling — matches the player's intuitive "today"

## Pattern — render with rank label + new-row highlight

```js
const RANK_LABELS = ['1st', '2nd', '3rd', '4th', '5th'];

function renderLeaderboard(board, highlightAtMs) {
  while (listEl.firstChild) listEl.removeChild(listEl.firstChild);
  if (!board.length) { wrapEl.hidden = true; return; }
  wrapEl.hidden = false;
  const now = Date.now();
  for (let i = 0; i < board.length; i++) {
    const e = board[i];
    const li = document.createElement('li');
    li.className = 'lb-row';
    if (highlightAtMs && e.atMs === highlightAtMs) li.classList.add('lb-new');
    if (i === 0) li.classList.add('lb-top');
    // ... rank, score, when spans ...
    listEl.appendChild(li);
  }
}
```

Visual rules:
- **`lb-top`** (rank 1) gets the gold-tint background even if it's not the just-set score
- **`lb-new`** (the just-set score, regardless of rank) gets the accent-color highlight + a one-shot pulse animation
- A row can be both **lb-top** AND **lb-new** if the player just set #1 — the lb-new rule wins (more recent context matters more)
- Empty board → hide the entire wrapper. Don't show "0 runs"

## When to render

- **At gameover** with the just-completed run inserted, highlight = run timestamp.
- **At init** (priming) with no highlight — so a player returning to the start screen sees their leaderboard if they had prior runs (in seeded mode, the gameover overlay would otherwise be the only place the leaderboard surfaces, but the player might want to see it on tab-return without playing).

## Storage size

Each entry is ~40 bytes JSON. 5 entries × ~365 daily seeds × ~40 bytes = ~73KB if a player plays every day for a year. Well under any localStorage quota (typically 5-10MB per origin). No pruning needed for a casual game lifecycle.

## Common mistakes

- **Storing only score, not `atMs`** — leaderboard becomes a leaderboard of strangers (no temporal context)
- **Sharing leaderboard across seeds** — daily score crowds out free-play, "best of yesterday" mixed with "best of last week's daily"
- **No `lb-new` highlight** — player can't find their just-set score in the list
- **Showing "0 runs" empty state** — empty leaderboard should be invisible, not a "you haven't played" guilt trip
- **Per-second "ago" precision** — invites comparison of trivia, distracts from the game
- **Tiebreak by latest-wins** — the more honest tiebreak is earliest-wins (rewards first achievement)
- **Pruning entries below score N** — store all top-N regardless of value; a top-5 of [12, 8, 6, 4, 2] is still a leaderboard. Prune by rank, not by threshold.

<!-- added: 2026-04-17 (001-void-pulse sprint 12) -->
