// Процедурный звук на WebAudio — без внешних файлов
import { G, clamp } from './state.js';

let ctx = null, master = null, noiseBuf = null;
let staticNode = null, huntNodes = null, windNodes = null;

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  startWind();
}

export function suspendAudio(s) {
  if (!ctx) return;
  if (s) ctx.suspend(); else ctx.resume();
}

function out(vol = 1, pan = 0) {
  const g = ctx.createGain();
  g.gain.value = vol;
  if (ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.value = clamp(pan, -1, 1);
    g.connect(p); p.connect(master);
  } else g.connect(master);
  return g;
}

// громкость и панорама относительно игрока
export function spatial(x, z, maxD = 18) {
  const p = G.player;
  const dx = x - p.x, dz = z - p.z;
  const d = Math.hypot(dx, dz);
  const vol = Math.pow(clamp(1 - d / maxD, 0, 1), 1.6);
  // правый вектор камеры
  const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
  const pan = d > 0.01 ? (dx * rx + dz * rz) / d : 0;
  return { vol, pan: pan * 0.8, d };
}

function noise(dur, vol, pan, filterType, freq, q = 1, attack = 0.005) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = filterType; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(vol, 0.0002), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f); f.connect(g); g.connect(out(1, pan));
  src.start(t, Math.random()); src.stop(t + dur + 0.05);
  return f;
}

function tone(freq, dur, vol, type = 'sine', pan = 0, slideTo = null, attack = 0.01) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(vol, 0.0002), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(out(1, pan));
  o.start(t); o.stop(t + dur + 0.05);
}

export const sfx = {
  step(vol = 0.3, pan = 0) {
    noise(0.12, vol * 0.5, pan, 'lowpass', 500, 1);
    tone(70, 0.15, vol * 0.6, 'sine', pan, 40);
  },
  ghostStep(x, z) {
    const s = spatial(x, z, 22);
    if (s.vol < 0.01) return;
    noise(0.2, s.vol * 0.9, s.pan, 'lowpass', 300, 2);
    tone(55, 0.25, s.vol * 1.0, 'sine', s.pan, 35);
  },
  door(x, z, slam = false) {
    const s = spatial(x, z);
    if (s.vol < 0.01) return;
    if (slam) { noise(0.35, s.vol, s.pan, 'lowpass', 900, 1); tone(60, 0.4, s.vol, 'sine', s.pan, 30); }
    else tone(rnd(300, 500), 0.6, s.vol * 0.12, 'sawtooth', s.pan, rnd(150, 250), 0.1);
  },
  click(x, z) {
    const s = x === undefined ? { vol: 0.6, pan: 0 } : spatial(x, z);
    noise(0.04, s.vol * 0.5, s.pan, 'highpass', 2000, 1);
  },
  knock(x, z) {
    const s = spatial(x, z, 20);
    for (let i = 0; i < 3; i++) setTimeout(() => { noise(0.1, s.vol * 0.8, s.pan, 'lowpass', 700, 3); tone(110, 0.1, s.vol * 0.5, 'sine', s.pan); }, i * 220);
  },
  thud(x, z) {
    const s = spatial(x, z, 20);
    noise(0.25, s.vol * 0.8, s.pan, 'lowpass', 600, 1);
    tone(rnd(200, 800), 0.15, s.vol * 0.15, 'triangle', s.pan);
  },
  beep(level) {
    const f = [0, 600, 750, 900, 1100, 1400][level] || 600;
    tone(f, 0.08, level >= 5 ? 0.25 : 0.12, 'square');
  },
  motion(x, z) {
    const s = spatial(x, z, 25);
    tone(1200, 0.15, s.vol * 0.2 + 0.03, 'square', s.pan);
    setTimeout(() => tone(900, 0.15, s.vol * 0.2 + 0.03, 'square', s.pan), 180);
  },
  whisper(x, z) {
    const s = spatial(x, z, 14);
    if (s.vol < 0.01) return;
    const f = noise(1.6, s.vol * 0.35, s.pan, 'bandpass', 2400, 6, 0.3);
    if (f) f.frequency.linearRampToValueAtTime(1200, ctx.currentTime + 1.5);
  },
  breath(x, z) {
    const s = spatial(x, z, 10);
    noise(1.2, s.vol * 0.25, s.pan, 'bandpass', 700, 2, 0.5);
  },
  scream() {
    tone(900, 1.4, 0.35, 'sawtooth', 0, 120, 0.02);
    tone(950, 1.4, 0.25, 'square', 0, 100, 0.02);
    noise(1.5, 0.5, 0, 'bandpass', 1500, 1, 0.02);
  },
  shutter() {
    noise(0.05, 0.6, 0, 'highpass', 3000, 1);
    setTimeout(() => noise(0.08, 0.4, 0, 'highpass', 2000, 1), 70);
  },
  sizzle(x, z) {
    const s = spatial(x, z, 20);
    noise(1.5, s.vol * 0.5 + 0.05, s.pan, 'highpass', 4000, 1, 0.05);
  },
  ghostVoice(x, z) {
    const s = spatial(x, z, 10);
    tone(rnd(90, 140), 0.9, 0.25, 'sawtooth', s.pan, rnd(60, 90), 0.1);
    noise(0.9, 0.3, s.pan, 'bandpass', 900, 4, 0.1);
  },
  pills() { tone(500, 0.08, 0.15, 'triangle'); setTimeout(() => tone(700, 0.1, 0.12, 'triangle'), 90); },
  heartbeat(vol) {
    tone(55, 0.12, vol, 'sine', 0, 40);
    setTimeout(() => tone(50, 0.14, vol * 0.8, 'sine', 0, 35), 180);
  },
  lightBuzz(x, z) {
    const s = spatial(x, z, 10);
    tone(120, 0.2, s.vol * 0.06, 'sawtooth', s.pan);
  },
  breaker(on) { noise(0.15, 0.5, 0, 'lowpass', 800, 2); tone(on ? 200 : 80, 0.3, 0.2, 'sawtooth'); },
  singing(x, z) {
    const s = spatial(x, z, 16);
    if (s.vol < 0.01) return;
    const notes = [392, 349, 330, 294, 330];
    notes.forEach((n, i) => setTimeout(() => tone(n, 0.5, s.vol * 0.08, 'sine', s.pan, null, 0.15), i * 450));
  },
};

