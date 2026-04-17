# Skill — Mid-Run Achievement Toast

**When to use:** a game with an achievements/badges system that currently reveals unlocks only at the gameover / results screen. If the ladder has any *rare* tier entries (combo-100, score-2500, flawless-60 — things that take skill or luck to reach), revealing those mid-run instead of at the end amplifies the "I just earned that!" dopamine hit during play, while keeping the end-of-run ceremony for the full summary.

Do *not* toast every milestone — that turns the toast into UI noise. The toast is *reserved* for the rare tier; common tier still reveals at gameover.

## Pattern — `midRun: true` flag on the achievement entry

```js
const ACHIEVEMENTS = [
  { id: 'combo-25',       label: 'Combo 25',       test: c => c.peakCombo >= 25 },                         // common — gameover only
  { id: 'combo-50',       label: 'Combo 50',       test: c => c.peakCombo >= 50 },                         // common — gameover only
  { id: 'score-2500',     label: '2500 Points',    test: c => c.score >= 2500,                                   midRun: true },
  { id: 'combo-100',      label: 'Combo 100',      test: c => c.peakCombo >= 100,                               midRun: true },
  { id: 'perfect-purity', label: 'Perfect Purity', test: c => c.perfectCount >= 20 && c.hitCount === c.perfectCount, midRun: true },
  { id: 'flawless-60',    label: 'Flawless 60',    test: c => c.duration >= 60 && c.missCount === 0,            midRun: true },
];
```

Why flag on the entry rather than a separate mid-run list:
- **Single source of truth** — add a new rare achievement once, with its test, and the flag decides whether it toasts.
- **Filter is trivial** — `for (const a of ACHIEVEMENTS) if (!a.midRun) continue;` is 2 lines and 0 extra storage.
- **Gameover eval ignores the flag** — same tests fire on both paths; the midRun check is purely about *when to toast*, not *when to evaluate*.

## Pattern — frame-loop evaluation, not per-event hooks

```js
function update(dt) {
  // ... existing simulation ...
  updateParticles(simDt);
  updateAmbient(simDt);

  if (!state.deathCam) {
    const justUnlocked = evaluateMidRunAchievements({
      score: state.score, peakCombo: state.peakCombo,
      perfectCount: state.perfectCount, hitCount: state.hitCount,
      missCount: state.missCount, duration: state.t,
    });
    for (const ach of justUnlocked) showAchievementToast(ach);
  }
}
```

Why in the frame loop, not in `judgeTap()` / `loseLife()` / every score event:
- **4 integer comparisons at 60Hz = free.** The cost is dominated by particle updates and drawing; a handful of `>=` tests doesn't register.
- **Hook proliferation is a bug magnet** — every new achievement risks forgetting a call site. `flawless-60`'s duration test can't be reached from a score-event hook at all (it fires at t=60 with no other trigger). Frame-loop eval handles every axis.
- **Gated off `deathCam`** — during the fatal slow-mo the player is about to see the end screen anyway; toasts would clash with the fade-to-gameover.

## Pattern — bank on unlock, not at gameover

```js
function evaluateMidRunAchievements(ctx) {
  const unlocked = readAchievements();
  const justNow = [];
  for (const a of ACHIEVEMENTS) {
    if (!a.midRun) continue;
    if (!unlocked[a.id] && a.test(ctx)) {
      unlocked[a.id] = 1;
      justNow.push(a);
    }
  }
  if (justNow.length) writeAchievements(unlocked);   // ← write NOW, not at gameover
  return justNow;
}
```

The localStorage write happens the instant the test passes. If the player unlocks combo-100 and then dies on the next tap, the credit is already banked. Without this: the gameover flow is the only path that writes, and a crash between "unlock" and "write" loses the achievement. Mid-run toasts promise "you earned it" — breaking that promise is worse than never showing the toast.

## Pattern — toast queue for serial presentation

```js
const toastQueue = [];
let toastShowing = false;
function showAchievementToast(ach) {
  toastQueue.push(ach);
  if (!toastShowing) _drainToastQueue();
}
function _drainToastQueue() {
  if (toastQueue.length === 0) { toastShowing = false; return; }
  toastShowing = true;
  const ach = toastQueue.shift();
  const el = achToastEl;
  el.querySelector('.ach-toast-label').textContent = ach.label;
  el.classList.remove('hidden');
  void el.offsetWidth;                    // reflow → re-trigger transition
  el.classList.add('visible');
  Sfx.achievementToast();
  haptic([12, 22, 40]);
  setTimeout(() => {
    el.classList.remove('visible');
    setTimeout(() => {
      el.classList.add('hidden');
      _drainToastQueue();
    }, 220);  // matches CSS transition
  }, 2200);
}
```

