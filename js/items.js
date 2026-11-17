// Снаряжение: модели, использование, установка, показания
import * as THREE from 'three';
import { G, rand, pick, toast, completeObjective, clamp } from './state.js';
import { roomAt, roomLit, pointBlocked, segBlocked, collideCircle, colliders, surfaceAt, solidAt, inVanArea, mat, box, interactables } from './world.js';
import { sfx, setStatic, speak } from './audio.js';

export const ITEM_DEFS = {
  emf:      { name: 'ЭМП-детектор',    icon: '📶', electronic: true, toggle: true, stock: 2 },
  box:      { name: 'Радиоприёмник',   icon: '📻', electronic: true, toggle: true, stock: 1 },
  thermo:   { name: 'Термометр',       icon: '🌡️', electronic: true, stock: 1 },
  uv:       { name: 'УФ-фонарь',       icon: '🟣', electronic: true, toggle: true, stock: 2 },
  book:     { name: 'Блокнот',         icon: '📓', stock: 2 },
  video:    { name: 'Видеокамера',     icon: '🎥', electronic: true, toggle: true, stock: 2 },
  photo:    { name: 'Фотоаппарат',     icon: '📷', electronic: true, stock: 2, charges: 5 },
  crucifix: { name: 'Распятие',        icon: '✝️', stock: 2, charges: 2 },
  smudge:   { name: 'Благовония',      icon: '🌿', stock: 3, charges: 1 },
  salt:     { name: 'Соль',            icon: '🧂', stock: 2, charges: 3 },
  pills:    { name: 'Успокоительное',  icon: '💊', stock: 3 },
  motion:   { name: 'Датчик движения', icon: '📡', electronic: true, stock: 2 },
  mic:      { name: 'Направл. микрофон', icon: '🎙️', electronic: true, toggle: true, stock: 1 },
  laser:    { name: 'Лазерный проектор', icon: '🟩', electronic: true, stock: 2 },
  candle:   { name: 'Свеча',           icon: '🕯️', stock: 3 },
  recorder: { name: 'Диктофон',        icon: '⏺️', electronic: true, toggle: true, stock: 2 },
};

const USE_LABEL = {
  emf: 'Вкл/Выкл', box: 'Вкл/Выкл', uv: 'Вкл/Выкл', video: 'Вкл/Выкл', mic: 'Вкл/Выкл',
  thermo: '—', book: 'Положить', photo: 'Снимок', crucifix: 'Положить', smudge: 'Поджечь',
  salt: 'Насыпать', pills: 'Принять', motion: 'Установить',
  laser: 'Установить', candle: 'Зажечь', recorder: 'Запись',
};
export function useLabel(it) { return it ? USE_LABEL[it.type] : '—'; }

export const saltPiles = [];
let scene = null, camera = null;
let nextId = 1;

export function initItems(sc, cam, rackSlots) {
  scene = sc; camera = cam;
  G.stock = {};
  for (const k in ITEM_DEFS) G.stock[k] = ITEM_DEFS[k].stock;
  if (rackSlots) buildRack(rackSlots);
}

// ---------- стеллаж в фургоне ----------
const rack = {};
function buildRack(slots) {
  Object.keys(ITEM_DEFS).forEach((type, i) => {
    const sl = slots[i];
    if (!sl) return;
    const dummy = { type, def: ITEM_DEFS[type], data: {}, charges: 1 };
    const g = buildMesh(dummy);
    if (type === 'candle') g.children[g.children.length - 1].visible = false;
    g.scale.setScalar(2.1);
    g.rotation.y = -Math.PI / 2;
    g.position.set(sl.x, 0, sl.z);
    scene.add(g);
    g.updateMatrixWorld(true);
    box3.setFromObject(g);
    g.position.y = sl.y - box3.min.y;
    // ярлык с названием и количеством
    const c = document.createElement('canvas'); c.width = 256; c.height = 48;
    const tex = new THREE.CanvasTexture(c);
    const label = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.083), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
    label.position.set(sl.x + 0.12, sl.y - 0.09, sl.z);
    label.rotation.y = Math.PI / 2;
    scene.add(label);
    // невидимая зона захвата на всю ячейку
    const hit = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.42, 0.46), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.set(sl.x, sl.y + 0.2, sl.z);
    scene.add(hit);
    const all = [g, label, hit];
    for (const o of all) o.traverse(m => { m.userData.kind = 'rackItem'; m.userData.type = type; });
    interactables.push(g, label, hit);
    rack[type] = { g, c, tex };
  });
  refreshRack();
}

export function refreshRack() {
  for (const type in rack) {
    const r = rack[type], n = G.stock[type], x = r.c.getContext('2d');
    x.clearRect(0, 0, 256, 48);
    x.fillStyle = n ? '#e8e2cf' : '#5a5a5a'; x.fillRect(0, 4, 256, 40);
    x.fillStyle = '#1a1a1a'; x.font = 'bold 22px sans-serif';
    x.fillText(ITEM_DEFS[type].name.slice(0, 15), 8, 32);
    x.fillStyle = n ? '#2a6a3a' : '#7a2a2a'; x.fillText('×' + n, 210, 32);
    r.tex.needsUpdate = true;
    r.g.visible = n > 0;
  }
}

