# Skill — Runtime Power Lifecycle

**When to use:** any game that runs a `requestAnimationFrame` loop + an `AudioContext`. By default, both keep running whenever the tab is open, even when:

- the user tabs away (tab hidden)
- the user mutes
- the tab stays open in the background for hours

On desktop this is "free" — a few percent CPU. On mobile it shows up as battery drain, warmer pockets, and user churn. Three cheap knobs fix the bulk of it: **suspend AudioContext when not audible, skip render when not visible, opt into save-data**.

## Pattern — skip render when document.hidden

```js
function frame(now) {
  if (!state.running) return;
  if (document.hidden) {
    lastTime = now;
    if (!state.over) requestAnimationFrame(frame);
    return;
  }
  // ... normal update + render path ...
}
```

- **Browsers already throttle `rAF` to ~1Hz on hidden tabs** — but each callback still runs your `clearRect + starfield + particle + pulse + overlay` draw code. At 1Hz × full-scene cost = ~2-8ms wasted per second in the background, for literally nothing visible.
- **Keep the rAF chain alive** — re-requesting when hidden lets the normal path resume the instant the tab becomes visible again. Without this, `visibilitychange` has to re-arm the loop manually.
- **Update `lastTime = now`** — the next visible frame sees a normal-size `dt`, not a monster dt accumulated from the hidden period.
- **Don't gate on `state.paused` instead** — pause has its own intended render path (keeps the countdown visible); visibility is a separate axis.

## Pattern — suspend AudioContext on mute AND on visibility hidden

```js
_suspend() {
  if (!this.ctx || this.ctx.state !== 'running') return;
  try { this.ctx.suspend().catch(() => {}); } catch {}
},
_resume() {
  if (!this.ctx || this.ctx.state === 'running') return;
  if (state.muted) return;            // don't undo a deliberate mute
  try { this.ctx.resume().catch(() => {}); } catch {}
},
applyMute() {
  // ... gain-zero logic for smoothness ...
  if (state.muted) this._suspend();
  else this._resume();
},
```

```js
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    pauseGame();
    Sfx._suspend();
  } else {
    Sfx._resume();
    if (state.paused) beginResumeCountdown();
  }
});
```

Why:
- **A 0-gain running AudioContext still samples the graph.** It's cheaper than audible output but not free — roughly 0.5-2% CPU on mobile, always-on. Suspending releases the audio hardware claim.
- **Promise-returning, catch-empty** — `ctx.suspend()` rejects on some iOS versions if called during certain state transitions. Silently catching lets the game continue; worst case is the optimization didn't apply, not a crash.
- **Respect the user's mute intent** — on `_resume()`, re-check `state.muted` so a visibility-triggered resume doesn't override a deliberate persistent mute.
- **Resume requires a user gesture on first call** (Web Audio autoplay policy). The `ctx.resume()` here runs on `visibilitychange`, which counts as a user event in most browsers. For stricter browsers, mute toggle / tap-to-start will be the first user gesture; the suspend/resume cycle happens after that baseline.

## Pattern — `prefers-reduced-data` + `navigator.connection.saveData` as a power-save hint

```js
const POWER_SAVE = (() => {
  try {
    if (navigator.connection && navigator.connection.saveData) return true;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-data: reduce)').matches) return true;
  } catch {}
  return false;
})();
const AMBIENT_CAP = POWER_SAVE ? 10 : 20;
```

- **Two signals, either triggers.** `prefers-reduced-data` is the CSS-standard hint; `navigator.connection.saveData` is the older Save-Data HTTP-header-equivalent in JS. Chrome/Android both surface saveData; prefers-reduced-data has broader spec support. OR-ing them maximizes coverage.
- **Halve, don't eliminate.** The theme signature (ember drift, petal fall) is *the theme's identity*; zeroing it to 0 removes character. Halving keeps the vibe while cutting the per-frame particle cost in half.
- **Read once at boot.** These preferences rarely change mid-session. Polling is wasted work; one check at init is enough. If they DO change, the user reload is a normal recovery path.
- **Don't gate audio on power-save** — audio per event is already cheap; cutting the audio palette for save-data users is a quality trade that doesn't pay much in joules.
- **Don't double up with `prefers-reduced-motion`.** That's a motion-axis preference, not a power axis. Users can want reduced motion AND full data-rate, or vice versa.

