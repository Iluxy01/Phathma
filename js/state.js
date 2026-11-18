// Общее состояние игры
export const G = {
  t: 0,
  running: false,
  paused: false,
  over: false,
  uiOpen: null,          // открытое окно интерфейса (journal, van, pause...)
  sanity: 100,
  power: true,           // электрощиток
  lightsOn: {},          // room -> bool
  temps: {},             // room -> °C
  player: {
    x: 8.5, z: 18.0, yaw: 0, pitch: 0,
    stamina: 3, sprint: false, moving: false,
    flashlight: false,
    hidden: null, seenHiding: false,
    dead: false, room: '.', inHouse: false, inVan: true,
    bob: 0,
  },
  inv: [null, null, null],
  sel: 0,
  placed: [],            // предметы, лежащие в мире
  emfSources: [],        // {x,z,level,until}
  soundEvents: [],       // {x,z,vol,t}
  prints: [],            // УФ-отпечатки и следы
  journal: { evidence: {}, guess: null },
  photos: [],
  objectives: [],
  done: {},              // выполненные задания
  stats: { hunts: 0 },
  settings: { sens: 1, quality: 1 },
  ghost: null,
  flicker: 0,            // мерцание электроники (0..1)
};

export const EVIDENCE = {
  emf:  { name: 'ЭМП 5',                short: 'ЭМП 5' },
  box:  { name: 'Ответ радиоприёмника', short: 'Радио' },
  temp: { name: 'Минусовая температура', short: 'Мороз' },
  uv:   { name: 'Отпечатки (УФ)',       short: 'УФ' },
  book: { name: 'Записи в блокноте',     short: 'Записи' },
  orbs: { name: 'Призрачные огни',       short: 'Огни' },
  dots: { name: 'Лазерная сетка',        short: 'Лазер' },
  flame: { name: 'Синее пламя',          short: 'Пламя' },
  evp:  { name: 'Голос на диктофоне',    short: 'Диктофон' },
};

// уровни сложности
export const DIFFS = {
  amateur:   { name: 'Любитель',     evidence: 3, drain: 0.7, setup: 240, huntMul: 0.85, speedMul: 0.95, grace: 5,   sanity: 100, reward: 1, stock: 1,   powerOff: false, roomChange: false, sanityBoard: true,
    desc: 'Все 3 улики. Рассудок падает медленно, 4 минуты на подготовку без охот, долгая отсрочка в начале охоты.' },
  inter:     { name: 'Опытный',      evidence: 3, drain: 1.0, setup: 120, huntMul: 1.0,  speedMul: 1.0,  grace: 4,   sanity: 100, reward: 2, stock: 1,   powerOff: false, roomChange: false, sanityBoard: true,
    desc: 'Все 3 улики. 2 минуты на подготовку. Стандартные охоты.' },
  pro:       { name: 'Профессионал', evidence: 3, drain: 1.3, setup: 30,  huntMul: 1.15, speedMul: 1.05, grace: 3,   sanity: 100, reward: 3, stock: 1,   powerOff: true,  roomChange: true,  sanityBoard: true,
    desc: 'Все 3 улики, но щиток выключен, призрак может сменить комнату, охоты длиннее и быстрее.' },
  nightmare: { name: 'Кошмар',       evidence: 2, drain: 1.6, setup: 0,   huntMul: 1.3,  speedMul: 1.1,  grace: 2.5, sanity: 100, reward: 5, stock: 0.6, powerOff: true,  roomChange: true,  sanityBoard: true,
    desc: 'Призрак оставляет только 2 улики из 3 — опирайтесь на его поведение. Меньше снаряжения, охоты сразу.' },
  insane:    { name: 'Безумие',      evidence: 1, drain: 2.0, setup: 0,   huntMul: 1.5,  speedMul: 1.15, grace: 2,   sanity: 75,  reward: 8, stock: 0.5, powerOff: true,  roomChange: true,  sanityBoard: false,
    desc: 'Всего 1 улика, рассудок начинается с 75% и не виден на табло. Только для тех, кто знает призраков наизусть.' },
};
G.diffKey = 'inter';
G.diff = DIFFS.inter;
G.activity = [];   // активность призрака по 5-секундным отрезкам
G.actNow = 0;

export const rand = (a, b) => a + Math.random() * (b - a);
export const randi = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

let toastTimer = 0;
export function toast(msg, dur = 2.5) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), dur * 1000);
}

export function completeObjective(id) {
  if (G.done[id]) return;
  G.done[id] = true;
  if (G.mp) netSend('obj', { id });
  const o = G.objectives.find(o => o.id === id);
  if (o) toast('Задание выполнено: ' + o.text, 3);
}

// ---------- мультиплеер: общие помощники ----------
// G.mp = null в одиночной игре; { role: 'host' | 'client' } в игре вдвоём
G.mp = null;
G.remote = null;          // состояние напарника (последнее полученное)
G.itemsById = new Map();
G.noRelay = 0;            // >0 — звуки не пересылаются напарнику
export const isClient = () => !!(G.mp && G.mp.role === 'client');
export const isHost = () => !G.mp || G.mp.role === 'host';
export function netSend(type, data) { if (G.mp && G.mp.send) G.mp.send(type, data); }

// игроки с точки зрения призрака (хост): локальный и, если есть, напарник
export function playersList() {
  const p = G.player;
  const list = [{
    id: 'L', local: true, x: p.x, z: p.z, room: p.room, inHouse: p.inHouse, dead: p.dead,
    hidden: !!p.hidden, seenHiding: p.seenHiding, running: !!p.running,
    elec: G.heldElectronicOn ? G.heldElectronicOn() : p.flashlight, sanity: G.sanity, yaw: p.yaw,
    candle: G.inv.some(it => it && it.type === 'candle' && it.data.lit),
  }];
  const r = G.remote;
  if (G.mp && r && r.ok) list.push({
    id: 'R', local: false, x: r.x, z: r.z, room: r.room, inHouse: r.inHouse, dead: r.dead,
    hidden: r.hid >= 0, seenHiding: !!r.sh, running: !!r.run, elec: !!r.el, sanity: r.san, yaw: r.yaw, candle: !!r.cl,
  });
  return list;
}
export function alivePlayers() { return playersList().filter(q => !q.dead); }
export function nearestPlayer(x, z, filter = (q) => q.inHouse && !q.dead) {
  let best = null, bd = 1e9;
  for (const q of playersList()) { if (!filter(q)) continue; const d = Math.hypot(q.x - x, q.z - z); if (d < bd) { bd = d; best = q; } }
  return best;
}
// средний рассудок живой команды
export function teamSanity() {
  const a = alivePlayers();
  if (!a.length) return G.sanity;
  return a.reduce((s, q) => s + (q.sanity ?? 100), 0) / a.length;
}
// изменить рассудок конкретного игрока ('L' — свой, 'R' — напарник)
export function adjSanity(who, d) {
  if (who === 'R') { netSend('san', { d }); return; }
  G.sanity = clamp(G.sanity + d, 0, 100);
}
export function setSanity(who, v) {
  if (who === 'R') { netSend('san', { v }); return; }
  G.sanity = clamp(v, 0, 100);
}
// детерминированное перемешивание (одинаковое на всех устройствах при общем зерне)
export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
