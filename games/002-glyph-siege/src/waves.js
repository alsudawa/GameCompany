import { state } from './state.js';
import { WAVE_WAYPOINTS, BOSS_INTERVAL, ENEMY_DEFS } from './constants.js';
import { spawnEnemyAtEdge, spawnBoss } from './entities.js';
import { Sfx } from './sfx.js';
import { boss } from './state.js';

// Interpolate between waypoints to get current spawn parameters.
function sampleWave(t) {
  const w = WAVE_WAYPOINTS;
  if (t <= w[0].t) return { ...w[0] };
  for (let i = 0; i < w.length - 1; i++) {
    const a = w[i], b = w[i + 1];
    if (t < b.t) {
      const f = (t - a.t) / (b.t - a.t);
      return {
        interval: a.interval + (b.interval - a.interval) * f,
        budget: Math.round(a.budget + (b.budget - a.budget) * f),
        types: b.types,
      };
    }
  }
  return { ...w[w.length - 1] };
}

export function tickWaves(dt) {
  if (boss.active) return; // hold spawns during boss
  const wave = sampleWave(state.t);
  state.spawnAcc += dt;
  if (state.spawnAcc >= wave.interval) {
    state.spawnAcc = 0;
    let budget = wave.budget;
    const types = wave.types;
    let guard = 20;
    while (budget > 0 && guard-- > 0) {
      const type = types[Math.floor(Math.random() * types.length)];
      const cost = ENEMY_DEFS[type].cost;
      if (cost > budget) break;
      spawnEnemyAtEdge(type);
      budget -= cost;
    }
    Sfx.spawnTick();
  }
}

export function tickBoss() {
  if (state.t >= state.bossNext && !boss.active) {
    state.bossIndex += 1;
    state.bossNext += BOSS_INTERVAL;
    spawnBoss(state.bossIndex);
  }
}
