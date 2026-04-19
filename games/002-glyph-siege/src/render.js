import { state, player, pools, boss } from './state.js';
import { W, H, ENEMY_DEFS, BOSS_RADIUS } from './constants.js';
import { drawJoystick } from './input.js';

// Palette — softer pastels for a cuter tone, still readable.
const COLORS = {
  bg: '#05061a',
  sigil: 'rgba(156, 228, 255, 0.22)',
  sigilHot: 'rgba(255, 180, 240, 0.65)',
  player: '#8feaff',
  playerGlow: '#c7f4ff',
  projectile: '#f7fbff',
  projectileGlow: '#7cf6ff',
  gemT1: '#7cf6ff',
  gemT2: '#d4a8ff',
  gemT3: '#ffe08a',
  bossBody: '#4a2a78',
  bossEdge: '#d6aaff',
  bossFace: '#ffe3f4',
  warn: '#ff8fb1',
  eye: '#0a0b1e',
  sparkle: '#fff8cc',
};

// Pre-computed background starfield: 70 gentle twinklers at random positions.
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
  ctx.strokeStyle = state.bossVignetteMs > 0 ? COLORS.sigilHot : COLORS.sigil;
  ctx.lineWidth = 2;
  ctx.setLineDash([18, 10]);
  ctx.lineDashOffset = -state.t * 14;
  ctx.beginPath();
  ctx.rect(pad, pad, W - pad * 2, H - pad * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  // corner sparkles
  const pulse = 0.55 + 0.35 * Math.sin(state.t * 2.2);
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = pulse;
  ctx.fillStyle = COLORS.sparkle;
  ctx.shadowColor = COLORS.sparkle;
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
    // rounded square for friendliness
    const rd = Math.min(r * 0.3, 6);
    const x0 = x - r, y0 = y - r, x1 = x + r, y1 = y + r;
    ctx.moveTo(x0 + rd, y0);
    ctx.lineTo(x1 - rd, y0); ctx.arcTo(x1, y0, x1, y0 + rd, rd);
    ctx.lineTo(x1, y1 - rd); ctx.arcTo(x1, y1, x1 - rd, y1, rd);
    ctx.lineTo(x0 + rd, y1); ctx.arcTo(x0, y1, x0, y1 - rd, rd);
    ctx.lineTo(x0, y0 + rd); ctx.arcTo(x0, y0, x0 + rd, y0, rd);
    ctx.closePath();
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

function drawEnemyFace(ctx, e, def) {
  const x = e.x, y = e.y, r = e.r;
  // subtle idle bob offset for the face — makes them feel alive
  const wobble = Math.sin(state.t * 4 + e.x * 0.07) * r * 0.04;
  ctx.save();
  ctx.fillStyle = COLORS.eye;
  if (def.shape === 'circle') {
    // grunt: two dots + mouth-line (grumpy)
    ctx.beginPath();
    ctx.arc(x - r * 0.35, y - r * 0.1 + wobble, r * 0.15, 0, Math.PI * 2);
    ctx.arc(x + r * 0.35, y - r * 0.1 + wobble, r * 0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = COLORS.eye;
    ctx.lineWidth = 1.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - r * 0.28, y + r * 0.42); ctx.lineTo(x + r * 0.28, y + r * 0.42);
    ctx.stroke();
  } else if (def.shape === 'triangle') {
    // scout: one big cyclops eye with darting pupil
    const pupilX = Math.cos(state.t * 3) * r * 0.1;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x, y + r * 0.1 + wobble, r * 0.32, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COLORS.eye;
    ctx.beginPath();
    ctx.arc(x + pupilX, y + r * 0.1 + wobble, r * 0.14, 0, Math.PI * 2);
    ctx.fill();
  } else if (def.shape === 'square') {
    // heavy: angry eyes + eyebrows
    ctx.beginPath();
    ctx.arc(x - r * 0.32, y + wobble, r * 0.16, 0, Math.PI * 2);
    ctx.arc(x + r * 0.32, y + wobble, r * 0.16, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = COLORS.eye;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - r * 0.55, y - r * 0.42); ctx.lineTo(x - r * 0.12, y - r * 0.22);
    ctx.moveTo(x + r * 0.55, y - r * 0.42); ctx.lineTo(x + r * 0.12, y - r * 0.22);
    ctx.stroke();
  } else if (def.shape === 'hexagon') {
    // elite: two sparkling eyes + cheek dots
    ctx.beginPath();
    ctx.arc(x - r * 0.3, y + wobble, r * 0.17, 0, Math.PI * 2);
    ctx.arc(x + r * 0.3, y + wobble, r * 0.17, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff3ff';
    ctx.beginPath();
    ctx.arc(x - r * 0.24, y - r * 0.08 + wobble, r * 0.07, 0, Math.PI * 2);
    ctx.arc(x + r * 0.36, y - r * 0.08 + wobble, r * 0.07, 0, Math.PI * 2);
    ctx.fill();
    // cheek blush
    ctx.fillStyle = 'rgba(255, 180, 220, 0.6)';
    ctx.beginPath();
    ctx.arc(x - r * 0.55, y + r * 0.25, r * 0.12, 0, Math.PI * 2);
    ctx.arc(x + r * 0.55, y + r * 0.25, r * 0.12, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawEnemies(ctx) {
  const arr = pools.enemies;
  for (let i = 0; i < arr.length; i++) {
    const e = arr[i]; if (!e.active) continue;
    const def = ENEMY_DEFS[e.type];
    const flashing = e.flashMs > 0;
    drawShape(ctx, def.shape, e.x, e.y, e.r, flashing ? '#ffffff' : def.color, 'rgba(0,0,0,0.35)');
    if (!flashing) drawEnemyFace(ctx, e, def);
  }
}

function drawProjectiles(ctx) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.shadowColor = COLORS.projectileGlow;
  ctx.shadowBlur = 12;
  for (let i = 0; i < pools.projectiles.length; i++) {
    const p = pools.projectiles[i]; if (!p.active) continue;
    // trailing ghost dot behind in direction of motion
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = COLORS.projectileGlow;
    ctx.beginPath();
    ctx.arc(p.x - p.vx * 0.025, p.y - p.vy * 0.025, p.r * 0.8, 0, Math.PI * 2);
    ctx.fill();
    // main projectile: bright core
    ctx.globalAlpha = 1;
    ctx.fillStyle = COLORS.projectile;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawGems(ctx) {
  for (let i = 0; i < pools.gems.length; i++) {
    const g = pools.gems[i]; if (!g.active) continue;
    const bob = Math.sin(g.bob) * 1.4;
    const color = g.tier === 3 ? COLORS.gemT3 : g.tier === 2 ? COLORS.gemT2 : COLORS.gemT1;
    const r = 3 + g.tier;
    const gx = g.x, gy = g.y + bob;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // sparkle cross
    const sp = 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(g.bob * 2.4));
    ctx.globalAlpha = sp;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.1;
    ctx.lineCap = 'round';
    const ext = r + 5;
    ctx.beginPath();
    ctx.moveTo(gx, gy - ext); ctx.lineTo(gx, gy + ext);
    ctx.moveTo(gx - ext, gy); ctx.lineTo(gx + ext, gy);
    ctx.stroke();
    // orb
    ctx.globalAlpha = 1;
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(gx, gy, r, 0, Math.PI * 2);
    ctx.fill();
    // highlight
    ctx.globalAlpha = 0.9;
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(gx - r * 0.4, gy - r * 0.4, r * 0.25, 0, Math.PI * 2);
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
  const idleBob = Math.sin(state.t * 3.2) * 1.2;

  ctx.save();
  ctx.translate(player.x, player.y + idleBob);

  // soft glow halo
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.35 + 0.15 * Math.sin(state.t * 2.6);
  ctx.fillStyle = COLORS.playerGlow;
  ctx.beginPath();
  ctx.arc(0, 0, player.r + 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // rotating glyph body (6-pointed star)
  ctx.save();
  ctx.rotate(player.rot);
  ctx.strokeStyle = blink ? 'rgba(255,255,255,0.7)' : COLORS.player;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(0, 0, player.r + 2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = blink ? '#ffffff' : COLORS.player;
  ctx.beginPath();
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI / 6;
    const r = i % 2 === 0 ? player.r : player.r * 0.5;
    const px = Math.cos(a) * r, py = Math.sin(a) * r;
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // upright face on top of (rotating) body
  // eyes
  ctx.fillStyle = COLORS.eye;
  ctx.beginPath();
  ctx.arc(-4, -2, 1.9, 0, Math.PI * 2);
  ctx.arc(4,  -2, 1.9, 0, Math.PI * 2);
  ctx.fill();
  // eye shines
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(-3.3, -2.6, 0.7, 0, Math.PI * 2);
  ctx.arc(4.7,  -2.6, 0.7, 0, Math.PI * 2);
  ctx.fill();
  // smile
  ctx.strokeStyle = COLORS.eye;
  ctx.lineWidth = 1.4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(0, 1.5, 3.2, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();
  // pink cheeks
  ctx.fillStyle = 'rgba(255, 150, 200, 0.7)';
  ctx.beginPath();
  ctx.arc(-6.5, 1.5, 1.6, 0, Math.PI * 2);
  ctx.arc(6.5,  1.5, 1.6, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawBoss(ctx) {
  if (!boss.active) return;
  const flashing = boss.flashMs > 0;

  // telegraph dash line
  if (boss.dashState === 'telegraph') {
    ctx.save();
    ctx.strokeStyle = COLORS.warn;
    ctx.globalAlpha = 0.45 + Math.sin(performance.now() / 40) * 0.3;
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(boss.x, boss.y);
    ctx.lineTo(boss.x + boss.dashDx * 600, boss.y + boss.dashDy * 600);
    ctx.stroke();
    ctx.restore();
  }

  // body (8-point rounded star)
  ctx.save();
  ctx.shadowColor = COLORS.bossEdge;
  ctx.shadowBlur = 22;
  ctx.fillStyle = flashing ? '#ffffff' : COLORS.bossBody;
  ctx.strokeStyle = COLORS.bossEdge;
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let i = 0; i < 16; i++) {
    const a = i * Math.PI / 8;
    const r = BOSS_RADIUS * (i % 2 === 0 ? 1 : 0.85);
    const px = boss.x + Math.cos(a) * r, py = boss.y + Math.sin(a) * r;
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  if (!flashing) {
    // face — big eyes with looking-at-player pupils
    const dx = player.x - boss.x, dy = player.y - boss.y;
    const d = Math.hypot(dx, dy) || 1;
    const pupilShift = 3;
    const px = (dx / d) * pupilShift, py = (dy / d) * pupilShift;
    const eyeR = BOSS_RADIUS * 0.13;
    ctx.save();
    // eye whites
    ctx.fillStyle = COLORS.bossFace;
    ctx.beginPath();
    ctx.arc(boss.x - BOSS_RADIUS * 0.28, boss.y - 2, eyeR, 0, Math.PI * 2);
    ctx.arc(boss.x + BOSS_RADIUS * 0.28, boss.y - 2, eyeR, 0, Math.PI * 2);
    ctx.fill();
    // pupils
    ctx.fillStyle = COLORS.eye;
    ctx.beginPath();
    ctx.arc(boss.x - BOSS_RADIUS * 0.28 + px, boss.y - 2 + py, eyeR * 0.55, 0, Math.PI * 2);
    ctx.arc(boss.x + BOSS_RADIUS * 0.28 + px, boss.y - 2 + py, eyeR * 0.55, 0, Math.PI * 2);
    ctx.fill();
    // tiny crown (three gold triangles)
    ctx.fillStyle = COLORS.gemT3;
    const cy = boss.y - BOSS_RADIUS * 0.82;
    for (let i = -1; i <= 1; i++) {
      const cx = boss.x + i * 12;
      const h = i === 0 ? 9 : 7;
      ctx.beginPath();
      ctx.moveTo(cx - 5, cy);
      ctx.lineTo(cx, cy - h);
      ctx.lineTo(cx + 5, cy);
      ctx.closePath();
      ctx.fill();
    }
    // fangs
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(boss.x - 5, boss.y + BOSS_RADIUS * 0.22);
    ctx.lineTo(boss.x - 2, boss.y + BOSS_RADIUS * 0.42);
    ctx.lineTo(boss.x + 1, boss.y + BOSS_RADIUS * 0.22);
    ctx.closePath();
    ctx.moveTo(boss.x + 5, boss.y + BOSS_RADIUS * 0.22);
    ctx.lineTo(boss.x + 2, boss.y + BOSS_RADIUS * 0.42);
    ctx.lineTo(boss.x - 1, boss.y + BOSS_RADIUS * 0.22);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // HP bar (clamped on-screen)
  const barW = 88, barH = 6;
  const bx = boss.x - barW / 2;
  const by = Math.max(4, boss.y - boss.r - 18);
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
