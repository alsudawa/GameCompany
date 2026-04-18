# Skill — `prefers-reduced-motion` audit sweep

**When to use:** any casual/arcade game that has accumulated animations across many sprints, especially after 30+ sprints of juice/polish work. Initial reduced-motion coverage tends to be complete for the original feature set, but every subsequent juice pass adds motion that silently drifts past the guard unless someone explicitly re-audits.

The problem is structural: a sprint that adds "a little bounce" or "a particle poof" usually gets one or two reviewers asking "is it fast? is it on-theme? does it feel good?" — nobody asks "does it pass the motion-sensitivity gate?" unless that's the sprint's explicit focus. Multiply across 40 sprints and you have drift.

This doc is the framework for that explicit-focus sprint.

## What `prefers-reduced-motion: reduce` actually requests

The media query fires when the user has asked their OS to reduce motion. Common reasons:
- **Vestibular disorders** (BPPV, Ménière's, vestibular migraine): large or rapid motion triggers vertigo / nausea.
- **Attention-focus preferences**: some users with ADHD/autism describe motion as a sensory distraction that pulls focus from content.
- **Cognitive/physical fatigue**: motion-heavy interfaces feel exhausting.
- **Battery / perf**: some users set it globally to reduce CPU/GPU load on older hardware.

Rule of thumb for what to disable:
- **Large translate, parallax, swooping panels, spinning rotations** → always disable or drastically reduce.
- **Scale transforms > ~1.1x on visible elements** → disable.
- **Infinite oscillations** (breathing, pulsing, floating) → disable or freeze at a stable pose.
- **Particles/confetti/fireworks** → dampen or skip velocity integration; keep a fade-out if the burst is *functional* feedback.
- **Long opacity transitions (>.3s)** → shorten or keep (low risk).
- **Short color/background transitions (<.2s)** → generally safe to keep.
- **Functional progress bars** (loading, combo fill) → keep; the movement conveys essential state.
- **Haptics / vibration** → disable unconditionally. Reduced-motion *implies* reduced haptics even though the spec scopes only visual motion; motion-sensitive users don't want surprise buzzes either.

## The four-layer audit

Motion in a typical web game lives in **four distinct layers**, each with its own guarding mechanism:

### Layer 1 — CSS `@keyframes` + `animation:` properties

The most obvious layer. For each `@keyframes` block, find every element that references it and confirm a `prefers-reduced-motion: reduce` media rule sets `animation: none !important;` on that selector.

Audit command:
```bash
grep -n '^@keyframes' style.css                  # list all animations
grep -n 'animation:' style.css                   # list all selectors using them
grep -n 'prefers-reduced-motion' style.css       # list all guards
```

Cross-check: every `animation:` selector should appear (directly or via a parent class) in at least one reduced-motion block.

Gotcha: `animation: none` doesn't cancel `transition:` on the same element. A selector might have both — guard both separately.

### Layer 2 — CSS `transition:` properties

Sneakier than `animation:`. `transition:` fires on state changes, not on its own, so devs often think "it's only a tap response, not an animation." But a 220ms transform translate *is* motion to a vestibular-disorder user.

Audit each `transition:` line for the properties it covers:
- `transition: opacity .2s` — almost always safe to keep.
- `transition: color|background|border-color .15s` — safe.
- `transition: width .14s` — usually safe (progress bars).
- `transition: transform .2s` — **audit target**. Any scale/translate needs a reduced-motion override.
- `transition: all .15s` — **red flag**. Explicit or implicit `all` catches every future property you add. Prefer listing explicit properties.

Override pattern for transform transitions:
```css
.toast {
  transform: translate(-50%, -18px);
  transition: opacity .22s, transform .22s;
}
.toast.visible { opacity: 1; transform: translate(-50%, 0); }
@media (prefers-reduced-motion: reduce) {
  .toast { transition: opacity .18s linear; transform: translate(-50%, 0); }
  .toast.visible { transform: translate(-50%, 0); }
}
```

Note: the override fixes the transform to its final position for BOTH hidden and visible states, so the element appears/disappears via opacity only.

### Layer 3 — JavaScript-driven DOM motion

`element.style.transform = ...` in a rAF loop, `animate()` / Web Animations API calls, or libraries like GSAP. The CSS audit catches none of these.

Pattern:
```js
let reducedMotion = typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;
try {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  const onChange = (e) => { reducedMotion = e ? e.matches : mq.matches; };
  if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange);
  else if (typeof mq.addListener === 'function') mq.addListener(onChange);
} catch {}

function animateBounce(el) {
  if (reducedMotion) { el.style.transform = 'none'; return; }
  // ... actual animation ...
}
```

- **`let` not `const`** — the MQL listener pattern needs to mutate. If you ship with `const`, you've gated on page-load preference only and OS toggles mid-session don't propagate.
- **Listener MUST fall back to `addListener` (Safari <14)** — the pattern has been standard since 2017 but `addEventListener` on MediaQueryList is from 2020.
- **All callers re-read the variable** — don't capture a snapshot in a closure. Every call site checks the current value.
- **Don't fire an initial change event manually** — the `let` already has the initial value; the listener fires on subsequent flips.

### Layer 4 — Canvas / WebGL render-loop motion

The hardest layer to audit because motion lives in math, not declarative properties. A `ctx.scale(popScale, popScale)` where `popScale = 1 + timeSinceHit * 1.4` is motion — there's no `@keyframes` to grep for.

Audit approach: grep the JS for render-related math operations that change over time:
```bash
grep -n 'ctx\.scale\|ctx\.rotate\|ctx\.translate' game.js
grep -n 'state\.\w*T\b' game.js                # juice/pop timers
grep -n 'particles\|ambient' game.js
```

For each time-varying value that feeds a visual render, add a reducedMotion check:

```js
// BEFORE
const popScale = 1 + state.hitPopT * 1.4;

// AFTER
const popScale = reducedMotion ? 1 : (1 + state.hitPopT * 1.4);
```

**Particles deserve special treatment** — they're often functional feedback (confetti *says* "you scored"). Don't skip them entirely; skip the velocity integration instead:

```js
function updateParticles(dt) {
  const skipMotion = reducedMotion;
  for (const p of particles) {
    if (!p.active) continue;
    if (!skipMotion) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += GRAVITY * dt;
    }
    p.life -= dt;
    if (p.life <= 0) p.active = false;
  }
}
```

Paired with a spawn-side reduction:
```js
function spawnBurst(x, y, color, n, speed) {
  if (reducedMotion) { n = Math.max(1, Math.ceil(n / 2)); speed = 0; }
  // ... existing spawn logic ...
}
```

Result: particles appear at the hit location, fade over the same duration, but don't fly outward or fall under gravity. Feedback preserved, motion removed.

## Decision rubric — what to keep vs. what to skip under reduced-motion

For each piece of motion, answer three questions:

| Question | If yes → | If no → |
|---|---|---|
| Is the motion *functional* (communicates essential state like progress, pulse timing, loading)? | Keep. Maybe shorten. | Candidate for removal. |
| Does the motion cover a large viewport area (>30% screen) OR move fast (>~60% of dim per second)? | Disable under reduced-motion. | Audit magnitude. |
| Is there an *alternative* channel conveying the same info (audio, text, color change, icon swap)? | Safe to skip motion — alternative carries signal. | Keep a minimal motion variant; removing entirely leaves no ack. |

Common keep-but-reduce patterns:
- **Hit-confirmation particles** — skip velocity, keep fade (feedback signal preserved, motion eliminated).
- **Tier-change ambient tint** — keep the tint (static background color change), skip the breathing animation.
- **Start button pulse** — replace with a static outline ring; the outline still says "primary CTA" without oscillation.
- **Achievement toast slide-in** — change transform-based slide to opacity fade; the toast still announces without kinetic motion.
- **First-visit gold tint** — keep the tint, drop the pulse.

Common never-touch patterns:
- **Pulse/target-ring in a rhythm game** — the ring expanding IS the core mechanic. Disabling it breaks gameplay.
- **Progress bars** — filling is information, not decoration.
- **Beat dots in a rhythm grid** — might be gameable; keep.
- **Tutorial arrows/demo loop** — if the demo can be replaced with a static end-state (successful tap frozen on-screen), good; if not, keep with comment explaining why.

Common always-kill patterns:
- **Parallax, 3D tilt, scroll-coupled transforms** — never acceptable under reduced-motion.
- **Auto-spinning loaders when a static spinner would do** — replace.
- **Full-screen fade/whoosh transitions between screens** — snap-cut instead.
- **Infinite decorative oscillations** (breathing, pulsing borders on non-CTA elements) — freeze.

## Live preference changes (Layer 3 detail)

Users toggle `prefers-reduced-motion` via OS settings rarely mid-session, but the cost of supporting it is near-zero and the UX is consistent with other system-preference-reactive code (theme switching, contrast mode). The pattern mirrors prefers-color-scheme:

```js
const mqMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
mqMotion.addEventListener('change', (e) => { reducedMotion = e.matches; });
```

Where the flag is read (per-frame in canvas loops, per-call in particle emit, per-call in haptic), the new value propagates automatically. No cleanup needed — the listener lives for the document's lifetime.

Don't try to also cancel in-flight CSS animations — the CSS `@media` block already handles CSS-driven motion reactively (browsers re-evaluate media queries on preference change and re-apply rules). Your JS listener is only needed for the JS-driven motion layer.

## Common audit mistakes

- **Auditing only `@keyframes`** — CSS transitions get forgotten because they don't have a declaration name. Grep `transition:` separately.
- **Assuming `transition: all` is safe** — it catches every future transform you add, silently.
- **Using `const` for the reduced-motion flag** — locks in page-load preference. User's OS toggle doesn't propagate.
- **Forgetting Safari <14 `addListener`** — breaks on older iOS. Always ship both paths.
- **Snapshot-at-call-time in closures** — captures the old value; callers don't see updates. Re-read each call.
- **Skipping particles entirely** — removes functional feedback. Dampen (count-halve, velocity-zero) instead.
- **Disabling progress bars** — treats essential info as decoration. Keep.
- **Shipping the reduced variant with *less* information** — if the default shows a score pop via scale+color, the reduced variant should still show the color (just not the scale).
- **Testing only via devtools emulation** — real OS toggles sometimes behave differently (especially on iOS). Check both.
- **Not testing the transition back from reduce-to-no-reduce** — if you snapshot state into CSS at page load, a live listener fix won't help; verify round-trip.

## Sprint-cadence suggestion

Run a reduced-motion audit **every 20 sprints of juice/polish work**. Motion drift accumulates at roughly one new unguarded motion per 3-4 animation-adding sprints in a typical casual-game codebase; by sprint 20 you have 5-7 small gaps. Individually invisible, collectively meaningful. Batch them into one re-audit sprint rather than asking every juice sprint to carry the reduced-motion burden — the concentrated pass catches more because the reviewer's entire attention is on the axis.

The same pattern applies to other accumulating a11y axes: screen-reader announcements, focus management, color contrast. Each deserves its own periodic re-audit sprint. Sprint 47 of void-pulse did this for SR announcements; Sprint 49 does it for reduced-motion.

<!-- added: 2026-04-18 (001-void-pulse sprint 49) -->
