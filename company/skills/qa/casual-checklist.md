# Skill — Casual Game QA Checklist

**When to use:** QA Tester runs this before writing the report.

## Correctness

- [ ] Game starts when "Start" is clicked (no silent failure)
- [ ] Game-over triggers exactly once per run
- [ ] Retry fully resets state (score, time, entities, difficulty) — no residue
- [ ] No console errors on start, during play, or on game-over
- [ ] `AudioContext` is created inside a user gesture handler (not page load)
- [ ] `dt` is capped (`MAX_DT`) so tab-switch doesn't explode physics
- [ ] `state.over` short-circuits the loop (no extra `update`s after gameover)

## Input

- [ ] Pointer events (not only mouse) — works on mobile
- [ ] `touch-action: none` on canvas (no scroll hijack on mobile)
- [ ] `user-select: none` on body (no text selection on long-press)
- [ ] Click coords scaled by canvas intrinsic size (input not offset after resize)

## Game feel

- [ ] First-run readable in under 60s without tutorial
- [ ] Retry-to-playing loop is under 3s
- [ ] At least 3 distinct juice moments (shake, pop, particles, pitch-shift, flash, etc.)
- [ ] Difficulty ramps visibly — player feels it, not just stats
- [ ] Median session length 30–60s (not too short, not endless)

## Visual / Accessibility

- [ ] No external image files (`<img src>`, CSS `url(...)` to files)
- [ ] No external fonts (`@font-face`, Google Fonts links)
- [ ] No information encoded by color alone — paired with shape/size/motion
- [ ] `prefers-reduced-motion` honored (shake/pop disabled)
- [ ] AA contrast between text and background

## Structure

- [ ] `index.html`, `style.css`, `game.js` only (plus `docs/`) — no stray files
- [ ] No `art-spec.md` or `sound-spec.md` left over (deleted after integration)
- [ ] No `import`/`require`/CDN references
- [ ] `game.js` tunable constants clustered at the top

## Performance

- [ ] No allocations inside `update` or `render` (arrays, objects, strings)
- [ ] Particles use a pool, not `.push()`/`.splice()`
- [ ] SVGs inline, each under ~30 lines
- [ ] `ctx.globalAlpha` reset to 1 after alpha-blending

## Final sanity

- [ ] `open games/<id>-<slug>/index.html` loads and plays (human check)
- [ ] File sizes reasonable (`game.js` < 20KB, `style.css` < 8KB for a simple game)

<!-- added: 2026-04-17 (001-void-pulse) -->

## Entity lifecycle gotchas

- [ ] **Entity is deactivated on BOTH hit AND miss** — a common bug: tapping incorrectly loses a life but leaves the entity alive, so it can then expire/pass-through and cost a **second** life for a single mistake. Rule: any resolved interaction (hit *or* miss tap) must set `entity.active = false`.
- [ ] **Late taps after entity expiry** — if the player taps after an entity has pass-through-expired, judging code should safely no-op (not throw, not double-punish).
- [ ] **Polyrhythm oldest-entity selection** — when multiple entities are active, the "judge oldest" logic must have deterministic tiebreaking (by `bornT`, not by array order which depends on pool slot allocation).

## Audio layering QA

- [ ] If a bonus SFX stacks on a primary SFX (e.g. heartbeat + score), check that the master gain doesn't clip at the peak — run a 20-combo simulation mentally: is the loudest moment still pleasant?
- [ ] Verify the pitch ceiling for combo-pitched SFX — past a cap (e.g. combo 12 at 1.06×) the frequency should clamp, not keep climbing into inaudible ranges.
- [ ] **First band carries tune.** If your BGM has difficulty bands (warm → climax), the *earliest* band must include at least one melodic voice (pad / lead / motif). Drum-only-for-the-first-6-seconds reads as "no music is playing" to a fresh ear — players will ask "왜 BGM이 안깔리지?" before the denser bands ever arrive. Drum-only is fine as a ≤ 1-bar intro tag, not as the dominant texture of bars 1–6. *(Surfaced 001-void-pulse sprint 52 — see `audio/synced-bgm.md` § "Sounding like music, not a metronome".)*

<!-- added: 2026-04-17 (001-void-pulse sprint 2) -->

## Felt timing (perception, not correctness)

A correctness pass says "it works." A felt-timing pass asks "does it feel fair?" For any game with speed-varying entities:

