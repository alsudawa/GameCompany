# 👥 GameCompany Roster

AI-only game studio. Human CEO delegates; orchestrator Claude (CTO) coordinates; specialists below ship the game.

| Role | Agent ID | Model | Why this model |
|---|---|---|---|
| 🧑‍💼 Producer | `producer` | `sonnet` | Coordination + documentation balance |
| 🎨 Game Designer | `game-designer` | `opus` | Creative concept & deep design reasoning |
| 👩‍💻 Lead Developer | `lead-developer` | `sonnet` | Code generation, integration, throughput |
| 🖼️ Artist | `artist` | `haiku` | Repetitive asset work, speed-first |
| 🔊 Sound Designer | `sound-designer` | `haiku` | Short focused SFX snippets |
| 🧪 QA Tester | `qa-tester` | `haiku` | Checklist-driven review, speed-first |

## How to summon a teammate

From Claude Code in this repo:

```
@producer  please draft a brief for a new puzzle game
@game-designer  write the GDD for <hook>
@lead-developer  implement GDD at games/00X-<slug>
@artist  art spec for games/00X-<slug>
@sound-designer  sound spec for games/00X-<slug>
@qa-tester  review games/00X-<slug>
```

Or programmatically via the `Agent` tool with `subagent_type: "<id>"`.

## Org chart

```
                   CEO (human)
                       │
                       ▼
               Orchestrator Claude  (CTO / chief of staff)
                       │
      ┌────────┬───────┼────────┬────────┬────────┐
      ▼        ▼       ▼        ▼        ▼        ▼
  Producer  Designer  Lead    Artist  Sound     QA
  (sonnet)  (opus)    Dev     (haiku) Design    (haiku)
                      (sonnet)        (haiku)
```

## Team norms

- One commit per game (not one per role) — orchestrator gathers and commits.
- Temporary spec files (`docs/art-spec.md`, `docs/sound-spec.md`) are deleted after Lead Dev integrates them.
- Every finished game writes a postmortem and updates `company/skills/` — non-negotiable.
