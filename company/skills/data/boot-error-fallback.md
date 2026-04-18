# Skill — Boot-Error / Unhandled-Exception Fallback UI

<!-- added: 2026-04-18 (001-void-pulse, sprint 57) -->

**When to use:** every game in this folder. Single-file vanilla-JS games typically wrap all boot logic in one IIFE; a single uncaught throw inside that IIFE leaves the player staring at whatever HTML rendered before the script ran — often a Start button with no click handler attached. They have **no recovery path**: no error message, no reset, no clue what to do. From their seat, the game is permanently broken on their machine, and they can't tell whether it's a bug or their device.

This skill is the safety net that converts "permanently broken" into "tap Reset to clear corrupted state and try again." Three pieces:
1. A **fallback DOM overlay** rendered on uncaught error
2. A **`window.addEventListener('error', …)`** + **`unhandledrejection`** wire-up
3. A **Reset & Reload** button that clears `localStorage` (the most common cause of post-boot throws)

It's the cousin of `data/persistence-defensiveness.md`: persistence-defensiveness *prevents* the boot crash from a corrupted localStorage entry; boot-error fallback *recovers* from any crash that slipped past the prevention.

## Why the IIFE pattern is fragile

```js
(() => {
  'use strict';
  // hundreds of lines: state init, DOM queries, listeners, render loop start
  // ...
  btnStart.addEventListener('click', start);   // ← line 1700, never bound if line 200 throws
})();
```

A throw at line 200 (e.g. a `JSON.parse` on a half-written localStorage entry that defied your defensive read) aborts the IIFE. Lines 201–1700 never execute. `btnStart.addEventListener` never runs. The Start button is in the HTML, visually present, but completely dead. The player taps it, nothing happens, taps again, nothing happens, closes the tab.

Same story for runtime throws in event handlers, `setTimeout` callbacks, `requestAnimationFrame` loops, and Promise rejections from `navigator.share` / `Web Audio resume`. A single uncaught error has the power to silently brick the game.

## The pattern — install before the IIFE

Put the fallback **before** the main IIFE so even an early throw is caught.

```js
(function installBootErrorFallback() {
  let shown = false;
  function renderFallback(err) {
    try { console.error('[<game-slug> boot-error]', err); } catch {}
    if (shown) return;        // idempotent — only one overlay at a time
    shown = true;
    const detail = (err && (err.stack || err.message)) || String(err || 'Unknown error');
    const wrap = document.createElement('div');
    wrap.id = 'boot-error';
    wrap.setAttribute('role', 'alertdialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-labelledby', 'boot-error-title');
    wrap.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:2147483647',
      'display:flex', 'flex-direction:column', 'align-items:center',
      'justify-content:center', 'padding:24px', 'gap:14px',
      'background:#0a0e1f', 'color:#e8e9ff',
      'font:14px/1.5 system-ui,-apple-system,sans-serif',
      'text-align:center'
    ].join(';');
    wrap.innerHTML =
      '<div id="boot-error-title" style="font-size:22px;font-weight:700">Something went wrong</div>' +
      '<div style="font-size:14px;opacity:.7;max-width:360px">' +
      'The game hit an unexpected error. Resetting saved data usually fixes it.' +
      '</div>' +
      '<details style="font-size:11px;opacity:.55;max-width:480px;text-align:left">' +
      '<summary style="cursor:pointer;text-align:center">Show error detail</summary>' +
      '<pre id="boot-error-detail" style="font:11px/1.4 ui-monospace,Menlo,monospace;' +
      'padding:8px 12px;margin-top:6px;background:rgba(255,255,255,.04);' +
      'border-radius:6px;word-break:break-word;white-space:pre-wrap;max-height:200px;' +
      'overflow:auto"></pre></details>' +
      '<button id="boot-error-reset" type="button" style="font:inherit;font-size:16px;' +
      'font-weight:700;padding:14px 28px;min-height:44px;background:#00d4ff;color:#061028;' +
      'border:0;border-radius:999px;cursor:pointer;touch-action:manipulation">Reset &amp; Reload</button>' +
      '<button id="boot-error-dismiss" type="button" style="font:inherit;font-size:13px;' +
      'padding:12px 18px;min-height:44px;background:transparent;color:#e8e9ff;' +
      'border:1px solid rgba(232,233,255,.3);border-radius:999px;cursor:pointer;' +
      'touch-action:manipulation">Continue without reset</button>';
    (document.body || document.documentElement).appendChild(wrap);
    const detailEl = wrap.querySelector('#boot-error-detail');
    if (detailEl) detailEl.textContent = detail;
    wrap.querySelector('#boot-error-reset').addEventListener('click', () => {
      try { localStorage.clear(); } catch {}
      try { sessionStorage.clear(); } catch {}
      try { location.replace(location.pathname); } catch { location.reload(); }
    });
    wrap.querySelector('#boot-error-dismiss').addEventListener('click', () => {
      wrap.remove();
      shown = false;
    });
    try { wrap.querySelector('#boot-error-reset').focus(); } catch {}
  }
  window.__bootError = renderFallback;
  window.addEventListener('error', (e) => {
    renderFallback(e.error || e.message || 'Unknown error');
  });
  window.addEventListener('unhandledrejection', (e) => {
    renderFallback(e.reason || 'Unhandled promise rejection');
  });
})();

(() => {
  'use strict';
  // ... your normal IIFE here ...
})();
```

