# Skill — Two-Phase Onboarding Demo (Teach-and-Anti-Teach)

<!-- added: 2026-04-17 (001-void-pulse, sprint 34) -->

**When to use:** your game's core loop is a *two-state* interaction — "tap this kind of thing, don't tap that kind of thing" — and you need the start overlay to convey both states at a glance before the first run. Pure CSS, no JS, loops forever.

Common shapes this pattern fits:
- Tap the white, skip the red (rhythm/hazard games — void-pulse)
- Match the shape, ignore the other (memory/pattern games)
- Collect the coin, avoid the spike (casual platformer)
- Answer correctly, skip the red herring (quiz/trivia)

The anti-pattern this replaces: a single "good-state" demo that looks like *the whole* mechanic. A new player sees "thing appears → you tap it" and then gets punished in-game for tapping the *other* kind of thing. Onboarding actively mislead them. Better to show both states in one loop.

Pairs with:
- `ux/onboarding.md` — the broader start-overlay pattern this fits into
- `ux/first-visit-hint.md` — text-level hint that sits above the demo

## Contract

- **Single infinite animation, two phases.** Don't synchronize two separate animations — they'll drift if the browser throttles. One keyframe per element, all sharing the same duration + cubic-bezier, with phase windows via keyframe percentages.
- **Phase split at ~50/50.** Good demo runs 0–48%, hazard demo runs 52–100%. Tiny gap (48→52%) gives the eye a beat before the contrast flip.
- **Two different LABELS, not just two different colors.** Color alone is color-blind-hostile and eye-gluing. "TAP" vs "SKIP" text anchors each phase semantically.
- **Labels timed to the *payoff* moment of each phase.** Label fades in right before the pulse reaches target size, stays through the correct-action window, then fades as the phase ends. Teaches the *when*, not just the *what*.
- **Reduced-motion: static side-by-side snapshot.** Don't hide the demo; don't leave it mid-animation. Show both states next to each other as static rings with labels. Full information, zero motion.

## Pattern — HTML

```html
<div class="demo" aria-hidden="true">
  <div class="demo-target"></div>
  <div class="demo-pulse demo-pulse-good"></div>
  <div class="demo-pulse demo-pulse-hazard"></div>
  <div class="demo-label demo-label-tap">TAP</div>
  <div class="demo-label demo-label-skip">SKIP</div>
</div>
```

- `aria-hidden="true"` — purely visual; the start-overlay text ("Tap on the beat. Dodge the red.") carries the semantic load for screen readers.

## Pattern — CSS (the two-phase cycle)

```css
.demo { position: relative; width: 160px; height: 160px; pointer-events: none; }
.demo-target {
  position: absolute; left: 50%; top: 50%;
  width: 70px; height: 70px; margin: -35px 0 0 -35px;
  border-radius: 50%; border: 2px solid var(--accent);
  opacity: .9;
}
.demo-pulse {
  position: absolute; left: 50%; top: 50%;
  width: 22px; height: 22px; margin: -11px 0 0 -11px;
  border-radius: 50%; border: 2px solid currentColor;
  opacity: 0;
}
.demo-pulse-good   { color: var(--fg);     animation: demoPulseGood   5.2s cubic-bezier(.4,.05,.55,.98) infinite; }
.demo-pulse-hazard { color: var(--danger); animation: demoPulseHazard 5.2s cubic-bezier(.4,.05,.55,.98) infinite; }

.demo-label {
  position: absolute; left: 50%; top: calc(50% + 56px);
  transform: translate(-50%, 0);
  font-size: 12px; letter-spacing: .22em; font-weight: 700;
  opacity: 0;
}
.demo-label-tap  { color: var(--accent); animation: demoLabelTap  5.2s ease-out infinite; }
.demo-label-skip { color: var(--danger); animation: demoLabelSkip 5.2s ease-out infinite; }

/* Phase A (0-48%): good pulse crosses target; TAP label flashes at crossing. */
@keyframes demoPulseGood {
  0%   { width: 22px;  opacity: .15; }
  22%  { width: 60px;  opacity: 1; }          /* approaching target */
  28%  { width: 72px;  opacity: 1; }          /* at target — TAP! */
  40%  { width: 110px; opacity: .25; }
  48%, 100% { opacity: 0; }                   /* hide during phase B */
}
@keyframes demoLabelTap {
  0%, 16% { opacity: 0; transform: translate(-50%, 4px); }
  24%     { opacity: 1; transform: translate(-50%, 0); }  /* just before crossing */
  40%     { opacity: 1; transform: translate(-50%, 0); }  /* hold through crossing */
  48%, 100% { opacity: 0; transform: translate(-50%, -4px); }
}

/* Phase B (52-100%): hazard pulse crosses; SKIP label flashes at crossing. */
@keyframes demoPulseHazard {
  0%, 52%  { opacity: 0; }
  55%      { width: 22px;  opacity: .18; }
  74%      { width: 60px;  opacity: 1; }
  82%      { width: 82px;  opacity: .85; }
  94%      { width: 120px; opacity: .2; }     /* expires past target — no tap */
  100%     { opacity: 0; }
}
@keyframes demoLabelSkip { /* mirror of demoLabelTap, shifted by ~50% */ }

/* Reduced-motion: static side-by-side snapshot. */
@media (prefers-reduced-motion: reduce) {
  .demo-target { display: none; }
  .demo-pulse { animation: none !important; width: 48px; height: 48px; margin: -24px 0 0 -24px; opacity: .9; }
  .demo-pulse-good   { left: 32%; }
  .demo-pulse-hazard { left: 68%; }
  .demo-label { animation: none !important; opacity: .9; top: calc(50% + 40px); }
  .demo-label-tap  { left: 32%; }
  .demo-label-skip { left: 68%; }
}
```

