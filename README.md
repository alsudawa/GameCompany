# 🎮 GameCompany

An AI-only game studio that ships single-file browser casual games — pure HTML5, Vanilla JS, CSS, and Web Audio. No build step, no external assets, no dependencies. Every game runs by opening one `index.html`.

---

## Team

| Role | Agent | Model | Responsibility |
|------|-------|-------|---------------|
| Producer | `@producer` | Sonnet | Briefs, postmortems, README catalog |
| Game Designer | `@game-designer` | Opus | GDD, core loop, difficulty curve |
| Lead Developer | `@lead-developer` | Sonnet | `game.js`, `index.html`, integration |
| Artist | `@artist` | Haiku | CSS / canvas visual style |
| Sound Designer | `@sound-designer` | Haiku | Web Audio SFX recipes |
| QA Tester | `@qa-tester` | Haiku | Pre-ship checklist, bug reports |

---

## Games Catalog

### 001 · void-pulse

> Tap the ring the moment a void pulse crosses it — survive the heartbeat as it splits into polyrhythms.

| | |
|---|---|
| **Slug** | `001-void-pulse` |
| **How to play** | Open [`games/001-void-pulse/index.html`](games/001-void-pulse/index.html) in any browser |
| **Session length** | 45–90 seconds, endless |
| **Blurb** | A pure timing game: one expanding pulse ring, one fixed target ring, and a combo multiplier that turns every perfect tap into a cascade of pitch-shifted chimes. Polyrhythms kick in around 45 seconds; by 90 seconds you are juggling triple pulses at 600 px/s. No tutorial. No menus. Just tap. |

### 002 · glyph-siege

> Hold a shrinking sanctuary. Move to survive. Stack six runes into a screen-clearing build.

| | |
|---|---|
| **Slug** | `002-glyph-siege` |
| **How to play** | Open [`games/002-glyph-siege/index.html`](games/002-glyph-siege/index.html) in any browser |
| **Session length** | 60–180 seconds, endless |
| **Blurb** | A Horde Survivor distilled to its fun-source: move-only input, auto-attack, 4 enemy shapes closing from every edge, 6 stackable rune upgrades, and a telegraphed boss every 90 seconds. Pick damage, fire rate, multi-shot, speed, magnet, or vitality — watch a fragile glyph become a screen-clearing ward. |

---

## Repository Layout

```
.claude/
  agents/          # Reusable subagent role specs (producer.md, game-designer.md, …)
  settings.json    # Claude Code project config

company/
  roster.md        # Team roles, models, org chart
  workflow.md      # Six-stage process (kickoff → ship)
  skills/          # Reusable patterns extracted from past games
    audio/
    gameplay/
    graphics/
    qa/
  postmortems/     # One .md per shipped game
  templates/       # Starter files for new games

games/
  001-void-pulse/
    index.html     # Entry point (open this in a browser)
    game.js        # All game logic, self-contained IIFE
    style.css      # Layout + CSS animations
    docs/
      brief.md     # Producer brief
      design.md    # Game Design Document
      qa-report.md # QA findings
```

---

## How to Make a New Game

Based on [`company/workflow.md`](company/workflow.md):

1. **Kickoff (orchestrator)** — create `games/<NNN>-placeholder/` from `company/templates/`.
2. **Brief (Producer)** — write `docs/brief.md`; pick a kebab-case slug; orchestrator renames the folder.
3. **Design (Game Designer)** — write `docs/design.md`; read prior postmortems and `company/skills/README.md` first.
4. **Build in parallel** — Lead Developer scaffolds `game.js`; Artist drafts `style.css` + `docs/art-spec.md`; Sound Designer writes `docs/sound-spec.md`.
5. **Integrate (Lead Developer)** — merges art and audio specs into the codebase; deletes the transient spec files.
6. **QA (QA Tester)** — writes `docs/qa-report.md`; Lead Developer applies P1 + P2 fixes.
7. **Knowledge capture (Producer + Orchestrator)** — write postmortem; update `company/skills/`; update this README catalog.
8. **Ship (Orchestrator)** — single commit: `git commit -m "ship: <NNN>-<slug> — <one-line hook>"`.

---

## How to Invoke the Team

Each file in `.claude/agents/*.md` defines a reusable subagent with a role spec, allowed tools, and model preference. In a Claude Code session on this repo, call them by name:

```
@producer        draft a brief for a new puzzle game
@game-designer   write the GDD for <hook>
@lead-developer  implement the GDD at games/002-<slug>
@artist          write the art spec for games/002-<slug>
@sound-designer  write the sound spec for games/002-<slug>
@qa-tester       review games/002-<slug>
```

Or use the `Agent` tool programmatically with `subagent_type: "<agent-id>"` to parallelize stages 2 and 3.
