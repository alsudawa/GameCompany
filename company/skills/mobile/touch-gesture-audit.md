# Skill — Mobile Touch Gesture Conflict Audit

<!-- added: 2026-04-18 (001-void-pulse, sprint 56) -->

**When to use:** every game that accepts touch input — i.e. every casual game in this folder. Tap-target sizing (see `mobile/tap-target-audit.md`) handles the *box model* of what's tappable; **gesture audit handles the *input stack*** of what *kinds* of touches the OS competes with the game for. The two are complementary mobile audits, both invisible on desktop, both catastrophic if missed.

The OS treats a finger on screen as a potential gesture: tap, double-tap, long-press, two-finger pinch, edge-swipe, pull-to-refresh. The game wants every touch to be a gameplay tap. Without explicit defenses, the OS sometimes wins — and the player perceives it as a game bug ("my tap didn't register" / "the page just refreshed mid-run"). The defenses are CSS properties + a few JS event-handler patterns. Cheap, easy to forget, easy to verify.

## The seven gesture conflicts

| Conflict | Trigger | Symptom |
|---|---|---|
| **Double-tap zoom** | Two taps within ~300ms on a tappable element | iOS Safari zooms the viewport; the second tap is consumed, never reaches the game. Mostly defanged in modern Safari with `viewport`-meta scale=1, but rapid tap streaks (rhythm games!) can still trigger. |
| **Pull-to-refresh** | Touch starts near top edge, drags down | iOS Safari + Android Chrome reload the page mid-run. Player loses progress with no warning. |
| **Rubber-band bounce / overscroll** | Touch drags past content edge | Visual page jiggle; can also fire scroll events that interfere with gameplay frame timing. |
| **Long-press preview / context menu** | Finger held ~500ms on text, image, or link | iOS shows a sheet ("Open / Share / Copy"). On the game's score number or canvas, this is pure regression — the player wasn't trying to share. |
| **Multi-touch double-fire** | Two fingers land within a few ms of each other on a `pointerdown` listener | Game registers two taps when the player meant one. In a tap-timing game, this can break a perfect chain. |
| **Pinch-zoom on element** | Two fingers spread on a tappable element | The browser may treat both touches as gestures rather than passing both through to the game's pointer handler. |
| **System back-swipe / edge swipe** | Touch starts within ~10px of left/right screen edge | Android: navigation; iOS: tab-switch hint. Hard to defend completely (the OS owns the edge); mitigation is to keep critical UI off the edge. |

## The defenses — five CSS properties + two JS patterns

Each defense maps to one or more conflicts. Apply the standard set globally; fine-tune per-element.

### 1. `touch-action` — the load-bearing CSS property

Tells the browser which gestures it owns vs. which the page handles.

```css
/* The play surface — tap-timing only. Pinch/pan/zoom all forbidden. */
#stage { touch-action: none; }

/* Buttons + links — allow tap, lose double-tap-zoom delay, but DON'T
   block accessibility pinch-zoom on the rest of the page. */
.btn, .icon-btn, .share-btn, .theme-swatch, .ghost-link-btn,
.stats-reset-btn, .stats-export-btn, .daily-link, .retry-hint {
  touch-action: manipulation;
}
```

**Why two values?** `none` is appropriate for the canvas — any touch on the play surface should be a pure tap, no scroll or zoom. `manipulation` is the right call for buttons because it preserves the user's ability to pinch-zoom the *page* for accessibility (low-vision users) while removing the historic double-tap-zoom delay on the button itself. **Never use `touch-action: none` on `body`** — it disables accessibility zoom across the whole app.

### 2. `overscroll-behavior` — kill pull-to-refresh + bounce

```css
html, body {
  overscroll-behavior: none;
  overflow: hidden;
}
```

Belt-and-braces: `overflow: hidden` already prevents most of these, but on iOS Safari, pull-to-refresh fires even when the body doesn't actually scroll if the touch starts in a specific zone. `overscroll-behavior: none` is the explicit "don't do that" signal.

### 3. `-webkit-touch-callout: none` — kill iOS long-press menu

```css
html, body {
  -webkit-touch-callout: none;
}
```

iOS-specific. Suppresses the "Open / Share / Copy / Save Image" sheet that appears when a finger lingers ~500ms on text, an image, or a link. On a game canvas or score readout, this menu is always a regression. Pair with `user-select: none` (next).

### 4. `user-select: none` — kill text selection

```css
html, body {
  user-select: none;
  -webkit-user-select: none;
}
```

