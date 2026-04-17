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

  const PULSE_POOL_SIZE = 32;
  const PARTICLE_CAP = 256;

  const HEARTBEAT_INTERVAL = 5;
  const HEARTBEAT_BONUS    = 1.5;
  const COMBO_STEP = 5;
  const COMBO_MULT_MAX = 4;

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
    lastTapMs: 0,
    gameoverAtMs: 0,
    muted: readMuted(),
    // run stats
    peakCombo: 0,
    perfectCount: 0,
    hitCount: 0,
    newBestThisRun: false,
    // fx timers
    targetPopT: 0,
    shakeT: 0,
    comboMilestoneText: '',
    comboMilestoneFade: 0,
    tensionFlash: false,
  };

  const pulses = [];
  for (let i = 0; i < PULSE_POOL_SIZE; i++) {
    pulses.push({ active: false, r: 0, prevR: 0, speed: 0, heartbeat: false, bornT: 0 });
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
  bestScoreEl.textContent = state.best;

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
    try { return +(localStorage.getItem('void-pulse-best') || 0); } catch { return 0; }
  }
  function writeBest(v) {
    try { localStorage.setItem('void-pulse-best', String(v)); } catch {}
  }
  function readMuted() {
    try { return localStorage.getItem('void-pulse-muted') === '1'; } catch { return false; }
  }
  function writeMuted(v) {
    try { localStorage.setItem('void-pulse-muted', v ? '1' : '0'); } catch {}
  }

  // ---------- Sfx ----------
  const Sfx = {
    ctx: null,
    master: null,
    init() {
      if (this.ctx) return;
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = state.muted ? 0 : MASTER_GAIN;
      this.master.connect(this.ctx.destination);
    },
    applyMute() {
      if (this.master) this.master.gain.value = state.muted ? 0 : MASTER_GAIN;
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
    click()  { this._env('square',   660, 0.05, 0.15); },
    score(combo = 0) {
      const f = 660 * Math.pow(1.06, Math.min(combo, 12));
      this._env('triangle', f, 0.09, 0.18);
    },
    good(combo = 0) {
      const f = 500 * Math.pow(1.04, Math.min(combo, 12));
      this._env('sine', f, 0.08, 0.15);
    },
    miss() { this._env('sawtooth', 180, 0.22, 0.26, 70); },
    gameover() {
      this._env('sawtooth', 330, 0.5, 0.3, 60);
      setTimeout(() => this._env('sawtooth', 220, 0.6, 0.25, 40), 120);
    },
    levelup() {
      [523, 659, 784, 1047].forEach((f, i) => {
        setTimeout(() => this._env('triangle', f, 0.09, 0.17), i * 65);
      });
    },
    heartbeat() { this._env('sine', 110, 0.12, 0.22, 165); },
    // Brief high-register blip at spawn — gives the player a rhythm anchor
    // so tap timing isn't purely visual. Quiet enough to not dominate the mix.
    spawnTick(isHeartbeat) {
      this._env('sine', isHeartbeat ? 740 : 520, 0.035, 0.055);
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

  // Keyboard input — Space / Enter mirrors tap; gameplay accessible without pointer.
  // When a BUTTON is focused, let the browser activate it (Space/Enter = click).
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' && e.code !== 'Enter') return;
    const t = e.target;
    if (t && (t.tagName === 'BUTTON' || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
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
    applyMuteUI();
  });
  applyMuteUI();

  function retriggerClass(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

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

    if (dMs <= pwMs) {
      const mult = comboMult();
      state.score += Math.round(100 * mult * heartbeatMul);
      state.combo += 1;
      state.perfectCount += 1;
      state.hitCount += 1;
      spawnBurst(CENTER_X, CENTER_Y, p.heartbeat ? getVar('--danger') : getVar('--accent'), 12, 280);
      state.targetPopT = 0.18;
      Sfx.score(state.combo);
      if (p.heartbeat) Sfx.heartbeat();
      if (state.combo > 0 && state.combo % COMBO_STEP === 0) {
        const m = comboMult();
        state.comboMilestoneText = '×' + (m % 1 === 0 ? m : m.toFixed(1));
        state.comboMilestoneFade = 0.9;
        Sfx.levelup();
      }
      p.active = false;
    } else if (dMs <= GOOD_WINDOW_MS) {
      const mult = comboMult();
      state.score += Math.round(50 * mult * heartbeatMul);
      state.combo += 1;
      state.hitCount += 1;
      spawnBurst(CENTER_X, CENTER_Y, getVar('--accent'), 6, 210);
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
      loseLife();
      Sfx.miss();
      state.shakeT = 0.2;
      retriggerClass(app, 'shake');
      haptic(20);
    }
    if (state.combo > state.peakCombo) state.peakCombo = state.combo;
  }

  function loseLife() {
    state.combo = 0;
    state.lives -= 1;
    updateLivesUI();
    if (state.lives <= 0) gameover();
  }

  function updateLivesUI() {
    const glyphs = hudLives.querySelectorAll('.life');
    for (let i = 0; i < glyphs.length; i++) {
      const alive = i < state.lives;
      glyphs[i].style.opacity = alive ? '1' : '0.25';
      glyphs[i].style.color = alive ? 'var(--accent)' : 'var(--subtle)';
    }
  }

  // ---------- Spawning ----------
  // Onboarding: first ONBOARDING_T (5s) starts slower + wider gaps so a new
  // player can read the mechanic before the main curve kicks in.
  function speedAt(t) {
    if (t < ONBOARDING_T) return 200 + (t / ONBOARDING_T) * 60;       // 200 → 260
    if (t < 15) return 260 + ((t - ONBOARDING_T) / (15 - ONBOARDING_T)) * 80;
    if (t < 45) return 340 + ((t - 15) / 30) * 120;
    if (t < 90) return 460 + ((t - 45) / 45) * 140;
    return Math.min(720, 600 + (t - 90) * 1.2);
  }
  function gapAt(t) {
    if (t < ONBOARDING_T) return 1100 - (t / ONBOARDING_T) * 200;      // 1100 → 900
    if (t < 15) return 900 - ((t - ONBOARDING_T) / (15 - ONBOARDING_T)) * 200;
    if (t < 45) return 700 - ((t - 15) / 30) * 200;
    return Math.max(300, 500 - (t - 45) * 4.5);
  }

  function spawnPulse(heartbeat) {
    for (const p of pulses) {
      if (p.active) continue;
      p.active = true;
      p.r = 0;
      p.prevR = 0;
      p.speed = speedAt(state.t);
      p.heartbeat = heartbeat;
      p.bornT = state.t;
      Sfx.spawnTick(heartbeat);
      return p;
    }
    return null;
  }

  function scheduleNext() {
    state.pulsesSpawned += 1;
    state.nextSpawnAt = state.t + gapAt(state.t) / 1000;
    const roll = Math.random();
    if (state.t >= 90 && roll < 0.15) {
      extraSpawns.push(state.t + 0.4, state.t + 0.8);
    } else if (state.t >= 45 && roll < 0.30) {
      extraSpawns.push(state.t + 0.5);
    }
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

  // ---------- 5. Update ----------
  function update(dt) {
    state.t += dt;

    if (state.t >= state.nextSpawnAt) {
      const heartbeat = ((state.pulsesSpawned + 1) % HEARTBEAT_INTERVAL) === 0;
      spawnPulse(heartbeat);
      scheduleNext();
    }
    for (let i = extraSpawns.length - 1; i >= 0; i--) {
      if (state.t >= extraSpawns[i]) {
        spawnPulse(false);
        extraSpawns.splice(i, 1);
      }
    }

    state.tensionFlash = false;
    for (const p of pulses) {
      if (!p.active) continue;
      p.r += p.speed * dt;
      // Time-to-arrive (negative = already past)
      const toArriveMs = (TARGET_R - p.r) / p.speed * 1000;
      if (toArriveMs <= TENSION_LEAD_MS && toArriveMs >= -GOOD_WINDOW_MS) {
        state.tensionFlash = true;
      }
      if (toArriveMs < -GOOD_WINDOW_MS) {
        p.active = false;
        loseLife();
        state.shakeT = 0.15;
        retriggerClass(app, 'shake');
      }
    }

    if (state.targetPopT > 0) state.targetPopT = Math.max(0, state.targetPopT - dt);
    if (state.comboMilestoneFade > 0) state.comboMilestoneFade = Math.max(0, state.comboMilestoneFade - dt);
    if (state.shakeT > 0) state.shakeT = Math.max(0, state.shakeT - dt);

    updateParticles(dt);
  }

  // HUD diff-tracking — avoids DOM churn when values haven't changed.
  let lastDisplayedScore = 0;
  let hudScoreApproaching = false;
  let hudScoreBeaten = false;

  // ---------- 6. Render ----------
  function render(alpha) {
    ctx.clearRect(0, 0, W, H);

    // Starfield — drawn first, faintly twinkling; gets softly washed by the
    // vignette above it so it reads as "depth" not "pattern".
    ctx.fillStyle = getVar('--fg');
    for (const s of stars) {
      const tw = 0.5 + 0.5 * Math.sin(state.t * 1.2 + s.phase);
      ctx.globalAlpha = 0.18 + tw * 0.22;
      ctx.fillRect(s.x - s.size / 2, s.y - s.size / 2, s.size, s.size);
    }
    ctx.globalAlpha = 1;

    // background vignette (intensifies with combo)
    const heat = Math.min(1, state.combo / 30);
    const grad = ctx.createRadialGradient(CENTER_X, CENTER_Y, 80, CENTER_X, CENTER_Y, 640);
    grad.addColorStop(0, `rgba(82, 92, 180, ${0.22 + 0.2 * heat})`);
    grad.addColorStop(1, 'rgba(15, 18, 38, 0)');
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
    const judgePulse = findJudgePulse();
    for (const p of pulses) {
      if (!p.active) continue;
      const rDraw = p.prevR + (p.r - p.prevR) * alpha;
      const color = p.heartbeat ? getVar('--danger') : getVar('--fg');
      ctx.strokeStyle = color;
      ctx.lineWidth = p === judgePulse ? 4.5 : 3;
      ctx.globalAlpha = Math.min(1, 0.5 + rDraw / 260);
      ctx.beginPath();
      ctx.arc(CENTER_X, CENTER_Y, rDraw, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

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
    }
    const m = comboMult();
    if (state.combo > 0) {
      const multStr = m > 1 ? '×' + (m % 1 === 0 ? m : m.toFixed(1)) + ' ' : '';
      hudCombo.textContent = multStr + state.combo;
    } else {
      hudCombo.textContent = '';
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
    if (!state.over) requestAnimationFrame(frame);
  }

  // ---------- 8. Flow ----------
  function start() {
    state.running = true;
    state.over = false;
    state.t = 0;
    state.score = 0;
    state.combo = 0;
    state.lives = STARTING_LIVES;
    state.pulsesSpawned = 0;
    state.nextSpawnAt = 0;
    state.lastTapMs = 0;
    state.peakCombo = 0;
    state.perfectCount = 0;
    state.hitCount = 0;
    state.newBestThisRun = false;
    state.targetPopT = 0;
    state.shakeT = 0;
    state.comboMilestoneText = '';
    state.comboMilestoneFade = 0;
    state.tensionFlash = false;
    for (const p of pulses) p.active = false;
    for (const p of particles) p.active = false;
    extraSpawns.length = 0;
    updateLivesUI();
    newBestEl.classList.remove('visible');
    hudScore.classList.remove('approaching-best', 'beaten-best');
    lastDisplayedScore = 0;
    hudScoreApproaching = false;
    hudScoreBeaten = false;

    overlay.classList.remove('visible'); overlay.classList.add('hidden');
    gameoverEl.classList.remove('visible'); gameoverEl.classList.add('hidden');

    lastTime = performance.now();
    acc = 0;
    requestAnimationFrame((t) => { lastTime = t; frame(t); });
  }

  function gameover() {
    state.over = true;
    state.running = false;
    state.gameoverAtMs = performance.now();
    const prevBest = state.best;
    if (state.score > state.best) {
      state.best = state.score;
      writeBest(state.best);
      state.newBestThisRun = state.score > 0 && prevBest > 0;
    }
    Sfx.gameover();
    finalScoreEl.textContent = state.score;
    bestScoreEl.textContent = state.best;
    statPeakEl.textContent = state.peakCombo;
    statPerfectEl.textContent = state.perfectCount;
    statHitsEl.textContent = state.hitCount;
    if (state.newBestThisRun) {
      newBestEl.classList.add('visible');
      Sfx.levelup();
      haptic([40, 40, 80]);
    }
    retriggerClass(app, 'shake');
    app.classList.add('flash');
    setTimeout(() => app.classList.remove('flash'), 180);
    setTimeout(() => {
      gameoverEl.classList.remove('hidden');
      gameoverEl.classList.add('visible');
    }, 250);
  }

  updateLivesUI();

  // Expose for debugging / console tweaks
  window.__game = { state, pulses, particles, start, gameover };
})();