// ---------- текстуры ----------
function handTex(foot = false) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#fff';
  if (foot) {
    x.beginPath(); x.ellipse(32, 38, 11, 18, 0, 0, 7); x.fill();
    for (let i = 0; i < 5; i++) { x.beginPath(); x.arc(22 + i * 5, 14 - (i === 0 ? 2 : 0) + Math.abs(i - 1) * 1.5, 3, 0, 7); x.fill(); }
  } else {
    x.beginPath(); x.ellipse(32, 42, 13, 15, 0, 0, 7); x.fill();
    const f = [[14, 30, -0.7], [22, 16, -0.25], [31, 12, 0], [40, 15, 0.2], [47, 22, 0.45]];
    for (const [fx, fy, a] of f) { x.save(); x.translate(fx, fy); x.rotate(a); x.beginPath(); x.ellipse(0, 6, 4, 10, 0, 0, 7); x.fill(); x.restore(); }
  }
  // точечная текстура для «пятнистости»
  x.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 120; i++) { x.fillRect(Math.random() * 64, Math.random() * 64, 2, 2); }
  return new THREE.CanvasTexture(c);
}
let HAND_TEX, FOOT_TEX;

// ---------- модели ----------
function emissive(color) { return new THREE.MeshBasicMaterial({ color }); }

function buildMesh(it) {
  const g = new THREE.Group();
  const d = it.data;
  switch (it.type) {
    case 'emf': {
      box(0.07, 0.03, 0.15, 0x2a2a2e, 0, 0.015, 0, g);
      box(0.06, 0.005, 0.05, 0x111111, 0, 0.032, 0.03, g);
      d.leds = [];
      const cols = [0x20ff40, 0x80ff20, 0xffe020, 0xff8020, 0xff2020];
      for (let i = 0; i < 5; i++) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.009, 0.008, 0.012), emissive(0x222222));
        m.position.set(-0.024 + i * 0.012, 0.034, -0.045); g.add(m);
        m.userData.on = cols[i]; d.leds.push(m);
      }
      break;
    }
    case 'box': {
      box(0.09, 0.045, 0.14, 0xb04a20, 0, 0.0225, 0, g);
      d.screen = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.005, 0.03), emissive(0x221a10));
      d.screen.position.set(0, 0.047, -0.035); g.add(d.screen);
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.15, 4), mat(0x999999));
      ant.position.set(0.03, 0.1, 0.05); ant.rotation.x = 0.4; g.add(ant);
      box(0.05, 0.006, 0.04, 0x333333, 0, 0.047, 0.03, g);
      break;
    }
    case 'thermo': {
      box(0.045, 0.03, 0.16, 0xe0c020, 0, 0.015, 0, g);
      d.screen = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.005, 0.04), emissive(0x55aa66));
      d.screen.position.set(0, 0.032, -0.02); g.add(d.screen);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.015, 0.04, 5), mat(0x444444));
      tip.rotation.x = -Math.PI / 2; tip.position.set(0, 0.015, -0.1); g.add(tip);
      break;
    }
    case 'uv': {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.022, 0.16, 6), mat(0x302a40));
      b.rotation.x = Math.PI / 2; b.position.y = 0.022; g.add(b);
      d.lens = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.02, 6), emissive(0x201830));
      d.lens.rotation.x = Math.PI / 2; d.lens.position.set(0, 0.022, -0.085); g.add(d.lens);
      break;
    }
    case 'book': {
      const c = document.createElement('canvas'); c.width = 128; c.height = 64;
      d.canvas = c; d.tex = new THREE.CanvasTexture(c);
      drawBook(it, false);
      box(0.32, 0.015, 0.22, 0x5a2020, 0, 0.0075, 0, g);
      const pages = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.2), new THREE.MeshLambertMaterial({ map: d.tex }));
      pages.rotation.x = -Math.PI / 2; pages.position.y = 0.017; g.add(pages);
      box(0.004, 0.005, 0.2, 0x333333, 0, 0.02, 0, g);
      const pen = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.13, 4), mat(0x1a1a60));
      pen.rotation.z = Math.PI / 2; pen.rotation.y = 0.5; pen.position.set(0.05, 0.022, 0.05); g.add(pen);
      break;
    }
    case 'video': {
      box(0.08, 0.08, 0.15, 0x1a1a1a, 0, 0.04, 0, g);
      const l = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.05, 6), mat(0x0a0a0a));
      l.rotation.x = Math.PI / 2; l.position.set(0, 0.045, -0.095); g.add(l);
      d.led = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 0.01), emissive(0x330000));
      d.led.position.set(0.03, 0.085, -0.06); g.add(d.led);
      box(0.12, 0.012, 0.012, 0x444444, 0, 0.004, 0, g);
      break;
    }
    case 'photo': {
      box(0.13, 0.075, 0.05, 0x202020, 0, 0.0375, 0, g);
      const l = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.028, 0.04, 8), mat(0x404040));
      l.rotation.x = Math.PI / 2; l.position.set(0.01, 0.037, -0.04); g.add(l);
      box(0.025, 0.012, 0.012, 0xdddddd, -0.045, 0.06, -0.02, g);
      break;
    }
    case 'crucifix': {
      d.m1 = box(0.025, 0.012, 0.18, 0xb08a40, 0, 0.006, 0, g);
      d.m2 = box(0.11, 0.012, 0.025, 0xb08a40, 0, 0.006, -0.04, g);
      break;
    }
    case 'smudge': {
      for (let i = 0; i < 5; i++) {
        const s = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.16, 4), mat(i % 2 ? 0x6a8a5a : 0x7a9a6a));
        s.rotation.x = Math.PI / 2; s.position.set(-0.016 + i * 0.008, 0.012, 0); g.add(s);
      }
      box(0.05, 0.02, 0.012, 0xc0a070, 0, 0.012, 0.03, g);
      d.tip = new THREE.Mesh(new THREE.IcosahedronGeometry(0.018, 0), emissive(0x2a2a1a));
      d.tip.position.set(0, 0.012, -0.08); g.add(d.tip);
      break;
    }
    case 'salt': {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.12, 8), mat(0xe8eef4));
      c.position.y = 0.06; g.add(c);
      const lbl = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.05, 8), mat(0x2050a0));
      lbl.position.y = 0.06; g.add(lbl);
      break;
    }
    case 'pills': {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.07, 8), mat(0xd07020));
      c.position.y = 0.035; g.add(c);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.027, 0.027, 0.02, 8), mat(0xf0f0f0));
      cap.position.y = 0.08; g.add(cap);
      break;
    }
    case 'motion': {
      box(0.08, 0.08, 0.04, 0xe0e0e0, 0, 0.04, 0, g);
      d.led = new THREE.Mesh(new THREE.IcosahedronGeometry(0.018, 0), emissive(0x330000));
      d.led.position.set(0, 0.045, -0.022); g.add(d.led);
      break;
    }
    case 'laser': {
      box(0.09, 0.07, 0.07, 0x2a3a2a, 0, 0.035, 0, g);
      d.lens = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.02, 8), emissive(0x0a200a));
      d.lens.rotation.x = Math.PI / 2; d.lens.position.set(0, 0.04, -0.04); g.add(d.lens);
      box(0.012, 0.02, 0.012, 0x888888, 0.03, 0.08, 0.02, g);
      break;
    }
    case 'candle': {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.025, 0.12, 7), mat(0xf0e6c8));
      w.position.y = 0.06; g.add(w);
      const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.01, 8), mat(0x8a7a50));
      plate.position.y = 0.005; g.add(plate);
      d.flame = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.045, 5), new THREE.MeshBasicMaterial({ color: 0xffa030, fog: false }));
      d.flame.position.y = 0.145; d.flame.visible = false; g.add(d.flame);
      d.burn = 180;
      break;
    }
    case 'recorder': {
      box(0.05, 0.02, 0.11, 0x303036, 0, 0.01, 0, g);
      box(0.035, 0.004, 0.035, 0x111111, 0, 0.021, -0.025, g);
      d.led = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.006, 0.008), emissive(0x330000));
      d.led.position.set(0.015, 0.022, 0.03); g.add(d.led);
      d.caught = [];
      break;
    }
    case 'mic': {
      const dish = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.06, 8, 1, true), mat(0x9aa0a8, { side: THREE.DoubleSide }));
      dish.rotation.x = Math.PI / 2; dish.position.set(0, 0.1, -0.06); g.add(dish);
      box(0.025, 0.025, 0.14, 0x222222, 0, 0.05, 0.04, g);
      box(0.02, 0.07, 0.025, 0x222222, 0, 0.02, 0.1, g);
      break;
    }
  }
  g.traverse(o => { o.userData.kind = 'item'; o.userData.item = it; });
  return g;
}

