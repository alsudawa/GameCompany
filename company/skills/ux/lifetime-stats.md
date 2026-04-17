# Skill — Lifetime Stats Panel

**When to use:** a game with enough retention signal to warrant a long-arc view. Per-run gameover stats (peak combo, perfects, hits) answer "how did I do *this* run"; lifetime stats answer "how invested am I?" and "have I improved?". The panel becomes a returning-player pull: the numbers grow every session, creating a visible progression axis that per-run UIs can't show.

Do *not* ship lifetime stats before the core loop is solid — if the player isn't coming back anyway, lifetime counters are noise. It's a sprint-6+ feature, not a sprint-1 feature.

## Pattern — single JSON blob with default-fill reads

```js
const LIFETIME_KEY = 'void-pulse-lifetime';

function lifetimeDefaults() {
  return {
    runs: 0,
    totalScore: 0,
    totalPerfects: 0,
    totalHits: 0,
    totalMisses: 0,
    totalSeconds: 0,
    peakComboEver: 0,
    bestScoreEver: 0,
    bestPerTheme: { void: 0, sunset: 0, forest: 0 },
    firstPlayedAt: 0,
    lastPlayedAt: 0,
  };
}

function readLifetime() {
  const def = lifetimeDefaults();
  try {
    const raw = localStorage.getItem(LIFETIME_KEY);
    if (!raw) return def;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return def;
    const out = { ...def, ...parsed };
    for (const k of ['runs','totalScore','totalPerfects','totalHits','totalMisses','totalSeconds','peakComboEver','bestScoreEver','firstPlayedAt','lastPlayedAt']) {
      out[k] = Math.max(0, +out[k] || 0);
    }
    out.bestPerTheme = { ...def.bestPerTheme, ...(parsed.bestPerTheme || {}) };
    for (const t of Object.keys(out.bestPerTheme)) {
      out.bestPerTheme[t] = Math.max(0, +out.bestPerTheme[t] || 0);
    }
    return out;
  } catch { return def; }
}
```

Key design decisions:
- **One blob, not one key per field** — atomic read/write, no cross-field race. localStorage `JSON.parse` once per panel-open is fast (µs-level for <1KB payloads).
- **Defaults fill missing keys** — adding a new stat in sprint N+1 doesn't need a migration; old stored blobs just get the new key merged in on the next read. Forward-compatible by construction.
- **Numeric coerce with `+out[k] || 0`** — tampered-data safety; a bad string in storage won't crash the UI.
- **Negative clamp** — `Math.max(0, ...)` — a glitch that decrements into negatives would be alarming ("−12 runs?"); clamping hides it rather than surfacing a spooky number.
- **Nested merge for nested objects** — `bestPerTheme` has keys per theme; future themes get 0-filled without touching old entries.

## Pattern — one bump per gameover

```js
function bumpLifetime(run) {
  const l = readLifetime();
  const now = Date.now();
  l.runs += 1;
  l.totalScore    += run.score;
  l.totalPerfects += run.perfects;
  l.totalHits     += run.hits;
  l.totalMisses   += run.misses;
  l.totalSeconds  += run.seconds;
  l.peakComboEver = Math.max(l.peakComboEver, run.peakCombo);
  l.bestScoreEver = Math.max(l.bestScoreEver, run.score);
  if (run.theme && l.bestPerTheme[run.theme] !== undefined) {
    l.bestPerTheme[run.theme] = Math.max(l.bestPerTheme[run.theme], run.score);
  }
  if (!l.firstPlayedAt) l.firstPlayedAt = now;
  l.lastPlayedAt = now;
  writeLifetime(l);
  return l;
}

// Caller — in gameover():
if (state.score > 0 || state.t >= 3) {
  bumpLifetime({ ... });
}
```

