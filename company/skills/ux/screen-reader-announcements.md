# Skill — Screen-Reader Announcement Discipline

**When to use:** any game that has a HUD with fast-updating numbers (score, combo, timer, lives). Default HTML + ARIA gives you two failure modes:

1. **Over-announce** — `<div aria-live="polite">` on the HUD means every score tick gets queued into the screen reader, producing a machine-gun of "fifty... sixty... seventy... eighty..." that the player can't mute and can't outrun. This is a *silent-majority bug* — you won't notice it in normal play, but a screen-reader user is excluded from your game in the first 5 seconds.
2. **Under-announce** — marking everything `aria-hidden="true"` silences the HUD but leaves the screen-reader user with no sense of progress, no confirmation that hits registered, no notification on death.

The fix is not more `aria-live` — it's *selective* announcement: a single polite live region that speaks only at moments that justify the interruption.

## Pattern — silence the HUD, add a single announcer

```html
<!-- Visual HUD: hidden from AT, speaks via CSS only. -->
<div id="hud">
  <div id="score" aria-hidden="true">0</div>
  <div id="comboWrap" aria-hidden="true">…</div>
  <div id="lives" aria-label="Lives remaining">…</div>
</div>

<!-- The one live region the whole game uses. -->
<div id="srAnnounce" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></div>
```

```css
/* WCAG standard "visually hidden" — still in the a11y tree. */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
```