Text selection is a long-press → drag gesture; on a game UI it's never wanted. Already standard practice in casual game CSS; included here for completeness.

### 5. `-webkit-tap-highlight-color: transparent` — kill the gray flash

```css
html, body {
  -webkit-tap-highlight-color: transparent;
}
```

iOS adds a translucent gray flash to any tappable element when tapped. Visually this competes with the game's own tap-feedback animations (button scale, particle burst). Disable.

### 6. `e.isPrimary` filter on `pointerdown` — defense vs. multi-touch double-fire

```js
canvas.addEventListener('pointerdown', (e) => {
  if (!e.isPrimary) return;     // ignore secondary fingers
  e.preventDefault();
  handleInputAction();
});
```

When a player's thumb is resting on the screen edge while they tap with another finger, two `pointerdown` events fire within ~5ms of each other. A `TAP_DEBOUNCE_MS` of 100-150ms swallows the duplicate, but the explicit `isPrimary` filter is *intent-clear* and survives debounce-tuning changes. Apply to every gameplay-relevant pointer listener.

### 7. `e.preventDefault()` on every pointer listener that's NOT a real `<button>`

```js
gameoverEl.addEventListener('pointerdown', (e) => {
  if (!e.isPrimary) return;
  e.preventDefault();    // suppress iOS text-select / long-press anchoring
  handleInputAction();
});
```

The game's gameover overlay is a `<div>` with a pointerdown listener, not a `<button>`. Without `preventDefault`, iOS treats the touch as a candidate text-selection start. Direct button children of the overlay (share, retry) should call `e.stopPropagation()` in their own listeners so the parent's preventDefault doesn't interfere with their click semantics.

## The audit — five steps

### 1. Enumerate every pointer/touch/click listener

```sh
grep -nE "addEventListener\\(['\"]?(click|pointerdown|pointerup|touchstart|touchend|touchmove)" games/<slug>/game.js
```

For each listener, note: which element, which event, which handler.

### 2. Verify the global CSS defenses

Check `style.css` for the five global-defense properties on `html, body`:

- [ ] `user-select: none` (+ `-webkit-user-select: none`)
- [ ] `-webkit-tap-highlight-color: transparent`
- [ ] `-webkit-touch-callout: none`
- [ ] `overscroll-behavior: none`
- [ ] `overflow: hidden`

If any are missing, add them. None are controversial; all are defenses with no UX cost on desktop.

### 3. Verify per-element `touch-action` coverage

Enumerate every selector that contains tappable content (the same set the tap-target audit produces). Each should have either:

- `touch-action: none` (canvas / play surface — no other gesture wanted)
- `touch-action: manipulation` (buttons, links, retry-hints — allow tap, drop double-tap-zoom delay)

Missing `touch-action` on a tappable element → may exhibit double-tap-zoom on rapid taps. Default `touch-action: auto` lets the browser decide.

### 4. Verify every `pointerdown` listener has `e.isPrimary` + `e.preventDefault()`

