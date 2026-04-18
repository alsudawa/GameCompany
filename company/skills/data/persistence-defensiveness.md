# Skill — localStorage Persistence Defensiveness

<!-- added: 2026-04-18 (001-void-pulse, sprint 53) -->

**When to use:** any time `localStorage.getItem` is followed by `JSON.parse`, `parseInt`, `+`-coercion, or a strict-typeof check. Browser storage is **mutable by anyone with devtools**: corrupt entries arrive via deliberate tampering, half-completed writes, schema drift between game versions, and (rarely) browser bugs. A "well-formed write" guarantee from your own writer code is **not** a guarantee about what the next read sees. The reader is the only place where the contract is enforceable.

This is a discipline doc — there's no single "function to copy." Use it as the **audit checklist** when adding a new persisted value, and as the **debug guide** when an existing one breaks.

## The four corruption modes

| Mode | Source | Symptom |
|---|---|---|
| **Type drift** | Stale-write across schema versions, or devtools edit. The key exists, but the value is the wrong shape. | `JSON.parse` succeeds; downstream `arr.filter(...)` throws because `arr` is now a string. |
| **NaN poisoning** | `parseInt("abc")` and `+("abc")` return `NaN`. `NaN` is truthy in `||`, falsy in `<`, sticky through math. | HUD displays `"NaN"`; `Math.max(best, NaN) === NaN`; `if (v < CONST)` silently false → migration never runs. |
| **Tampered ordering invariants** | `{ best: 3, streak: 99 }` (best < streak) violates an unwritten contract. | Reads return data that breaks code further down the call chain that *assumed* `best ≥ streak`. |
| **Out-of-range scalars** | Negative counts, future-dated timestamps, IDs not in the whitelist. | Silent miscalculation: `streak + 1` off a phantom anchor; theme renders an undefined palette. |

## The audit — five questions per read site

For every `localStorage.getItem(K)` site in the codebase, walk this list. Each question maps to a guard that belongs *in the read function*, not at every call site.

### 1. Does `JSON.parse` fail safely?

Wrap in `try/catch` and return a typed default. Never let a parse exception propagate — it kills the boot path on a single bad entry.

```js
function readThing() {
  try {
    const raw = localStorage.getItem(THING_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    // … further validation …
    return parsed;
  } catch { return defaultThing(); }
}
```

### 2. Did `JSON.parse` actually return the shape you wanted?

`JSON.parse('"hello"')` succeeds and returns the string `"hello"` — not the object you expected. `JSON.parse('null')` returns `null`. Both pass `try/catch`.

```js
if (!parsed || typeof parsed !== 'object') return defaultThing();
```

If you expected a **map / object** specifically, *also* reject arrays — `typeof [] === 'object'`:

```js
if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
```

