# Skill — Focus-Visible Audit (Keyboard Ring Coverage)

<!-- added: 2026-04-17 (001-void-pulse, sprint 35) -->

**When to use:** you've shipped a bunch of interactive elements (buttons, links, custom-role widgets) and never explicitly styled their `:focus-visible` state. Browser defaults are inconsistent, low-contrast against dark chrome, and sometimes invisible when you've styled a `:hover` that competes. Keyboard users shouldn't have to squint to find where they are in the page.

This pairs with but is distinct from `ux/accessibility.md` (broader scoping of color redundancy, reduced-motion gating) — this doc is the focused audit for **one specific concern**: can a keyboard-only user always see which element has focus?

Pairs with:
- `ux/accessibility.md` — the parent doc
- `ux/screen-reader-announcements.md` — related a11y lens but different audience (screen-reader users)

## Contract

- **Every interactive element gets a `:focus-visible` style.** Native buttons, `<a>` tags, and `role="button|radio|tab"` widgets all need one. Only decorative or strictly non-interactive elements can skip.
- **Focus style ≠ hover style.** A keyboard user seeing the same visual for hover and focus can't tell "is this a mouse artifact, or am I targeting this?" Use an *additional* cue on focus (outline / ring / shadow) that hover doesn't have.
- **Visual cue independent of color alone.** Use outline thickness, offset, or pattern (dashed vs solid) so users with color-vision deficits still see the focus ring against the element color.
- **Outline-offset ≥ 2px.** A ring sitting flush against the element border is easily mistaken for a border thickness change. 2–3px offset pulls it out as a separate layer.
- **Don't blanket-kill the default with `*:focus { outline: none }`.** If you remove the default, replace it in the same rule. Otherwise you've created an invisible-focus state.
- **Watch out for selected-state collisions.** Elements using `border-color` or `outline` for a "selected" state (radio-role swatches, toggled icons) need their focus ring to visually separate — dashed pattern or bigger offset works.

## Audit procedure (~5 min for a typical casual game)

1. Grep interactive elements: `grep -nE '<(button|a |input|select)' index.html` (+ any `role="button|radio|tab"` markers).
2. For each class in that output, grep the CSS: `grep -n "\.classname" style.css | grep -iE 'focus|outline'`. Missing → add.
3. Grep for `outline:\s*(none|0)` globally — any hit that isn't paired with an explicit replacement focus ring is a bug.
4. Keyboard-tab through the app in a browser with a dark theme. Every tab stop should be visibly ringed.
5. Toggle a selected state (radio, checkbox-like) and tab off and back — the focus ring must still be visible against the selected-state styling.

## Pattern — the canonical ring

```css
/* Block together every interactive class that wants the accent ring.
   Outline (not box-shadow) because it doesn't affect layout and plays
   well with border-radius in modern browsers. outline-offset: 2px so
   the ring sits outside any existing element border without clipping
   overflow. */
.btn:focus-visible,
.icon-btn:focus-visible,
.share-btn:focus-visible,
.daily-link:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
```

## Pattern — focus vs hover separation when they share other styles

When `:hover` and `:focus-visible` should share background/text-color changes (common for navigation-style buttons), **split the selectors** so the focus case can add the outline without affecting hover:

```css
/* Anti-pattern: shared rule prevents differentiation
.ghost-link-btn:hover,
.ghost-link-btn:focus-visible { color: var(--accent); outline: none; } */

/* Correct: hover and focus share color change, only focus gets the ring */
.ghost-link-btn:hover {
  color: var(--accent);
  background: rgba(232, 233, 255, .05);
}
.ghost-link-btn:focus-visible {
  color: var(--accent);
  background: rgba(232, 233, 255, .05);
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
```

The duplication here is deliberate — refactoring into CSS custom properties or a shared mixin usually isn't worth the complexity for 2–4 selectors.

## Pattern — focus on an element with a selected-state outline

For `role="radio"` swatches (or tabs, toggles) that already use `outline` / `border-color` for the selected state, the focus ring needs to visually layer on top:

```css
.theme-swatch[aria-checked="true"] {
  border-color: var(--accent);         /* selected: solid accent border */
}
.theme-swatch:focus-visible {
  outline: 2px dashed var(--accent);   /* focused: dashed ring outside border */
  outline-offset: 3px;                 /* extra offset so dashed ring is clearly separate */
}
```

- **Dashed pattern** distinguishes focus from the solid border of selected state even if the colors are identical.
- **Extra offset (3px+)** puts the focus ring past the selected-state border so both are visible simultaneously when the selected element is also focused.

## Pattern — focus on elements with `role` but not native semantics

Elements using `role="button"` or `role="radio"` on a `<div>` need `tabindex="0"` to be keyboard-reachable and a JS Enter/Space handler. If you missed that, the CSS focus-visible style is never reachable. Audit:

```js
document.querySelectorAll('[role="button"], [role="radio"], [role="tab"]')
  .forEach(el => {
    if (!el.matches('button, a, input, select, textarea')) {
      if (el.tabIndex < 0) console.warn('unreachable:', el);
    }
  });
```

(In void-pulse's case, all custom-role elements are actual `<button>` tags, so this bug doesn't exist.)

## Common mistakes

- **`*:focus { outline: none }`** at the top of your CSS reset. Kills all keyboard-focus indication; you have to add it back on every element. Don't reset what you don't intend to replace.
- **`outline: 0` inside a :hover rule.** Browsers apply hover + focus simultaneously when a mouse user tabs away, so this hides the focus ring on any focused-and-hovered element. Keep hover rules outline-agnostic.
- **Custom ring via `border` instead of `outline`.** Border changes the element's box size and shifts layout. `outline` is layout-neutral.
- **Ring color = element background color.** `outline: 2px solid var(--bg)` disappears entirely. Always use a *different* hue — accent, danger, or fg.
- **Ring hidden by `overflow: hidden` on a parent.** `outline` is rendered in the parent's flow but `outline-offset` can push it into clipped territory. Either avoid `overflow: hidden` on the parent, or use `box-shadow: 0 0 0 2px var(--accent)` instead.

## Cost

- CSS-only, ~4-8 new rules depending on element variety.
- Zero JS.
- Zero perf impact — outline is GPU-composited in modern browsers.
- 10–15 min implementation for a typical casual-game UI.

## Verifying it works

1. Keyboard-tab from the top of the page through every interactive control. Every tab stop has a visible ring.
2. In a high-contrast theme (`prefers-contrast: more`), rings are still visible (outline survives — box-shadow fallback might not).
3. With a mouse, hover any button, then tab to it: focus ring appears *in addition to* hover color change.
4. On a selected/active radio-like button: tab away and back — ring appears outside the selected-state border, both visible.
5. Screen-reader test (optional): focused element is announced; the visual ring just confirms the same to a sighted keyboard user.

## When NOT to add focus-visible

- **Decorative elements** (`<span>`, `<div>`, SVG paths). If they don't accept focus, `:focus-visible` is moot.
- **Elements already covered by a parent ring.** If you have a `<label>` wrapping an `<input>` and the label gets styled, the input doesn't also need its own ring.
- **Elements where focus is immediately handed off.** Overlay-opening buttons that immediately steal focus into a modal — focus ring on the opener flashes briefly and isn't worth styling.
