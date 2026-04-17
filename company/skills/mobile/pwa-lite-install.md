# Skill — PWA-Lite Install Surface (Zero Image Files)

**When to use:** any single-HTML browser game you want users to add to their home screen and launch standalone (fullscreen, no URL bar, own task-switcher card). You don't need offline support or a service worker to get most of the benefits — a manifest, a few meta tags, and inline-SVG icons are enough for Chrome Android, Edge, and iOS Safari to offer "Add to Home Screen" and render it correctly afterward.

This is the **lite** variant of PWA: no service worker, no offline cache, no version-churn. If you later want offline support, add a service worker; nothing in this skill prevents that.

## Pattern — `manifest.webmanifest` with inline-SVG icons

```json
{
  "name": "void-pulse",
  "short_name": "void-pulse",
  "description": "Tap the ring when the void pulses through it.",
  "start_url": "./",
  "scope": "./",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#0a0e1f",
  "theme_color": "#0a0e1f",
  "icons": [
    { "src": "data:image/svg+xml,…", "sizes": "any", "type": "image/svg+xml", "purpose": "any" },
    { "src": "data:image/svg+xml,…", "sizes": "any", "type": "image/svg+xml", "purpose": "maskable" }
  ]
}
```

Key choices:
- **`.webmanifest` extension** — the spec-preferred MIME is `application/manifest+json`. Most servers map `.webmanifest` to it automatically; `.json` sometimes gets served as `application/json`, which still works but throws warnings.
- **`start_url: "./"` + `scope: "./"`** — keeps the installed app scoped to the game folder. If you later host multiple games under one domain, the installed instance won't bleed between them.
- **`display: "standalone"`** — the most-supported "feels like an app" mode. `fullscreen` loses the OS status bar and breaks iOS badly; avoid it for casual games.
- **`orientation: "portrait"`** — the game is 720×960 (portrait). Android respects this; iOS ignores it; both are fine.
- **`background_color` + `theme_color`** — `background_color` is the splash-screen color while the page loads; `theme_color` is the URL bar / status-bar color. Set both to `--bg` (the canvas background) for a seamless launch.
- **Two icon entries: `any` + `maskable`** — Android launcher masks icons into circles/squircles and crops past the safe zone. A maskable icon with a solid background color ensures the crop looks intentional. The `any` variant is the fallback for launchers that don't mask.
- **`sizes: "any"` with SVG** — tells the manifest consumer "this icon scales". Chrome 93+ accepts this and generates the needed rasters on the fly. Older consumers fall back to whatever size their UI needs by rasterizing the SVG.

## Pattern — data-URI SVG icons (URL-encoded)

Inline the SVG into the manifest's icon `src`:

```
data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%20512%20512%22%3E…%3C%2Fsvg%3E
```

Rules:
- **URL-encode the SVG**, not base64-encode. `data:image/svg+xml,<svg>…</svg>` works in `<link rel="icon">` (the browser accepts unescaped `<`), but in JSON-embedded manifests you need `%3C`/`%3E` for `<`/`>` and `%22` for `"` so the JSON parser doesn't choke on embedded quotes.
- **Keep the icon at a single viewBox that scales** (e.g., `0 0 512 512`). All sizes will be derived by the rasterizer. One SVG = no size-specific rework.
- **Solid background rect for maskable** — otherwise the launcher crops into transparency and the icon looks broken on a colored background. The "any" variant can go transparent if you want.

## Pattern — apple-touch-icon sidecar (iOS Safari)

Safari iOS still doesn't read `icons` from the manifest. Instead:

```html
<link rel="apple-touch-icon" href="data:image/svg+xml;utf8,<svg …></svg>" />
```

Notes:
- **180×180 is the target** for modern iOS. `viewBox` handles it, but iOS historically prefers PNG; SVG works from iOS 13+ and is what you use when the no-image-files constraint is binding.
- **Inline-SVG `data:image/svg+xml;utf8,` is acceptable** inside a `<link>` tag (not JSON), so you can use unescaped `<` here.
- **Don't URL-encode this one** — it's an HTML attribute, not embedded JSON. Spaces/newlines inside the SVG need to be removed or replaced with `%20`, but `<`/`>`/`"` can be literal inside a single-quoted attribute.

