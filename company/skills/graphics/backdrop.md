# Skill — Canvas Backdrops

**When to use:** any game that needs atmospheric background texture — starfields, dust motes, drifting particles, ambient glow. Must not compete with gameplay elements for attention.

## Pattern — Zero-allocation starfield

Pre-generate a fixed array of stars once at boot; per-frame math only on alpha / phase. No `push`/`splice`, no new arrays.

```js
const STAR_COUNT = 40;
const stars = [];
for (let i = 0; i < STAR_COUNT; i++) {
  stars.push({
    x: Math.random() * W,
    y: Math.random() * H,
    size: 1 + Math.random() * 1.4,
    phase: Math.random() * Math.PI * 2,   // per-star offset so they don't twinkle in lockstep
  });
}

// In render() — draw BEFORE any gameplay elements so vignette softens them.
ctx.fillStyle = getVar('--fg');
for (const s of stars) {
  const tw = 0.5 + 0.5 * Math.sin(state.t * 1.2 + s.phase);
  ctx.globalAlpha = 0.18 + tw * 0.22;         // peaks at ~0.4, never dominant
  ctx.fillRect(s.x - s.size / 2, s.y - s.size / 2, s.size, s.size);
}
ctx.globalAlpha = 1;
```

## Why `fillRect`, not `arc`

For sub-3px backdrop specks, `fillRect` is ~2× faster than `ctx.arc + fill` (no `beginPath` / tessellation overhead) and visually indistinguishable. Save `arc` for gameplay particles that need roundness.

## Tuning

| Parameter | Value | Why |
|---|---|---|
| Star count | 30–50 | Below 30 feels sparse; above 80 feels noisy |
| Size | 1–2.5px | Any bigger competes with gameplay |
| Alpha range | 0.15 → 0.40 | Peak ≤ 0.45 keeps stars in the "depth" layer |
| Twinkle period | ~1Hz (`t * 1.2`) | Slow enough to feel organic, not strobe |
| Phase offsets | random | Without this, all stars twinkle in sync → looks artificial |

## Layer order

```
  1. clearRect
  2. starfield          ← drawn first, darkened by vignette
  3. vignette / gradient
  4. static gameplay elements (target ring)
  5. dynamic gameplay (pulses, player, enemies)
  6. particles
  7. HUD overlays (combo text, milestones)
```

Never draw stars AFTER gameplay — they'll distract from what matters.

## Common mistakes

- Randomizing star positions each frame → jittery "snow storm" look
- Uniform phase / period → all stars twinkle in sync, reads as "animation," not "depth"
- Alpha too high → competes with gameplay; players start reading stars as threats
- Star count too high → subtle per-frame cost adds up; 40 is a safe ceiling
- Drawing AFTER gameplay → noise layered on signal

<!-- added: 2026-04-17 (001-void-pulse sprint 4) -->
