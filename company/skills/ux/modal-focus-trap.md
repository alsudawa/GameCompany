# Skill — Modal Focus Trap + Focus Restore (Keyboard A11y)

<!-- added: 2026-04-17 (001-void-pulse, sprint 40) -->

**When to use:** you've got a modal / overlay / dialog (help modal, settings panel, confirmation sheet, stats panel) and you want keyboard users to be able to:
1. **Not tab out** of the modal into the underlying page (focus trap).
2. **Return to where they were** when the modal closes (focus restore).

This is the "live-replay" complement to `focus-visible-audit.md` — that skill makes sure focus *looks right*, this one makes sure focus *goes where it should*.

Pairs with:
- `ux/focus-visible-audit.md` — visible focus rings on each trapped element
- `ux/accessibility.md` — keyboard parity; `aria-modal="true"` + `role="dialog"`
- `ux/help-modal.md` — the canonical "?" key modal where this first shipped

## Contract

- **Trap on Tab / Shift+Tab, not on other keys.** Let Enter, Space, arrow keys, Escape behave normally — the trap is about *focus movement*, not keyboard input.
- **Query focusables at call time, not cached at open.** `[hidden]` can toggle while the modal is open (e.g. a button hidden when empty, shown when a data load completes). Caching would leak stale refs.
- **Use a precise focusable selector.** `button:not([disabled]):not([hidden])` is the common case, plus `[href]`, `input`/`select`/`textarea`, and `[tabindex]:not([tabindex="-1"])`. Don't query `*` — you'll pick up non-interactive elements with `tabindex="-1"` that are programmatically-focusable but intentionally not in the tab order.
- **Restore focus to the *triggering* element, not a default.** Record `document.activeElement` on open; call `.focus()` on it at close time. Keyboard users opened the modal from somewhere specific — returning there preserves their flow.
- **Fall back gracefully.** If the opener is `document.body` (no prior focus), or has been detached between open/close, or is otherwise non-focusable, fall back to a sensible default (the modal's trigger button).
- **aria-modal + role=dialog are contracts, not implementations.** The ARIA attributes tell assistive tech "this is modal." They do NOT enforce focus trap — that's the JS's job.

## Pattern — reusable focus-trap helper

```js
const FOCUSABLE_SEL =
  'button:not([disabled]):not([hidden]),' +
  '[href]:not([disabled]),' +
  'input:not([disabled]):not([hidden]),' +
  'select:not([disabled]):not([hidden]),' +
  'textarea:not([disabled]):not([hidden]),' +
  '[tabindex]:not([tabindex="-1"]):not([disabled]):not([hidden])';

function getModalFocusables(modalEl) {
  const list = modalEl.querySelectorAll(FOCUSABLE_SEL);
  const out = [];
  for (const el of list) {
    // offsetParent is null when element (or ancestor) is display:none.
    // This catches the case where CSS (not just the [hidden] attribute)
    // hides a control — e.g. a stats-empty state rule.
    if (el.offsetParent === null && el.tagName !== 'BODY') continue;
    out.push(el);
  }
  return out;
}

function trapFocus(modalEl, e) {
  if (e.key !== 'Tab') return false;
  const focusables = getModalFocusables(modalEl);
  if (focusables.length === 0) { e.preventDefault(); return true; }
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement;
  // Shift+Tab at the first (or from outside): wrap to last.
  if (e.shiftKey && (active === first || !modalEl.contains(active))) {
    e.preventDefault();
    last.focus();
    return true;
  }
  // Tab at the last (or from outside): wrap to first.
  if (!e.shiftKey && (active === last || !modalEl.contains(active))) {
    e.preventDefault();
    first.focus();
    return true;
  }
  return false;
}
```

## Pattern — wire into the document keydown handler

```js
document.addEventListener('keydown', (e) => {
  // Focus trap first — runs before any other keyboard bindings so Tab
  // is captured cleanly inside modals.
  if (e.key === 'Tab') {
    if (helpEl && !helpEl.classList.contains('hidden')) {
      if (trapFocus(helpEl, e)) return;
    }
    if (statsEl && !statsEl.classList.contains('hidden')) {
      if (trapFocus(statsEl, e)) return;
    }
  }
  // ... rest of keyboard bindings (shortcuts, Esc-to-close, etc.)
});
```

## Pattern — open/close with focus restore

```js
let helpOpener = null;
function openHelp() {
  if (!helpEl.classList.contains('hidden')) return;
  helpOpener = document.activeElement;          // remember
  helpEl.classList.remove('hidden');
  helpEl.classList.add('visible');
  helpEl.setAttribute('aria-hidden', 'false');
  helpClose.focus();                             // initial focus inside modal
}
function closeHelp() {
  if (helpEl.classList.contains('hidden')) return;
  helpEl.classList.remove('visible');
  helpEl.classList.add('hidden');
  helpEl.setAttribute('aria-hidden', 'true');
  // Restore focus with fallback — body and detached elements degrade to trigger.
  const validOpener = helpOpener
    && helpOpener !== document.body
    && document.body.contains(helpOpener);
  const target = validOpener ? helpOpener : helpBtn;
  helpOpener = null;
  if (target && typeof target.focus === 'function') {
    try { target.focus(); } catch { /* focus-disabled element */ }
  }
}
```

## Why these specific fallbacks?

- **`helpOpener === document.body`** — before any focus has been acquired, `document.activeElement` is body. Body isn't usefully focusable (calling `.focus()` on it just blurs). Fall back to the modal's trigger button so the user has somewhere visible to go.
- **`!document.body.contains(helpOpener)`** — the opener element has been removed from the DOM between open and close. This happens when, e.g., the gameover overlay re-renders and destroys the button that opened the modal. Fall back to a stable trigger.
- **`try { target.focus() }`** — some elements are programmatically un-focusable (e.g. custom-element Shadow DOM without delegatesFocus). Catch silently; the worst case is focus lands on body, which is the same as no-restore.

## Why query focusables at call time, not cache at open?

The stats panel has three buttons: `#statsExport`, `#statsReset`, `#statsPanelClose`. The first two use the `[hidden]` attribute, toggled by JS based on whether lifetime stats are empty. If you cache focusables at modal open, the trap would treat `[hidden]` buttons as focusable (they pass selectors at open-time when the class was hidden but attribute-check depends on browser), OR skip them correctly at open but fail to pick them up when they later un-hide.

Calling `querySelectorAll` fresh on each Tab avoids this entirely. It's O(n) for small n — modal contents are tiny; this is <0.05ms per Tab press.

## Why the `offsetParent === null` filter?

Elements that are `display: none` via CSS rule (not the `hidden` attribute) won't match `:not([hidden])` but *also* aren't tabbable. The `offsetParent === null` check catches them:

- `.stats-empty .stats-actions { display: none }` hides the whole row of stats-action buttons when empty. None of them have `hidden` attributes individually, but none are tabbable.
- A modal with a `display: none` sub-section shouldn't have its contents in the trap.

## Anti-patterns

- **`element.tabIndex = -1`** on everything outside the modal. Works but scales badly; you touch every non-modal focusable and have to remember to restore on close.
- **`inert` attribute on the backdrop.** Valid HTML5 approach, but only recently stable in all browsers. The Tab-trap pattern above has broader support and is more debuggable.
- **Caching focusables at modal open.** Misses dynamic `[hidden]` toggles.
- **Using `*` as the selector.** Picks up elements with `tabindex="-1"` that are programmatically-focusable but not in the tab order. `button`, `[href]`, etc. is the right filter.
- **Restoring focus to a hardcoded default** (always the trigger button). Loses the user's context — if they Tabbed through HUD and opened stats from one of the side buttons, they want to return *there*, not to the original stats-trigger.
- **Forgetting to restore on backdrop-click close.** If your modal closes via clicking outside, that path needs the same restore logic. Either always call `closeHelp()` (which does the restore) or factor restore into a standalone helper.

## Edge cases / what to test

1. **Tab inside modal with 1 focusable** — cycles to itself (no visible movement, no leak).
2. **Tab inside modal with N focusables** — cycles through all N, wraps.
3. **Shift+Tab from first** — wraps to last.
4. **Tab from the last** — wraps to first.
5. **Mid-modal `[hidden]` toggle** — a button un-hides (e.g. data loads). Next Tab picks it up correctly.
6. **Escape closes** — focus returns to opener.
7. **Click-backdrop closes** — focus returns to opener.
8. **Shortcut-key re-opens** — `?` key re-opens help. Focus trap still works; close still restores (to wherever `?` was pressed from, or the default button).
9. **Opened with no prior focus** (body was activeElement) — restores to default trigger, not body.
10. **Opened from a detached element** (gameover overlay re-renders) — restores to default trigger, not the disappeared element.

## Accessibility checks

- `role="dialog"` + `aria-modal="true"` on the modal element.
- `aria-labelledby` pointing to the modal's title.
- `aria-hidden="true"` on close, `aria-hidden="false"` on open.
- Escape key closes the modal (expected by assistive tech).
- Initial focus goes to a meaningful control (the Close button, or the primary action).
- Visible focus ring on every element the trap could land on (pairs with `focus-visible-audit.md`).

## Cost

- 1 helper function (`trapFocus`, ~15 lines)
- 1 helper (`getModalFocusables`, ~8 lines) + 1 selector constant
- +1 local variable per modal (`Opener` ref)
- +5 lines in each open/close function (store on open, restore on close)
- 0 dependencies
- Runtime: `querySelectorAll` on Tab (small DOM inside modal) — <0.1ms
- Bundle impact: ~40 lines of JS, no new CSS

## What this skill doesn't cover

- **Nested modals** — if you can open a modal from within a modal, you need a stack of `Opener` refs. Usually YAGNI for casual games; most only have one modal open at a time.
- **Non-button focusables with custom ARIA** — the selector above handles HTML-native focusables. Custom `role="button"` on a `<div>` with `tabindex="0"` works too (caught by `[tabindex]:not([tabindex="-1"])`).
- **Shadow DOM / Web Components** — `querySelectorAll` doesn't pierce shadow roots. If your modal uses web components with their own focusables, you'd need `delegatesFocus: true` on their shadow roots or a recursive walk.

## Pattern — Tap-anywhere modals (buttonless dialogs)

<!-- added: 2026-04-17 (001-void-pulse sprint 44) -->

**Scenario:** your modal doesn't have a conventional close/action button — the entire overlay is the tap target. Gameover screens in casual games (`tap to retry`), splash screens, "any key to continue" prompts, end-of-round celebrations. Pointer/touch users tap anywhere; keyboard users have no obvious focus target.

The naive approach — no focusables inside, `trapFocus` preventing all tab escape, focus stuck on body — is an a11y dead-end. Screen-reader users hear "dialog" but don't know how to dismiss it. Keyboard users see no focus ring anywhere.

### The fix: promote the hint text to a focusable pseudo-button

The "tap to retry" hint is already conveying the action verbally. Make it tabbable and keyboard-activatable:

```html
<!-- Before: static paragraph -->
<p class="retry-hint">Tap to retry</p>

<!-- After: focusable pseudo-button -->
<p class="retry-hint"
   id="retryHint"
   tabindex="0"
   role="button"
   aria-label="Tap or press Space to retry">Tap to retry</p>
```

Key choices:
- **`tabindex="0"`** puts it in the tab order. Your `trapFocus` selector already includes `[tabindex]:not([tabindex="-1"])`, so the trap picks it up automatically.
- **`role="button"`** tells AT "this is actionable." Without it, screen readers would read "paragraph" — you want "button: Tap or press Space to retry."
- **Explicit aria-label** replaces the visible text for AT, so "Tap to retry" (which sounds pointer-specific) becomes "Tap or press Space to retry" — inclusive of keyboard.
- **No visible style change** — it still looks like a hint, not a chunky button, preserving the minimal gameover aesthetic.

### Keyboard activation routes through existing global handler

The global keydown handler's `inField` guard checks `tagName`, not `role`:

```js
const inField = t && (t.tagName === 'BUTTON' || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
```

A `<p role="button">` has tagName `P`, so `inField` is false, so Space/Enter falls through to the game's tap-handler. **No extra binding needed** — the promotion is pure markup. (If you used a real `<button>`, you'd get native activation but also the "in field" early-return, which for this pattern would break the global-space-to-retry flow. Stick with `<p tabindex role="button">`.)

