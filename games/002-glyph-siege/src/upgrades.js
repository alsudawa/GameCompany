import { state, player, pools } from './state.js';
import { UPGRADES, PLAYER_SPEED_BASE, PLAYER_PICKUP_R_BASE, WEAPON_INTERVAL_BASE } from './constants.js';
import { Sfx } from './sfx.js';

// SVG icon set — inline to avoid files. 24×24 viewBox.
const ICONS = {
  blade:  `<svg viewBox="0 0 24 24" fill="none" stroke="#7cf6ff" stroke-width="2" stroke-linecap="round"><path d="M4 20 L16 8"/><path d="M14 6 L20 4 L18 10 Z" fill="#7cf6ff" fill-opacity=".25"/></svg>`,
  bolt:   `<svg viewBox="0 0 24 24" fill="#7cf6ff"><path d="M13 2 L4 14 L11 14 L10 22 L20 9 L13 9 Z"/></svg>`,
  fan:    `<svg viewBox="0 0 24 24" fill="none" stroke="#7cf6ff" stroke-width="2" stroke-linecap="round"><path d="M12 20 L6 8"/><path d="M12 20 L12 6"/><path d="M12 20 L18 8"/></svg>`,
  wing:   `<svg viewBox="0 0 24 24" fill="none" stroke="#7cf6ff" stroke-width="2" stroke-linecap="round"><path d="M4 18 Q12 4 20 10"/><path d="M7 14 Q12 10 16 12"/></svg>`,
  orbit:  `<svg viewBox="0 0 24 24" fill="none" stroke="#7cf6ff" stroke-width="2"><circle cx="12" cy="12" r="3" fill="#7cf6ff"/><ellipse cx="12" cy="12" rx="9" ry="4"/></svg>`,
  heart:  `<svg viewBox="0 0 24 24" fill="#ff5d73"><path d="M12 21s-7-4.5-9.5-9A5 5 0 0 1 12 7 5 5 0 0 1 21.5 12c-2.5 4.5-9.5 9-9.5 9Z"/></svg>`,
};

function applyUpgrade(id) {
  const rank = player.ranks[id] || 0;
  player.ranks[id] = rank + 1;
  if (id === 'DMG')    player.damage += 1;
  if (id === 'RATE')   player.fireInterval = Math.max(0.15, player.fireInterval * 0.85);
  if (id === 'MULTI')  player.projCount = Math.min(5, player.projCount + 1);
  if (id === 'SPD')    player.speed = player.speed * 1.15;
  if (id === 'MAGNET') player.pickupR = player.pickupR * 1.5;
  if (id === 'VIT')    { player.hpMax += 2; player.hp = player.hpMax; }
}

function rollChoices() {
  const ids = Object.keys(UPGRADES);
  const weighted = ids.map(id => {
    const rank = player.ranks[id] || 0;
    const def = UPGRADES[id];
    const w = rank >= def.max ? 0 : Math.max(0.2, 1 - rank / def.max);
    return { id, w };
  }).filter(x => x.w > 0);
  if (weighted.length === 0) return ['DMG']; // fallback if everything maxed
  const out = [];
  while (out.length < 3 && weighted.length > 0) {
    const total = weighted.reduce((s, x) => s + x.w, 0);
    let r = Math.random() * total;
    let idx = 0;
    for (; idx < weighted.length; idx++) { r -= weighted[idx].w; if (r <= 0) break; }
    idx = Math.min(idx, weighted.length - 1);
    out.push(weighted[idx].id);
    weighted.splice(idx, 1);
  }
  while (out.length < 3) out.push(out[out.length - 1] || 'DMG');
  return out;
}

function renderCards(container, choices, onPick) {
  container.innerHTML = '';
  choices.forEach(id => {
    const def = UPGRADES[id];
    const rank = player.ranks[id] || 0;
    const card = document.createElement('button');
    card.className = 'card';
    card.type = 'button';
    card.setAttribute('aria-label', `${def.name}: ${def.desc(rank)}`);
    card.innerHTML = `
      <div class="icon">${ICONS[def.icon] || ''}</div>
      <div class="name">${def.name}</div>
      <div class="delta">${def.desc(rank)}</div>
      <div class="tier">TIER ${rank + 1} / ${def.max}</div>
    `;
    card.addEventListener('click', () => {
      card.classList.add('picked');
      setTimeout(() => onPick(id), 260);
    });
    container.appendChild(card);
  });
  // focus first for keyboard
  const first = container.querySelector('.card');
  if (first) first.focus();
}

export function handleLevelUp(doms, resumeFn) {
  state.levelFlashMs = 120;
  state.paused = true;
  Sfx.levelup();
  const choices = rollChoices();
  doms.upgradeOverlay.classList.remove('hidden');
  doms.upgradeOverlay.classList.add('visible');
  renderCards(doms.cardsEl, choices, (id) => {
    applyUpgrade(id);
    Sfx.pick();
    doms.upgradeOverlay.classList.replace('visible', 'hidden');
    state.paused = false;
    resumeFn && resumeFn();
  });
}

export function checkLevelUp(doms, resumeFn) {
  if (state.xp >= state.xpNeeded) {
    state.xp -= state.xpNeeded;
    state.level += 1;
    state.xpNeeded = 20 + (state.level - 1) * 8;
    handleLevelUp(doms, resumeFn);
    return true;
  }
  return false;
}
