import { state, player, pools, boss, acquire } from './state.js';
import {
  W, H, ENEMY_DEFS, GEM_XP, WEAPON_PROJ_SPEED, WEAPON_PROJ_LIFETIME,
  WEAPON_PROJ_RADIUS, WEAPON_FAN_DEG, PLAYER_INVULN_MS, PLAYER_RADIUS,
  BOSS_BASE_HP, BOSS_SPEED, BOSS_RADIUS, BOSS_DMG, BOSS_DASH_COOLDOWN_S,
  BOSS_DASH_TELEGRAPH_MS, BOSS_DASH_DURATION_MS, BOSS_DASH_SPEED,
  ORBIT_ANG_SPEED, ORBIT_RADIUS, ORBIT_DAMAGE, ORBIT_HIT_R, ORBIT_HIT_COOLDOWN_MS,
  NOVA_EXPAND_MS, BOMB_DROP_CHANCE, BOMB_MAX_INVENTORY, BOMB_BLAST_BOSS_DMG,
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
    p.smoke = false;
  }
}

// Soft gray smoke puff — slower, fatter, fades to transparent.
export function spawnSmoke(x, y, count, lifeMs) {
  for (let i = 0; i < count; i++) {
    const p = acquire(pools.particles); if (!p) return;
    const ang = Math.random() * Math.PI * 2;
    const sp = 30 + Math.random() * 40;
    p.active = true;
    p.x = x + (Math.random() - 0.5) * 6;
    p.y = y + (Math.random() - 0.5) * 6;
    p.vx = Math.cos(ang) * sp;
    p.vy = Math.sin(ang) * sp;
    p.color = '#ced9ff';
    p.size = 6 + Math.random() * 6;
    p.maxLife = lifeMs / 1000;
    p.life = p.maxLife;
    p.smoke = true;
  }
}

// Expanding ring on kills / impacts. Grows from 0 to maxR over life.
export function spawnShock(x, y, maxR, lifeMs, color, width = 3) {
  const s = acquire(pools.shocks); if (!s) return;
  s.active = true;
  s.x = x; s.y = y;
  s.maxR = maxR;
  s.maxLife = lifeMs / 1000;
  s.life = s.maxLife;
  s.width = width;
  s.color = color;
}

function updateParticles(dt) {
  for (let i = 0; i < pools.particles.length; i++) {
    const p = pools.particles[i];
    if (!p.active) continue;
    p.life -= dt;
    if (p.life <= 0) { p.active = false; continue; }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.smoke) {
      p.vx *= 0.90;
      p.vy *= 0.90;
      p.size += dt * 18;  // smoke expands
    } else {
      p.vx *= 0.92;
      p.vy *= 0.92;
    }
  }
}

function updateShocks(dt) {
  for (let i = 0; i < pools.shocks.length; i++) {
    const s = pools.shocks[i];
    if (!s.active) continue;
    s.life -= dt;
    if (s.life <= 0) s.active = false;
  }
}

// Shared kill effect — used by bolt, orbit, nova, bomb.
export function killEnemyFx(e) {
  const def = ENEMY_DEFS[e.type];
  const sizeTier = def.radius > 15 ? 3 : def.radius > 12 ? 2 : 1;
  spawnParticles(e.x, e.y, 12 + sizeTier * 4, def.color, 80, 240, 500);
  spawnParticles(e.x, e.y, 4 + sizeTier, '#ffffff', 120, 280, 250);
  spawnSmoke(e.x, e.y, 3 + sizeTier, 480);
  const ringR = 22 + sizeTier * 12;
  spawnShock(e.x, e.y, ringR, 300, e.type === 'elite' ? '#ffe08a' : '#ffffff', 3);
  state.shake = Math.max(state.shake, 2 + sizeTier * 1.5);
  Sfx.kill(sizeTier);
  spawnGem(e.x + (Math.random() - 0.5) * 10, e.y + (Math.random() - 0.5) * 10, def.gem);
  maybeDropBomb(e);
  state.kills++;
  e.active = false;
}

// -------------------- Bombs (pickup item) --------------------
export function spawnBomb(x, y) {
  const b = acquire(pools.bombs); if (!b) return;
  b.active = true;
  b.x = x; b.y = y;
  b.vx = (Math.random() - 0.5) * 80;
  b.vy = -60 - Math.random() * 60;
  b.bob = Math.random() * Math.PI * 2;
}