### Focus-on-open and focus-restore for buttonless dialogs

```js
function openGameover() {
  gameoverEl.classList.add('visible');
  gameoverEl.setAttribute('aria-hidden', 'false');
  // Wait a frame for the fade-in paint, then move focus. preventScroll
  // stops the browser from jumping the page if the element is off-screen.
  requestAnimationFrame(() => {
    if (retryHint && !gameoverEl.classList.contains('hidden')) {
      try { retryHint.focus({ preventScroll: true }); } catch {}
    }
  });
}

function closeGameover() {
  gameoverEl.classList.add('hidden');
  gameoverEl.setAttribute('aria-hidden', 'true');
  // If focus is still inside the now-hidden modal, blur it so the next
  // Tab starts from body (safe default) rather than cycling through an
  // opacity:0 element.
  if (gameoverEl.contains(document.activeElement)) {
    try { document.activeElement.blur(); } catch {}
  }
}
```

**Why no opener-restore?** Gameover is a *transition* modal — the player isn't "returning" to a prior context, they're starting a new run. Focus should land on body (so the next Tab starts fresh, and global Space-to-tap works). Help/stats are *overlay* modals — you were doing something, you opened a temporary view, you return to where you were. Different semantics → different focus-restore target.

### When the modal has an optional secondary button

