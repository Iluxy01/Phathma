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
  const o = G.objectives.find(o => o.id === id);
  if (o) toast('Задание выполнено: ' + o.text, 3);
}
