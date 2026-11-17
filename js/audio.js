// Процедурный 3D-звук на WebAudio: HRTF-панорама, реверберация, заглушение стенами.
// Все звуки синтезируются в реальном времени — внешних файлов нет.
import { G } from './state.js';
import { segBlocked, roomAt } from './world.js';

let ctx = null, master = null, revBus = null;
let WHITE, PINK, BROWN;
let indoor = false;
let staticNode = null, huntNodes = null, amb = null;

const rnd = (a, b) => a + Math.random() * (b - a);

// ---------- инициализация ----------
export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 4;
  comp.attack.value = 0.003; comp.release.value = 0.25;
  master = ctx.createGain(); master.gain.value = 1.0;
  master.connect(comp); comp.connect(ctx.destination);
  const conv = ctx.createConvolver();
  conv.buffer = impulse(2.4, 2.6);
  revBus = ctx.createGain(); revBus.gain.value = 1;
  revBus.connect(conv); conv.connect(master);
  WHITE = noiseBuf('white'); PINK = noiseBuf('pink'); BROWN = noiseBuf('brown');
  startAmbience();
}

export function suspendAudio(s) {
  if (!ctx) return;
  if (s) ctx.suspend(); else ctx.resume();
}

function noiseBuf(kind) {
  const len = ctx.sampleRate * 3;
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === 'white') d[i] = w;
    else if (kind === 'pink') {
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
    } else { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
  }
  return b;
}

function impulse(sec, decay) {
  const len = Math.floor(ctx.sampleRate * sec);
  const b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay) * (i < 200 ? i / 200 : 1);
  }
  return b;
}

const shaperCache = {};
function shaper(amount) {
  if (!shaperCache[amount]) {
    const n = 1024, c = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = i / n * 2 - 1; c[i] = (1 + amount) * x / (1 + amount * Math.abs(x)); }
    shaperCache[amount] = c;
  }
  const s = ctx.createWaveShaper(); s.curve = shaperCache[amount]; s.oversample = '2x';
  return s;
}

// ---------- маршрутизация ----------
// Возвращает вход цепочки: [заглушение стеной] -> [HRTF-панорама] -> мастер + реверб
function route(x, z, y = 1.2, rev = 1, occl = true) {
  const inp = ctx.createGain();
  let node = inp;
  if (x !== undefined) {
    const p = G.player;
    if (occl && segBlocked(p.x, p.z, x, z)) {
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 650;
      const g = ctx.createGain(); g.gain.value = 0.55;
      node.connect(f); f.connect(g); node = g;
    }
    const pan = ctx.createPanner();
    pan.panningModel = 'HRTF'; pan.distanceModel = 'inverse';
    pan.refDistance = 1.4; pan.rolloffFactor = 1.5; pan.maxDistance = 40;
    if (pan.positionX) { pan.positionX.value = x; pan.positionY.value = y; pan.positionZ.value = z; }
    else pan.setPosition(x, y, z);
    node.connect(pan); node = pan;
  }
  node.connect(master);
  const s = ctx.createGain();
  s.gain.value = (indoor ? 0.32 : 0.1) * rev;
  node.connect(s); s.connect(revBus);
  return inp;
}

function env(g, t0, vol, a, dur) {
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(vol, 0.0002), t0 + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(dur, a + 0.01));
}

function nz(dst, t0, o) {
  const { buf = WHITE, dur = 0.2, type = 'bandpass', f = 1000, q = 1, vol = 0.5, a = 0.005, fEnd = null, rate = 1 } = o;
  const src = ctx.createBufferSource();
  src.buffer = buf; src.loop = true; src.playbackRate.value = rate;
  const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t0); fl.Q.value = q;
  if (fEnd) fl.frequency.exponentialRampToValueAtTime(fEnd, t0 + dur);
  const g = ctx.createGain(); env(g, t0, vol, a, dur);
  src.connect(fl); fl.connect(g); g.connect(dst);
  src.start(t0, Math.random() * 2); src.stop(t0 + dur + 0.05);
  return fl;
}

function osc(dst, t0, o) {
  const { type = 'sine', f = 440, fEnd = null, dur = 0.2, vol = 0.3, a = 0.005 } = o;
  const s = ctx.createOscillator(); s.type = type;
  s.frequency.setValueAtTime(f, t0);
  if (fEnd) s.frequency.exponentialRampToValueAtTime(fEnd, t0 + dur);
  const g = ctx.createGain(); env(g, t0, vol, a, dur);
  s.connect(g); g.connect(dst);
  s.start(t0); s.stop(t0 + dur + 0.05);
  return s;
}

