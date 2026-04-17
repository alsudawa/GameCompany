# Game Design Document — __GAME_SLUG__

**Designer:** @game-designer
**Status:** draft

## Hook
<one sentence that sells the game>

## Core loop (every ~2 seconds)
1. <action>
2. <reaction>
3. <reward or punishment>

## Input mapping
- `pointerdown` → <what>
- `pointermove` (held)  → <what, if any>
- `pointerup`  → <what>

## Scoring & win/lose
- Score formula: `<formula>`
- Lose condition: `<exact trigger>`
- Win condition: `<or N/A for endless>`

## Difficulty curve
| Time   | What changes                     |
|--------|----------------------------------|
| 0s     | intro state                      |
| 15s    | first difficulty bump            |
| 45s    | second bump                      |
| 90s+   | mastery phase                    |

## Juice moments (4–6)
- <e.g. screenshake on miss>
- <e.g. pitch-shift on combo>
- <e.g. radial particle burst on score>
- ...

## Game feel checklist
- **Anticipation:** <how is the player warned?>
- **Impact:** <what makes the moment land?>
- **Reaction:** <what shows the system heard the input?>

## Risks
- <what could make this un-fun, and mitigation>
