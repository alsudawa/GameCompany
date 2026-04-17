# Skill — Stats Export (Copy-as-Text Clipboard Flow)

<!-- added: 2026-04-17 (001-void-pulse, sprint 36) -->

**When to use:** your game has a lifetime-stats panel (aggregate counters, records, history) and players want to share, archive, or back up their numbers without you building an account system. A single "Copy as text" button produces a human-readable snapshot that pastes cleanly into a DM, tweet, or notes app.

Distinct from JSON export: this pattern targets *player* audience (readable brag text), not *developer* audience (structured import format). For developer/import needs, see the optional raw-JSON extension at the end.

Pairs with:
- `ux/lifetime-stats.md` — the underlying stats panel this exports from
- `ux/share.md` — score-share clipboard pattern this mirrors

## Contract

- **Copy-as-text is the primary affordance.** Most players want "numbers I can paste into Discord." JSON is secondary (nice-to-have, not the main flow).
- **Format tracks the visual layout of the stats card.** If the panel groups perfects/hits/misses on one row, the text puts them on one line. Lowers cognitive load for players recognizing their own card in export form.
- **Middle-dot (`·`) as inline separator, newlines between semantic groups.** Tight enough that runs+playtime read as one fact, loose enough that the overall shape stays scannable.
- **Hide the button until there's data.** Empty state (0 runs) → button hidden. Same rule as Reset — affordances appear once meaningful.
- **Mirror the existing clipboard-copy UX pattern.** If you already have a share-btn flow with `.copied` class + 1.6s label swap, match it exactly. Consistency beats novelty for one-off button interactions.
- **No confirmation step.** Export is non-destructive; no "are you sure" is needed. Distinguishes from Reset, which uses a two-step armed confirm.

## Pattern — HTML

```html
<div class="stats-actions">
  <button id="statsExport" class="stats-export-btn" type="button" hidden>Copy as text</button>
  <button id="statsReset"  class="stats-reset-btn"  type="button" hidden>Reset stats</button>
  <button id="statsPanelClose" class="btn stats-close" type="button">Close</button>
</div>
```

Order in the row: Export first (positive/safe), Reset next (destructive), Close last (exit). Keeps the positive-action on the left where eye-flow starts; destructive action immediately adjacent so players don't mistake one for the other.

## Pattern — CSS

```css
/* Shared shell for both Export and Reset so they visually match. Colors
   are the distinguishing cue — accent for Export (positive), danger for
   Reset (destructive). */
.stats-reset-btn, .stats-export-btn {
  background: transparent;
  border-radius: 8px;
  padding: 6px 12px;
  font-size: 11px;
  letter-spacing: .06em;
  text-transform: uppercase;
  cursor: pointer;
  transition: all .15s;
}
.stats-reset-btn  { border: 1px solid rgba(255, 61, 107, .35); color: rgba(255, 61, 107, .75); }
.stats-export-btn { border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
                    color: color-mix(in srgb, var(--accent) 85%, transparent); }

.stats-export-btn:hover, .stats-export-btn:focus-visible {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  color: var(--accent);
}
.stats-export-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.stats-export-btn.copied {
  background: color-mix(in srgb, var(--accent) 22%, transparent);
  color: #fff;
  border-color: var(--accent);
}
```

## Pattern — JS (format + copy)

```js
// Compose text that mirrors the card's visual groups. One line per row in
// the UI, inline separators for related facts (runs + playtime = one fact).
function formatStatsAsText(l) {
  const lines = [];
  lines.push('my-game — lifetime stats');
  lines.push('Runs: ' + l.runs.toLocaleString() + ' · Total play: ' + formatDuration(l.totalSeconds));
  lines.push('Best score: ' + l.best.toLocaleString() + ' · Peak combo: ' + l.peakCombo.toLocaleString());
  // ... one push per semantic group ...
  return lines.join('\n');
}

// Button handler — mirror the existing share-btn copy flow exactly.
if (statsExport) {
  statsExport.addEventListener('click', (e) => {
    e.stopPropagation();
    const text = formatStatsAsText(readLifetime());
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        const prev = statsExport.textContent;
        statsExport.classList.add('copied');
        statsExport.textContent = 'Copied!';
        setTimeout(() => {
          statsExport.classList.remove('copied');
          statsExport.textContent = prev;
        }, 1600);
      }).catch(() => {});
    }
  });
}

// In renderStats(), toggle the button's hidden attr alongside Reset:
if (statsExport) statsExport.hidden = (l.runs === 0);
```

## Format design heuristics

- **First line = title + game name.** Gives context when pasted somewhere without preamble. `"void-pulse — lifetime stats"` — parseable by a human in 0.3 seconds.
- **Group by semantic density.** Runs + total-play belong together (both describe session volume). Best-score + peak-combo belong together (both are records). Don't split those across lines just to balance line length.
- **Rates (% values) go on a dedicated line.** Mixing raw counts with percentages on the same line creates eye-parsing friction.
- **Dates at the end.** First/last played is context, not the headline — bottom of the block.
- **Skip meaningless lines when empty.** If `runs === 0`, skip the "Avg / run" line entirely (would read "Avg / run: NaN").

## Anti-patterns

- **JSON as the primary export format.** Raw JSON isn't readable — pasting `{"runs":42,"totalScore":18200,...}` into a DM looks broken. Only ship JSON if you're building an explicit import flow.
- **"Download file" without a copy option.** Most mobile browsers handle arbitrary file downloads awkwardly (saves to nowhere obvious, no preview). Clipboard is the mobile-first answer.
- **Separate Copy button per section.** Five buttons ("copy best score," "copy totals," ...) is choice overload. One button, whole snapshot.
- **Button visible in empty state.** Hiding until meaningful is a universal rule — applies here, applies to Reset, applies to Share.
- **Copy includes a link/URL.** The player already knows the game — adding `https://yourgame.com` to the snapshot is billboard behavior and makes them less likely to share.

## Optional extension — raw JSON for power users

Add a second button `<button id="statsExportJson">Copy as JSON</button>` that does `JSON.stringify(readLifetime(), null, 2)` and the same copy flow. Hide behind a "more" disclosure if you want to keep the main row uncluttered:

```html
<details class="stats-more">
  <summary>More export options</summary>
  <button id="statsExportJson" type="button">Copy as JSON</button>
</details>
```

Only ship this if you have a concrete import flow or a developer audience asking for it. For a casual game, the text copy is plenty.

## Accessibility

- **Button is focusable + labeled** ("Copy as text" is the visible text and acts as the accessible name).
- **Status feedback after copy** — the "Copied!" label swap is visible to sighted users, but silent to screen-reader users. If you have a live-region announcer, announce `'Stats copied to clipboard'` inside the `.then()` callback.
- **Keyboard accessible** — natural tab order places it before Reset and Close; Enter/Space activate per native `<button>` behavior.

## Cost

- HTML: 1 new button in the actions row
- CSS: ~15 lines (shared selector pattern; Export gets accent-palette fork)
- JS: ~25 lines (one format function + one event handler)
- 0 new dependencies, 0 new storage keys

## Verifying it works

1. Empty state (0 runs): stats panel opens, Export and Reset both hidden.
2. After one run: both buttons visible. Click Export → clipboard contains the multi-line snapshot.
3. Visual feedback: "Copy as text" → "Copied!" for 1.6s → reverts.
4. No-clipboard browser (rare, old): button visible but click does nothing — silent fall-through, no error.
5. Keyboard: tab to Export, Enter → copied; focus ring visible during the interaction.
6. Paste into any text field: one clean human-readable block, no weird escapes.
