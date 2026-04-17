// ============================================================
// void-pulse — GameCompany 001
// Tap the ring when a void pulse expands through it.
// ============================================================
(() => {
  'use strict';

  // ---------- 1. Constants (tunables) ----------
  const W = 720, H = 960;
  const CENTER_X = W / 2;
  const CENTER_Y = H / 2;
  const TARGET_R = 260;

  const FIXED_DT = 1 / 60;
  const MAX_DT   = 1 / 30;

  // Time-based judge windows (ms). Decouples difficulty from pulse speed so
  // the human-timing window stays constant as speed ramps up.
  const PERFECT_WINDOW_MS_BASE = 55;
  const PERFECT_WINDOW_MS_MAX  = 80;
  const GOOD_WINDOW_MS         = 130;
  const TENSION_LEAD_MS        = 180;  // how early the target ring telegraphs an arrival
  const GRACE_START_T = 120;            // seconds before perfect window starts widening

  const STARTING_LIVES = 3;
  const TAP_DEBOUNCE_MS = 120;
  const GAMEOVER_LOCKOUT_MS = 400;
  const ONBOARDING_T = 5;               // seconds of softer ramp for first-timers
  const EARLY_TAP_LEAD_MS = 300;         // taps within 300ms of arrival are swallowed, not missed
  const MASTER_GAIN = 0.55;
  const RESUME_COUNTDOWN_MS = 3000;     // 3-2-1 before play resumes after tab return
  const RUN_HISTORY_CAP = 8;             // last-N runs kept for sparkline
  const DEATHCAM_DURATION_S = 0.55;     // slow-mo before gameover overlay fades in
  const DEATHCAM_TIME_SCALE = 0.22;     // world advances at 22% speed during slow-mo
  // Anti-frustration: if a player dies fast N times in a row, next run grants
  // one sympathy life. Detects "rage-retry" without interrupting the loop.
  const RAGE_DURATION_S  = 15;          // "fast" = died in under 15s
  const RAGE_REQUIRED    = 3;           // this many quick deaths in a row
  const BONUS_LIFE_MAX   = 1;           // cap so it can't stack forever

  const PULSE_POOL_SIZE = 32;
  const PARTICLE_CAP = 256;

  const HEARTBEAT_INTERVAL = 5;
  const HEARTBEAT_BONUS    = 1.5;
  const COMBO_STEP = 5;
  const COMBO_MULT_MAX = 4;

  // ---------- Rhythm chart (Sprint 29 pivot) ----------
  // Replaces the old linear speedAt/gapAt ramp with a pre-composed, seeded
  // 60-second chart laid out on an 8th-note grid at 120 BPM. Each bar is
  // 8 slots (4 beats × 2 eighths). The generator escalates difficulty in
  // 5 bands so the opening starts at moderate intensity (no ramp-in) and
  // climaxes before the fade-out bars. Pulses are described by `arriveT`
  // (when the ring should judge the tap) — the spawner back-calculates the
  // actual spawn time from pulse speed so ring-cross lands exactly on beat.
  const BPM = 120;
  const BEAT_MS = 60000 / BPM;          // 500ms per quarter at 120 BPM
  const EIGHTH_MS = BEAT_MS / 2;         // 250ms slot
  const BARS = 30;
  const SLOTS_PER_BAR = 8;
  // Lead-in before the first pulse arrives. 2 beats = 1.0s at 120 BPM — long
  // enough that the opening pulse has a clean travel animation from r=0 (not
  // a frame-one pop), short enough that the player isn't staring at an empty
  // ring for a "get ready" phase. The chart still starts at t=0 — we just
  // offset every arriveT by this much during generation.
  const CHART_LEAD_IN_S = 1.0;
  const CHART_LENGTH_S = (BARS * SLOTS_PER_BAR * EIGHTH_MS) / 1000 + CHART_LEAD_IN_S;  // 61s
  const HAZARD_PASS_BONUS = 50;
  const HAZARD_TAP_PENALTY = 100;        // score debit when tapping a hazard (on top of life loss)
  // Pre-composed bar templates. 'N' = normal pulse, 'H' = hazard (do NOT tap),
  // '_' = rest. Eight 8th-note slots per bar. Hand-tuned to feel musical:
  // downbeats always have a note (no empty bar starts), rests fall on weak
  // subdivisions, hazards are placed where a "reflex" tap is tempting.
  // Bar template library. 'N' = normal pulse, 'H' = hazard (do NOT tap),
  // '_' = rest. Eight 8th-note slots per bar. Tuned so density & hazard
  // frequency escalate musically without overwhelming: downbeats always carry
  // a note, hazards sit on weak or tempting-to-reflex slots, each band leaves
  // breath-room so the player can parse the pattern.
  //
  // Sprint 30 tuning: pulled hazard density down in mid/hard, inserted extra
  // rest slots in climax, and added an extra template per band so repetition
  // feels fresh. Goal: user reported "정신없이" (overwhelming) shortly past the
  // opening — the ramp now stays readable deeper into the run.
  const BAR_TEMPLATES = {
    warm:  [  // establishes rhythm, no hazards, wide gaps
      ['N','_','_','_','N','_','_','_'],
      ['N','_','_','_','N','_','N','_'],
      ['N','_','N','_','N','_','_','_'],
    ],
    easy:  [  // quarter-note pulse, at most one hazard per bar, always late slot
      ['N','_','N','_','N','_','N','_'],
      ['N','_','N','_','N','_','N','H'],
      ['N','_','N','_','N','_','_','H'],
      ['N','_','N','_','N','H','N','_'],
    ],
    mid:   [  // 8th-note density; hazards always preceded by a rest (telegraph)
      ['N','_','N','_','N','_','N','H'],
      ['N','_','N','H','N','_','N','_'],
      ['N','N','_','_','N','_','N','H'],
      ['N','_','N','_','N','H','_','N'],
      ['N','_','_','H','N','_','N','H'],
    ],
    hard:  [  // syncopation, max 2 hazards/bar, never back-to-back
      ['N','_','N','H','N','_','N','H'],
      ['N','H','N','_','N','_','H','N'],
      ['N','_','H','_','N','H','N','N'],
      ['N','N','_','H','N','_','H','_'],
    ],
    climax:[  // tension peak — but always a rest slot to re-sync vision
      ['N','H','N','_','N','H','N','_'],
      ['N','_','H','N','N','H','_','N'],
      ['H','_','N','H','N','_','N','H'],
      ['N','H','N','_','H','N','_','N'],
    ],
    out:   [  // fade — sparse normal notes, no hazards (finish line)
      ['N','_','_','_','N','_','_','_'],
      ['N','_','_','_','_','_','N','_'],
      ['N','_','N','_','_','_','_','_'],
    ],
  };
  // Speed per difficulty band — controls ring travel time, which affects
  // react-window size. Faster speeds on harder bars compress decision time
  // without changing the beat grid (pulses still arrive ON the beat). Sprint
  // 30: dropped climax from 540 → 495 so the peak bars stay readable.
  const BAND_SPEED = { warm: 300, easy: 340, mid: 400, hard: 460, climax: 495, out: 380 };
  // Bar-by-bar difficulty band assignment. Length must equal BARS.
  // Sprint 30 reshape: stretched warm (2→3) and easy (4→6), trimmed hard
  // (8→6) and climax (6→4), extended out (2→3). Total stays 30 bars ~60s but
  // the player now has longer to read the grid before density ramps.
  const BAND_SCHEDULE = [
    'warm','warm','warm',
    'easy','easy','easy','easy','easy','easy',
    'mid','mid','mid','mid','mid','mid','mid','mid',
    'hard','hard','hard','hard','hard','hard',
    'climax','climax','climax','climax',
    'out','out','out',
  ];

  // Schema version — bump when scoring model changes so old bests (which
  // are unreachable under the new rules) are cleared rather than looking
  // permanently unbeatable. Lifetime totals (runs, time) survive.
  const SCHEMA_VERSION = 2;
  const SCHEMA_KEY = 'void-pulse-schema';

  // Render-cache constants — pre-allocated objects reused every frame to keep
  // GC pressure off the hot path. Vignette opacity has 6 distinct values
  // bucketed by combo heat; reusing one CanvasGradient per bucket avoids
  // allocating a new gradient every frame.
  const VIGNETTE_BUCKETS = 6;
  const vignetteCache = new Array(VIGNETTE_BUCKETS);
  const HEARTBEAT_DASH = [14, 8];
  const NO_DASH = [];

  // Adaptive quality — sample the first ~60 render frames; if median dt > 22ms
  // (under ~45fps), drop the starfield to lighten the per-frame fillRect count.
  const ADAPTIVE_SAMPLE_FRAMES = 60;
  const ADAPTIVE_BUDGET_MS = 22;
  const dtSamples = new Float32Array(ADAPTIVE_SAMPLE_FRAMES);
  let dtSampleIdx = 0;
  let dtSamplesFull = false;
  let renderStarfield = true;

  // Dev FPS overlay (?fps=1)
  const SHOW_FPS = (() => {
    try { return new URLSearchParams(location.search).get('fps') === '1'; } catch { return false; }
  })();

  // ---------- Seeded RNG (for daily challenge) ----------
  // mulberry32 — small, fast, good distribution for casual-game RNG.
  // Deterministic per seed so `?seed=20260417` always produces the same
  // spawn sequence → players can compare scores on the same run.
  function makeRng(seed) {
    let a = seed >>> 0;
    return function() {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function todayYyyymmdd() {
    const d = new Date();
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  }
  function formatSeedLabel(seed) {
    const s = String(seed);
    if (/^\d{8}$/.test(s)) return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8);
    return s;
  }
  // Parse seed from URL. `?seed=20260417` = explicit; `?daily=1` or
  // `?seed=daily` = today's YYYYMMDD. Invalid/missing = null → free play.
  function parseSeedFromUrl() {
    try {
      const params = new URLSearchParams(location.search);
      const raw = params.get('seed');
      const dailyFlag = params.get('daily');
      if (raw === 'daily' || dailyFlag === '1') return todayYyyymmdd();
      if (raw && /^\d+$/.test(raw)) return parseInt(raw, 10) | 0;
    } catch {}
    return null;
  }
  const SEED = parseSeedFromUrl();
  // In seeded mode, `rng` is reset at the start of every run so each retry
  // produces the exact same spawn sequence. In free play, `rng` is Math.random
  // and no reset is needed.
  let rng = SEED !== null ? makeRng(SEED) : Math.random;
  function resetRng() {
    if (SEED !== null) rng = makeRng(SEED);
  }
  // Best is namespaced per-seed: daily challenges have their own leaderboard
  // independent of free-play best. Free-play uses the original key.
  const BEST_KEY = SEED !== null ? 'void-pulse-best-seed-' + SEED : 'void-pulse-best';
  // Same story for run history — daily progression is per-seed so the
  // sparkline shows "how I'm doing on THIS daily", not mixed with free-play.
  const HISTORY_KEY = SEED !== null ? 'void-pulse-history-seed-' + SEED : 'void-pulse-history';
  const LEADERBOARD_KEY = SEED !== null ? 'void-pulse-board-seed-' + SEED : 'void-pulse-board';
  const LEADERBOARD_MAX = 5;
  // Ghost (best-run timeline) is only meaningful when a seed fixes the
  // spawn sequence — otherwise "your pacing vs. best" is apples-to-oranges.
  const GHOST_KEY = SEED !== null ? 'void-pulse-ghost-seed-' + SEED : null;
  const GHOST_EVENT_CAP = 240;
  // Lifetime stats — cross-mode, cross-theme aggregate. Tracks totals that
  // no per-run UI surfaces (runs played, total play time, rate stats). Stored
  // as a single JSON blob for atomic read/write; defaults fill in for any
  // missing key so forward-adds don't need migrations.
  const LIFETIME_KEY = 'void-pulse-lifetime';

  // Schema version migration. Sprint 29 flipped the scoring model from
  // endless-ramp to fixed-chart; old scores are trivially unbeatable under
  // the new rules, so wipe them once on upgrade to give players a fair
  // "new best" moment. Lifetime aggregates (runs, totalSeconds) stay —
  // they measure activity, not skill peak.
  (function migrateSchema() {
    try {
      const stored = localStorage.getItem(SCHEMA_KEY);
      const v = stored ? parseInt(stored, 10) : 0;
      if (v < SCHEMA_VERSION) {
        // Wipe anything that keys "best score" — per-seed leaderboards too.
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const k = localStorage.key(i);
          if (!k) continue;
          if (k === 'void-pulse-best' ||
              k.indexOf('void-pulse-best-seed-') === 0 ||
              k === 'void-pulse-history' ||
              k.indexOf('void-pulse-history-seed-') === 0 ||
              k.indexOf('void-pulse-board-seed-') === 0 ||
              k.indexOf('void-pulse-ghost-seed-') === 0) {
            localStorage.removeItem(k);
          }
        }
        // Reset lifetime bestScoreEver / bestPerTheme to zero but keep run
        // counts; we read-modify-write the one JSON blob.
        try {
          const rawLife = localStorage.getItem(LIFETIME_KEY);
          if (rawLife) {
            const life = JSON.parse(rawLife);
            if (life && typeof life === 'object') {
              life.bestScoreEver = 0;
              life.peakComboEver = 0;
              life.bestPerTheme = { void: 0, sunset: 0, forest: 0 };
              localStorage.setItem(LIFETIME_KEY, JSON.stringify(life));
            }
          }
        } catch {}
        localStorage.setItem(SCHEMA_KEY, String(SCHEMA_VERSION));
      }
    } catch {}
  })();

  // ---------- 2. State ----------
  const state = {
    running: false,
    over: false,
    t: 0,
    score: 0,
    best: readBest(),
    combo: 0,
    lives: STARTING_LIVES,
    pulsesSpawned: 0,
    nextSpawnAt: 0,
    chart: null,            // array of {arriveT, kind, speed, accent} for this run
    chartIdx: 0,             // next unspawned chart event
    maxPossibleScore: 0,     // theoretical max for this chart (for gameover %)
    hazardPassed: 0,          // count of hazards successfully dodged this run
    chartDone: false,         // true once last chart event has been spawned
    lastTapMs: 0,
    gameoverAtMs: 0,
    muted: readMuted(),
    // run stats
    peakCombo: 0,
    perfectCount: 0,
    hitCount: 0,
    missCount: 0,                // per-run miss tally; used by flawless/purity achievements
    newBestThisRun: false,
    // Ghost-run recorder: compact `[t, kind]` tuples (kind ∈ 'p' | 'g' | 'm').
    // Cleared at start(), capped at GHOST_EVENT_CAP to guard a runaway session.
    runEvents: [],
    bonusLifeGranted: false,
    // death-cam (slow-mo on fatal miss before the gameover overlay shows)
    deathCam: false,
    deathCamT: 0,
    // pause / resume
    paused: false,
    resumeAt: 0,     // performance.now() ms when countdown ends; 0 while paused-indefinitely
    // fx timers
    targetPopT: 0,
    shakeT: 0,
    comboMilestoneText: '',
    comboMilestoneFade: 0,
    tensionFlash: false,
    // Juice — Sprint 29. `perfectFlashT` drives the chromatic-aberration
    // ring redraw on the target (cyan/magenta/yellow triple-offset for ~8
    // frames). `comboBloomT` drives the fullscreen radial flash at ×5 combo
    // milestones. `hazardHitT` / `hazardClearT` drive short-lived color
    // accents on the target ring when the player (mis)handles a hazard.
    perfectFlashT: 0,
    comboBloomT: 0,
    hazardHitT: 0,
    hazardClearT: 0,
  };

  const pulses = [];
  for (let i = 0; i < PULSE_POOL_SIZE; i++) {
    pulses.push({ active: false, r: 0, prevR: 0, speed: 0, heartbeat: false, bornT: 0, kind: 'n' });
  }

  // Pre-generated starfield backdrop for subtle texture — zero-allocation render.
  const STAR_COUNT = 40;
  const stars = [];
  for (let i = 0; i < STAR_COUNT; i++) {
    stars.push({
      x: Math.random() * W,
      y: Math.random() * H,
      size: 1 + Math.random() * 1.4,
      phase: Math.random() * Math.PI * 2,
    });
  }

  // Detect reduced motion once — used to gate haptics + anim-heavy effects
  // beyond what CSS @media (prefers-reduced-motion) already disables.
  const reducedMotion = typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function haptic(ms) {
    if (reducedMotion) return;
    if (navigator.vibrate) navigator.vibrate(ms);
  }

  const particles = [];
  for (let i = 0; i < PARTICLE_CAP; i++) {
    particles.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 0, color: '#fff', size: 4 });
  }

  // Ambient drift — a theme-signature layer of slowly-moving decorative
  // particles. Void keeps its starfield only; sunset adds rising embers,
  // forest adds falling petals. Fixed pool, no allocations after init —
  // particles simply wrap around the viewport instead of dying.
  // Power-save hint: if the user has opted into Save Data or
  // prefers-reduced-data, halve the pool. These users are signalling
  // "I'd like less incidental work"; the theme signature still shows
  // through at 10 particles, just sparser.
  const POWER_SAVE = (() => {
    try {
      if (navigator.connection && navigator.connection.saveData) return true;
      if (window.matchMedia && window.matchMedia('(prefers-reduced-data: reduce)').matches) return true;
    } catch {}
    return false;
  })();
  const AMBIENT_CAP = POWER_SAVE ? 10 : 20;
  const ambient = [];
  for (let i = 0; i < AMBIENT_CAP; i++) {
    ambient.push({
      x: Math.random() * W,
      y: Math.random() * H,
      size: 1.2 + Math.random() * 1.8,
      phase: Math.random() * Math.PI * 2,
      // Base speed magnitudes; update() re-signs/scales based on theme.
      vBase: 18 + Math.random() * 22,
      swayAmp: 10 + Math.random() * 18,
      swayRate: 0.6 + Math.random() * 0.9,
    });
  }

  const extraSpawns = []; // absolute game-times for polyrhythm extras

  // ---------- 3. Init ----------
  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');
  const app = document.getElementById('app');
  const hudScore = document.getElementById('score');
  const hudCombo = document.getElementById('combo');
  const hudLives = document.getElementById('lives');
  const overlay = document.getElementById('overlay');
  const gameoverEl = document.getElementById('gameover');
  const btnStart = document.getElementById('start');
  const btnMute = document.getElementById('mute');
  const muteIconOn = document.getElementById('muteIconOn');
  const muteIconOff = document.getElementById('muteIconOff');
  const finalScoreEl = document.getElementById('finalScore');
  const bestScoreEl = document.getElementById('bestScore');
  const statPeakEl = document.getElementById('statPeak');
  const statPerfectEl = document.getElementById('statPerfect');
  const statHitsEl = document.getElementById('statHits');
  const newBestEl = document.getElementById('newBest');
  const comboMeter = document.getElementById('comboMeter');
  const comboMeterFill = document.getElementById('comboMeterFill');
  const beatEl = document.getElementById('beat');
  const pauseEl = document.getElementById('pause');
  const pauseCountdownEl = document.getElementById('pauseCountdown');
  const historyEl = document.getElementById('history');
  const historySvg = document.getElementById('historySvg');
  const ghostEl = document.getElementById('ghost');
  const ghostSvgNow = document.getElementById('ghostSvgNow');
  const ghostSvgBest = document.getElementById('ghostSvgBest');
  const ghostBestMeta = document.getElementById('ghostBestMeta');
  const shareBtn = document.getElementById('share');
  const seedPill = document.getElementById('seedPill');
  const seedDateEl = document.getElementById('seedDate');
  const startSubtitle = document.getElementById('startSubtitle');
  const seedDateStartEl = document.getElementById('seedDateStart');
  const dailyLink = document.getElementById('dailyLink');
  const freeLink  = document.getElementById('freeLink');
  const historyLabel = document.getElementById('historyLabel');
  const tomorrowEl = document.getElementById('tomorrow');
  const tomorrowTimeEl = document.getElementById('tomorrowTime');
  const leaderboardEl = document.getElementById('leaderboard');
  const leaderboardLabel = document.getElementById('leaderboardLabel');
  const leaderboardListEl = document.getElementById('leaderboardList');
  const streakStartEl = document.getElementById('streakStart');
  const streakStartNum = document.getElementById('streakStartNum');
  const streakStartBest = document.getElementById('streakStartBest');
  const streakStartBestNum = document.getElementById('streakStartBestNum');
  const gameoverStreakEl = document.getElementById('gameoverStreak');
  const gameoverStreakNum = document.getElementById('gameoverStreakNum');
  const gameoverStreakBest = document.getElementById('gameoverStreakBest');
  const gameoverStreakBestNum = document.getElementById('gameoverStreakBestNum');
  const achievementsEl = document.getElementById('achievements');
  const achListEl = document.getElementById('achList');
  const achProgressEl = document.getElementById('achProgress');
  const themePickerEl = document.getElementById('themePicker');
  const achToastEl = document.getElementById('achievementToast');
  bestScoreEl.textContent = state.best;
  if (SEED !== null) {
    historyLabel.textContent = 'Daily progress';
    leaderboardLabel.textContent = 'Top daily runs';
  }

  // Milliseconds until local midnight — used to tease tomorrow's daily
  // on the gameover screen ("Next daily in 6h 12m").
  function msToTomorrow() {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    return next.getTime() - now.getTime();
  }
  function formatHhMm(ms) {
    const totalMin = Math.max(0, Math.floor(ms / 60000));
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return h + 'h ' + String(m).padStart(2, '0') + 'm';
  }

  // Seed-mode UI: show DAILY pill + start-overlay subtitle when in seeded play.
  // Otherwise expose the "Try today's daily" link on the free-play start overlay.
  if (SEED !== null) {
    const label = formatSeedLabel(SEED);
    seedDateEl.textContent = label;
    seedDateStartEl.textContent = label;
    seedPill.hidden = false;
    startSubtitle.hidden = false;
    freeLink.hidden = false;
  } else {
    dailyLink.hidden = false;
  }

  // DPR-aware canvas sizing — render at device pixels for crispness, keep
  // logical coords at 720×960 via ctx transform. Cap DPR at 2 to avoid
  // 4× fill-rate on ultra-high-density screens.
  function setupCanvas() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== W * dpr) {
      canvas.width  = W * dpr;
      canvas.height = H * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  setupCanvas();
  window.addEventListener('resize', setupCanvas);

  function readBest() {
    try { return +(localStorage.getItem(BEST_KEY) || 0); } catch { return 0; }
  }
  function writeBest(v) {
    try { localStorage.setItem(BEST_KEY, String(v)); } catch {}
  }
  function readMuted() {
    try { return localStorage.getItem('void-pulse-muted') === '1'; } catch { return false; }
  }
  function writeMuted(v) {
    try { localStorage.setItem('void-pulse-muted', v ? '1' : '0'); } catch {}
  }
  function readHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter(n => typeof n === 'number').slice(-RUN_HISTORY_CAP) : [];
    } catch { return []; }
  }
  function writeHistory(arr) {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(arr.slice(-RUN_HISTORY_CAP))); } catch {}
  }
  // Ghost: compact best-run event timeline, per seed. Stored as
  //   { events: [[t, kind], ...], score, duration, at }
  // Overwritten only when a run produces a new per-seed best. That means the
  // ghost always pairs with the stored BEST_KEY value for the same seed.
  function readGhost() {
    if (GHOST_KEY === null) return null;
    try {
      const raw = localStorage.getItem(GHOST_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.events)) return null;
      // Validate event tuples defensively — older schemas or tampered data
      // shouldn't crash the render.
      parsed.events = parsed.events.filter(e =>
        Array.isArray(e) && typeof e[0] === 'number' && (e[1] === 'p' || e[1] === 'g' || e[1] === 'm')
      );
      return parsed;
    } catch { return null; }
  }
  function writeGhost(payload) {
    if (GHOST_KEY === null) return;
    try { localStorage.setItem(GHOST_KEY, JSON.stringify(payload)); } catch {}
  }
  // First-visit flag: a single one-shot bit written on the player's first
  // Start tap. Read once at boot to decide whether the start overlay shows
  // the onboarding hint + Start-button pulse. Clearing the key (devtools)
  // brings the hint back — useful for re-reviewing the onboarding path.
  const SEEN_KEY = 'void-pulse-seen';
  function readSeen() {
    try { return localStorage.getItem(SEEN_KEY) === '1'; } catch { return false; }
  }
  function writeSeen() {
    try { localStorage.setItem(SEEN_KEY, '1'); } catch {}
  }
  // Top-N per-seed leaderboard. Each entry: { score: number, atMs: number }.
  // Stored sorted descending by score, capped at LEADERBOARD_MAX.
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
  // Lifetime stats: one JSON blob with aggregate counters. Defaults fill in
  // missing keys on read, so adding a new field later doesn't need a migration.
  // Writes happen once per gameover via `bumpLifetime(run)` — idempotent at
  // the granularity of "one run = one bump", never re-incremented mid-run.
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
      // Merge: trust numeric fields, clamp negatives to 0, keep defaults for
      // any field not present. bestPerTheme is a nested object → merge keys.
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
  function writeLifetime(obj) {
    try { localStorage.setItem(LIFETIME_KEY, JSON.stringify(obj)); } catch {}
  }
  function bumpLifetime(run) {
    const l = readLifetime();
    const now = Date.now();
    l.runs += 1;
    l.totalScore     += Math.max(0, +run.score || 0);
    l.totalPerfects  += Math.max(0, +run.perfects || 0);
    l.totalHits      += Math.max(0, +run.hits || 0);
    l.totalMisses    += Math.max(0, +run.misses || 0);
    l.totalSeconds   += Math.max(0, +run.seconds || 0);
    l.peakComboEver  = Math.max(l.peakComboEver, +run.peakCombo || 0);
    l.bestScoreEver  = Math.max(l.bestScoreEver, +run.score || 0);
    const t = run.theme;
    if (t && l.bestPerTheme[t] !== undefined) {
      l.bestPerTheme[t] = Math.max(l.bestPerTheme[t], +run.score || 0);
    }
    if (!l.firstPlayedAt) l.firstPlayedAt = now;
    l.lastPlayedAt = now;
    writeLifetime(l);
    return l;
  }
  function resetLifetime() {
    try { localStorage.removeItem(LIFETIME_KEY); } catch {}
  }
  // Insert a score; returns { board, rank } where rank is the 1-indexed
  // position of the new entry, or 0 if it didn't make the cut.
  function insertScore(score, atMs) {
    if (score <= 0) return { board: readBoard(), rank: 0 };
    const board = readBoard();
    const entry = { score, atMs };
    board.push(entry);
    board.sort((a, b) => b.score - a.score || a.atMs - b.atMs);
    const trimmed = board.slice(0, LEADERBOARD_MAX);
    const rank = trimmed.indexOf(entry) + 1;     // 0 if dropped by trim
    writeBoard(trimmed);
    return { board: trimmed, rank };
  }
  // Sliding window of recent run durations (seconds); last RAGE_REQUIRED only.
  function readRageDurations() {
    try {
      const raw = localStorage.getItem('void-pulse-rage');
      const a = raw ? JSON.parse(raw) : [];
      return Array.isArray(a) ? a.filter(n => typeof n === 'number').slice(-RAGE_REQUIRED) : [];
    } catch { return []; }
  }
  function writeRageDurations(a) {
    try { localStorage.setItem('void-pulse-rage', JSON.stringify(a.slice(-RAGE_REQUIRED))); } catch {}
  }

  // ---------- Streak + Achievements (global, cross-seed) ----------
  // Streak tracks consecutive daily-mode completions. Keys live OUTSIDE the
  // per-seed namespace on purpose — a "3-day streak" is a cross-day concept,
  // not a property of any single day's seed.
  const STREAK_KEY = 'void-pulse-streak';
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
      const raw = localStorage.getItem(STREAK_KEY);
      const o = raw ? JSON.parse(raw) : null;
      if (o && typeof o.streak === 'number' && typeof o.best === 'number'
          && typeof o.lastYyyymmdd === 'number') return o;
    } catch {}
    return { streak: 0, best: 0, lastYyyymmdd: 0 };
  }
  function writeStreak(o) {
    try { localStorage.setItem(STREAK_KEY, JSON.stringify(o)); } catch {}
  }

  // ---------- Theme ----------
  // Player-selectable palette. Stored globally (not per-seed) since theme is
  // a preference, not a game-state signal. Applied via `data-theme` on <html>
  // so CSS variables cascade without touching the canvas draws (canvas reads
  // resolve via `getVar` which consults getComputedStyle at paint time).
  const THEME_KEY = 'void-pulse-theme';
  const THEMES = ['void', 'sunset', 'forest'];
  // Stored = user has explicitly picked one. Null = we're still in auto mode,
  // meaning every theme render pulls from the live system preference.
  function readStoredTheme() {
    try {
      const t = localStorage.getItem(THEME_KEY);
      return THEMES.includes(t) ? t : null;
    } catch { return null; }
  }
  // Sniff OS-level preferences for a first-visit default. Priority:
  //   1. `prefers-contrast: more` → void (highest contrast, maximum legibility)
  //   2. `prefers-color-scheme: light` → sunset (warm, palette designed for it)
  //   3. else → void (matches the game's original identity)
  // Never persisted — the sniff result is always re-derived from the current
  // media state so a mid-session OS theme flip follows the user.
  function sniffSystemTheme() {
    try {
      if (window.matchMedia && window.matchMedia('(prefers-contrast: more)').matches) return 'void';
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) return 'sunset';
    } catch {}
    return 'void';
  }
  // Effective theme = stored pick if it exists, else the current system sniff.
  // `readTheme` is the one-stop call used everywhere an initial value is needed.
  function readTheme() {
    return readStoredTheme() || sniffSystemTheme();
  }
  function writeTheme(t) {
    try { localStorage.setItem(THEME_KEY, t); } catch {}
  }
  // Bump the streak because the player just completed today's daily.
  // Only callable from daily mode. Idempotent within a single day.
  function bumpStreakForToday() {
    const today = todayYyyymmdd();
    const s = readStreak();
    if (s.lastYyyymmdd === today) return { ...s, changed: false };
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
    writeStreak(out);
    return { ...out, changed: true, wasBest: newStreak > s.best };
  }

  // Achievements — a flat set of ids persisted as a map. Once unlocked, stays
  // unlocked forever. Checked at gameover; the "just" highlight surfaces which
  // ones the player earned in *this* run.
  const ACH_KEY = 'void-pulse-ach';
  // Achievement ladder is ordered from easy → hard. Newer / rarer entries
  // live at the bottom so the grid reads as a progression. Tests are pure
  // functions over a snapshot context (no state peeks); the same context
  // is passed from gameover once all run tallies are final.
  const ACHIEVEMENTS = [
    { id: 'first-pulse',     label: 'First Pulse',     desc: 'Score your first point',                     test: c => c.score >= 1 },
    { id: 'combo-25',        label: 'Combo 25',        desc: 'Chain 25 hits in a run',                     test: c => c.peakCombo >= 25 },
    { id: 'combo-50',        label: 'Combo 50',        desc: 'Chain 50 hits in a run',                     test: c => c.peakCombo >= 50 },
    { id: 'score-500',       label: '500 Points',      desc: 'Reach 500 in a single run',                  test: c => c.score >= 500 },
    { id: 'score-1000',      label: '1000 Points',     desc: 'Reach 1000 in a single run',                 test: c => c.score >= 1000 },
    { id: 'streak-3',        label: '3-Day Ritual',    desc: 'Finish the daily 3 days in a row',           test: c => c.streak >= 3 },
    // Rare tier — introduced Sprint 23. Each targets a different play style
    // (skill ceiling, endurance, retention, precision, flawlessness) so no
    // single "good run" sweeps them all.
    { id: 'combo-100',       label: 'Combo 100',       desc: 'Chain 100 hits in a single run',             test: c => c.peakCombo >= 100,                                  midRun: true },
    { id: 'score-2500',      label: '2500 Points',     desc: 'Reach 2500 in a single run',                 test: c => c.score >= 2500,                                     midRun: true },
    { id: 'streak-7',        label: 'Week Zealot',     desc: 'Finish the daily 7 days in a row',           test: c => c.streak >= 7 },
    { id: 'perfect-purity',  label: 'Perfect Purity',  desc: '20+ perfects in a run, zero goods',          test: c => c.perfectCount >= 20 && c.hitCount === c.perfectCount, midRun: true },
    { id: 'flawless-60',     label: 'Flawless 60',     desc: 'Survive 60 seconds with zero misses',        test: c => c.duration >= 60 && c.missCount === 0,               midRun: true },
  ];
  function readAchievements() {
    try {
      const raw = localStorage.getItem(ACH_KEY);
      const o = raw ? JSON.parse(raw) : null;
      return (o && typeof o === 'object') ? o : {};
    } catch { return {}; }
  }
  function writeAchievements(o) {
    try { localStorage.setItem(ACH_KEY, JSON.stringify(o)); } catch {}
  }
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
  // Mid-run variant — tests only entries flagged `midRun: true` and writes
  // the unlock to storage immediately, so a player who achieves combo-100
  // and dies the next tap still banks the credit. Returns the entries that
  // *just* unlocked on this call, so the caller can toast them.
  // Called from the frame loop (cheap: 4 tests once per frame), not tied
  // to individual score events — keeps the hot path simple.
  function evaluateMidRunAchievements(ctx) {
    const unlocked = readAchievements();
    const justNow = [];
    for (const a of ACHIEVEMENTS) {
      if (!a.midRun) continue;
      if (!unlocked[a.id] && a.test(ctx)) {
        unlocked[a.id] = 1;
        justNow.push(a);
      }
    }
    if (justNow.length) writeAchievements(unlocked);
    return justNow;
  }
  // Toast queue: if two achievements unlock on the same frame (unlikely but
  // possible — e.g., score-2500 + combo-100 on the same perfect tap), show
  // them serially rather than stacking visually. Each toast holds the
  // element for ~2.2s; serial presentation keeps them individually readable.
  const toastQueue = [];
  let toastShowing = false;
  function showAchievementToast(ach) {
    toastQueue.push(ach);
    if (!toastShowing) _drainToastQueue();
  }
  function _drainToastQueue() {
    if (toastQueue.length === 0) { toastShowing = false; return; }
    toastShowing = true;
    const ach = toastQueue.shift();
    const el = achToastEl;
    if (!el) { toastShowing = false; return; }
    el.querySelector('.ach-toast-label').textContent = ach.label;
    el.classList.remove('hidden');
    // Force a reflow so the subsequent class-add retriggers the slide-in
    // animation even on a back-to-back unlock.
    void el.offsetWidth;
    el.classList.add('visible');
    // Soft ping — reuse the existing achievement cue at reduced volume by
    // playing its third note only, so it reads as "bonus!" not "unlock
    // ceremony" (the full cascade is reserved for the gameover context).
    Sfx.achievementToast();
    haptic([12, 22, 40]);
    // Route the unlock through the central announcer with the "Achievement
    // unlocked:" prefix so screen readers speak context even if they've
    // silenced the toast's own aria-live (some SRs suppress role=status
    // updates when a dialog is focused; the announcer region is persistent).
    announce('Achievement unlocked: ' + ach.label);
    setTimeout(() => {
      el.classList.remove('visible');
      setTimeout(() => {
        el.classList.add('hidden');
        _drainToastQueue();
      }, 220);  // match CSS transition
    }, 2200);
  }

  // ---------- Sfx ----------
  // The master bus has 3 dynamic states beyond mute:
  //   normal  — baseline (MASTER_GAIN)
  //   beaten  — +18% (~+1.4dB) lift when player is past their best, subtly
  //             "rising stakes" without screaming louder
  //   duck    — -65% when an overlay is open (pause / gameover) so any
  //             leftover SFX tail doesn't compete with HUD focus
  // Transitions ramp over 0.4s so they're felt, not heard as a jump.
  const BUS_LEVELS = { normal: 1.0, beaten: 1.18, duck: 0.35 };
  const Sfx = {
    ctx: null,
    master: null,
    busState: 'normal',
    init() {
      if (this.ctx) return;
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = state.muted ? 0 : MASTER_GAIN * BUS_LEVELS[this.busState];
      this.master.connect(this.ctx.destination);
    },
    applyMute() {
      if (!this.master) return;
      const target = state.muted ? 0 : MASTER_GAIN * BUS_LEVELS[this.busState];
      this.master.gain.value = target;
      // Power save — muting fully suspends the AudioContext (releases the
      // audio hardware claim) rather than just zero-ing master gain. A
      // 0-gain running context still consumes battery on mobile because
      // the output graph keeps being sampled. Unmute resumes the context
      // on the same user gesture that triggered it (M key / icon click).
      if (state.muted) this._suspend();
      else this._resume();
    },
    // Suspend/resume the AudioContext. Promise-returning APIs that may
    // reject on some platforms (iOS < 14); the .catch is defensive.
    // Called on:
    //   - mute toggle (persistent mute state)
    //   - visibility hidden (transient; counterpart _resume on visible)
    // Do NOT call on pause overlay — duck bus is sufficient; suspending
    // here would make resume audible as a silent-to-loud pop.
    _suspend() {
      if (!this.ctx || this.ctx.state !== 'running') return;
      try { this.ctx.suspend().catch(() => {}); } catch {}
    },
    _resume() {
      if (!this.ctx || this.ctx.state === 'running') return;
      // Only resume if the user has chosen audio on — otherwise we'd be
      // undoing a deliberate mute. Mute takes precedence over any transient
      // visibility-driven suspend.
      if (state.muted) return;
      try { this.ctx.resume().catch(() => {}); } catch {}
    },
    setBus(name) {
      if (!BUS_LEVELS[name] || this.busState === name) return;
      this.busState = name;
      if (!this.master || state.muted) return;
      const t0 = this.ctx.currentTime;
      const target = MASTER_GAIN * BUS_LEVELS[name];
      try {
        this.master.gain.cancelScheduledValues(t0);
        this.master.gain.setValueAtTime(this.master.gain.value, t0);
        this.master.gain.linearRampToValueAtTime(target, t0 + 0.4);
      } catch {
        this.master.gain.value = target;
      }
    },
    _env(type, freq, dur, vol, slideTo) {
      if (!this.ctx) return;
      const t0 = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      osc.connect(g).connect(this.master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    },
    // White-noise buffer, built once per session and reused. A 1-second mono
    // buffer at sampleRate is tiny (<200KB @ 48kHz) and gives us an endless
    // source for short bursts — we just clip the envelope.
    _noiseBuf: null,
    _getNoise() {
      if (this._noiseBuf) return this._noiseBuf;
      const sr = this.ctx.sampleRate;
      const buf = this.ctx.createBuffer(1, sr, sr);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this._noiseBuf = buf;
      return buf;
    },
    // Filtered-noise burst: highpass ≈ crackle (sunset ember), lowpass ≈
    // rustle (forest leaves). Same exponential envelope as _env so the two
    // helpers compose predictably when layered.
    _noise(dur, vol, filterType, filterFreq) {
      if (!this.ctx) return;
      const t0 = this.ctx.currentTime;
      const src = this.ctx.createBufferSource();
      src.buffer = this._getNoise();
      const filter = this.ctx.createBiquadFilter();
      filter.type = filterType;
      filter.frequency.value = filterFreq;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      src.connect(filter).connect(g).connect(this.master);
      src.start(t0);
      src.stop(t0 + dur + 0.02);
    },
    // Theme accent for the "punish" moments (miss, gameover). Returns without
    // doing anything on void so the baseline synth character is preserved.
    // Reads currentTheme at call-time so mid-run theme swaps are honored.
    _themeAccent(kind) {
      if (currentTheme === 'void') return;
      if (currentTheme === 'sunset') {
        // Dry ember crackle — short, bright, low-volume so it sits as "texture"
        // under the base sawtooth rather than competing with it.
        if (kind === 'miss')      this._noise(0.09, 0.18, 'highpass', 2400);
        else if (kind === 'over') this._noise(0.22, 0.14, 'highpass', 1800);
      } else if (currentTheme === 'forest') {
        // Leaf rustle — longer, darker, softer. Lowpass cuts the hiss so it
        // reads as "soft" rather than "static".
        if (kind === 'miss')      this._noise(0.18, 0.10, 'lowpass', 900);
        else if (kind === 'over') this._noise(0.38, 0.08, 'lowpass', 700);
      }
    },
    click()  { this._env('square',   660, 0.05, 0.15); },
    score(combo = 0) {
      const f = 660 * Math.pow(1.06, Math.min(combo, 12));
      this._env('triangle', f, 0.09, 0.18);
    },
    good(combo = 0) {
      const f = 500 * Math.pow(1.04, Math.min(combo, 12));
      this._env('sine', f, 0.08, 0.15);
    },
    miss() {
      this._env('sawtooth', 180, 0.22, 0.26, 70);
      this._themeAccent('miss');   // additive; void is a no-op
    },
    gameover() {
      this._env('sawtooth', 330, 0.5, 0.3, 60);
      setTimeout(() => this._env('sawtooth', 220, 0.6, 0.25, 40), 120);
      // Theme accent lands with the second thud so the whole death beat has
      // atmosphere, not just the attack.
      setTimeout(() => this._themeAccent('over'), 140);
    },
    levelup() {
      [523, 659, 784, 1047].forEach((f, i) => {
        setTimeout(() => this._env('triangle', f, 0.09, 0.17), i * 65);
      });
    },
    // Theme-conditional overtone layered on top of levelup at high-multiplier
    // milestones (combo >= 20 → mult >= 3x). Void is a no-op (preserves the
    // pure-synth character); sunset gets a bright high bell; forest gets a
    // deep warm fifth. Reads currentTheme at call-time so mid-run theme swaps
    // take effect on the next milestone.
    //
    // Additive, not replacive — the base levelup cascade still plays. This
    // layer is a spice, not a substitute.
    themeSweeten() {
      if (currentTheme === 'void') return;
      if (currentTheme === 'sunset') {
        // High shimmer: long sine sustain an octave above the cascade peak,
        // plus a sibling third for harmonic warmth. Volume stays soft so it
        // sits as texture, not lead.
        this._env('sine', 2093, 0.45, 0.08);        // C7
        setTimeout(() => this._env('sine', 2637, 0.38, 0.06), 40);  // E7
      } else if (currentTheme === 'forest') {
        // Deep warm fifth under the cascade — adds body, feels grounded.
        // Lower triangle sustains with a gentle slide for organic motion.
        this._env('triangle', 196, 0.55, 0.10, 147);  // G3 -> D3
        setTimeout(() => this._env('triangle', 294, 0.40, 0.07, 220), 70); // D4 -> A3
      }
    },
    heartbeat() { this._env('sine', 110, 0.12, 0.22, 165); },
    // Achievement unlock — bright major-6th ping, distinct from levelup's
    // cascade (levelup = new-best, achievement = milestone-claimed).
    achievement() {
      [880, 1175, 1568].forEach((f, i) => {
        setTimeout(() => this._env('triangle', f, 0.12, 0.14), i * 90);
      });
    },
    // Mid-run toast variant — softer single ping (~third note of the full
    // cascade) so it registers as "bonus!" without hijacking attention like
    // the gameover-context cascade does. Volume is deliberately below the
    // base hit tone: the toast is visual primary, audio garnish.
    achievementToast() {
      this._env('triangle', 1175, 0.14, 0.11);
    },
    // Brief high-register blip at spawn — gives the player a rhythm anchor
    // so tap timing isn't purely visual. Quiet enough to not dominate the mix.
    spawnTick(isHeartbeat) {
      this._env('sine', isHeartbeat ? 740 : 520, 0.035, 0.055);
    },
    // Hazard spawn — low buzzy growl so the player HEARS the warning as
    // soon as the red ring appears. Shorter + saw-shape so it reads as a
    // threat cue distinct from the clean spawn-tick sine.
    hazardSpawn() {
      this._env('sawtooth', 140, 0.08, 0.14, 90);
    },
    // Hazard passed safely — reward pip: a soft bell-like sine that says
    // "good restraint". Quieter than a score hit so the rhythm stays
    // primary; a sibling pip 30ms later gives it body without drowning
    // the next tap.
    hazardPass() {
      this._env('sine', 1760, 0.18, 0.10);
      setTimeout(() => { try { this._env('sine', 2637, 0.14, 0.06); } catch {} }, 30);
    },
    // Hazard TAPPED by mistake — harsh, distinct from a normal miss so
    // the player's muscle memory learns "this one is different". Low
    // saw + quick high-saw stab layered so it feels like a buzz-cut.
    hazardHit() {
      this._env('sawtooth', 95, 0.28, 0.30, 48);
      setTimeout(() => { try { this._env('square', 320, 0.16, 0.18); } catch {} }, 45);
      this._themeAccent('miss');
    },
    // Tiny per-dot tick scheduled on the audio clock for the ghost reveal
    // (Sprint 21's staggered animation). Called once per perfect in the
    // player's own current run, each offset by the matching animation delay.
    // Pre-scheduling on ctx.currentTime + delay (instead of setTimeout) keeps
    // the audio locked to the visual even if the main thread hiccups.
    // Callers are responsible for gating on muted + reduced-motion.
    ghostTick(delaySec) {
      if (!this.ctx) return;
      const t0 = this.ctx.currentTime + Math.max(0, delaySec);
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1800, t0);
      // Quick exponential decay — softer than score-hit ticks so a cluster of
      // perfects reads as a satisfying trill, not a machine-gun of beeps.
      g.gain.setValueAtTime(0.04, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.06);
      osc.connect(g).connect(this.master);
      osc.start(t0);
      osc.stop(t0 + 0.08);
    },
  };

  // ---------- BGM: beat-synced background track (Sprint 30) ----------
  // Music locked to the 120 BPM chart grid so pulses and audio share a beat.
  // Five voices (kick / snare / hat / bass / motif) thicken as difficulty bands
  // escalate. Scheduled via `ctx.currentTime + delay` lookahead (60ms tick,
  // 250ms horizon) — NOT setTimeout — so drift never exceeds sub-sample at
  // 44.1kHz. Routed through its own gain node that feeds Sfx.master, so the
  // three-state bus (normal/beaten/duck) and the mute suspend apply uniformly.
  //
  // Pattern grids: 1 = hit, 0 = rest. One bar = 8 eighth-note slots.
  const BGM_PATTERN = {
    warm:   { kick:[1,0,0,0,0,0,0,0], snare:[0,0,0,0,0,0,0,0], hat:[1,0,1,0,1,0,1,0], bass:[0,0,0,0,0,0,0,0], motif:[0,0,0,0,0,0,0,0] },
    easy:   { kick:[1,0,0,0,1,0,0,0], snare:[0,0,0,0,0,0,0,0], hat:[1,0,1,0,1,0,1,0], bass:[0,0,0,0,0,0,0,0], motif:[0,0,0,0,0,0,0,0] },
    mid:    { kick:[1,0,0,0,1,0,0,0], snare:[0,0,0,0,1,0,0,1], hat:[1,1,1,1,1,1,1,1], bass:[1,0,0,0,1,0,0,0], motif:[0,0,0,0,0,0,0,0] },
    hard:   { kick:[1,0,0,1,1,0,0,0], snare:[0,0,0,0,1,0,0,1], hat:[1,1,1,1,1,1,1,1], bass:[1,0,1,0,1,0,1,0], motif:[0,0,0,1,0,0,0,0] },
    climax: { kick:[1,0,1,0,1,0,1,0], snare:[0,0,1,0,1,0,1,0], hat:[1,1,1,1,1,1,1,1], bass:[1,1,1,1,1,1,1,1], motif:[1,0,0,1,0,1,0,0] },
    out:    { kick:[1,0,0,0,1,0,0,0], snare:[0,0,0,0,0,0,0,0], hat:[1,0,0,0,1,0,0,0], bass:[0,0,0,0,0,0,0,0], motif:[0,0,0,0,0,0,0,0] },
  };
  // A natural minor-7 motif phrase cycled by slot index — hypnotic, sits under
  // the ring's cyan/magenta palette without fighting the SFX frequency range.
  const BGM_MOTIF_SEMITONES = [0, 3, 7, 10];  // A C E G
  // Hard-phase bass walks 0 → -2 → -5 → 0 across its 4 bars for harmonic
  // motion; other bands stay on the root so the music doesn't muddy the chart.
  const BGM_BASS_WALK_HARD = [0, -2, -5, 0];
  const BGM_MASTER_GAIN = 0.26;   // submix under Sfx.master; leaves headroom for taps
  const BGM_LOOKAHEAD_S = 0.25;
  const BGM_TICK_MS = 60;
  const BGM_EIGHTH_S = 0.25;       // 120 BPM, 8th note

  const BGM = {
    timer: null,
    anchor: 0,               // ctx-time of slot 0 (first chart bar downbeat)
    scheduledThrough: -1,    // highest slot index already queued
    running: false,          // has start() been called and not yet stopped?
    paused: false,           // true while pauseGame is active
    pauseStartT: 0,          // ctx.currentTime captured when paused
    gain: null,
    ctx: null,
    bands: null,
    _noise: null,

    start(sfx, bands, runAnchorCtxT) {
      if (!sfx || !sfx.ctx) return;
      if (this.running) this.stop();
      this.ctx = sfx.ctx;
      this.gain = this.ctx.createGain();
      this.gain.gain.value = state.muted ? 0 : BGM_MASTER_GAIN;
      this.gain.connect(sfx.master);
      this.anchor = runAnchorCtxT;
      this.bands = bands;
      this.scheduledThrough = -1;
      this.running = true;
      this.paused = false;
      this._scheduleAhead();
      this.timer = setInterval(() => this._scheduleAhead(), BGM_TICK_MS);
    },
    stop() {
      if (this.timer) { clearInterval(this.timer); this.timer = null; }
      this.running = false;
      this.paused = false;
      const g = this.gain;
      const ctx = this.ctx;
      if (g && ctx) {
        try {
          g.gain.cancelScheduledValues(ctx.currentTime);
          g.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.05);
        } catch { g.gain.value = 0; }
        setTimeout(() => { try { g.disconnect(); } catch {} }, 90);
      }
      this.gain = null;
    },
    pause() {
      if (!this.running || this.paused || !this.ctx) return;
      this.paused = true;
      // Track pause in wall-clock ms — ctx.currentTime freezes when the
      // AudioContext is suspended (e.g. mute mid-run), which would under-
      // report the real elapsed time needed to re-align with state.t on
      // resume. performance.now() keeps advancing regardless.
      this.pauseStartT = performance.now();
      if (this.timer) { clearInterval(this.timer); this.timer = null; }
    },
    resume() {
      if (!this.running || !this.paused || !this.ctx) return;
      // Slide the anchor forward by the paused duration so chart slots
      // (which advance on state.t, not ctx time) re-align with the BGM grid.
      const dtS = (performance.now() - this.pauseStartT) / 1000;
      this.anchor += dtS;
      this.paused = false;
      this._scheduleAhead();
      this.timer = setInterval(() => this._scheduleAhead(), BGM_TICK_MS);
    },
    setMuted(m) {
      if (!this.ctx) return;
      // If we're in the middle of a run, a mute means the AudioContext is
      // about to be suspended — pause the scheduler so we don't silently
      // drift relative to the chart. On unmute we resume with an anchor
      // shift equal to the paused duration.
      if (this.running && !state.paused) {
        if (m && !this.paused) this.pause();
        else if (!m && this.paused) this.resume();
      }
      if (!this.gain) return;
      const target = m ? 0 : BGM_MASTER_GAIN;
      try {
        this.gain.gain.cancelScheduledValues(this.ctx.currentTime);
        this.gain.gain.linearRampToValueAtTime(target, this.ctx.currentTime + 0.05);
      } catch { this.gain.gain.value = target; }
    },
    // Sidechain-style duck for punctuation events (hazard tap). Attack is
    // snappy so the BGM gets out of the way of the punishment SFX transient;
    // release overlaps the tail of the red wash (~280ms) so the music fades
    // back in as the visual recovers. cancelScheduledValues + an explicit
    // setValueAtTime anchor ensures an overlapping duck on a second hazard
    // cleanly re-starts the envelope from wherever gain currently sits.
    duck(amount = 0.35, attackS = 0.03, holdS = 0.09, releaseS = 0.32) {
      if (!this.running || this.paused) return;
      if (state.muted) return;
      if (!this.gain || !this.ctx) return;
      const g = this.gain.gain;
      const t = this.ctx.currentTime;
      const low = BGM_MASTER_GAIN * amount;
      try {
        g.cancelScheduledValues(t);
        g.setValueAtTime(g.value, t);
        g.linearRampToValueAtTime(low, t + attackS);
        g.setValueAtTime(low, t + attackS + holdS);
        g.linearRampToValueAtTime(BGM_MASTER_GAIN, t + attackS + holdS + releaseS);
      } catch { /* ignore — mute ramp will restore anyway */ }
    },
    _scheduleAhead() {
      if (!this.running || this.paused) return;
      if (!this.ctx || this.ctx.state !== 'running') return;
      const nowT = this.ctx.currentTime;
      const horizon = nowT + BGM_LOOKAHEAD_S;
      const maxSlot = this.bands.length * 8 - 1;
      while (this.scheduledThrough < maxSlot) {
        const nextIdx = this.scheduledThrough + 1;
        const whenT = this.anchor + nextIdx * BGM_EIGHTH_S;
        if (whenT > horizon) break;
        if (whenT >= nowT - 0.02) this._playSlot(nextIdx, whenT);
        this.scheduledThrough = nextIdx;
      }
      if (this.scheduledThrough >= maxSlot) this.stop();
    },
    _playSlot(idx, whenT) {
      const bar = Math.floor(idx / 8);
      const slot = idx % 8;
      const band = this.bands[bar];
      const pat = BGM_PATTERN[band];
      if (!pat) return;
      if (pat.kick[slot])  this._kick(whenT);
      if (pat.snare[slot]) this._snare(whenT);
      if (pat.hat[slot])   this._hat(whenT);
      if (pat.bass[slot]) {
        let semis = 0;
        if (band === 'hard') {
          // Find first hard bar in the schedule so the walk always starts
          // from the first hard bar regardless of schedule length changes.
          let hardStart = this.bands.indexOf('hard');
          if (hardStart < 0) hardStart = bar;
          const hbi = bar - hardStart;
          semis = BGM_BASS_WALK_HARD[((hbi % 4) + 4) % 4] | 0;
        }
        this._bass(whenT, semis);
      }
      if (pat.motif[slot]) {
        this._motif(whenT, BGM_MOTIF_SEMITONES[slot % BGM_MOTIF_SEMITONES.length]);
      }
    },
    _noiseBuf() {
      if (this._noise) return this._noise;
      const sr = this.ctx.sampleRate;
      const buf = this.ctx.createBuffer(1, Math.floor(sr * 0.25), sr);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this._noise = buf;
      return buf;
    },
    _kick(t) {
      const ctx = this.ctx;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(120, t);
      o.frequency.exponentialRampToValueAtTime(40, t + 0.16);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.22, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.connect(g).connect(this.gain);
      o.start(t); o.stop(t + 0.2);
    },
    _snare(t) {
      const ctx = this.ctx;
      const src = ctx.createBufferSource(); src.buffer = this._noiseBuf();
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1800;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.18, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      src.connect(hp).connect(g).connect(this.gain);
      src.start(t); src.stop(t + 0.14);
      // Tight 320Hz body blip adds snap.
      const o = ctx.createOscillator(); const og = ctx.createGain();
      o.type = 'square'; o.frequency.setValueAtTime(320, t);
      og.gain.setValueAtTime(0.0001, t);
      og.gain.exponentialRampToValueAtTime(0.06, t + 0.005);
      og.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
      o.connect(og).connect(this.gain);
      o.start(t); o.stop(t + 0.1);
    },
    _hat(t) {
      const ctx = this.ctx;
      const src = ctx.createBufferSource(); src.buffer = this._noiseBuf();
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.09, t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
      src.connect(hp).connect(g).connect(this.gain);
      src.start(t); src.stop(t + 0.05);
    },
    _bass(t, semis) {
      const ctx = this.ctx;
      const freq = 55 * Math.pow(2, semis / 12);  // A1 = 55Hz
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.14, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
      o.connect(g).connect(this.gain);
      o.start(t); o.stop(t + 0.26);
    },
    _motif(t, semis) {
      const ctx = this.ctx;
      const freq = 220 * Math.pow(2, semis / 12);  // A3 = 220Hz
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.10, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      o.connect(g).connect(this.gain);
      o.start(t); o.stop(t + 0.24);
    },
  };

  // ---------- CSS var helper (cached) ----------
  const cssVar = {};
  function getVar(name) {
    if (cssVar[name]) return cssVar[name];
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    cssVar[name] = v || '#ffffff';
    return cssVar[name];
  }
  // Invalidate every downstream cache that resolved from getVar(). Call this
  // after writing `data-theme` — otherwise the canvas render keeps painting
  // yesterday's palette from its cached strings.
  function invalidateThemeCaches() {
    for (const k in cssVar) delete cssVar[k];
    for (let i = 0; i < vignetteCache.length; i++) vignetteCache[i] = null;
  }
  // `<meta name="theme-color">` controls the URL-bar / OS chrome color on
  // mobile. Must live on a DOM element we can query by name, not in a const
  // (may be recreated by dev tools or view-source). Also drives the PWA
  // splash/status-bar color when launched standalone from the home screen.
  const themeColorMeta = document.querySelector('meta[name="theme-color"]');
  function syncThemeColorMeta() {
    if (!themeColorMeta) return;
    // Read the resolved --bg from CSS so the source of truth is the
    // stylesheet, not a JS duplicate of the palette. Same pattern as
    // `getVar()`, but bypasses the canvas cache (we need it before the
    // cache is populated on first paint).
    const bg = getComputedStyle(document.documentElement)
      .getPropertyValue('--bg').trim() || '#0a0e1f';
    themeColorMeta.setAttribute('content', bg);
  }
  function applyTheme(t) {
    if (!THEMES.includes(t)) t = 'void';
    document.documentElement.dataset.theme = t;
    invalidateThemeCaches();
    syncThemeColorMeta();
    // Sync the radio-group aria state if the picker has already rendered.
    if (themePickerEl) {
      const buttons = themePickerEl.querySelectorAll('.theme-swatch');
      for (const b of buttons) {
        b.setAttribute('aria-checked', b.dataset.themeId === t ? 'true' : 'false');
      }
    }
  }
  // Apply persisted theme immediately so first paint uses the right palette.
  let currentTheme = readTheme();
  applyTheme(currentTheme);
  function setTheme(t) {
    if (!THEMES.includes(t) || t === currentTheme) return;
    currentTheme = t;
    writeTheme(t);
    applyTheme(t);
  }
  function cycleTheme() {
    const i = THEMES.indexOf(currentTheme);
    setTheme(THEMES[(i + 1) % THEMES.length]);
  }
  // Mid-session OS preference flip: if the user hasn't made an explicit pick,
  // re-sniff and apply. If they HAVE picked, ignore — their choice wins until
  // they clear storage. This is the `localStorage === null` side-channel; once
  // setTheme() writes a value, the guard short-circuits.
  function onSystemThemeChange() {
    if (readStoredTheme()) return;
    const next = sniffSystemTheme();
    if (next === currentTheme) return;
    currentTheme = next;
    applyTheme(next);
  }
  try {
    const mqColor = window.matchMedia('(prefers-color-scheme: light)');
    const mqContrast = window.matchMedia('(prefers-contrast: more)');
    // Safari <14 uses addListener; modern browsers use addEventListener.
    // Branch once at init to avoid re-checking each fire.
    if (mqColor.addEventListener) {
      mqColor.addEventListener('change', onSystemThemeChange);
      mqContrast.addEventListener('change', onSystemThemeChange);
    } else if (mqColor.addListener) {
      mqColor.addListener(onSystemThemeChange);
      mqContrast.addListener(onSystemThemeChange);
    }
  } catch {}
  // Picker click → setTheme. Each swatch button carries its theme id in
  // `data-theme-id`, so no long switch statement here.
  if (themePickerEl) {
    themePickerEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.theme-swatch');
      if (!btn) return;
      const id = btn.dataset.themeId;
      if (!id) return;
      Sfx.init(); Sfx.click();
      setTheme(id);
      // Bonus: pulse the target ring so the player sees the color shift on
      // canvas, not just on overlay chrome. Proves the swap reaches the game.
      state.targetPopT = 1;
    });
  }

  // ---------- 4. Input ----------
  function handleInputAction() {
    const now = performance.now();
    if (state.over) {
      if (now - state.gameoverAtMs >= GAMEOVER_LOCKOUT_MS) {
        Sfx.init(); Sfx.click();
        start();
      }
      return;
    }
    if (!state.running) return;
    // While paused or during resume-countdown, taps are swallowed so the
    // first tap after tab-return doesn't accidentally consume a pulse.
    if (state.paused) return;
    // During death-cam (the 0.55s slow-mo before gameover), swallow input so
    // the player can't stack a frantic tap into the retry overlay.
    if (state.deathCam) return;
    if (now - state.lastTapMs < TAP_DEBOUNCE_MS) return;
    state.lastTapMs = now;
    judgeTap();
  }
  canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); handleInputAction(); });
  gameoverEl.addEventListener('pointerdown', handleInputAction);

  btnStart.addEventListener('click', (e) => {
    e.stopPropagation();
    Sfx.init(); Sfx.click();
    start();
  });

  // Focus-trap helper — cycles Tab / Shift+Tab within an open modal so
  // keyboard users can't accidentally tab into the HUD beneath. Called
  // from the document keydown handler when a modal is visible.
  // Queries focusables at call time (not cached) so [hidden] toggles on
  // buttons like #statsExport are respected.
  const FOCUSABLE_SEL =
    'button:not([disabled]):not([hidden]),' +
    '[href]:not([disabled]),' +
    'input:not([disabled]):not([hidden]),' +
    'select:not([disabled]):not([hidden]),' +
    'textarea:not([disabled]):not([hidden]),' +
    '[tabindex]:not([tabindex="-1"]):not([disabled]):not([hidden])';
  function getModalFocusables(modalEl) {
    const list = modalEl.querySelectorAll(FOCUSABLE_SEL);
    const out = [];
    for (const el of list) {
      // Skip elements made visually-hidden by ancestor display:none.
      // offsetParent is null when the element (or any ancestor) is
      // display:none; for visibility:hidden / opacity:0 we still treat
      // it as tabbable since the browser does.
      if (el.offsetParent === null && el.tagName !== 'BODY') continue;
      out.push(el);
    }
    return out;
  }
  function trapFocus(modalEl, e) {
    if (e.key !== 'Tab') return false;
    const focusables = getModalFocusables(modalEl);
    if (focusables.length === 0) { e.preventDefault(); return true; }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !modalEl.contains(active))) {
      e.preventDefault();
      last.focus();
      return true;
    }
    if (!e.shiftKey && (active === last || !modalEl.contains(active))) {
      e.preventDefault();
      first.focus();
      return true;
    }
    return false;
  }

  // Keyboard input — Space / Enter mirrors tap; gameplay accessible without pointer.
  // When a BUTTON is focused, let the browser activate it (Space/Enter = click).
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    const inField = t && (t.tagName === 'BUTTON' || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');

    // Focus trap inside open modals — runs before other keyboard bindings so
    // Tab is captured cleanly. Help/Stats are the two overlays with inner
    // focusable controls; pause/gameover are tap-to-retry surfaces.
    if (e.key === 'Tab') {
      if (helpEl && !helpEl.classList.contains('hidden')) {
        if (trapFocus(helpEl, e)) return;
      }
      const statsElT = document.getElementById('statsPanel');
      if (statsElT && !statsElT.classList.contains('hidden')) {
        if (trapFocus(statsElT, e)) return;
      }
    }

    // ? — toggle help (Shift+/ on US, slash with Shift mark)
    if ((e.key === '?' || (e.key === '/' && e.shiftKey)) && !inField) {
      e.preventDefault();
      if (helpEl.classList.contains('hidden')) openHelp();
      else closeHelp();
      return;
    }
    // Esc — close help if open (no other esc binding currently)
    if (e.key === 'Escape' && !helpEl.classList.contains('hidden')) {
      e.preventDefault();
      closeHelp();
      return;
    }
    // Esc — close stats panel if open
    const statsElLocal = document.getElementById('statsPanel');
    if (e.key === 'Escape' && statsElLocal && !statsElLocal.classList.contains('hidden')) {
      e.preventDefault();
      closeStats();
      return;
    }
    // S — toggle stats panel. Gated off text inputs; works on any overlay.
    if (e.code === 'KeyS' && !inField && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault();
      if (statsElLocal && statsElLocal.classList.contains('hidden')) openStats();
      else closeStats();
      return;
    }

    // M — mute toggle (works any time, even on overlays)
    if (e.code === 'KeyM' && !inField) {
      e.preventDefault();
      state.muted = !state.muted;
      writeMuted(state.muted);
      Sfx.applyMute();
      BGM.setMuted(state.muted);
      applyMuteUI();
      return;
    }
    // T — cycle theme (void → sunset → forest → void). Works any time so the
    // player can A/B palettes mid-run if they want. Play the click tick so
    // the press feels committed rather than silent.
    if (e.code === 'KeyT' && !inField && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      Sfx.init(); Sfx.click();
      cycleTheme();
      state.targetPopT = 1;
      return;
    }
    // P — pause toggle (only while a run is active and help isn't blocking)
    if (e.code === 'KeyP' && !inField) {
      if (!state.running || state.over) return;
      if (!helpEl.classList.contains('hidden')) return;   // help is open → P is inert
      e.preventDefault();
      if (!state.paused) {
        pauseGame();
      } else if (state.resumeAt) {
        // mid-countdown → abort it back to indefinite pause
        state.resumeAt = 0;
        pauseCountdownEl.textContent = 'paused';
        pauseCountdownEl.classList.remove('number');
      } else {
        // currently paused indefinitely → start the resume countdown
        beginResumeCountdown();
      }
      return;
    }

    if (e.code !== 'Space' && e.code !== 'Enter') return;
    if (inField) return;
    e.preventDefault();
    if (!state.running && !state.over) {
      Sfx.init(); Sfx.click();
      start();
      return;
    }
    handleInputAction();
  });

  // Mute toggle
  function applyMuteUI() {
    muteIconOn.style.display  = state.muted ? 'none' : '';
    muteIconOff.style.display = state.muted ? '' : 'none';
    btnMute.classList.toggle('muted', state.muted);
    btnMute.setAttribute('aria-pressed', state.muted ? 'true' : 'false');
    btnMute.setAttribute('title', state.muted ? 'Unmute' : 'Mute');
  }
  btnMute.addEventListener('click', (e) => {
    e.stopPropagation();
    state.muted = !state.muted;
    writeMuted(state.muted);
    Sfx.applyMute();
    BGM.setMuted(state.muted);
    applyMuteUI();
  });
  applyMuteUI();

  // ---------- Share ----------
  // Compose score text + try native share, else copy to clipboard, else prompt.
  // Button only shows when the browser can do SOMETHING with it.
  const canShare = typeof navigator.share === 'function';
  const canCopy  = !!(navigator.clipboard && navigator.clipboard.writeText);
  function shareUrl() {
    // For seeded runs, build an explicit ?seed=YYYYMMDD URL so the recipient
    // gets the exact sequence — not `?daily=1`, which would re-resolve to
    // *their* today's seed when they open it (different run!).
    if (SEED === null) return location.href;
    const url = new URL(location.href);
    url.searchParams.delete('daily');
    url.searchParams.set('seed', String(SEED));
    return url.toString();
  }
  function shareScore() {
    const prefix = SEED !== null
      ? 'void-pulse · Daily ' + formatSeedLabel(SEED) + ': '
      : 'I scored ';
    const base = prefix + state.score +
      (SEED !== null ? ' — can you beat it?' : ' in void-pulse') +
      (state.newBestThisRun ? ' (new best!)' : '') +
      ' ' + shareUrl();
    if (canShare) {
      navigator.share({ title: 'void-pulse', text: base }).catch(() => {});
      return;
    }
    if (canCopy) {
      navigator.clipboard.writeText(base).then(() => {
        const prev = shareBtn.querySelector('span').textContent;
        shareBtn.classList.add('copied');
        shareBtn.querySelector('span').textContent = 'Copied!';
        setTimeout(() => {
          shareBtn.classList.remove('copied');
          shareBtn.querySelector('span').textContent = prev;
        }, 1600);
      }).catch(() => {});
    }
  }
  shareBtn.addEventListener('click', (e) => { e.stopPropagation(); shareScore(); });
  shareBtn.addEventListener('pointerdown', (e) => e.stopPropagation());

  function retriggerClass(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  // Screen-reader announcer — a single polite live-region used for the
  // handful of moments that justify interrupting the player's focus:
  // milestone tier changes, new best, streak bump, life lost, gameover.
  // The visual HUD is aria-hidden precisely so this region speaks instead
  // of firing one announcement per score tick.
  //
  // Debounce: many events can flood at once (a perfect tap crosses a
  // milestone AND bumps score past best AND unlocks an achievement). We
  // coalesce repeated calls in the same tick via a trailing setTimeout(0)
  // so the screen reader hears the *last* coalesced message, not five
  // truncated half-readings.
  const srAnnounceEl = document.getElementById('srAnnounce');
  let _srPending = null;
  let _srLastTiers = { mult: 1, streak: 0 };
  function announce(msg) {
    if (!srAnnounceEl || !msg) return;
    _srPending = msg;
    if (_srPending !== null) {
      // Clearing the text first forces assistive tech to re-read the new
      // string even if it's identical to the prior one (same-string reads
      // are often silently skipped otherwise).
      srAnnounceEl.textContent = '';
      setTimeout(() => {
        if (_srPending === null) return;
        srAnnounceEl.textContent = _srPending;
        _srPending = null;
      }, 0);
    }
  }
  function announceMilestoneTier(mult) {
    // Fire only on *tier change* (integer-mult transitions), not every ×5
    // combo bump. Examples: 1 → 1.5 (first tier), 2.5 → 3 (cap reached).
    // Guarded by _srLastTiers so re-entering a tier after a miss re-counts.
    if (mult === _srLastTiers.mult) return;
    _srLastTiers.mult = mult;
    announce('Multiplier ' + (mult % 1 === 0 ? mult : mult.toFixed(1)) + ' times');
  }
  function resetSrTierCache() {
    _srLastTiers.mult = 1;
    _srLastTiers.streak = 0;
  }

  // Draw last-N runs as a sparkline of bars. Normalized to the best value
  // shown so bar heights are meaningful relative to the player's ceiling.
  // Latest run = accent; best-of-window = gold; others muted.
  //
  // Sprint 37: extracted the bar-drawing logic into `fillSparkline` so the
  // stats panel can reuse it with a different target SVG + dimensions. The
  // gameover `renderHistory` keeps its visibility toggle (hides the whole
  // `#history` container when empty) because the stats panel handles its
  // empty state at a different level (the `.stats-empty` class on the
  // parent overlay hides the whole sparkline row via CSS).
  const SPARK_NS = 'http://www.w3.org/2000/svg';
  function fillSparkline(svgEl, scores, W, H, SLOTS) {
    while (svgEl.firstChild) svgEl.removeChild(svgEl.firstChild);
    if (!scores || scores.length === 0) return;
    const maxScore = Math.max(1, ...scores);
    const bestIdx  = scores.lastIndexOf(maxScore); // rightmost tie so latest-tie lights gold
    const latest   = scores.length - 1;
    const slotW = W / SLOTS;
    const barW  = Math.max(6, slotW - 4);
    const base = document.createElementNS(SPARK_NS, 'line');
    base.setAttribute('class', 'hline');
    base.setAttribute('x1', '0'); base.setAttribute('x2', String(W));
    base.setAttribute('y1', String(H - 0.5)); base.setAttribute('y2', String(H - 0.5));
    svgEl.appendChild(base);
    const offset = SLOTS - scores.length;
    for (let i = 0; i < scores.length; i++) {
      const v = scores[i];
      const h = Math.max(2, Math.round((v / maxScore) * (H - 4)));
      const x = (offset + i) * slotW + (slotW - barW) / 2;
      const y = H - h;
      const rect = document.createElementNS(SPARK_NS, 'rect');
      rect.setAttribute('class',
        'hbar' + (i === latest ? ' latest' : '') + (i === bestIdx && i !== latest ? ' best' : ''));
      rect.setAttribute('x', String(x));
      rect.setAttribute('y', String(y));
      rect.setAttribute('width',  String(barW));
      rect.setAttribute('height', String(h));
      rect.setAttribute('rx', '1');
      svgEl.appendChild(rect);
    }
  }
  function renderHistory(scores) {
    if (!scores || scores.length === 0) {
      historyEl.style.display = 'none';
      while (historySvg.firstChild) historySvg.removeChild(historySvg.firstChild);
      return;
    }
    historyEl.style.display = '';
    fillSparkline(historySvg, scores, 120, 28, RUN_HISTORY_CAP);
  }
  // Prime gameover history on first paint so returning players see their trend.
  renderHistory(readHistory());

  // Ghost timeline: two strips (current run + stored best for this seed).
  // Renders nothing (and hides the container) if:
  //   - seed is not set (free-play → no ghost concept)
  //   - no stored ghost exists yet (first visit to this seed)
  // The "This run" strip always draws from state.runEvents; the "Best" strip
  // draws from the ghost read off storage.
  const GHOST_W = 220, GHOST_H = 10, GHOST_R = 2.3;
  const GHOST_COLOR = { p: '#5de4b4', g: '#ffd24a', m: '#ff3d6b' };
  // Total window for the left-to-right reveal animation. A shared axis means
  // both strips' dots stagger against the same timeline, so the reveal itself
  // reproduces the pacing of the run — the "Best" strip keeps going after
  // "This run" finishes when the current run died early.
  const GHOST_REVEAL_MS = 900;
  function renderGhostOne(svg, events, duration) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    // baseline track — thin line through the middle gives the dots a spine
    const line = document.createElementNS(SPARK_NS, 'line');
    line.setAttribute('class', 'gtrack');
    line.setAttribute('x1', '1'); line.setAttribute('x2', String(GHOST_W - 1));
    line.setAttribute('y1', String(GHOST_H / 2)); line.setAttribute('y2', String(GHOST_H / 2));
    svg.appendChild(line);
    if (!events || events.length === 0 || !duration || duration <= 0) return;
    const innerW = GHOST_W - GHOST_R * 2;
    for (const e of events) {
      const t = e[0], kind = e[1];
      if (t < 0 || t > duration) continue;
      const cx = GHOST_R + (t / duration) * innerW;
      const dot = document.createElementNS(SPARK_NS, 'circle');
      dot.setAttribute('class', 'gdot');
      dot.setAttribute('cx', cx.toFixed(2));
      dot.setAttribute('cy', String(GHOST_H / 2));
      dot.setAttribute('r', String(GHOST_R));
      dot.setAttribute('fill', GHOST_COLOR[kind] || '#888');
      // Per-dot animation-delay drives the left-to-right stagger. Expressed
      // as an inline style so CSS doesn't need to know the event count; the
      // @keyframes + base animation live in style.css. Reduced-motion users
      // get animation:none there, so this delay is inert (harmless) for them.
      const delay = (t / duration) * GHOST_REVEAL_MS;
      dot.setAttribute('style', 'animation-delay:' + delay.toFixed(0) + 'ms');
      svg.appendChild(dot);
    }
  }
  function renderGhost(currentRun, bestGhost) {
    if (GHOST_KEY === null || !bestGhost) {
      ghostEl.hidden = true;
      return;
    }
    ghostEl.hidden = false;
    // Normalize "this run" duration to the best's for apples-to-apples pacing.
    // If the current run ended early (died fast), its events bunch to the left —
    // that's meaningful signal, not a bug. Use the longer of the two as the axis.
    const axisDur = Math.max(bestGhost.duration || 0, currentRun.duration || 0) || 1;
    renderGhostOne(ghostSvgNow, currentRun.events, axisDur);
    renderGhostOne(ghostSvgBest, bestGhost.events, axisDur);
    // Audio-visual chord: one soft tick per perfect in the player's CURRENT
    // run, scheduled in lockstep with the visual reveal (Sprint 21). Gated on
    // reduced-motion so motion-sensitive players — who skip the reveal — don't
    // hear ticks against an already-rendered strip. Muting is handled by the
    // master-bus gain, so no explicit state.muted check needed here.
    if (!reducedMotion && Sfx.ctx && currentRun.events) {
      for (const e of currentRun.events) {
        const t = e[0], kind = e[1];
        if (kind !== 'p') continue;
        if (t < 0 || t > axisDur) continue;
        const delaySec = (t / axisDur) * GHOST_REVEAL_MS / 1000;
        Sfx.ghostTick(delaySec);
      }
    }
    // "Best · 1234 · 3d ago". Omit relative time if `at` is missing (old
    // schema or corruption) rather than rendering a misleading "55+y ago".
    const score = (typeof bestGhost.score === 'number') ? bestGhost.score : '—';
    const rel = (typeof bestGhost.at === 'number' && bestGhost.at > 0)
      ? ' · ' + formatRelative(bestGhost.at, Date.now())
      : '';
    if (ghostBestMeta) ghostBestMeta.textContent = '· ' + score + rel;
  }

  // Format an "atMs" timestamp as a coarse relative string. Buckets:
  //   < 60s     → "just now"
  //   < 60min   → "Nm ago"
  //   today     → "Nh ago"
  //   yesterday → "yesterday"
  //   else      → "Nd ago"  (or "30+d ago" for older)
  function formatRelative(atMs, now) {
    const diffMs = Math.max(0, now - atMs);
    if (diffMs < 60000) return 'just now';
    const min = Math.floor(diffMs / 60000);
    if (min < 60) return min + 'm ago';
    const at = new Date(atMs);
    const todayLocal = new Date(now);
    const sameDay = at.getFullYear() === todayLocal.getFullYear()
      && at.getMonth() === todayLocal.getMonth()
      && at.getDate() === todayLocal.getDate();
    if (sameDay) return Math.floor(min / 60) + 'h ago';
    const startOfTodayMs = new Date(todayLocal.getFullYear(), todayLocal.getMonth(), todayLocal.getDate()).getTime();
    const startOfAtDayMs = new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
    const days = Math.round((startOfTodayMs - startOfAtDayMs) / 86400000);
    if (days === 1) return 'yesterday';
    if (days >= 30) return '30+d ago';
    return days + 'd ago';
  }
  const RANK_LABELS = ['1st', '2nd', '3rd', '4th', '5th'];
  function renderLeaderboard(board, highlightAtMs) {
    while (leaderboardListEl.firstChild) leaderboardListEl.removeChild(leaderboardListEl.firstChild);
    if (!board.length) {
      leaderboardEl.hidden = true;
      return;
    }
    leaderboardEl.hidden = false;
    const now = Date.now();
    for (let i = 0; i < board.length; i++) {
      const e = board[i];
      const li = document.createElement('li');
      li.className = 'lb-row';
      if (highlightAtMs && e.atMs === highlightAtMs) li.classList.add('lb-new');
      if (i === 0) li.classList.add('lb-top');
      const rank = document.createElement('span');
      rank.className = 'lb-rank';
      rank.textContent = RANK_LABELS[i] || (i + 1) + 'th';
      const score = document.createElement('span');
      score.className = 'lb-score';
      score.textContent = String(e.score);
      const when = document.createElement('span');
      when.className = 'lb-when';
      when.textContent = formatRelative(e.atMs, now);
      li.appendChild(rank);
      li.appendChild(score);
      li.appendChild(when);
      leaderboardListEl.appendChild(li);
    }
  }
  // Prime once so the leaderboard is visible if the player has prior runs even
  // before they finish today's first run.
  renderLeaderboard(readBoard(), 0);

  // ---------- Streak + achievement renderers ----------
  function renderStreakStart() {
    const s = readStreak();
    // Start-overlay badge is only meaningful if the player has an *active*
    // streak — today or yesterday. If neither, we show nothing (otherwise a
    // 1-month-old streak of 4 sits there forever mocking the player).
    if (s.streak <= 0) { streakStartEl.hidden = true; return; }
    const today = todayYyyymmdd();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yYyyymmdd = yyyymmddOf(yesterday);
    const active = s.lastYyyymmdd === today || s.lastYyyymmdd === yYyyymmdd;
    if (!active) { streakStartEl.hidden = true; return; }
    streakStartEl.hidden = false;
    streakStartNum.textContent = s.streak;
    if (s.best > s.streak) {
      streakStartBest.hidden = false;
      streakStartBestNum.textContent = s.best;
    } else {
      streakStartBest.hidden = true;
    }
  }
  function renderStreakGameover(streakData, bumped) {
    if (!streakData) { gameoverStreakEl.hidden = true; return; }
    gameoverStreakEl.hidden = false;
    gameoverStreakNum.textContent = streakData.streak;
    if (streakData.best > streakData.streak) {
      gameoverStreakBest.hidden = false;
      gameoverStreakBestNum.textContent = streakData.best;
    } else {
      gameoverStreakBest.hidden = true;
    }
    gameoverStreakEl.classList.remove('streak-bumped');
    if (bumped) {
      // force reflow so the animation restarts if re-rendered fast
      void gameoverStreakEl.offsetWidth;
      gameoverStreakEl.classList.add('streak-bumped');
    }
  }
  function renderAchievements(unlocked, justNow) {
    while (achListEl.firstChild) achListEl.removeChild(achListEl.firstChild);
    const justSet = new Set(justNow || []);
    let total = 0;
    for (const a of ACHIEVEMENTS) {
      const li = document.createElement('li');
      li.className = 'ach-chip';
      const isUnlocked = !!unlocked[a.id];
      if (isUnlocked) { li.classList.add('unlocked'); total++; }
      if (justSet.has(a.id)) li.classList.add('just');
      const dot = document.createElement('span');
      dot.className = 'ach-dot';
      dot.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span');
      label.className = 'ach-label';
      label.textContent = a.label;
      const desc = document.createElement('span');
      desc.className = 'ach-desc';
      desc.textContent = a.desc;
      li.title = a.desc + (isUnlocked ? '' : ' (locked)');
      li.appendChild(dot);
      li.appendChild(label);
      li.appendChild(desc);
      achListEl.appendChild(li);
    }
    achProgressEl.textContent = total + ' / ' + ACHIEVEMENTS.length;
    achievementsEl.hidden = false;
  }
  // Prime the start overlay streak badge on load.
  renderStreakStart();

  // First-visit onboarding: on the very first boot the start overlay gets a
  // hint banner + pulsing Start button. Driven by a CSS parent class so the
  // JS stays a one-line decision. Cleared atomically on the first Start tap.
  if (!readSeen()) overlay.classList.add('first-visit');

  // ---------- Judging ----------
  function perfectWindowMs() {
    return Math.min(PERFECT_WINDOW_MS_MAX, PERFECT_WINDOW_MS_BASE + Math.max(0, (state.t - GRACE_START_T) * 0.12));
  }

  // Judge the pulse whose current radius is closest to the target ring.
  // Prior versions judged the "oldest" pulse, but per-pulse speed is locked
  // at spawn, so a newer fast pulse can overtake an older slow one — in which
  // case "oldest" disagrees with the player's visual expectation.
  function findJudgePulse() {
    let chosen = null;
    let bestD = Infinity;
    for (const p of pulses) {
      if (!p.active) continue;
      const d = Math.abs(p.r - TARGET_R);
      if (d < bestD) { bestD = d; chosen = p; }
    }
    return chosen;
  }

  function comboMult() {
    return Math.min(COMBO_MULT_MAX, 1 + Math.floor(state.combo / COMBO_STEP) * 0.5);
  }

  function judgeTap() {
    const p = findJudgePulse();
    if (!p) return; // lenient: tapping with no pulse costs nothing
    const dMs = Math.abs(p.r - TARGET_R) / p.speed * 1000;
    const pwMs = perfectWindowMs();
    const heartbeatMul = p.heartbeat ? HEARTBEAT_BONUS : 1;

    // Hazard tap — the whole point of hazards is to NOT tap them. Only
    // register if the tap is within the judge window (otherwise it's a
    // tap-into-empty-space, which we ignore leniently). A tapped hazard:
    // breaks combo, costs a life, debits score, triggers a red-wash pulse.
    if (p.kind === 'h') {
      if (dMs <= GOOD_WINDOW_MS) {
        p.active = false;
        recordRunEvent('m');
        state.score = Math.max(0, state.score - HAZARD_TAP_PENALTY);
        state.hazardHitT = 0.28;
        spawnBurst(CENTER_X, CENTER_Y, getVar('--danger'), 18, 320);
        if (!state.deathCam) {
          loseLife();
          state.shakeT = 0.24;
          retriggerClass(app, 'shake');
          haptic(30);
          if (typeof Sfx.hazardHit === 'function') Sfx.hazardHit();
          else Sfx.miss();
          // Sidechain duck: BGM drops ~65% under the hazard SFX transient so
          // the punishment lands clean, then recovers as the red wash fades.
          if (typeof BGM.duck === 'function') BGM.duck();
        }
      }
      // Early-tap on a hazard is swallowed — same forgiveness as normal.
      return;
    }

    if (dMs <= pwMs) {
      const mult = comboMult();
      state.score += Math.round(100 * mult * heartbeatMul);
      state.combo += 1;
      state.perfectCount += 1;
      state.hitCount += 1;
      recordRunEvent('p');
      // Juice — Sprint 29: doubled particle count on perfect + chromatic
      // aberration ring flash + stronger target-pop. The aim is "rewarding
      // thud" on every perfect so the mechanic feels explosive, not just
      // counted. Good hits stay restrained so perfect still reads as better.
      spawnBurst(CENTER_X, CENTER_Y, p.heartbeat ? getVar('--danger') : getVar('--accent'), 24, 380);
      state.targetPopT = 0.24;
      state.perfectFlashT = 0.14;
      Sfx.score(state.combo);
      if (p.heartbeat) Sfx.heartbeat();
      if (state.combo > 0 && state.combo % COMBO_STEP === 0) {
        const m = comboMult();
        state.comboMilestoneText = '×' + (m % 1 === 0 ? m : m.toFixed(1));
        state.comboMilestoneFade = 0.9;
        state.comboBloomT = 0.35;    // fullscreen radial flash
        Sfx.levelup();
        // Peak-tier sweetener: ≥3x multiplier (combo ≥ 20) earns a theme
        // overtone layered on top of levelup. Sparse by design — gated on
        // the tier so it's "you arrived at the top", not "you hit another 5".
        if (m >= 3) Sfx.themeSweeten();
        // Announce milestones at TIER changes only (first time hitting each
        // multiplier). Every-5 announcements would be as spammy as the old
        // score live-region. Floor-of-mult transition = tier change.
        announceMilestoneTier(m);
      }
      p.active = false;
    } else if (dMs <= GOOD_WINDOW_MS) {
      const mult = comboMult();
      state.score += Math.round(50 * mult * heartbeatMul);
      state.combo += 1;
      state.hitCount += 1;
      recordRunEvent('g');
      spawnBurst(CENTER_X, CENTER_Y, getVar('--accent'), 10, 240);
      Sfx.good(Math.max(0, state.combo - 2));
      p.active = false;
    } else {
      // Early-tap forgiveness: if the player taps before the pulse arrives
      // and within the grace-lead window, swallow the input instead of punishing.
      // Late taps (past the target) still count as miss — no spam-through.
      const toArriveMs = (TARGET_R - p.r) / p.speed * 1000;
      if (toArriveMs > 0 && toArriveMs <= EARLY_TAP_LEAD_MS) {
        return; // swallowed
      }
      p.active = false;
      recordRunEvent('m');
      loseLife();
      Sfx.miss();
      state.shakeT = 0.2;
      retriggerClass(app, 'shake');
      haptic(20);
    }
    if (state.combo > state.peakCombo) state.peakCombo = state.combo;
  }
  // Append one outcome tuple unless we've already capped the run (very long
  // sessions past 90 seconds can easily exceed GHOST_EVENT_CAP). Storing only
  // `[t, kind]` keeps a full run under ~2KB even uncompressed.
  function recordRunEvent(kind) {
    if (GHOST_KEY === null) return;               // free-play = no ghost
    if (state.runEvents.length >= GHOST_EVENT_CAP) return;
    state.runEvents.push([+state.t.toFixed(2), kind]);
  }

  function loseLife() {
    state.combo = 0;
    state.missCount += 1;
    _srLastTiers.mult = 1;    // reset so next milestone announces fresh
    const lostIdx = state.lives - 1;
    state.lives -= 1;
    updateLivesUI();
    // Announce only the count of lives remaining (not "life lost") so the
    // message is actionable: player hears "2 lives" and knows how close to
    // death they are. Gameover has its own announcement below.
    if (state.lives > 0) {
      announce(state.lives + ' ' + (state.lives === 1 ? 'life' : 'lives') + ' left');
    }
    // Flash the just-lost glyph so the player perceives the hit at HUD level,
    // not just as a missed pulse on the canvas.
    const glyphs = hudLives.querySelectorAll('.life');
    if (lostIdx >= 0 && glyphs[lostIdx]) retriggerClass(glyphs[lostIdx], 'lost-flash');
    if (state.lives <= 0 && !state.deathCam) {
      // Enter death-cam: slow the sim for a dramatic beat before the
      // gameover overlay. Fires exactly once (guarded on !deathCam) so a
      // cascading miss during slow-mo can't reset the timer.
      // The caller (judgeTap / expiring-pulse handler) already played the
      // miss SFX / shake / haptic; we just add a bigger red burst to mark
      // this as the FATAL one.
      state.deathCam = true;
      state.deathCamT = DEATHCAM_DURATION_S;
      spawnBurst(CENTER_X, CENTER_Y, getVar('--danger'), 18, 340);
      haptic([30, 40, 80]);
      app.classList.add('deathcam');
    }
  }

  function ensureLifeGlyphs(n) {
    let glyphs = hudLives.querySelectorAll('.life');
    while (glyphs.length < n) {
      const span = document.createElement('span');
      span.className = 'life';
      span.textContent = '\u25EF'; // ◯
      hudLives.appendChild(span);
      glyphs = hudLives.querySelectorAll('.life');
    }
    while (glyphs.length > n) {
      hudLives.removeChild(glyphs[glyphs.length - 1]);
      glyphs = hudLives.querySelectorAll('.life');
    }
    return glyphs;
  }
  function updateLivesUI() {
    // Render exactly max(STARTING_LIVES, state.lives) glyphs so a granted
    // bonus life is actually visible (was previously invisible — state.lives
    // could be 4 while only 3 glyphs existed in the HTML).
    const totalSlots = Math.max(STARTING_LIVES, state.lives);
    const glyphs = ensureLifeGlyphs(totalSlots);
    for (let i = 0; i < glyphs.length; i++) {
      const alive = i < state.lives;
      glyphs[i].style.opacity = alive ? '1' : '0.25';
      glyphs[i].style.color = alive ? 'var(--accent)' : 'var(--subtle)';
    }
  }

  // ---------- Beat indicator (Sprint 32) ----------
  // Small HUD ring that flashes on every quarter-note (500ms at 120 BPM).
  // Downbeats (every 4th quarter = bar start) get an accent pulse in the
  // accent color. Driven off state.t so it keeps its anchor role even when
  // the BGM is muted or the AudioContext has yet to initialize.
  const BEAT_S = BEAT_MS / 1000;    // 0.5s at 120 BPM
  let lastBeatIdx = -1;
  let beatPulseTimer = null;
  let lastBeatBand = null;
  function resetBeatIndicator() {
    lastBeatIdx = -1;
    lastBeatBand = null;
    if (beatPulseTimer) { clearTimeout(beatPulseTimer); beatPulseTimer = null; }
    if (beatEl) {
      beatEl.classList.remove('active', 'pulse', 'pulse-accent');
      beatEl.removeAttribute('data-band');
    }
  }
  function tickBeatIndicator() {
    if (!beatEl) return;
    const offsetS = state.t - CHART_LEAD_IN_S;
    if (offsetS < 0) return;
    const beatIdx = Math.floor(offsetS / BEAT_S);
    if (beatIdx === lastBeatIdx) return;
    lastBeatIdx = beatIdx;
    if (!beatEl.classList.contains('active')) beatEl.classList.add('active');
    // Tint by current band so the beat ring mirrors BGM dynamics (calm/tense/
    // peak/resolve). Only updates the attribute when the band changes, so CSS
    // can key off [data-band=...] without per-beat churn.
    const barIdx = Math.min(BARS - 1, Math.max(0, Math.floor(beatIdx / 4)));
    const band = BAND_SCHEDULE[barIdx];
    if (band !== lastBeatBand) {
      beatEl.dataset.band = band;
      lastBeatBand = band;
    }
    // Retrigger the animation by removing + reflowing + adding class.
    beatEl.classList.remove('pulse', 'pulse-accent');
    void beatEl.offsetWidth;   // force reflow so animation restarts
    const isDownbeat = (beatIdx % 4) === 0;   // 4 quarters per bar
    beatEl.classList.add(isDownbeat ? 'pulse-accent' : 'pulse');
  }

  // ---------- Spawning (chart-driven, Sprint 29) ----------
  // Build the full 60-second chart at start-of-run from the seeded RNG.
  // The chart is a flat array of `{arriveT, kind, speed, accent}` entries
  // sorted by arrival time. Every entry's `arriveT` lands on an 8th-note
  // beat so taps feel musical; the spawner back-calculates `spawnT` from
  // pulse speed so the pulse reaches TARGET_R exactly on the beat.
  function pickTemplate(band) {
    const pool = BAR_TEMPLATES[band];
    const idx = Math.floor(rng() * pool.length) % pool.length;
    return pool[idx];
  }
  function generateChart() {
    const events = [];
    let normals = 0;
    for (let bar = 0; bar < BARS; bar++) {
      const band = BAND_SCHEDULE[bar];
      const tmpl = pickTemplate(band);
      const barStartMs = bar * SLOTS_PER_BAR * EIGHTH_MS;
      const speed = BAND_SPEED[band];
      for (let slot = 0; slot < SLOTS_PER_BAR; slot++) {
        const c = tmpl[slot];
        if (c === '_') continue;
        const arriveT = (barStartMs + slot * EIGHTH_MS) / 1000 + CHART_LEAD_IN_S;
        const accent = (slot === 0);   // downbeat emphasis (the old "heartbeat")
        events.push({ arriveT, kind: c === 'H' ? 'h' : 'n', speed, accent });
        if (c === 'N') normals += 1;
      }
    }
    // Exact achievable max: simulate the chart as "every normal = perfect,
    // every hazard = dodged" with the real combo-ramp multiplier. That way
    // a literal perfect run scores exactly 100% — not 94% of some inflated
    // ceiling. Ramps the multiplier 1 → 4 over the first 30 combos (COMBO_STEP
    // × (COMBO_MULT_MAX − 1) ÷ 0.5 = 30) the same as live scoring.
    let maxScore = 0;
    let comboSim = 0;
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

  // Spawn one pulse from a chart event. Called by the update loop when
  // `state.t + leadTime >= ev.arriveT`. Pulse travels from r=0 to TARGET_R
  // at constant speed so the arrival lands on the beat.
  function spawnChartPulse(ev) {
    for (const p of pulses) {
      if (p.active) continue;
      p.active = true;
      p.r = 0;
      p.prevR = 0;
      p.speed = ev.speed;
      p.heartbeat = ev.accent;           // downbeat = heartbeat accent (cosmetic)
      p.kind = ev.kind;                    // 'n' normal, 'h' hazard
      p.bornT = state.t;
      // Spawn tick uses accent flag for a downbeat pitch bump. Hazards get
      // a lower, buzzier cue via Sfx.hazardSpawn() if available (falls back
      // to spawnTick on compat).
      if (p.kind === 'h' && typeof Sfx.hazardSpawn === 'function') Sfx.hazardSpawn();
      else Sfx.spawnTick(p.heartbeat);
      state.pulsesSpawned += 1;
      return p;
    }
    return null;
  }

  // ---------- Particles ----------
  function spawnBurst(x, y, color, n, speed) {
    let spawned = 0;
    for (const p of particles) {
      if (p.active) continue;
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.5 + Math.random() * 0.8);
      p.active = true;
      p.x = x; p.y = y;
      p.vx = Math.cos(a) * s;
      p.vy = Math.sin(a) * s;
      p.life = p.max = 0.5 + Math.random() * 0.3;
      p.color = color;
      p.size = 3 + Math.random() * 3;
      if (++spawned >= n) break;
    }
  }

  function updateParticles(dt) {
    for (const p of particles) {
      if (!p.active) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 450 * dt;   // light gravity
      p.vx *= 0.98;
      p.life -= dt;
      if (p.life <= 0) p.active = false;
    }
  }

  function renderParticles() {
    for (const p of particles) {
      if (!p.active) continue;
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Ambient drift — subtle per-theme decoration. Void has no drift (starfield
  // carries the atmosphere); sunset drifts upward like embers; forest drifts
  // downward like petals with wide horizontal sway. On reduced-motion we skip
  // the update entirely, so the particles sit frozen as if the air is still.
  function updateAmbient(dt) {
    if (currentTheme === 'void') return;
    if (reducedMotion) return;
    const dir = currentTheme === 'forest' ? 1 : -1;   // +down / -up
    const t = state.t;
    for (const a of ambient) {
      a.y += dir * a.vBase * dt;
      // sway via phase-locked sine — each particle has its own rate+amp so
      // they don't visibly march in lockstep
      a.x += Math.sin(t * a.swayRate + a.phase) * a.swayAmp * dt;
      // soft horizontal wrap so particles don't pile up at an edge
      if (a.x < -12) a.x = W + 12;
      else if (a.x > W + 12) a.x = -12;
      // vertical wrap = respawn on the opposite side with a fresh x/phase
      if (dir < 0 && a.y < -14) {
        a.y = H + 14;
        a.x = Math.random() * W;
        a.phase = Math.random() * Math.PI * 2;
      } else if (dir > 0 && a.y > H + 14) {
        a.y = -14;
        a.x = Math.random() * W;
        a.phase = Math.random() * Math.PI * 2;
      }
    }
  }
  function renderAmbient() {
    if (currentTheme === 'void') return;
    // Color follows the theme's accent; alpha is low so the layer reads as
    // atmosphere, not foreground. Flicker via phase for sunset embers only.
    const isEmber = currentTheme === 'sunset';
    ctx.fillStyle = getVar('--accent');
    const t = state.t;
    for (const a of ambient) {
      const baseA = 0.10 + (a.size - 1.2) * 0.05;     // bigger = more visible
      const flicker = isEmber ? 0.5 + 0.5 * Math.sin(t * 3.2 + a.phase) : 1;
      ctx.globalAlpha = baseA * (0.6 + 0.4 * flicker);
      if (isEmber) {
        // small circle dot for embers
        ctx.beginPath();
        ctx.arc(a.x, a.y, a.size, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // elongated oval for petals — fake it via scaled rect saving a save/restore
        ctx.fillRect(a.x - a.size * 0.5, a.y - a.size * 1.1, a.size, a.size * 2.2);
      }
    }
    ctx.globalAlpha = 1;
  }

  // ---------- 5. Update ----------
  function update(dt) {
    // Death-cam: the sim keeps running but at a fraction of real-time so the
    // fatal moment is readable. Timer itself uses real dt so the slow-mo
    // always ends on a fixed wall-clock (0.55s) — predictable.
    if (state.deathCam) {
      state.deathCamT -= dt;
      if (state.deathCamT <= 0) {
        state.deathCam = false;
        app.classList.remove('deathcam');
        gameover();
        return;
      }
    }
    const simDt = state.deathCam ? dt * DEATHCAM_TIME_SCALE : dt;

    state.t += simDt;

    // Chart-driven spawning. Each event's `arriveT` is its ON-BEAT tap time;
    // spawn happens (TARGET_R / speed) seconds earlier so the ring reaches
    // the target exactly on the beat. Events are sorted so we only need to
    // check the head pointer each frame.
    if (!state.deathCam && state.chart) {
      while (state.chartIdx < state.chart.length) {
        const ev = state.chart[state.chartIdx];
        const leadS = TARGET_R / ev.speed;
        if (state.t >= ev.arriveT - leadS) {
          spawnChartPulse(ev);
          state.chartIdx += 1;
        } else {
          break;
        }
      }
      if (!state.chartDone && state.chartIdx >= state.chart.length) {
        state.chartDone = true;
      }
    }

    // Beat indicator tick — visual metronome locked to the chart's quarter-
    // note grid (500ms at 120 BPM). Driven from state.t so it anchors the
    // player even when BGM is muted. Accent (brighter/larger pulse) every 4
    // quarters = bar downbeat. First beat is at CHART_LEAD_IN_S.
    tickBeatIndicator();

    state.tensionFlash = false;
    let anyActive = false;
    for (const p of pulses) {
      if (!p.active) continue;
      anyActive = true;
      p.r += p.speed * simDt;
      // Time-to-arrive (negative = already past)
      const toArriveMs = (TARGET_R - p.r) / p.speed * 1000;
      if (toArriveMs <= TENSION_LEAD_MS && toArriveMs >= -GOOD_WINDOW_MS) {
        state.tensionFlash = true;
      }
      if (toArriveMs < -GOOD_WINDOW_MS) {
        p.active = false;
        if (p.kind === 'h') {
          // Correctly ignored a hazard — reward with bonus, keep combo alive.
          if (!state.deathCam) {
            state.score += HAZARD_PASS_BONUS;
            state.hazardPassed += 1;
            state.hazardClearT = 0.22;
            spawnBurst(CENTER_X, CENTER_Y, getVar('--subtle'), 6, 140);
            if (typeof Sfx.hazardPass === 'function') Sfx.hazardPass();
          }
        } else if (!state.deathCam) {
          // Missed a normal pulse — cost a life.
          loseLife();
          state.shakeT = 0.15;
          retriggerClass(app, 'shake');
        }
      }
    }

    // Chart complete AND no more active pulses → victory gameover. Lets
    // the final pulses play out instead of slamming the overlay mid-scene.
    if (state.chartDone && !anyActive && !state.over && !state.deathCam) {
      gameover();
      return;
    }

    if (state.targetPopT > 0) state.targetPopT = Math.max(0, state.targetPopT - simDt);
    if (state.comboMilestoneFade > 0) state.comboMilestoneFade = Math.max(0, state.comboMilestoneFade - simDt);
    if (state.shakeT > 0) state.shakeT = Math.max(0, state.shakeT - dt);
    if (state.perfectFlashT > 0) state.perfectFlashT = Math.max(0, state.perfectFlashT - dt);
    if (state.comboBloomT > 0) state.comboBloomT = Math.max(0, state.comboBloomT - dt);
    if (state.hazardHitT > 0) state.hazardHitT = Math.max(0, state.hazardHitT - dt);
    if (state.hazardClearT > 0) state.hazardClearT = Math.max(0, state.hazardClearT - dt);

    updateParticles(simDt);
    updateAmbient(simDt);

    // Mid-run achievement evaluation: 4 rare-tier tests, cheap enough to run
    // each frame. Gated off the deathcam so the end-of-run stats page handles
    // normal unlocks; toasts fire only while the player is actually playing.
    if (!state.deathCam) {
      const justUnlocked = evaluateMidRunAchievements({
        score: state.score,
        peakCombo: state.peakCombo,
        perfectCount: state.perfectCount,
        hitCount: state.hitCount,
        missCount: state.missCount,
        duration: state.t,
        streak: 0,
      });
      for (const ach of justUnlocked) showAchievementToast(ach);
    }
  }

  // HUD diff-tracking — avoids DOM churn when values haven't changed.
  let lastDisplayedScore = 0;
  let hudScoreApproaching = false;
  let hudScoreBeaten = false;
  let lastComboFillPct = -1;
  let lastComboActive = false;

  // ---------- Pause (visibility / blur) ----------
  function pauseGame() {
    if (!state.running || state.over || state.paused) return;
    state.paused = true;
    state.resumeAt = 0;
    pauseCountdownEl.textContent = 'paused';
    pauseCountdownEl.classList.remove('number');
    pauseEl.classList.remove('hidden');
    pauseEl.classList.add('visible');
    pauseEl.setAttribute('aria-hidden', 'false');
    Sfx.setBus('duck');
    BGM.pause();
  }
  function beginResumeCountdown() {
    if (!state.paused) return;
    state.resumeAt = performance.now() + RESUME_COUNTDOWN_MS;
    pauseCountdownEl.classList.add('number');
  }
  function clearPauseOverlay() {
    pauseEl.classList.remove('visible');
    pauseEl.classList.add('hidden');
    pauseEl.setAttribute('aria-hidden', 'true');
    if (state.running && !state.over) {
      Sfx.setBus(hudScoreBeaten ? 'beaten' : 'normal');
    }
  }
  // ---------- Help modal ----------
  const helpEl = document.getElementById('help');
  const helpBtn = document.getElementById('helpBtn');
  const helpClose = document.getElementById('helpClose');
  let helpOpenedDuringRun = false;
  // Remember which element had focus before the modal opened, so we can
  // restore focus on close — keyboard users who opened via `?` shortcut
  // return to wherever they were, not into an arbitrary follow-up element.
  let helpOpener = null;
  function openHelp() {
    if (!helpEl.classList.contains('hidden')) return;
    helpOpener = document.activeElement;
    // If a run is active, auto-pause so opening help doesn't burn the player.
    helpOpenedDuringRun = state.running && !state.over && !state.paused;
    if (helpOpenedDuringRun) pauseGame();
    helpEl.classList.remove('hidden');
    helpEl.classList.add('visible');
    helpEl.setAttribute('aria-hidden', 'false');
    helpClose.focus();
    Sfx.setBus('duck');
  }
  function closeHelp() {
    if (helpEl.classList.contains('hidden')) return;
    helpEl.classList.remove('visible');
    helpEl.classList.add('hidden');
    helpEl.setAttribute('aria-hidden', 'true');
    if (helpOpenedDuringRun && state.paused && !state.resumeAt) {
      // Resume the run with the standard 3-2-1 countdown.
      beginResumeCountdown();
    } else if (!state.paused && state.running && !state.over) {
      Sfx.setBus(hudScoreBeaten ? 'beaten' : 'normal');
    } else if (state.over) {
      Sfx.setBus('duck');
    } else {
      Sfx.setBus('normal');
    }
    helpOpenedDuringRun = false;
    // Restore focus to the trigger element. Fall back to helpBtn if the
    // opener has been detached (e.g. a gameover-overlay button that
    // re-renders between open and close) or was the body (no prior focus).
    const validOpener = helpOpener && helpOpener !== document.body && document.body.contains(helpOpener);
    const target = validOpener ? helpOpener : helpBtn;
    helpOpener = null;
    if (target && typeof target.focus === 'function') {
      try { target.focus(); } catch { /* element may be focus-disabled */ }
    }
  }
  helpBtn.addEventListener('click', (e) => { e.stopPropagation(); openHelp(); });
  helpClose.addEventListener('click', (e) => { e.stopPropagation(); closeHelp(); });
  helpEl.addEventListener('click', (e) => {
    if (e.target === helpEl) closeHelp();   // click backdrop to close
  });

  // ---------- Stats panel (lifetime aggregates) ----------
  const statsEl = document.getElementById('statsPanel');
  const statsBtn = document.getElementById('statsBtn');
  const statsClose = document.getElementById('statsPanelClose');
  const statsReset = document.getElementById('statsReset');
  const statsExport = document.getElementById('statsExport');
  const statsSparkSvg = document.getElementById('statsSparkSvg');
  let statsOpenedDuringRun = false;
  function formatDuration(seconds) {
    seconds = Math.max(0, Math.floor(seconds));
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return h + 'h ' + m + 'm';
    if (m > 0) return m + 'm ' + s + 's';
    return s + 's';
  }
  function formatDate(ms) {
    if (!ms) return '—';
    const d = new Date(ms);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }
  function formatPercent(num, denom) {
    if (!denom) return '—';
    const p = (num / denom) * 100;
    return p >= 99.95 ? '100%' : p.toFixed(1) + '%';
  }
  function renderStats() {
    const l = readLifetime();
    // Gate "no data" state so the first-time opener sees helpful text, not
    // a wall of zeros that reads as broken.
    const empty = l.runs === 0;
    statsEl.classList.toggle('stats-empty', empty);
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    set('lsRuns',      l.runs.toLocaleString());
    set('lsTime',      formatDuration(l.totalSeconds));
    set('lsScore',     l.totalScore.toLocaleString());
    set('lsAvg',       l.runs ? Math.round(l.totalScore / l.runs).toLocaleString() : '—');
    set('lsBest',      l.bestScoreEver.toLocaleString());
    set('lsPeakCombo', l.peakComboEver.toLocaleString());
    set('lsPerfects',  l.totalPerfects.toLocaleString());
    set('lsHits',      l.totalHits.toLocaleString());
    set('lsMisses',    l.totalMisses.toLocaleString());
    // Rates — perfect rate over all hits; accuracy over all taps (hits + misses).
    set('lsPerfectRate', formatPercent(l.totalPerfects, l.totalHits));
    set('lsAccuracy',    formatPercent(l.totalHits, l.totalHits + l.totalMisses));
    set('lsBestVoid',    l.bestPerTheme.void.toLocaleString());
    set('lsBestSunset',  l.bestPerTheme.sunset.toLocaleString());
    set('lsBestForest',  l.bestPerTheme.forest.toLocaleString());
    set('lsFirst',       formatDate(l.firstPlayedAt));
    set('lsLast',        formatDate(l.lastPlayedAt));
    // Reset + Export affordances only make sense once there's data behind them.
    if (statsReset)  statsReset.hidden  = empty;
    if (statsExport) statsExport.hidden = empty;
    // Recent-trend sparkline — same last-N history used by the gameover
    // screen, just a wider/taller render to fit the stats card. Row is
    // CSS-hidden when .stats-empty is active, so skip the draw entirely.
    if (statsSparkSvg && !empty) {
      fillSparkline(statsSparkSvg, readHistory(), 160, 32, RUN_HISTORY_CAP);
    } else if (statsSparkSvg) {
      while (statsSparkSvg.firstChild) statsSparkSvg.removeChild(statsSparkSvg.firstChild);
    }
  }
  // Compose a plain-text snapshot of the lifetime stats, suitable for pasting
  // into a DM, tweet, or backup note. One line per semantic group, mirroring
  // how the stats card is laid out visually. No raw JSON — the target audience
  // is players who want to brag / archive, not developers importing data.
  function formatStatsAsText(l) {
    const lines = [];
    lines.push('void-pulse — lifetime stats');
    lines.push('Runs: ' + l.runs.toLocaleString() + ' · Total play: ' + formatDuration(l.totalSeconds));
    lines.push('Best score: ' + l.bestScoreEver.toLocaleString() + ' · Peak combo: ' + l.peakComboEver.toLocaleString());
    if (l.runs > 0) {
      lines.push('Avg / run: ' + Math.round(l.totalScore / l.runs).toLocaleString() + ' · Total score: ' + l.totalScore.toLocaleString());
    }
    lines.push('Perfects: ' + l.totalPerfects.toLocaleString() + ' · Hits: ' + l.totalHits.toLocaleString() + ' · Misses: ' + l.totalMisses.toLocaleString());
    lines.push('Perfect rate: ' + formatPercent(l.totalPerfects, l.totalHits) +
               ' · Accuracy: ' + formatPercent(l.totalHits, l.totalHits + l.totalMisses));
    lines.push('Best by theme: void ' + l.bestPerTheme.void.toLocaleString() +
               ' · sunset ' + l.bestPerTheme.sunset.toLocaleString() +
               ' · forest ' + l.bestPerTheme.forest.toLocaleString());
    lines.push('First played: ' + formatDate(l.firstPlayedAt) + ' · Last played: ' + formatDate(l.lastPlayedAt));
    return lines.join('\n');
  }
  let statsOpener = null;
  function openStats() {
    if (!statsEl || !statsEl.classList.contains('hidden')) return;
    statsOpener = document.activeElement;
    statsOpenedDuringRun = state.running && !state.over && !state.paused;
    if (statsOpenedDuringRun) pauseGame();
    renderStats();
    statsEl.classList.remove('hidden');
    statsEl.classList.add('visible');
    statsEl.setAttribute('aria-hidden', 'false');
    if (statsClose) statsClose.focus();
    Sfx.setBus('duck');
  }
  function closeStats() {
    if (!statsEl || statsEl.classList.contains('hidden')) return;
    statsEl.classList.remove('visible');
    statsEl.classList.add('hidden');
    statsEl.setAttribute('aria-hidden', 'true');
    if (statsOpenedDuringRun && state.paused && !state.resumeAt) {
      beginResumeCountdown();
    } else if (!state.paused && state.running && !state.over) {
      Sfx.setBus(hudScoreBeaten ? 'beaten' : 'normal');
    } else if (state.over) {
      Sfx.setBus('duck');
    } else {
      Sfx.setBus('normal');
    }
    statsOpenedDuringRun = false;
    // Restore focus to the trigger (falls back to statsBtn if detached or body).
    const validOpener = statsOpener && statsOpener !== document.body && document.body.contains(statsOpener);
    const target = validOpener ? statsOpener : statsBtn;
    statsOpener = null;
    if (target && typeof target.focus === 'function') {
      try { target.focus(); } catch { /* element may be focus-disabled */ }
    }
  }
  if (statsBtn)   statsBtn.addEventListener('click', (e) => { e.stopPropagation(); openStats(); });
  if (statsClose) statsClose.addEventListener('click', (e) => { e.stopPropagation(); closeStats(); });
  if (statsEl)    statsEl.addEventListener('click', (e) => { if (e.target === statsEl) closeStats(); });
  // Reset is two-step: first click arms, second confirms. Auto-disarms after
  // 4 seconds so an accidental arm doesn't stick around waiting for a stray tap.
  if (statsReset) {
    let armedAt = 0;
    statsReset.addEventListener('click', (e) => {
      e.stopPropagation();
      const now = performance.now();
      if (armedAt && now - armedAt < 4000) {
        resetLifetime();
        armedAt = 0;
        statsReset.classList.remove('armed');
        statsReset.textContent = 'Reset stats';
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
  }
  // Stats export — single-button copy of the plain-text summary. Mirrors the
  // share-btn copy flow (add `.copied` class + swap label for 1.6s) so the
  // UX pattern stays consistent across the whole app's clipboard actions.
  // Not feature-gated on `canCopy` here because the button is hidden until
  // runs>0 anyway; if clipboard is unavailable we fall through silently.
  if (statsExport) {
    statsExport.addEventListener('click', (e) => {
      e.stopPropagation();
      const text = formatStatsAsText(readLifetime());
      if (canCopy) {
        navigator.clipboard.writeText(text).then(() => {
          const prev = statsExport.textContent;
          statsExport.classList.add('copied');
          statsExport.textContent = 'Copied!';
          setTimeout(() => {
            statsExport.classList.remove('copied');
            statsExport.textContent = prev;
          }, 1600);
        }).catch(() => {});
      }
    });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (state.paused && state.resumeAt) {
        // Tabbed away mid-countdown — cancel it; wait for return again.
        state.resumeAt = 0;
        pauseCountdownEl.textContent = 'paused';
        pauseCountdownEl.classList.remove('number');
      }
      pauseGame();
      // Power save — suspend the AudioContext so the tab doesn't keep
      // sampling the audio graph in the background. Mobile browsers
      // otherwise keep the context live at ~1% CPU which adds up on
      // long tab-switched sessions. Visible-again path resumes.
      Sfx._suspend();
    } else if (state.paused) {
      Sfx._resume();
      beginResumeCountdown();
    } else {
      Sfx._resume();
    }
  });
  window.addEventListener('blur', () => { pauseGame(); });

  // ---------- 6. Render ----------
  function render(alpha) {
    ctx.clearRect(0, 0, W, H);

    // Starfield — drawn first, faintly twinkling; gets softly washed by the
    // vignette above it so it reads as "depth" not "pattern". Skipped on
    // adaptive-quality drop (see ADAPTIVE_BUDGET_MS) — the vignette below
    // still provides depth.
    if (renderStarfield) {
      const twT = state.t * 1.2;
      ctx.fillStyle = getVar('--fg');
      for (const s of stars) {
        const tw = 0.5 + 0.5 * Math.sin(twT + s.phase);
        ctx.globalAlpha = 0.18 + tw * 0.22;
        ctx.fillRect(s.x - s.size / 2, s.y - s.size / 2, s.size, s.size);
      }
      ctx.globalAlpha = 1;
      // Ambient drift layer is gated by the same adaptive-quality flag —
      // both are pure decor and drop together on a slow device.
      renderAmbient();
    }

    // background vignette (intensifies with combo) — cached by heat-bucket so we
    // don't allocate a fresh CanvasGradient + rgba string every frame.
    const heatBucket = Math.min(VIGNETTE_BUCKETS - 1, Math.floor(Math.min(1, state.combo / 30) * VIGNETTE_BUCKETS));
    let grad = vignetteCache[heatBucket];
    if (!grad) {
      const a = 0.22 + 0.2 * (heatBucket / (VIGNETTE_BUCKETS - 1));
      grad = ctx.createRadialGradient(CENTER_X, CENTER_Y, 80, CENTER_X, CENTER_Y, 640);
      const near = getVar('--vignette-near-rgb') || '82, 92, 180';
      const far  = getVar('--vignette-far-rgb')  || '15, 18, 38';
      grad.addColorStop(0, 'rgba(' + near + ', ' + a.toFixed(3) + ')');
      grad.addColorStop(1, 'rgba(' + far + ', 0)');
      vignetteCache[heatBucket] = grad;
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // inner hint ring
    ctx.save();
    ctx.translate(CENTER_X, CENTER_Y);
    const popScale = 1 + state.targetPopT * 1.4;
    const tensionBoost = state.tensionFlash ? 0.18 : 0;
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = getVar('--accent');
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, TARGET_R - 40, 0, Math.PI * 2);
    ctx.stroke();

    // target ring
    ctx.scale(popScale, popScale);
    ctx.globalAlpha = 0.85 + tensionBoost;
    ctx.strokeStyle = getVar('--accent');
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(0, 0, TARGET_R, 0, Math.PI * 2);
    ctx.stroke();

    // glow
    ctx.globalAlpha = 0.2 + tensionBoost * 1.5;
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.arc(0, 0, TARGET_R, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
    ctx.globalAlpha = 1;

    // pulses — highlight the one the tap would judge (nearest to ring).
    // Radius is interpolated between previous and current fixed-step values
    // so 120Hz displays get smooth motion without running physics at refresh.
    // Hazards (p.kind === 'h') use BOTH danger color AND a thick dashed
    // stroke AND a slow opacity throb so a colorblind player still reads
    // "do not tap" even without the red. Downbeat accents (p.heartbeat)
    // get a subtle ring-width bump for musical emphasis without fighting
    // the hazard signal.
    const judgePulse = findJudgePulse();
    for (const p of pulses) {
      if (!p.active) continue;
      const rDraw = p.prevR + (p.r - p.prevR) * alpha;
      const isHazard = p.kind === 'h';
      const isAccent = p.heartbeat;
      ctx.strokeStyle = isHazard ? getVar('--danger') : getVar('--fg');
      ctx.lineWidth = (p === judgePulse ? 4.5 : 3) + (isHazard ? 2.5 : 0) + (isAccent && !isHazard ? 1 : 0);
      if (isHazard) ctx.setLineDash(HEARTBEAT_DASH);
      // Hazards throb opacity faster so they read as "warning, warning" —
      // a fear cue separate from the steady fade-in of normal pulses.
      const throb = isHazard ? (0.8 + Math.sin(state.t * 14) * 0.2) : 1;
      ctx.globalAlpha = Math.min(1, 0.5 + rDraw / 260) * throb;
      ctx.beginPath();
      ctx.arc(CENTER_X, CENTER_Y, rDraw, 0, Math.PI * 2);
      ctx.stroke();
      if (isHazard) ctx.setLineDash(NO_DASH);
    }
    ctx.globalAlpha = 1;

    // Chromatic aberration burst on Perfect — three thin rings in cyan /
    // magenta / yellow drawn at the target with sub-pixel offsets, scaled
    // by perfectFlashT (0-0.14s). Cheap (3 strokes × ~0.12s = negligible)
    // but visually screams "PERFECT". Skipped under reduced-motion to
    // avoid seizure-risk for sensitive users.
    if (state.perfectFlashT > 0 && !reducedMotion) {
      const k = state.perfectFlashT / 0.14;
      const spread = (1 - k) * 18 + 3;    // ring grows outward as it fades
      const off = 3;
      ctx.globalAlpha = k * 0.9;
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#00e5ff';
      ctx.beginPath(); ctx.arc(CENTER_X + off, CENTER_Y, TARGET_R + spread, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = '#ff2bd6';
      ctx.beginPath(); ctx.arc(CENTER_X - off, CENTER_Y + off * 0.6, TARGET_R + spread, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = '#ffee00';
      ctx.beginPath(); ctx.arc(CENTER_X, CENTER_Y - off, TARGET_R + spread, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Combo-milestone bloom — a fullscreen radial flash from center out.
    // Gated by comboBloomT (0.35s) so it's rare and celebratory. Uses a
    // radial gradient filled over the whole canvas with low alpha; it
    // reads as "the room brightened" rather than overlaying any element.
    if (state.comboBloomT > 0 && !reducedMotion) {
      const k = state.comboBloomT / 0.35;
      const grad = ctx.createRadialGradient(CENTER_X, CENTER_Y, TARGET_R * 0.4, CENTER_X, CENTER_Y, Math.max(W, H) * 0.75);
      grad.addColorStop(0, 'rgba(255,255,255,' + (0.38 * k).toFixed(3) + ')');
      grad.addColorStop(0.45, 'rgba(255,255,255,' + (0.10 * k).toFixed(3) + ')');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
    }

    // Hazard hit wash — a brief red-wash radial when the player taps a
    // hazard, layered over the ring so the mistake feels concrete.
    if (state.hazardHitT > 0 && !reducedMotion) {
      const k = state.hazardHitT / 0.28;
      const grad = ctx.createRadialGradient(CENTER_X, CENTER_Y, TARGET_R * 0.2, CENTER_X, CENTER_Y, Math.max(W, H) * 0.7);
      grad.addColorStop(0, 'rgba(255, 72, 96, ' + (0.42 * k).toFixed(3) + ')');
      grad.addColorStop(1, 'rgba(255, 72, 96, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
    }

    // particles
    renderParticles();

    // combo milestone text
    if (state.comboMilestoneFade > 0) {
      ctx.globalAlpha = state.comboMilestoneFade;
      ctx.fillStyle = getVar('--accent');
      const fontPx = Math.min(72, Math.floor(W * 0.1));
      ctx.font = `700 ${fontPx}px system-ui, -apple-system, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(state.comboMilestoneText, CENTER_X, CENTER_Y);
      ctx.globalAlpha = 1;
    }

    // HUD
    if (state.score !== lastDisplayedScore) {
      hudScore.textContent = state.score;
      if (state.score > lastDisplayedScore && lastDisplayedScore > 0) {
        retriggerClass(hudScore, 'pop');
      }
      lastDisplayedScore = state.score;
    }
    const approaching = state.best > 0 && state.score >= state.best * 0.8 && state.score < state.best;
    const beaten      = state.best > 0 && state.score > state.best;
    if (approaching !== hudScoreApproaching) {
      hudScore.classList.toggle('approaching-best', approaching);
      hudScoreApproaching = approaching;
    }
    if (beaten !== hudScoreBeaten) {
      hudScore.classList.toggle('beaten-best', beaten);
      hudScoreBeaten = beaten;
      // Audio dynamic: lift the master bus by ~1.4dB the moment the player
      // surpasses their best. Subtle but felt — the run "leans in" sonically.
      Sfx.setBus(beaten ? 'beaten' : 'normal');
    }
    const m = comboMult();
    if (state.combo > 0) {
      const multStr = m > 1 ? '×' + (m % 1 === 0 ? m : m.toFixed(1)) + ' ' : '';
      hudCombo.textContent = multStr + state.combo;
    } else {
      hudCombo.textContent = '';
    }

    // Combo progress meter — distance to next multiplier step (COMBO_STEP).
    // At cap, stay full. Hide entirely when combo == 0 to reduce idle noise.
    const meterActive = state.combo > 0;
    if (meterActive !== lastComboActive) {
      comboMeter.classList.toggle('active', meterActive);
      lastComboActive = meterActive;
    }
    const capped = m >= COMBO_MULT_MAX;
    const pct = capped ? 100 : Math.round((state.combo % COMBO_STEP) / COMBO_STEP * 100);
    if (pct !== lastComboFillPct) {
      comboMeterFill.style.width = pct + '%';
      lastComboFillPct = pct;
    }
  }

  // ---------- 7. Loop ----------
  // Fixed-timestep simulation + interpolated render. On 120/144Hz displays the
  // render runs more often than update, so we draw each pulse at its
  // prev→cur position lerped by the leftover accumulator — smooth motion
  // without running physics at the refresh rate.
  let lastTime = 0;
  let acc = 0;
  function frame(now) {
    if (!state.running) return;
    // Power save — when the tab is hidden, browsers already throttle rAF to
    // ~1Hz, but each callback still pays the cost of a full render (clear,
    // starfield, particle/pulse draw). Skip the render entirely; keep the
    // rAF chain alive so we re-enter the normal path the instant we become
    // visible again. Physics is already gated by state.paused (set on the
    // visibilitychange handler), so skipping render here is the last hot
    // path that needs silencing.
    if (document.hidden) {
      lastTime = now;
      if (!state.over) requestAnimationFrame(frame);
      return;
    }
    if (state.paused) {
      // Drive the countdown (if running), keep the scene drawn but frozen.
      if (state.resumeAt) {
        const remainMs = state.resumeAt - now;
        if (remainMs <= 0) {
          state.paused = false;
          state.resumeAt = 0;
          clearPauseOverlay();
          BGM.resume();
          lastTime = now;
          acc = 0;
        } else {
          const secLeft = Math.max(1, Math.ceil(remainMs / 1000));
          if (pauseCountdownEl.textContent !== String(secLeft)) {
            pauseCountdownEl.textContent = String(secLeft);
          }
        }
      }
      lastTime = now;  // prevent a giant dt when we unpause
      render(Math.min(1, acc / FIXED_DT));
      if (!state.over) requestAnimationFrame(frame);
      return;
    }
    const dt = Math.min((now - lastTime) / 1000, MAX_DT);
    lastTime = now;
    acc += dt;
    while (acc >= FIXED_DT) {
      for (const p of pulses) { if (p.active) p.prevR = p.r; }
      update(FIXED_DT);
      acc -= FIXED_DT;
      if (state.over) break;
    }
    const alpha = Math.min(1, acc / FIXED_DT);
    render(alpha);
    sampleFrameDt(dt);
    if (SHOW_FPS) updateFpsOverlay(dt);
    if (!state.over) requestAnimationFrame(frame);
  }

  // Dev FPS overlay — built lazily, only when ?fps=1. Updates twice a second
  // with smoothed FPS + a "low" tag if adaptive quality kicked in.
  let fpsEl = null;
  let fpsAccum = 0;
  let fpsFrames = 0;
  let fpsAccumTime = 0;
  function updateFpsOverlay(dt) {
    if (!fpsEl) {
      fpsEl = document.createElement('div');
      fpsEl.id = 'fpsOverlay';
      fpsEl.style.cssText = 'position:absolute;top:6px;left:6px;z-index:99;font:11px ui-monospace,Menlo,monospace;color:#9eb;background:rgba(0,0,0,.45);padding:2px 6px;border-radius:4px;pointer-events:none;letter-spacing:.04em';
      app.appendChild(fpsEl);
    }
    fpsAccum += dt;
    fpsFrames++;
    fpsAccumTime += dt;
    if (fpsAccumTime >= 0.5) {
      const fps = fpsFrames / fpsAccum;
      fpsEl.textContent = fps.toFixed(0) + ' fps' + (renderStarfield ? '' : ' · low');
      fpsAccum = 0;
      fpsFrames = 0;
      fpsAccumTime = 0;
    }
  }

  // Adaptive quality — collect dt for the first ~60 frames after start. If
  // median dt exceeds the budget, we're on a slow device → drop the starfield.
  // Uses median rather than mean so a single 200ms hitch (e.g. JIT warmup)
  // doesn't trigger the downgrade.
  function sampleFrameDt(dt) {
    if (dtSamplesFull) return;
    dtSamples[dtSampleIdx++] = dt * 1000;
    if (dtSampleIdx >= ADAPTIVE_SAMPLE_FRAMES) {
      dtSamplesFull = true;
      const arr = Array.from(dtSamples).sort((a, b) => a - b);
      const median = arr[arr.length >> 1];
      if (median > ADAPTIVE_BUDGET_MS) {
        renderStarfield = false;
      }
    }
  }

  // ---------- 8. Flow ----------
  function start() {
    resetRng();           // reseed so every retry in seeded mode is identical
    state.running = true;
    state.over = false;
    state.t = 0;
    state.score = 0;
    state.combo = 0;
    // Pity-life grant: if the player has died quickly RAGE_REQUIRED times
    // in a row, grant one bonus life for this run. Immediately clear the
    // trigger so the boost doesn't repeat run-after-run.
    const rageHist = readRageDurations();
    let bonusLife = 0;
    if (rageHist.length >= RAGE_REQUIRED &&
        rageHist.slice(-RAGE_REQUIRED).every(s => s < RAGE_DURATION_S)) {
      bonusLife = BONUS_LIFE_MAX;
      writeRageDurations([]);            // consume the trigger
    }
    state.lives = STARTING_LIVES + bonusLife;
    state.bonusLifeGranted = bonusLife > 0;
    state.pulsesSpawned = 0;
    state.nextSpawnAt = 0;
    state.lastTapMs = 0;
    state.peakCombo = 0;
    state.perfectCount = 0;
    state.hitCount = 0;
    state.missCount = 0;
    state.newBestThisRun = false;
    state.runEvents.length = 0;
    state.targetPopT = 0;
    state.shakeT = 0;
    state.comboMilestoneText = '';
    state.comboMilestoneFade = 0;
    state.tensionFlash = false;
    state.perfectFlashT = 0;
    state.comboBloomT = 0;
    state.hazardHitT = 0;
    state.hazardClearT = 0;
    state.hazardPassed = 0;
    state.deathCam = false;
    state.deathCamT = 0;
    // Generate this run's chart AFTER resetRng() above (so seeded runs are
    // identical across retries). maxPossibleScore is used by the gameover
    // overlay to show the "x% of theoretical max" score — the core retention
    // hook for a fixed-pattern rhythm game.
    const built = generateChart();
    state.chart = built.events;
    state.chartIdx = 0;
    state.chartDone = false;
    state.maxPossibleScore = built.maxScore;
    resetBeatIndicator();
    // Kick off the beat-synced BGM. Anchor to Sfx.ctx time + lead-in so the
    // first downbeat lines up with the first chart pulse arriving at ring-R.
    if (Sfx.ctx) {
      const runAnchorCtxT = Sfx.ctx.currentTime + CHART_LEAD_IN_S;
      BGM.start(Sfx, BAND_SCHEDULE, runAnchorCtxT);
    }
    resetSrTierCache();
    announce('Chart started. ' + state.lives + ' lives.');
    app.classList.remove('deathcam');
    for (const p of pulses) p.active = false;
    for (const p of particles) p.active = false;
    extraSpawns.length = 0;
    updateLivesUI();
    newBestEl.classList.remove('visible');
    hudScore.classList.remove('approaching-best', 'beaten-best');
    lastDisplayedScore = 0;
    hudScoreApproaching = false;
    hudScoreBeaten = false;
    lastComboFillPct = -1;
    lastComboActive = false;
    comboMeter.classList.remove('active');
    comboMeterFill.style.width = '0%';
    // clear any lingering pause state from a previous run
    state.paused = false;
    state.resumeAt = 0;
    clearPauseOverlay();

    overlay.classList.remove('visible'); overlay.classList.add('hidden');
    // Clear the first-visit onboarding treatment the moment the player
    // commits — they've now seen the real game, the hint has done its job.
    if (overlay.classList.contains('first-visit')) {
      overlay.classList.remove('first-visit');
      writeSeen();
    }
    gameoverEl.classList.remove('visible'); gameoverEl.classList.add('hidden');
    Sfx.setBus('normal');   // un-duck after a previous gameover
    if (state.bonusLifeGranted) {
      state.comboMilestoneText = '+1 LIFE';
      state.comboMilestoneFade = 1.1;
      // Also flash the bonus glyph itself so the player learns "the gold one
      // was the freebie" — reinforces the +1 LIFE text with a HUD anchor.
      const glyphs = hudLives.querySelectorAll('.life');
      const bonusIdx = state.lives - 1;
      if (glyphs[bonusIdx]) retriggerClass(glyphs[bonusIdx], 'bonus-glow');
    }

    lastTime = performance.now();
    acc = 0;
    requestAnimationFrame((t) => { lastTime = t; frame(t); });
  }

  function gameover() {
    state.over = true;
    state.running = false;
    state.paused = false;
    state.resumeAt = 0;
    clearPauseOverlay();
    BGM.stop();
    resetBeatIndicator();
    state.gameoverAtMs = performance.now();
    const prevBest = state.best;
    if (state.score > state.best) {
      state.best = state.score;
      writeBest(state.best);
      state.newBestThisRun = state.score > 0 && prevBest > 0;
    }
    // Ghost: snapshot the PREVIOUS best-run timeline BEFORE any write, then
    // persist this run if it's a new best. Rendering uses the "before" snapshot
    // so when the current run is itself the new best, the "Best" strip still
    // shows the prior comparison — otherwise both strips would be identical.
    // Free-play (GHOST_KEY === null) skips both store and display.
    const ghostBefore = readGhost();
    if (GHOST_KEY !== null && state.score > 0 && state.score > prevBest) {
      writeGhost({
        events: state.runEvents.slice(),   // snapshot
        score: state.score,
        duration: +state.t.toFixed(2),
        at: Date.now(),
      });
    }
    renderGhost(
      { events: state.runEvents, duration: state.t },
      ghostBefore,
    );
    // Persist run to local history, then redraw sparkline (latest on the right).
    const history = readHistory();
    history.push(state.score);
    const trimmed = history.slice(-RUN_HISTORY_CAP);
    writeHistory(trimmed);
    renderHistory(trimmed);
    // Per-seed top-N: insert this run, render the table, highlight if new.
    const runAtMs = Date.now();
    const { board, rank } = insertScore(state.score, runAtMs);
    renderLeaderboard(board, rank > 0 ? runAtMs : 0);
    // Daily streak: bump once per day when the player completes today's run.
    // `isTodayDaily` filters out arbitrary-seed links — only the canonical
    // daily YYYYMMDD for *today's* date counts toward the streak.
    let streakBumped = false;
    let streakAfter = readStreak();
    const isTodayDaily = SEED !== null && SEED === todayYyyymmdd();
    if (isTodayDaily && state.score > 0) {
      const s = bumpStreakForToday();
      streakBumped = !!s.changed;
      streakAfter = s;
    }
    // Show the streak badge on gameover whenever the player has an active
    // streak — today or yesterday. Same rule as the start overlay, so the
    // badge is self-consistent across both entry points.
    const today = todayYyyymmdd();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const streakActive = streakAfter.streak > 0 &&
      (streakAfter.lastYyyymmdd === today || streakAfter.lastYyyymmdd === yyyymmddOf(yesterday));
    renderStreakGameover(streakActive ? streakAfter : null, streakBumped);
    // Achievements — evaluate against this run's stats + current streak.
    const { unlocked, justNow } = evaluateAchievements({
      score: state.score,
      peakCombo: state.peakCombo,
      perfectCount: state.perfectCount,
      hitCount: state.hitCount,
      missCount: state.missCount,
      duration: state.t,
      streak: streakAfter.streak,
    });
    renderAchievements(unlocked, justNow);
    // Play the achievement cue only if something new unlocked AND we aren't
    // already about to play the NEW BEST levelup cue — otherwise the two
    // cascade on top of each other and the mix muddies. NEW BEST wins.
    if (justNow.length && !state.newBestThisRun) {
      // Small delay so it lands after the gameover thud, not *under* it.
      setTimeout(() => Sfx.achievement(), 420);
      haptic([20, 30, 60]);
    }
    // Track rage-retry window: push this run's duration.
    const rage = readRageDurations();
    rage.push(+state.t.toFixed(2));
    writeRageDurations(rage);
    // Lifetime stats bump — cross-mode aggregate (daily + free both count).
    // Skip 0-score ghost-runs (page reload before any tap) so totals reflect
    // actual play, not accidental starts.
    if (state.score > 0 || state.t >= 3) {
      bumpLifetime({
        score: state.score,
        perfects: state.perfectCount,
        hits: state.hitCount,
        misses: state.missCount,
        seconds: state.t,
        peakCombo: state.peakCombo,
        theme: currentTheme,
      });
    }
    // Share button visibility: show if the browser can actually do something
    // (native share OR clipboard write). Hide on 0-score runs — nothing to brag.
    const canSomething = canShare || canCopy;
    if (canSomething && state.score > 0) {
      shareBtn.hidden = false;
      shareBtn.classList.remove('copied');
      shareBtn.querySelector('span').textContent = 'Share';
    } else {
      shareBtn.hidden = true;
    }
    // Victory vs death — completing the chart with lives left gets the
    // levelup cascade (uplifting) instead of the gameover thud (loss cue).
    // The visual overlay is the same; the audio tells you which outcome.
    if (state.chartDone && state.lives > 0) {
      Sfx.levelup();
      setTimeout(() => { try { Sfx.themeSweeten(); } catch {} }, 180);
    } else {
      Sfx.gameover();
    }
    // Fixed-chart scoring — show the raw score PLUS the % of theoretical
    // max. The % is the real retention lever: "I got 63%, I can do better"
    // beats "my endless score was 4728" for replayability.
    const pct = state.maxPossibleScore > 0
      ? Math.round((state.score / state.maxPossibleScore) * 100)
      : 0;
    finalScoreEl.textContent = state.score + ' · ' + pct + '%';
    bestScoreEl.textContent = state.best;
    statPeakEl.textContent = state.peakCombo;
    statPerfectEl.textContent = state.perfectCount;
    statHitsEl.textContent = state.hitCount;
    if (state.newBestThisRun) {
      newBestEl.classList.add('visible');
      Sfx.levelup();
      haptic([40, 40, 80]);
    }
    // Compose a single gameover announcement so the screen reader speaks one
    // summary line, not 6 fragmented reads. Order: NEW BEST first (highest
    // salience), then streak bump, then final score + peak combo + %.
    const parts = [];
    if (state.newBestThisRun) parts.push('New best!');
    else if (state.chartDone && state.lives > 0) parts.push('Chart complete!');
    else parts.push('Game over.');
    if (streakBumped) parts.push('Day ' + streakAfter.streak + ' streak.');
    parts.push('Score ' + state.score + '.');
    parts.push(pct + ' percent of max.');
    parts.push('Peak combo ' + state.peakCombo + '.');
    announce(parts.join(' '));
    // Daily mode: nudge returning-ness with a "come back tomorrow" countdown.
    // Uses device-local midnight; deliberately coarse (h+m, no seconds) so
    // the overlay isn't a ticking distraction.
    if (SEED !== null) {
      tomorrowTimeEl.textContent = formatHhMm(msToTomorrow());
      tomorrowEl.hidden = false;
    } else {
      tomorrowEl.hidden = true;
    }
    retriggerClass(app, 'shake');
    app.classList.add('flash');
    setTimeout(() => app.classList.remove('flash'), 180);
    setTimeout(() => {
      gameoverEl.classList.remove('hidden');
      gameoverEl.classList.add('visible');
      Sfx.setBus('duck');   // tuck residual sfx under the gameover UI
    }, 250);
  }

  updateLivesUI();

  // Expose for debugging / console tweaks
  window.__game = { state, pulses, particles, start, gameover };
})();
