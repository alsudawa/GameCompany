# Skill — First-Visit Onboarding Hint (One-Shot CSS Reveal)

**When to use:** a casual game with a start overlay that's obvious on the 2nd+ play but opaque on the 1st play. The existing demo animation helps, but the player still has to *recognize* it as a demo. A short, literal hint ("Tap at the moment the pulse meets the ring") plus a subtle pulse on the Start button converts the first-run from "what am I looking at?" to "oh, tap — got it". After the first real Start tap, the treatment disappears forever for that profile — permanent chrome would train players to ignore it.

This complements `ux/onboarding.md` (the ever-present CSS demo) and `ux/help-modal.md` (the explicit `?` key reference). The first-visit hint is the *implicit* layer: no clicks, no reading a modal, just a one-line caption that's only there when it's useful.

## Contract

- **First visit** — the flag is absent. Show the hint + Start-button pulse.
- **Any subsequent visit** — the flag is `'1'`. Render exactly as before, no onboarding chrome.
- **Clearing the flag** (devtools, incognito, profile wipe) — restores the first-visit treatment. This is correct behavior: a new profile *is* a new player.

The flag is written atomically at the moment the player commits to the game — on `start()`, not on page load. A player who opens the tab, reads the hint, and closes the tab without tapping still gets the hint next time. Only actual play counts.

## Pattern — one-shot localStorage bit

```js
const SEEN_KEY = 'void-pulse-seen';
function readSeen() {
  try { return localStorage.getItem(SEEN_KEY) === '1'; } catch { return false; }
}
function writeSeen() {
  try { localStorage.setItem(SEEN_KEY, '1'); } catch {}
}
```

Design notes:
- **String `'1'`, not JSON.** Smallest possible payload. Doesn't need a versioning envelope; it's a single boolean. If the schema ever grows, bump the key name (`void-pulse-seen-v2`) and the old bit becomes a benign no-op.
- **`=== '1'` comparison, not truthy-check.** A future hand-edit of `'false'` or `'null'` won't accidentally count as "seen".
- **try/catch on both sides.** Incognito Safari throws on `localStorage.setItem` under quota restrictions. The fallback is "always show the hint" (treat as first visit) — annoying but non-breaking.
- **Fail-safe read returns false.** A catch-branch returning `true` would silently suppress the hint forever on any storage hiccup. `false` means "show the hint" — worst case is mild redundancy, not invisible feature.

## Pattern — CSS-driven reveal via parent class

```js
// Boot
if (!readSeen()) overlay.classList.add('first-visit');
```

```css
.first-visit-hint { display: none; /* hidden by default */ color: var(--highlight); ... }
.overlay.first-visit #firstVisitHint { display: block; }
.overlay.first-visit #start {
  animation: firstVisitPulse 1.8s ease-in-out infinite;
}
@keyframes firstVisitPulse {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 45%, transparent); }
  50%      { box-shadow: 0 0 0 12px color-mix(in srgb, var(--accent) 0%, transparent); }
}
```

Why a parent class and not separate JS-driven classes:
- **Single toggle point.** Add `.first-visit` on the overlay, and every descendant that cares (hint, Start button, potentially others later) reacts via CSS selectors. Adding another first-visit-only element is a pure-CSS change; the JS stays one line.
- **Selector composability.** `.overlay.first-visit #start` scopes the pulse so it *only* animates when both conditions hold — covers the "overlay visible AND first visit" case without extra guards.
- **Atomic reveal and atomic teardown.** One `classList.add` / `classList.remove` swaps the whole treatment in or out. No risk of a half-applied state where the hint shows but the button doesn't pulse.

Hide the hint at the HTML level (`hidden` attribute) as the default, and let CSS un-hide it only when the parent class is present. This keeps the markup accessible to screen readers even in the default state — they see no hint, just like sighted users.

## Pattern — teardown at the commit moment

```js
function start() {
  // ... other state resets ...
  overlay.classList.remove('visible'); overlay.classList.add('hidden');
  if (overlay.classList.contains('first-visit')) {
    overlay.classList.remove('first-visit');
    writeSeen();
  }
  // ... continue start sequence
}
```