// скрип: пила с «дрожащей» частотой через резонансы дерева + эффект трения
function creak(dst, t0, dur, vol, base = 90) {
  const s = ctx.createOscillator(); s.type = 'sawtooth';
  const pts = new Float32Array(16);
  let f = base;
  for (let i = 0; i < 16; i++) { f = Math.max(40, f + rnd(-25, 30)); pts[i] = f; }
  s.frequency.setValueCurveAtTime(pts, t0, dur);
  const am = ctx.createGain(); am.gain.value = 0.5;
  const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = rnd(14, 28);
  const lg = ctx.createGain(); lg.gain.value = 0.5;
  lfo.connect(lg); lg.connect(am.gain);
  const b1 = ctx.createBiquadFilter(); b1.type = 'bandpass'; b1.frequency.value = rnd(900, 1300); b1.Q.value = 7;
  const b2 = ctx.createBiquadFilter(); b2.type = 'bandpass'; b2.frequency.value = rnd(2000, 2600); b2.Q.value = 9;
  const g = ctx.createGain(); env(g, t0, vol, dur * 0.25, dur);
  s.connect(am); am.connect(b1); am.connect(b2); b1.connect(g); b2.connect(g); g.connect(dst);
  s.start(t0); lfo.start(t0); s.stop(t0 + dur + 0.05); lfo.stop(t0 + dur + 0.05);
}

// формантный «голос» (гласные) — для призрака
const VOWELS = { a: [730, 1090, 2440], o: [570, 840, 2410], u: [300, 870, 2240], e: [530, 1840, 2480], i: [300, 2200, 3000] };
function voice(dst, t0, o) {
  const { f0 = 110, f0End = null, dur = 0.6, vowels = ['a', 'o'], vol = 0.4, vib = 5, rasp = 0.3 } = o;
  const src = ctx.createOscillator(); src.type = 'sawtooth';
  src.frequency.setValueAtTime(f0, t0);
  src.frequency.exponentialRampToValueAtTime(f0End || f0 * 0.85, t0 + dur);
  const vl = ctx.createOscillator(); vl.frequency.value = vib;
  const vg = ctx.createGain(); vg.gain.value = f0 * 0.03;
  vl.connect(vg); vg.connect(src.frequency);
  const pre = ctx.createGain(); pre.gain.value = 1;
  src.connect(pre);
  const ns = ctx.createBufferSource(); ns.buffer = PINK; ns.loop = true;
  const ng = ctx.createGain(); ng.gain.value = rasp; ns.connect(ng); ng.connect(pre);
  const out = ctx.createGain(); env(out, t0, vol, 0.06, dur);
  [1, 0.55, 0.25].forEach((amp, k) => {
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 8 + k * 3;
    vowels.forEach((v, i) => {
      const tt = t0 + dur * i / Math.max(1, vowels.length - 1) * 0.9;
      if (i === 0) bp.frequency.setValueAtTime(VOWELS[v][k], t0);
      else bp.frequency.linearRampToValueAtTime(VOWELS[v][k], tt);
    });
    const ag = ctx.createGain(); ag.gain.value = amp * 2.2;
    pre.connect(bp); bp.connect(ag); ag.connect(out);
  });
  out.connect(dst);
  for (const n of [src, vl, ns]) { n.start(t0); n.stop(t0 + dur + 0.1); }
}

// ---------- слушатель и окружение ----------
export function updateAudio(dt) {
  if (!ctx) return;
  const p = G.player, L = ctx.listener;
  const fx = -Math.sin(p.yaw) * Math.cos(p.pitch), fy = Math.sin(p.pitch), fz = -Math.cos(p.yaw) * Math.cos(p.pitch);
  if (L.positionX) {
    const t = ctx.currentTime;
    L.positionX.setTargetAtTime(p.x, t, 0.02); L.positionY.setTargetAtTime(1.6, t, 0.02); L.positionZ.setTargetAtTime(p.z, t, 0.02);
    L.forwardX.setTargetAtTime(fx, t, 0.02); L.forwardY.setTargetAtTime(fy, t, 0.02); L.forwardZ.setTargetAtTime(fz, t, 0.02);
    L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
  } else {
    L.setPosition(p.x, 1.6, p.z); L.setOrientation(fx, fy, fz, 0, 1, 0);
  }
  if (!amb) return;
  // сверчки снаружи
  amb.cricketT -= dt;
  if (amb.cricketT <= 0) {
    amb.cricketT = rnd(0.4, 2.2);
    const a = rnd(0, Math.PI * 2), r = rnd(6, 16);
    const x = p.x + Math.sin(a) * r, z = p.z + Math.cos(a) * r;
    if (roomAt(x, z) === '.') sfx.cricket(x, z);
  }
  // скрипы дома
  amb.creakT -= dt;
  if (amb.creakT <= 0) {
    amb.creakT = rnd(10, 30);
    if (p.inHouse) {
      const a = rnd(0, Math.PI * 2), r = rnd(2.5, 7);
      const x = p.x + Math.sin(a) * r, z = p.z + Math.cos(a) * r;
      if (roomAt(x, z) !== '.') { const d = route(x, z, 2.4, 1.3); creak(d, ctx.currentTime, rnd(0.4, 1.0), 0.06, rnd(50, 80)); }
    }
  }
}

