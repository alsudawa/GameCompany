import { state, player, pools, boss } from './state.js';
import { W, H, ENEMY_DEFS, BOSS_RADIUS } from './constants.js';
import { drawJoystick } from './input.js';
import { sprites, enemySprite, gemSprite } from './assets.js';

// Draw size relative to entity radius. `draw = r * SCALE` (diameter).
const ENEMY_SCALE = 2.4;   // slightly oversized so the sprite outline breathes past the hitbox
const BOSS_SCALE = 2.25;
const PROJ_SCALE = 3.2;
const PLAYER_SCALE = 2.5;
// Gem diameters are absolute — they need to read as "food" at any distance.
const GEM_DIAM = { 1: 24, 2: 30, 3: 42 };

// Palette for procedural effects (particles, vignettes, frame glow) only.
const FX = {
  sigil: 'rgba(156, 228, 255, 0.22)',
  sigilHot: 'rgba(255, 180, 240, 0.65)',
  projectileGlow: '#7cf6ff',
  sparkle: '#fff8cc',
  warn: '#ff8fb1',
  playerGlow: '#c7f4ff',
};

const STARS = (() => {
  const arr = new Array(70);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = {
      x: Math.random() * W,
      y: Math.random() * H,
      r: 0.5 + Math.random() * 1.6,
      phase: Math.random() * Math.PI * 2,
      speed: 0.8 + Math.random() * 1.7,
    };
  }
  return arr;
})();

function applyShake(ctx) {
  if (state.shake > 0.1) {
    const mag = state.shake;
    ctx.translate((Math.random() - 0.5) * mag, (Math.random() - 0.5) * mag);
  }
}

