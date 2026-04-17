# Skill — State-Tinted Animation via `data-*` + Custom Property

<!-- added: 2026-04-17 (001-void-pulse, sprint 39) -->

**When to use:** you've got a recurring visual effect (beat pulse, progress tick, damage flash, combo glow) and you want its color to follow **runtime game state** (music band, health tier, difficulty tier, power level) — without branching in JS or duplicating keyframes.

The idea: the animation's colors come from a CSS custom property. The JS flips a `data-*` attribute. The CSS declares per-state overrides of the custom property. One keyframe, many palettes, zero JS color logic.

Pairs with:
- `graphics/css-animation.md` — the keyframes you'll tint
- `ux/theme-picker.md` — themes define the source palette (`--fg`/`--accent`/`--highlight`); `--beat-tint` / `--tier-tint` / etc. just select between them
- `graphics/beat-indicator.md` — the void-pulse beat ring is the original case study

## Contract

- **Animation reads one (or few) CSS custom properties** — `var(--beat-tint)` / `var(--tier-tint)`. The keyframe doesn't hardcode colors; it references the tint variable. Color-mix compositions are fine (`color-mix(in srgb, var(--tint) 35%, transparent)`) as long as the tint is the varying part.
- **State is communicated via `data-*` attribute on the animating element** — e.g. `data-band="climax"`, `data-tier="peak"`. Not a class (classes are free-form; `data-*` carries semantic intent for a *single* state axis).
- **CSS declares the mapping** — `[data-band="warm"] { --tint: var(--fg) }`, etc. The mapping lives in CSS next to the animation, not scattered across JS.
- **JS only touches the attribute** — single source of truth: `el.dataset.band = band`. No style mutation, no classList.add of color-classes, no inline color strings. JS stays out of the color pipeline.
- **Only update the attribute when it changes** — guard with a `lastState` variable. Repeated sets of the same value are cheap but create unnecessary CSS work (and can disrupt transition timelines on registered properties).
- **The tint variable falls back to a theme palette color** — not a raw hex. `--beat-tint: var(--accent)` keeps the whole system theme-aware for free. Switch theme → all tints re-resolve.

## Pattern

### CSS — one keyframe, per-state tint overrides

```css
#beat {
  /* Default tint = theme accent. Per-band overrides below swap it out. */
  --beat-tint: var(--accent);
}
/* Calm intro — neutral white */
#beat[data-band="warm"],
#beat[data-band="easy"] { --beat-tint: var(--fg); }
/* Tense mid-run — themed accent (same as default; explicit for clarity) */
#beat[data-band="mid"],
#beat[data-band="hard"] { --beat-tint: var(--accent); }
/* Climax peak — highlight (gold in most themes) */
#beat[data-band="climax"] { --beat-tint: var(--highlight); }
/* Out / resolve — themed accent */
#beat[data-band="out"] { --beat-tint: var(--accent); }

#beat.pulse-accent .beat-dot {
  animation: beatPulseAccent 520ms ease-out;
}
@keyframes beatPulseAccent {
  0%   { background: color-mix(in srgb, var(--beat-tint) 35%, transparent); }
  14%  { background: var(--beat-tint);
         box-shadow: 0 0 18px color-mix(in srgb, var(--beat-tint) 75%, transparent); }
  100% { background: color-mix(in srgb, var(--fg) 28%, transparent); }
}
```

### JS — flip the attribute, nothing else

```js
let lastBand = null;
function tickBeatIndicator() {
  // ... compute current beat/bar from game time ...
  const band = BAND_SCHEDULE[barIdx];
  if (band !== lastBand) {
    beatEl.dataset.band = band;   // CSS does the rest
    lastBand = band;
  }
  // ... animation trigger (class toggle + reflow) stays unchanged ...
}
function resetBeatIndicator() {
  lastBand = null;
  beatEl.removeAttribute('data-band');   // back to default tint
}
```

## Why `data-*` and not classes?

Classes are for *presence* ("is pulsing", "is selected"). `data-*` is for *value* (which-of-N state).

With classes you'd either:
1. Spray many color-classes (`band-warm`, `band-easy`, ...) — combinatoric and you have to remove the old one before adding the new.
2. Use one class + inline style for color — now your color pipeline leaks into JS.

With `data-band`, the value is a single string; assigning overwrites the prior value automatically. And the semantic intent ("this element has a band value") is carried by the attribute name, not by a naming convention on classes.

