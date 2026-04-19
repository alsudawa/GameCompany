# GitHub Pages Publishing

**Where used:** repo root `.github/workflows/pages.yml` + `.nojekyll`, landing page at root `index.html`.

GameCompany publishes every shipped game to GitHub Pages so players reach them by URL without cloning or running a local server. Because we ship zero-build vanilla HTML/JS/CSS + ES modules, "Deploy from Actions" is the simplest path and handles everything correctly (MIME types for `.js`, `.css`, `.svg`; no Jekyll processing).

## One-time repo setup (done once per repo, preserved forever)

1. Commit `.github/workflows/pages.yml` and `.nojekyll` to `main`. Both already live in this repo.
2. Human CEO enables Pages: **GitHub → repo → Settings → Pages → Source: "GitHub Actions"**.

That's it. Every subsequent push to `main` re-deploys automatically. Session agents cannot toggle the Pages source setting through the MCP tools; this is the only manual step and it's a one-time action.

## Per-ship checklist (automatic, nothing new to do)

As long as Stage 6 (`git push origin main` via a PR merge) runs, the new game is published. The workflow uploads the whole repo root, so:

- Root `/index.html` (landing catalog) — already updated in Stage 5
- `/games/<id>-<slug>/` — already created in Stage 0–5
- All skill docs, postmortems, docs — served but not linked (not a problem)

No per-ship config changes are required.

## URL shape

- Catalog: `https://alsudawa.github.io/GameCompany/`
- Game N: `https://alsudawa.github.io/GameCompany/games/<id>-<slug>/`

Note GitHub preserves the original repo capitalization in Pages URLs. Linking always uses relative paths from the repo root, so capitalization is not a concern within the site itself.

## Workflow file (reference)

```yaml
# .github/workflows/pages.yml
name: Deploy to GitHub Pages
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deploy.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with: { path: . }
      - id: deploy
        uses: actions/deploy-pages@v4
```

## `.nojekyll` file

Empty file at repo root. Prevents GitHub from running Jekyll, which would exclude any file/folder starting with `_` from the deploy. We don't currently use leading underscores, but the guard is free and future-proofs new game folders (`_something`, framework helpers, etc.).

## What NOT to do

- ❌ Don't use Jekyll themes. They break the zero-dep ethos and mangle our paths.
- ❌ Don't use a service worker for this kind of site — it caches aggressively and makes "ship a new game and see it live" into "ship a new game and wait for cache TTL."
- ❌ Don't enable "Deploy from a branch" without the workflow — it works but skips the deploy log, and you can't tell if a push failed to deploy.
- ❌ Don't point Pages at `docs/`. Everything is at repo root; moving the entry point breaks the skills library's relative paths and the postmortems' links.

## Verification after push

1. Push to `main` (via PR merge).
2. GitHub → repo → **Actions** tab → `Deploy to GitHub Pages` workflow should be green within 1–2 minutes.
3. Click into the run; the deploy step logs the Pages URL.
4. Load the catalog URL; check the new game card appears and the game loads.

## Gotchas

- **ES modules require HTTP, not `file://`.** During local dev, Lead Developer must run `python3 -m http.server` to test. Pages serves via HTTPS so modules work in production.
- **Sound Context autoplay policy.** AudioContext must init on first user gesture even on Pages; the `Sfx.init()` pattern in each game handles this.
- **Caching.** CDN may serve stale `main` for a few minutes after deploy. Hard-refresh (`Ctrl+Shift+R` / `Cmd+Shift+R`) if testing immediately after a push.
- **Case sensitivity.** Linux filesystem on Pages servers is case-sensitive; macOS/Windows dev machines often are not. Keep all paths lowercased in HTML `href`/`src` to avoid "works locally, 404s on Pages" bugs.

## Where this lives in the workflow

Stage 6 of `company/workflow.md` now ends with a push to `main`; the Pages workflow handles the rest. No new stage needed. Producer's Stage 5 README update is what makes the new game discoverable from the catalog — if that step is skipped, the game ships to Pages but is orphaned (no link from the landing page). **Always update the root `index.html` catalog before merging to main.**
