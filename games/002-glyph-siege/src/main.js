import { W, H, FIXED_DT, MAX_DT, PLAYER_HP_BASE, PLAYER_SPEED_BASE,
         PLAYER_PICKUP_R_BASE, WEAPON_INTERVAL_BASE, WEAPON_DAMAGE_BASE,
         WEAPON_PROJ_COUNT_BASE, WEAPON_PIERCE_BASE, BOSS_INTERVAL } from './constants.js';
import { state, player, pools, boss, resetPool } from './state.js';
import { Sfx } from './sfx.js';
import { installInput } from './input.js';
import { updateAll } from './entities.js';
import { renderAll } from './render.js';
import { tickWaves, tickBoss } from './waves.js';
import { checkLevelUp } from './upgrades.js';
import { loadAssets } from './assets.js';
import {
  updateHud, setupUiButtons, showGameOver, hideGameOver, hideStart,
  setMutedUi, runCountdown,
} from './ui.js';

const BEST_KEY = 'glyph-siege.best';
const MUTE_KEY = 'glyph-siege.muted';

const doms = {
  canvas:    document.getElementById('stage'),
  timer:     document.getElementById('timer'),
  kills:     document.getElementById('kills'),
  level:     document.getElementById('level'),
  hearts:    document.getElementById('hearts'),
  xpfill:    document.getElementById('xpfill'),
  overlay:   document.getElementById('overlay'),
  start:     document.getElementById('start'),
  gameover:  document.getElementById('gameover'),
  retry:     document.getElementById('retry'),
  statTime:  document.getElementById('statTime'),
  statKills: document.getElementById('statKills'),
  statLevel: document.getElementById('statLevel'),
  finalScore:document.getElementById('finalScore'),
  bestBadge: document.getElementById('bestBadge'),
  muteBtn:   document.getElementById('muteBtn'),
  pauseBtn:  document.getElementById('pauseBtn'),
  pauseOverlay: document.getElementById('pauseOverlay'),
  resumeBtn: document.getElementById('resumeBtn'),
  upgradeOverlay: document.getElementById('upgradeOverlay'),
  cardsEl:   document.getElementById('cards'),
  countdown: document.getElementById('countdown'),
  bootError: document.getElementById('bootError'),
  bootErrorMsg: document.getElementById('bootErrorMsg'),
  bootReset: document.getElementById('bootReset'),
};

// ---------- Canvas + DPR ----------
function setupCanvas() {
  const ctx = doms.canvas.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  state.dpr = dpr;
  doms.canvas.width = W * dpr;
  doms.canvas.height = H * dpr;
  doms.canvas.style.width = '';
  doms.canvas.style.height = '';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  state.canvas = doms.canvas;
  state.ctx = ctx;
}

