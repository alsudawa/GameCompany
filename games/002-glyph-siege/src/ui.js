import { state, player } from './state.js';
import { Sfx } from './sfx.js';

function fmtTime(t) {
  const s = Math.floor(t);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function updateHud(doms) {
  doms.timer.textContent = fmtTime(state.t);
  doms.kills.textContent = `× ${state.kills}`;
  doms.level.textContent = `Lv ${state.level}`;
  const pct = Math.max(0, Math.min(1, state.xp / state.xpNeeded));
  doms.xpfill.style.width = `${pct * 100}%`;
  renderHearts(doms.hearts);
  renderBombBtn(doms);
}

function renderBombBtn(doms) {
  const btn = doms.bombBtn;
  if (!btn) return;
  if (state.bombs > 0) {
    btn.classList.remove('hidden');
    btn.classList.toggle('pulse', state.bombs > 0);
    const countEl = btn.querySelector('.count');
    if (countEl) countEl.textContent = state.bombs;
  } else {
    btn.classList.add('hidden');
    btn.classList.remove('pulse');
  }
}

const HEART_SVG = '<svg viewBox="0 0 24 24"><path d="M12 21.2 C 5 17 1.5 13.5 1.5 9 a5.5 5.5 0 0 1 10.5 -2.4 A 5.5 5.5 0 0 1 22.5 9 c 0 4.5 -3.5 8 -10.5 12.2 z" fill="currentColor" stroke="rgba(0,0,0,0.4)" stroke-width="1.2"/></svg>';

function renderHearts(el) {
  const max = player.hpMax;
  const cur = player.hp;
  if (el.children.length !== max) {
    el.innerHTML = '';
    for (let i = 0; i < max; i++) {
      const d = document.createElement('div');
      d.className = 'heart';
      d.innerHTML = HEART_SVG;
      el.appendChild(d);
    }
  }
  const kids = el.children;
  for (let i = 0; i < kids.length; i++) {
    const full = i < cur;
    kids[i].classList.toggle('empty', !full);
  }
}

export function setupUiButtons(doms, fns) {
  doms.start.addEventListener('click', () => { Sfx.init(); fns.start(); });
  doms.retry.addEventListener('click', () => { Sfx.init(); fns.start(); });
  doms.resumeBtn.addEventListener('click', () => fns.resume());
  doms.muteBtn.addEventListener('click', () => fns.toggleMute());
  doms.pauseBtn.addEventListener('click', () => fns.togglePause());
  if (doms.bombBtn) {
    let lastBomb = 0;
    const bombTrigger = (e) => {
      e.preventDefault();
      const now = performance.now();
      if (now - lastBomb < 220) return;   // debounce against double-fire
      lastBomb = now;
      fns.detonateBomb();
    };
    // pointerdown fires immediately on touch (no 300ms delay).
    doms.bombBtn.addEventListener('pointerdown', bombTrigger);
    // click as a safety net for desktop / a11y (debounced, won't double-fire).
    doms.bombBtn.addEventListener('click', bombTrigger);
  }
  doms.bootReset.addEventListener('click', () => {
    try { localStorage.clear(); } catch (e) {}
    location.reload();
  });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyM') fns.toggleMute();
    if (e.code === 'Escape') fns.togglePause();
    if (e.code === 'KeyB') { e.preventDefault(); fns.detonateBomb(); }
    if (e.code === 'Space' || e.code === 'Enter') {
      if (doms.overlay.classList.contains('visible')) { e.preventDefault(); fns.start(); }
      else if (doms.gameover.classList.contains('visible')) { e.preventDefault(); fns.start(); }
      else if (doms.pauseOverlay.classList.contains('visible')) { e.preventDefault(); fns.resume(); }
    }
  });
}

export function showGameOver(doms, best, isNewBest) {
  doms.statTime.textContent = `${Math.floor(state.t)}s`;
  doms.statKills.textContent = state.kills;
  doms.statLevel.textContent = state.level;
  doms.finalScore.textContent = state.score;
  doms.bestBadge.classList.toggle('hidden', !isNewBest);
  doms.gameover.classList.remove('hidden');
  doms.gameover.classList.add('visible');
  if (isNewBest) {
    Sfx.newBest();
    try { navigator.vibrate && navigator.vibrate([40, 40, 80]); } catch (e) {}
  }
}

export function hideGameOver(doms) {
  doms.gameover.classList.replace('visible', 'hidden');
}

export function hideStart(doms) {
  doms.overlay.classList.replace('visible', 'hidden');
}

export function setMutedUi(doms, muted) {
  doms.muteBtn.classList.toggle('muted', muted);
  doms.muteBtn.setAttribute('aria-pressed', muted ? 'true' : 'false');
}

export function runCountdown(doms, onDone) {
  let n = 3;
  doms.countdown.classList.remove('hidden');
  const step = () => {
    doms.countdown.textContent = n;
    doms.countdown.classList.remove('animating');
    void doms.countdown.offsetWidth;
    doms.countdown.classList.add('animating');
    Sfx.countdown(3 - n);
    n--;
    if (n < 0) {
      doms.countdown.classList.add('hidden');
      doms.countdown.classList.remove('animating');
      onDone();
    } else {
      setTimeout(step, 700);
    }
  };
  step();
}
