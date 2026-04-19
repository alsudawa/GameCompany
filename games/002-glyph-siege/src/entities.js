import { state, player, pools, boss, acquire } from './state.js';
import {
  W, H, ENEMY_DEFS, GEM_XP, WEAPON_PROJ_SPEED, WEAPON_PROJ_LIFETIME,
  WEAPON_PROJ_RADIUS, WEAPON_FAN_DEG, PLAYER_INVULN_MS, PLAYER_RADIUS,
  BOSS_BASE_HP, BOSS_SPEED, BOSS_RADIUS, BOSS_DMG, BOSS_DASH_COOLDOWN_S,
  BOSS_DASH_TELEGRAPH_MS, BOSS_DASH_DURATION_MS, BOSS_DASH_SPEED,
} from './constants.js';
import { Sfx } from './sfx.js';

// -------------------- Particles --------------------
export function spawnParticles(x, y, count, color, speedMin, speedMax, lifeMs) {
  for (let i = 0; i < count; i++) {
    const p = acquire(pools.particles); if (!p) return;
    const ang = Math.random() * Math.PI * 2;
    const sp = speedMin + Math.random() * (speedMax - speedMin);
    p.active = true;
    p.x = x; p.y = y;
    p.vx = Math.cos(ang) * sp;
    p.vy = Math.sin(ang) * sp;
    p.color = color;
    p.size = 1.5 + Math.random() * 2.5;
    p.maxLife = lifeMs / 1000;
    p.life = p.maxLife;
  }
}

function updateParticles(dt) {
  for (let i = 0; i < pools.particles.length; i++) {
    const p = pools.particles[i];
    if (!p.active) continue;
    p.life -= dt;
    if (p.life <= 0) { p.active = false; continue; }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.92;
    p.vy *= 0.92;
  }
}

// -------------------- Gems --------------------
export function spawnGem(x, y, tier) {
  const g = acquire(pools.gems); if (!g) return;
  g.active = true;
  g.x = x; g.y = y;
  g.vx = (Math.random() - 0.5) * 60;
  g.vy = (Math.random() - 0.5) * 60;
  g.tier = tier;
  g.bob = Math.random() * Math.PI * 2;
}

function updateGems(dt) {
  const pr = player.pickupR;
  for (let i = 0; i < pools.gems.length; i++) {
    const g = pools.gems[i];
    if (!g.active) continue;
    // settle velocity
    g.vx *= 0.9;
    g.vy *= 0.9;
    g.bob += dt * 4;
    const dx = player.x - g.x;
    const dy = player.y - g.y;
    const d = Math.hypot(dx, dy);
    if (d < pr) {
      // magnet
      const s = 260 + (pr - d) * 2;
      g.vx += (dx / d) * s * dt;
      g.vy += (dy / d) * s * dt;
    }
    g.x += g.vx * dt;
    g.y += g.vy * dt;
    if (d < player.r + 6) {
      g.active = false;
      const xp = GEM_XP[g.tier] || 1;
      state.xp += xp;
      Sfx.gem(g.tier);
    }
  }
}

// -------------------- Enemies --------------------
export function spawnEnemyAtEdge(type) {
  const def = ENEMY_DEFS[type]; if (!def) return;
  const e = acquire(pools.enemies); if (!e) return;
  // spawn just off-edge
  const side = Math.floor(Math.random() * 4);
  const pad = 24;
  let x, y;
  if (side === 0) { x = Math.random() * W; y = -pad; }
  else if (side === 1) { x = W + pad; y = Math.random() * H; }
  else if (side === 2) { x = Math.random() * W; y = H + pad; }
  else { x = -pad; y = Math.random() * H; }
  e.active = true;
  e.type = type;
  e.x = x; e.y = y;
  e.vx = 0; e.vy = 0;
  e.r = def.radius;
  e.hp = def.hp;
  e.dmg = def.dmg;
  e.flashMs = 0;
}

