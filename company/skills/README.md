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

### Graphics
- [`graphics/svg-sprites.md`](graphics/svg-sprites.md) — inline SVG sprite patterns, no image files
- [`graphics/css-animation.md`](graphics/css-animation.md) — shake / pop / flash keyframes
- [`graphics/particle-fx.md`](graphics/particle-fx.md) — canvas particle pool

### Audio
- [`audio/web-audio-sfx.md`](audio/web-audio-sfx.md) — oscillator + envelope SFX recipes

### QA
- [`qa/casual-checklist.md`](qa/casual-checklist.md) — pre-ship checklist for casual games

## Conventions

- Each doc has a **When to use** section + runnable code snippets.
- Snippets are copy-paste ready for `game.js` / `style.css` (no import syntax).
- If a pattern depends on constants, list them at the top so designers can tune.
- Date-stamp additions: `<!-- added: 2026-04-17 (001-<slug>) -->`
