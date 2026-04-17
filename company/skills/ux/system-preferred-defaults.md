# Skill — System-Preferred Defaults (First-Visit Theme / Contrast)

**When to use:** a game with a theme picker (skill: `ux/theme-picker.md`) persisting to localStorage. First-time visitors see whatever you hardcoded as the default — usually "void" or "dark" or whatever your lead designer prefers. That's a small but real problem: a player on a light OS surrounded by bright rooms gets slammed with a dark theme on first click, and a low-vision player in high-contrast mode gets a low-contrast palette. The OS already knows what they need. Sniff, default accordingly, and only persist when the user makes an explicit choice.

## The contract

Three-state mental model:
1. **Auto (no stored pick)** — theme is re-derived from OS preferences on every page load *and* on every preference-change event while the page is open. `localStorage.getItem('theme') === null`.
2. **Explicit (stored pick)** — user clicked a swatch or cycled via keyboard. Stored value wins forever; OS flips do nothing.
3. **Never mixed** — we never write a value during auto-mode. That would make auto-mode unreachable once entered.

## Pattern — split "stored" from "resolved"

```js
function readStoredTheme() {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return THEMES.includes(t) ? t : null;      // ← null = auto mode
  } catch { return null; }
}
function sniffSystemTheme() {
  try {
    if (window.matchMedia('(prefers-contrast: more)').matches) return 'void';
    if (window.matchMedia('(prefers-color-scheme: light)').matches) return 'sunset';
  } catch {}
  return 'void';
}
function readTheme() {
  return readStoredTheme() || sniffSystemTheme();
}
```

Why split:
- **`readStoredTheme()` is the auto-mode oracle.** Anywhere you need to know "has the user made an explicit choice?", check this function's return value. `null` = no.
- **`sniffSystemTheme()` stays pure.** It only reads media queries, never writes. Safe to call any number of times.
- **`readTheme()` is the only call-site most code needs.** Initial paint, picker sync — all just want the effective theme.

## Pattern — never persist the sniff result

```js
function setTheme(t) {
  if (!THEMES.includes(t) || t === currentTheme) return;
  currentTheme = t;
  writeTheme(t);       // ← only called from explicit user actions
  applyTheme(t);
}
```

Only the picker click handler and the `T` keyboard shortcut should call `setTheme`. Never call it from `onSystemThemeChange`, or you'd lock the user out of auto-mode forever on the first OS flip.

The side-channel is: "does `localStorage` have a key?" That's our state bit for auto-vs-explicit. If you add a "reset to system default" UX feature later, it's just `localStorage.removeItem(THEME_KEY)` + `applyTheme(readTheme())`.

## Pattern — live media-query listeners (only active in auto mode)

```js
function onSystemThemeChange() {
  if (readStoredTheme()) return;         // explicit pick → ignore OS flips
  const next = sniffSystemTheme();
  if (next === currentTheme) return;
  currentTheme = next;
  applyTheme(next);                       // no writeTheme — stay in auto
}
try {
  const mqColor = window.matchMedia('(prefers-color-scheme: light)');
  const mqContrast = window.matchMedia('(prefers-contrast: more)');
  if (mqColor.addEventListener) {
    mqColor.addEventListener('change', onSystemThemeChange);
    mqContrast.addEventListener('change', onSystemThemeChange);
  } else if (mqColor.addListener) {       // Safari < 14
    mqColor.addListener(onSystemThemeChange);
    mqContrast.addListener(onSystemThemeChange);
  }
} catch {}
```

Key points:
- **Guard with `readStoredTheme()`, not a separate `isAutoMode` flag.** A flag would desync if the user clears storage via devtools; localStorage is the single source of truth.
- **Listen to each query separately.** A single listener on the union isn't a thing in the Media Queries API. Listeners are one-per-MQL.
- **Branch addEventListener vs. addListener once at init.** Safari ≤13 only supports the deprecated `addListener`. Branching at init not inside the handler keeps the hot path clean.
- **Wrap in `try { … } catch {}`.** Old environments without `matchMedia` shouldn't break the whole game.

## Pattern — priority ordering

Multi-signal sniff is priority-ordered, not weighted:

1. **`prefers-contrast: more`** → pick the highest-contrast theme regardless of light/dark preference. Accessibility wins over aesthetics.
2. **`prefers-color-scheme: light`** → pick the light theme. Most users who set this are on bright-surroundings devices.
3. **Fallback** → the game's "canonical" theme (what the designer shipped as the dark default).

The sniff must ALWAYS return a member of `THEMES`. If you add a fourth theme later (e.g., 'cave' for `prefers-contrast: less`), extend the sniff; don't accept an unvalidated string.

## What gets sniffed, what doesn't

**Do sniff:**
- `prefers-color-scheme` → which palette (light variant vs. dark variant)
- `prefers-contrast` → prefer the highest-contrast variant
- `prefers-reduced-motion` → covered in its own skill (`ux/accessibility.md`). Not a theme knob.

**Don't sniff:**
- `prefers-reduced-data` / `prefers-reduced-transparency` — too niche for a casual game, and the answer for all of them is usually the same as "pick the simplest theme".
- **Language / locale** — don't auto-map locale to theme; cultural color associations aren't a 1:1 mapping (red = danger in some cultures, luck in others).

## Pattern — SSR-safe / undefined-window-safe

If your build pipeline ever outputs server-rendered HTML: `matchMedia` doesn't exist on the server. The `try/catch` around the sniff already handles it — on the server, `window.matchMedia` is undefined, `sniffSystemTheme` returns the fallback, which is what you want (match whatever theme is in the SSR'd markup).

## Common mistakes

- **Writing the sniff result to localStorage on load.** This pins the user to whatever their OS was set to on first visit; they lose access to auto-mode. The sniff value is always derived, never stored.
- **Using a JS variable (e.g. `isAutoMode`) as the state bit instead of `!readStoredTheme()`.** The JS variable can desync if the user edits storage via devtools or in another tab. localStorage is the authoritative bit.
- **Calling `matchMedia` every render.** Cache the MQL object at init (`mqColor = window.matchMedia(...)`) and re-read `.matches` as needed.
- **Skipping the Safari <14 `addListener` branch.** Those users silently lose the live-update feature and might never figure out why the theme doesn't follow their OS switch.
- **Listening to `prefers-color-scheme` but not `prefers-contrast`.** Low-vision users who toggle contrast mid-session get stuck on the wrong theme. Both listeners, same handler.
- **Forgetting the `t === currentTheme` short-circuit in `onSystemThemeChange`.** Without it, every OS flip invalidates caches and forces a re-render even when the resolved theme didn't actually change.
- **Hardcoding light-theme CSS into the "no preference" fallback.** Users who disable preferences entirely get surprised. Fallback should match the designer's canonical ship theme, not a preference.
- **Persisting on explicit pick using `true`/`1` as a "has picked" marker.** Store the actual theme id — you need it on next load anyway, and a separate "picked" flag is redundant state to keep in sync.

<!-- added: 2026-04-17 (001-void-pulse sprint 17) -->
