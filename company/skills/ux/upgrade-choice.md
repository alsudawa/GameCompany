# Upgrade Choice Overlay

**Where used:** `games/002-glyph-siege/src/upgrades.js` + `src/ui.js`

A roguelite-style level-up moment: the game pauses, three weighted upgrade cards animate in, and the player clicks/taps/Space-Enters one. Used to give a horde survivor combinatorial build depth with zero input complexity during play.

## Why 3 cards (not 2 or 4)

- 2 cards = trivial binary, no real choice-feel.
- 4 cards = cognitive overload on a portrait canvas (can't scan 4 icons + deltas in 2 seconds).
- 3 is the sweet spot across Vampire Survivors, Brotato, Magic Survival, and Slay the Spire.

## Pattern

### 1. Data

Upgrades are a flat dict keyed by ID, each with `name`, `max` tier, `icon` (inline SVG key), and a `desc(rank)` function that returns the current-tier human-readable delta.

```js
export const UPGRADES = {
  DMG:   { name: 'Keen Edge',   max: 5, icon: 'blade', desc: (n) => `Damage ${n}→${n+1}` },
  RATE:  { name: 'Quick Sigil', max: 5, icon: 'bolt',  desc: (n) => `Fire rate +15%` },
  // ...
};
```

The player has a per-ID rank object: `player.ranks = { DMG: 0, RATE: 0, ... }`.

### 2. Weighted roll

Lower-rank upgrades weigh more than higher-rank; maxed upgrades weigh 0 (never roll). Minimum 0.2 weight floor so rare high-tier picks still appear.

```js
function rollChoices() {
  const entries = Object.keys(UPGRADES).map(id => {
    const rank = player.ranks[id];
    const max = UPGRADES[id].max;
    const w = rank >= max ? 0 : Math.max(0.2, 1 - rank / max);
    return { id, w };
  }).filter(x => x.w > 0);
  const out = [];
  while (out.length < 3 && entries.length > 0) {
    const total = entries.reduce((s, x) => s + x.w, 0);
    let r = Math.random() * total;
    let idx = 0;
    for (; idx < entries.length; idx++) { r -= entries[idx].w; if (r <= 0) break; }
    idx = Math.min(idx, entries.length - 1);
    out.push(entries[idx].id);
    entries.splice(idx, 1);
  }
  return out;
}
```

Three distinct picks (`splice` removes the chosen entry) — never show duplicates per level-up.

### 3. Pause + render

```js
function handleLevelUp(doms, resume) {
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
    resume();  // reset lastTime so dt is fresh
  });
}
```

The main loop must early-return when `state.paused`; otherwise physics runs during card display.

### 4. Card markup

Three elements per card: icon (inline SVG ~32×32), name (2 words max), delta (1 line, current → next), tier badge. Keep the card scannable in < 2 seconds.

```js
card.innerHTML = `
  <div class="icon">${ICONS[def.icon]}</div>
  <div class="name">${def.name}</div>
  <div class="delta">${def.desc(rank)}</div>
  <div class="tier">TIER ${rank + 1} / ${def.max}</div>
`;
```

Buttons (not divs) for accessibility — automatic focus ring, keyboard activation, ARIA labels.

### 5. Animation

Cards slide in staggered (0.02s / 0.08s / 0.14s) for a "shuffle" feel. On pick, scale up then shrink to 0 with a color flash.

```css
@keyframes cardIn {
  from { opacity: 0; transform: translateY(14px) scale(.96); }
  to   { opacity: 1; transform: translateY(0)   scale(1); }
}
@keyframes cardConfirm {
  0%   { transform: scale(1); }
  40%  { transform: scale(1.12); box-shadow: 0 0 32px var(--accent); }
  100% { transform: scale(0); opacity: 0; }
}
.card { animation: cardIn .28s cubic-bezier(.2,.9,.2,1) backwards; }
.card:nth-child(1) { animation-delay: .02s; }
.card:nth-child(2) { animation-delay: .08s; }
.card:nth-child(3) { animation-delay: .14s; }
.card.picked { animation: cardConfirm .3s ease forwards; }
```

Click handler adds `.picked` then waits 260ms before applying the upgrade and hiding the overlay, so the confirm animation plays.

## Accessibility

- Each card is a `<button>` with `aria-label` summarizing name + delta.
- First card autofocuses on overlay open.
- Tab rotates through cards; Enter/Space picks.
- `prefers-reduced-motion: reduce` disables the cardIn/cardConfirm animations (cards fade in/out instantly).

## Multi-level-up in one frame

When XP absorption crosses two level thresholds in the same step (e.g., T3 gem during endgame), the check runs again on the next step and fires the overlay a second time. This stacks cleanly — the player makes two picks back to back. Acceptable UX; if it feels abrupt, batch by queueing level-up count and showing a "+2" badge.

## Gotchas

- **Don't unpause before the overlay is hidden.** If the animation still plays and you resume, the player's first frame of movement gets eaten by a transparent overlay.
- **Don't mutate `player.ranks` inside `rollChoices`** — roll, then apply only on click.
- **Reset `player.ranks` in `startRun`.** Otherwise new runs inherit ranks.
- **Icon SVGs are inline strings** — keep them under 200 bytes each; they go in a constant map, not asset files.
