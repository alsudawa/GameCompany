import { state, player, pools, boss } from './state.js';
import { W, H, ENEMY_DEFS, BOSS_RADIUS } from './constants.js';
import { drawJoystick } from './input.js';

// Colors from art spec.
const COLORS = {
  bg: '#05061a',
  sigil: 'rgba(124,246,255,0.18)',
  sigilHot: 'rgba(185,138,255,0.55)',
  player: '#7cf6ff',
  projectile: '#7cf6ff',
  gemT1: '#7cf6ff',
  gemT2: '#b98aff',
  gemT3: '#ffd36d',
  bossBody: '#3a1f5c',
  bossEdge: '#b98aff',
  warn: '#ff5d73',
};

function applyShake(ctx) {
  if (state.shake > 0.1) {
    const mag = state.shake;
    const dx = (Math.random() - 0.5) * mag;
    const dy = (Math.random() - 0.5) * mag;
    ctx.translate(dx, dy);
  }
}

function drawSigilFrame(ctx) {
  const pad = 10;
  ctx.save();
  ctx.strokeStyle = state.bossVignetteMs > 0 ? COLORS.sigilHot : COLORS.sigil;
  ctx.lineWidth = 2;
  ctx.setLineDash([18, 10]);
  ctx.lineDashOffset = -state.t * 14;
  ctx.beginPath();
  ctx.rect(pad, pad, W - pad * 2, H - pad * 2);
  ctx.stroke();
  ctx.restore();
}

function drawShape(ctx, shape, x, y, r, fill, edge) {
  ctx.beginPath();
  if (shape === 'circle') {
    ctx.arc(x, y, r, 0, Math.PI * 2);
  } else if (shape === 'triangle') {
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI / 2 + i * (Math.PI * 2 / 3);
      const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
  } else if (shape === 'square') {
    ctx.rect(x - r, y - r, r * 2, r * 2);
  } else if (shape === 'hexagon') {
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3;
      const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
  }
  ctx.fillStyle = fill;
  ctx.fill();
  if (edge) { ctx.strokeStyle = edge; ctx.lineWidth = 1.5; ctx.stroke(); }
}

function drawEnemies(ctx) {
  const arr = pools.enemies;
  for (let i = 0; i < arr.length; i++) {
    const e = arr[i]; if (!e.active) continue;
    const def = ENEMY_DEFS[e.type];
    const flashing = e.flashMs > 0;
    drawShape(ctx, def.shape, e.x, e.y, e.r, flashing ? '#ffffff' : def.color, 'rgba(0,0,0,0.4)');
  }
}

function drawProjectiles(ctx) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = COLORS.projectile;
  ctx.shadowColor = COLORS.projectile;
  ctx.shadowBlur = 10;
  for (let i = 0; i < pools.projectiles.length; i++) {
    const p = pools.projectiles[i]; if (!p.active) continue;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawGems(ctx) {
  for (let i = 0; i < pools.gems.length; i++) {
    const g = pools.gems[i]; if (!g.active) continue;
    const bob = Math.sin(g.bob) * 1.2;
    const color = g.tier === 3 ? COLORS.gemT3 : g.tier === 2 ? COLORS.gemT2 : COLORS.gemT1;
    const r = 3 + g.tier;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(g.x, g.y + bob, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawParticles(ctx) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < pools.particles.length; i++) {
    const p = pools.particles[i]; if (!p.active) continue;
    const a = Math.max(0, Math.min(1, p.life / p.maxLife));
    ctx.globalAlpha = a;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawPlayer(ctx) {
  const invuln = player.invulnMs > 0;
  const blink = invuln && Math.floor(player.invulnMs / 80) % 2 === 0;
  ctx.save();
  ctx.translate(player.x, player.y);
  ctx.rotate(player.rot);
  // outer ring
  ctx.strokeStyle = blink ? 'rgba(255,255,255,0.5)' : COLORS.player;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(0, 0, player.r + 2, 0, Math.PI * 2);
  ctx.stroke();
  // 6-pointed glyph
  ctx.fillStyle = blink ? '#ffffff' : COLORS.player;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3;
    const r = i % 2 === 0 ? player.r : player.r * 0.45;
    const px = Math.cos(a) * r, py = Math.sin(a) * r;
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawBoss(ctx) {
  if (!boss.active) return;
  const flashing = boss.flashMs > 0;
  // telegraph line
  if (boss.dashState === 'telegraph') {
    ctx.save();
    ctx.strokeStyle = COLORS.warn;
    ctx.globalAlpha = 0.4 + Math.sin(performance.now() / 40) * 0.3;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(boss.x, boss.y);
    ctx.lineTo(boss.x + boss.dashDx * 600, boss.y + boss.dashDy * 600);
    ctx.stroke();
    ctx.restore();
  }
  // body
  ctx.save();
  ctx.shadowColor = COLORS.bossEdge;
  ctx.shadowBlur = 18;
  ctx.fillStyle = flashing ? '#ffffff' : COLORS.bossBody;
  ctx.strokeStyle = COLORS.bossEdge;
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    const r = BOSS_RADIUS * (i % 2 === 0 ? 1 : 0.85);
    const px = boss.x + Math.cos(a) * r, py = boss.y + Math.sin(a) * r;
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  // HP bar
  const barW = 80, barH = 6;
  const bx = boss.x - barW / 2, by = boss.y - boss.r - 14;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(bx - 1, by - 1, barW + 2, barH + 2);
  ctx.fillStyle = COLORS.warn;
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
    grad.addColorStop(0, 'rgba(185,138,255,0)');
    grad.addColorStop(1, `rgba(185,138,255,${a})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
  if (state.levelFlashMs > 0) {
    const a = Math.min(0.4, state.levelFlashMs / 120 * 0.4);
    ctx.save();
    ctx.fillStyle = `rgba(124,246,255,${a})`;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
}

export function renderAll(ctx) {
  ctx.save();
  ctx.clearRect(0, 0, W, H);
  applyShake(ctx);
  drawSigilFrame(ctx);
  drawGems(ctx);
  drawParticles(ctx);
  drawEnemies(ctx);
  drawBoss(ctx);
  drawProjectiles(ctx);
  drawPlayer(ctx);
  drawJoystick(ctx);
  ctx.restore();
  drawVignettes(ctx);
}
