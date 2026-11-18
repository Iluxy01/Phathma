// Ориентация экрана (принудительно горизонтальная) и редактор раскладки кнопок
import { G, clamp } from './state.js';

const $ = (id) => document.getElementById(id);
const app = $('app');

export const view = { rot: false, w: window.innerWidth, h: window.innerHeight };

function load(key, def) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : def; } catch (_) { return def; }
}
function save(key, v) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch (_) { /* приватный режим */ }
}

G.settings.orient = load('phathma.orient', 'land'); // 'land' — всегда горизонтально, 'free' — как держишь телефон

let onResize = () => {};
export function initScreen(cb) {
  onResize = cb;
  window.addEventListener('resize', updateView);
  window.addEventListener('orientationchange', () => setTimeout(updateView, 200));
  updateView();
  applyLayout();
}

export function setOrient(v) {
  G.settings.orient = v;
  save('phathma.orient', v);
  updateView();
}

export function updateView() {
  const W = window.innerWidth, H = window.innerHeight;
  view.rot = G.settings.orient === 'land' && H > W;
  document.body.classList.toggle('rot', view.rot);
  if (view.rot) {
    view.w = H; view.h = W;
    app.style.width = H + 'px'; app.style.height = W + 'px';
  } else {
    view.w = W; view.h = H;
    app.style.width = ''; app.style.height = '';
  }
  document.body.classList.toggle('land', view.w >= view.h);
  onResize();
  applyLayout();
}

// экранные координаты -> координаты внутри (возможно повёрнутой) игры
export function toLogical(cx, cy) {
  if (!view.rot) return { x: cx, y: cy };
  return { x: cy, y: window.innerWidth - cx };
}
export function deltaLogical(dx, dy) {
  return view.rot ? { x: dy, y: -dx } : { x: dx, y: dy };
}

// ---------- раскладка ----------
const MOVABLE = ['bInteract', 'bUse', 'bDrop', 'bLight', 'bSprint', 'bAsk', 'slots', 'joyHint', 'topbar', 'readout'];
let layout = load('phathma.layout', null); // { land:{pos,scale,alpha}, port:{...} }

function key() { return view.w >= view.h ? 'land' : 'port'; }
function cur() { return layout && layout[key()]; }

export function joyOnRight() {
  const l = cur();
  return !!(l && l.pos.joyHint && l.pos.joyHint[0] > 50);
}

export function applyLayout() {
  const l = cur();
  for (const id of MOVABLE) {
    const el = $(id);
    if (!el) continue;
    if (l && l.pos[id]) {
      const [x, y] = l.pos[id];
      Object.assign(el.style, { left: x + '%', top: y + '%', right: 'auto', bottom: 'auto', margin: '0', transform: `translate(-50%,-50%) scale(${l.scale})` });
      el.style.opacity = id === 'joyHint' ? '' : l.alpha;
    } else {
      Object.assign(el.style, { left: '', top: '', right: '', bottom: '', margin: '', transform: '', opacity: '' });
    }
  }
}

function centerPct(el) {
  const r = el.getBoundingClientRect();
  const c = toLogical(r.left + r.width / 2, r.top + r.height / 2);
  return [+(c.x / view.w * 100).toFixed(2), +(c.y / view.h * 100).toFixed(2)];
}

let editing = false, drag = null, doneCb = null;
export function openLayoutEditor(onDone) {
  doneCb = onDone;
  editing = true;
  G.uiOpen = 'layout';
  document.body.classList.add('editing');
  $('hud').classList.remove('hidden');
  $('layoutBar').classList.remove('hidden');
  if ($('readout').textContent === '') $('readout').textContent = 'Показания';
  // зафиксировать текущие позиции, если раскладка ещё не настроена
  if (!layout) layout = {};
  if (!layout[key()]) {
    applyLayout();
    const pos = {};
    for (const id of MOVABLE) pos[id] = centerPct($(id));
    layout[key()] = { pos, scale: 1, alpha: 1 };
  }
  const l = cur();
  $('laySize').value = l.scale;
  $('layAlpha').value = l.alpha;
  applyLayout();
}

function closeEditor() {
  editing = false;
  document.body.classList.remove('editing');
  $('layoutBar').classList.add('hidden');
  if ($('readout').textContent === 'Показания') $('readout').textContent = '';
  G.uiOpen = null;
  save('phathma.layout', layout);
  if (doneCb) doneCb();
}

