// Tunables for glyph-siege. Keep all magic numbers here.
export const W = 720;
export const H = 960;
export const FIXED_DT = 1 / 60;
export const MAX_DT = 1 / 30;

// Player
export const PLAYER_SPEED_BASE = 210;
export const PLAYER_HP_BASE = 5;
export const PLAYER_RADIUS = 14;
export const PLAYER_INVULN_MS = 400;
export const PLAYER_PICKUP_R_BASE = 110;

// Weapon
export const WEAPON_INTERVAL_BASE = 0.9;
export const WEAPON_DAMAGE_BASE = 1;
export const WEAPON_PROJ_COUNT_BASE = 1;
export const WEAPON_PIERCE_BASE = 1;      // hits 2 enemies per shot if both die
export const WEAPON_PROJ_SPEED = 420;
export const WEAPON_PROJ_LIFETIME = 1.2;
export const WEAPON_PROJ_RADIUS = 6;
export const WEAPON_FAN_DEG = 10;

// Enemies
export const ENEMY_DEFS = {
  grunt: { hp: 1, speed: 70,  dmg: 1, radius: 12, color: '#9aa3c9', shape: 'circle',  gem: 1, cost: 1, behavior: 'seek' },
  scout: { hp: 1, speed: 140, dmg: 1, radius: 11, color: '#ffd36d', shape: 'triangle', gem: 1, cost: 1, behavior: 'seek' },
  heavy: { hp: 4, speed: 50,  dmg: 1, radius: 18, color: '#ff5d73', shape: 'square',  gem: 2, cost: 3, behavior: 'seek' },
  elite: { hp: 2, speed: 100, dmg: 1, radius: 14, color: '#b98aff', shape: 'hexagon', gem: 2, cost: 4, behavior: 'seek' },
  // Dart: commits to a straight-line vector at spawn. Player can dodge by
  // sidestepping. Does not chase. Despawns off-arena.
  dart:  { hp: 1, speed: 210, dmg: 1, radius: 10, color: '#ff7a4c', shape: 'arrow',   gem: 1, cost: 2, behavior: 'line' },
};

// XP / leveling — gentle early ramp: first level-up at 10 XP, then +5 per level.
export const XP_TABLE = (n) => 5 + n * 5;
export const GEM_XP = { 1: 1, 2: 3, 3: 10 };

// Wave waypoints (time s, spawn interval s, batch budget, allowed types)
// Budgets tuned after CEO playtest: base weapon + pierce needed breathing room.
export const WAVE_WAYPOINTS = [
  { t: 0,   interval: 1.2, budget: 1, types: ['grunt'] },
  { t: 15,  interval: 1.0, budget: 2, types: ['grunt'] },
  { t: 30,  interval: 0.95, budget: 3, types: ['grunt','scout'] },
  { t: 60,  interval: 0.9, budget: 3, types: ['grunt','scout','dart'] },
  { t: 90,  interval: 0.8, budget: 4, types: ['grunt','scout','heavy','dart'] },
  { t: 180, interval: 0.6, budget: 6, types: ['grunt','scout','heavy','elite','dart'] },
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
export const POOL_PARTICLES = 480;
export const POOL_SHOCKS = 40;   // expanding kill rings

// Orbit Spirit (weapon upgrade — orbs rotate around player)
export const ORBIT_MAX = 4;
export const ORBIT_RADIUS = 78;
export const ORBIT_ANG_SPEED = 3.0;          // rad/s
export const ORBIT_DAMAGE = 1;
export const ORBIT_HIT_R = 14;               // effective orb hit radius
export const ORBIT_HIT_COOLDOWN_MS = 380;    // same-enemy re-hit delay per orb

// Nova Pulse (weapon upgrade — periodic expanding AOE ring)
export const NOVA_MAX = 4;
export const NOVA_EXPAND_MS = 380;           // how long the ring takes to reach maxR
export const NOVA_TIERS = [
  null,                                        // rank 0: disabled
  { interval: 6.0, maxR: 110, damage: 2 },
  { interval: 4.5, maxR: 150, damage: 3 },
  { interval: 3.0, maxR: 190, damage: 4 },
  { interval: 2.0, maxR: 230, damage: 5 },
];
export const POOL_NOVAS = 4;                 // concurrent active pulses

// Bombs (pickup item — collectible screen-clear)
export const POOL_BOMBS = 10;
export const BOMB_MAX_INVENTORY = 3;
export const BOMB_DROP_CHANCE = {
  grunt: 0.012,
  scout: 0.018,
  heavy: 0.08,
  elite: 0.12,
  dart:  0.015,
};
export const BOMB_BLAST_BOSS_DMG = 20;

// Upgrades
export const UPGRADES = {
  DMG:    { name: 'Keen Edge',   max: 5,        icon: 'blade',  desc: (n) => `Damage ${n}→${n+1}` },
  RATE:   { name: 'Quick Sigil', max: 5,        icon: 'bolt',   desc: (n) => `Fire rate +15%` },
  MULTI:  { name: 'Echo Ward',   max: 4,        icon: 'fan',    desc: (n) => `Projectiles ${n+1}→${n+2}` },
  ORBIT:  { name: 'Orbit Spirit',max: ORBIT_MAX,icon: 'aura',   desc: (n) => `Orb ${n}→${n+1}` },
  NOVA:   { name: 'Nova Pulse',  max: NOVA_MAX, icon: 'burst',  desc: (n) => n === 0 ? 'Unlock shockwave ring' : `Faster + bigger (${n}→${n+1})` },
  SPD:    { name: 'Swift Foot',  max: 4,        icon: 'wing',   desc: (n) => `Move speed +15%` },
  MAGNET: { name: 'Wide Reach',  max: 3,        icon: 'magnet', desc: (n) => `Pickup reach +50%` },
  VIT:    { name: 'Inner Light', max: 3,        icon: 'heart',  desc: (n) => `Max HP +2, full heal` },
};