export function drawBook(it, written) {
  const x = it.data.canvas.getContext('2d');
  x.fillStyle = '#efe6cf'; x.fillRect(0, 0, 128, 64);
  x.strokeStyle = '#c8bca0'; x.lineWidth = 1;
  for (let y = 8; y < 64; y += 6) { x.beginPath(); x.moveTo(4, y); x.lineTo(124, y); x.stroke(); }
  x.fillStyle = '#9a8e74'; x.fillRect(63, 0, 2, 64);
  if (written) {
    x.strokeStyle = '#1a1a1a'; x.lineWidth = 1.6;
    for (let l = 0; l < 7; l++) {
      x.beginPath();
      let px = rand(6, 14), py = rand(6, 58);
      x.moveTo(px, py);
      for (let s = 0; s < 14; s++) { px += rand(2, 6); py += rand(-5, 5); x.lineTo(Math.min(px, 124), clamp(py, 2, 62)); }
      x.stroke();
    }
    // перевёрнутая надпись/символ
    x.font = 'bold 18px serif'; x.fillStyle = '#300';
    x.save(); x.translate(96, 34); x.rotate(rand(-0.6, 0.6));
    x.fillText(pick(['УЙДИ', '✕✕✕', 'ЗДЕСЬ', '☩', 'УМРИ', '◯◯']), -26, 6); x.restore();
  }
  it.data.tex.needsUpdate = true;
}

export function createItem(type) {
  const def = ITEM_DEFS[type];
  const it = { id: nextId++, type, def, on: type === 'thermo', charges: def.charges ?? 1, data: {}, placed: false };
  it.mesh = buildMesh(it);
  it.mesh.traverse(o => { if (o.isMesh) o.castShadow = false; });
  return it;
}

// ---------- инвентарь ----------
export function selected() { return G.inv[G.sel]; }

export function attachHeld() {
  for (const it of G.inv) if (it && it.mesh.parent === camera) camera.remove(it.mesh);
  const it = selected();
  if (it) {
    camera.add(it.mesh);
    it.mesh.position.set(0.17, -0.17, -0.38);
    it.mesh.rotation.set(0.25, 0, 0);
    if (it.type === 'mic') it.mesh.position.set(0.15, -0.22, -0.4);
  }
  setStatic(!!(it && it.type === 'box' && it.on));
}

export function selectSlot(i) {
  G.sel = i;
  attachHeld();
}

export function takeFromStock(type) {
  if (!G.stock[type]) { toast('Этого предмета больше нет'); return false; }
  let slot = G.inv[G.sel] ? G.inv.findIndex(x => !x) : G.sel;
  if (slot < 0) { toast('Руки заняты — освободите слот'); return false; }
  G.stock[type]--;
  G.inv[slot] = createItem(type);
  G.sel = slot;
  attachHeld();
  refreshRack();
  sfx.click();
  return true;
}

