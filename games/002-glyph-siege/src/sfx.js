// Web Audio SFX module. Oscillator + envelope recipes per sound-spec.md.
// Init on first user gesture; never before.

let ctx = null;
let master = null;
let delay = null;
let feedback = null;
let delayWet = null;
let muted = false;
let hitCombo = 0;
let hitComboUntil = 0;

function now() { return ctx ? ctx.currentTime : 0; }

export const Sfx = {
  init() {
    if (ctx) return;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.55;
      // one-tap delay for "reverb"
      delay = ctx.createDelay(0.5);
      delay.delayTime.value = 0.08;
      feedback = ctx.createGain();
      feedback.gain.value = 0.28;
      delayWet = ctx.createGain();
      delayWet.gain.value = 0.0;
      delay.connect(feedback).connect(delay);
      delay.connect(delayWet).connect(master);
      master.connect(ctx.destination);
    } catch (e) { ctx = null; }
  },
  setMuted(m) {
    muted = !!m;
    if (!ctx) return;
    if (muted) ctx.suspend && ctx.suspend();
    else ctx.resume && ctx.resume();
  },
  isMuted() { return muted; },
  _tone(freq, dur, type = 'sine', vol = 0.2, attack = 0.002, ramp = true, wet = 0.0) {
    if (!ctx || muted) return;
    const t = now();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    if (ramp) g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    else g.gain.setValueAtTime(0, t + dur);
    osc.connect(g).connect(master);
    if (wet > 0) { const w = ctx.createGain(); w.gain.value = wet; g.connect(w).connect(delay); }
    osc.start(t);
    osc.stop(t + dur + 0.02);
    return { osc, g };
  },
  _slide(fromHz, toHz, dur, type = 'sawtooth', vol = 0.18) {
    if (!ctx || muted) return;
    const t = now();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(fromHz, t);
    osc.frequency.linearRampToValueAtTime(toHz, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  },

  click()        { this._tone(660, 0.05, 'square', 0.12); },
  hit() {
    const now2 = performance.now();
    if (now2 > hitComboUntil) hitCombo = 0;
    hitCombo = Math.min(hitCombo + 1, 12);
    hitComboUntil = now2 + 1000;
    const f = 540 * Math.pow(1.06, hitCombo);
    this._tone(f, 0.07, 'triangle', 0.12);
  },
  kill(size = 1) {
    // larger size (heavy) = lower pitch thud
    const f = 200 - 40 * (size - 1);
    this._slide(f, f * 0.6, 0.18, 'sawtooth', 0.16);
  },
  gem(tier = 1) {
    const notes = { 1: 523, 2: 659, 3: 784 };
    this._tone(notes[tier] || 523, 0.12, 'sine', 0.12, 0.002, true, 0.3);
  },
  levelup() {
    if (!ctx || muted) return;
    const t = now();
    const notes = [523, 659, 784];
    notes.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = f;
      g.gain.setValueAtTime(0, t + i * 0.09);
      g.gain.linearRampToValueAtTime(0.18, t + i * 0.09 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.09 + 0.28);
      osc.connect(g).connect(master);
      const w = ctx.createGain(); w.gain.value = 0.35; g.connect(w).connect(delay);
      osc.start(t + i * 0.09);
      osc.stop(t + i * 0.09 + 0.3);
    });
  },
  pick() { this._tone(700, 0.08, 'triangle', 0.18, 0.002, true, 0.25); },
  bossSpawn() {
    if (!ctx || muted) return;
    this._tone(55, 1.2, 'sawtooth', 0.22);
    this._tone(82, 1.2, 'triangle', 0.1);
  },
  bossTelegraph() { this._slide(200, 400, 0.6, 'sawtooth', 0.14); },
  bossDown() {
    if (!ctx || muted) return;
    const t = now();
    const seq = [523, 659, 784, 1047];
    seq.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = f;
      g.gain.setValueAtTime(0, t + i * 0.12);
      g.gain.linearRampToValueAtTime(0.22, t + i * 0.12 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.12 + 0.35);
      osc.connect(g).connect(master);
      const w = ctx.createGain(); w.gain.value = 0.4; g.connect(w).connect(delay);
      osc.start(t + i * 0.12);
      osc.stop(t + i * 0.12 + 0.38);
    });
  },
  hurt()     { this._slide(220, 170, 0.18, 'sawtooth', 0.2); },
  gameover() { this._slide(160, 70, 0.7, 'sawtooth', 0.22); },
  spawnTick(){ this._tone(520, 0.035, 'sine', 0.04); },
  newBest()  { this._tone(1047, 0.35, 'triangle', 0.2, 0.005, true, 0.4); },
  countdown(n){ this._tone(440 + n * 120, 0.15, 'triangle', 0.2); },
  nova() {
    // whoosh: fast up-slide sine + noise-ish sawtooth
    this._slide(180, 420, 0.22, 'sine', 0.2);
    this._slide(80, 40, 0.28, 'sawtooth', 0.12);
  },
  bomb() {
    // big boom: descending sawtooth + short bass thump
    this._slide(520, 60, 0.55, 'sawtooth', 0.3);
    this._tone(45, 0.5, 'sine', 0.22);
  },
  bombPickup() { this._tone(880, 0.12, 'triangle', 0.2, 0.002, true, 0.35); this._tone(1174, 0.14, 'triangle', 0.18, 0.002, true, 0.35); },
};
