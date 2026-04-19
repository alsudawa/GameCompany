# 🔄 GameCompany Standard Workflow

One game = six stages. The orchestrator drives; specialists execute.

## Stage 0 · Kickoff (orchestrator, 1 min)

```bash
NEW_ID=$(printf "%03d" $(($(ls games/ | wc -l) + 1)))
cp -r company/templates "games/${NEW_ID}-placeholder"  # will be renamed after Producer picks slug
```

## Stage 1 · Plan (sequential)

1. **Producer** → `games/<id>-<slug>/docs/brief.md`
   - Picks the `<slug>` → orchestrator renames the folder to match.
2. **Game Designer** (Opus) → `games/<id>-<slug>/docs/design.md`
   - Reads prior postmortems and `skills/README.md` before deciding.

## Stage 2 · Build (parallel — single message, three Agent calls)

3a. **Lead Developer** → `games/<id>-<slug>/game.js` + `index.html` wiring
3b. **Artist** → `games/<id>-<slug>/docs/art-spec.md` + `style.css` draft
3c. **Sound Designer** → `games/<id>-<slug>/docs/sound-spec.md`

## Stage 3 · Integrate (sequential)

4. **Lead Developer** re-called
   - Merges Artist and Sound Designer outputs into `game.js` / `style.css`
   - **Deletes** `art-spec.md` and `sound-spec.md`

## Stage 4 · QA & polish (sequential)

5. **QA Tester** → `games/<id>-<slug>/docs/qa-report.md`
6. **Lead Developer** → applies P1 + P2 fixes

## Stage 5 · Knowledge capture (critical — do not skip)

7. **Producer** → `company/postmortems/<id>-<slug>.md`
8. **Orchestrator** extracts reusable patterns from this project's code → updates `company/skills/*`:
   - new utility function? → add to relevant skill doc with a code block
   - design principle that worked? → append to `skills/gameplay/*`
   - art trick that landed? → append to `skills/graphics/*`
9. **Producer** → updates root `README.md` catalog (append new game card) **AND** root `index.html` landing page (append new game card under `.games`). Both are required — `README.md` for the repo reader, `index.html` for the Pages visitor. A ship without both is orphaned.

## Stage 6 · Ship (orchestrator)

```bash
git add -A
git commit -m "ship: <id>-<slug> — <one-line hook>"
git push -u origin <branch>
```

Then open a PR to `main` and merge. **The `main` push auto-publishes to GitHub Pages** via `.github/workflows/pages.yml`. See [`skills/distribution/github-pages.md`](skills/distribution/github-pages.md) for the workflow contract and the one-time Settings → Pages activation.

Pre-merge gate — **root `index.html` must already link the new game's folder** (Producer's Stage 5 step 9). Orphaned ships don't appear on the Pages catalog.

Post-merge verification:
1. Actions tab → `Deploy to GitHub Pages` should go green in 1–2 min.
2. Load `https://alsudawa.github.io/GameCompany/` — new game card appears.
3. Click the card — game loads and plays.

## Anti-patterns (do not do)

- ❌ Skipping postmortem because "it worked"
- ❌ Keeping spec .md files around after integration
- ❌ Creating per-role commits (noisy history)
- ❌ Adding external assets (`<img src>`, `<audio src>`) — violates "no deps"
- ❌ Letting one agent write another's file (QA must not edit code; Artist must not edit `game.js`)
- ❌ Updating only `README.md` but forgetting the root `index.html` catalog — the new game ships to Pages but is unreachable from the landing page
- ❌ Merging to `main` without Pages Actions workflow on the branch — first ship on a new repo must include `.github/workflows/pages.yml` and `.nojekyll`