export function returnToStock(slot) {
  const it = G.inv[slot];
  if (!it) return;
  if (!it.data.used) G.stock[it.type]++;
  if (it.mesh.parent) it.mesh.parent.remove(it.mesh);
  if (it.type === 'box') setStatic(false);
  G.inv[slot] = null;
  attachHeld();
  refreshRack();
}

function removeFromInv(it) {
  const i = G.inv.indexOf(it);
  if (i >= 0) G.inv[i] = null;
  if (it.mesh.parent) it.mesh.parent.remove(it.mesh);
  attachHeld();
}

function placePos(dist = 0.65) {
  const p = G.player;
  const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
  let x = p.x + fx * dist, z = p.z + fz * dist;
  if (segBlocked(p.x, p.z, x, z)) { x = p.x + fx * 0.3; z = p.z + fz * 0.3; }
  // на невысокую мебель (стол, тумба, кровать) можно поставить сверху
  const top = surfaceAt(x, z);
  if (top > 0 && top < 1.3 && !solidAt(x, z, top + 0.01, 0.0)) return { x, z, y: top };
  const r = collideCircle(x, z, 0.15);
  return { x: r.x, z: r.z, y: 0 };
}

// звук удара предмета о пол
const IMPACT = { book: 'soft', smudge: 'soft', crucifix: 'metal' };
// цилиндрические предметы при падении ложатся на бок
const ROLLS = new Set(['salt', 'pills', 'smudge', 'uv']);

// аккуратно поставить предмет перед собой
export function placeSelectedNeat() {
  const it = selected();
  if (!it) return;
  const p = G.player;
  if (p.hidden) { toast('Нельзя положить в шкафу'); return; }
  if (it.type === 'box') setStatic(false);
  const { x, z, y } = placePos();
  removeFromInv(it);
  placeItem(it, x, z, p.yaw, false, y);
  sfx.impact(x, z, IMPACT[it.type] || 'plastic', 0.3);
}

// бросок: предмет вылетает из руки и падает на пол по дуге
const flying = [];
const tmpW = new THREE.Vector3();
export function dropSelected() {
  const it = selected();
  if (!it) return;
  const p = G.player;
  if (p.hidden) { toast('Нельзя положить в шкафу'); return; }
  if (inVanArea(p.x, p.z)) {
    returnToStock(G.sel);
    toast(it.data.used ? 'Использованный предмет выброшен' : 'Возвращено на стеллаж');
    return;
  }
  if (it.type === 'box') setStatic(false);
  if (it.type === 'video' || it.type === 'laser') { placeSelectedNeat(); return; }
  if (it.mesh.parent === camera) it.mesh.getWorldPosition(tmpW);
  else tmpW.set(p.x, 1.4, p.z);
  removeFromInv(it);
  const fx = -Math.sin(p.yaw) * Math.cos(p.pitch), fy = Math.sin(p.pitch), fz = -Math.cos(p.yaw) * Math.cos(p.pitch);
  const sp = 2.2;
  it.mesh.scale.setScalar(1.4);
  it.mesh.rotation.set(0, p.yaw, 0, 'YXZ');
  it.mesh.position.copy(tmpW);
  scene.add(it.mesh);
  flying.push({
    it, x: tmpW.x, y: tmpW.y, z: tmpW.z,
    vx: fx * sp, vy: fy * sp + 1.2, vz: fz * sp,
    sx: rand(-6, 6), sy: rand(-4, 4), sz: rand(-6, 6), bounces: 0,
  });
}

function updateFlying(dt) {
  for (let i = flying.length - 1; i >= 0; i--) {
    const f = flying[i], m = f.it.mesh;
    f.vy -= 9.8 * dt;
    const bottom = f.y - 0.04;
    let nx = f.x + f.vx * dt, nz = f.z + f.vz * dt;
    if (solidAt(nx, f.z, bottom, 0.06)) { f.vx *= -0.35; nx = f.x; }
    if (solidAt(f.x, nz, bottom, 0.06)) { f.vz *= -0.35; nz = f.z; }
    f.x = nx; f.z = nz; f.y += f.vy * dt;
    m.rotation.x += f.sx * dt; m.rotation.y += f.sy * dt; m.rotation.z += f.sz * dt;
    const floor = surfaceAt(f.x, f.z, bottom);
    if (f.y <= floor + 0.05 && f.vy < 0) {
      const speed = Math.hypot(f.vx, f.vy, f.vz);
      sfx.impact(f.x, f.z, IMPACT[f.it.type] || 'plastic', speed);
      if (Math.abs(f.vy) > 1.5 && f.bounces < 2) {
        f.bounces++; f.y = floor + 0.05; f.vy = -f.vy * 0.3; f.vx *= 0.5; f.vz *= 0.5;
        f.sx *= 0.5; f.sz *= 0.5;
      } else {
        flying.splice(i, 1);
        scene.remove(m);
        let x = f.x, z = f.z;
        if (floor === 0) { const r = collideCircle(f.x, f.z, 0.12); x = r.x; z = r.z; }
        placeItem(f.it, x, z, m.rotation.y, true, floor);
        continue;
      }
    }
    m.position.set(f.x, f.y, f.z);
  }
}