// ---------- Reduced motion ----------
function checkReducedMotion() {
  state.reducedMotion =
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// ---------- Flow ----------
function resetRun() {
  state.running = true;
  state.over = false;
  state.paused = false;
  state.t = 0;
  state.kills = 0;
  state.score = 0;
  state.level = 1;
  state.xp = 0;
  state.xpNeeded = 10;
  state.shake = 0;
  state.hitFlashMs = 0;
  state.levelFlashMs = 0;
  state.bossVignetteMs = 0;
  state.spawnAcc = 0.9; // prime for near-immediate first spawn
  state.bossNext = BOSS_INTERVAL;
  state.bossIndex = 0;
  state.isNewBest = false;
  player.x = W / 2; player.y = H / 2;
  player.hp = PLAYER_HP_BASE;
  player.hpMax = PLAYER_HP_BASE;
  player.speed = PLAYER_SPEED_BASE;
  player.pickupR = PLAYER_PICKUP_R_BASE;
  player.fireInterval = WEAPON_INTERVAL_BASE;
  player.fireAcc = 0;
  player.damage = WEAPON_DAMAGE_BASE;
  player.projCount = WEAPON_PROJ_COUNT_BASE;
  player.pierce = WEAPON_PIERCE_BASE;
  player.invulnMs = 0;
  player.ranks = { DMG: 0, RATE: 0, MULTI: 0, SPD: 0, MAGNET: 0, VIT: 0 };
  boss.active = false;
  resetPool(pools.enemies);
  resetPool(pools.projectiles);
  resetPool(pools.gems);
  resetPool(pools.particles);
  resetPool(pools.shocks);
  state.input.active = false; state.input.dx = 0; state.input.dy = 0; state.input.mag = 0;
}

function startRun() {
  resetRun();
  hideStart(doms);
  hideGameOver(doms);
  doms.pauseOverlay.classList.replace('visible', 'hidden');
  doms.upgradeOverlay.classList.replace('visible', 'hidden');
  lastTime = performance.now();
  acc = 0;
  requestAnimationFrame(frame);
}

function endRun() {
  state.running = false;
  state.over = true;
  Sfx.gameover();
  // compute score
  state.score = Math.floor(state.t) * 10 + state.kills * 5 + state.level * 100;
  let best = 0;
  try { best = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0; } catch (e) {}
  const isNewBest = state.score > best && best > 0;
  if (state.score > best) {
    try { localStorage.setItem(BEST_KEY, String(state.score)); } catch (e) {}
  }
  showGameOver(doms, best, isNewBest);
}

function togglePause() {
  if (!state.running || state.over) return;
  if (state.paused) {
    resumeRun();
  } else {
    state.paused = true;
    doms.pauseOverlay.classList.remove('hidden');
    doms.pauseOverlay.classList.add('visible');
  }
}

function resumeRun() {
  if (!state.running || state.over) return;
  doms.pauseOverlay.classList.replace('visible', 'hidden');
  // countdown then unpause
  runCountdown(doms, () => {
    state.paused = false;
    lastTime = performance.now();
  });
}

function toggleMute() {
  state.muted = !state.muted;
  Sfx.setMuted(state.muted);
  setMutedUi(doms, state.muted);
  try { localStorage.setItem(MUTE_KEY, state.muted ? '1' : '0'); } catch (e) {}
}

// ---------- Loop ----------
let lastTime = 0;
let acc = 0;

function step(dt) {
  if (state.paused || state.over) return;
  state.t += dt;
  // waves + boss schedule
  tickWaves(dt);
  tickBoss();
  // entity updates
  updateAll(dt);
  // decays
  if (state.shake > 0) state.shake = Math.max(0, state.shake - dt * 40);
  if (state.hitFlashMs > 0) state.hitFlashMs -= dt * 1000;
  if (state.levelFlashMs > 0) state.levelFlashMs -= dt * 1000;
  if (state.bossVignetteMs > 0) state.bossVignetteMs -= dt * 1000;
  // death
  if (player.hp <= 0) { endRun(); return; }
  // level up (may pause state)
  checkLevelUp(doms, () => { lastTime = performance.now(); });
}

function frame(now) {
  if (!state.running) return;
  const dt = Math.min((now - lastTime) / 1000, MAX_DT);
  lastTime = now;
  if (!state.paused) {
    acc += dt;
    while (acc >= FIXED_DT) {
      step(FIXED_DT);
      acc -= FIXED_DT;
      if (state.over) break;
    }
  }
  renderAll(state.ctx);
  updateHud(doms);
  if (!state.over) requestAnimationFrame(frame);
}

// ---------- Tab visibility ----------
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.running && !state.over && !state.paused) {
    togglePause();
  }
});

// ---------- Boot ----------
function boot() {
  try {
    setupCanvas();
    checkReducedMotion();
    installInput(doms.canvas);
    setupUiButtons(doms, {
      start: startRun,
      resume: resumeRun,
      togglePause: togglePause,
      toggleMute: toggleMute,
    });
    // persisted mute
    try {
      const m = localStorage.getItem(MUTE_KEY);
      if (m === '1') { state.muted = true; setMutedUi(doms, true); }
    } catch (e) {}
    // best
    try {
      state.best = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0;
    } catch (e) {}
    // preload SVG sprites — Start button stays visible but disabled until ready
    doms.start.disabled = true;
    doms.start.textContent = 'Loading…';
    loadAssets().then(() => {
      doms.start.disabled = false;
      doms.start.textContent = 'Tap to start';
    });
  } catch (err) {
    showBootError(err && err.message ? err.message : String(err));
  }
}

function showBootError(msg) {
  state.bootFailed = true;
  doms.bootErrorMsg.textContent = msg || 'Unknown error.';
  doms.bootError.classList.remove('hidden');
  doms.bootError.classList.add('visible');
}

window.addEventListener('error', (e) => {
  if (!state.bootFailed) showBootError(e.message || 'A script error occurred.');
});
window.addEventListener('unhandledrejection', (e) => {
  if (!state.bootFailed) showBootError((e.reason && e.reason.message) || 'Unhandled promise rejection.');
});

boot();

// expose for debugging
window.__glyph = { state, player, pools, boss, startRun, endRun };
