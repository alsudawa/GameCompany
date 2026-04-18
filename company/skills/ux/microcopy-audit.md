# Skill — Microcopy / Tone Audit (the writing layer)

<!-- added: 2026-04-18 (001-void-pulse, sprint 60) -->

**When to use:** every 20 sprints, OR any sprint that adds ≥3 new user-facing strings (button labels, hints, announcements, achievement descs), OR before the first external playtest (a fresh reader is the best copy-editor you have). This is the **10th member** of the audit family in [`audit-from-the-margin.md`](../audit-from-the-margin.md) — covering the *writing* axis (distinct from cognitive-load's #9 *element-inventory* axis; microcopy assumes the elements are right and asks whether their words are right).

> **The thesis.** *The dev writes strings as they build features, one sprint at a time.* Sprint 5 adds "Game paused." Sprint 18 adds "void silenced." Sprint 32 adds "Got it." Sprint 47 adds "Close." Each string is fine in isolation. In aggregate they read as a patchwork of voices — some formal, some playful, some cryptic, some redundant — because no sprint was responsible for the *body* of the game's writing. The microcopy audit steps back from the per-feature view and reads every string as if it were a single document, then edits for one voice.

The key asymmetry: **the dev sees each string once, at authoring time.** The player sees the full corpus every session. Inconsistency that's invisible at authoring time is visible in play.

## The 7 microcopy drift patterns

These are the recurring shapes by which a game's writing loses coherence over N sprints.

| # | Pattern | Symptom | Standard fix |
|---|---|---|---|
| 1 | **Voice drift** | "Got it" (casual, friendly) alongside "Close" (utility, terse) on sibling modal dismiss buttons | Pick one voice per surface class (modals, announcements, errors); normalize. |
| 2 | **Tense / mood drift** | "Bonus life granted." (passive, formal) vs "New best!" (exclamation, active) in the same SR announce channel | Pick one mood per channel; announcements generally want active + warm. |
| 3 | **Parallelism break** | `announce(muted ? 'Sound muted.' : 'Sound on.')` — past-participle vs prepositional adverb, non-parallel | On/off pairs: match grammatical shape (`'Sound off.'` / `'Sound on.'`). |
| 4 | **Cryptic shorthand** | "Tapping it = miss + life" — `+` reads as add-a-life but means lose-a-life; math-op in prose | Replace arithmetic-operator shorthand with actual verbs ("Tap it and you lose a life"). |
| 5 | **Jargon leakage** | "chart length: ~60s fixed chart" — "chart" is a dev/rhythm-game term; most players parse it as weather-chart | Prefer natural language ("60-second run") over genre-internal jargon unless the genre is the pitch. |
| 6 | **Redundant phrasing** | "in a single run" vs "in a run" inconsistency across achievement descriptions; "chart length: ~60s fixed chart" (says chart twice) | Pick the shorter clear form; replace-all to consistent phrasing. |
| 7 | **Overloaded string** | "60-second chart, chase 100% accuracy" — comma-splice mashes two distinct ideas; eye rhythms break | Split into two sentences, OR re-order so the verb/CTA lands last. |

## The audit — five steps

### 1. Enumerate

Three grep-able sources. You want **every string**, not just the interesting ones:

```bash
# 1. HTML — static copy in elements
grep -nE '>[^<][^<]+<' index.html | grep -vE '(svg|path|g )' | head -80

# 2. JS — runtime strings assigned to textContent / innerHTML / aria-label
grep -nE "textContent\s*=\s*['\"\`]|innerHTML\s*=\s*['\"\`]|setAttribute\(['\"]aria-label['\"]\s*," game.js

# 3. JS — announce() / alert() / title() / share() calls
grep -nE "announce\(['\"\`]|navigator\.share\(|\.title\s*=\s*['\"\`]" game.js
```

Dump the results into a flat list. For void-pulse this produced ~60 distinct user-facing strings across HTML static + runtime — enough to read top-to-bottom in one sitting.

### 2. Read the corpus out loud (literally or in your head)

The first real step is *reading the list as prose* — not line-by-line with the code around it, but top-to-bottom as if you were reading a pamphlet. This is when voice drift jumps out. The dev who wrote each string in its own sprint can't hear the drift; the fresh read does.

Shortcuts / heuristics while reading:
- **Circle any two strings that feel tonally different** (friendly vs formal, playful vs clinical)
- **Star any string you have to re-read to understand** (candidate for pattern #4 or #5)
- **Underline any two strings saying nearly the same thing** (pattern #6)
- **Bracket any string longer than ~12 words on a small UI surface** (pattern #7)

### 3. Score each string against the rubric

Four yes/no questions per string:

| Q | Question | If "no" |
|---|---|---|
| Q1 | **Clarity:** would a first-time player understand this on first read? | Rewrite to remove jargon/shorthand (pattern #4 or #5). |
| Q2 | **Consistency:** does this match the voice of its sibling strings (same surface class)? | Normalize voice (pattern #1 or #2). |
| Q3 | **Brevity:** can this be shorter without losing meaning? | Trim (pattern #6 or #7). |
| Q4 | **Personality:** does this feel like a human wrote it, not a form? | Inject warmth (pattern #2). |

Strings that score ✅ on all four pass the audit. Any ❌ → action list. Borderline ⚠ on Q2 especially → promote to ❌ (inconsistency is the most insidious because it reads as "this product wasn't finished" even if each string is fine).

### 4. Apply the standard fix recipes

Three named recipes. Pick by symptom.

**Recipe A — normalize on/off / yes/no / open/close pairs.**
Any binary-state string pair must match grammatical shape.
```js
// ❌
announce(muted ? 'Sound muted.' : 'Sound on.');
// ✅
announce(muted ? 'Sound off.' : 'Sound on.');
```
Applies to pattern #3. Also: "Game paused." / "Resuming." → pick one tense; "Opened." / "Close" → pick one part-of-speech.

**Recipe B — replace arithmetic-operator shorthand with verbs.**
In UI prose, `=` / `+` / `−` are ambiguous (operator? bullet? connector?). Use full words.
```html
<!-- ❌ -->
<span>Tapping it = miss + life</span>
<!-- ✅ -->
<span>Tap it and you lose a life.</span>
```
Applies to pattern #4. Exception: `+50 bonus` / `×4 multiplier` / `3-Day Ritual` are fine — these are labels with one operator each, not chains.

**Recipe C — pick one phrasing, search-and-replace.**
For redundant variants ("in a single run" vs "in a run"), pick the shorter clear form and replace globally.
```bash
# before edit: grep the variants
grep -nE "in a (single )?run" game.js
# after edit: verify one form remains
grep -nE "in a single run" game.js  # → 0 results
```
Applies to pattern #6. The replace-all discipline means future sprints inherit the decision automatically.

### 5. Verify side-effects

After editing copy:
- **Screen reader pronunciation.** If you change an SR-announce string, read the new version out loud (screen readers pronounce punctuation literally-ish: `"Sound off."` reads as "sound off full stop" — which is *fine* but `"Sound off!"` reads as "sound off exclamation mark" on some SR/verbosity combos). Prefer periods over exclamations in SR channels unless celebration is explicit.
- **Length in layout.** A string that grows (e.g. "Close" → "Got it") may overflow a fixed-width button. A string that shrinks may look lost in whitespace. Sanity-check in the actual UI.
- **Translation surface.** If the game plans localization (`localization-readiness` audit future addition), shorter strings are cheaper to localize — but every change to English source needs propagation to every locale. Keep a list of touched strings in the commit message.
- **Test / snapshot references.** If a test asserts on exact string equality, it'll break. `grep -n "Sound muted" tests/` before committing.
- **Achievement label retention.** DO NOT rename achievement labels casually — players who earned "Perfect Purity" last week expect that same label to stay. Achievement *descriptions* can evolve, *labels* should be frozen post-ship.

## Common gap patterns (search-and-fix list)

Red flags to grep for:

```bash
# Arithmetic-operator-as-verb shorthand (pattern #4)
grep -nE "[^\\d]=\s*(miss|hit|life|bonus|score)" game.js index.html

# "fast" / "quick" as vague modifier (pattern #5)
grep -nE "die (fast|quickly|rapidly)" game.js index.html

# "granted" / "awarded" (pattern #2 — too formal for casual UX)
grep -nE "granted\.?['\"]|awarded\.?['\"]" game.js

# Inconsistent "in a (single )?run"
grep -nE "in a (single )?run" game.js

# Mixed dismiss labels
grep -nE ">(Close|Cancel|Dismiss|Got it|OK)<" index.html
```

Safe replacements:
```
❌ "= miss + life"         → ✅ "and you lose a life"
❌ "die fast 3x in a row"  → ✅ "die quickly 3 runs in a row"
❌ "bonus life granted"    → ✅ "bonus life earned"
❌ "in a single run"       → ✅ "in a run"
❌ (mixed) "Close" / "Got it" on modal dismiss → ✅ pick one, use everywhere
```

## When NOT to use

- **Pre-feature-lock.** If the game is still discovering its voice (first ~5 sprints), premature normalization freezes in a voice that isn't the right one yet. Run the first microcopy audit around sprint 10-15 when the voice has *emerged* but before it's drifted.
- **Translation-locked builds.** If strings are already in a translation pipeline, each change has N-translator cost. Batch edits and audit less frequently.
- **Achievement labels.** Treat these as frozen public-facing identifiers. Audit the *descriptions*, not the labels. (The label is effectively the player's memory of the achievement; renaming breaks player trust.)

## Audit cadence

- **Per sprint that adds ≥3 user-facing strings:** spot-check — read the new strings alongside their nearest siblings (modal dismiss, same-surface hints) and confirm voice match.
- **Periodic full sweep every 20 sprints:** enumerate all strings, read top-to-bottom, apply rubric.
- **Before external playtest:** *always*. A playtester will charitably not mention tone mismatches ("it's fine") while unconsciously downgrading the game. Fix first.

## Cost

Audit: ~20-30 minutes for a game with ~60 strings (enumerate 5 min + read-corpus 10 min + score 10 min + fixes 5-10 min). The fixes themselves are often single-character edits (`muted` → `off`, `+` → `and you lose`). The cost of *not* auditing is cumulative tone drift — each sprint adds maybe 1% drift, which sounds invisible until Sprint 30 when the player can feel the patchwork without being able to name it.

The asymmetry: one hour to audit, once per 20 sprints. One *month* of drift to undo if you skip the audit for 40+ sprints.

## Cross-link

This skill is the 10th member of the audit family. It composes with:
- [`ux/cognitive-load-audit.md`](cognitive-load-audit.md) — the #9 audit asks *which elements* are on first-visit surface; this audit asks *what words* those elements contain. Run cognitive-load first (decides what stays), then microcopy (edits what stays).
- [`ux/screen-reader-announcements.md`](screen-reader-announcements.md) — the SR-announce channel is a subset of the microcopy surface; any change to an announce() string should pass both audits.
- [`ux/accessibility.md`](accessibility.md) — microcopy's "clarity" question overlaps with a11y's plain-language guidance; this audit adds the *voice consistency* dimension a11y doesn't touch.

See [`audit-from-the-margin.md`](../audit-from-the-margin.md) for the meta-discipline and the other 9 audits.