const box3 = new THREE.Box3();
export function placeItem(it, x, z, yaw, lying = false, baseY = 0) {
  it.placed = true;
  it.x = x; it.z = z;
  it.room = roomAt(x, z);
  if (it.type === 'motion' || it.type === 'video' || it.type === 'laser') { it.on = true; }
  if (it.type === 'laser') {
    if (!it.data.grid) {
      const pts = [];
      for (let gx = -2.4; gx <= 2.4; gx += 0.2) for (let gz = -2.4; gz <= 2.4; gz += 0.2) {
        if (Math.hypot(gx, gz) < 2.4) pts.push(gx + rand(-0.02, 0.02), 0.03, gz + rand(-0.02, 0.02));
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      it.data.grid = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x30ff50, size: 2.5, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.8 }));
    }
    it.data.grid.position.set(x, 0, z);
    scene.add(it.data.grid);
  }
  const m = it.mesh;
  m.scale.setScalar(it.type === 'video' ? 1 : 1.4);
  m.rotation.set(0, yaw, 0, 'YXZ');
  if (lying && ROLLS.has(it.type)) m.rotation.z = Math.PI / 2;
  else if (lying) { m.rotation.x = rand(-0.05, 0.05); m.rotation.z = rand(-0.05, 0.05); }
  m.position.set(x, 0, z);
  scene.add(m);
  m.updateMatrixWorld(true);
  box3.setFromObject(m);
  m.position.y = baseY + (baseY > 0 ? 0.002 : 0.022) - box3.min.y; // поверх ковров / столешницы
  it.y = baseY;
  if (it.type === 'video') {
    it.cam = new THREE.PerspectiveCamera(70, 1.6, 0.05, 30);
    it.cam.position.set(x, baseY + 0.6, z); it.cam.rotation.set(0, yaw, 0, 'YXZ');
    it.cam.layers.enable(2);
    m.position.y = baseY + 0.5; // на штативе
    if (!it.data.tripod) {
      it.data.tripod = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.55, 4), mat(0x222222));
        const a = i * 2.1;
        leg.position.set(Math.sin(a) * 0.12, 0.25, Math.cos(a) * 0.12);
        leg.rotation.set(Math.cos(a) * 0.25, 0, -Math.sin(a) * 0.25);
        it.data.tripod.add(leg);
      }
    }
    it.data.tripod.position.set(x, baseY, z);
    scene.add(it.data.tripod);
    it.data.tripod.traverse(o => { o.userData.kind = 'item'; o.userData.item = it; });
  }
  G.placed.push(it);
  interactables.push(m);
  if (G.ghost) G.ghost.onItemPlaced(it);
}

export function pickup(it) {
  let slot = !G.inv[G.sel] ? G.sel : G.inv.findIndex(x => !x);
  if (slot < 0) { toast('Нет свободного слота'); return; }
  G.placed.splice(G.placed.indexOf(it), 1);
  const ii = interactables.indexOf(it.mesh); if (ii >= 0) interactables.splice(ii, 1);
  scene.remove(it.mesh);
  if (it.data.tripod) scene.remove(it.data.tripod);
  if (it.data.grid) scene.remove(it.data.grid);
  if (it.type === 'laser') it.on = false;
  if (it.type === 'recorder' && it.on && it.data.caught.length) {
    toast('🎙 На записи голоса: «' + it.data.caught.join('», «') + '»', 4);
    sfx.evp();
  } else if (it.type === 'recorder' && it.on) toast('🎙 На записи только шум');
  it.placed = false;
  it.mesh.scale.setScalar(1);
  if (it.type === 'motion') it.on = false;
  sfx.click();
  G.inv[slot] = it; G.sel = slot;
  attachHeld();
}

// ---------- использование ----------
export function useSelected() {
  const it = selected();
  if (!it) return;
  const p = G.player;
  switch (it.type) {
    case 'emf': case 'uv': case 'video': case 'mic': case 'box':
      it.on = !it.on; sfx.click();
      if (it.type === 'box') setStatic(it.on);
      break;
    case 'thermo': toast('Термометр всегда включён'); break;
    case 'book': case 'crucifix': case 'motion': case 'laser': placeSelectedNeat(); break;
    case 'recorder':
      it.on = !it.on; sfx.click();
      if (it.on) { it.data.since = G.t; it.data.caught = []; it.data.next = G.t + 4; }
      break;
    case 'candle':
      if (it.data.burn <= 0) { toast('Свеча догорела'); return; }
      it.data.lit = !it.data.lit;
      if (it.data.lit) sfx.lighter(); else sfx.puff(p.x, p.z);
      break;
    case 'photo':
      if (it.charges <= 0) { toast('Плёнка закончилась'); return; }
      it.charges--; G.pendingPhoto = true; sfx.shutter();
      break;
    case 'smudge':
      if (it.data.used) { toast('Благовония уже сгорели'); return; }
      it.data.used = true; it.data.burnUntil = G.t + 6;
      it.data.tip.material.color.setHex(0xff7020);
      sfx.lighter();
      if (G.ghost) G.ghost.onSmudge(p.x, p.z);
      toast('Благовония зажжены');
      break;
    case 'salt': {
      if (it.charges <= 0) { toast('Соль закончилась'); return; }
      if (p.hidden) return;
      it.charges--;
      const { x, z } = placePos(0.6);
      makeSaltPile(x, z);
      if (it.charges <= 0) { it.data.used = true; toast('Соль закончилась'); }
      break;
    }
    case 'pills':
      G.sanity = Math.min(100, G.sanity + 40);
      sfx.pills(); toast('Рассудок восстановлен (+40%)');
      it.data.used = true; removeFromInv(it);
      break;
  }
}

