# Skill — Discoverable Help Modal (`?` Key + Auto-Pause)

**When to use:** any game that has accumulated >3 hidden mechanics (combo multipliers, pity life, daily seeded mode, death-cam, polyrhythm spawns…). Each individual feature is small, but together they form invisible folklore that returning players forgot and new players never knew.

A `?` shortcut + an auto-paused help modal is the cheapest discoverability lever:
- Returning players hit `?` to remind themselves what the combo bar fills toward.
- New players notice the `?` button next to mute and skim.
- Streamers explaining the game on-camera have a one-keystroke explainer.

## Pattern — modal + key + visible button + auto-pause

Three entry points (button, `?` key, `Esc` key to close), one auto-pause for safety:

```js
const helpEl = document.getElementById('help');
const helpBtn = document.getElementById('helpBtn');
const helpClose = document.getElementById('helpClose');
let helpOpenedDuringRun = false;

function openHelp() {
  if (!helpEl.classList.contains('hidden')) return;
  helpOpenedDuringRun = state.running && !state.over && !state.paused;
  if (helpOpenedDuringRun) pauseGame();
  helpEl.classList.remove('hidden'); helpEl.classList.add('visible');
  helpEl.setAttribute('aria-hidden', 'false');
  helpClose.focus();
  Sfx.setBus('duck');
}
function closeHelp() {
  if (helpEl.classList.contains('hidden')) return;
  helpEl.classList.remove('visible'); helpEl.classList.add('hidden');
  helpEl.setAttribute('aria-hidden', 'true');
  if (helpOpenedDuringRun && state.paused && !state.resumeAt) {
    beginResumeCountdown();   // resume with the standard 3-2-1
  } else if (state.over) {
    Sfx.setBus('duck');
  } else if (state.running) {
    Sfx.setBus(hudScoreBeaten ? 'beaten' : 'normal');
  } else {
    Sfx.setBus('normal');
  }
  helpOpenedDuringRun = false;
}

helpBtn.addEventListener('click', (e) => { e.stopPropagation(); openHelp(); });
helpClose.addEventListener('click', (e) => { e.stopPropagation(); closeHelp(); });
helpEl.addEventListener('click', (e) => { if (e.target === helpEl) closeHelp(); });

document.addEventListener('keydown', (e) => {
  if ((e.key === '?' || (e.key === '/' && e.shiftKey)) && !inField) {
    e.preventDefault();
    if (helpEl.classList.contains('hidden')) openHelp(); else closeHelp();
    return;
  }
  if (e.key === 'Escape' && !helpEl.classList.contains('hidden')) {
    e.preventDefault(); closeHelp(); return;
  }
});
```

Five rules that make this feel right:
1. **Auto-pause if a run is active when help opens.** Players shouldn't lose lives reading a help screen.
2. **Resume with the standard 3-2-1 countdown after close.** Same UX as tab-return, so the player has a brace moment to refocus.
3. **Backdrop click closes** (`if (e.target === helpEl) closeHelp()`) — modal convention since iOS popularized it.
4. **`Esc` closes when open.** Adopt `Esc` only for help dismissal, not as a global game-stop key (which would compete with browser fullscreen exit).
5. **Track `helpOpenedDuringRun`** — if the user opened help from the start screen or gameover, don't auto-resume on close; only auto-resume if the *help itself* induced the pause.

## Pattern — `?` key shortcut (US + non-US layouts)

`?` is `Shift+/` on US/UK QWERTY, but on AZERTY it's `Shift+,`. Trying to handle every layout via `e.code` is a losing battle. The pragmatic move:

```js
if (e.key === '?' || (e.key === '/' && e.shiftKey)) { /* open help */ }
```

`e.key === '?'` handles every layout where the OS produces the `?` character. The `/` + Shift fallback catches the few US-quirk cases where `e.key` reports `/` instead of `?`. This covers ~99% of users. If a player can't open help with the keyboard, the visible `?` button still works.

## Layout — what to put in the modal

Keep it scannable. Use a 2-column grid: left = trigger/cue, right = consequence. Group by mechanic:

```html
<ul class="help-list">
  <li><span class="help-key">tap / Space</span><span>when the pulse aligns with the ring</span></li>
  <li><span class="help-key">center hit</span><span>= <em>perfect</em>: full score, +1 combo</span></li>
  <li><span class="help-key">red dashed pulse</span><span>= heartbeat: ×1.5 score</span></li>
  <li><span class="help-key">combo bar</span><span>fills toward the next ×multiplier (cap ×4)</span></li>
  <li><span class="help-key">3 lives</span><span>die fast 3x in a row → next run grants +1 gold life</span></li>
  <li><span class="help-key">daily mode</span><span><code>?daily=1</code> — same sequence for everyone today</span></li>
</ul>
```

Six to eight rows max. If you need more, the game has too many invisible mechanics — consider unifying or removing one.

## Visible help button — sit next to mute

```css
.help-btn {
  top: 14px;
  right: 60px;            /* one button width + gap to the left of mute */
}
```

The eye expects icon-buttons in the top-right corner. Don't hide the help button in a corner the player won't look at. ~36px square, ~10px gap from the next button, same visual weight as mute.

## Common mistakes

- **No auto-pause** → player loses lives while reading help; fastest way to get a 1-star review.
- **No backdrop click** → players who don't see the close button feel trapped.
- **Modal triggers off `e.code === 'Slash'` only** → AZERTY/Dvorak users can't open help with the keyboard.
- **No focus restoration** → focus stays on the close button after dismiss; restoring to the previously-focused element is nice but not required for casual games.
- **Long prose paragraphs** → players bounce in 3 seconds. Use rows or icons, not sentences.
- **Forgetting to gate other shortcuts when help is open** — e.g. P (pause) firing while help is up creates a weird state. Add `if (!helpEl.classList.contains('hidden')) return;` to gameplay shortcuts.

<!-- added: 2026-04-17 (001-void-pulse sprint 11) -->
