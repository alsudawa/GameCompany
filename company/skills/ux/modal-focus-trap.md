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