(The `margin: -Npx 0 0 -Npx` values offset half-width/half-height so `left: 50%; top: 50%` centers the element despite size changing in the keyframes.)

## Why a single 5.2s cycle, not two 2.6s cycles

- **One animation-origin = no drift.** Two separate `infinite` animations are declared to run at the same speed, but browsers throttle backgrounded tabs and can reset phases independently. A single keyframe scheduler keeps both phases locked.
- **Phase gap controls pacing.** Tuning the tiny 48%→52% gap gives the eye a moment between the two demonstrations. Two separate animations can't express that gap cleanly.
- **Design constraint = one rhythm.** If you want the demo to feel like "here's A, then here's B," you want a single beat. Syncing two heartbeats into one is strictly harder than running one.

## Tuning levers

| Knob | Effect |
|---|---|
| Cycle duration (5.2s) | Total loop. Shorter than 4s feels rushed; longer than 7s and the player taps Start before they've seen phase B. 5–6s is the sweet spot. |
| Phase A % window (0–48%) | Balance the time given to each demo. If the "common case" is phase A (tapping), give it slightly more (40% for A, 35% for B, 25% gap) so players feel at home. |
| Label fade-in timing | Label should appear *just before* the pulse hits target size, ~80% through the pulse's growth. Too early and it disconnects from the crossing; too late and the pulse is already past. |
| Reduced-motion positioning | `left: 32%` / `left: 68%` — tune to the demo container width. Each pulse should be visually clear of the other (no overlap). |

## Accessibility

- **Color-blind.** Color is secondary — the TAP/SKIP *labels* are the primary cue. A player who can't distinguish the good pulse from the hazard pulse reads "TAP" vs "SKIP" and learns the mechanic.
- **Reduced motion.** Static snapshot shows both states simultaneously. No animation, same information.
- **Screen readers.** `aria-hidden="true"` — the demo is visual reinforcement of text above it. Duplicate semantic load would be noise.
- **Tiny displays.** At <300px width the demo can get squished. Either scale the container (`transform: scale(.8)`) inside a media query, or hide the demo entirely and lean on the text hint.

## When NOT to use

- **Single-state games.** If there's no "don't tap the other kind" state, a two-phase demo is confusing — use a simple one-phase demo.
- **Tutorial-mode games.** If the game has a built-in tutorial run, duplicate onboarding on the start overlay competes. Tutorial wins; omit the demo.
- **Mechanic not yet tappable-by-image.** If the "don't" cue is complex (sequence, timing, audio) a static demo can't explain it — fall back to text or an in-game tutorial.

## Cost

- HTML: 5 child elements
- CSS: ~60 lines (shared base + 4 keyframes + reduced-motion block)
- JS: zero
- Perf: one shared animation rAF tick, no JS scheduling. Animation compositor-friendly (only transform/opacity changes when possible).

## Verifying it works

1. First-visit: loads start overlay; within 5 seconds the player has seen both phases (tap good, skip hazard) without doing anything.
2. Color-blind mode (simulate with a browser extension): still distinguishable via the TAP vs SKIP labels.
3. Reduced motion: two static rings with labels, both visible at once.
4. Tiny screen (320px wide): demo still fits; labels aren't clipped.
5. Tab out and back: animation resumes cleanly; phases still in sync (single animation-origin).
