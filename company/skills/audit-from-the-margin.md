# Skill — Audit from the Margin (the meta-discipline)

<!-- added: 2026-04-18 (001-void-pulse, sprint 58) -->

**When to use:** every 20 sprints, OR when the sprint rotation has been chasing the same axis for 3+ sprints in a row, OR when starting a new game and pulling forward this folder's discipline. This is the *meta*-skill that names the family eight individual audits all belong to, codifies their shared structure, and provides a template for adding the ninth.

> **The thesis.** *The dev's environment is the most generous environment in the player population.* The dev's localStorage is well-formed; the dev's hands hit 36px buttons accurately; the dev's M-series Mac never drops a frame; the dev's tab is always foregrounded; the dev never tampers with `?seed=…`. Every player at the margin — corrupt-state machines, low-end Androids, mobile thumbs, screen readers, reduced-motion settings, low-vision zoom, sub-44px-tap precision, slow networks, vestibular disorders — has a worse experience by default. The audit family is the systematic counter to this asymmetry: each audit pulls the dev's vantage point toward a less-privileged user and asks *"can they still play?"*

This skill is *the* meta-pattern under which all the periodic audits in this folder operate. Rest of this doc:
1. The current audit family (eight members, growing)
2. The shared 5-step audit shape every member implements
3. The 20-sprint cadence and why it works
4. The "prevent vs recover" pair pattern (two audits often complement)
5. A template for adding the ninth audit
6. Anti-patterns: when "audit fatigue" creeps in

## The current audit family (10 members as of Sprint 60)

| # | Audit | What's at the margin | Lens / period |
|---|---|---|---|
| 1 | [`ux/reduced-motion-audit.md`](ux/reduced-motion-audit.md) | Vestibular disorders, prefers-reduced-motion users | Visual / 20 sprints |
| 2 | [`ux/keyboard-flow-audit.md`](ux/keyboard-flow-audit.md) | Keyboard-only users, switch-control, no-pointer | Input / 20 sprints |
| 3 | [`ux/screen-reader-announcements.md`](ux/screen-reader-announcements.md) (the SR-coverage audit aspect) | Blind / low-vision SR users | Audio / 20 sprints |
| 4 | [`ux/focus-visible-audit.md`](ux/focus-visible-audit.md) | Keyboard users (focus-ring coverage) | Visual / 20 sprints |
| 5 | [`qa/casual-checklist.md`](qa/casual-checklist.md) | Generic out-of-the-box player + multi-perspective sweep | Holistic / per-ship |
| 6 | [`data/persistence-defensiveness.md`](data/persistence-defensiveness.md) | Tampered / corrupt localStorage on player's machine | Data / 20 sprints |
| 7 | [`mobile/tap-target-audit.md`](mobile/tap-target-audit.md) | Thumbs on small screens (44px floor) | Mobile box-model / 20 sprints |
| 8 | [`mobile/touch-gesture-audit.md`](mobile/touch-gesture-audit.md) | Mobile players whose OS competes with the game for input | Mobile input-stack / 20 sprints |
| 9 | [`ux/cognitive-load-audit.md`](ux/cognitive-load-audit.md) | Brand-new players in the first 3 seconds (no frame of reference for chrome) | Onboarding / 20 sprints |
| 10 | [`ux/microcopy-audit.md`](ux/microcopy-audit.md) | Readers who hear voice drift but can't name it (accumulated tone patchwork over N sprints) | Writing / 20 sprints |

Companion: [`data/boot-error-fallback.md`](data/boot-error-fallback.md) — not an audit *per se* but the recovery layer for cases where audit-1-through-10 prevention all fails.

The list **will grow.** Likely future additions: color-contrast audit (carried from Sprint 51), network-resilience audit (offline/slow-3G), low-end-device perf audit (sub-60Hz throttled CPU), localization-readiness audit (string-extract surface).

## The shared 5-step audit shape

Every audit in this folder, *whether explicitly written that way or not*, follows the same five steps. Sprints 53/54/55/56/57 each refined this template until the shape became reusable. **Use it for any new audit.**

### Step 1 — Enumerate

A grep, a file walk, or a DOM-node listing. The output is a list of *concrete sites* the audit targets. Examples:
- Persistence: `grep -n 'localStorage\.\(get\|set\)Item\|JSON\.\(parse\|stringify\)' game.js`
- Tap-target: `grep -nE '<button|<a |role="button"|tabindex="0"' index.html`
- Touch-gesture: `grep -nE "addEventListener\\(['\"]?(click|pointerdown)" game.js`
- Reduced-motion: every `@keyframes`, every `transition:`, every JS DOM/canvas animation
- Keyboard-flow: tab through every modal + start screen + game-over with hands off the mouse

