# Skill — Canvas Particle FX

**When to use:** score bursts, collision sparks, power-up trails.

## Pool pattern (zero alloc in hot path)

```js
const PARTICLE_CAP = 256;
const particles = Array.from({ length: PARTICLE_CAP }, () => ({
  active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 0, color: '#fff', size: 4
}));

function spawnBurst(x, y, color = '#ffc857', n = 16, speed = 220) {
  let spawned = 0;
  for (const p of particles) {
    if (p.active) continue;
    const a = Math.random() * Math.PI * 2;
    const s = speed * (0.5 + Math.random() * 0.8);
    p.active = true;
    p.x = x; p.y = y;
    p.vx = Math.cos(a) * s;
    p.vy = Math.sin(a) * s;
    p.life = p.max = 0.5 + Math.random() * 0.3;
    p.color = color;
    p.size  = 3 + Math.random() * 3;
    if (++spawned >= n) break;
  }
}

function updateParticles(dt) {
  for (const p of particles) {
    if (!p.active) continue;
    p.x  += p.vx * dt;
    p.y  += p.vy * dt;
    p.vy += 600 * dt;          // gravity
    p.vx *= 0.98;              // drag
    p.life -= dt;
    if (p.life <= 0) p.active = false;
  }
}

function renderParticles(ctx) {
  for (const p of particles) {
    if (!p.active) continue;
    ctx.globalAlpha = p.life / p.max;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}
```

## Tuning tips

- **Count**: 12–24 particles per burst. More = noise.
- **Speed**: 150–300 px/s initial; let drag/gravity do the rest.
- **Lifespan**: 0.4–0.8s. Longer = clutter.
- **Color**: pull from the `--accent` or `--danger` palette. Using arbitrary colors hurts the visual identity.

## Common mistakes

- `particles.push({...})` per frame → GC pauses. Always use a pool.
- Rendering inactive particles → just check `p.active` first.
- Alpha-fading to 0 exactly = sometimes lingers; use `life / max` so it eases naturally.
