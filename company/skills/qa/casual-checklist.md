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