## Pattern — `apple-mobile-web-app-*` meta tags

```html
<meta name="mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-title" content="void-pulse" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
```

- **`apple-mobile-web-app-capable: yes`** — iOS reads this to decide whether to launch in standalone mode after add-to-home-screen. Without it, iOS reopens in Safari.
- **`mobile-web-app-capable`** — the now-deprecated Android equivalent. Harmless; some older browsers still read it.
- **`apple-mobile-web-app-title`** — the home-screen label. Falls back to `<title>` without this (which often contains a brand suffix).
- **`apple-mobile-web-app-status-bar-style: black-translucent`** — status bar floats over the page. For a dark-background game this is seamless; for a light game, use `default` or `black`.

## Pattern — dynamic `theme-color` on theme swap

The `theme_color` in the manifest is the *install-time default*. It's frozen at the moment the user installed the app. To keep the live URL bar (or the standalone status bar) in sync with the active in-app theme, update the DOM's `<meta name="theme-color">` on theme change:

```js
const themeColorMeta = document.querySelector('meta[name="theme-color"]');
function syncThemeColorMeta() {
  if (!themeColorMeta) return;
  const bg = getComputedStyle(document.documentElement)
    .getPropertyValue('--bg').trim() || '#0a0e1f';
  themeColorMeta.setAttribute('content', bg);
}
```

Rules:
- **Read from `--bg`** so you don't duplicate the palette in JS — CSS is the source of truth.
- **Bypass your canvas-var cache** (call `getComputedStyle` directly) — on theme swap the cache is cleared and you want the new value, but this runs once per swap so there's no cost concern.
- **Call it from `applyTheme()`** — that function already invalidates caches and syncs the radio group. One more sync is the same rhythm.
- **Older Chrome (<93) + older Safari** ignore `theme-color` changes post-load — acceptable degradation. Modern browsers update chrome color on attribute change.

## What the manifest gives you vs. doesn't

**Gives:**
- "Install" / "Add to Home Screen" prompt in the browser menu on Android Chrome, Edge, desktop Chrome, iOS Safari
- Proper app name (not domain) on home screen
- Launch in standalone mode (no URL bar, own task-switcher entry)
- Splash screen with `background_color` + icon during launch (Android)
- Status bar color matching the theme

**Doesn't give:**
- Offline support — needs a service worker
- Push notifications — needs push-subscription API + SW
- Background sync — needs SW
- App Store distribution — needs TWA wrapper or separate build

For a casual browser game, the lite tier is usually enough. Adding a service worker just to cache 3 files is overkill and opens the "stale cached build" problem.

## Common mistakes

- **`display: "fullscreen"`** — iOS handles this badly; kills the status bar in a way that makes the notch / dynamic island overlap game content.
- **`scope: "/"`** — too broad. If your game is at `/games/001/`, a root scope captures every other URL on the domain into the installed app, making back-navigation weird.
- **Manifest served as `text/plain`** — some hosts do this with unknown extensions. Chrome will refuse to parse. Check DevTools → Application → Manifest for a "MIME type was not recommended" warning.
- **Base64 icon data URIs** — 33% larger than URL-encoded and serve no benefit here. Always URL-encode for SVG.
- **Single `purpose: "any"` icon on a colored background** — Android crops the padding off, result looks awful. Ship a maskable variant with explicit safe-zone padding.
- **Setting `theme_color` in manifest but not updating the `<meta>` at runtime** — post-install the chrome stays locked to the install-time color even if the user changes theme. Always wire the meta sync if you have runtime theming.
- **Forgetting `apple-mobile-web-app-capable`** — iOS users add to home screen, tap the icon, and watch it open Safari instead of standalone. Very hard to debug; easy to prevent.
- **Same SVG for `any` and `maskable`** — technically allowed but defeats the purpose. Maskable needs more padding (safe zone ≈ 80% of canvas for the visual content).
- **Hosting data-URI-only icons and expecting Android to fetch them for the Play Store upload step** — Play Store wants real file URLs. Fine for browser install, not for Play.

<!-- added: 2026-04-17 (001-void-pulse sprint 18) -->