Gameover's Share button is hidden on 0-score runs, visible otherwise. The tab order becomes:
- **No share** (0-score): just `retryHint` → trap cycles to itself.
- **Share visible**: `retryHint` → `share` → wrap back to `retryHint`.

Primary action (retry) gets initial focus. Secondary action (share) is reachable via one Tab. Wrap-around keeps the keyboard user inside the dialog until they retry or share.

### The `opacity:0 + pointer-events:none` focus trap

Hiding a modal via `opacity:0 + pointer-events:none` (common CSS pattern) doesn't remove it from the tab order. A focused element inside a visually-hidden modal can receive further Tab presses, leaking focus to adjacent hidden focusables. Three ways to handle:

1. **Blur on close** (shown above): simplest, widely compatible. Focus goes to body; next Tab starts over.
2. **`inert` attribute** on the hidden modal: removes the entire subtree from tab order + AT tree in one attribute. Browser support is good (2023+) but pair with a fallback blur for older browsers.
3. **`display: none`** on the hidden state: nuclear option. Removes from layout, interferes with opacity transitions. Usually not worth it.

Going with #1 (blur) costs one `if/try` and doesn't fight the existing CSS.

### Anti-patterns specific to tap-anywhere modals

- **No focusable inside the dialog.** Keyboard users have no visible focus target — `role="dialog"` promises an interactive region, you've delivered an empty one. Promote the hint.
- **Making the whole overlay `tabindex="0"`.** Tab lands on the overlay backdrop itself. Visually this means the focus ring wraps the whole screen — disorienting, doesn't tell the user *what* is actionable.
- **A hidden off-screen `<button>` absorbing focus.** Some implementations place an invisible button for AT. Fine for screen readers, but sighted keyboard users see no focus ring, violating `focus-visible-audit.md`.
- **Duplicating the activation path.** Don't add a `click` handler on `retryHint` if the parent overlay already handles `pointerdown` globally — you'll fire the retry twice per tap on the hint.

