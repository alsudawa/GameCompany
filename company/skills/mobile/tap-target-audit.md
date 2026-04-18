# Skill — Mobile Tap-Target Audit (44px Floor)

<!-- added: 2026-04-18 (001-void-pulse, sprint 55) -->

**When to use:** every sprint that adds or restyles an interactive element (`<button>`, `<a>`, `[role="button"]`, `[tabindex]`, `<input>`, `<label for>`), and as a periodic full-sweep audit every ~20 sprints. Casual games live or die on mobile — a player whose thumb keeps missing the share button or the retry hint stops sharing and stops retrying. The fix is mechanical (CSS sizing) but invisible without an audit, because **on desktop everything looks fine**: the cursor never misses a 32px target. The audit catches the gap before a mobile player does.

The floor: **44 × 44 CSS pixels**, the lowest common recommendation across iOS Human Interface Guidelines (44pt minimum) and Android Material Design (48dp / ~44px). Below that, the target is statistically harder to hit than a fingertip's contact area, and adjacent targets steal taps. *Visual* size doesn't have to grow — only the *hit area*. Big icon glyphs in tiny buttons feel cramped; small glyphs in 44px boxes feel airy and intentional.

## The four ways tap-targets shrink below the floor

| Pattern | Source | Symptom |
|---|---|---|
| **Icon button with explicit `width` / `height`** | Original size from a desktop-first mockup (e.g. `width:36px; height:36px` for a top-right mute button). Looks proportionate next to the canvas, fails on mobile. | Player taps mute, hits the canvas underneath → ring tap registers → loses combo. |
| **Pill/chip with `padding: 6px 12px; font-size: 11px`** | Reset / share / "Lifetime stats →" link styled to feel "secondary" — small font + small padding stacks under 30px tall. | Adjacent buttons (often a primary `.btn` at full size) steal the tap because they're an easier target. |
| **Inline `<a>` link styled as button** | `display: inline-block` + 13px font + 1px bottom border. Visually a button, but only ~16px tall. | Player taps "Try today's daily →", overshoots into the kbhint paragraph below. |
| **`<p tabindex="0" role="button">` styled as text** | Retry hint, gameover CTA. Text-sized line-height (~21px) becomes the hit area. | Phantom taps near retryHint land on the share-btn or leaderboard rows above. |

## The audit — five steps per sprint

### 1. Enumerate every interactive element

Grep the HTML for the standard set:

```sh
grep -nE '<button|<a |role="button"|tabindex="0"|<input|<label for' games/<slug>/index.html
```

Every match is a candidate target. Note its class(es) — that's the CSS selector you'll measure.

### 2. Measure the rendered size of each selector

Read the CSS rules for each selector. Compute height: `padding-top + content-line-height + padding-bottom` (or explicit `height`/`min-height`). Compute width similarly, but **width is usually fine if the element has any text** — focus the audit on height.

Quick mental math:

```
font-size: 11px → line-height ≈ 13px (default 1.2)
font-size: 13px → line-height ≈ 16px
font-size: 18px → line-height ≈ 22px
```

So `padding: 6px 12px; font-size: 11px` → height ≈ `6 + 13 + 6 = 25px`. **Below floor** by 19px.

### 3. Score each selector ✅ / ⚠ / ❌

| Score | Criterion |
|---|---|
| ✅ Pass | Both axes ≥ 44px without depending on text length |
| ⚠ Borderline | One axis ≥ 44px, the other depends on content (e.g. 50px tall, width varies 38–60px by label) |
| ❌ Fail | Either axis < 44px regardless of content |

Any ⚠ should be **promoted to ❌** for the audit's purposes — relying on label length is a future regression vector ("Reset" → "Reset stats" changes the safe column).

### 4. Apply the standard fix

Two recipes cover ~all cases:

