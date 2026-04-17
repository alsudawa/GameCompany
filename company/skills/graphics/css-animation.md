# Skill — CSS Feedback Animations

**When to use:** HUD pops, screen shake, flash overlays. Cheap juice that lands.

## Core keyframes (ship in every game)

```css
@keyframes shake {
  0%, 100% { transform: translate(0, 0); }
  20%      { transform: translate(-6px, 2px); }
  40%      { transform: translate(5px, -3px); }
  60%      { transform: translate(-4px, 4px); }
  80%      { transform: translate(3px, -2px); }
}
.shake { animation: shake .25s ease; }

@keyframes pop {
  0%   { transform: scale(1); }
  30%  { transform: scale(1.2); }
  100% { transform: scale(1); }
}
.pop { animation: pop .18s ease; }

@keyframes flash {
  0%   { background: #fff; }
  100% { background: transparent; }
}
.flash { animation: flash .15s ease; }
```

## Re-triggering the same class

```js
function retrigger(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;      // force reflow
  el.classList.add(cls);
}

retrigger(stage, 'shake');  // call on damage/miss
retrigger(scoreEl, 'pop');  // call on score
```

Without the reflow trick, adding a class that's already present does nothing.

## Timing budget

- Shake: 200–300ms. Longer = nauseating.
- Pop: 150–200ms. Longer = laggy.
- Flash: 80–150ms. Longer = seizure-y.

## Accessibility

```css
@media (prefers-reduced-motion: reduce) {
  .shake, .pop, .flash { animation: none !important; }
}
```

## Common mistakes

- Animating `left/top` instead of `transform` → layout thrash
- Stacking shake+pop on the same element → chaotic
- No `prefers-reduced-motion` fallback → excludes vestibular-sensitive players

<!-- added: 2026-04-17 (001-void-pulse) -->

## Pattern — Inset box-shadow flash (non-jarring)

A full-screen background flash can feel aggressive. `inset box-shadow` gives a vignette-style flash that reads as impact but doesn't hide game content.

```css
@keyframes flash {
  0%   { box-shadow: inset 0 0 0 9999px rgba(255,255,255,.55); }
  100% { box-shadow: inset 0 0 0 9999px rgba(255,255,255,0); }
}
.flash { animation: flash .4s ease; }
```

Apply to the outer game container (`#app`), not the canvas. 400ms ease feels impactful without seizure-y. Use for: gameover, "mega combo" milestones, life-lost.