function rnd(a, b) { return a + Math.random() * (b - a); }

// --- Петли: помехи радиоприёмника, охота, ветер ---
export function setStatic(on) {
  if (!ctx) return;
  if (on && !staticNode) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.7;
    const g = ctx.createGain(); g.gain.value = 0.07;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 7;
    const lg = ctx.createGain(); lg.gain.value = 900;
    lfo.connect(lg); lg.connect(f.frequency);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(); lfo.start();
    staticNode = { src, lfo, g };
  } else if (!on && staticNode) {
    staticNode.src.stop(); staticNode.lfo.stop();
    staticNode = null;
  }
}

export function setHuntAudio(on) {
  if (!ctx) return;
  if (on && !huntNodes) {
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 43;
    const o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = 46.5;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 220;
    const g = ctx.createGain(); g.gain.value = 0.0;
    g.gain.linearRampToValueAtTime(0.16, ctx.currentTime + 1.5);
    o1.connect(f); o2.connect(f); f.connect(g); g.connect(master);
    o1.start(); o2.start();
    huntNodes = { o1, o2, g };
  } else if (!on && huntNodes) {
    const n = huntNodes; huntNodes = null;
    n.g.gain.linearRampToValueAtTime(0.0, ctx.currentTime + 0.8);
    setTimeout(() => { n.o1.stop(); n.o2.stop(); }, 900);
  }
}

export function setHuntIntensity(v) {
  if (huntNodes && ctx) huntNodes.g.gain.setTargetAtTime(0.06 + v * 0.2, ctx.currentTime, 0.2);
}

function startWind() {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf; src.loop = true;
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 350;
  const g = ctx.createGain(); g.gain.value = 0.035;
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.08;
  const lg = ctx.createGain(); lg.gain.value = 0.025;
  lfo.connect(lg); lg.connect(g.gain);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(); lfo.start();
  windNodes = { g };
}

export function setWindIndoor(indoor) {
  if (windNodes && ctx) windNodes.g.gain.setTargetAtTime(indoor ? 0.012 : 0.035, ctx.currentTime, 0.5);
}

// голос призрака через синтез речи (если доступен)
export function speak(text) {
  try {
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ru-RU'; u.pitch = 0.1; u.rate = 0.6; u.volume = 0.9;
    window.speechSynthesis.speak(u);
  } catch (e) { /* ignore */ }
}