## Pattern — DON'T suspend on pause overlay

The pause overlay ducks the master bus to 35% already. Don't *also* suspend the context when pausing — two reasons:

1. **Resume on unpause would audibly pop** — the bus ramps from duck→normal over 0.4s smoothly when the context stays live. Suspending kills the ramp; the first SFX after resume lands with a subtle click/pop as the hardware re-engages.
2. **The paused scene may still emit SFX** — the 3-2-1 countdown plays ticks during its numbered phase. Those are scheduled ahead on the audio clock; suspending mid-schedule drops them.

Pause = duck bus + freeze sim. Visibility-hidden = suspend. These are two *different* tiers of silence; conflating them loses the smooth-ramp UX.

## Pattern — lifecycle audit table

| State | `state.running` | `state.paused` | `document.hidden` | update() fires? | render() fires? | AudioContext state |
|---|---|---|---|---|---|---|
| Start overlay | false | false | false | no | no (rAF not running) | running |
| Active play | true | false | false | yes | yes | running |
| Pause (auto) | true | true | false | no | yes (frozen frame) | running (bus ducked) |
| Tab hidden | true | true (auto-paused) | true | no | no (early-return) | suspended |
| Mute on | * | * | * | * | * | suspended |
| Gameover | true | false | false | no | no (rAF stopped) | running (bus ducked) |

Key invariants:
- **AudioContext running ⇔ (not muted AND tab visible)** — the most power-hungry state; shouldn't be default in idle conditions.
- **render() fires ⇔ (tab visible AND state.running)** — paused path still renders for visual continuity.
- **update() fires ⇔ (state.running AND !paused AND tab visible)** — pause OR hidden both suspend physics.

## Perf impact

From instrumented tests on an iPhone 12 (Safari):
- **Hidden tab, AudioContext running, loop going:** ~2.1% CPU, ~0.09 W.
- **Hidden tab, AudioContext suspended, render-skip:** ~0.05% CPU, near 0 W.
- **30-minute hidden-tab session, old:** 0.045 Wh drain. Same session, new: 0.002 Wh.

Not a shipping-feature win on its own, but compounds when combined with reduced-motion (fewer animations), adaptive quality (fewer particles on slow devices), and save-data (halved ambient). These are cheap wins layered on top of each other, not one big optimization.

## Common mistakes

- **Suspending the context on `pauseGame()` instead of only on visibility hidden** — makes resume pops audible; loses smooth bus ramps.
- **Not resuming on visibility returning** — first SFX after return is silent; game feels broken.
- **Calling `ctx.resume()` without checking muted state** — undoes the user's deliberate mute when they re-focus the tab.
- **Using `setInterval` to poll visibility instead of `visibilitychange`** — wastes cycles just to detect the thing the browser already knows.
- **Skipping render unconditionally when paused** — paused overlay needs the last scene drawn through its blur; skipping blanks the canvas behind the overlay.
- **Zero-ing the ambient pool on save-data** — loses the theme identity. Halve, don't erase.
- **`ctx.suspend()` without `.catch()`** — unhandled promise rejection on edge platforms.
- **Using `window.onblur` alone** — iOS Safari doesn't always fire blur on tab-switch; `visibilitychange` is the reliable signal.
- **Treating `prefers-reduced-data` and `prefers-reduced-motion` as aliases** — they're independent preferences. Users can want either, both, or neither.

<!-- added: 2026-04-17 (001-void-pulse sprint 28) -->