## Pattern — the "container-focus dialog" (no-interactive-children variant)

Some dialogs have **no interactive content at all** — a pause screen, a loading screen, a transient state indicator. The player's way *out* is a global keyboard shortcut (e.g. `P` to resume) or an external trigger (window regains focus), not a button inside the modal. Modal a11y spec still applies: `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, focus management, Tab trapping. But the focus target is the *container itself*, not a child.

```html
<div id="pause"
     class="overlay hidden"
     role="dialog"
     aria-modal="true"
     aria-labelledby="pauseTitle"
     aria-describedby="pauseHint"
     aria-hidden="true"
     tabindex="-1">
  <h2 id="pauseTitle" class="sr-only">Game paused</h2>
  <div class="pause-ring">
    <div class="pause-countdown" aria-hidden="true">paused</div>
  </div>
  <p class="pause-hint" id="pauseHint">Return to the tab — or press <kbd>P</kbd> — to resume</p>
</div>
```

```js
let pausePrevFocus = null;
function pauseGame() {
  // ... state transitions, show overlay ...
  pausePrevFocus = document.activeElement;
  try { pauseEl.focus({ preventScroll: true }); } catch { pauseEl.focus(); }
}
function clearPauseOverlay() {
  // ... state transitions, hide overlay ...
  if (pauseEl.contains(document.activeElement)) {
    const target = pausePrevFocus;
    if (target && typeof target.focus === 'function' && document.contains(target)) {
      try { target.focus({ preventScroll: true }); } catch { target.focus(); }
    } else {
      try { document.activeElement.blur(); } catch {}
    }
  }
  pausePrevFocus = null;
}
```

