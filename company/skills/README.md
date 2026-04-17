# 🧠 GameCompany Skills Library

Reusable know-how extracted from past projects. Every game ships with a postmortem; patterns that proved their worth land here.

## How to use

- **Before starting a game** — skim the index below, open the 3–4 most relevant docs.
- **Before writing a new utility** — grep the skills folder first; copy-adapt if a match exists.
- **After shipping a game** — update a skill doc if this project surfaced a new pattern. Date-stamp the addition.

## Index

### Gameplay
- [`gameplay/game-loop.md`](gameplay/game-loop.md) — fixed-timestep `requestAnimationFrame` loop with `dt` cap
- [`gameplay/input-handling.md`](gameplay/input-handling.md) — unified pointer events (mouse + touch)
- [`gameplay/difficulty-curve.md`](gameplay/difficulty-curve.md) — tuning ramps for the 60–90s session
- [`gameplay/pause-visibility.md`](gameplay/pause-visibility.md) — tab-hide pause + 3-2-1 countdown resume
- [`gameplay/anti-frustration.md`](gameplay/anti-frustration.md) — pity life on rage-retry, forgiveness levers
- [`gameplay/seeded-daily.md`](gameplay/seeded-daily.md) — deterministic daily challenge via `?seed=` + per-seed best

### Graphics
- [`graphics/svg-sprites.md`](graphics/svg-sprites.md) — inline SVG sprite patterns, no image files
- [`graphics/css-animation.md`](graphics/css-animation.md) — shake / pop / flash keyframes
- [`graphics/particle-fx.md`](graphics/particle-fx.md) — canvas particle pool
- [`graphics/backdrop.md`](graphics/backdrop.md) — zero-alloc starfield, depth via twinkle
- [`graphics/death-cam.md`](graphics/death-cam.md) — slow-mo freeze-frame beat on fatal endings
- [`graphics/perf-budget.md`](graphics/perf-budget.md) — zero-alloc render audit + adaptive quality + dev FPS overlay

### Audio
- [`audio/web-audio-sfx.md`](audio/web-audio-sfx.md) — oscillator + envelope SFX recipes; spawn-tick anchor
- [`audio/audio-dynamics.md`](audio/audio-dynamics.md) — three-state master bus (normal / beaten / duck) with smooth ramps

### Mobile
- [`mobile/dpr-canvas.md`](mobile/dpr-canvas.md) — DPR-aware canvas for crisp rendering on retina
- [`mobile/haptics.md`](mobile/haptics.md) — `navigator.vibrate()` patterns + reduced-motion gating

### UX
- [`ux/retention.md`](ux/retention.md) — run-end stats, NEW BEST gating, mute persistence
- [`ux/progress-feedback.md`](ux/progress-feedback.md) — in-play tier meter + run-history sparkline
- [`ux/accessibility.md`](ux/accessibility.md) — redundant color coding, keyboard parity, reduced-motion gating
- [`ux/share.md`](ux/share.md) — Web Share API + clipboard fallback for frictionless virality
- [`ux/onboarding.md`](ux/onboarding.md) — looping CSS-animated demo + keyboard-shortcut hints on the start overlay
- [`ux/help-modal.md`](ux/help-modal.md) — `?` key + auto-pause discoverable help modal for stacked hidden mechanics
- [`ux/leaderboard-local.md`](ux/leaderboard-local.md) — local top-N per-seed leaderboard with relative-time labels + new-row highlight

### QA
- [`qa/casual-checklist.md`](qa/casual-checklist.md) — pre-ship checklist + multi-perspective sweep (player / mobile / onboarding / retention / distribution)

## Conventions

- Each doc has a **When to use** section + runnable code snippets.
- Snippets are copy-paste ready for `game.js` / `style.css` (no import syntax).
- If a pattern depends on constants, list them at the top so designers can tune.
- Date-stamp additions: `<!-- added: 2026-04-17 (001-<slug>) -->`