function startAmbience() {
  // ветер с порывами
  const src = ctx.createBufferSource(); src.buffer = BROWN; src.loop = true;
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500; f.Q.value = 1.5;
  const fl = ctx.createOscillator(); fl.frequency.value = 0.05;
  const flg = ctx.createGain(); flg.gain.value = 250; fl.connect(flg); flg.connect(f.frequency);
  const g = ctx.createGain(); g.gain.value = 0.06;
  const gl = ctx.createOscillator(); gl.frequency.value = 0.09;
  const glg = ctx.createGain(); glg.gain.value = 0.035; gl.connect(glg); glg.connect(g.gain);
  const wind = ctx.createGain(); wind.gain.value = 1;
  src.connect(f); f.connect(g); g.connect(wind); wind.connect(master);
  // свист в щелях
  const ws = ctx.createBufferSource(); ws.buffer = WHITE; ws.loop = true;
  const wf = ctx.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 900; wf.Q.value = 25;
  const wl = ctx.createOscillator(); wl.frequency.value = 0.13;
  const wlg = ctx.createGain(); wlg.gain.value = 300; wl.connect(wlg); wlg.connect(wf.frequency);
  const wg = ctx.createGain(); wg.gain.value = 0.012;
  ws.connect(wf); wf.connect(wg); wg.connect(wind);
  // гул дома
  const hs = ctx.createBufferSource(); hs.buffer = BROWN; hs.loop = true;
  const hf = ctx.createBiquadFilter(); hf.type = 'lowpass'; hf.frequency.value = 110;
  const room = ctx.createGain(); room.gain.value = 0;
  hs.connect(hf); hf.connect(room); room.connect(master);
  for (const n of [src, fl, gl, ws, wl, hs]) n.start();
  amb = { wind, room, cricketT: 1, creakT: 8 };
}

export function setWindIndoor(isIndoor) {
  indoor = isIndoor;
  if (!amb || !ctx) return;
  const t = ctx.currentTime;
  amb.wind.gain.setTargetAtTime(isIndoor ? 0.3 : 1, t, 0.6);
  amb.room.gain.setTargetAtTime(isIndoor && G.player.inHouse ? 0.05 : 0, t, 0.6);
}