## Why CSS custom property and not keyframe-per-state?

Without custom properties, you'd need `@keyframes beatPulseWarm { ... var(--fg) ... }`, `@keyframes beatPulseClimax { ... var(--highlight) ... }`, etc. And a class per state to pick the keyframe.

With custom properties, *one* keyframe references `var(--tint)` and the variable is re-resolved at animation start based on where the element sits in the cascade. Each `[data-band=...]` rule overrides the variable. One keyframe, N palettes.

This also means: **the animation auto-theme-swaps.** `--accent` changes at `:root` → `--beat-tint` (= `var(--accent)`) re-resolves → the next pulse uses the new accent. No animation rewrite.

### When you DON'T need the custom-property indirection

If the state-tint lands directly on a property you can override per-state (e.g. `color:` on the element itself), skip the custom-property step and override the property directly:

```css
#combo              { color: var(--accent); transition: color .22s ease; }
#combo[data-tier="mid"]  { color: color-mix(in srgb, var(--accent) 40%, var(--highlight)); }
#combo[data-tier="peak"] { color: var(--highlight); }
```

The custom-property indirection is only needed when the tint has to pass into a context you can't override per-state — a keyframe, a pseudo-element's color, a multi-property composition (`box-shadow` + `background` both using the same varying color). For simple "one state → one property value," direct override is shorter and clearer.

**Rule of thumb:** if your tint appears in exactly one CSS property declaration on the element, direct-override. If it appears in 2+ places or inside an `@keyframes`, introduce `--tint` and reference it from all the uses.

## Tuning

- **Collapse adjacent states that should look the same.** If `warm` and `easy` both read as "calm intro," map them to the same tint. Don't invent 5 tints for 5 states if only 3 semantic tiers exist. The void-pulse mapping collapses 5 bands → 4 visual states (warm/easy → neutral; mid/hard → accent; climax → peak; out → accent).
- **Boundary transitions are instant.** Custom properties don't transition without `@property` registration. That's usually fine: the state change happens between pulses, so the user sees the new tint on the *next* pulse. A clean "visual punctuation" at the boundary.
- **Keep the base (non-pulse) state neutral.** In `#beat .beat-dot { background: var(--fg) ... }` — i.e. the dot color when no animation is playing uses `--fg`, not `--beat-tint`. Reason: the static state should look the same for all bands so the *pulse* is what carries the signal. Tinting the static state too dilutes the effect.

## Interaction with reduced-motion

- If reduced-motion disables the animation (`animation: none`), the tint has nowhere to show — the static dot stays neutral. That's usually correct: users who opt out of motion don't want *color-change-over-time* either.
- If you want reduced-motion users to still see the band (static tinted ring, no animation), override the base state conditionally:
  ```css
  @media (prefers-reduced-motion: reduce) {
    #beat[data-band="climax"] .beat-dot {
      background: color-mix(in srgb, var(--beat-tint) 45%, transparent);
    }
  }
  ```
  But note: if the attribute changes between bars, the static color changes too, which *is* motion-ish (color shift). Only worth it when the state change is rare (once per 10+ seconds).

## Anti-patterns

- **Hardcoded colors in the keyframe.** `@keyframes beatPulseAccent { ... background: cyan; ... }` — fights the theme system, forces you to duplicate keyframes per state.
- **Inline style writes from JS.** `el.style.background = '#ffcc00'` — leaks color decisions into JS and breaks theme swap.
- **Classname-per-state without single-axis discipline.** `el.classList.add('band-climax')` then forgetting to remove `band-hard` first → element has both classes, CSS cascade order picks one arbitrarily. `data-*` is single-valued by construction.
- **Updating the attribute every frame.** Even if the value doesn't change, writing `el.dataset.x = v` every frame is O(n) wasted work. Guard with `lastState !== newState`.
- **Tinting the static dot *and* the pulse.** If both states use the tint, the signal is always-on and loses its "this just changed" effect. Keep static neutral; let the pulse carry the state color.

## Other applications

- **Combo tier tint** — `data-tier="bronze" | "silver" | "gold"` on the combo HUD; tint color-mixes a glow halo.
- **Health band** — `data-health="full" | "low" | "critical"` on the player sprite / HUD; tint the damage-flash keyframe.
- **Power-up tier** — `data-power="none" | "active" | "extended"` on the ring; tint a ring glow.
- **Day/night cycle** — `data-tod="dawn" | "day" | "dusk" | "night"` on the backdrop wrapper; tint ambient particle color.
- **Peak-tier ambient on the page wrapper** — `data-tier="peak"` on `#app`; tint a `::after` edge-vignette in the theme highlight color. Completes a tier-reinforcement trio with a HUD text tint and an audio pitch shift. See "Binary-gated application" below.

