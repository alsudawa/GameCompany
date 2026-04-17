# Skill — Haptic Feedback

**When to use:** any mobile-focused casual game. Physical buzz is underrated polish — it lands the "something happened" feeling in a way audio alone can't on a muted phone.

## The API

```js
// Single buzz, 20ms
navigator.vibrate(20);

// Pattern: [on, off, on, off, ...]
navigator.vibrate([40, 40, 80]);     // short - short - long
navigator.vibrate([10, 50, 10, 50]); // two quick pulses

// Stop any ongoing vibration
navigator.vibrate(0);
```

Support: Android Chrome / Firefox, most mobile browsers. iOS Safari has historically ignored `vibrate()` — treat as best-effort. Desktop: no-op.

## Gated helper

Always wrap behind capability + motion-preference check so desktop users and vestibular-sensitive players aren't buzzed unexpectedly.

```js
const reducedMotion = typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function haptic(pattern) {
  if (reducedMotion) return;
  if (navigator.vibrate) navigator.vibrate(pattern);
}

// Use at event boundaries only:
haptic(20);                    // miss / damage
haptic([5, 20, 5]);             // perfect streak milestone
haptic([40, 40, 80]);           // game-over with new best
```

## When to fire

Fire on **state transitions**, not on every frame of a state:

| Event | Pattern | Rationale |
|---|---|---|
| Perfect hit (in timing games) | _no haptic_ | On every success → feels nagging |
| Miss / damage | `20` | One short pulse; confirms impact |
| Life lost (but still alive) | `[10, 50, 10]` | Double-tap = "that cost you something" |
| Game-over | `[40, 60, 40]` | Rhythmic thump = finality |
| New best | `[40, 40, 80]` | Rising pattern = achievement |

**Do not** pulse on every point scored, every enemy defeated, every frame of motion. Haptics get ignored past ~1 per second.

## Common mistakes

- Calling on every scoring tap → phone buzzes for 60s straight, drains battery, user mutes haptics OS-wide
- Ignoring `prefers-reduced-motion` → excludes vestibular-sensitive players
- Long vibrations (> 300ms) → feel like error beeps, not feedback
- Assuming iOS support → plan for silent no-op
- Firing inside `update()` every frame instead of on edge transitions → see first mistake

<!-- added: 2026-04-17 (001-void-pulse sprint 4) -->
