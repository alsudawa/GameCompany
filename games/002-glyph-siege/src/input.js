import { state } from './state.js';

// Touch-first FIXED virtual joystick. The pad is an HTML element at
// bottom-left of the screen (styled in style.css). Only touches inside the
// pad activate steering — the rest of the screen is reserved for bomb button,
// HUD, and (eventually) decorations. Keyboard: WASD / arrows unchanged.

const JOY_RADIUS = 50;          // px from pad center to MAX-speed ring
const JOY_DEADZONE = 4;
const MAG_CURVE = 1 / 1.6;

const keys = new Set();
let padEl = null;
let knobEl = null;
let padCenter = { x: 0, y: 0 };
let activePointerId = null;

export function installInput(_canvas) {
  padEl = document.getElementById('joypad');
  knobEl = document.getElementById('joyknob');
  if (padEl) {
    padEl.addEventListener('pointerdown', onDown, { passive: false });
    // window-level capture so drags past the pad boundary still read
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp, { passive: false });
    window.addEventListener('pointercancel', onUp, { passive: false });
  }
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', () => { keys.clear(); resetKeyboard(); releaseJoy(); });
  // iOS: prevent page scroll/zoom when swiping inside game
  document.addEventListener('touchmove', (e) => {
    if (e.target === padEl || (padEl && padEl.contains(e.target))) e.preventDefault();
  }, { passive: false });
}

function refreshPadCenter() {
  if (!padEl) return;
  const r = padEl.getBoundingClientRect();
  padCenter.x = r.left + r.width / 2;
  padCenter.y = r.top + r.height / 2;
}

function onDown(e) {
  if (!state.running || state.paused || state.over) return;
  if (activePointerId !== null) return;
  activePointerId = e.pointerId;
  padEl.setPointerCapture && padEl.setPointerCapture(e.pointerId);
  padEl.classList.add('active');
  refreshPadCenter();
  state.input.active = true;
  update(e.clientX, e.clientY);
  e.preventDefault();
}

function onMove(e) {
  if (!state.input.active) return;
  if (activePointerId !== null && e.pointerId !== activePointerId) return;
  update(e.clientX, e.clientY);
  e.preventDefault && e.preventDefault();
}

function onUp(e) {
  if (activePointerId !== null && e.pointerId !== activePointerId) return;
  releaseJoy();
}

function releaseJoy() {
  activePointerId = null;
  state.input.active = false;
  state.input.dx = 0;
  state.input.dy = 0;
  state.input.mag = 0;
  if (padEl) padEl.classList.remove('active');
  if (knobEl) knobEl.style.transform = 'translate(0,0)';
}

function update(clientX, clientY) {
  const dx = clientX - padCenter.x;
  const dy = clientY - padCenter.y;
  const d = Math.hypot(dx, dy);
  if (d < JOY_DEADZONE) {
    state.input.dx = 0; state.input.dy = 0; state.input.mag = 0;
    if (knobEl) knobEl.style.transform = 'translate(0,0)';
    return;
  }
  const clamped = Math.min(d, JOY_RADIUS);
  const raw = clamped / JOY_RADIUS;
  const nx = dx / d, ny = dy / d;
  state.input.dx = nx;
  state.input.dy = ny;
  state.input.mag = Math.pow(raw, MAG_CURVE);
  if (knobEl) {
    const kx = nx * clamped;
    const ky = ny * clamped;
    knobEl.style.transform = `translate(${kx.toFixed(1)}px, ${ky.toFixed(1)}px)`;
  }
}

// ---------- Keyboard (desktop parity) ----------
const keyMap = {
  ArrowUp: 'U', ArrowDown: 'D', ArrowLeft: 'L', ArrowRight: 'R',
  KeyW: 'U', KeyS: 'D', KeyA: 'L', KeyD: 'R',
};

function onKey(e) {
  if (e.code === 'KeyM' || e.code === 'Escape') return;
  const k = keyMap[e.code];
  if (k) { keys.add(k); recomputeKeyboard(); e.preventDefault(); }
}

function onKeyUp(e) {
  const k = keyMap[e.code];
  if (k) { keys.delete(k); recomputeKeyboard(); }
}

function recomputeKeyboard() {
  if (state.input.active) return;
  let dx = 0, dy = 0;
  if (keys.has('L')) dx -= 1;
  if (keys.has('R')) dx += 1;
  if (keys.has('U')) dy -= 1;
  if (keys.has('D')) dy += 1;
  if (dx === 0 && dy === 0) { resetKeyboard(); return; }
  const d = Math.hypot(dx, dy);
  state.input.dx = dx / d;
  state.input.dy = dy / d;
  state.input.mag = 1;
}

function resetKeyboard() {
  if (!state.input.active) {
    state.input.dx = 0; state.input.dy = 0; state.input.mag = 0;
  }
}

// Canvas no longer draws the joystick — the HTML pad is the visual.
export function drawJoystick(_ctx) { /* noop — HTML pad is the visual */ }