// ---------- звуковые эффекты ----------
export const sfx = {
  step(surface = 'wood', run = false) {
    if (!ctx) return;
    const t = ctx.currentTime, d = route(undefined, undefined, 0, 0.6);
    const v = (run ? 0.3 : 0.2) * rnd(0.8, 1.1);
    if (surface === 'grass') {
      nz(d, t, { buf: PINK, type: 'highpass', f: 1500, dur: 0.16, a: 0.03, vol: v * 0.9 });
      nz(d, t + 0.04, { type: 'bandpass', f: 4000, q: 0.8, dur: 0.1, a: 0.02, vol: v * 0.4 });
    } else if (surface === 'tile') {
      osc(d, t, { f: rnd(170, 200), fEnd: 120, dur: 0.06, vol: v * 0.5 });
      nz(d, t, { f: 2600, q: 1.5, dur: 0.05, vol: v * 0.7 });
      nz(d, t + 0.01, { type: 'highpass', f: 5000, dur: 0.02, vol: v * 0.35 });
    } else if (surface === 'metal') {
      osc(d, t, { type: 'triangle', f: rnd(130, 150), dur: 0.2, vol: v * 0.6 });
      nz(d, t, { f: 1600, q: 7, dur: 0.18, vol: v * 0.5 });
    } else {
      osc(d, t, { f: rnd(90, 120), fEnd: 60, dur: 0.12, vol: v });
      nz(d, t, { f: rnd(500, 800), q: 1.2, dur: 0.08, vol: v * 0.6 });
      if (Math.random() < 0.08) creak(d, t + 0.03, 0.25, 0.04, rnd(110, 170));
    }
  },
  ghostStep(x, z) {
    if (!ctx) return;
    const t = ctx.currentTime, d = route(x, z, 0.2, 1.2);
    nz(d, t, { buf: BROWN, type: 'lowpass', f: 260, dur: 0.38, vol: 1.6 });
    osc(d, t, { f: 52, fEnd: 34, dur: 0.38, vol: 1.1 });
    nz(d, t + 0.01, { f: 700, q: 1.5, dur: 0.1, vol: 0.4 });
    if (Math.random() < 0.3) creak(d, t + 0.05, 0.35, 0.08, rnd(60, 100));
  },
  door(x, z, slam = false) {
    if (!ctx) return;
    const t = ctx.currentTime, d = route(x, z, 1.2, 1.2);
    if (slam) {
      nz(d, t, { buf: BROWN, type: 'lowpass', f: 600, dur: 0.6, vol: 1.8 });
      osc(d, t, { f: 60, fEnd: 32, dur: 0.5, vol: 1.2 });
      nz(d, t, { type: 'highpass', f: 2500, dur: 0.03, vol: 0.6 });
      for (let i = 0; i < 6; i++) nz(d, t + rnd(0.03, 0.3), { f: rnd(2500, 5000), q: 8, dur: 0.03, vol: rnd(0.1, 0.25) });
    } else {
      creak(d, t, rnd(0.6, 1.1), 0.22, rnd(70, 110));
      nz(d, t, { type: 'highpass', f: 3000, dur: 0.02, vol: 0.2 });
    }
  },
  wardrobe(x, z) {
    if (!ctx) return;
    const t = ctx.currentTime, d = route(x, z, 1.2, 0.8);
    creak(d, t, 0.45, 0.18, rnd(120, 160));
    nz(d, t + 0.4, { buf: BROWN, type: 'lowpass', f: 400, dur: 0.2, vol: 0.7 });
  },
  click(x, z) {
    if (!ctx) return;
    const t = ctx.currentTime, d = route(x, z, 1.3, 0.5);
    nz(d, t, { type: 'highpass', f: 2800, dur: 0.012, vol: 0.5 });
    nz(d, t + 0.02, { type: 'highpass', f: 2000, dur: 0.018, vol: 0.35 });
    osc(d, t, { f: 3300, dur: 0.03, vol: 0.04 });
  },
  knock(x, z) {
    if (!ctx) return;
    const t = ctx.currentTime, d = route(x, z, 1.4, 1.3);
    const n = Math.floor(rnd(2, 5));
    let tt = t;
    for (let i = 0; i < n; i++) {
      osc(d, tt, { f: rnd(150, 175), fEnd: 110, dur: 0.14, vol: 0.9 });
      nz(d, tt, { f: 950, q: 2, dur: 0.07, vol: 0.7 });
      tt += rnd(0.18, 0.32);
    }
  },
  // удар предмета о пол; kind: plastic | ceramic | glass | wood | metal | soft
  impact(x, z, kind = 'wood', strength = 1) {
    if (!ctx) return;
    const t = ctx.currentTime, d = route(x, z, 0.1, 1);
    const v = Math.min(1.2, 0.3 + strength * 0.25);
    switch (kind) {
      case 'ceramic':
        nz(d, t, { f: 3000, q: 1, dur: 0.05, vol: v * 0.8 });
        [2300, 3700, 5200].forEach((f, i) => osc(d, t, { f: f * rnd(0.95, 1.05), dur: 0.35 - i * 0.08, vol: v * 0.12 }));
        break;
      case 'glass':
        nz(d, t, { f: 4000, q: 1.5, dur: 0.04, vol: v * 0.6 });
        [1800, 2950, 4400].forEach((f, i) => osc(d, t, { f: f * rnd(0.97, 1.03), dur: 0.5 - i * 0.1, vol: v * 0.1 }));
        break;
      case 'metal':
        [880, 1340, 2210].forEach((f, i) => osc(d, t, { f: f * rnd(0.97, 1.03), dur: 0.6 - i * 0.15, vol: v * 0.12 }));
        nz(d, t, { f: 2000, q: 2, dur: 0.04, vol: v * 0.5 });
        break;
      case 'plastic':
        osc(d, t, { type: 'triangle', f: rnd(380, 600), dur: 0.05, vol: v * 0.4 });
        nz(d, t, { f: 1700, q: 1.5, dur: 0.05, vol: v * 0.7 });
        break;
      case 'soft':
        nz(d, t, { buf: PINK, type: 'lowpass', f: 900, dur: 0.12, vol: v * 0.8 });
        break;
      default:
        osc(d, t, { f: rnd(160, 260), fEnd: 110, dur: 0.1, vol: v * 0.6 });
        nz(d, t, { f: 700, q: 1.3, dur: 0.08, vol: v * 0.8 });
    }
  },
  thud(x, z) { sfx.impact(x, z, 'wood', 2); },
  beep(level) {
    if (!ctx) return;
    const t = ctx.currentTime, d = route(undefined, undefined, 0, 0.2);
    const f = [0, 2000, 2250, 2500, 2800, 3200][level] || 2000;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4500; lp.connect(d);
    osc(lp, t, { type: 'square', f, dur: 0.06, vol: 0.05 });
    if (level >= 5) { osc(lp, t + 0.1, { type: 'square', f, dur: 0.06, vol: 0.06 }); osc(lp, t + 0.2, { type: 'square', f, dur: 0.06, vol: 0.06 }); }
  },
  motion(x, z) {
    if (!ctx) return;
    const t = ctx.currentTime, d = route(x, z, 0.3, 0.8, false);
    for (const [f, dt] of [[1318, 0], [1046, 0.22]]) {
      osc(d, t + dt, { f, dur: 0.35, vol: 0.18 });
      osc(d, t + dt, { type: 'triangle', f: f * 2, dur: 0.2, vol: 0.04 });
    }
  },
  whisper(x, z) {
    if (!ctx) return;
    const t = ctx.currentTime, d = route(x, z, 1.6, 1.5);
    const n = Math.floor(rnd(10, 18));
    for (let i = 0; i < n; i++) {
      const tt = t + rnd(0, 1.8);
      nz(d, tt, { buf: PINK, f: rnd(1200, 3800), q: rnd(3, 9), dur: rnd(0.05, 0.17), a: 0.02, vol: rnd(0.25, 0.6) });
      if (Math.random() < 0.15) nz(d, tt, { type: 'highpass', f: 5500, dur: 0.12, a: 0.03, vol: 0.15 });
    }
  },
  breath(x, z) {
    if (!ctx) return;
    const t = ctx.currentTime, d = route(x, z, 1.6, 1.2);
    nz(d, t, { buf: PINK, f: 600, fEnd: 950, q: 2, dur: 1.1, a: 0.5, vol: 0.6 });
    nz(d, t + 1.3, { buf: PINK, f: 550, fEnd: 300, q: 1.5, dur: 1.5, a: 0.1, vol: 0.7 });
  },
  growl(x, z) {
    if (!ctx) return;
    const t = ctx.currentTime, d = route(x, z, 1.6, 1.4);
    const sh = shaper(20); sh.connect(d);
    const g = ctx.createGain(); g.gain.value = 0.5; g.connect(sh);
    voice(g, t, { f0: rnd(50, 70), dur: rnd(0.9, 1.5), vowels: ['o', 'u', 'a'], vol: 0.8, vib: 9, rasp: 1.2 });
  },
  scream() {
    if (!ctx) return;
    const t = ctx.currentTime, d = route(undefined, undefined, 0, 2.5);
    const sh = shaper(30); sh.connect(d);
    const g = ctx.createGain(); g.gain.value = 0.45; g.connect(sh);
    voice(g, t, { f0: 760, f0End: 210, dur: 1.7, vowels: ['a', 'e', 'a', 'o'], vol: 0.9, vib: 11, rasp: 0.8 });
    voice(g, t + 0.05, { f0: 520, f0End: 150, dur: 1.6, vowels: ['e', 'a', 'o'], vol: 0.6, vib: 7, rasp: 1 });
    osc(d, t, { f: 45, fEnd: 25, dur: 2.2, vol: 1.2 });
    nz(d, t, { buf: BROWN, type: 'lowpass', f: 500, dur: 1.5, vol: 1.2 });
    nz(d, t, { type: 'highpass', f: 3000, dur: 0.8, vol: 0.4 });
  },
  shutter() {
    if (!ctx) return;
    const t = ctx.currentTime, d = route(undefined, undefined, 0, 0.3);
    nz(d, t, { type: 'highpass', f: 2500, dur: 0.02, vol: 0.7 });
    nz(d, t + 0.06, { f: 1800, q: 2, dur: 0.03, vol: 0.5 });
    osc(d, t + 0.15, { f: 1800, fEnd: 7000, dur: 1.0, a: 0.2, vol: 0.02 });
  },
  sizzle(x, z) {
    if (!ctx) return;
    const t = ctx.currentTime, d = route(x, z, 0.1, 1);
    nz(d, t, { type: 'highpass', f: 3500, dur: 1.5, a: 0.05, vol: 0.6 });
    for (let i = 0; i < 18; i++) nz(d, t + rnd(0, 1.3), { type: 'highpass', f: 2000, dur: 0.01, vol: rnd(0.2, 0.5) });
    osc(d, t, { type: 'sawtooth', f: 90, fEnd: 60, dur: 1.2, vol: 0.06 });
  },
  crackle(x, z) {
    if (!ctx) return;
    const t = ctx.currentTime, d = route(x, z, 1, 0.5, false);
    for (let i = 0; i < 3; i++) nz(d, t + rnd(0, 0.15), { type: 'highpass', f: rnd(1500, 4000), dur: 0.008, vol: rnd(0.08, 0.2) });
  },
  lighter() {
    if (!ctx) return;
    const t = ctx.currentTime, d = route(undefined, undefined, 0, 0.3);
    nz(d, t, { type: 'highpass', f: 2500, dur: 0.07, vol: 0.4 });
    nz(d, t + 0.08, { buf: PINK, f: 500, q: 0.8, dur: 0.4, a: 0.05, vol: 0.4 });
  },
  ghostVoice() {
    if (!ctx) return;
    // голос «из динамика» радиоприёмника
    const t = ctx.currentTime, d = route(undefined, undefined, 0, 0.6);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1200; bp.Q.value = 0.7;
    const sh = shaper(12); sh.connect(bp); bp.connect(d);
    const g = ctx.createGain(); g.gain.value = 0.6; g.connect(sh);
    const vs = Object.keys(VOWELS);
    nz(g, t, { type: 'highpass', f: 3000, dur: 0.08, vol: 0.3 });
    voice(g, t + 0.05, { f0: rnd(85, 120), dur: rnd(0.45, 0.8), vowels: [vs[Math.floor(rnd(0, 5))], vs[Math.floor(rnd(0, 5))]], vol: 0.9, vib: 6, rasp: 0.6 });
    nz(d, t, { f: 1500, q: 0.5, dur: 1.0, vol: 0.12 });
  },
  pills() {
    if (!ctx) return;
    const t = ctx.currentTime, d = route(undefined, undefined, 0, 0.2);
    for (let i = 0; i < 7; i++) nz(d, t + rnd(0, 0.25), { f: rnd(3000, 5000), q: 6, dur: 0.02, vol: rnd(0.15, 0.3) });
    nz(d, t + 0.35, { f: 1200, q: 3, dur: 0.05, vol: 0.4 });
  },
  heartbeat(vol) {
    if (!ctx) return;
    const t = ctx.currentTime, d = route(undefined, undefined, 0, 0);
    osc(d, t, { f: 62, fEnd: 40, dur: 0.14, vol: vol * 2 });
    nz(d, t, { buf: BROWN, type: 'lowpass', f: 140, dur: 0.12, vol: vol * 1.5 });
    osc(d, t + 0.2, { f: 55, fEnd: 36, dur: 0.16, vol: vol * 1.5 });
  },
  lightBuzz(x, z) {
    if (!ctx) return;
    const t = ctx.currentTime, d = route(x, z, 2.4, 0.4);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 400; bp.Q.value = 2; bp.connect(d);
    osc(bp, t, { type: 'sawtooth', f: 100, dur: rnd(0.1, 0.3), vol: 0.25 });
    nz(d, t, { type: 'highpass', f: 4000, dur: 0.02, vol: 0.2 });
  },
  breaker(on) {
    if (!ctx) return;
    const t = ctx.currentTime, d = route(undefined, undefined, 0, 1);
    nz(d, t, { buf: BROWN, type: 'lowpass', f: 700, dur: 0.25, vol: 1.2 });
    osc(d, t, { f: 75, fEnd: 50, dur: 0.25, vol: 0.6 });
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 250; lp.connect(d);
    if (on) osc(lp, t + 0.05, { type: 'sawtooth', f: 30, fEnd: 50, dur: 1.4, a: 0.4, vol: 0.12 });
    else osc(lp, t, { type: 'sawtooth', f: 50, fEnd: 18, dur: 1.5, a: 0.01, vol: 0.12 });
  },
  singing(x, z) {
    if (!ctx) return;
    const t = ctx.currentTime, d = route(x, z, 1.6, 1.8);
    const notes = [392, 349, 311, 294, 311, 262];
    notes.forEach((f, i) => voice(d, t + i * 0.55, { f0: f, f0End: f * 0.98, dur: 0.6, vowels: ['u', 'o'], vol: 0.35, vib: 5.5, rasp: 0.15 }));
  },
  puff(x, z) {
    if (!ctx) return;
    const t = ctx.currentTime, d = route(x, z, 0.5, 0.6);
    nz(d, t, { buf: PINK, type: 'lowpass', f: 900, fEnd: 300, dur: 0.35, a: 0.03, vol: 0.5 });
  },
  // голос на записи диктофона: «обратная» речь с хрипом
  evp() {
    if (!ctx) return;
    const t = ctx.currentTime, d = route(undefined, undefined, 0, 1.2);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 0.9;
    const sh = shaper(6); sh.connect(bp); bp.connect(d);
    const g = ctx.createGain(); g.gain.value = 0.55; g.connect(sh);
    const vs = Object.keys(VOWELS);
    const f0 = rnd(90, 130);
    voice(g, t + 0.1, { f0: f0 * 0.8, f0End: f0 * 1.25, dur: rnd(0.7, 1.1), vowels: [vs[Math.floor(rnd(0, 5))], vs[Math.floor(rnd(0, 5))], vs[Math.floor(rnd(0, 5))]], vol: 0.8, vib: 3, rasp: 0.9 });
    nz(d, t, { buf: PINK, f: 2000, q: 0.6, dur: 1.4, a: 0.3, vol: 0.12 });
  },
  rattle(x, z) {
    if (!ctx) return;
    const t = ctx.currentTime, d = route(x, z, 1.2, 1.2);
    for (let i = 0; i < 7; i++) {
      const tt = t + i * 0.13 + rnd(0, 0.04);
      osc(d, tt, { f: rnd(140, 190), fEnd: 100, dur: 0.08, vol: 0.5 });
      nz(d, tt, { f: rnd(1200, 2400), q: 4, dur: 0.05, vol: 0.4 });
    }
  },
  tvStatic(x, z) {
    if (!ctx) return;
    const t = ctx.currentTime, d = route(x, z, 0.9, 0.6);
    nz(d, t, { type: 'bandpass', f: 3000, q: 0.4, dur: 1.5, a: 0.05, vol: 0.18 });
    osc(d, t, { type: 'sine', f: 15600, dur: 1.5, a: 0.05, vol: 0.01 });
  },
  water(x, z) {
    if (!ctx) return;
    const t = ctx.currentTime, d = route(x, z, 0.9, 0.8);
    nz(d, t, { buf: PINK, type: 'bandpass', f: 1800, q: 0.6, dur: 1.1, a: 0.1, vol: 0.35 });
    for (let i = 0; i < 6; i++) osc(d, t + rnd(0, 0.9), { f: rnd(600, 1600), fEnd: rnd(1600, 2600), dur: 0.05, vol: 0.03 });
  },
  musicBox(x, z, dur = 9) {
    if (!ctx) return;
    const t = ctx.currentTime, d = route(x, z, 0.8, 1.6);
    const mel = [659, 784, 880, 784, 659, 587, 523, 587, 659, 659, 587, 523, 494, 523, 440];
    let tt = t;
    mel.forEach((f, i) => {
      const slow = 1 + i / mel.length * 0.8; // заводная пружина ослабевает
      const ff = f * (1 - i * 0.002);
      osc(d, tt, { f: ff, dur: 0.9, a: 0.003, vol: 0.12 });
      osc(d, tt, { f: ff * 2.01, dur: 0.4, a: 0.003, vol: 0.04 });
      osc(d, tt, { type: 'triangle', f: ff * 3.98, dur: 0.15, a: 0.002, vol: 0.02 });
      tt += 0.42 * slow;
      if (tt - t > dur) return;
    });
    for (let i = 0; i < 30; i++) nz(d, t + i * 0.3, { type: 'highpass', f: 5000, dur: 0.01, vol: 0.03 });
  },
  scrape(x, z) {
    if (!ctx) return;
    const t = ctx.currentTime, d = route(x, z, 0.8, 0.8);
    for (let i = 0; i < 4; i++) nz(d, t + i * 0.45, { buf: PINK, f: rnd(600, 1200), fEnd: rnd(400, 1500), q: 3, dur: 0.4, a: 0.05, vol: 0.35 });
  },
  needle(x, z) {
    if (!ctx) return;
    const t = ctx.currentTime, d = route(x, z, 0.8, 0.6);
    nz(d, t, { buf: PINK, type: 'lowpass', f: 800, dur: 0.18, a: 0.02, vol: 0.4 });
    osc(d, t + 0.1, { f: 2400, fEnd: 1800, dur: 0.12, vol: 0.05 });
  },
  cardFlip() {
    if (!ctx) return;
    const t = ctx.currentTime, d = route(undefined, undefined, 0, 0.4);
    nz(d, t, { type: 'highpass', f: 2500, fEnd: 6000, dur: 0.09, vol: 0.4 });
    osc(d, t + 0.05, { f: 220, fEnd: 110, dur: 1.5, a: 0.3, vol: 0.06 });
  },
  whoosh() {
    if (!ctx) return;
    const t = ctx.currentTime, d = route(undefined, undefined, 0, 1);
    nz(d, t, { buf: PINK, f: 300, fEnd: 2000, q: 1, dur: 0.6, a: 0.25, vol: 0.4 });
  },
  curse() {
    if (!ctx) return;
    const t = ctx.currentTime, d = route(undefined, undefined, 0, 2.5);
    osc(d, t, { f: 38, fEnd: 22, dur: 3, a: 0.05, vol: 1.4 });
    nz(d, t, { buf: BROWN, type: 'lowpass', f: 300, dur: 2.5, a: 0.8, vol: 1.2 });
    [1, 1.19, 1.41].forEach(k => osc(d, t, { type: 'sawtooth', f: 110 * k, fEnd: 55 * k, dur: 2.2, a: 0.6, vol: 0.06 }));
    for (let i = 0; i < 8; i++) nz(d, t + rnd(0, 0.5), { f: rnd(2000, 6000), q: 8, dur: 0.3, vol: 0.15 });
  },
  cricket(x, z) {
    if (!ctx) return;
    const t = ctx.currentTime, d = route(x, z, 0.1, 0.5, false);
    const f = rnd(4200, 4800);
    for (let i = 0; i < 3; i++) osc(d, t + i * 0.055, { f, dur: 0.04, a: 0.005, vol: 0.05 });
  },
};

