# Skill — Share / Virality

**When to use:** after any achievement the player might want to show off (new best, hard milestone, first clear). One button, zero friction. Don't prompt for account creation, don't gate it behind a sign-up.

## Pattern — Native share with clipboard fallback

`navigator.share` is mobile-first; on desktop it's mostly absent. `clipboard.writeText` covers desktop. If neither exists (old browser), hide the button entirely — no dead affordance.

```js
const canShare = typeof navigator.share === 'function';
const canCopy  = !!(navigator.clipboard && navigator.clipboard.writeText);

function shareScore() {
  const text = `I scored ${state.score} in void-pulse` +
    (state.newBestThisRun ? ' — new best!' : '') +
    ` ${location.href}`;

  if (canShare) {
    navigator.share({ title: 'void-pulse', text }).catch(() => {});
    return;   // user cancellation is fine; don't fall through to clipboard
  }
  if (canCopy) {
    navigator.clipboard.writeText(text).then(() => {
      flashCopiedState();     // visual confirmation — "Copied!"
    }).catch(() => {});
  }
}

// Show button only when the browser can do SOMETHING with it
if ((canShare || canCopy) && state.score > 0) {
  shareBtn.hidden = false;
}
```

## Why not fall-through on share-cancel

If the user hits the native share sheet and taps "Cancel," `navigator.share` rejects. A naive `share().catch(() => copy())` would then silently copy to clipboard — surprising them. `catch(() => {})` swallows the rejection without doing anything else.

## Visual confirmation for the clipboard path

Native share shows its own sheet — the OS handles feedback. But `clipboard.writeText` is silent. Without explicit feedback, the user doesn't know if it worked.

```js
function flashCopiedState() {
  const label = shareBtn.querySelector('span');
  const prev = label.textContent;
  shareBtn.classList.add('copied');
  label.textContent = 'Copied!';
  setTimeout(() => {
    shareBtn.classList.remove('copied');
    label.textContent = prev;
  }, 1600);
}
```

```css
.share-btn.copied {
  color: var(--accent);
  border-color: var(--accent);
}
```

## Include the URL, not just the score

"I scored 540!" → nobody can reach the game from that.
"I scored 540! https://yourgame.com" → link-preview in chat apps, one tap to play.

For games with deterministic seeds, include the seed param too (`?seed=20260417`) so the recipient plays the same daily challenge.

## Enrich the text with run context

<!-- added: 2026-04-17 (001-void-pulse sprint 42) -->

A bare score ("I scored 28500") is a naked number — the recipient has no frame of reference. What's "good"? Was this a hard run? Did you barely survive or crush it?

Pack 1–3 compact stats inline. The two highest-signal candidates:
- **Percentage of theoretical max** — "92%" tells the reader "nearly perfect." Much more evocative than the raw score.
- **Peak combo / tier** — "peak ×4" signals they hit the ceiling. Short, reads well.

Pattern:

```js
const stats = [];
if (state.maxPossibleScore > 0) {
  const p = Math.round((state.score / state.maxPossibleScore) * 100);
  stats.push(p + '%');
}
if (state.peakCombo >= 2) {     // only show if actually achieved
  stats.push('peak ×' + state.peakCombo);
}
const statStr = stats.length ? ' (' + stats.join(' · ') + ')' : '';
```

Output: `void-pulse · Daily Apr 17: 28500 (92% · peak ×4) — can you beat it? …`

### Rules for which stats to include

- **Only stats with real signal.** A stat that's 0 or at its minimum ("peak ×1") is noise — exclude it with a threshold. The enriched text should only contain interesting numbers.
- **Middle-dot (`·`) as separator, not comma.** Comma reads as list-of-things; middle-dot reads as terse-stat-line. Matches the gameover display convention if you use one.
- **Parentheses wrap the stats block.** "28500 (92% · peak ×4)" — the parens visually subordinate the stats to the primary score. Makes the hierarchy scannable.
- **Cap at ~3 stats.** More than that turns a shareable line into a wall of text. Pick the top 2–3 signal-per-character stats; keep the rest for the in-game stats panel.
- **Omit entirely on edge cases.** Zero runs, tutorial runs, runs where the chart didn't build (`maxPossibleScore === 0`). Falling back to a bare score is fine — better than lying with `0%`.

### Emoji ladders — consider but don't force

Wordle-style emoji grids (🟩🟨⬜) make shares *visually* distinctive — people spot them in feeds and recognize the game. For rhythm or chart-based games, you can compress the run to N chunks of 1–3 emoji each (green = perfect, yellow = good, red = missed, gray = hazard-passed).