If you expected an **array**, use `Array.isArray` directly (don't trust `typeof`):

```js
if (!Array.isArray(parsed)) return [];
```

### 3. Are scalar fields the type you expect?

`typeof o.score === 'number'` is true for `NaN` (since `typeof NaN === 'number'`). Use `Number.isFinite` if you need real numbers:

```js
if (!Number.isFinite(o.score)) return defaultThing();
// or coerce + clamp:
o.score = Math.max(0, +o.score || 0);
```

For string IDs, prefer **whitelist over typeof**:

```js
const THEMES = ['void', 'sunset', 'forest'];
return THEMES.includes(t) ? t : null;
```

### 4. Are values in range / consistent with each other?

Negative counters, future timestamps, and broken invariants all need explicit checks:

```js
const today = todayYyyymmdd();
let last = Math.max(0, +o.lastYyyymmdd || 0);
if (last > today) last = 0;     // future-dated → reset anchor
return { streak, best: Math.max(streak, best), lastYyyymmdd: last };
```

> **Rule of thumb.** If your *writer* maintains an invariant (e.g. `best ≥ streak`), the *reader* must enforce it too. Otherwise a tampered storage entry breaks every `if (best > N)` check downstream.

### 5. Do per-element validations exist for arrays / nested objects?

A top-level `Array.isArray` check is necessary but not sufficient. Filter the elements:

```js
return parsed
  .filter(e => Array.isArray(e) && Number.isFinite(e[0]) && (e[1] === 'p' || e[1] === 'g' || e[1] === 'm'))
  .slice(-CAP);
```

For nested objects, repeat the typeof + clamp pattern at each level:

```js
out.bestPerTheme = { ...defaults.bestPerTheme, ...(parsed.bestPerTheme || {}) };
for (const k of Object.keys(out.bestPerTheme)) {
  out.bestPerTheme[k] = Math.max(0, +out.bestPerTheme[k] || 0);
}
```

## Red-flag patterns (find these on grep, fix before they bite)

These are the patterns that look fine and *almost* work — they cover the happy path but quietly fail on corruption.

```js
// 🚩 RED FLAG — NaN propagates to UI as the literal string "NaN".
//   localStorage.getItem(K) === "abc"  →  +("abc") === NaN  →  HUD shows "NaN"
return +(localStorage.getItem(BEST_KEY) || 0);

// 🚩 RED FLAG — typeof object accepts arrays.
//   localStorage.getItem(K) === "[1,2,3]"  →  arr['some-id'] = 1 written as
//   named property, JSON.stringify drops it on next write → unlocks lost.
return (o && typeof o === 'object') ? o : {};

// 🚩 RED FLAG — strict typeof passes NaN through.
//   typeof NaN === 'number' → guard succeeds → math downstream poisoned.
if (o && typeof o.streak === 'number') return o;

// 🚩 RED FLAG — parseInt-NaN means migration never runs.
//   parseInt("abc", 10) === NaN  →  NaN < CONST is false  →  skipped
const v = stored ? parseInt(stored, 10) : 0;
if (v < SCHEMA_VERSION) { /* migrate */ }
```

### Safe replacements

```js
// ✅ Number.isFinite + non-negative clamp
const n = +(localStorage.getItem(K) || 0);
return Number.isFinite(n) && n >= 0 ? n : 0;

// ✅ Reject arrays explicitly + normalize values
if (!o || typeof o !== 'object' || Array.isArray(o)) return {};

// ✅ Coerce + clamp (handles NaN, missing, negative, string-numbers)
const streak = Math.max(0, +o.streak || 0);

// ✅ parseInt-NaN → re-migrate
const parsed = stored ? parseInt(stored, 10) : 0;
const v = Number.isFinite(parsed) ? parsed : 0;
```

## A mental simulation: paste each of these into devtools

For every key your game persists, mentally run the read function with each input. The read should produce the typed default *or* a clamped, sane value — never throw, never return `NaN`, never return an array where an object was expected.

| Storage value | What the reader should produce |
|---|---|
| `null` (key missing) | typed default (no throw) |
| `""` (empty string) | typed default (no throw) |
| `"abc"` (non-JSON) | typed default (no throw) |
| `"[1,2,3]"` (wrong-shape JSON) | typed default if you wanted an object; filtered/typed array if you wanted an array of primitives |
| `"null"` (literal JSON null) | typed default |
| `"NaN"` (not even valid JSON, throws on parse) | typed default |
| `'{"score":"BIG"}'` (wrong scalar type) | object with `score = 0` (after coerce + clamp) |
| `'{"streak":-9999,"lastYyyymmdd":99999999}'` (out-of-range) | clamped to {0, …, 0} |
| 1MB junk string | typed default (parse may throw on truly malformed input) |

If any input crashes the read function, the boot path crashes for that user. **They cannot launch your game** until they manually clear storage. Don't make them do that.

## When to migrate vs when to clamp

Two strategies. Pick by which side of the tradeoff hurts less.

### Migrate (transform old → new shape, persist back)

Use when:
- The schema *changed in a known way* (you added a field, renamed one, restructured a nested object).
- You want existing player data preserved across upgrades.
- The transformation is well-defined.

Pattern: `SCHEMA_VERSION` integer, an IIFE at boot that reads it, runs version-specific upgrade steps, writes the new version. See `gameplay/rhythm-chart.md` § "Schema versioning" for the canonical shape.

### Clamp / default (read defensively, never write back)

Use when:
- The corruption is *unstructured* (random tamper, half-write, partial corruption).
- The default value is fine — losing the entry costs the player ~nothing (best score, lifetime stats can absorb a re-zero).
- You want zero-cost reads (no migration write on every boot).

This skill doc is about the second strategy. For high-value data (cross-game progression, paid content), prefer migration; for soft data (best scores, achievement bits, ghost runs), defensive clamp is enough.

## Audit cadence

Persistence is **add-only over time** — every new feature tends to add a new key and a new read site. Run a sweep at:

- **End of every sprint that adds a new persisted value** (don't let it go un-reviewed).
- **Every 20 sprints as a periodic audit** (alongside reduced-motion / keyboard-flow / SR-coverage). Catches drift in older code that was added before you had this checklist.

For the periodic sweep: `grep -n 'localStorage\\.\\(get\\|set\\)Item\\|JSON\\.\\(parse\\|stringify\\)' game.js`. Walk the read sites, score each against the five questions, fix the gaps in one commit.

## When NOT to use

- **IndexedDB / OPFS** — different APIs, mostly typed at the storage layer; the failure modes here don't apply (though structural validation still does).
- **Server-fetched JSON** — at API boundaries, prefer schema validation libraries (zod, ajv). This skill is about the no-dependency, single-file game model where defensive parsing is the budget.
- **Read-once startup config** — a one-shot read at boot can fall back to defaults; the audit cadence isn't worth it for code that runs once and is forgotten.

## Cost

Negligible. Each guard is a few comparisons and one allocation per read. Reads happen at boot + on user action — never per frame. Compare to the alternative: one corrupted key crashes the boot path and the user can't launch the game without manual intervention. The asymmetry is large and one-sided.