## The five design decisions inside that block

### 1. Inline-only styles — never depend on style.css

The fallback renders in environments where:
- `style.css` failed to load (network error, blocked extension)
- `style.css` loaded but a CSS parser bug ate the relevant class
- The game crashed *before* the stylesheet's selectors got applied

So the fallback uses `style.cssText = '…'` with every required property baked in. No class names, no CSS variables, no `:root` lookups. Visually a touch crude — but **always renders**.

### 2. `z-index: 2147483647` — sit above everything

Max-int32 z-index. The fallback overlays mid-game state, mid-modal state, anything else stacked. A small price for the guarantee.

### 3. `inset: 0` + `position: fixed` — full viewport, ignore scroll

The crash may have left the page mid-scroll, mid-zoom, mid-overlay. Fixed positioning anchors the fallback to the visible viewport regardless of layout state.

### 4. Idempotent via `shown` flag

A throw in the renderFallback handler itself, or two simultaneous errors, would otherwise stack two overlays. The `shown` flag — combined with re-setting it to `false` on Dismiss — keeps the surface clean. Any re-throw after first render still hits `console.error` so you don't lose the trace.

### 5. `Reset & Reload` strips the query string

```js
location.replace(location.pathname);   // not location.reload()
```

A tampered `?seed=evil-value` in the URL could re-poison state on reload after `localStorage.clear()`. Stripping the query is belt-and-braces: the player gets a *fully* clean slate, not just a localStorage-cleared one.

## What the two `addEventListener` lines catch

| Source | Event | Caught? |
|---|---|---|
| Synchronous throw inside the IIFE body | `error` | ✅ |
| Throw inside a `click`/`pointerdown` listener | `error` | ✅ |
| Throw inside `setTimeout` / `setInterval` callback | `error` | ✅ |
| Throw inside a `requestAnimationFrame` callback | `error` | ✅ |
| Throw inside a `MutationObserver` / `ResizeObserver` callback | `error` | ✅ |
| `Promise.reject(...)` not caught with `.catch` | `unhandledrejection` | ✅ |
| `await` on a rejecting promise inside async fn with no try/catch | `unhandledrejection` | ✅ |
| Cross-origin script error (your own same-origin game.js) | `error` | ✅ |
| Cross-origin script error (third-party CDN script) | `error` w/ "Script error." only | ⚠ partial — CORS hides detail |

For a single-file vanilla-JS game with no third-party scripts, this is full coverage.

## Why not wrap the IIFE body in `try/catch`?

You could:

