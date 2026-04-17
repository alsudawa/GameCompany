# Skill — Wordless Onboarding (Show, Don't Tell)

**When to use:** any single-input casual game where the rule fits in one sentence but reading the sentence still takes 2+ seconds. Replace the sentence with a 2-3 second looping CSS animation that **performs the rule**, and the player will absorb it before they've even decided to start.

The trap: tutorial modals, callouts, and "tap here" arrows compete with the start button for attention and add friction. A passive demo embedded next to the start button costs nothing — players see the mechanic while their thumb is still moving toward the button.

## Pattern — pure-CSS demo with three layers

For a tap-timing game (pulse expands into a target ring), the demo is three absolute-positioned divs:

```html
<div class="demo" aria-hidden="true">
  <div class="demo-target"></div>   <!-- static ring -->
  <div class="demo-pulse"></div>    <!-- expanding ring -->
  <div class="demo-tap">TAP!</div>  <!-- hint that flashes at the right moment -->
</div>
```

Two keyframe animations on a shared **2.6s loop**:

```css
@keyframes demoPulse {
  0%   { width: 22px;  opacity: .15; border-color: rgba(255,61,107,.5); }
  55%  { width: 60px;  opacity: 1;   border-color: rgba(255,61,107,1); }   /* arrives at target */
  70%  { width: 76px;  opacity: 1;   border-color: rgba(255,210,74,1); }   /* the "good" window — gold */
  85%  { width: 110px; opacity: .35; border-color: rgba(255,61,107,.6); }
  100% { width: 140px; opacity: 0;   border-color: rgba(255,61,107,.2); }
}
@keyframes demoTap {
  0%, 55% { opacity: 0; transform: translate(-50%, 4px); }
  62%     { opacity: 1; }              /* "TAP!" appears just after the pulse hits the ring */
  78%     { opacity: 1; }
  100%    { opacity: 0; transform: translate(-50%, -4px); }
}
```

Three rules that make this work:
1. **Demo timing must match real-game timing.** If the pulse takes ~1.6s to cross the ring in actual gameplay, the demo's 0%→55% should also take ~1.4-1.7s. Otherwise the player builds the wrong reflex.
2. **The "TAP!" prompt fires *during* the success window, not before.** A premature prompt teaches the player to anticipate by sound/UI, not by the visual itself.
3. **Color cue at the success window** (gold border at 70%) matches the in-game perfect-color cue. Free reinforcement.

## Sizing for layout co-existence

The demo lives inside the start overlay alongside title / hook / button. Keep it ~140-180px square — big enough to be the visual anchor, small enough that the start button stays above the fold on a 360x640 phone. Width matters more than height because vertical phones have height to spare.

## Reduced-motion fallback

A looping pulse animation is exactly what motion-sensitivity sufferers should not see. Freeze the demo in its "successful tap" pose:

```css
@media (prefers-reduced-motion: reduce) {
  .demo-pulse { animation: none; width: 60px; opacity: .85; }
  .demo-tap   { animation: none; opacity: .85; transform: translate(-50%, 0); }
}
```

The static frame still teaches: "this pulse, that ring, tap at this moment." The player just doesn't get the looping reinforcement.

## Why CSS, not canvas

A canvas demo would replicate the in-game render exactly but: (1) requires a parallel render loop running while the player reads the title screen — burns battery; (2) any real-game refactor risks breaking the demo silently; (3) needs JS lifecycle wiring for show/hide. CSS keyframes auto-play, auto-pause when the tab hides (via `visibilitychange`), and require zero JS.

## When NOT to use a demo

- **Genres with > 1 input verb** — tap, swipe, hold, drag in the same game can't be conveyed in one looping animation. Use a 3-frame storyboard or a video instead.
- **Complex spatial mechanics** — match-3, deckbuilders, anything with a board state. The demo would have to be the actual game.
- **Surprise-driven games** — if the "aha" is figuring out the input, telling the player up front kills it.

## Common mistakes

- **Demo plays slower than the real game** → players ramp up surprised and miss the first three pulses
- **No reduced-motion override** → looping animation triggers nausea for sensitive players
- **Demo positioned where it overlaps the start button** → players tap the demo trying to start the game
- **Forgetting `aria-hidden="true"`** → screen readers announce "TAP!" repeatedly, useless and annoying
- **Demo that doesn't match the real visual style** → players learn the wrong colors / shapes

<!-- added: 2026-04-17 (001-void-pulse sprint 9) -->

## Pattern — keyboard shortcut hints in the same overlay

If the game supports keyboard, expose the shortcuts in a single tight line below the start button using `<kbd>` semantics:

```html
<p class="kbhint">or press <kbd>Space</kbd> · <kbd>M</kbd> mute · <kbd>P</kbd> pause</p>
```

```css
.kbhint kbd {
  font-family: inherit;
  background: rgba(232, 233, 255, .08);
  border: 1px solid rgba(232, 233, 255, .14);
  border-radius: 4px;
  padding: 1px 6px;
  font-size: 11px;
}
```

Three rules:
1. **`<kbd>` element, not `<span>`.** Semantic markup helps screen readers and respects browser/OS-level keyboard styling preferences.
2. **One line, not a list.** A bulleted list of shortcuts looks like "advanced settings"; one inline line reads as "by the way, these work too."
3. **Always include `M` and `P` for casual games.** Mute is the #1 keyboard shortcut request from headphone-using office players. Pause is essential because Space already maps to "tap" and can't double as pause.

## Pattern — global keyboard shortcuts (M / P) without breaking gameplay

Wire shortcuts in the same `keydown` listener as the gameplay key, but before the gameplay branch and gated by `inField`:

```js
document.addEventListener('keydown', (e) => {
  const t = e.target;
  const inField = t && (t.tagName === 'BUTTON' || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');

  if (e.code === 'KeyM' && !inField) {
    e.preventDefault();
    toggleMute();
    return;
  }
  if (e.code === 'KeyP' && !inField) {
    if (!state.running || state.over) return;   // P only works mid-run
    e.preventDefault();
    if (!state.paused) pauseGame();
    else if (state.resumeAt) cancelResumeCountdown();   // press P during 3-2-1 → back to indefinite pause
    else beginResumeCountdown();
    return;
  }

  // gameplay key (Space) below
});
```

Subtle rules:
- **`KeyM`/`KeyP`, not `'m'`/`'p'`.** `e.code` is layout-independent — works for QWERTY, AZERTY, Dvorak. `e.key` would change on keyboard layout.
- **`inField` guard** prevents the shortcut from firing when the player has tabbed into a button (e.g. focusing the start button and pressing M would otherwise both press the button and toggle mute).
- **`P` is a no-op outside an active run** so it doesn't accidentally interfere with the start screen or gameover.
- **Three pause states**: not paused / paused indefinitely / paused with countdown. P should rotate through them sensibly: play → pause → countdown → cancel-back-to-pause → countdown → resume.