Walk the grep output from step 1. For every listener attached to a `<div>` / `<canvas>` / overlay (anything that's *not* a real `<button>` / `<a>` / `<input>`), it should:

- Filter `if (!e.isPrimary) return` — defense vs multi-touch double-fire.
- Call `e.preventDefault()` — defense vs iOS text-select anchoring + double-tap-zoom on non-touch-action elements.

`<button>` / `<a>` listeners that use the `click` event don't need either — `click` is a high-level synthesized event that already filters multi-touch and defers to `touch-action`.

### 5. Walk the player journey on a real device (or emulator)

The grep + CSS audit catches structural gaps. The only way to catch perceptual gaps (e.g. "tapping near the top of the screen sometimes triggers the iOS notification-shade swipe") is to actually play on hardware. Specifically test:

- **Top-edge taps** (notification shade)
- **Bottom-edge taps** (iOS home gesture, Android nav bar)
- **Left/right edge swipes** (back/forward navigation)
- **Rapid tap streaks** at the game's max BPM (double-tap-zoom watch)
- **Two-finger taps** (multi-touch double-fire)
- **Long-press on score / canvas** (text-select / context menu watch)
- **Pull-down-from-top during gameplay** (pull-to-refresh watch)

## The standard CSS block (paste into every game)

```css
html, body {
  height: 100%;
  user-select: none;
  -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
  -webkit-touch-callout: none;
  overscroll-behavior: none;
  overflow: hidden;
}

#stage {
  touch-action: none;       /* play surface = pure tap */
}

.btn, .icon-btn, .share-btn, .theme-swatch, .ghost-link-btn,
.stats-reset-btn, .stats-export-btn, .daily-link, .retry-hint {
  touch-action: manipulation;
}
```

Six properties on `html, body`, one on the canvas, one shared rule on every interactive class. Total cost: ~12 lines. Total coverage: 6 of the 7 gesture conflicts (the seventh — system edge-swipe — is mitigated by keeping critical UI ≥10px from the edge, which is a layout concern, not a CSS-property fix).

## The standard JS pattern (paste into every game)

```js
// Canvas: the play surface. Every touch should be a tap.
canvas.addEventListener('pointerdown', (e) => {
  if (!e.isPrimary) return;
  e.preventDefault();
  handleInputAction();
});

// Overlay backdrops: <div> tappable for restart / dismiss. Same defenses
// because they're not real <button>s.
gameoverEl.addEventListener('pointerdown', (e) => {
  if (!e.isPrimary) return;
  e.preventDefault();
  handleInputAction();
});

// Buttons (real <button> elements): use click — no isPrimary / preventDefault
// needed. Just stopPropagation if the button sits inside an overlay that
// also listens for pointerdown.
shareBtn.addEventListener('click', (e) => { e.stopPropagation(); shareScore(); });
shareBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
```

The `pointerdown` stopPropagation on the share button is the **load-bearing pairing** with the overlay's preventDefault. Without it, a tap on share would fire the overlay's preventDefault → fine for the share click, but two listeners running on the same touch is a code-smell that compounds across sprints.

## Decision: `touch-action: none` vs `manipulation`

| Choose `none` when… | Choose `manipulation` when… |
|---|---|
| The element IS the play surface (canvas, full-bleed game div) | The element is a button, link, or overlay backdrop |
| Pinch-zoom on the element would conflict with gameplay | The user might want to pinch-zoom the page for accessibility |
| You handle pan/scroll yourself in JS | Standard tap-and-go semantics are enough |

Never apply `touch-action: none` to `body` — it kills accessibility zoom site-wide.

## When NOT to apply the defenses

- **Game uses long-press as input** (e.g. hold-to-charge mechanic) — keep `-webkit-touch-callout: none` but reconsider any `touch-action` rule that would suppress the hold gesture; usually `touch-action: none` is fine since the OS callout is the only conflict.
- **Game uses pinch-to-zoom as input** (rare in casual; common in puzzle games) — set `touch-action: pinch-zoom` on the relevant element so the browser routes the gesture to the page handler.
- **Page also hosts non-game content** (e.g. a level-select page with scrollable list above the canvas) — `overscroll-behavior: none` on body still safe, but `touch-action: none` on the scrollable list would freeze scrolling.

## Audit cadence

Every sprint that adds a new pointer listener or interactive element: spot-check it has the standard pattern (CSS class + isPrimary + preventDefault as appropriate).

Periodic full sweep: every **20 sprints**, alongside the rest of the periodic-audit family (reduced-motion, keyboard-flow, SR-coverage, casual-checklist, persistence-defensiveness, **tap-target**, **touch-gesture**). Two of those — tap-target and touch-gesture — form the "mobile pair"; both are CSS-heavy, both need a real-device verification pass at the end.

The only way to catch a regression is to have run the audit before. Run it.

## Side note: viewport meta

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
```

`initial-scale=1` is what makes most modern Safari versions *skip* the 300ms double-tap-zoom delay automatically. Without it, the delay returns even with `touch-action: manipulation`. Always include.

**DO NOT** add `user-scalable=no` or `maximum-scale=1` — both break accessibility zoom (low-vision users need to be able to zoom in). The combination of `touch-action: manipulation` + `initial-scale=1` covers the gameplay needs without the accessibility cost.

`viewport-fit=cover` lets the layout extend under the iPhone notch / home-indicator area; if your UI is positioned absolutely near the edges, pair with `env(safe-area-inset-*)` padding to keep it visible.

## Cost

A dozen lines of CSS, four of JS, no perf impact. The defenses are pure additions — they don't require restructuring the input loop. Compare to the alternative: a player on iOS Safari taps four times rapidly in a 120-BPM tap-timing game, the third tap registers as a double-tap-zoom trigger, the viewport zooms in, the player loses combo, and the next swipe to "zoom back out" pulls-to-refresh and reloads the page mid-run. The asymmetry is large; the audit is cheap.