// ---------- петли ----------
// Радиоприёмник: «сканирование» станций — помехи прыгают по частотам
export function setStatic(on) {
  if (!ctx) return;
  if (on && !staticNode) {
    const src = ctx.createBufferSource(); src.buffer = WHITE; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 1.2;
    const g = ctx.createGain(); g.gain.value = 0.06;
    const out = route(undefined, undefined, 0, 0.2);
    src.connect(f); f.connect(g); g.connect(out);
    src.start();
    const iv = setInterval(() => {
      const t = ctx.currentTime;
      f.frequency.setValueAtTime(rnd(400, 4500), t);
      f.Q.setValueAtTime(rnd(0.5, 3), t);
      g.gain.setValueAtTime(Math.random() < 0.15 ? 0.01 : rnd(0.03, 0.09), t);
      if (Math.random() < 0.08) osc(out, t, { type: 'square', f: rnd(300, 1500), dur: 0.05, vol: 0.02 });
    }, 75);
    staticNode = { src, iv };
  } else if (!on && staticNode) {
    clearInterval(staticNode.iv);
    staticNode.src.stop();
    staticNode = null;
  }
}

export function setHuntAudio(on) {
  if (!ctx) return;
  if (on && !huntNodes) {
    const t = ctx.currentTime;
    const out = ctx.createGain(); out.gain.value = 0;
    out.gain.linearRampToValueAtTime(0.5, t + 1.5);
    out.connect(master);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 200; lp.Q.value = 4;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.2;
    const lg = ctx.createGain(); lg.gain.value = 110; lfo.connect(lg); lg.connect(lp.frequency);
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 41;
    const o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = 43.6;
    const o3 = ctx.createOscillator(); o3.type = 'sawtooth'; o3.frequency.value = 61.7;
    const og = ctx.createGain(); og.gain.value = 0.25;
    o1.connect(og); o2.connect(og); o3.connect(og); og.connect(lp); lp.connect(out);
    const sub = ctx.createOscillator(); sub.frequency.value = 31;
    const sg = ctx.createGain(); sg.gain.value = 0.35; sub.connect(sg); sg.connect(out);
    const ns = ctx.createBufferSource(); ns.buffer = BROWN; ns.loop = true;
    const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 500; nf.Q.value = 0.8;
    const ng = ctx.createGain(); ng.gain.value = 0.15;
    const nl = ctx.createOscillator(); nl.frequency.value = 0.35;
    const nlg = ctx.createGain(); nlg.gain.value = 0.12; nl.connect(nlg); nlg.connect(ng.gain);
    ns.connect(nf); nf.connect(ng); ng.connect(out);
    const all = [lfo, o1, o2, o3, sub, ns, nl];
    all.forEach(n => n.start());
    huntNodes = { out, lp, all };
  } else if (!on && huntNodes) {
    const n = huntNodes; huntNodes = null;
    n.out.gain.cancelScheduledValues(ctx.currentTime);
    n.out.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
    setTimeout(() => n.all.forEach(x => x.stop()), 1500);
  }
}

export function setHuntIntensity(v) {
  if (!huntNodes || !ctx) return;
  const t = ctx.currentTime;
  huntNodes.out.gain.setTargetAtTime(0.25 + v * 0.55, t, 0.3);
  huntNodes.lp.frequency.setTargetAtTime(160 + v * 400, t, 0.3);
}

// голос призрака через синтез речи (если доступен)
export function speak(text) {
  try {
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ru-RU'; u.pitch = 0.1; u.rate = 0.55; u.volume = 0.6;
    window.speechSynthesis.speak(u);
  } catch (e) { /* ignore */ }
}

// совместимость
export function spatial(x, z) { return { vol: 1, pan: 0, d: Math.hypot(x - G.player.x, z - G.player.z) }; }