function makeSaltPile(x, z) {
  const geo = new THREE.ConeGeometry(0.16, 0.05, 7);
  const m = new THREE.Mesh(geo, mat(0xf4f4f8));
  m.position.set(x, 0.025, z);
  scene.add(m);
  saltPiles.push({ x, z, mesh: m, stepped: false });
}

export function stepSalt(pile) {
  pile.stepped = true;
  pile.mesh.scale.set(1.5, 0.3, 1.1);
  pile.mesh.material = mat(0xb8b8b0);
}

// ---------- УФ-отпечатки ----------
export function addPrint(parent, x, y, z, rotY, foot = false, rotX = 0) {
  if (!HAND_TEX) { HAND_TEX = handTex(false); FOOT_TEX = handTex(true); }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(foot ? 0.12 : 0.14, foot ? 0.2 : 0.14),
    new THREE.MeshBasicMaterial({ map: foot ? FOOT_TEX : HAND_TEX, color: 0x6dffb8, transparent: true, depthWrite: false, opacity: 0.9, fog: false }));
  m.position.set(x, y, z);
  m.rotation.set(rotX, rotY, 0, 'YXZ');
  m.visible = false;
  parent.add(m);
  G.prints.push({ mesh: m, until: G.t + 120, foot });
  return m;
}

// ---------- распятие ----------
export function tryCrucifix(gx, gz, range) {
  for (const it of G.placed) {
    if (it.type !== 'crucifix' || it.charges <= 0) continue;
    if (Math.hypot(it.x - gx, it.z - gz) <= range) {
      it.charges--;
      sfx.sizzle(it.x, it.z);
      const c = it.charges > 0 ? 0x6a5020 : 0x2a1a10;
      it.data.m1.material = mat(c); it.data.m2.material = mat(c);
      completeObjective('crucifix');
      return true;
    }
  }
  return false;
}

// ---------- радиоприёмник ----------
const QUESTIONS = [
  { q: 'Где ты?', a: ['Здесь', 'Рядом', 'Позади', 'Близко'] },
  { q: 'Сколько тебе лет?', a: ['Старый', 'Молодой', 'Ребёнок', 'Взрослый'] },
  { q: 'Чего ты хочешь?', a: ['Уходи', 'Смерть', 'Убить', 'Тебя'] },
  { q: 'Ты здесь?', a: ['Да', 'Здесь', 'Всегда'] },
  { q: 'Подай знак!', a: ['Смотри', 'Слушай', 'Бойся'] },
];
let boxBusy = false;
export function askSpiritBox() {
  const it = selected();
  if (!it || it.type !== 'box' || !it.on || boxBusy) return;
  const q = pick(QUESTIONS);
  boxBusy = true;
  G.boxText = '«' + q.q + '»';
  setTimeout(() => {
    boxBusy = false;
    const gh = G.ghost;
    const ans = gh && gh.spiritBoxAnswer(G.player.x, G.player.z);
    if (ans) {
      const word = pick(q.a);
      G.boxText = '📻 ' + word.toUpperCase();
      sfx.ghostVoice();
      speak(word);
    } else {
      G.boxText = '…ш-ш-ш…';
    }
    setTimeout(() => { if (G.boxText && !G.boxText.startsWith('«')) G.boxText = ''; }, 3500);
  }, 1600);
  if (G.ghost) G.ghost.provoke();
}

// ---------- показания и обновление ----------
export function emfAt(x, z) {
  let lvl = 1;
  for (const s of G.emfSources) {
    if (G.t > s.until) continue;
    if (Math.hypot(s.x - x, s.z - z) < 1.9) lvl = Math.max(lvl, s.level);
  }
  if (G.flicker > 0.2 && Math.random() < 0.5) lvl = 1 + Math.floor(Math.random() * 5);
  return lvl;
}

function thermoRead(x, z) {
  const r = roomAt(x, z);
  const base = r === '.' ? 6 : (G.temps[r] ?? 15);
  return base + rand(-0.6, 0.6);
}

function micRead() {
  const p = G.player;
  const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
  let best = rand(6, 11);
  for (const e of G.soundEvents) {
    if (G.t - e.t > 1.5) continue;
    const dx = e.x - p.x, dz = e.z - p.z, d = Math.hypot(dx, dz);
    if (d > 25) continue;
    const cos = d > 0.1 ? (dx * fx + dz * fz) / d : 1;
    if (cos < 0.8) continue;
    best = Math.max(best, 12 + e.vol * 55 * (1 - d / 28) + rand(-2, 2));
  }
  return best;
}

export function uvHeldOn() {
  const it = selected();
  return !!(it && it.type === 'uv' && it.on && !(G.flicker > 0.2 && Math.random() < 0.5));
}
export function nvHeldOn() {
  const it = selected();
  return !!(it && it.type === 'video' && it.on);
}
export function heldElectronicOn() {
  const it = selected();
  if (G.player.flashlight) return true;
  return !!(it && it.def.electronic && it.on);
}

let readTimer = 0, motionCD = new Map();
const tmpV = new THREE.Vector3();

