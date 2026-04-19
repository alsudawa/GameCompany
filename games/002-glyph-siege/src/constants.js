// Tunables for glyph-siege. Keep all magic numbers here.
export const W = 720;
export const H = 960;
export const FIXED_DT = 1 / 60;
export const MAX_DT = 1 / 30;

// Player
export const PLAYER_SPEED_BASE = 200;
export const PLAYER_HP_BASE = 5;
export const PLAYER_RADIUS = 14;
export const PLAYER_INVULN_MS = 400;
export const PLAYER_PICKUP_R_BASE = 60;

// Weapon
export const WEAPON_INTERVAL_BASE = 0.9;
export const WEAPON_DAMAGE_BASE = 1;
export const WEAPON_PROJ_COUNT_BASE = 1;
export const WEAPON_PROJ_SPEED = 420;
export const WEAPON_PROJ_LIFETIME = 1.2;
export const WEAPON_PROJ_RADIUS = 6;
export const WEAPON_FAN_DEG = 10;

// Enemies
export const ENEMY_DEFS = {
  grunt: { hp: 1, speed: 70,  dmg: 1, radius: 12, color: '#9aa3c9', shape: 'circle',  gem: 1, cost: 1 },
  scout: { hp: 1, speed: 140, dmg: 1, radius: 11, color: '#ffd36d', shape: 'triangle', gem: 1, cost: 1 },
  heavy: { hp: 4, speed: 50,  dmg: 1, radius: 18, color: '#ff5d73', shape: 'square',  gem: 2, cost: 3 },
  elite: { hp: 2, speed: 100, dmg: 1, radius: 14, color: '#b98aff', shape: 'hexagon', gem: 2, cost: 4 },
};

// XP / leveling — gentle early ramp: first level-up at 10 XP, then +5 per level.
export const XP_TABLE = (n) => 5 + n * 5;
export const GEM_XP = { 1: 1, 2: 3, 3: 10 };

// Wave waypoints (time s, spawn interval s, batch budget, allowed types)
export const WAVE_WAYPOINTS = [
  { t: 0,   interval: 1.2, budget: 1, types: ['grunt'] },
  { t: 15,  interval: 1.0, budget: 2, types: ['grunt'] },
  { t: 30,  interval: 0.9, budget: 3, types: ['grunt','scout'] },
  { t: 90,  interval: 0.7, budget: 5, types: ['grunt','scout','heavy'] },
  { t: 180, interval: 0.45, budget: 8, types: ['grunt','scout','heavy','elite'] },
];

// Boss
export const BOSS_INTERVAL = 90;
export const BOSS_BASE_HP = 40;
export const BOSS_SPEED = 60;
export const BOSS_RADIUS = 36;
export const BOSS_DMG = 2;
export const BOSS_DASH_SPEED = 280;
export const BOSS_DASH_TELEGRAPH_MS = 600;
export const BOSS_DASH_DURATION_MS = 400;
export const BOSS_DASH_COOLDOWN_S = 4;

// Pool caps
export const POOL_ENEMIES = 200;
export const POOL_PROJECTILES = 140;
export const POOL_GEMS = 120;
export const POOL_PARTICLES = 360;

// Upgrades
export const UPGRADES = {
  DMG:    { name: 'Keen Edge',   max: 5, icon: 'blade',  desc: (n) => `Damage ${n}→${n+1}` },
  RATE:   { name: 'Quick Sigil', max: 5, icon: 'bolt',   desc: (n) => `Fire rate +15%` },
  MULTI:  { name: 'Echo Ward',   max: 4, icon: 'fan',    desc: (n) => `Projectiles ${n+1}→${n+2}` },
  SPD:    { name: 'Swift Foot',  max: 4, icon: 'wing',   desc: (n) => `Move speed +15%` },
  MAGNET: { name: 'Wide Reach',  max: 3, icon: 'orbit',  desc: (n) => `Pickup reach +50%` },
  VIT:    { name: 'Inner Light', max: 3, icon: 'heart',  desc: (n) => `Max HP +2, full heal` },
};