Before adding:
- **Does your run have natural "chunks"?** Rhythm games chunk by bar; puzzle games by move; score games by interval. If the structure is continuous (endless runners), a ladder feels forced.
- **Will recipients render the emojis?** Modern devices yes, but some chat platforms strip or re-render. Test in 2–3 target surfaces before committing.
- **Does it save or add length?** A 30-emoji ladder costs ~30 characters vs a 2-stat summary's ~15. Don't ladder if the stats already tell the story.

### Tier-ladder pattern (void-pulse Sprint 50)

One specific ladder shape that works well for games with a multiplier/level-tier progression: **one cell per tier**, filled-or-unfilled, with a special glyph on the max-tier cell. Seven cells map to seven multiplier tiers:

```js
function buildTierLadder() {
  if (state.peakCombo < COMBO_STEP) return '';   // gate: no tier climbed
  const tiersReached = Math.min(7, Math.floor(state.peakCombo / COMBO_STEP) + 1);
  const cells = [];
  for (let i = 0; i < 7; i++) {
    if (i >= tiersReached) cells.push('⬜');
    else if (i === 6) cells.push('🌟');      // max-tier slot is starred
    else cells.push('🟩');
  }
  return cells.join('');
}

// In shareScore:
const ladder = buildTierLadder();
const base = headLine +
  (ladder ? '\n' + ladder : '') +
  '\n' + shareUrl();
```

Example outputs:
- Peak combo 0-4 (no tier climbed): no ladder line
- Peak combo 5: `🟩🟩⬜⬜⬜⬜⬜` (reached ×1.5)
- Peak combo 15: `🟩🟩🟩🟩⬜⬜⬜` (reached ×2.5)
- Peak combo 30+: `🟩🟩🟩🟩🟩🟩🌟` (reached ×4 max)

Why this shape works:
- **Fixed 7 cells, every time.** Recipients see the same grid shape run-to-run — they can compare at a glance. "Oh, this one climbed two fewer tiers than yours." That's the Wordle trick: fixed grid shape = instant peer comparison.
- **Max-tier special glyph (🌟) is the brag.** A full `🟩🟩🟩🟩🟩🟩🟩` row would read as "maxed" but without the hero-beat. The ⭐ cell is what gets screenshotted and reshared. Half the reason people share their Wordle is the yellow-to-green aha-cell; equivalent here is the star.
- **Gated on "climbed at least one tier" (`peakCombo >= COMBO_STEP`).** A one-cell-green ladder for someone who just scored once isn't brag-worthy; it's embarrassing. Omit entirely instead of showing `🟩⬜⬜⬜⬜⬜⬜`. Matches the "only stats with real signal" rule above.
- **Two-emoji vocabulary (🟩 + ⬜) plus a special glyph.** Three symbols max = universally rendered, visually distinct, no platform degradation. Don't use 4-5 emojis mapping to 4-5 hit-qualities — the palette saturates.

Anti-patterns to avoid in the tier-ladder variant:
- **Per-event ladder (emoji per pulse event)** → 40+ emojis, unreadable, blows up line length. Aggregate to tiers or time-buckets instead.
- **Theme-matching ladder colors** → 🟦 for void, 🟥 for sunset, 🟩 for forest. Sounds cute but (a) recipient doesn't know what theme you played, so the color is meaningless context-free; (b) multiplies the emoji vocabulary. Pick one neutral "filled" color (🟩 is the Wordle default for a reason) and stick with it.
- **Ladder without a head-line.** The ladder is decoration on top of a stat summary, not a replacement. Always pair with the score + % + peak-combo text so the ladder is context-enriching, not context-replacing.
- **Line-joining without `\n`.** Some share APIs preserve newlines (most do); some strip them (some SMS previews). The worst case is still legible because the ladder is on its own visual row; the best case gets the intended 3-line flex.
- **Forgetting the ⬜ cells.** A ladder of just `🟩🟩🟩` (3 cells for tier 3) loses the Wordle trick — recipients don't see the "how far to go" the ⬜ cells imply. Fixed grid shape with empty cells is what makes the comparison instant.

## Gate on `state.score > 0`

Don't offer to share a 0-score run. There's nothing to brag about, and the player typing "I scored 0" reads as mockery.

## Common mistakes

- **`navigator.share` without feature-check** → button dead on desktop
- **No clipboard fallback** → desktop users see a non-functional button
- **Silent clipboard write** → user doesn't know if it worked
- **Sharing without a URL** → recipient can't get to the game
- **Share button crowding the retry hint** → players accidentally tap share on the retry screen; keep the hierarchy (retry = main action, share = secondary)

<!-- added: 2026-04-17 (001-void-pulse sprint 6) -->