function maybeDropBomb(e) {
  const chance = BOMB_DROP_CHANCE[e.type] || 0;
  if (Math.random() < chance) spawnBomb(e.x, e.y);
}

function updateBombs(dt) {
  const pr = player.pickupR;
  for (let i = 0; i < pools.bombs.length; i++) {
    const b = pools.bombs[i]; if (!b.active) continue;
    // drift + gentle magnet toward player (weaker than gems so they sit and
    // beg to be seen)
    b.vx *= 0.90;
    b.vy = b.vy * 0.90 + 30 * dt; // slight gravity so they settle
    b.bob += dt * 3;
    const dx = player.x - b.x, dy = player.y - b.y;
    const d = Math.hypot(dx, dy);
    if (d < pr * 1.2) {
      const pull = 320 + (pr - d) * 3;
      b.vx += (dx / d) * pull * dt;
      b.vy += (dy / d) * pull * dt;
    }
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    // pickup
    if (d < player.r + 20) {
      b.active = false;
      if (state.bombs < BOMB_MAX_INVENTORY) {
        state.bombs = Math.min(BOMB_MAX_INVENTORY, state.bombs + 1);
      }
      Sfx.bombPickup && Sfx.bombPickup();
      // pickup flash
      spawnParticles(b.x, b.y, 14, '#ffd36d', 100, 260, 500);
      spawnShock(b.x, b.y, 50, 260, '#ffd36d', 3);
    }
  }
}