Why a queue, not a stack of concurrent toasts:
- **Readability** — each unlock deserves 2s of undivided attention. Stacking two collapses them into "some achievements happened".
- **Simultaneous unlocks are rare but possible** — a single perfect tap near the end of an onboarding can trigger score-2500 *and* combo-100 in the same frame. Serial drain handles this without UI gymnastics.
- **Single DOM element** — one `#achievementToast` reused across all unlocks. The queue swaps its content rather than spawning multiple elements → zero alloc, zero positioning math.
- **`void el.offsetWidth`** — the reflow hack forces the browser to re-commit the hidden → visible class transition. Without it, back-to-back unlocks the second toast would appear without a slide because the transition is already in its "end" state.

## Pattern — soft SFX vs. gameover cascade

```js
achievement() {                          // gameover context — ceremony
  [880, 1175, 1568].forEach((f, i) => {
    setTimeout(() => this._env('triangle', f, 0.12, 0.14), i * 90);
  });
},
achievementToast() {                     // mid-run context — garnish
  this._env('triangle', 1175, 0.14, 0.11);
},
```

The full `achievement()` cascade is reserved for the gameover stats screen where it plays alone; mid-run it would compete with the ongoing pulse/score SFX stream. The toast variant plays only the *middle* note (1175 Hz triangle) at ~80% volume — clearly related sonic identity, deliberately less ceremonious. Visual is primary, audio is confirmation.

## Pattern — top-center slide, not corner

```css
.ach-toast {
  position: absolute;
  top: 76px;                             /* below HUD, above playfield */
  left: 50%;
  transform: translate(-50%, -18px);     /* off-screen: slid up */
  opacity: 0;
  transition: opacity .22s ease-out, transform .22s ease-out;
}
.ach-toast.visible {
  opacity: 1;
  transform: translate(-50%, 0);          /* final: at rest */
}
```

- **Top-center** — corners are already claimed by mute/help/pause affordances; colliding with them is a bug magnet. Top-center also reads as "announcement", matching the toast's role.
- **Slide from above** — the toast *descends* into the play area like a banner, then retracts. A bottom-up slide would collide with the score display or mobile gesture zones; a left/right slide would cross the playfield.
- **Transform, not top/left animation** — transform is GPU-composited; animating `top` triggers layout every frame.
- **Reduced-motion fallback** — collapse to opacity-only; still communicates the event, no directional animation.

## Common mistakes

- **Toasting common achievements** — combo-25 fires on nearly every non-trivial run. Toasting it trains the player to ignore toasts, so the rare ones also get ignored. Gate mid-run on a difficulty-tier flag.
- **Evaluating in `judgeTap` instead of the frame loop** — `flawless-60` (duration-based) won't fire because no tap happens *at exactly* t=60. Frame-loop eval catches time-based unlocks too.
- **Writing to localStorage only at gameover** — breaks the mid-run unlock promise. Write the moment the test passes.
- **Stacking toasts concurrently** — two overlapping toasts → player reads neither. Serial queue.
- **Spawning a new DOM element per toast** — leak magnet; also makes CSS positioning harder (offset for the stack?). One element + content swap.
- **Using `setInterval` or `requestAnimationFrame` loops to drive the toast's own timing** — `setTimeout` chained to `_drainToastQueue` is simpler, doesn't need cleanup on page-hide, and aligns with the queue's natural event loop.
- **Firing the full `Sfx.achievement()` cascade mid-run** — the cascade is a ceremony cue; mid-run it competes with pulse SFX and reads as "did the music break?". Use a softer variant.
- **Not honoring `deathCam` gate** — during the slow-mo before gameover, the player is already mentally transitioning to results. A late toast during this window just looks like a render glitch.
- **Reading `achievements[id] = true` as a truthy check and writing `1`** — this works, but be consistent: some earlier code used `true`; use `1` for localStorage JSON to keep payload compact and strictly-equal-comparable.

<!-- added: 2026-04-17 (001-void-pulse sprint 25) -->
