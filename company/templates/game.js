// ============================================================
// GameCompany template — game.js
// Replace __ markers with design-specific values. Do not ship as-is.
// ============================================================
(() => {
  'use strict';

  // ---------- 1. Constants (tunables) ----------
  const W = 720;
  const H = 960;
  const FIXED_DT = 1 / 60;        // physics step (s)
  const MAX_DT   = 1 / 30;        // tab-switch cap
  const START_SPEED = 1.0;
  const DIFFICULTY_RAMP = 0.02;   // per second

  // ---------- 2. State ----------
  const state = {
    running: false,
    over: false,
    t: 0,          // game time (s)
    score: 0,
    speedMul: START_SPEED,
    // entities: fill per-game
  };

  // ---------- 3. Init ----------
  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');
  const hudScore = document.getElementById('score');
  const hudFinal = document.getElementById('finalScore');
  const overlay = document.getElementById('overlay');
  const gameoverEl = document.getElementById('gameover');
  const btnStart = document.getElementById('start');
  const btnRetry = document.getElementById('retry');

  // ---------- Sfx (audio init on first gesture) ----------
  let audio = null;
  const Sfx = {
    init() {
      if (audio) return;
      audio = new (window.AudioContext || window.webkitAudioContext)();
    },
    _beep(freq, dur = 0.08, type = 'sine', vol = 0.2) {
      if (!audio) return;
      const t0 = audio.currentTime;
      const osc = audio.createOscillator();
      const g = audio.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      osc.connect(g).connect(audio.destination);
      osc.start(t0);
      osc.stop(t0 + dur);
    },
    click() { this._beep(660, 0.05, 'square', 0.1); },
    score() { this._beep(880, 0.08, 'triangle', 0.15); },
    gameover() { this._beep(140, 0.35, 'sawtooth', 0.2); },
  };

  // ---------- 4. Input ----------
  function onPointer(e) {
    if (!state.running) return;
    // TODO: game-specific input
  }
  canvas.addEventListener('pointerdown', onPointer);

  btnStart.addEventListener('click', () => { Sfx.init(); start(); });
  btnRetry.addEventListener('click', () => { Sfx.init(); start(); });

  // ---------- 5. Update ----------
  function update(dt) {
    state.t += dt;
    state.speedMul = START_SPEED + state.t * DIFFICULTY_RAMP;
    // TODO: game-specific update
  }

  // ---------- 6. Render ----------
  function render() {
    ctx.clearRect(0, 0, W, H);
    // TODO: game-specific render
    hudScore.textContent = state.score;
  }

  // ---------- 7. Loop ----------
  let lastTime = 0;
  let acc = 0;
  function frame(now) {
    if (!state.running) return;
    const dt = Math.min((now - lastTime) / 1000, MAX_DT);
    lastTime = now;
    acc += dt;
    while (acc >= FIXED_DT) {
      update(FIXED_DT);
      acc -= FIXED_DT;
      if (state.over) break;
    }
    render();
    if (!state.over) requestAnimationFrame(frame);
  }

  // ---------- 8. Flow ----------
  function start() {
    Object.assign(state, {
      running: true, over: false, t: 0, score: 0, speedMul: START_SPEED,
    });
    overlay.classList.replace('visible', 'hidden');
    gameoverEl.classList.replace('visible', 'hidden');
    gameoverEl.classList.add('hidden');
    lastTime = performance.now();
    acc = 0;
    requestAnimationFrame((t) => { lastTime = t; frame(t); });
  }

  function gameover() {
    state.over = true;
    state.running = false;
    Sfx.gameover();
    hudFinal.textContent = state.score;
    gameoverEl.classList.remove('hidden');
    gameoverEl.classList.add('visible');
  }

  // expose for debugging only
  window.__game = { state, start, gameover };
})();
