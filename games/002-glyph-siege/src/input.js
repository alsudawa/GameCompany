import { state } from './state.js';
import { W, H } from './constants.js';

// Touch-first virtual joystick. Priorities in order:
//   1. Responsive — tiny dead zone, no mushy "first pixels"
//   2. Snappy — short pull-to-max distance + easing curve
//   3. Reliable — window-level move/up capture so off-canvas drags don't break
//   4. Sticky — if the finger drags past the outer ring, origin follows so
//      the player can steer without ever lifting
//
// Keyboard: WASD / arrows as 8-way unit vector (magnitude 1). Touch preempts.

const JOY_RADIUS = 48;          // pull distance for MAX speed
const JOY_DEADZONE = 3;         // below this, no movement
const JOY_STICKY = 80;          // past this, origin follows the finger
const MAG_CURVE = 1 / 1.6;      // <1 makes mid-pull feel already fast

const keys = new Set();
let canvasRef = null;
let activePointerId = null;

export function installInput(canvas) {
  canvasRef = canvas;
  canvas.addEventListener('pointerdown', onDown, { passive: false });
  // Window-level move/up so off-canvas dragging stays tracked
  window.addEventListener('pointermove', onMove, { passive: false });
  window.addEventListener('pointerup', onUp, { passive: false });
  window.addEventListener('pointercancel', onUp, { passive: false });

  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', () => { keys.clear(); resetKeyboard(); });
  // Touch pinch/zoom prevention
  canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  canvas.addEventListener('touchmove',  (e) => e.preventDefault(), { passive: false });
}

function canvasCoord(e) {
  const rect = canvasRef.getBoundingClientRect();
  const scaleX = W / rect.width;
  const scaleY = H / rect.height;
  return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
}

function onDown(e) {
  if (!state.running || state.paused || state.over) return;
  if (activePointerId !== null) return; // ignore secondary touches
  activePointerId = e.pointerId;
  canvasRef.setPointerCapture && canvasRef.setPointerCapture(e.pointerId);
  const p = canvasCoord(e);
  // Clamp origin inside a safe zone so the ring always fits on screen
  const margin = JOY_RADIUS + 16;
  const ox = Math.max(margin, Math.min(W - margin, p.x));
  const oy = Math.max(margin, Math.min(H - margin, p.y));
  state.input.active = true;
  state.input.originX = ox;
  state.input.originY = oy;
  state.input.curX = p.x;
  state.input.curY = p.y;
  recompute();
  e.preventDefault();
}

function onMove(e) {
  if (!state.input.active) return;
  if (activePointerId !== null && e.pointerId !== activePointerId) return;
  const p = canvasCoord(e);
  state.input.curX = p.x;
  state.input.curY = p.y;
  // sticky origin: if the finger pulls past JOY_STICKY, drag origin along
  const dx = p.x - state.input.originX;
  const dy = p.y - state.input.originY;
  const d = Math.hypot(dx, dy);
  if (d > JOY_STICKY) {
    const overflow = d - JOY_STICKY;
    state.input.originX += (dx / d) * overflow;
    state.input.originY += (dy / d) * overflow;
  }
  recompute();
  e.preventDefault && e.preventDefault();
}

function onUp(e) {
  if (activePointerId !== null && e.pointerId !== activePointerId) return;
  activePointerId = null;
  state.input.active = false;
  state.input.dx = 0;
  state.input.dy = 0;
  state.input.mag = 0;
}

function recompute() {
  const dx = state.input.curX - state.input.originX;
  const dy = state.input.curY - state.input.originY;
  const d = Math.hypot(dx, dy);
  if (d < JOY_DEADZONE) {
    state.input.dx = 0; state.input.dy = 0; state.input.mag = 0;
    return;
  }
  const raw = Math.min(d, JOY_RADIUS) / JOY_RADIUS;
  state.input.dx = dx / d;
  state.input.dy = dy / d;
  state.input.mag = Math.pow(raw, MAG_CURVE);  // snappier mid-pull
}

function onKey(e) {
  if (e.code === 'KeyM' || e.code === 'Escape') return;
  const k = keyMap[e.code];
  if (k) { keys.add(k); recomputeKeyboard(); e.preventDefault(); }
}

function onKeyUp(e) {
  const k = keyMap[e.code];
  if (k) { keys.delete(k); recomputeKeyboard(); }
}

const keyMap = {
  ArrowUp: 'U', ArrowDown: 'D', ArrowLeft: 'L', ArrowRight: 'R',
  KeyW: 'U', KeyS: 'D', KeyA: 'L', KeyD: 'R',
};

function recomputeKeyboard() {
  if (state.input.active) return; // touch preempts
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

export function drawJoystick(ctx) {
  if (!state.input.active) return;
  const { originX, originY, curX, curY } = state.input;
  const dx = curX - originX, dy = curY - originY;
  const d = Math.hypot(dx, dy);
  const mag = Math.min(d, JOY_RADIUS) / JOY_RADIUS;
  const knobX = d > 0 ? originX + (dx / d) * Math.min(d, JOY_RADIUS) : originX;
  const knobY = d > 0 ? originY + (dy / d) * Math.min(d, JOY_RADIUS) : originY;
  ctx.save();
  // outer ring
  ctx.globalAlpha = 0.28;
  ctx.strokeStyle = '#8feaff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(originX, originY, JOY_RADIUS, 0, Math.PI * 2);
  ctx.stroke();
  // inner dead-zone indicator
  ctx.globalAlpha = 0.18;
  ctx.beginPath();
  ctx.arc(originX, originY, JOY_DEADZONE + 2, 0, Math.PI * 2);
  ctx.stroke();
  // knob with glow scaling by pull
  ctx.globalAlpha = 0.55 + mag * 0.35;
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = '#8feaff';
  ctx.shadowColor = '#8feaff';
  ctx.shadowBlur = 8 + mag * 10;
  ctx.beginPath();
  ctx.arc(knobX, knobY, 12 + mag * 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