**Recipe A — explicitly sized icon button.** Bump `width` and `height` (don't add padding; the centered SVG stays anchored).

```css
.icon-btn {
  width: 44px;          /* was 36 */
  height: 44px;         /* was 36 */
}
```

**Recipe B — text/pill button or link.** Add `min-height: 44px` + a vertical-padding bump + `display: inline-flex` with `align-items: center; justify-content: center` so the label centers in the new box.

```css
.share-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 12px 18px;   /* was 8 16 */
}
```

The `inline-flex + align-items: center` is the load-bearing pair. Without it, the increased min-height pushes the text to the top and the button looks misaligned.

For ⚠ borderline width cases, add an explicit `min-width: 48px` (the 4px buffer absorbs subpixel rounding and prevents a future label change from shrinking back under).

### 5. Verify positioned siblings still don't overlap

If the audit bumps an element that other selectors are positioned relative to (e.g. a top-right icon at `right:14px`, with a sibling at `right:60px` to sit beside it), recompute the offsets:

```
new_sibling_offset = base_offset + new_size + gap
                   = 14 + 44 + 10 = 68px       /* was 60 = 14+36+10 */
```

A 1-line CSS edit. Easy to miss; the audit isn't done until the layout is verified mentally or in devtools at mobile width.

## Common gap patterns (search-and-fix list)

These selectors fail the floor in nearly every game template. Audit them first.

```css
/* 🚩 RED FLAG — hardcoded sub-44 dims for icon buttons */
.icon-btn { width: 36px; height: 36px; }

/* 🚩 RED FLAG — small font + small padding pill */
.share-btn { padding: 8px 16px; font-size: 13px; }       /* ~32px tall */
.ghost-link-btn { padding: 4px 8px; font-size: 11px; }    /* ~24px tall */
.stats-reset-btn { padding: 6px 12px; font-size: 11px; }  /* ~26px tall */

/* 🚩 RED FLAG — inline link as nav target */
.daily-link { display: inline-block; font-size: 13px; }   /* ~16px tall */

/* 🚩 RED FLAG — text element acting as button */
.retry-hint { font-size: 15px; }                          /* ~21px tall */
```

### Safe replacements

```css
/* ✅ icon button bumped to 44 */
.icon-btn { width: 44px; height: 44px; }

/* ✅ pill with explicit floor + flex centering */
.share-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 12px 18px;
}

/* ✅ link with vertical-padding to lift hit area */
.daily-link {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  padding: 12px 14px;
}

/* ✅ paragraph-as-button gets box-model affordance */
.retry-hint {
  display: inline-block;
  min-height: 44px;
  padding: 12px 18px;
  line-height: 20px;     /* anchor baseline so centered text doesn't shift */
  border-radius: 8px;    /* match focus-ring radius */
}
```

## When NOT to enforce the floor

- **Decorative elements** (`.streak-flame`, `.ach-toast-badge`, `.life`, swatch-rings inside a button) — they're nested *inside* a tappable parent, not tappable themselves.
- **Disabled / hidden interactive elements** — `[hidden]`, `[disabled]`, `aria-hidden="true"` chips that exist only as DOM scaffolding for state transitions.
- **Mid-paragraph inline hyperlinks** (rare in casual games) — the line itself is the target; bumping `min-height` on a `<a>` inside flowing text would distort the paragraph.
- **Desktop-only games** (e.g. keyboard-mouse only, no touch handlers, viewport meta missing) — but be honest about the audience; "desktop only" is rarely a deliberate choice in this folder.

## Audit cadence

Every sprint that touches CSS for an interactive element: spot-check the affected selectors against the floor before committing.

Periodic full sweep: every **20 sprints**, alongside reduced-motion / keyboard-flow / SR-coverage / persistence-defensiveness audits. The full sweep is the only way to catch drift in older code that was added before this checklist existed, or before someone restyled `.share-btn` for visual reasons without rechecking the floor.

For the periodic sweep:

```sh
grep -nE '<button|<a |role="button"|tabindex="0"' games/<slug>/index.html
```

Walk each match. Score ✅ / ⚠ / ❌. Fix the ❌s in one commit.

## Side benefits

The 44px floor isn't only for fingertips. It also helps:

- **Switch / scanner users** — assistive devices that auto-scan focusable elements rely on consistent visual targets.
- **Tremor / motor-impairment users** — the larger hit area absorbs unintended micro-movement when the cursor lands.
- **Cursor-with-mouse users on a 4K display** — at 200% scale, a 36px button is a 7-mm physical target; 44px is 8.6mm. Still small but materially easier.
- **Pen / stylus users** — same thumb-equivalent precision floor applies.

The audit is one of the highest-ROI accessibility passes per minute spent.

## Cost

A few dozen lines of CSS, no JS, no perf impact (paint is the same — only the box-model is bigger). Compare to the alternative: a player on mobile mistaps the share button onto the canvas during the gameover overlay, registers a phantom tap on the post-game pause-state input, gets a perplexing "still playing?" feeling, and closes the tab. The asymmetry is the whole point of the audit.