## Binary-gated application (peak-only ambient)

<!-- added: 2026-04-17 (001-void-pulse sprint 45) -->

The canonical pattern is N-way (low/mid/peak, warm/easy/hard/climax). But sometimes you want a tier to only *register* at one end — e.g. an ambient background effect that fires *only* at peak, not at every intermediate tier. The reason: atmosphere scales nonlinearly. An ambient glow at every tier dilutes the signal; an ambient glow *only at peak* creates a distinct "you crossed the threshold" moment that reinforces the HUD text tint without competing with it.

For binary gating, write the mirror in JS like this:

```js
if (tier === 'peak') appEl.dataset.tier = 'peak';
else appEl.removeAttribute('data-tier');
```

Instead of:

```js
// DON'T — propagates all tiers to the ambient wrapper
if (tier === null) appEl.removeAttribute('data-tier');
else appEl.dataset.tier = tier;
```

The attribute is absent for low/mid, present only at peak. CSS selector:

```css
#app::after {
  /* Ambient vignette — fades in only when data-tier="peak" applied */
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(ellipse at center, transparent 55%,
              color-mix(in srgb, var(--highlight) 22%, transparent) 100%);
  opacity: 0;
  transition: opacity .5s ease;
  z-index: 4;                    /* above stage, below HUD */
}
#app[data-tier="peak"]::after {
  opacity: 1;
  animation: peakAmbientPulse 3.6s ease-in-out infinite;
}
@keyframes peakAmbientPulse {
  0%, 100% { opacity: .85; }
  50%      { opacity: 1; }
}
```

### Why `::after` with `opacity: 0` transition, not `display: none`

The element is always in the DOM-rendered tree; its opacity animates from 0 to 1 when the attribute appears. That gives us a smooth fade-in when the player hits peak, and a smooth fade-out when they lose the combo. `display: none` → `display: block` would flip instantly (can't animate `display` reliably), jarring against the soft visual.

### Reduced-motion: keep the effect, drop the animation

The peak-state *should* be visible even with reduced-motion — color-state is information, not motion. What we remove is the breathing animation:

```css
@media (prefers-reduced-motion: reduce) {
  #app[data-tier="peak"]::after { animation: none !important; opacity: 1; }
}
```

Still-image vignette conveys "you're at peak" without the gentle pulse that might trigger vestibular discomfort.

### Pairing with multi-tier tints on the same axis

You can run N-way tint on one element and binary-gate on another, sharing the same state axis. void-pulse does this:

- `#combo[data-tier="low|mid|peak"]` — 3-way color tint on the HUD text (sprint 41)
- `#app[data-tier="peak"]` — binary peak-only ambient (sprint 45)
- `Sfx.levelup(tier)` — 3-way pitch shift on audio (sprint 43)

Three disciplines, same state axis, calibrated intensities: the HUD text changes every tier (high-frequency signal, low visual cost), the audio shifts every tier (ear-channel redundancy), and the ambient fires only at the top (atmospheric reward, doesn't dilute the HUD signal). Each channel is tuned to its own noise floor.

The lesson: **not every tier needs to propagate to every visual surface.** Pick the right gating per-surface based on whether the surface can carry continuous progression without becoming noisy.

## Cost

- JS: ~3 lines (lastState var, guarded set, reset on cleanup)
- CSS: 1 default declaration + N state overrides (5-line table per animation)
- Animation: 0 keyframe duplication regardless of state count
- Runtime: 1 attribute write per state change (not per frame)
- Theme interaction: free — tints resolve through the theme cascade automatically

## Verifying it works

1. Enter each state in turn (cycle through bands / damage tiers / combo tiers): the next animation pulse uses the new color.
2. Swap theme mid-state: the current tint re-resolves to the new theme's palette. No stale color.
3. Reduced-motion: pulse animations stop, static dot stays neutral (or tinted-static if you added the opt-in override).
4. State churn: rapid transitions don't leave stale attribute values; the attribute always reflects current state.
5. Theme-picker correctness: `data-band="climax"` + dark theme → gold; + pastel theme → pastel-gold. Single source of tint truth flows through.