Decisions:
- **`aria-atomic="true"`** so each announcement replaces the prior one entirely; the reader speaks the whole string, not a diff. Without this, "Score 150" updated to "Score 160" might be read as just "160" with no context.
- **`role="status"`** + `aria-live="polite"` is the gentlest live-region contract; screen readers queue rather than interrupt the current read, so a rapid burst of announcements gets naturally coalesced.
- **`sr-only` class uses `clip: rect(0, 0, 0, 0)`** — the canonical visually-hidden trick. `display: none` hides from AT too; `visibility: hidden` same; `height: 0 / overflow: hidden` also removes from AT in some readers. `clip:` is the safest.
- **Lives gets `aria-label`** rather than aria-hidden, because the glyph count is the one HUD fact worth exposing (it's slow-changing and emotionally loaded). Score/combo are too fast to voice.

## Pattern — the announcer helper with re-read trick

```js
const srAnnounceEl = document.getElementById('srAnnounce');
let _srPending = null;
function announce(msg) {
  if (!srAnnounceEl || !msg) return;
  _srPending = msg;
  // Clear first so the reader re-reads even if the new string matches
  // the prior one (same-string updates are often silently skipped).
  srAnnounceEl.textContent = '';
  setTimeout(() => {
    if (_srPending === null) return;
    srAnnounceEl.textContent = _srPending;
    _srPending = null;
  }, 0);
}
```

- **The empty-then-set trick** — setting `textContent = ''` and then (in a microtask/macrotask) setting the new string forces AT to re-announce. Many readers de-dupe identical content and would silently skip a repeat. Useful for "2 lives left" appearing twice in a row when the player loses a second life to the same kind of event.
- **The `_srPending` guard** — if `announce()` is called twice in the same synchronous frame, only the last message wins. Coalescing prevents the reader from stacking up partial reads that get talked over.

## Pattern — announce *moments*, not *state*

The rule: if it happens more than once a second, it doesn't get announced. Build a list of *moments that matter* and hook announce() only at those points. For void-pulse's case:

| Event | Announce | Why |
|---|---|---|
| Per-hit score tick | ❌ never | 2-10/sec is unusable |
| Combo milestone (×5 step) | ❌ in a tier | still too frequent |
| Multiplier tier change (1→1.5→2→2.5→3→3.5→4) | ✅ on transition | 4-8 per run, meaningful |
| Life lost | ✅ always | up to 3-4 per run, critical |
| Gameover summary | ✅ one line | final context |
| New best (gameover) | ✅ rolled into summary | high salience |
| Streak bumped (daily) | ✅ rolled into summary | rewards returning |
| Achievement unlocked (mid-run toast) | ✅ via central announcer | rare, meaningful |
| Pause / resume | ❌ (visual overlay is enough) | overlay's `aria-modal` handles focus |
| Theme change | ❌ (visual change speaks for itself) | keyboard T is self-announcing via button |

Total: ~6-12 announcements per run. That's a one-utterance-per-5-seconds budget, well under "noisy".

## Pattern — tier-change gating (not every-N gating)

```js
let _srLastTier = 1;
function announceMilestoneTier(mult) {
  if (mult === _srLastTier) return;   // still in same tier → silent
  _srLastTier = mult;
  announce('Multiplier ' + (mult % 1 === 0 ? mult : mult.toFixed(1)) + ' times');
}
// ... at combo step:
if (state.combo % COMBO_STEP === 0) announceMilestoneTier(comboMult());
// ... on loseLife:
_srLastTier = 1;    // reset so next run's first milestone announces fresh
```

Why tier gating, not "every 10 combos":
- **Every-N gating becomes noise once the player is good** — a combo of 100 fires 20 every-5 announcements. Tier gating fires *at most* 6 (1.5, 2, 2.5, 3, 3.5, 4) regardless of combo length.
- **Transitions are what matter** — "you entered 3× territory" is news; "you stayed in 3× territory" isn't.
- **Reset on combo break** — `_srLastTier = 1` on life-lost lets the announcer re-celebrate when the player climbs back. Without reset, a player who dies at 3× and climbs back to 3× would hear nothing.

## Pattern — compose a single gameover line

```js
const parts = [];
if (state.newBestThisRun) parts.push('New best!');
else parts.push('Game over.');
if (streakBumped) parts.push('Day ' + streakAfter.streak + ' streak.');
parts.push('Score ' + state.score + '.');
parts.push('Peak combo ' + state.peakCombo + '.');
announce(parts.join(' '));
```

- **One call, full context** — "Game over. Day 3 streak. Score 1280. Peak combo 22." reads as one thought. Six calls would interrupt each other; the polite queue would serialize them but each would *replace* the prior since we're `aria-atomic`, so earlier ones would get cut off.
- **Priority-ordered composition** — highest-salience first (NEW BEST > streak > score > peak). A reader that cuts off mid-sentence still delivers the headline.
- **Periods, not commas** — screen readers pause longer at periods; readability depends on this.

## Pattern — route unlocks through the central announcer, even when the UI has its own aria-live

```html
<!-- BEFORE — toast had its own aria-live. -->
<div id="achievementToast" role="status" aria-live="polite">…</div>

<!-- AFTER — toast is visual-only; central announcer speaks. -->
<div id="achievementToast" aria-hidden="true">…</div>
```

```js
function showAchievementToast(ach) {
  // ... visual toast logic ...
  announce('Achievement unlocked: ' + ach.label);
}
```

Reasons to centralize:
- **Single aria-live = predictable queue** — multiple live regions compete; the reader's heuristic for which to speak first isn't consistent across AT vendors.
- **Prefix context** — the central announce call can add "Achievement unlocked:" while the visual toast just says "Combo 100"; SR users get the context that sighted users infer from the toast's visual shape (badge icon, "Achievement" header).
- **Some screen readers suppress `role="status"` updates when a dialog is focused** — a persistent dedicated region bypasses that edge case.

## Pattern — `prefers-contrast: more` as a secondary pass

```css
@media (prefers-contrast: more) {
  .btn, .help-card, .stat-row {
    border-color: var(--fg) !important;
  }
  .help-keys, .stat-k, .kbhint {
    opacity: 1 !important;
  }
  #score, #combo {
    text-shadow: 0 0 1px #000, 0 0 2px #000;
  }
}
```

- **Don't rewrite the palette** — the theme's identity should stay. Just pump opacity of muted text (`.opacity = .5/.6`) to 1, pump border-color from `rgba(…, .14)` to full `var(--fg)`, add subtle outlines to focused elements.
- **Add text-shadow on numbers overlaid on canvas** — the HUD score sits over changing colors; a thin 1-2px black shadow guarantees legibility against any palette.
- **`!important` is OK here** — `prefers-contrast` is the user's hard preference; it should win over cascaded theme CSS.
- **`:focus-visible` outlines should also get thicker** — add `outline-width: 3px` in the media block, or just `outline: 2px solid var(--fg)`.
- **Don't gate announcements on contrast** — contrast is visual; AT users have their own rendering that ignores your CSS entirely.

## Common mistakes

- **`aria-live="polite"` on the whole HUD** — announces every score tick; 2-10 utterances/second = unusable.
- **Multiple live regions** — reader's queue semantics aren't portable across JAWS/NVDA/VoiceOver. One region is the safe default.
- **Announcing state instead of moments** — "Score is now 150" (state) vs. "New best!" (moment). State is for the visual HUD; moments are for the announcer.
- **Forgetting to reset tier cache on death** — player climbs 1→3×, dies, climbs back 1→3×, but second climb is silent because `_srLastTier` is still 3.
- **Setting `textContent` directly without the empty-first trick** — identical repeat announcements get silently de-duped.
- **Using `alert` role when `status` fits** — `role="alert"` is assertive and *interrupts* the reader mid-sentence. Use it only for critical errors, never for gameplay moments.
- **Forgetting `aria-atomic="true"`** — diff-announcing reads incomplete context on each update.
- **Hiding `#lives` with `aria-hidden="true"`** — lives count is slow and critical; expose it via `aria-label` instead.
- **`display: none` for visually-hidden** — removes from AT; use the `clip: rect(0,0,0,0)` pattern instead.
- **No keyboard-only flow test** — "does my game work blindfolded using Tab + Enter + Space + Esc?" is the minimum a11y smoke test. Try it.
- **No reduced-motion consideration in contrast mode** — `prefers-contrast: more` and `prefers-reduced-motion: reduce` are independent. Don't conflate them.
- **Prefix "Achievement unlocked:" rot in the UI** — if the visual toast *already* says "Achievement", the prefix reads redundant visually. Keep it only in the SR announcement; the visual element has its own framing.

<!-- added: 2026-04-17 (001-void-pulse sprint 27) -->