export function initLayoutEditor() {
  const hud = $('hud');
  hud.addEventListener('pointerdown', (e) => {
    if (!editing) return;
    if (e.target.closest('#layoutBar')) return;
    const el = MOVABLE.map($).find(m => m && m.contains(e.target));
    e.preventDefault(); e.stopPropagation();
    if (!el) return;
    const p = toLogical(e.clientX, e.clientY);
    const [cx, cy] = cur().pos[el.id];
    drag = { el, id: el.id, pid: e.pointerId, ox: cx / 100 * view.w - p.x, oy: cy / 100 * view.h - p.y };
    el.classList.add('dragging');
  }, true);
  window.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pid) return;
    const p = toLogical(e.clientX, e.clientY);
    const x = clamp((p.x + drag.ox) / view.w * 100, 3, 97), y = clamp((p.y + drag.oy) / view.h * 100, 4, 96);
    cur().pos[drag.id] = [+x.toFixed(2), +y.toFixed(2)];
    applyLayout();
  });
  const end = (e) => { if (drag && e.pointerId === drag.pid) { drag.el.classList.remove('dragging'); drag = null; } };
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
  // во время редактирования кнопки не нажимаются
  hud.addEventListener('click', (e) => { if (editing && !e.target.closest('#layoutBar')) { e.preventDefault(); e.stopPropagation(); } }, true);

  $('laySize').addEventListener('input', (e) => { cur().scale = +e.target.value; applyLayout(); });
  $('layAlpha').addEventListener('input', (e) => { cur().alpha = +e.target.value; applyLayout(); });
  $('layMirror').addEventListener('click', () => {
    const l = cur();
    for (const id in l.pos) if (id !== 'topbar') l.pos[id][0] = +(100 - l.pos[id][0]).toFixed(2);
    applyLayout();
  });
  $('layReset').addEventListener('click', () => {
    delete layout[key()];
    openLayoutEditor(doneCb);
  });
  $('layDone').addEventListener('click', closeEditor);
}

// ---------- прокрутка окон пальцем ----------
// Встроенная прокрутка браузера не работает в повёрнутом интерфейсе (палец двигается
// поперёк оси окна), поэтому листаем сами, в логических координатах игры.
let sc = null, flingRaf = 0, suppressClick = false;
function scrollableFrom(el) {
  for (let e = el; e && e !== document.body; e = e.parentElement) {
    if (e.id === 'hud' || e.id === 'touch') return null;
    const oy = getComputedStyle(e).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && e.scrollHeight > e.clientHeight + 1) return e;
  }
  return null;
}
document.addEventListener('pointerdown', (e) => {
  suppressClick = false;
  if (e.pointerType === 'mouse') return;
  const el = scrollableFrom(e.target);
  if (!el) return;
  cancelAnimationFrame(flingRaf);
  const q = toLogical(e.clientX, e.clientY);
  sc = { el, id: e.pointerId, y: q.y, moved: 0, v: 0, t: performance.now() };
}, true);
document.addEventListener('pointermove', (e) => {
  if (!sc || e.pointerId !== sc.id) return;
  const q = toLogical(e.clientX, e.clientY);
  const dy = q.y - sc.y, now = performance.now();
  sc.y = q.y;
  sc.el.scrollTop -= dy;
  sc.moved += Math.abs(dy);
  const dt = Math.max(1, now - sc.t); sc.t = now;
  sc.v = sc.v * 0.6 + (-dy / dt) * 0.4;   // пикселей за мс
}, true);
const endScroll = (e) => {
  if (!sc || e.pointerId !== sc.id) return;
  const s = sc; sc = null;
  if (s.moved > 8) { suppressClick = true; setTimeout(() => { suppressClick = false; }, 300); }
  // инерция
  let v = s.v * 16;
  const step = () => {
    if (Math.abs(v) < 0.3) return;
    s.el.scrollTop += v; v *= 0.93;
    flingRaf = requestAnimationFrame(step);
  };
  if (s.moved > 8) step();
};
document.addEventListener('pointerup', endScroll, true);
document.addEventListener('pointercancel', endScroll, true);
// если листали — это не нажатие на кнопку
document.addEventListener('click', (e) => {
  if (suppressClick) { suppressClick = false; e.stopPropagation(); e.preventDefault(); }
}, true);
