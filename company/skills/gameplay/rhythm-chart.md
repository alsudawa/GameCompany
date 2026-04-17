# Skill — Fixed BPM Rhythm Chart

<!-- added: 2026-04-17 (001-void-pulse, sprint 29–30) -->

**When to use:** you want a casual game with the **compare-your-best-on-a-fixed-song** loop — every run is the same chart, the player learns it, optimizes, chases 100%. This is the alternative to a difficulty-ramp-forever model; the chart itself is the challenge, and repetition is a feature.

Pairs with:
- `audio/synced-bgm.md` — music locked to the same grid
- `gameplay/reactive-hazard.md` — don't-tap events woven into the chart
- `ux/retention.md` — `score / maxPossibleScore × 100` is the retention hook

## Contract

- **Fixed BPM, fixed bar count.** Chart length is known at build time. Score is scored against a known max, not an unbounded "how far did you get."
- **Deterministic templates.** Each difficulty band has a pool of 3–5 one-bar templates; the seeded RNG picks per bar. Same seed = same chart.
- **Downbeats always populated.** Every bar starts with a note (not a hazard). This is the "pulse" the player anchors on.
- **Rests on weak subdivisions.** Empty slots fall on the 3rd/7th eighth, not the 1st/5th.
- **Back-calculate spawn from arrival.** The chart expresses *when the note should be acted on* (arriveT). The spawn-time is derived from the pulse's travel speed so ring-cross lands exactly on beat: `spawnT = arriveT - (TARGET_R / speed)`.
- **Exact max-score simulation.** `maxPossibleScore` is computed by walking the chart applying the real combo-multiplier ramp — not an optimistic upper bound. 100% must be literally achievable.

## Pattern — constants block

```js
const BPM = 120;
const BEAT_MS = 60000 / BPM;          // 500ms per quarter
const EIGHTH_MS = BEAT_MS / 2;         // 250ms slot
const BARS = 30;
const SLOTS_PER_BAR = 8;
const CHART_LEAD_IN_S = 1.0;           // blank bars before first note so the
                                       //  opener has a clean travel animation
const CHART_LENGTH_S = (BARS * SLOTS_PER_BAR * EIGHTH_MS) / 1000 + CHART_LEAD_IN_S;
```

## Pattern — templates + band schedule

```js
// N = normal tap, H = hazard (don't tap), _ = rest
const BAR_TEMPLATES = {
  warm:  [
    ['N','_','_','_','N','_','_','_'],
    ['N','_','_','_','N','_','N','_'],
  ],
  easy:  [ /* quarter-note pulse, max 1 hazard per bar, late slots only */ ],
  mid:   [ /* 8th-note density, hazards always preceded by a rest (telegraph) */ ],
  hard:  [ /* syncopation, max 2 hazards/bar, never back-to-back */ ],
  climax:[ /* peak tension — but always ≥1 rest slot for visual re-sync */ ],
  out:   [ /* fade — sparse normal notes, no hazards (the finish line) */ ],
};
const BAND_SPEED = { warm: 300, easy: 340, mid: 400, hard: 460, climax: 495, out: 380 };
const BAND_SCHEDULE = [
  'warm','warm','warm',
  'easy','easy','easy','easy','easy','easy',
  'mid','mid','mid','mid','mid','mid','mid','mid',
  'hard','hard','hard','hard','hard','hard',
  'climax','climax','climax','climax',
  'out','out','out',
];   // length === BARS
```

## Pattern — chart generator (exact-max simulation)

```js
function generateChart() {
  const events = [];
  for (let bar = 0; bar < BARS; bar++) {
    const band = BAND_SCHEDULE[bar];
    const tmpl = BAR_TEMPLATES[band][Math.floor(rng() * BAR_TEMPLATES[band].length)];
    const barStartMs = bar * SLOTS_PER_BAR * EIGHTH_MS;
    const speed = BAND_SPEED[band];
    for (let slot = 0; slot < SLOTS_PER_BAR; slot++) {
      const c = tmpl[slot];
      if (c === '_') continue;
      const arriveT = (barStartMs + slot * EIGHTH_MS) / 1000 + CHART_LEAD_IN_S;
      events.push({ arriveT, kind: c === 'H' ? 'h' : 'n', speed, accent: slot === 0 });
    }
  }
  // Exact max: simulate a perfect run through the combo-multiplier ramp.
  let maxScore = 0, comboSim = 0;
  for (const ev of events) {
    if (ev.kind === 'n') {
      const mult = Math.min(COMBO_MULT_MAX, 1 + Math.floor(comboSim / COMBO_STEP) * 0.5);
      maxScore += 100 * mult;
      comboSim += 1;
    } else {
      maxScore += HAZARD_PASS_BONUS;
    }
  }
  return { events, maxScore: Math.round(maxScore) };
}
```