// Detonate one bomb from inventory. Called from UI button or 'B' key.
export function detonateBomb() {
  if (state.bombs <= 0) return false;
  state.bombs -= 1;
  state.bombFlashMs = 320;
  state.shake = Math.max(state.shake, 18);
  Sfx.bomb && Sfx.bomb();
  // three concentric expanding rings — WHITE + GOLD + PINK
  spawnShock(player.x, player.y, 520, 700, '#ffffff', 8);
  spawnShock(player.x, player.y, 460, 650, '#ffd36d', 6);
  spawnShock(player.x, player.y, 400, 600, '#ff8fb1', 5);
  // particle storm
  spawnParticles(player.x, player.y, 60, '#fff1a8', 120, 460, 800);
  spawnParticles(player.x, player.y, 40, '#ffb04c', 180, 460, 800);
  spawnSmoke(player.x, player.y, 40, 1400);
  // wipe all active enemies — lightweight kill (no cascading killEnemyFx
  // storm). Each still drops a gem for reward rain.
  for (let i = 0; i < pools.enemies.length; i++) {
    const e = pools.enemies[i]; if (!e.active) continue;
    const def = ENEMY_DEFS[e.type];
    state.kills++;
    spawnGem(e.x, e.y, def.gem);
    spawnParticles(e.x, e.y, 5, def.color, 80, 220, 420);
    e.active = false;
  }
  // knock boss hard (but don't one-shot)
  if (boss.active) {
    boss.hp = Math.max(1, boss.hp - BOMB_BLAST_BOSS_DMG);
    boss.flashMs = 240;
    spawnParticles(boss.x, boss.y, 14, '#d4a8ff', 100, 280, 500);
  }
  return true;
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
    g.vx *= 0.88;
    g.vy *= 0.88;
    g.bob += dt * 4;
    const dx = player.x - g.x;
    const dy = player.y - g.y;
    const d = Math.hypot(dx, dy);
    if (d < pr) {
      // strong magnet: closer = faster, capped
      const pull = 420 + (pr - d) * 4.5;
      g.vx += (dx / d) * pull * dt;
      g.vy += (dy / d) * pull * dt;
    }
    g.x += g.vx * dt;
    g.y += g.vy * dt;
    // generous collection radius — gems should pop to you like food
    if (d < player.r + 16) {
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
  const pad = 28;
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
  e.angle = 0;
  // For line-behavior enemies, commit to a straight-line vector aimed at
  // the player's CURRENT position. Player can dodge.
  if (def.behavior === 'line') {
    const dx = player.x - x, dy = player.y - y;
    const d = Math.hypot(dx, dy) || 1;
    e.vx = (dx / d) * def.speed;
    e.vy = (dy / d) * def.speed;
    e.angle = Math.atan2(dy, dx);
  }
}

function updateEnemies(dt) {
  const arr = pools.enemies;
  for (let i = 0; i < arr.length; i++) {
    const e = arr[i];
    if (!e.active) continue;
    const def = ENEMY_DEFS[e.type];
    if (def.behavior === 'line') {
      // committed straight line — do not chase
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      // despawn once far enough off the arena on the exit side
      const pad = 40;
      if (e.x < -pad || e.x > W + pad || e.y < -pad || e.y > H + pad) {
        e.active = false;
      }
    } else {
      // seeker behavior
      const dx = player.x - e.x;
      const dy = player.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      e.vx = (dx / d) * def.speed;
      e.vy = (dy / d) * def.speed;
      e.x += e.vx * dt;
      e.y += e.vy * dt;
    }
    if (e.flashMs > 0) e.flashMs -= dt * 1000;
    // contact damage
    const dx2 = player.x - e.x, dy2 = player.y - e.y;
    const dc = Math.hypot(dx2, dy2);
    if (dc < e.r + player.r && player.invulnMs <= 0) {
      player.hp -= e.dmg;
      player.invulnMs = PLAYER_INVULN_MS;
      state.hitFlashMs = 300;
      state.shake = 10;
      Sfx.hurt();
    }
  }
  // gentle separation pass — skip line-behavior enemies (darts should keep
  // their committed vector, they look silly being nudged).
  for (let i = 0; i < arr.length; i++) {
    const a = arr[i]; if (!a.active) continue;
    if (ENEMY_DEFS[a.type].behavior === 'line') continue;
    for (let j = i + 1; j < arr.length; j++) {
      const b = arr[j]; if (!b.active) continue;
      if (ENEMY_DEFS[b.type].behavior === 'line') continue;
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
    p.pierce = player.pierce;
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
    // collide with enemies — pierce only continues through KILLS.
    // Hitting a survivor (e.g. Heavy tanking 1/4 hp) stops the projectile.
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
        if (e.hp <= 0) {
          killEnemyFx(e);
          // pierce through the kill
          p.pierce--;
          if (p.pierce < 0) { p.active = false; break; }
        } else {
          // non-kill hit: projectile dies, add a small spark
          spawnParticles(p.x, p.y, 2, '#ffffff', 60, 160, 180);
          p.active = false;
          break;
        }
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
    state.shake = Math.max(state.shake, 12);
    // drop 12 T2 gems + guaranteed 2 bombs
    for (let i = 0; i < 12; i++) {
      const ang = (i / 12) * Math.PI * 2;
      spawnGem(boss.x + Math.cos(ang) * 40, boss.y + Math.sin(ang) * 40, 2);
    }
    spawnBomb(boss.x - 18, boss.y);
    spawnBomb(boss.x + 18, boss.y);
    spawnParticles(boss.x, boss.y, 30, '#ffd36d', 80, 320, 700);
    spawnParticles(boss.x, boss.y, 20, '#b98aff', 80, 280, 700);
    spawnShock(boss.x, boss.y, 260, 500, '#ffd36d', 5);
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

// -------------------- Orbit Spirit --------------------
function updateOrbits(dt) {
  const n = player.orbitCount;
  if (n <= 0) return;
  state.orbitAng += ORBIT_ANG_SPEED * dt;
  const now = performance.now();
  for (let i = 0; i < n; i++) {
    const orb = pools.orbits[i];
    const a = state.orbitAng + (i * Math.PI * 2) / n;
    const ox = player.x + Math.cos(a) * ORBIT_RADIUS;
    const oy = player.y + Math.sin(a) * ORBIT_RADIUS;
    orb.x = ox; orb.y = oy;
    // Trail emission: a few sparkles behind the orb as it sweeps.
    if (state.t - orb.lastTrailT > 0.045) {
      orb.lastTrailT = state.t;
      const tp = acquire(pools.particles);
      if (tp) {
        tp.active = true;
        tp.x = ox + (Math.random() - 0.5) * 4;
        tp.y = oy + (Math.random() - 0.5) * 4;
        tp.vx = -Math.cos(a) * 28 + (Math.random() - 0.5) * 24;
        tp.vy = -Math.sin(a) * 28 + (Math.random() - 0.5) * 24;
        tp.color = '#a5f0ff';
        tp.size = 2 + Math.random() * 1.6;
        tp.maxLife = 0.42;
        tp.life = tp.maxLife;
        tp.smoke = false;
      }
    }
    // collide with enemies
    for (let j = 0; j < pools.enemies.length; j++) {
      const e = pools.enemies[j]; if (!e.active) continue;
      const dx = e.x - ox, dy = e.y - oy;
      const rr = e.r + ORBIT_HIT_R;
      if (dx * dx + dy * dy > rr * rr) continue;
      if (now - orb.hitTimes[j] < ORBIT_HIT_COOLDOWN_MS) continue;
      orb.hitTimes[j] = now;
      e.hp -= ORBIT_DAMAGE;
      e.flashMs = 80;
      const def = ENEMY_DEFS[e.type];
      spawnParticles(ox, oy, 3, def.color, 50, 130, 220);
      Sfx.hit();
      if (e.hp <= 0) killEnemyFx(e);
    }
    // collide with boss (separate timestamp to avoid clashing with enemy slots)
    if (boss.active) {
      const dx = boss.x - ox, dy = boss.y - oy;
      const rr = boss.r + ORBIT_HIT_R;
      if (dx * dx + dy * dy <= rr * rr && now - (orb.bossHit || 0) >= ORBIT_HIT_COOLDOWN_MS) {
        orb.bossHit = now;
        boss.hp -= ORBIT_DAMAGE;
        boss.flashMs = 80;
        spawnParticles(ox, oy, 4, '#b98aff', 50, 140, 240);
        Sfx.hit();
      }
    }
  }
}

// -------------------- Nova Pulse --------------------
export function fireNova() {
  const p = acquire(pools.novas); if (!p) return;
  p.active = true;
  p.x = player.x; p.y = player.y;
  p.t = 0;
  p.duration = NOVA_EXPAND_MS / 1000;
  p.maxR = player.novaMaxR;
  p.damage = player.novaDamage;
  p.bossHit = false;
  state.shake = Math.max(state.shake, 4);
  Sfx.nova && Sfx.nova();
}

function updateNovas(dt) {
  // cooldown auto-fire
  if (player.novaInterval > 0) {
    player.novaCd -= dt;
    if (player.novaCd <= 0) {
      player.novaCd = player.novaInterval;
      fireNova();
    }
  }
  // expand active pulses and damage enemies crossed by the ring front
  for (let i = 0; i < pools.novas.length; i++) {
    const p = pools.novas[i]; if (!p.active) continue;
    const prevR = p.maxR * (p.t / p.duration);
    p.t += dt;
    const curR = p.maxR * Math.min(1, p.t / p.duration);
    for (let j = 0; j < pools.enemies.length; j++) {
      const e = pools.enemies[j]; if (!e.active) continue;
      const dx = e.x - p.x, dy = e.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d >= prevR && d < curR) {
        e.hp -= p.damage;
        e.flashMs = 80;
        const def = ENEMY_DEFS[e.type];
        spawnParticles(e.x, e.y, 4, def.color, 60, 160, 240);
        // gentle knockback away from pulse center
        if (d > 0) {
          e.x += (dx / d) * 3;
          e.y += (dy / d) * 3;
        }
        if (e.hp <= 0) killEnemyFx(e);
      }
    }
    if (boss.active && !p.bossHit) {
      const dx = boss.x - p.x, dy = boss.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d < curR && d >= prevR) {
        boss.hp -= p.damage;
        boss.flashMs = 80;
        p.bossHit = true;
        spawnParticles(boss.x, boss.y, 6, '#d4a8ff', 80, 200, 300);
      }
    }
    if (p.t >= p.duration) p.active = false;
  }
}

// -------------------- System tick --------------------
export function updateAll(dt) {
  updatePlayer(dt);
  updateEnemies(dt);
  updateBoss(dt);
  updateProjectiles(dt);
  updateOrbits(dt);
  updateNovas(dt);
  updateBombs(dt);
  updateGems(dt);
  updateParticles(dt);
  updateShocks(dt);
}