function drawStarfield(ctx) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < STARS.length; i++) {
    const s = STARS[i];
    const t = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(state.t * s.speed + s.phase));
    ctx.globalAlpha = t;
    ctx.fillStyle = '#cfe9ff';
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawSigilFrame(ctx) {
  const pad = 10;
  ctx.save();
  ctx.strokeStyle = state.bossVignetteMs > 0 ? FX.sigilHot : FX.sigil;
  ctx.lineWidth = 2;
  ctx.setLineDash([18, 10]);
  ctx.lineDashOffset = -state.t * 14;
  ctx.beginPath();
  ctx.rect(pad, pad, W - pad * 2, H - pad * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  const pulse = 0.55 + 0.35 * Math.sin(state.t * 2.2);
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = pulse;
  ctx.fillStyle = FX.sparkle;
  ctx.shadowColor = FX.sparkle;
  ctx.shadowBlur = 8;
  const corners = [[pad, pad], [W - pad, pad], [pad, H - pad], [W - pad, H - pad]];
  for (let i = 0; i < corners.length; i++) {
    const cx = corners[i][0], cy = corners[i][1];
    ctx.beginPath();
    ctx.moveTo(cx,     cy - 5);
    ctx.lineTo(cx + 1, cy - 1);
    ctx.lineTo(cx + 5, cy);
    ctx.lineTo(cx + 1, cy + 1);
    ctx.lineTo(cx,     cy + 5);
    ctx.lineTo(cx - 1, cy + 1);
    ctx.lineTo(cx - 5, cy);
    ctx.lineTo(cx - 1, cy - 1);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// Draws the SVG sprite centered at (x, y) at size `d` (diameter).
// When `flashing` is true, overlays a white composite to indicate hit.
function drawSprite(ctx, img, x, y, d, flashing, rotate) {
  if (!img || !img.complete) return false;
  ctx.save();
  ctx.translate(x, y);
  if (rotate) ctx.rotate(rotate);
  ctx.drawImage(img, -d / 2, -d / 2, d, d);
  if (flashing) {
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    ctx.fillRect(-d / 2, -d / 2, d, d);
  }
  ctx.restore();
  return true;
}

function drawEnemies(ctx) {
  const arr = pools.enemies;
  for (let i = 0; i < arr.length; i++) {
    const e = arr[i]; if (!e.active) continue;
    const def = ENEMY_DEFS[e.type];
    const img = enemySprite(e.type);
    const d = e.r * ENEMY_SCALE;
    const wobble = Math.sin(state.t * 4 + e.x * 0.07) * d * 0.02;
    if (!drawSprite(ctx, img, e.x, e.y + wobble, d, e.flashMs > 0)) {
      // Fallback if sprite missing: draw a solid circle in type color.
      ctx.save();
      ctx.fillStyle = e.flashMs > 0 ? '#fff' : def.color;
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }
}

function drawProjectiles(ctx) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.shadowColor = FX.projectileGlow;
  ctx.shadowBlur = 12;
  for (let i = 0; i < pools.projectiles.length; i++) {
    const p = pools.projectiles[i]; if (!p.active) continue;
    const d = p.r * PROJ_SCALE;
    // ghost trail
    ctx.globalAlpha = 0.5;
    drawSprite(ctx, sprites.projectile, p.x - p.vx * 0.03, p.y - p.vy * 0.03, d * 0.85);
    // main
    ctx.globalAlpha = 1;
    if (!drawSprite(ctx, sprites.projectile, p.x, p.y, d)) {
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
}

function drawGems(ctx) {
  for (let i = 0; i < pools.gems.length; i++) {
    const g = pools.gems[i]; if (!g.active) continue;
    const bob = Math.sin(g.bob) * 2;
    const breathe = 1 + Math.sin(g.bob * 1.3) * 0.08;
    const img = gemSprite(g.tier);
    const d = (GEM_DIAM[g.tier] || 24) * breathe;
    const gx = g.x, gy = g.y + bob;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // soft halo so the gem reads as "food" at a glance
    const haloA = 0.25 + 0.25 * (0.5 + 0.5 * Math.sin(g.bob * 1.7));
    ctx.globalAlpha = haloA;
    ctx.fillStyle = g.tier === 3 ? '#ffe08a' : g.tier === 2 ? '#d4a8ff' : '#7cf6ff';
    ctx.beginPath();
    ctx.arc(gx, gy, d * 0.85, 0, Math.PI * 2);
    ctx.fill();
    // sparkle cross
    const sp = 0.4 + 0.45 * (0.5 + 0.5 * Math.sin(g.bob * 2.4));
    ctx.globalAlpha = sp;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.4;
    ctx.lineCap = 'round';
    const ext = d / 2 + 8;
    ctx.beginPath();
    ctx.moveTo(gx, gy - ext); ctx.lineTo(gx, gy + ext);
    ctx.moveTo(gx - ext, gy); ctx.lineTo(gx + ext, gy);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.restore();
    drawSprite(ctx, img, gx, gy, d);
  }
}

function drawPickupRing(ctx) {
  // Soft hint ring showing the magnet radius — subtle, always visible.
  const a = 0.06 + 0.04 * Math.sin(state.t * 2.4);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = a;
  ctx.strokeStyle = '#8feaff';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 6]);
  ctx.beginPath();
  ctx.arc(player.x, player.y, player.pickupR, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function drawParticles(ctx) {
  // Sparks (additive-blend, bright)
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < pools.particles.length; i++) {
    const p = pools.particles[i]; if (!p.active || p.smoke) continue;
    const a = Math.max(0, Math.min(1, p.life / p.maxLife));
    ctx.globalAlpha = a;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  // Smoke (normal blend, soft, fades)
  ctx.save();
  for (let i = 0; i < pools.particles.length; i++) {
    const p = pools.particles[i]; if (!p.active || !p.smoke) continue;
    const a = Math.max(0, Math.min(1, p.life / p.maxLife));
    ctx.globalAlpha = a * 0.35;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawOrbits(ctx) {
  const n = player.orbitCount;
  if (n <= 0) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.shadowColor = '#8feaff';
  ctx.shadowBlur = 18;
  for (let i = 0; i < n; i++) {
    const orb = pools.orbits[i];
    // trailing ghost
    const tx = orb.x - Math.cos(state.orbitAng + (i * Math.PI * 2) / n - 0.12) * 6;
    const ty = orb.y - Math.sin(state.orbitAng + (i * Math.PI * 2) / n - 0.12) * 6;
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#8feaff';
    ctx.beginPath();
    ctx.arc(tx, ty, 7, 0, Math.PI * 2);
    ctx.fill();
    // core
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#e8faff';
    ctx.beginPath();
    ctx.arc(orb.x, orb.y, 8, 0, Math.PI * 2);
    ctx.fill();
    // halo
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#8feaff';
    ctx.beginPath();
    ctx.arc(orb.x, orb.y, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawNovas(ctx) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < pools.novas.length; i++) {
    const p = pools.novas[i]; if (!p.active) continue;
    const prog = Math.min(1, p.t / p.duration);
    const r = p.maxR * prog;
    const a = (1 - prog) * 0.85;
    // outer thick ring
    ctx.globalAlpha = a;
    ctx.strokeStyle = '#d4a8ff';
    ctx.lineWidth = 6;
    ctx.shadowColor = '#d4a8ff';
    ctx.shadowBlur = 20;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.stroke();
    // inner bright ring
    ctx.globalAlpha = a * 0.8;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 0.96, 0, Math.PI * 2);
    ctx.stroke();
    // fill disk (fading)
    ctx.globalAlpha = a * 0.15;
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
    g.addColorStop(0, 'rgba(214,170,255,0.2)');
    g.addColorStop(1, 'rgba(214,170,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawShocks(ctx) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < pools.shocks.length; i++) {
    const s = pools.shocks[i]; if (!s.active) continue;
    const t = 1 - Math.max(0, Math.min(1, s.life / s.maxLife));  // 0..1 progress
    const r = s.maxR * (0.15 + t * 0.95);
    const a = (1 - t) * 0.9;
    ctx.globalAlpha = a;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width * (1 - t * 0.4);
    ctx.shadowColor = s.color;
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawPlayer(ctx) {
  const invuln = player.invulnMs > 0;
  const blink = invuln && Math.floor(player.invulnMs / 80) % 2 === 0;
  const idleBob = Math.sin(state.t * 3.2) * 1.2;
  // soft glow halo
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.35 + 0.15 * Math.sin(state.t * 2.6);
  ctx.fillStyle = FX.playerGlow;
  ctx.beginPath();
  ctx.arc(player.x, player.y + idleBob, player.r + 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // sprite — no rotation so the face stays upright
  const d = player.r * PLAYER_SCALE;
  if (blink) {
    ctx.save();
    ctx.globalAlpha = 0.85;
    drawSprite(ctx, sprites.player, player.x, player.y + idleBob, d, true);
    ctx.restore();
  } else {
    drawSprite(ctx, sprites.player, player.x, player.y + idleBob, d);
  }
}

function drawBoss(ctx) {
  if (!boss.active) return;
  const flashing = boss.flashMs > 0;
  // telegraph dash line
  if (boss.dashState === 'telegraph') {
    ctx.save();
    ctx.strokeStyle = FX.warn;
    ctx.globalAlpha = 0.45 + Math.sin(performance.now() / 40) * 0.3;
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(boss.x, boss.y);
    ctx.lineTo(boss.x + boss.dashDx * 600, boss.y + boss.dashDy * 600);
    ctx.stroke();
    ctx.restore();
  }
  // aura
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = '#d6aaff';
  ctx.beginPath();
  ctx.arc(boss.x, boss.y, BOSS_RADIUS * 1.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // sprite
  const d = BOSS_RADIUS * BOSS_SCALE;
  drawSprite(ctx, sprites.boss, boss.x, boss.y, d, flashing);
  // HP bar
  const barW = 88, barH = 6;
  const bx = boss.x - barW / 2;
  const by = Math.max(4, boss.y - BOSS_RADIUS - 18);
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(bx - 1, by - 1, barW + 2, barH + 2);
  ctx.fillStyle = FX.warn;
  ctx.fillRect(bx, by, barW * (boss.hp / boss.hpMax), barH);
  ctx.restore();
}

function drawVignettes(ctx) {
  if (state.hitFlashMs > 0) {
    const a = Math.min(0.5, state.hitFlashMs / 300 * 0.45);
    ctx.save();
    ctx.fillStyle = `rgba(255,93,115,${a})`;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
  if (state.bossVignetteMs > 0) {
    const a = Math.min(0.5, state.bossVignetteMs / 600 * 0.5);
    ctx.save();
    const grad = ctx.createRadialGradient(W / 2, H / 2, 100, W / 2, H / 2, H * 0.8);
    grad.addColorStop(0, 'rgba(214, 170, 255, 0)');
    grad.addColorStop(1, `rgba(214, 170, 255, ${a})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
  if (state.levelFlashMs > 0) {
    const a = Math.min(0.4, state.levelFlashMs / 120 * 0.4);
    ctx.save();
    ctx.fillStyle = `rgba(143, 234, 255, ${a})`;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
}

export function renderAll(ctx) {
  ctx.save();
  ctx.clearRect(0, 0, W, H);
  applyShake(ctx);
  drawStarfield(ctx);
  drawSigilFrame(ctx);
  drawPickupRing(ctx);
  drawGems(ctx);
  drawParticles(ctx);
  drawEnemies(ctx);
  drawBoss(ctx);
  drawProjectiles(ctx);
  drawOrbits(ctx);
  drawNovas(ctx);
  drawShocks(ctx);   // shockwaves OVER enemies so they pop on top
  drawPlayer(ctx);
  drawJoystick(ctx);
  ctx.restore();
  drawVignettes(ctx);
}