## Pattern — spawn dispatcher in the update loop

```js
if (!state.deathCam && state.chart) {
  while (state.chartIdx < state.chart.length) {
    const ev = state.chart[state.chartIdx];
    const leadS = TARGET_R / ev.speed;     // how long the pulse needs to travel
    if (state.t >= ev.arriveT - leadS) {
      spawnChartPulse(ev);
      state.chartIdx += 1;
    } else {
      break;                                // events are arriveT-sorted
    }
  }
  if (!state.chartDone && state.chartIdx >= state.chart.length) {
    state.chartDone = true;
  }
}
```

## Pattern — gameover shows `score + % of max`

```js
const pct = state.maxPossibleScore > 0
  ? Math.round((state.score / state.maxPossibleScore) * 100)
  : 0;
finalScoreEl.textContent = state.score + ' · ' + pct + '%';
```

## Tuning the ramp

**Rule of thumb — the easy→mid transition is the single most important point.** Too aggressive there and players check out shortly after "this looked manageable a second ago." Keep easy for 5–6 bars. Mid should ADD density (more 8ths) but NOT add dangerous patterns; save those for hard.

**Climax must be shorter than you think.** 4 bars is plenty. After 5+ bars of peak density the player is exhausted and score is largely decided. A short climax with a recognizable outro lets the player "land" the run with dignity.

**Speed is a second knob.** Don't rely only on density. Bumping speed compresses the react window without changing the beat grid — useful for the climax band.

## Schema versioning for scoring changes

Bump a `SCHEMA_VERSION` constant whenever the chart or scoring model changes. On load, wipe all `*-best-*` and `*-history-*` localStorage keys if the stored version is lower. This prevents old best scores (computed under a different maxPossibleScore) from looking permanently unbeatable or trivially beatable.

```js
const SCHEMA_VERSION = 2;
const SCHEMA_KEY = 'game-schema-v';
(function migrateSchema() {
  const stored = parseInt(localStorage.getItem(SCHEMA_KEY) || '0', 10);
  if (stored < SCHEMA_VERSION) {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (k.includes('-best') || k.includes('-history') || k.includes('-board-') || k.includes('-ghost-')) {
        localStorage.removeItem(k);
      }
    }
    localStorage.setItem(SCHEMA_KEY, String(SCHEMA_VERSION));
  }
})();
```

Bump the version on:
- Any change to `BAR_TEMPLATES`, `BAND_SCHEDULE`, `BAND_SPEED`, `COMBO_MULT_MAX`, `COMBO_STEP`, `HAZARD_PASS_BONUS`.
- Any change to the exact-max simulation formula.

Do NOT bump for pure visual or audio changes.

## When NOT to use

- **Endless / score-chase mode is the core fantasy** — rhythm chart gives a hard cap on score; if players wants "go forever" this kills the fun.
- **Random music** — if music is user-supplied or auto-generated from BPM-analysis of arbitrary tracks, charts won't align.
- **Very short sessions (<15s)** — overhead of chart + lead-in not worth it; a 3-pulse tutorial-like burst is sufficient.

## Why this works as a retention loop

1. First run: "what even is this" — player absorbs the pattern.
2. Run 5: player recognizes the mid-to-hard transition and knows which slots reward eagerness.
3. Run 15: player has a mental map of hazards; the score is now a function of precision on perfects, not chart knowledge.
4. Run 30+: chasing 100% — minutes-per-percent grind.

Each run is a bounded 60–90 second commitment, and "one more try" is easier to justify than "open-ended score push" because there's a known ceiling. See `ux/retention.md` for the NEW-BEST gating that reinforces this.