If you can't enumerate, you can't audit. The first move of every new audit is "what's the grep?"

### Step 2 — Score each site against a fixed rubric

A small set of checks, ideally yes/no per site. Examples:
- Persistence (5 questions): JSON.parse safe? shape valid? scalar types? in-range? per-element validation?
- Tap-target (1 question): both axes ≥ 44px regardless of content?
- Touch-gesture (per element): is `touch-action` declared? is `e.isPrimary` checked? is `preventDefault` called?

Use ✅ / ⚠ / ❌ markings. **Promote ⚠ to ❌** for fix-list purposes — borderline cases are tomorrow's regressions.

### Step 3 — Build the table (in your head, in the postmortem, or in a spreadsheet)

| Site | Current state | Score | Action |
|---|---|---|---|

The table is the audit's deliverable as a *snapshot* — even if you fix every ❌ this sprint, the snapshot is the proof you ran the audit. It's also what makes "audit drift" visible: comparing this sprint's snapshot to the one from sprint N-20 shows you which sites regressed.

### Step 4 — Apply the standard fix recipe

Each audit has 1-3 standard fixes (NOT one fix per site — the recipes generalize). Examples:
- Persistence: try/catch wrapper + typeof guard + Number.isFinite + Array.isArray + per-element filter (5 templates)
- Tap-target: Recipe A (bump width/height for icon buttons), Recipe B (min-height: 44 + flex centering for text/pill buttons)
- Touch-gesture: standard CSS block + standard JS pattern (~17 lines total)

If a site doesn't fit any recipe, *that's information* — it means the audit's recipes need extending or the site is a special case worth documenting.

### Step 5 — Verify the side-effects