```js
(() => {
  'use strict';
  try {
    // ... 1700 lines ...
  } catch (err) {
    window.__bootError(err);
  }
})();
```

But: synchronous throws from a script body **already fire `window.onerror`**. The explicit try/catch is redundant for synchronous errors, and useless for the async errors (event handlers, rAF) that constitute most of the real risk. Stick with `addEventListener('error', …)` — it's the broader net.

## What "Reset & Reload" actually does

```js
try { localStorage.clear(); } catch {}
try { sessionStorage.clear(); } catch {}
try { location.replace(location.pathname); } catch { location.reload(); }
```

Three steps, each in its own try/catch because *the boot-error fallback must never itself throw*. Failure modes:

- `localStorage.clear()` could throw on Safari Private Mode (storage disabled). Catch and continue.
- `sessionStorage.clear()` same story.
- `location.replace` is preferred over `location.reload` because it strips the query string AND drops the current entry from session history (so the player can't accidentally hit Back into the broken state). Falls back to `reload()` if `replace()` is unavailable.

## What "Continue without reset" is for

Sometimes the error is transient: a one-shot `navigator.share` rejection, a temporary AudioContext glitch, a freak DOM-mutation race. The player may want to dismiss the fallback and try to keep playing. The Dismiss button removes the overlay and resets `shown = false` so the next error (if any) gets a fresh fallback.

In practice almost no one taps it — Reset & Reload is the universal answer. But the option respects player agency: they're not held hostage to "Reset" as the only way out.

## Accessibility

- `role="alertdialog"` + `aria-modal="true"` — screen readers announce the error and trap focus inside.
- `aria-labelledby` points at the title — first thing announced.
- Reset button is auto-focused (`focus()`) — keyboard users can press Enter immediately, no tab-stop hunt.
- Both buttons have `min-height: 44px` and `touch-action: manipulation` — same mobile audit standards as the rest of the game (see `mobile/tap-target-audit.md`, `mobile/touch-gesture-audit.md`).
- `<details>` for the stack trace lets sighted users expand for debug info without forcing screen-reader users through the noise.
- High-contrast palette (`#0a0e1f` bg, `#e8e9ff` fg, `#00d4ff` accent button) — readable at standard viewing distance even with no theme system loaded.

## When NOT to use

- **Deliberate test/dev environments where you want raw stack traces.** Add a `?debug=1` flag that disables the fallback so devs can let errors throw to the console naturally.
- **Games with native crash reporting** (Electron, Cordova) — the host shell already provides an analogous dialog.
- **Games where Reset would lose unrecoverable data** (single-shot leaderboards with no server backup) — replace `localStorage.clear()` with a more surgical "clear corrupt key X" if you can identify it; or remove the Reset button entirely and surface only the dismiss path.

## Verification

The fallback is hard to test in production (you don't *want* errors), so test it manually:

```js
// Paste in devtools to simulate a throw:
window.dispatchEvent(new ErrorEvent('error', {
  error: new Error('Test boot error'),
  message: 'Test boot error',
}));

// And a promise rejection:
window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection', {
  promise: Promise.reject('test'),
  reason: new Error('Test rejection'),
  cancelable: true,
}));
```

Both should render the fallback overlay. Tap Reset & Reload → page reloads with cleared storage. Tap Dismiss → overlay disappears.

## Cost

~80 lines of code, runs once at load, zero ongoing cost (event listeners are idle until something throws). Compare to the alternative: a player on a corrupt-state device has no path back to the game without manually clearing site data via browser settings — a flow most players will never undertake. They just don't come back.

## Audit cadence

Every sprint: spot-check that the fallback is still installed at the top of the file (one `git diff` glance). If `localStorage.setItem` calls grow significantly, also confirm the Reset path still calls `localStorage.clear()` and not a more partial wipe.

Periodic full sweep at the **20-sprint cadence**, alongside the audit family. Specifically: fire the two devtools dispatchEvent commands above, verify the overlay still renders correctly, verify Reset still strips the query string, verify Dismiss still resets `shown`. Five-minute test, catches drift.
