# Skill — Keyboard Flow Audit (Tab Order & Reachability)

<!-- added: 2026-04-18 (001-void-pulse, sprint 51) -->

**When to use:** complement to `focus-visible-audit.md`. That doc asks "can the user *see* where focus is?"; this one asks "can the user *get* there, *only there*, and in the right order?" After 50 sprints of overlay/modal/widget work, tab-order drift accumulates: invisible elements remain tab-reachable, ARIA-declared widgets miss their keyboard contract, the first Tab from a fresh page lands somewhere weird.

This is a once-per-20-sprints sweep on the same cadence as `reduced-motion-audit.md`. Functional accessibility, not visual accessibility.

Pairs with:
- `ux/focus-visible-audit.md` — focus-ring visibility (the *visual* sibling of this doc)
- `ux/modal-focus-trap.md` — Tab-trap inside open dialogs
- `ux/screen-reader-announcements.md` — what AT speaks; this doc covers what AT can *reach*

## The four audit questions

For every interactive element + every page state (boot, mid-run, paused, gameover, modal-open):

1. **Reachability** — Can a keyboard-only user reach this control? `tabindex` properly set on `role="button"` paragraphs, no `display: none`/`visibility: hidden` ancestors blocking when the control should be live.
2. **Unreachability** — Is this control *unreachable* when it should be? Hidden overlays, dismissed dialogs, off-screen elements should NOT be tab-stops. (The opposite gap of #1 — and the more commonly missed one.)
3. **Order** — Does Tab visit elements in a sensible order? Primary CTA before secondary; dialog content before page chrome; first Tab from page-load lands somewhere predictable.
4. **Widget contract** — Do declared ARIA widget roles fulfill their keyboard contract? `role="radiogroup"` needs arrow-key nav + roving tabindex; `role="tablist"` needs the same; `role="dialog"` needs focus trap + restore.

## Common gap patterns

### Gap 1 — `opacity: 0` overlays leak tab stops

The single most common drift bug in casual-game polish. The dev built a fade-out for an overlay using `transition: opacity .2s`, with `.hidden { opacity: 0; pointer-events: none; }`. Pointer events are blocked, but **`opacity: 0` does NOT remove elements from the tab sequence or accessibility tree**.

Symptom: during gameplay, Tab cycles through invisible buttons of dismissed overlays — users get focus rings on nothing visible.

Fix — use `visibility` with a transition delay so the fade still plays:

```css
.overlay {
  /* visibility transitions discretely; the .2s delay on the hide side lets
     the opacity fade finish before yanking the element from a11y tree. On
     the visible side, override delay to 0 so visibility snaps in immediately
     while opacity fades up. */
  transition: opacity .2s ease, visibility 0s linear .2s;
}
.overlay.hidden  { opacity: 0; pointer-events: none; visibility: hidden; }
.overlay.visible { opacity: 1; pointer-events: auto; visibility: visible;
                   transition: opacity .2s ease, visibility 0s linear 0s; }
```

Why this shape:
- Visibility is one of the few CSS properties that **transitions discretely** — it snaps between values rather than interpolating. The `transition-delay` controls *when* the snap fires.
- On hide: visibility stays `visible` for 200ms while opacity fades, then snaps to `hidden`. Tab order is preserved during the fade (acceptable — a 200ms window of "focus could land here" is benign because the user just dismissed it).
- On show: visibility snaps to `visible` at t=0, then opacity fades up. Element is tab-reachable as soon as the fade-in begins.

Alternative: `inert` attribute (Chrome 102+, Firefox 112+, Safari 15.5+). More semantic — `inert` removes from tab order AND from a11y tree AND blocks pointer events in one shot. Requires JS toggling at every show/hide call site though, vs the CSS-only solution above.

Use `inert` when:
- You have a single `setOverlayHidden(el, hidden)` helper to centralize the toggle.
- You want the element fully removed from a11y tree mid-fade (e.g. avoiding a screen-reader picking it up while it's mostly invisible).

Use the CSS-visibility pattern when:
- Show/hide is scattered across many call sites.
- You want zero JS changes — a one-block CSS edit.

### Gap 2 — `role="radiogroup"` without arrow keys

Devs declare `<div role="radiogroup">` with three `<button role="radio">` children to get screen-reader semantics. They wire click handlers. They forget the keyboard contract.

ARIA Authoring Practices for radiogroup mandate:
- **Roving tabindex.** Only the currently-checked radio is in the tab sequence (`tabindex="0"`); others are `tabindex="-1"`. Tab moves *into* the group (to the checked radio), then *out* — it does NOT cycle through siblings.
- **Arrow keys move focus AND select.** ArrowRight/ArrowDown → next radio + select. ArrowLeft/ArrowUp → previous + select. Home → first + select. End → last + select.
- **Space/Enter** activates (already handled if children are `<button>` elements).

Pattern:

```html
<div id="picker" role="radiogroup" aria-label="Color theme">
  <button role="radio" aria-checked="true"  tabindex="0"  data-id="a">a</button>
  <button role="radio" aria-checked="false" tabindex="-1" data-id="b">b</button>
  <button role="radio" aria-checked="false" tabindex="-1" data-id="c">c</button>
</div>
```

```js
// Apply selection — also rewrites tabindex so the next Tab lands on
// the checked radio, not somewhere in the middle of the group.
function setChecked(id) {
  for (const b of picker.querySelectorAll('[role="radio"]')) {
    const sel = b.dataset.id === id;
    b.setAttribute('aria-checked', sel ? 'true' : 'false');
    b.setAttribute('tabindex',     sel ? '0'    : '-1');
  }
}

picker.addEventListener('keydown', (e) => {
  const k = e.key;
  if (k !== 'ArrowRight' && k !== 'ArrowDown' &&
      k !== 'ArrowLeft'  && k !== 'ArrowUp'   &&
      k !== 'Home' && k !== 'End') return;
  const btns = Array.from(picker.querySelectorAll('[role="radio"]'));
  const i = btns.indexOf(document.activeElement);
  let next;
  if (k === 'Home') next = 0;
  else if (k === 'End') next = btns.length - 1;
  else if (k === 'ArrowRight' || k === 'ArrowDown') next = i < 0 ? 0 : (i + 1) % btns.length;
  else next = i < 0 ? btns.length - 1 : (i - 1 + btns.length) % btns.length;
  e.preventDefault();
  const target = btns[next];
  setChecked(target.dataset.id);   // selection follows focus
  target.focus();
});
```

Why "selection follows focus" rather than "focus moves but selection waits for Space":
- Radiogroup spec actually allows both modes. **Default to selection-follows-focus** for picker-style controls (theme picker, difficulty picker) where each option is cheap to apply and the user benefits from immediate preview.
- Use focus-without-selection for **destructive or expensive options** (delete-confirmation radios, mode changes that reload data) where committing on every arrow-tap would be costly.

### Gap 3 — Initial focus on page load

The user opens the game. They press Space, expecting "start." It doesn't work because focus is on `<body>` and nothing has captured Space yet — or it's captured by a global handler that doesn't know about the start state.

Or: they press Tab. Focus lands on the first DOM-order tab-stop, which is usually a chrome FAB (mute, help) sitting above the start overlay. Surprising — they expected to land on the primary CTA.

Fix — move initial focus onto the primary CTA:

```html
<button id="start" autofocus>Tap to start</button>
```

```js
// Belt-and-braces backup — some browsers ignore `autofocus` on non-form
// buttons, lose it to a focus-stealing third party, or skip it on
// back-forward navigation. Set it explicitly after layout, but ONLY if
// nothing else has grabbed focus first.
try {
  if (overlay.classList.contains('visible') &&
      btnStart && (document.activeElement === document.body ||
                   document.activeElement === null)) {
    btnStart.focus({ preventScroll: true });
  }
} catch {}
```

The `activeElement === document.body` guard matters: if the user moved focus before the script ran (clicked a chrome button, tabbed to mute), don't yank focus back to start — that's hostile.

### Gap 4 — Modal close doesn't restore opener

Already covered in `modal-focus-trap.md`; mentioned here for completeness. Snapshot `document.activeElement` on open, restore on close, fall back to a known anchor if the opener has been detached.

### Gap 5 — `role="button"` paragraph without keyboard activation

A `<p tabindex="0" role="button">` looks right to AT but `<p>` doesn't auto-activate on Space/Enter the way `<button>` does. Either:
- Use a real `<button>` (best — no extra code needed).
- OR add an explicit `keydown` handler that calls the click action on Space/Enter.

If a global keydown handler at the document level catches Space/Enter and runs the action regardless of focus location (e.g. "Space taps when the game is over"), the role="button" paragraph works coincidentally — but only because the global handler is the actual activation path. Document this dependency.

## Audit procedure (~10 min for a typical casual game)

```bash
# 1. List all visible-while-hidden patterns (the leak source)
grep -n 'opacity:\s*0\|opacity:\s*\.0' style.css     # hidden via opacity
grep -n 'visibility:' style.css                      # check coverage

# 2. List all ARIA widget roles + check their keyboard contract
grep -nE 'role="(radiogroup|tablist|menubar|tree|listbox)"' index.html

# 3. List all autofocus / programmatic .focus() calls — verify each is gated
grep -n 'autofocus\|\.focus(' index.html game.js

# 4. List all `tabindex` declarations — check for tabindex="0" on
#    elements that should be -1 (radio children, widget items)
grep -nE 'tabindex="?[0-9-]' index.html
```

Then exercise each path manually:

| Page state | Test |
|---|---|
| Page load | First Tab lands on primary CTA, not chrome |
| Boot overlay | Tab cycles overlay buttons → wraps; doesn't escape into hidden modals |
| Mid-run | Tab from canvas/body cycles only visible chrome (mute, help) |
| Pause open | Tab is trapped in pause dialog; P resumes |
| Gameover open | Tab is trapped in gameover; first Tab lands on retry, second on share |
| Help/Stats open | Tab is trapped; Esc closes; close restores focus to opener |
| Theme picker focused | Arrow keys cycle + select; Tab leaves the group |

## Decision rubric — when an element should be tab-reachable

| Condition | Tab-reachable? |
|---|---|
| Visible interactive element on current screen | Yes |
| Visible decorative element (icon, label) | No |
| Hidden modal / dismissed overlay / off-screen panel | **No** — common gap |
| `role="radio"` child not currently checked | No (use `tabindex="-1"`; arrows reach it) |
| Custom widget item not currently active (tab, tree node) | No (roving tabindex) |
| Disabled control | No (use `disabled` attr, not `tabindex="-1"` alone) |
| Mid-fade-out transition (200–400ms) | Acceptable either way; bias toward keeping reachable so the user isn't surprised by focus disappearing mid-fade |

## Common audit mistakes

- **Auditing only "can I reach it?", forgetting "should it be unreachable?"** — the leak from dismissed overlays is the more common gap. Walk both directions.
- **Treating `pointer-events: none` as a tab-block.** It only blocks pointer events. Tab is keyboard navigation, separate code path.
- **Adding `tabindex="-1"` to a `<button>` to "remove from tab order" while the button is still visible** — works, but a screen reader still announces it. Better: use `disabled` or `hidden` so the element is consistently inert across modalities.
- **Setting `role="radiogroup"` without doing the arrow-key + roving tabindex work** — declares a contract you don't fulfill. AT users hear "radio group" and reach for arrows that do nothing.
- **`autofocus` without the activeElement guard** — yanks focus back if the user has already moved it before script runs. Hostile.
- **Trapping focus inside dialog without restoring opener on close** — keyboard user is dumped to body, has to re-tab through everything to get back to where they were.
- **Skipping the page-load Tab test** — first-Tab-from-load is the most common keyboard interaction and the easiest one to get wrong because there's no obvious "where focus *was*" baseline.

## Sprint cadence

Run a keyboard-flow audit **every 20 sprints**, alternating with the reduced-motion audit (every 20) and SR-announcement audit (every 10) so the a11y axes don't all collide on the same sprint. Drift accumulates whenever a new modal, widget, or overlay ships — by sprint 20 you have 2-4 small gaps. Concentrated pass beats spreading the burden across feature sprints; the auditor's full attention is on the axis.

A typical sweep finds 3–5 gaps in a 50-sprint codebase. The fix surface tends to be CSS+HTML (~80%) with a small JS surface (~20%) — biased much more declarative than the SR-announcement or reduced-motion audits, which are more JS-heavy.