- [ ] **Judge windows expressed in ms, not px** — if `speedAt(t)` ramps entity velocity, then a pixel-based judge window shrinks invisibly with time. Scan for `Math.abs(r - TARGET) <= PX_CONSTANT`; convert to `|d|/speed*1000 <= MS_CONSTANT`.
- [ ] **Judge target = visual "live" highlight** — if you highlight pulse X but judge pulse Y when the player taps, it feels stolen. One query (e.g. nearest-to-target) used for both render and judging.
- [ ] **Speed-sweep playtest at t=0, t=45, t=90** — manually verify perfect taps register at each waypoint. Sub-20ms windows are effectively unhittable at any speed.
- [ ] **Tension / telegraph lead-time constant in ms** — pixel-based telegraph thresholds arrive earlier early-game and later late-game. Use `toArriveMs <= LEAD_MS` instead.
- [ ] **Auditory rhythm anchor present** — for any tap-timing game, is there a spawn-time sound? Pure visual is fatiguing past 60s.
- [ ] **Combo visible at any count** — HUD shouldn't hide the streak when combo ∈ [1, 4]. Show the count even before the multiplier activates.
- [ ] **Per-entity locked speed + "oldest" judge = overtake bug** — if `entity.speed = speedAt(spawnT)` and later spawns are faster, newer entities overtake older ones. "Judge oldest" then disagrees with the player's spatial visual model. Judge nearest-to-target instead.

<!-- added: 2026-04-17 (001-void-pulse sprint 3) -->

## Multi-perspective sweep

Correctness passes miss whole bug classes. Every QA session should rotate through these five perspectives:

### Player / QoL
- [ ] Mute toggle present and persisted across reloads
- [ ] Keyboard parity — Space/Enter mirror tap; works without a pointing device
- [ ] Early-tap anticipation isn't punished (bounded-lead grace window)
- [ ] Focus behavior sensible — pressing Space with a button focused doesn't double-fire the game action

### Mobile / Visual
- [ ] Canvas is DPR-aware — backing store sized to `W×dpr` (capped at 2×), not blurry on retina
- [ ] `pointerdown.preventDefault()` on canvas prevents long-press context menu / text selection
- [ ] `touch-action: none` on canvas (no scroll hijack on mobile)
- [ ] HUD overlays (mute button, stats) are reachable by thumb on small screens
- [ ] **Every tappable element ≥ 44 × 44 CSS px** (iOS HIG / Android Material). Audit `.btn`, `.icon-btn`, share/reset/export pills, theme swatches, link-styled buttons, and any `<p tabindex="0" role="button">` text-as-button. *(See `mobile/tap-target-audit.md` for the 5-step framework + Recipe A/B fixes.)*
- [ ] **Touch gesture defenses present.** `html, body { overscroll-behavior: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; user-select: none }`. Buttons + non-canvas tappables have `touch-action: manipulation`. Non-`<button>` overlays (`<div>` w/ pointerdown) call `e.preventDefault()` + check `e.isPrimary`. *(See `mobile/touch-gesture-audit.md` for the seven-conflict catalog.)*
- [ ] **Boot-error fallback installed** at the top of `game.js` before the main IIFE. `window.addEventListener('error')` + `unhandledrejection` render an inline-styled overlay with a Reset & Reload button (clears storage + strips query string). *(See `data/boot-error-fallback.md`.)*

### Onboarding
- [ ] First 5s is visibly easier than the "intro" waypoint — new players get 2–3 free taps before difficulty kicks in
- [ ] Game readable in < 60s without any tutorial text
- [ ] Hook line on the title screen explains the input in one sentence

### Retention
- [ ] Run-end panel shows 2–4 orthogonal stats beyond raw score (streak, precision, volume)
- [ ] NEW BEST badge is gated — suppressed on the first-ever score to avoid trivial hype
- [ ] Retry path is ≤ 3s from death
- [ ] Best score persisted in localStorage (try/catch for Safari private mode)

### Distribution
- [ ] Favicon present (inline SVG, no external file)
- [ ] `<meta name="theme-color">` matches the game's dominant background color
- [ ] OG meta tags (`og:title`, `og:description`, `og:type`) on the landing page
- [ ] Page title differentiates between landing ("GameCompany") and individual game ("void-pulse — GameCompany")
