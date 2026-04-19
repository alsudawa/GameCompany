// Asset preloader. Loads SVG sprites as <img> elements so canvas drawImage() works.
// Call loadAssets() once at boot and await before starting the game loop.

const FILES = {
  player:      'assets/player.svg',
  enemyGrunt:  'assets/enemy-grunt.svg',
  enemyScout:  'assets/enemy-scout.svg',
  enemyHeavy:  'assets/enemy-heavy.svg',
  enemyElite:  'assets/enemy-elite.svg',
  enemyDart:   'assets/enemy-dart.svg',
  boss:        'assets/boss.svg',
  gem1:        'assets/gem-t1.svg',
  gem2:        'assets/gem-t2.svg',
  gem3:        'assets/gem-t3.svg',
  projectile:  'assets/projectile.svg',
  bomb:        'assets/bomb.svg',
};

export const sprites = {};
export const loaded = { ready: false };

function loadOne(key, src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { sprites[key] = img; resolve({ key, ok: true }); };
    img.onerror = () => { sprites[key] = null; resolve({ key, ok: false, src }); };
    img.src = src;
  });
}

export async function loadAssets() {
  const results = await Promise.all(
    Object.entries(FILES).map(([k, src]) => loadOne(k, src))
  );
  loaded.ready = true;
  const failed = results.filter(r => !r.ok);
  if (failed.length) {
    console.warn('[assets] failed:', failed.map(f => f.src).join(', '));
  }
  return results;
}

// Mapping helpers used by render.js
export function enemySprite(type) {
  return {
    grunt: sprites.enemyGrunt,
    scout: sprites.enemyScout,
    heavy: sprites.enemyHeavy,
    elite: sprites.enemyElite,
    dart:  sprites.enemyDart,
  }[type] || null;
}

export function gemSprite(tier) {
  return { 1: sprites.gem1, 2: sprites.gem2, 3: sprites.gem3 }[tier] || sprites.gem1;
}