function updateEnemies(dt) {
  const arr = pools.enemies;
  for (let i = 0; i < arr.length; i++) {
    const e = arr[i];
    if (!e.active) continue;
    const def = ENEMY_DEFS[e.type];
    const dx = player.x - e.x;
    const dy = player.y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    e.vx = (dx / d) * def.speed;
    e.vy = (dy / d) * def.speed;
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    if (e.flashMs > 0) e.flashMs -= dt * 1000;
    // contact damage
    const contact = d < e.r + player.r;
    if (contact && player.invulnMs <= 0) {
      player.hp -= e.dmg;
      player.invulnMs = PLAYER_INVULN_MS;
      state.hitFlashMs = 300;
      state.shake = 10;
      Sfx.hurt();
    }
  }
  // gentle separation pass (O(n^2) but capped by pool)
  for (let i = 0; i < arr.length; i++) {
    const a = arr[i]; if (!a.active) continue;
    for (let j = i + 1; j < arr.length; j++) {
      const b = arr[j]; if (!b.active) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      const minD = a.r + b.r - 1;
      if (d > 0 && d < minD) {
        const push = (minD - d) * 0.5;
        const nx = dx / d, ny = dy / d;
        a.x -= nx * push; a.y -= ny * push;
        b.x += nx * push; b.y += ny * push;
      }
    }
  }
}

// -------------------- Projectiles --------------------
function nearestEnemy() {
  let best = null, bestD = Infinity;
  for (let i = 0; i < pools.enemies.length; i++) {
    const e = pools.enemies[i];
    if (!e.active) continue;
    const dx = e.x - player.x, dy = e.y - player.y;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = e; }
  }
  if (!best && boss.active) return boss;
  return best;
}

export function fireWeapon() {
  const tgt = nearestEnemy(); if (!tgt) return;
  const dx = tgt.x - player.x, dy = tgt.y - player.y;
  const baseAng = Math.atan2(dy, dx);
  const n = player.projCount;
  for (let i = 0; i < n; i++) {
    const offset = (i - (n - 1) / 2) * (WEAPON_FAN_DEG * Math.PI / 180);
    const ang = baseAng + offset;
    const p = acquire(pools.projectiles); if (!p) return;
    p.active = true;
    p.x = player.x; p.y = player.y;
    p.vx = Math.cos(ang) * WEAPON_PROJ_SPEED;
    p.vy = Math.sin(ang) * WEAPON_PROJ_SPEED;
    p.r = WEAPON_PROJ_RADIUS;
    p.dmg = player.damage;
    p.life = WEAPON_PROJ_LIFETIME;
  }
}

function updateProjectiles(dt) {
  const arr = pools.projectiles;
  for (let i = 0; i < arr.length; i++) {
    const p = arr[i]; if (!p.active) continue;
    p.life -= dt;
    if (p.life <= 0) { p.active = false; continue; }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.x < -20 || p.x > W + 20 || p.y < -20 || p.y > H + 20) { p.active = false; continue; }
    // collide with enemies
    for (let j = 0; j < pools.enemies.length; j++) {
      const e = pools.enemies[j];
      if (!e.active) continue;
      const dx = e.x - p.x, dy = e.y - p.y;
      const rr = e.r + p.r;
      if (dx * dx + dy * dy <= rr * rr) {
        e.hp -= p.dmg;
        e.flashMs = 80;
        const def = ENEMY_DEFS[e.type];
        spawnParticles(p.x, p.y, 3, def.color, 40, 120, 200);
        Sfx.hit();
        p.active = false;
        if (e.hp <= 0) {
          e.active = false;
          state.kills++;
          const color = def.color;
          const sizeTier = def.radius > 15 ? 3 : def.radius > 12 ? 2 : 1;
          spawnParticles(e.x, e.y, 7 + sizeTier * 2, color, 60, 180, 450);
          Sfx.kill(sizeTier);
          const drops = def.gem === 2 ? 1 : 1;
          for (let d = 0; d < drops; d++) {
            spawnGem(e.x + (Math.random() - 0.5) * 10, e.y + (Math.random() - 0.5) * 10, def.gem);
          }
        }
        break;
      }
    }
    // collide with boss
    if (p.active && boss.active) {
      const dx = boss.x - p.x, dy = boss.y - p.y;
      const rr = boss.r + p.r;
      if (dx * dx + dy * dy <= rr * rr) {
        boss.hp -= p.dmg;
        boss.flashMs = 80;
        spawnParticles(p.x, p.y, 4, '#b98aff', 50, 140, 240);
        Sfx.hit();
        p.active = false;
      }
    }
  }
}