Rules of thumb:
- **Call exactly once per run**, at gameover. Never at checkpoints — double-counting is the #1 bug in lifetime counters.
- **Gate on "real run"** — skip 0-score < 3s runs (accidental starts, reload-during-start). Without the gate, a player who reloads 20 times before playing has `runs: 20, totalScore: 0`, which looks broken.
- **Both daily and free-play count** — lifetime is cross-mode. Excluding daily is a value judgment the player didn't sign up for.
- **Theme argument read once** — pass `currentTheme` in the run payload rather than reading it inside `bumpLifetime`, so the bump is a pure function of its input.
- **Monotonic max for `peakComboEver` / `bestScoreEver`** — these can never decrease. If you ever want "best of last N days", that's a different stat with its own key.

## Pattern — panel UI with clear grouping

```
Lifetime stats
━━━━━━━━━━━━
Runs                  34
Total play            42m 15s
Best score            3200
Peak combo            68
Avg / run             1050
Total score           35,700
Perfects              842
Hits                  1204
Misses                122
Perfect rate          69.9%
Accuracy              90.8%
Best by theme         ◉ void 3200  ◉ sunset 2100  ◉ forest 1850
First played          Mar 14, 2026
Last played           Apr 17, 2026
    [Reset stats]              [Close]
```

Groupings (top → bottom, visual priority):
1. **Volume** — Runs, Total play: "how invested am I?"
2. **Peaks** — Best score, Peak combo: "what's my ceiling?"
3. **Averages** — Avg / run: "what's my typical output?"
4. **Totals** — Total score, Perfects, Hits, Misses: "cumulative labor"
5. **Rates** — Perfect rate, Accuracy: "quality axis"
6. **Segments** — Best by theme: horizontal bar with color-coded dots; lets players see which palette they're best at
7. **Timestamps** — First / Last: "when did I start", "am I still playing"

Why this order: visit-invested players care about volume first; peak-chasers care about personal bests; improvers care about rates. Putting rates *after* absolute counts prevents the common "0 perfects / 0 hits = ∞%" visual bug — the denominator is visible directly above.

## Pattern — percent formatting with `—` dash fallback

```js
function formatPercent(num, denom) {
  if (!denom) return '—';
  const p = (num / denom) * 100;
  return p >= 99.95 ? '100%' : p.toFixed(1) + '%';
}
```

- **Zero denominator → em-dash**, not `0%` or `NaN%`. A first-time panel-opener sees `—` on the rate row, not a bug-looking zero.
- **Clamp to `100%`** — `(1204 / 1204 * 100).toFixed(1)` is `'100.0%'` which is fine, but a floating-point drift like `99.97%` rounds up to `100.0%`; round-at-99.95 gives a cleaner "100%" label for perfect players.
- **One decimal** — `.toFixed(1)` — more precision reads as false exactness for a game counter. "89.2%" is honest; "89.18432%" is noise.

## Pattern — time formatting with three tiers

```js
function formatDuration(seconds) {
  seconds = Math.max(0, Math.floor(seconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return h + 'h ' + m + 'm';
  if (m > 0) return m + 'm ' + s + 's';
  return s + 's';
}
```

- **Elide smaller unit at higher tiers** — `2h 15m` not `2h 15m 22s`; at hours-scale the seconds are noise.
- **Floor, not round** — "how much time have I actually put in" should be a lower bound, not a rounded-up guess.
- **No leading zeros** — `5m 3s` not `05m 03s`; this is a human-facing label, not a timer display.

## Pattern — two-step reset with auto-disarm

```js
let armedAt = 0;
statsReset.addEventListener('click', (e) => {
  const now = performance.now();
  if (armedAt && now - armedAt < 4000) {
    resetLifetime();
    armedAt = 0;
    statsReset.textContent = 'Reset stats';
    statsReset.classList.remove('armed');
    renderStats();
  } else {
    armedAt = now;
    statsReset.classList.add('armed');
    statsReset.textContent = 'Tap again to confirm';
    setTimeout(() => {
      if (statsReset.classList.contains('armed')) {
        statsReset.classList.remove('armed');
        statsReset.textContent = 'Reset stats';
        armedAt = 0;
      }
    }, 4000);
  }
});
```

