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

## Gate on `state.score > 0`

Don't offer to share a 0-score run. There's nothing to brag about, and the player typing "I scored 0" reads as mockery.

## Common mistakes

- **`navigator.share` without feature-check** → button dead on desktop
- **No clipboard fallback** → desktop users see a non-functional button
- **Silent clipboard write** → user doesn't know if it worked
- **Sharing without a URL** → recipient can't get to the game
- **Share button crowding the retry hint** → players accidentally tap share on the retry screen; keep the hierarchy (retry = main action, share = secondary)

<!-- added: 2026-04-17 (001-void-pulse sprint 6) -->
