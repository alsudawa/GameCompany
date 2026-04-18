# Skill — Cognitive Load Audit (the first 3 seconds)

<!-- added: 2026-04-18 (001-void-pulse, sprint 59) -->

**When to use:** every 20 sprints, OR any sprint that adds an element to the start overlay / gameover panel / pause panel / any other surface the player encounters before they've completed run #1, OR when a postmortem reflection notes "I felt my eye bouncing around looking for the Start button." This is the **9th member** of the audit family in [`audit-from-the-margin.md`](../audit-from-the-margin.md) — covering the axis of *first-3-second comprehension* (return-player affordances are a separate concern).

> **The thesis.** *The dev knows what every element does.* The dev wrote `themePicker`, so a swatch labelled "void" reads as "the dark theme I chose for the default look." The dev wrote the daily-link, so it reads as "an alternate game mode I can opt into." A first-time player has none of that context — they see 9 things competing for attention and have to evaluate each one to find "the thing I do to start playing." Every redundant element is friction. The audit asks: *what's the smallest set of elements that gets a brand-new player from page-load to first input in under 3 seconds?* — and aggressively hides everything else until run 2.

This is a *prevent* audit (no paired recovery, since cognitive overload doesn't throw). It composes naturally with [`ux/onboarding.md`](onboarding.md), [`ux/first-visit-hint.md`](first-visit-hint.md), and [`ux/two-phase-demo.md`](two-phase-demo.md), which together provide the *replacement* affordances the audit creates room for.

## The 5 cognitive-load shrink patterns

These are the recurring shapes by which an overlay accumulates noise. Each one has a standard fix.

| # | Pattern | Symptom | Standard fix |
|---|---|---|---|
| 1 | **Redundant copy** | Two elements say the same thing in different words ("Tap on the beat. Dodge red. 60-second chart, chase 100%." + "First time? Tap white rings · skip red ones · chase 100% accuracy.") | Pick one source of truth for first-visit; hide the other behind `:not(.first-visit)`. |
| 2 | **Return-player affordances on first visit** | Theme picker, lifetime stats button, daily-mode link, keyboard shortcut hints all visible to a player with no frame of reference for any of them. | Wrap parent overlay in `.first-visit` class; descendant rule `.first-visit .return-only { display: none }`. |
| 3 | **Decorative chrome competing with the CTA** | Subtitle, version badge, decorative SVG, "powered by" line all sized close to the Start button. | The CTA must be visually loudest: 1.5×+ font-size, color contrast against background, motion (pulse ring on Start). |
| 4 | **Multi-step affordances before any baseline** | Radiogroup (theme picker), dropdown (difficulty), settings panel — all asking the player to *choose* before they've seen what the choice affects. | Defer to second visit OR provide a sensible system-derived default (`prefers-color-scheme` → theme; `prefers-reduced-motion` → animation). |
| 5 | **Stats/config UI exposed before there's data** | "Lifetime stats →" button on a player who has zero plays. "Best: --" prominently displayed. Achievement panel showing 0/12 unlocked. | Hide-until-data: `if (lifetimeStats.totalRuns === 0) statsBtn.hidden = true`. |

## The audit — five steps

### 1. Enumerate

For each *pre-first-input surface*, list every visible element. The surfaces are:

```
start overlay (#overlay or .start-screen)
gameover panel (#gameoverEl)
pause panel (if shown without prior gameplay)
help modal (if reachable from start screen)
in-play HUD on frame 1 (before any score)
```

Grep:
```
grep -nE 'class="[^"]*(?:overlay|panel|modal|hud)' index.html
```

For each surface, list the children (Read the section of HTML, then `grep -c "^      <"` to count or just eyeball). The output of step 1 is a count per surface — the start overlay had **9** elements on Sprint 59 of void-pulse, of which only **4** are essential for first input.

### 2. Verify each element against the rubric

For each element on a *first-visit* surface, three yes/no questions:

| Q | Question | If "no" |
|---|---|---|
| Q1 | **Does a brand-new player NEED this element to take their first action?** (i.e. could they start playing without it?) | Hide on first visit. |
| Q2 | **Does this element have a frame of reference for a brand-new player?** (i.e. would the label / icon make sense without prior context?) | Either replace with derived default OR defer to second visit. |
| Q3 | **Is this element NOT redundant with another element that's also visible?** | Pick one; hide the other. |

A "no" on any question = ❌ for first-visit display.

### 3. Score and table-ize

| Element | Q1 | Q2 | Q3 | First-visit verdict |
|---|---|---|---|---|
| Title | ✅ | ✅ | ✅ | Show |
| Hook copy | ✅ | ✅ | ❌ (overlap with firstVisitHint) | Hide on first-visit |
| First-visit hint | ✅ | ✅ | ✅ | Show |
| Demo loop | ✅ (it shows what to do) | ✅ | ✅ | Show |
| Start button | ✅ | ✅ | ✅ | Show |
| Keyboard shortcut hints | ❌ (no kb on mobile; no muscle memory yet) | ❌ ("M mute / P pause" — mute what? pause what?) | — | Hide on first-visit |
| Lifetime stats button | ❌ (zero stats to show) | ❌ ("lifetime" of what?) | — | Hide on first-visit |
| Daily-mode link | ❌ (mode-switch is a return-player concern) | ❌ ("daily" — what does that mean for me right now?) | — | Hide on first-visit |
| Theme picker | ❌ (cosmetic) | ❌ ("void / sunset / forest" — labels mean nothing without seeing the game) | — | Hide on first-visit; system-default via `prefers-color-scheme` |

Promote ⚠ to ❌ aggressively. The audit is biased toward *removing* on first visit; the Q1-3 questions are deliberately strict.

### 4. Apply the standard fix recipe

Three named recipes — pick the one that matches the symptom.

**Recipe A — `.first-visit` descendant hide** (for return-player affordances; pattern #2 above)
```js
// game.js — once, near top
const isFirstVisit = !localStorage.getItem('vp:played');
if (isFirstVisit) document.body.classList.add('first-visit');
// later, after first run completes:
localStorage.setItem('vp:played', '1');
document.body.classList.remove('first-visit');
```
```css
/* style.css */
.overlay.first-visit .kbhint,
.overlay.first-visit #statsBtn,
.overlay.first-visit .hook,
.overlay.first-visit #themePicker,
.overlay.first-visit .daily-link {
  display: none;
}
```
Five elements collapse to none on first visit; reappear from second visit onward. **Single CSS rule, zero JS-per-element.** This is the workhorse recipe — it covers patterns #1, #2, #4 in one go.

**Recipe B — system-derived default** (for pattern #4: choices before baseline)
```js
// instead of asking the player to pick a theme on first visit:
const explicitTheme = localStorage.getItem('vp:theme');
const systemTheme = matchMedia('(prefers-color-scheme: dark)').matches ? 'void' : 'sunset';
document.documentElement.dataset.theme = explicitTheme || systemTheme;
```
The theme picker is hidden on first visit (Recipe A); on second visit it appears with the system-derived default already selected, so the player sees a sensible state and can adjust if they want.

**Recipe C — hide-until-data** (for pattern #5: stats/config without data)
```js
// in the start-screen render code:
const stats = readLifetimeStats(); // returns {totalRuns: N, ...}
statsBtn.hidden = stats.totalRuns === 0;
dailyLink.hidden = stats.totalRuns === 0;
```
Note the overlap with Recipe A — `hidden` and `.first-visit` descendant rule double-cover the same elements. That's intentional defense-in-depth: if `localStorage.getItem('vp:played')` returns a stale truthy value but the player has no actual run data, Recipe C still hides the buttons.

### 5. Verify side-effects

After hiding elements on first-visit, **check what fills the visual gap.**

- **Vertical space.** Hiding 5 elements out of 9 may leave the start overlay too sparse / poorly centered. Verify the remaining 4 elements still look composed (not floating awkwardly at the top).
- **Tab order.** Hidden elements (`display: none`) are correctly excluded from tab order; verify by tabbing through the first-visit overlay and counting stops.
- **Sibling-offset selectors.** The `.help-btn` was positioned `right: 60px` to clear `.icon-btn`-sized affordances. If you hide a sibling, an absolutely-positioned button may now overlap with empty space (harmless) or with the wrong element (regression).
- **Reduced-motion.** Recipe A relies on a `.first-visit` parent class enabling pulse-ring animations on the Start button. Verify `@media (prefers-reduced-motion: reduce)` still suppresses those.
- **Second-visit transition.** When the `.first-visit` class is removed (after run 1 completes), all hidden elements re-appear. Verify they don't pop in disruptively mid-game; ideally the class is removed on the *next* page load, not mid-session.

## Common gap patterns (search-and-fix list)

Red-flag patterns to grep for during the audit:

```bash
# Affordances that should probably be first-visit-hidden:
grep -nE 'class="[^"]*(?:stats|settings|theme|daily|leaderboard|achievements?)' index.html

# Copy that may overlap with the first-visit hint:
grep -nE '(?:tap|click|press).{1,40}(?:start|play|begin)' index.html

# Multi-choice UIs (radiogroup, select, fieldset) on the start screen:
grep -nE 'role="radiogroup"|<select|<fieldset' index.html
```

Safe replacements:
```html
<!-- ❌ unconditional theme picker on start screen -->
<div id="themePicker" role="radiogroup">…</div>

<!-- ✅ themepicker visible only after run 1 (via parent .first-visit class):  -->
<!-- HTML stays the same; CSS handles the gating: -->
<style>
  body.first-visit #themePicker { display: none; }
</style>
```

```html
<!-- ❌ two redundant explanations on first visit -->
<p class="hook">Tap on the beat. Dodge the red. Chase 100%.</p>
<p class="first-visit-hint">First time? Tap white rings · skip red ones · chase 100%.</p>

<!-- ✅ pick one for first-visit, the other for return players -->
<style>
  body.first-visit .hook { display: none; }
  body:not(.first-visit) .first-visit-hint { display: none; }
</style>
```

## When NOT to use

- **Tutorial-driven games.** If the game *requires* a tutorial for input mechanics, the cognitive-load audit's recommendation to minimize start-screen elements collides with the tutorial's need to teach. Resolution: the tutorial *replaces* the start-screen flow on first visit; the audit applies inside the tutorial's screens (one teaching point per screen).
- **Genres where the choice IS the game.** A character-creator before a JRPG, or a deck-builder's pre-game loadout, are fundamentally choice-first surfaces. The audit's "defer choices to second visit" recipe doesn't apply; instead apply pattern #3 (one CTA visually dominant) within the choice surface.
- **Multi-player lobby screens.** Same logic — choice (room, color, ready-toggle) is the surface's purpose. Audit shifts to "is the join button findable in 1 second?" rather than "are there too many controls?"

## Audit cadence

- **Per sprint that adds a new overlay element:** spot-check (3 questions × the new element only).
- **Periodic full sweep every 20 sprints:** re-walk every pre-first-input surface; tally is in the postmortem.
- **Anytime you onboard a fresh playtester:** ask them out loud "what do I do?" and time it. If their first answer is anything other than "press the big button" within 3 seconds, the audit has overdue work.

## Cost

The audit itself: ~10 minutes (one pre-first-input surface = ~9 elements × 3 questions). The fix is usually ~4 lines of CSS (Recipe A). The cost of *not* doing it is that brand-new players bounce on the start screen — and unlike a runtime error you can never tell from your own analytics, because *you* the dev never bounced.

The asymmetry: an unaudited start screen costs N% of new-player conversion permanently. The audit costs one sprint, once. Even at low N, the audit pays back over a single ship.

## Cross-link

This skill is the 9th member of the audit family. See [`audit-from-the-margin.md`](../audit-from-the-margin.md) for the meta-discipline, the other 8 audits, and the prevent-vs-recover pair pattern (cognitive-load is a *prevent* audit with no recover-pair, since the failure mode is silent disengagement rather than a throw).