Audits often touch shared infrastructure (e.g. bumping `.icon-btn` size shifts the help-button's `right:` offset). Step 5 is the rechecking pass: any neighbor of a fixed site, anything that depended on the old behavior, anything that imports the affected selector, gets re-walked.

The postmortem section then captures: ran audit N at sprint M, found X failures, applied Y fixes, verified Z side-effects.

## The 20-sprint cadence — and why it's not arbitrary

Three forces converge at ~20 sprints:

1. **Sprint count grows the surface.** Each sprint adds ~1-3 new persisted values, interactive elements, animations, etc. After 20 sprints the surface roughly doubles from when the audit was last run. New code added without auditing-discipline is the highest-drift territory.

2. **Audit fatigue resets.** Daily audits would be tedious; quarterly audits would let too much rot. 20 sprints (~4-6 weeks at 3-5 sprints/week) is the sweet spot — recent enough to remember the last pass, distant enough that the surface has materially changed.

3. **The audit family naturally rotates.** With 8 audits at 20-sprint cadence, you're running ~one audit every 2-3 sprints on average if you stagger them. Add the per-sprint variety lens (perf one sprint, mobile next, audio next), and the rotation feels natural, not forced.

When to run an audit *off-cadence*: any sprint that adds a new instance of the audit's category. Adding a new persisted value? Run the persistence audit (just on the new key). Adding a new button? Spot-check the tap-target floor. The 20-sprint sweep catches drift in *older* code; the per-sprint spot-check catches drift in *new* code.

## The prevent-vs-recover pair pattern

Audits sometimes come in deliberate pairs — one that *prevents* a class of failure, one that *recovers* if prevention fails. The pair pattern is itself a discipline, not coincidence.

| Axis | Prevent (Layer 1) | Recover (Layer 2) |
|---|---|---|
| Data | `data/persistence-defensiveness.md` (defensive reads at every site) | `data/boot-error-fallback.md` (fallback overlay for any throw past prevention) |
| Mobile input | `mobile/tap-target-audit.md` (44px floor — finger can land on the button) | `mobile/touch-gesture-audit.md` (`isPrimary` filter + `preventDefault` — once it lands, OS doesn't steal the tap) |
| Audio | `audio/web-audio-scheduling.md` (pre-schedule at `ctx.currentTime + delay`) | `audio/sidechain-duck.md` (anchor-current-value on overlap, never assume baseline) |

The principle: **each prevent-layer covers ~95% of the failure mode; the recover-layer catches the residual 5% AND gives the player explicit agency** (Reset button, debounce, anchor-recovery). Together they convert "permanently broken" into "self-resolving with a small UI moment."

When you write a new audit, ask: **does this audit need a paired recovery layer?** If the prevention is brittle, or if the failure is silent, the answer is usually yes.

**No-pair audits are also fine** — and worth naming explicitly. The cognitive-load audit (member 9) is *prevent-only* because its failure mode is silent disengagement (player closes the tab) rather than a throw or a stuck state. There's nothing to "recover from" — the player's gone. For these audits the prevent layer must be more conservative (the rubric in `ux/cognitive-load-audit.md` defaults to *hide* on any "no" answer); there's no safety net beneath it.

## A template for the tenth audit (and eleventh, and twelfth…)

The ninth audit (cognitive-load, Sprint 59) was written using exactly this template — direct validation that the meta-pattern is reusable. When you find yourself thinking "we've never audited X" — three sprints in a row of the same lens, or a postmortem reflection that calls out a missing dimension — don't sit on it. The cost of writing the audit is one sprint. The cost of *not* having it is N sprints of accumulating drift on that axis.

Template skill structure (copy from any of the existing 8):

```markdown
# Skill — <Axis> Audit

<!-- added: <date> (<game-slug>, sprint <N>) -->

**When to use:** <when this category of code is added/changed, plus 20-sprint
periodic sweep>.

**Thesis paragraph.** <One paragraph on what's at the margin and why the dev
never sees the failure mode.>

## The N <failure modes / conflicts / shrink patterns>
<table>

## The audit — five steps
### 1. Enumerate
<grep / DOM walk / journey>
### 2. Verify each site against the rubric
<2-5 yes/no questions>
### 3. Score and table-ize
<scoring criteria>
### 4. Apply the standard fix recipe
<1-3 named recipes, code-cited>
### 5. Verify side-effects
<what neighbors get re-walked>

## Common gap patterns (search-and-fix list)
<red-flag / safe-replacement code pairs>

## When NOT to use
<edge cases — explicit non-applicability>

## Audit cadence
- Per sprint that touches <category>: spot-check
- Periodic full sweep every 20 sprints

## Cost
<one paragraph on the asymmetry: cheap audit, catastrophic non-audit>
```

The `<!-- added: ... -->` date-stamp + sprint-attribution is non-negotiable — it lets future-you trace the lineage of the discipline back to the specific sprint where the lesson was earned.

## Anti-patterns: how the audit family decays

Three failure modes for the meta-discipline itself:

### 1. "We just audited that"

A team doing daily-cadence audits will eventually skip a 20-sprint sweep because "we audited the new code as we wrote it." Spot-checking new code is necessary but **not sufficient** — the periodic sweep catches drift in *older* code that was added before the audit existed, or before the audit's recipes were updated. Always run the periodic sweep, even if everything looks fine.

### 2. Audit-as-checklist-theater

Filling out the table with ✅ everywhere because each row was scored at the same rapid pace. The audit's value is in the *individual* per-site judgment — fast-checking turns it into a ritual that misses the actual ⚠s. If you're auditing too fast (more than ~5 sites per minute on a non-trivial axis), slow down.

### 3. Audit creep into per-sprint work

Trying to run all eight audits every sprint. This is impossible at any reasonable pace and crowds out actual feature/improvement work. The 20-sprint cadence exists specifically so each audit gets a deep look once per cycle, not a shallow look constantly.

## How this meta-skill relates to per-game work

When starting a new game (002, 003, …), the producer should:
1. Skim this doc + the eight indexed audits
2. Bake the audit cadence into the project's sprint plan (e.g. sprint 5: persistence audit; sprint 10: tap-target; sprint 15: touch-gesture; sprint 20: reduced-motion + keyboard-flow + SR; sprint 25: cognitive-load — *especially* before the first external playtest)
3. Adopt the prevent-vs-recover pair discipline for the data + mobile-input axes from day one (the boot-error fallback in particular is ~80 lines and should be the first thing in `game.js`)
4. Add new audits to this folder when the new game surfaces axes the existing eight don't cover — e.g. a multiplayer game would surface a "network-state-resilience audit"; a turn-based game would surface a "save-state-transactionality audit"

The audit family is a *transferable asset* of the company, not a single-game artifact. Each new game inherits all eight + adds its own.

## Cost

This meta-skill itself: ~5 minutes per sprint to remember it exists, ~30 minutes per game-start to plan the audit rotation, ~30 minutes per new audit to write it up. Compared to the alternative (each game re-deriving the audit shape from scratch, eight times, with no shared template), the asymmetry is overwhelming.

The audit *family*: ~1 sprint of dedicated time per audit, 10 audits, run every 20 sprints. That's roughly 10 sprints out of every 200 (5%) spent on cross-cutting audits. The remaining 95% is feature work, polish, and per-sprint axis variety. The 5% is what keeps the 95% from collapsing under accumulated drift.
