# Skill — Pause on Tab-Hide + Countdown Resume

**When to use:** any timing-sensitive casual game. The #1 "game feels hostile" bug pattern on mobile: phone notification pulls the player away, `requestAnimationFrame` throttles (or the OS suspends the tab), and when they return the accumulated `dt` or missed spawns burn through their lives in 0.1s.

`MAX_DT` capping alleviates physics explosions but doesn't solve the emotional problem: the run continues while you're gone. The fix is to **pause + gracefully resume**.

## Pattern

```js
// State additions
state.paused  = false;
state.resumeAt = 0;    // performance.now() ms when countdown ends

function pauseGame() {
  if (!state.running || state.over || state.paused) return;
  state.paused = true;
  state.resumeAt = 0;       // indefinite pause until tab returns
  showPauseOverlay('paused');
}

function beginResumeCountdown() {
  state.resumeAt = performance.now() + 3000;
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // Cancel an in-flight countdown if they tab away again
    if (state.paused && state.resumeAt) state.resumeAt = 0;
    pauseGame();
  } else if (state.paused) {
    beginResumeCountdown();
  }
});
window.addEventListener('blur', pauseGame);
```

## Frame-loop integration

The key insight: **while paused, keep rAF alive, keep rendering (so the overlay animates), but freeze the simulation.** This lets you drive the resume countdown from the frame callback itself with no separate timer.

```js
function frame(now) {
  if (!state.running) return;
  if (state.paused) {
    if (state.resumeAt) {
      const remainMs = state.resumeAt - now;
      if (remainMs <= 0) {
        state.paused = false;
        state.resumeAt = 0;
        hidePauseOverlay();
        lastTime = now;        // prevent dt spike on resume
        acc = 0;                // drop accumulated catch-up
      } else {
        const sec = Math.max(1, Math.ceil(remainMs / 1000));
        pauseCountdownEl.textContent = String(sec);
      }
    }
    lastTime = now;   // critical: else the first unpaused frame has a huge dt
    render(Math.min(1, acc / FIXED_DT));   // still draw the frozen scene
    requestAnimationFrame(frame);
    return;
  }
  // …normal update-render path…
}
```

## Input gating

Swallow taps while paused/countdown so the first screen-tap on return doesn't consume a pulse:

```js
function handleInputAction() {
  if (state.paused) return;
  // …rest…
}
```

Do **not** unpause on tap — that makes it a "tap to resume" UX which is friendlier but means an accidental first tap costs the player a pulse. Countdown is more forgiving.

## When pause resets

Reset on `start()` so an old pause state doesn't leak between runs:

```js
function start() {
  state.paused = false;
  state.resumeAt = 0;
  hidePauseOverlay();
  // …
}
```

And on `gameover()` so the pause overlay can't stack on top of the game-over screen:

```js
function gameover() {
  state.paused = false;
  state.resumeAt = 0;
  hidePauseOverlay();
  // …
}
```

## Why 3 seconds

- < 2s: too fast; phone-hand-to-tap reorient takes ~1s, players mash the ring and miss
- 3s: players catch their breath, the "3-2-1" reads as a generous on-ramp
- > 5s: feels like the game is stalling; players alt-tab again out of impatience

## Don't auto-unpause on visibility-return alone

Going from hidden → visible just **starts** the countdown; it doesn't clear the pause. If the player tabs back but isn't actually ready, the 3-second ramp absorbs the re-entry. If they tab away during the countdown, cancel it (re-arm on next return).

## Common mistakes

- **Unsetting `lastTime` only on unpause, not during pause frames** → when you finally unpause, `dt = (now - lastTime)` is huge and the physics while-loop burns through ~N steps
- **Using `document.hidden` without `blur` fallback** → desktop users clicking outside the window don't trigger visibilitychange on some browsers
- **Unpausing on tap** → first tap after tab-return accidentally consumes a pulse or a life
- **Countdown visible before the player is looking** → start countdown on `visible`, not on `hidden`
- **Failing to cancel countdown on re-hide** → player tabs back for 1s, tabs away — unpause fires in the background and the run silently dies

<!-- added: 2026-04-17 (001-void-pulse sprint 5) -->
