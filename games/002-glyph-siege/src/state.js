import {
  POOL_ENEMIES, POOL_PROJECTILES, POOL_GEMS, POOL_PARTICLES,
  PLAYER_HP_BASE, PLAYER_SPEED_BASE, PLAYER_PICKUP_R_BASE,
  WEAPON_INTERVAL_BASE, WEAPON_DAMAGE_BASE, WEAPON_PROJ_COUNT_BASE,
  W, H,
} from './constants.js';

// Every entity gets reused via `active` flag. No allocations in hot path.
function makePool(n, factory) {
  const arr = new Array(n);
  for (let i = 0; i < n; i++) arr[i] = factory();
  return arr;
}

export const state = {
  // Run lifecycle
  running: false,
  over: false,
  paused: false,
  bootFailed: false,
  // Time
  t: 0,          // seconds in-run
  clock: 0,      // ms since session
  shake: 0,      // screen shake px decaying
  // HUD
  kills: 0,
  score: 0,
  level: 1,
  xp: 0,
  xpNeeded: 20,
  // Best
  best: 0,
  isNewBest: false,
  // Boss
  bossNext: 90,  // next boss time (seconds)
  bossIndex: 0,
  // Effects
  hitFlashMs: 0,      // full-screen red flash after player hit
  levelFlashMs: 0,    // cyan flash on level-up
  bossVignetteMs: 0,  // red vignette on boss spawn
  // Spawn timers
  spawnAcc: 0,
  // Canvas
  canvas: null,
  ctx: null,
  dpr: 1,
  // Input (unit vector + magnitude in 0..1; filled by input.js each frame)
  input: { dx: 0, dy: 0, mag: 0, active: false, originX: 0, originY: 0, curX: 0, curY: 0 },
  // Audio
  muted: false,
  reducedMotion: false,
};

export const player = {
  x: W / 2,
  y: H / 2,
  r: 14,
  hp: PLAYER_HP_BASE,
  hpMax: PLAYER_HP_BASE,
  speed: PLAYER_SPEED_BASE,
  pickupR: PLAYER_PICKUP_R_BASE,
  fireInterval: WEAPON_INTERVAL_BASE,
  fireAcc: 0,
  damage: WEAPON_DAMAGE_BASE,
  projCount: WEAPON_PROJ_COUNT_BASE,
  invulnMs: 0,
  rot: 0,
  // per-upgrade rank
  ranks: { DMG: 0, RATE: 0, MULTI: 0, SPD: 0, MAGNET: 0, VIT: 0 },
};

export const pools = {
  enemies:     makePool(POOL_ENEMIES,     () => ({ active: false, type: 'grunt', x: 0, y: 0, vx: 0, vy: 0, r: 12, hp: 1, dmg: 1, flashMs: 0 })),
  projectiles: makePool(POOL_PROJECTILES, () => ({ active: false, x: 0, y: 0, vx: 0, vy: 0, r: 6, dmg: 1, life: 0 })),
  gems:        makePool(POOL_GEMS,        () => ({ active: false, x: 0, y: 0, vx: 0, vy: 0, tier: 1, bob: 0 })),
  particles:   makePool(POOL_PARTICLES,   () => ({ active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 0, color: '#fff', size: 2 })),
};

export const boss = {
  active: false,
  x: 0, y: 0,
  vx: 0, vy: 0,
  r: 0,
  hp: 0,
  hpMax: 0,
  dashCd: 0,
  dashState: 'idle', // idle | telegraph | dashing
  dashT: 0,
  dashDx: 0,
  dashDy: 0,
  flashMs: 0,
};

export function resetPool(p) {
  for (let i = 0; i < p.length; i++) p[i].active = false;
}

export function acquire(p) {
  for (let i = 0; i < p.length; i++) if (!p[i].active) return p[i];
  return null; // pool exhausted; caller handles (usually drop the spawn)
}

export function count(p) {
  let n = 0;
  for (let i = 0; i < p.length; i++) if (p[i].active) n++;
  return n;
}