```css
/* The container is the focus target; its :focus ring wrapping the whole
   screen would be disorienting, and the overlay being visible is already
   the focus cue. Suppress the outline on this container. */
#pause:focus, #pause:focus-visible { outline: none; }
```

```js
// Tab trap: extend the modal list. trapFocus hits the empty-focusables
// branch, which preventDefaults Tab — focus stays on the dialog container,
// exactly the desired semantics.
if (e.key === 'Tab') {
  // ... existing trap list ...
  if (pauseEl && !pauseEl.classList.contains('hidden')) {
    if (trapFocus(pauseEl, e)) return;
  }
}
```

### Why `tabindex="-1"` on the dialog container, not `tabindex="0"`?

- `tabindex="-1"`: **reachable via programmatic `.focus()`** but **excluded from the natural Tab order**. This is exactly what we want: open-dialog code places focus there; Tab doesn't reach it from outside (the modal backdrop takes precedence by z-index anyway), and inside the dialog Tab has nothing else to cycle to so the trap's empty-focusables branch simply preventDefaults.
- `tabindex="0"`: would insert the container into the normal tab cycle. A player Tab-ing around *before* pause would focus the `<div>`, get a confusing focus ring around their game area, and activate nothing. Never use `tabindex="0"` on a passive container.

### Why no explicit live-region announcement on open?

`role="dialog"` + `aria-modal="true"` + `aria-labelledby="pauseTitle"` makes AT speak the title ("Game paused") **automatically** when focus enters the dialog. Adding `announce('Game paused.')` via a `role="status"` live region would produce double-speech — AT hears both the focus-in dialog announcement *and* the live-region update. The live region becomes redundant *because dialog semantics are now carrying the signal*.

Rule: **once a dialog pattern is in place, remove the live-region plug it was covering for.** Live regions are the fallback when no ARIA-native mechanism speaks; they're not an additive layer.

Exceptions — keep the live-region announcement when:
- The dialog **stays open** and an **internal state change** happens (e.g. resume countdown starts). No focus move → no dialog re-speak → live region is the only channel.
- The dialog is **opened in a blur/visibility context** where focus move doesn't fire reliably (visibility-based pause on some browsers). Test first before pruning.
- The user has an AT setting that de-emphasizes dialog announcements. Out of scope for most projects — assume default AT behavior.

### Why snapshot `document.activeElement` on open and restore on close?

The player who triggered pause with `P` could have been focused anywhere: the game canvas wrapper (body), the mute button, the theme button, a swatch, etc. On resume, they expect to land back *where they were*, not on body. This is the **opener-focus-restore** pattern, same as help/stats modals. The snapshot is essential because once the dialog focuses itself, `document.activeElement` is now the dialog — without the snapshot, you've lost the prior target.

Fallback to `blur()` when:
- `pausePrevFocus` is `null` (e.g. visibility-blur path where focus wasn't tracked).
- The prior target was removed from the DOM (check `document.contains(target)`).
- The prior target is no longer focusable (e.g. a button that became disabled).

### Anti-patterns specific to container-focus dialogs

- **Skipping `aria-labelledby` because the title is visual-only** — then AT announces "dialog" with no name. Always include a title, sr-only if the visual design doesn't warrant one.
- **Using the mutating countdown text as the `aria-labelledby` target** — if the dialog is named by an element whose text changes ("paused" → "3" → "2" → "1"), AT re-reads the dialog name on every tick. Keep the title stable; `aria-hidden="true"` the mutating cosmetic element.
- **Forgetting `aria-describedby` on the how-to-exit hint** — AT speaks the title on open; the description reinforces the exit affordance ("press P to resume"). Without describedby, the hint is orphaned.
- **Focus-restore to a stale reference** — if the pre-pause target was removed from the DOM mid-pause (rare but possible; e.g. a dynamic HUD element), `target.focus()` throws silently in some browsers. Always guard with `document.contains(target)`.
- **Keeping an old `announce()` after upgrading to dialog semantics** — the live region plug was for the old non-dialog overlay; once the dialog is wired, the announce becomes a double-speech bug. Grep and remove.
- **Showing a focus ring around the container** — aesthetic disaster on full-screen overlays. Suppress with `#dialog:focus { outline: none }`. Accessibility is preserved because the overlay being visible IS the focus cue; AT users get the dialog-opening announcement regardless of visual ring.

<!-- added: 2026-04-18 (001-void-pulse sprint 48) -->