Two important choices:
- **Teardown happens at `start()`, not on first interaction anywhere.** A player who mis-taps the mute button or clicks a theme swatch shouldn't lose the hint — they haven't actually played yet. Only the Start tap (or Space) counts as "committed".
- **Guarded removal + write.** Check `classList.contains('first-visit')` before writing. Without the guard, every single `start()` call would hit localStorage — a nominal cost but a Storage API call on every retry, which the browser's anti-fingerprinting heuristics may notice. With the guard, it's at most one write per browser profile ever.
- **Write AFTER removing the class** is fine; order doesn't matter because the overlay is already hidden by the time `start()` runs. But do them in a single `if` block so a future refactor can't separate them.

## Pattern — reduced-motion fallback

```css
@media (prefers-reduced-motion: reduce) {
  .overlay.first-visit #start {
    animation: none;
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 40%, transparent);
  }
}
```

The pulse animation is *emphasis*, not *information* — a reduced-motion player can still tell which button to tap because the hint text literally says "tap" and the button is the only visible CTA. But removing the pulse without any replacement makes the first-visit treatment invisible to reduced-motion users. A static ring of the same color substitutes: less attention-grabbing, but it's still a visual "look here" cue.

This is the same pattern as the demo's reduced-motion fallback (`ux/onboarding.md`): animation becomes a static pose of equivalent meaning, not nothing.

## Pattern — theme parity via CSS vars

```css
.first-visit-hint { color: var(--highlight); text-shadow: 0 0 10px rgba(255, 210, 74, .28); }
```

The hint text uses `var(--highlight)` so it theme-swaps automatically — void highlight is cyan-ish, sunset is amber, forest is teal. The text-shadow is a fixed warm glow because the target of the shadow is "make it feel highlighted", not "match the theme exactly". Semantic tokens (theme) for primary color, hardcoded values (shadow) for decorative polish. Same rule as `ux/theme-picker.md`.

## Common mistakes

- **Writing the flag on page load.** Kills the hint for bounce visitors who closed the tab before playing. Write only on genuine commit.
- **Using `sessionStorage`.** The hint would reappear on every new tab, every day — too noisy for a mature returning player. Use `localStorage` so the one-shot is profile-scoped.
- **Storing the flag under the same key as gameplay state.** Couples the onboarding reset to game state. Keep `SEEN_KEY` its own string — resetting best score shouldn't resurrect the hint (and vice versa).
- **Adding the hint element directly to the DOM at boot via JS.** Means the hint can't be styled before the first script runs — janky on slow devices. Prefer static HTML + `hidden` attribute + CSS reveal.
- **Using `display: none` in CSS as the default.** Works, but then screen readers skip the element entirely even when `.first-visit` is present. The `hidden` attribute is the semantic equivalent that also responds correctly to programmatic focus/announcement. *Actually* — for this pattern, `display: none` is fine because the whole point is "don't exist for non-first-visitors". Use `hidden` on the element itself as the default state; the `.first-visit` selector then overrides `display: none` with `display: block`. Both the attribute and the override agree.
- **Animating the Start button with `opacity` or `transform`.** These affect layout / click-target perception. `box-shadow` is a paint-only property, cheap, and doesn't bleed into surrounding elements.
- **Running the pulse animation forever.** The animation is infinite by design *while* `.first-visit` is applied, but the class is removed at `start()`, which ends the animation atomically. A player who never starts sees the pulse continue — that's the point; they haven't dismissed the call to action.
- **Forgetting to test the reset path.** `localStorage.removeItem('void-pulse-seen')` in devtools + refresh should restore the full first-visit treatment. If it doesn't, either the flag key is wrong or there's a second flag hiding somewhere.
- **Chaining multiple hints in a queue.** Tempting to keep adding "Try daily!" "Try sunset theme!" tutorial cards. Resist — this pattern is deliberately one-shot. Multi-step onboarding belongs in a help modal or tooltip system, not in the start overlay.

<!-- added: 2026-04-17 (001-void-pulse sprint 20) -->
