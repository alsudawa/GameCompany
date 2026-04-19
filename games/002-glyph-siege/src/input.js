import { state } from './state.js';
import { W, H } from './constants.js';

// Floating virtual joystick for touch; WASD/arrows for keyboard.
// Writes unit-direction vector to state.input.

const JOY_RADIUS = 60;
const keys = new Set();

export function installInput(canvas) {
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('lostpointercapture', onUp);

  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', () => keys.clear());
}

function canvasCoord(e, canvas) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = W / rect.width;
  const scaleY = H / rect.height;
  return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
}

function onDown(e) {
  if (!state.running || state.paused || state.over) return;
  const canvas = e.currentTarget;
  canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
  const p = canvasCoord(e, canvas);
  state.input.active = true;
  state.input.originX = p.x;
  state.input.originY = p.y;
  state.input.curX = p.x;
  state.input.curY = p.y;
  recompute();
  e.preventDefault();
}

function onMove(e) {
  if (!state.input.active) return;
  const canvas = e.currentTarget;
  const p = canvasCoord(e, canvas);
  state.input.curX = p.x;
  state.input.curY = p.y;
  recompute();
}

function onUp(e) {
  state.input.active = false;
  state.input.dx = 0;
  state.input.dy = 0;
  state.input.mag = 0;
}

function recompute() {
  const dx = state.input.curX - state.input.originX;
  const dy = state.input.curY - state.input.originY;
  const d = Math.hypot(dx, dy);
  if (d < 6) { state.input.dx = 0; state.input.dy = 0; state.input.mag = 0; return; }
  const clamped = Math.min(d, JOY_RADIUS);
  const mag = clamped / JOY_RADIUS;
  state.input.dx = dx / d;
  state.input.dy = dy / d;
  state.input.mag = mag;
}

function onKey(e) {
  if (e.code === 'KeyM' || e.code === 'Escape') return; // handled in ui
  const map = {
    ArrowUp: 'U', ArrowDown: 'D', ArrowLeft: 'L', ArrowRight: 'R',
    KeyW: 'U', KeyS: 'D', KeyA: 'L', KeyD: 'R',
  };
  const k = map[e.code];
  if (k) { keys.add(k); recomputeKeyboard(); e.preventDefault(); }
}

function onKeyUp(e) {
  const map = {
    ArrowUp: 'U', ArrowDown: 'D', ArrowLeft: 'L', ArrowRight: 'R',
    KeyW: 'U', KeyS: 'D', KeyA: 'L', KeyD: 'R',
  };
  const k = map[e.code];
  if (k) { keys.delete(k); recomputeKeyboard(); }
}

function recomputeKeyboard() {
  if (state.input.active) return; // touch takes precedence
  let dx = 0, dy = 0;
  if (keys.has('L')) dx -= 1;
  if (keys.has('R')) dx += 1;
  if (keys.has('U')) dy -= 1;
  if (keys.has('D')) dy += 1;
  if (dx === 0 && dy === 0) { state.input.dx = 0; state.input.dy = 0; state.input.mag = 0; return; }
  const d = Math.hypot(dx, dy);
  state.input.dx = dx / d;
  state.input.dy = dy / d;
  state.input.mag = 1;
}

export function drawJoystick(ctx) {
  if (!state.input.active) return;
  const { originX, originY, curX, curY } = state.input;
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = '#7cf6ff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(originX, originY, JOY_RADIUS, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = '#7cf6ff';
  ctx.beginPath();
  ctx.arc(curX, curY, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