export function updateItems(dt) {
  const p = G.player;
  const it = selected();
  readTimer -= dt;
  G.readout = '';
  if (it) {
    const flick = G.flicker > 0.2 && Math.random() < 0.4;
    switch (it.type) {
      case 'emf': {
        const lvl = it.on ? emfAt(p.x, p.z) : 0;
        setLeds(it, lvl);
        if (it.on && lvl >= 2 && readTimer <= 0) { sfx.beep(lvl); if (lvl >= 2) completeObjective('emf'); }
        G.readout = { kind: 'emf', lvl };
        break;
      }
      case 'thermo':
        if (readTimer <= 0) it.data.val = thermoRead(p.x, p.z);
        G.readout = { kind: 'text', text: flick ? '--.-°C' : (it.data.val ?? 15).toFixed(1) + ' °C' };
        break;
      case 'box':
        it.data.screen.material.color.setHex(it.on ? 0xff9040 : 0x221a10);
        G.readout = { kind: 'text', text: it.on ? (G.boxText || '…ш-ш-ш…') : 'выключен' };
        break;
      case 'mic':
        if (readTimer <= 0) it.data.val = it.on ? micRead() : 0;
        G.readout = { kind: 'text', text: it.on ? Math.round(it.data.val) + ' дБ' : 'выключен' };
        break;
      case 'uv':
        it.data.lens.material.color.setHex(it.on ? 0xa040ff : 0x201830);
        G.readout = { kind: 'text', text: it.on ? 'УФ включён' : 'выключен' };
        break;
      case 'video':
        it.data.led.material.color.setHex(it.on ? 0xff0000 : 0x330000);
        G.readout = { kind: 'text', text: it.on ? '● ЗАПИСЬ' : 'выключена' };
        break;
      case 'photo': G.readout = { kind: 'text', text: 'Снимков: ' + it.charges + '/5' }; break;
      case 'crucifix': G.readout = { kind: 'text', text: 'Зарядов: ' + it.charges }; break;
      case 'salt': G.readout = { kind: 'text', text: 'Соли: ' + it.charges }; break;
      case 'smudge': G.readout = { kind: 'text', text: it.data.used ? (G.t < it.data.burnUntil ? 'Горит…' : 'Сгорели') : 'Готовы' }; break;
      case 'laser': G.readout = { kind: 'text', text: 'Поставьте на пол в комнате призрака' }; break;
      case 'candle':
        G.readout = { kind: 'text', text: it.data.burn <= 0 ? 'Догорела' : it.data.lit ? (it.data.blue ? '🔵 Пламя синее!' : '🔥 Горит ' + Math.ceil(it.data.burn) + ' с') : 'Не горит' };
        break;
      case 'recorder': {
        if (!it.on) { G.readout = { kind: 'text', text: 'выключен' }; break; }
        const sec = Math.floor(G.t - it.data.since);
        const fresh = G.t - (it.data.catchT || -99) < 4;
        const bars = Array.from({ length: 8 }, () => '▁▂▃▄▅▆▇'[Math.floor(Math.random() * (fresh ? 7 : 3))]).join('');
        G.readout = { kind: 'text', text: `● ${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')} ${bars}` + (fresh ? ' «' + it.data.caught[it.data.caught.length - 1] + '»' : '') };
        break;
      }
      default: G.readout = { kind: 'text', text: it.def.name };
    }
  }
  updateNewEvidenceItems(dt);
  if (readTimer <= 0) readTimer = 0.5;

  // предметы на полу
  const gh = G.ghost;
  for (const pi of G.placed) {
    if (pi.type === 'emf') {
      setLeds(pi, pi.on ? emfAt(pi.x, pi.z) : 0);
    } else if (pi.type === 'motion') {
      const cd = motionCD.get(pi.id) || 0;
      let trig = false, byGhost = false;
      if (gh && Math.hypot(gh.x - pi.x, gh.z - pi.z) < 1.3) { trig = true; byGhost = true; }
      if (Math.hypot(p.x - pi.x, p.z - pi.z) < 0.9) trig = true;
      if (trig && G.t > cd) {
        motionCD.set(pi.id, G.t + 2.5);
        sfx.motion(pi.x, pi.z);
        if (byGhost) completeObjective('motion');
      }
      pi.data.led.material.color.setHex(G.t < cd ? 0xff2020 : 0x330000);
    } else if (pi.type === 'video') {
      pi.data.led.material.color.setHex(pi.on ? 0xff0000 : 0x330000);
    } else if (pi.type === 'uv') {
      pi.data.lens.material.color.setHex(pi.on ? 0xa040ff : 0x201830);
    } else if (pi.type === 'box') {
      pi.data.screen.material.color.setHex(pi.on ? 0xff9040 : 0x221a10);
    }
  }
  // благовония: дым
  for (const s of [...G.inv, ...G.placed]) {
    if (s && s.type === 'smudge' && s.data.used) {
      const burning = G.t < s.data.burnUntil;
      s.data.tip.material.color.setHex(burning ? (Math.random() < 0.5 ? 0xff7020 : 0xffa040) : 0x1a1a1a);
      if (burning && Math.random() < 0.5) spawnSmoke(s);
      if (burning && Math.random() < 0.06) { s.data.tip.getWorldPosition(tmpW); sfx.crackle(tmpW.x, tmpW.z); }
    }
  }
  updateSmoke(dt);
  updateFlying(dt);

  // УФ-отпечатки
  const uv = uvHeldOn();
  const fx = -Math.sin(p.yaw) * Math.cos(p.pitch), fy = Math.sin(p.pitch), fz = -Math.cos(p.yaw) * Math.cos(p.pitch);
  const uvPlaced = G.placed.filter(x => x.type === 'uv' && x.on);
  for (let i = G.prints.length - 1; i >= 0; i--) {
    const pr = G.prints[i];
    if (G.t > pr.until) { pr.mesh.parent && pr.mesh.parent.remove(pr.mesh); G.prints.splice(i, 1); continue; }
    pr.mesh.getWorldPosition(tmpV);
    let vis = false;
    if (uv) {
      const dx = tmpV.x - camera.position.x, dy = tmpV.y - camera.position.y, dz = tmpV.z - camera.position.z;
      const d = Math.hypot(dx, dy, dz);
      if (d < 4.5 && (dx * fx + dy * fy + dz * fz) / d > 0.88 && !segBlocked(p.x, p.z, tmpV.x, tmpV.z)) vis = true;
    }
    if (!vis) for (const u of uvPlaced) if (Math.hypot(u.x - tmpV.x, u.z - tmpV.z) < 2.2) vis = true;
    pr.mesh.visible = vis;
  }
}