Why two-step:
- **Stats are hard-earned** — an accidental reset erases months of play. Single-click with a `confirm()` would be OK, but native `confirm()` is heavyweight for a casual game overlay.
- **Armed state visible** — `.armed` class changes color + adds a pulse; the button itself communicates that it's about to destroy data.
- **Auto-disarm after 4s** — prevents "armed forever" bugs where the player opens the panel, accidentally hits reset once, closes, comes back hours later, hits reset again, and loses everything. 4s is long enough to double-tap, short enough that abandoned arms don't persist.
- **Hidden until data exists** — `empty: l.runs === 0 → statsReset.hidden = true`. No point showing reset for an empty slate.

## Pattern — empty-state with actionable message

```html
<div id="statsPanel" class="stats-overlay hidden">
  <div class="stats-card">
    <h2>Lifetime stats</h2>
    <p class="stats-empty-msg">No runs yet. Play one to start tracking.</p>
    <div class="stats-grid">…</div>
  </div>
</div>
```

```css
.stats-empty-msg { display: none; }
.stats-overlay.stats-empty .stats-empty-msg { display: block; }
.stats-overlay.stats-empty .stats-grid { opacity: .35; }
```

- **Wall of zeros is bleak** — a fresh player seeing `Runs: 0 | Total: 0s | Best: 0 …` feels like they're behind. The empty state tells them they just need to play.
- **Keep the grid visible at 35% opacity** — so the *shape* of the panel is visible; the player sees what they're working toward. Hiding the grid entirely would hide the promise.
- **Message is actionable, not apologetic** — "No runs yet. Play one to start tracking." is better than "No data available." The first invites action; the second signals absence.

## Pattern — open/close parity with the help modal

Use the same overlay pattern you already have for help: `.hidden` / `.visible` class toggle, `.stats-overlay` with backdrop-blur, auto-pause a live run, restore bus state on close. New concerns are limited to the data-specific bits (rendering, reset), so the affordance framework stays consistent across all your modals.

```js
function openStats() {
  if (!statsEl.classList.contains('hidden')) return;
  statsOpenedDuringRun = state.running && !state.over && !state.paused;
  if (statsOpenedDuringRun) pauseGame();
  renderStats();
  statsEl.classList.remove('hidden');
  statsEl.classList.add('visible');
  statsEl.setAttribute('aria-hidden', 'false');
  statsClose.focus();
  Sfx.setBus('duck');
}
```

`renderStats()` runs on every open (not on init) so the panel always reflects the latest blob. The data cost is one localStorage read + ~15 `textContent` writes — free even on mid-range mobile.

## Common mistakes

- **Tracking per-session instead of lifetime** — a "session" depends on tab lifecycle; lifetime uses localStorage and survives reloads. Players expect lifetime.
- **Writing on every score event** — creates write amplification + races. One write per gameover is all you need.
- **Not gating on "real run"** — accidental reloads pollute the counter. Min-score or min-duration gate is essential.
- **Storing rates instead of counts** — "perfect rate" should be *derived* from totalPerfects / totalHits at render time, not stored. Storing the rate creates impossible states (99.8% but runs = 0).
- **Showing wall-of-zeros empty state** — use an empty-state message with a clear action.
- **Single-click reset** — irreversible + accidental-tap-friendly = regret. Two-step with auto-disarm.
- **Per-theme trackers without bestPerTheme merge** — adding a new theme later requires a migration if you stored per-theme as fixed keys. Using a nested object + default merge (see above) makes new themes zero-cost.
- **Tracking daily-only or free-only** — the player doesn't think about game mode when they think "how much have I played this game?". Count both.
- **No close-focus management** — open panel → focus on close button; Esc closes. Without this, keyboard users can't escape the panel.
- **Updating stats on *start* instead of on *gameover*** — if the player alt-F4s mid-run, the run is lost from the counter. Gameover is the only reliable commit point.

<!-- added: 2026-04-17 (001-void-pulse sprint 26) -->