// -------------------- Boss --------------------
export function spawnBoss(index) {
  boss.active = true;
  boss.hp = BOSS_BASE_HP * index;
  boss.hpMax = boss.hp;
  boss.r = BOSS_RADIUS;
  boss.x = W / 2;
  boss.y = -40;
  boss.vx = 0;
  boss.vy = BOSS_SPEED;
  boss.dashCd = BOSS_DASH_COOLDOWN_S;
  boss.dashState = 'idle';
  boss.dashT = 0;
  boss.flashMs = 0;
  state.bossVignetteMs = 600;
  state.shake = Math.max(state.shake, 6);
  Sfx.bossSpawn();
}

function updateBoss(dt) {
  if (!boss.active) return;
  if (boss.flashMs > 0) boss.flashMs -= dt * 1000;
  // state machine
  if (boss.dashState === 'idle') {
    boss.dashCd -= dt;
    // steer toward player
    const dx = player.x - boss.x, dy = player.y - boss.y;
    const d = Math.hypot(dx, dy) || 1;
    boss.vx = (dx / d) * BOSS_SPEED;
    boss.vy = (dy / d) * BOSS_SPEED;
    boss.x += boss.vx * dt;
    boss.y += boss.vy * dt;
    if (boss.dashCd <= 0) {
      boss.dashState = 'telegraph';
      boss.dashT = BOSS_DASH_TELEGRAPH_MS / 1000;
      boss.dashDx = dx / d;
      boss.dashDy = dy / d;
      Sfx.bossTelegraph();
    }
  } else if (boss.dashState === 'telegraph') {
    boss.dashT -= dt;
    if (boss.dashT <= 0) {
      boss.dashState = 'dashing';
      boss.dashT = BOSS_DASH_DURATION_MS / 1000;
    }
  } else if (boss.dashState === 'dashing') {
    boss.dashT -= dt;
    boss.x += boss.dashDx * BOSS_DASH_SPEED * dt;
    boss.y += boss.dashDy * BOSS_DASH_SPEED * dt;
    if (boss.dashT <= 0) {
      boss.dashState = 'idle';
      boss.dashCd = BOSS_DASH_COOLDOWN_S;
    }
  }
  // clamp boss inside arena
  boss.x = Math.max(boss.r, Math.min(W - boss.r, boss.x));
  boss.y = Math.max(boss.r, Math.min(H - boss.r, boss.y));
  // contact
  const dx = player.x - boss.x, dy = player.y - boss.y;
  const d = Math.hypot(dx, dy);
  if (d < boss.r + player.r && player.invulnMs <= 0) {
    player.hp -= BOSS_DMG;
    player.invulnMs = PLAYER_INVULN_MS;
    state.hitFlashMs = 340;
    state.shake = 12;
    Sfx.hurt();
  }
  // death
  if (boss.hp <= 0) {
    boss.active = false;
    state.shake = Math.max(state.shake, 10);
    // drop 12 T2 gems
    for (let i = 0; i < 12; i++) {
      const ang = (i / 12) * Math.PI * 2;
      spawnGem(boss.x + Math.cos(ang) * 40, boss.y + Math.sin(ang) * 40, 2);
    }
    spawnParticles(boss.x, boss.y, 30, '#ffd36d', 80, 320, 700);
    spawnParticles(boss.x, boss.y, 20, '#b98aff', 80, 280, 700);
    Sfx.bossDown();
  }
}

// -------------------- Player --------------------
export function updatePlayer(dt) {
  if (state.input.mag > 0) {
    const sp = player.speed * state.input.mag;
    player.x += state.input.dx * sp * dt;
    player.y += state.input.dy * sp * dt;
  }
  // clamp to arena
  player.x = Math.max(player.r, Math.min(W - player.r, player.x));
  player.y = Math.max(player.r, Math.min(H - player.r, player.y));
  // weapon
  player.fireAcc += dt;
  if (player.fireAcc >= player.fireInterval) {
    player.fireAcc = 0;
    fireWeapon();
  }
  if (player.invulnMs > 0) player.invulnMs -= dt * 1000;
  player.rot += dt * 1.2;
}

// -------------------- System tick --------------------
export function updateAll(dt) {
  updatePlayer(dt);
  updateEnemies(dt);
  updateBoss(dt);
  updateProjectiles(dt);
  updateGems(dt);
  updateParticles(dt);
}