function setLeds(it, lvl) {
  it.data.leds.forEach((m, i) => m.material.color.setHex(i < lvl ? m.userData.on : 0x222222));
}

// свечи, диктофоны, лазеры
const EVP_WORDS = ['…помоги…', '…уходи…', '…холодно…', '…я здесь…', '…мама…', '…темно…', '…не трогай…', '…больно…'];
function updateNewEvidenceItems(dt) {
  const gh = G.ghost, p = G.player;
  const held = selected();
  for (const it of [...G.inv, ...G.placed]) {
    if (!it) continue;
    const x = it.placed ? it.x : p.x, z = it.placed ? it.z : p.z;
    const d = gh ? Math.hypot(gh.x - x, gh.z - z) : 99;
    if (it.type === 'candle') {
      const f = it.data.flame;
      if (it.data.lit) {
        it.data.burn -= dt;
        if (it.data.burn <= 0) { it.data.lit = false; it.data.burn = 0; }
      }
      f.visible = !!it.data.lit;
      if (f.visible) {
        it.data.blue = gh && gh.has('flame') && !gh.hunting && d < 3.5;
        f.material.color.setHex(it.data.blue ? 0x4a78ff : (Math.random() < 0.8 ? 0xffa030 : 0xffd060));
        f.scale.set(1, (it.data.blue ? 1.4 : 1) * (0.85 + Math.random() * 0.3), 1);
        f.position.x = (Math.random() - 0.5) * 0.004;
      } else it.data.blue = false;
    } else if (it.type === 'recorder') {
      it.data.led.material.color.setHex(it.on && (G.t * 2 % 2 < 1.4) ? 0xff2020 : 0x330000);
      if (it.on && G.t > (it.data.next || 0)) {
        it.data.next = G.t + 6;
        if (gh && gh.has('evp') && !gh.hunting && d < 6 && Math.random() < 0.35) {
          const w = EVP_WORDS[Math.floor(Math.random() * EVP_WORDS.length)];
          it.data.caught.push(w); it.data.catchT = G.t;
          if (it === held) { sfx.evp(); toast('🎙 Диктофон записал голос: «' + w + '»', 3); }
        }
      }
    } else if (it.type === 'laser') {
      it.data.lens.material.color.setHex(it.placed ? 0x40ff60 : 0x0a200a);
      if (it.data.grid) it.data.grid.material.opacity = G.flicker > 0.2 && Math.random() < 0.4 ? 0 : 0.8;
    }
  }
}

// дым
const smoke = [];
function spawnSmoke(s) {
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.04, 0), new THREE.MeshBasicMaterial({ color: 0xaaaaaa, transparent: true, opacity: 0.5, depthWrite: false }));
  s.data.tip.getWorldPosition(m.position);
  scene.add(m);
  smoke.push({ m, life: 2, vx: rand(-0.1, 0.1), vz: rand(-0.1, 0.1) });
}
function updateSmoke(dt) {
  for (let i = smoke.length - 1; i >= 0; i--) {
    const s = smoke[i];
    s.life -= dt;
    s.m.position.y += dt * 0.35; s.m.position.x += s.vx * dt; s.m.position.z += s.vz * dt;
    s.m.scale.multiplyScalar(1 + dt * 1.2);
    s.m.material.opacity = Math.max(0, s.life / 2 * 0.45);
    if (s.life <= 0) { scene.remove(s.m); s.m.geometry.dispose(); s.m.material.dispose(); smoke.splice(i, 1); }
  }
}

// ---------- оценка фотографии ----------
const frustum = new THREE.Frustum(), projM = new THREE.Matrix4();
export function evaluatePhoto(cam) {
  cam.updateMatrixWorld();
  projM.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  frustum.setFromProjectionMatrix(projM);
  const p = G.player;
  const gh = G.ghost;
  if (gh && gh.mesh.visible) {
    tmpV.set(gh.x, 1.2, gh.z);
    if (frustum.containsPoint(tmpV) && Math.hypot(gh.x - p.x, gh.z - p.z) < 12 && !segBlocked(p.x, p.z, gh.x, gh.z)) {
      completeObjective('photo');
      return { label: 'Призрак', stars: 3 };
    }
  }
  for (const pr of G.prints) {
    pr.mesh.getWorldPosition(tmpV);
    if (pr.mesh.visible && frustum.containsPoint(tmpV) && tmpV.distanceTo(cam.position) < 4) return { label: pr.foot ? 'Следы' : 'Отпечаток руки', stars: 2 };
  }
  for (const it of G.placed) {
    if (it.type === 'book' && it.data.written) {
      tmpV.set(it.x, 0.05, it.z);
      if (frustum.containsPoint(tmpV) && tmpV.distanceTo(cam.position) < 3.5) return { label: 'Записи призрака', stars: 2 };
    }
  }
  for (const pile of saltPiles) {
    tmpV.set(pile.x, 0.03, pile.z);
    if (pile.stepped && frustum.containsPoint(tmpV) && tmpV.distanceTo(cam.position) < 3.5) return { label: 'Потревоженная соль', stars: 1 };
  }
  return { label: 'Пустой снимок', stars: 0 };
}
