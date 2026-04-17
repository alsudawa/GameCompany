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
- [`gameplay/rhythm-chart.md`](gameplay/rhythm-chart.md) — fixed-BPM deterministic chart (templates × band schedule + exact-max simulation + schema versioning)
- [`gameplay/reactive-hazard.md`](gameplay/reactive-hazard.md) — don't-tap hazard events woven into a chart (visual triple-redundancy + bonus/penalty + placement heuristics)

### Graphics
- [`graphics/svg-sprites.md`](graphics/svg-sprites.md) — inline SVG sprite patterns, no image files
- [`graphics/css-animation.md`](graphics/css-animation.md) — shake / pop / flash keyframes
- [`graphics/particle-fx.md`](graphics/particle-fx.md) — canvas particle pool
- [`graphics/backdrop.md`](graphics/backdrop.md) — zero-alloc starfield, depth via twinkle
- [`graphics/death-cam.md`](graphics/death-cam.md) — slow-mo freeze-frame beat on fatal endings
- [`graphics/perf-budget.md`](graphics/perf-budget.md) — zero-alloc render audit + adaptive quality + dev FPS overlay
- [`graphics/ambient-drift.md`](graphics/ambient-drift.md) — theme-conditional persistent drift particles (wrap-around pool, no alloc, two-direction branch)
- [`graphics/staggered-reveal.md`](graphics/staggered-reveal.md) — inline `animation-delay` for time-indexed element reveals (replay-as-animation, reduced-motion fallback, shared-axis pacing)
- [`graphics/power-lifecycle.md`](graphics/power-lifecycle.md) — AudioContext suspend on mute+visibility-hidden + rAF render-skip when `document.hidden` + `prefers-reduced-data`/`saveData` ambient halving
- [`graphics/beat-indicator.md`](graphics/beat-indicator.md) — HUD quarter-note pulse ring with downbeat accent (CSS class-retrigger via reflow + state.t-driven so mute doesn't kill the anchor + reduced-motion fallback)
- [`graphics/state-tint.md`](graphics/state-tint.md) — state-reactive animation color via `data-*` attribute + CSS custom property (one keyframe, N palettes, theme-aware by construction, JS only touches attribute)

### Audio
- [`audio/web-audio-sfx.md`](audio/web-audio-sfx.md) — oscillator + envelope SFX recipes; spawn-tick anchor
- [`audio/audio-dynamics.md`](audio/audio-dynamics.md) — three-state master bus (normal / beaten / duck) with smooth ramps
- [`audio/theme-conditional-sfx.md`](audio/theme-conditional-sfx.md) — additive theme accent layer (lazy noise buffer + filter branch for crackle/rustle, void = no-op)
- [`audio/web-audio-scheduling.md`](audio/web-audio-scheduling.md) — `ctx.currentTime + delay` pre-scheduling for tight rhythmic audio (vs. setTimeout drift), gate-on-reduced-motion for visual-synced audio
- [`audio/synced-bgm.md`](audio/synced-bgm.md) — beat-synced generative BGM module (band-conditional pattern table + 60ms tick / 250ms lookahead scheduler + anchor-shift pause/resume via performance.now)
- [`audio/sidechain-duck.md`](audio/sidechain-duck.md) — transient event-duck on music gain (anchor-current-value + attack/hold/release envelope + overlap-safe composition, distinct from steady-state bus swap)

### Mobile
- [`mobile/dpr-canvas.md`](mobile/dpr-canvas.md) — DPR-aware canvas for crisp rendering on retina
- [`mobile/haptics.md`](mobile/haptics.md) — `navigator.vibrate()` patterns + reduced-motion gating
- [`mobile/pwa-lite-install.md`](mobile/pwa-lite-install.md) — manifest + apple-touch-icon + dynamic theme-color for add-to-home-screen (no service worker needed)

### UX
- [`ux/retention.md`](ux/retention.md) — run-end stats, NEW BEST gating, mute persistence
- [`ux/progress-feedback.md`](ux/progress-feedback.md) — in-play tier meter + run-history sparkline
- [`ux/accessibility.md`](ux/accessibility.md) — redundant color coding, keyboard parity, reduced-motion gating
- [`ux/focus-visible-audit.md`](ux/focus-visible-audit.md) — keyboard focus-ring coverage audit + outline-offset layering + split-selector rule for hover-vs-focus differentiation (dashed-ring pattern for selected-state collisions)
- [`ux/share.md`](ux/share.md) — Web Share API + clipboard fallback for frictionless virality
- [`ux/onboarding.md`](ux/onboarding.md) — looping CSS-animated demo + keyboard-shortcut hints on the start overlay
- [`ux/two-phase-demo.md`](ux/two-phase-demo.md) — two-state start-overlay demo ("tap this, skip that") in one 5.2s single-animation cycle (phase-gap split + color-blind-safe labels + static side-by-side reduced-motion fallback)
- [`ux/help-modal.md`](ux/help-modal.md) — `?` key + auto-pause discoverable help modal for stacked hidden mechanics
- [`ux/leaderboard-local.md`](ux/leaderboard-local.md) — local top-N per-seed leaderboard with relative-time labels + new-row highlight
- [`ux/streak-and-achievements.md`](ux/streak-and-achievements.md) — global daily-streak counter + first-run achievement unlocks (scoping matrix + active-vs-dormant rule)
- [`ux/theme-picker.md`](ux/theme-picker.md) — `data-theme` palette swap + canvas-cache invalidation + RGB-triplet vars for rgba() composition
- [`ux/system-preferred-defaults.md`](ux/system-preferred-defaults.md) — first-visit auto-theme from `prefers-color-scheme`/`prefers-contrast` + live listeners + localStorage as auto-vs-explicit bit
- [`ux/ghost-run-comparison.md`](ux/ghost-run-comparison.md) — per-seed best-run event timeline stored as `[t,kind]` tuples, shared-axis SVG strip, snapshot-before-write rule
- [`ux/first-visit-hint.md`](ux/first-visit-hint.md) — one-shot localStorage bit + `.first-visit` parent class + reduced-motion fallback for the start-overlay onboarding hint and Start-button pulse
- [`ux/mid-run-toast.md`](ux/mid-run-toast.md) — rare-tier achievement toast during play via `midRun: true` flag + frame-loop eval + serial queue + bank-on-unlock write discipline
- [`ux/lifetime-stats.md`](ux/lifetime-stats.md) — cross-mode lifetime aggregate panel (single JSON blob + default-fill read, one bump per gameover, empty state, two-step reset, derived rates)
- [`ux/stats-export.md`](ux/stats-export.md) — copy-as-text lifetime-stats export (human-readable multi-line snapshot + mirrors share-btn clipboard-flow UX + hidden-until-data + positive-action-left positioning vs destructive Reset)
- [`ux/sparkline.md`](ux/sparkline.md) — inline SVG sparkline renderer, shared across gameover + stats panel surfaces (fillSparkline(el,scores,W,H,SLOTS) + .spark-svg shared CSS class + right-align-latest + role-color rule with best/latest tie preference)
- [`ux/screen-reader-announcements.md`](ux/screen-reader-announcements.md) — single polite live region + tier-change gating + `aria-atomic` composed gameover line + `prefers-contrast` pass + `sr-only` clip utility
- [`ux/modal-focus-trap.md`](ux/modal-focus-trap.md) — Tab/Shift+Tab focus trap + focus-restore-to-trigger for modals (live-query focusables + `offsetParent` filter for CSS-hidden + body/detached fallbacks + selector constant)

### QA
- [`qa/casual-checklist.md`](qa/casual-checklist.md) — pre-ship checklist + multi-perspective sweep (player / mobile / onboarding / retention / distribution)

## Conventions

- Each doc has a **When to use** section + runnable code snippets.
- Snippets are copy-paste ready for `game.js` / `style.css` (no import syntax).
- If a pattern depends on constants, list them at the top so designers can tune.
- Date-stamp additions: `<!-- added: 2026-04-17 (001-<slug>) -->`
