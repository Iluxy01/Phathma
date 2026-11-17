// Точка входа: рендер, управление, игровой цикл
import * as THREE from 'three';
import { G, rand, clamp, toast, pick, DIFFS } from './state.js';
import * as AP from './appliances.js';
import * as W from './world.js';
import { initAudio, sfx, setWindIndoor, suspendAudio, setStatic, setHuntAudio, updateAudio } from './audio.js';
import * as I from './items.js';
import { Ghost, GHOSTS } from './ghost.js';
import * as UI from './ui.js';
import * as CU from './cursed.js';
import { view, toLogical, deltaLogical, initScreen, setOrient, openLayoutEditor, initLayoutEditor, joyOnRight } from './screen.js';

const $ = (id) => document.getElementById(id);

// ---------- рендер ----------
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
let quality = 1;
function applyQuality() {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2) * (quality >= 1.5 ? 1 : quality >= 1 ? 0.75 : 0.5));
  renderer.setSize(view.w, view.h, false);
}
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, 16 / 9, 0.05, 90);
camera.rotation.order = 'YXZ';
scene.add(camera);

const flash = new THREE.SpotLight(0xfff2dc, 0, 18, 0.48, 0.5, 1.2);
flash.position.set(0.12, -0.12, 0);
flash.target.position.set(0, -0.15, -4);
camera.add(flash, flash.target);
const uvLight = new THREE.SpotLight(0x9a50ff, 0, 7, 0.3, 0.4, 1.4);
uvLight.position.set(0.15, -0.15, 0);
uvLight.target.position.set(0, -0.1, -4);
camera.add(uvLight, uvLight.target);
const photoLight = new THREE.PointLight(0xffffff, 0, 12, 1.2);
camera.add(photoLight);

W.buildWorld(scene);
I.initItems(scene, camera, W.van.rackSlots);
AP.buildAppliances(scene);

// случайный призрак
const forced = new URLSearchParams(location.search).get('ghost');
const def = GHOSTS.find(g => g.id === forced) || pick(GHOSTS);
G.ghost = new Ghost(scene, def);
CU.spawnCursed(scene, new URLSearchParams(location.search).get('cursed'));

// дополнительные задания
const OBJ = [
  { id: 'emf', text: 'Получить показание ЭМП-детектора' },
  { id: 'photo', text: 'Сфотографировать призрака' },
  { id: 'event', text: 'Стать свидетелем явления призрака' },
  { id: 'smudgeHunt', text: 'Окурить призрака благовониями во время охоты' },
  { id: 'crucifix', text: 'Предотвратить охоту распятием' },
  { id: 'motion', text: 'Засечь призрака датчиком движения' },
  { id: 'salt', text: 'Призрак должен наступить на соль' },
  { id: 'survive', text: 'Пережить охоту' },
  { id: 'cursed', text: 'Воспользоваться проклятым предметом' },
];
G.objectives = OBJ.sort(() => Math.random() - 0.5).slice(0, 3);

// монитор фургона
const rt = new THREE.WebGLRenderTarget(256, 160);
const noSignal = (() => {
  const c = document.createElement('canvas'); c.width = 256; c.height = 160;
  const x = c.getContext('2d'); x.fillStyle = '#050805'; x.fillRect(0, 0, 256, 160);
  x.fillStyle = '#5f5'; x.font = 'bold 20px monospace'; x.fillText('НЕТ СИГНАЛА', 56, 70);
  x.font = '12px monospace'; x.fillText('установите видеокамеру', 44, 100);
  return new THREE.CanvasTexture(c);
})();
W.van.monitor.material.map = noSignal;

// ---------- ввод ----------
const input = { mx: 0, mz: 0, sprint: false, keys: {} };
const touchState = { joyId: null, joyX: 0, joyY: 0, lookId: null, lx: 0, ly: 0 };
const joy = $('joy'), knob = $('joyKnob');
const touchEl = $('touch');

touchEl.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (G.uiOpen) return;
  const q = toLogical(e.clientX, e.clientY);
  const right = joyOnRight();
  const inJoy = e.pointerType !== 'mouse' && (right ? q.x > view.w * 0.58 : q.x < view.w * 0.42);
  if (inJoy && touchState.joyId === null) {
    touchState.joyId = e.pointerId; touchState.joyX = q.x; touchState.joyY = q.y;
    joy.style.display = 'block'; joy.style.left = q.x + 'px'; joy.style.top = q.y + 'px';
    knob.style.transform = 'translate(0,0)';
  } else if (touchState.lookId === null) {
    touchState.lookId = e.pointerId; touchState.lx = e.clientX; touchState.ly = e.clientY;
  }
  try { touchEl.setPointerCapture(e.pointerId); } catch (_) { /* */ }
});
touchEl.addEventListener('pointermove', (e) => {
  e.preventDefault();
  if (e.pointerId === touchState.joyId) {
    const q = toLogical(e.clientX, e.clientY);
    let dx = q.x - touchState.joyX, dy = q.y - touchState.joyY;
    const d = Math.hypot(dx, dy), max = 50;
    if (d > max) { dx = dx / d * max; dy = dy / d * max; }
    knob.style.transform = `translate(${dx}px,${dy}px)`;
    input.mx = dx / max; input.mz = -dy / max;
  } else if (e.pointerId === touchState.lookId) {
    const dl = deltaLogical(e.clientX - touchState.lx, e.clientY - touchState.ly);
    touchState.lx = e.clientX; touchState.ly = e.clientY;
    look(dl.x, dl.y);
  }
});
const endPtr = (e) => {
  if (e.pointerId === touchState.joyId) { touchState.joyId = null; input.mx = input.mz = 0; joy.style.display = 'none'; }
  if (e.pointerId === touchState.lookId) touchState.lookId = null;
};
touchEl.addEventListener('pointerup', endPtr);
touchEl.addEventListener('pointercancel', endPtr);

function look(dx, dy) {
  const p = G.player;
  if (p.dead) return;
  const s = 0.0045 * G.settings.sens;
  p.yaw -= dx * s;
  p.pitch = clamp(p.pitch - dy * s, -1.35, 1.35);
  if (p.hidden) {
    let d = p.yaw - p.hidden.yaw;
    while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
    p.yaw = p.hidden.yaw + clamp(d, -0.6, 0.6);
    p.pitch = clamp(p.pitch, -0.5, 0.4);
  }
}

function bindBtn(id, fn, holdFn) {
  const b = $(id);
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    b.classList.add('pressed');
    if (G.uiOpen === 'layout') return;
    if (holdFn) holdFn(true); else if (!G.uiOpen) fn();
  });
  const up = (e) => { b.classList.remove('pressed'); if (holdFn) holdFn(false); };
  b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up);
}
bindBtn('bInteract', interact);
bindBtn('bUse', () => { I.useSelected(); });
bindBtn('bDrop', () => I.dropSelected());
bindBtn('bLight', toggleFlashlight);
bindBtn('bAsk', () => I.askSpiritBox());
let sprintToggle = false;
bindBtn('bSprint', () => {}, (down) => { if (down) { sprintToggle = !sprintToggle; $('bSprint').classList.toggle('on', sprintToggle); } });
document.querySelectorAll('.slot').forEach(el => el.addEventListener('pointerdown', (e) => {
  e.preventDefault(); e.stopPropagation();
  if (G.uiOpen) return;
  I.selectSlot(+el.dataset.i);
}));

window.addEventListener('keydown', (e) => {
  input.keys[e.code] = true;
  if (!G.running || G.player.dead) return;
  if (e.code === 'Escape') { G.uiOpen ? UI.closeScreen(G.uiOpen) : pause(); return; }
  if (G.uiOpen) { if (e.code === 'KeyJ' && G.uiOpen === 'journal') UI.closeScreen('journal'); return; }
  switch (e.code) {
    case 'KeyE': interact(); break;
    case 'KeyR': I.useSelected(); break;
    case 'KeyG': I.dropSelected(); break;
    case 'KeyF': toggleFlashlight(); break;
    case 'KeyT': I.askSpiritBox(); break;
    case 'KeyJ': case 'Tab': e.preventDefault(); UI.openScreen('journal'); break;
    case 'Digit1': I.selectSlot(0); break;
    case 'Digit2': I.selectSlot(1); break;
    case 'Digit3': I.selectSlot(2); break;
  }
});
window.addEventListener('keyup', (e) => { input.keys[e.code] = false; });
// мышь на ПК: тянуть для обзора
let mouseDown = false;
canvas.addEventListener('mousedown', () => { mouseDown = true; });
window.addEventListener('mouseup', () => { mouseDown = false; });
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === touchEl) look(e.movementX, e.movementY);
});
touchEl.addEventListener('dblclick', () => { if (!G.uiOpen && touchEl.requestPointerLock) touchEl.requestPointerLock(); });

function toggleFlashlight() {
  G.player.flashlight = !G.player.flashlight;
  sfx.click();
}

// ---------- взаимодействие ----------
const ray = new THREE.Raycaster();
ray.far = 2.3;
const center = new THREE.Vector2(0, 0);
let target = null;

function findTarget() {
  const p = G.player;
  if (p.hidden) return { kind: 'unhide', label: 'Выйти из шкафа' };
  if (CU.mirrorActive()) return { kind: 'cursed', label: CU.cursedPrompt() };
  ray.setFromCamera(center, camera);
  const hits = ray.intersectObjects(W.interactables, true);
  for (const h of hits) {
    let o = h.object;
    while (o && !o.userData.kind) o = o.parent;
    if (!o) continue;
    const u = o.userData;
    switch (u.kind) {
      case 'block': return null;
      case 'door': {
        const d = u.door;
        return { kind: 'door', door: d, label: d.locked ? 'Заперто!' : d.angle > 0.5 ? 'Закрыть дверь' : 'Открыть дверь' };
      }
      case 'switch': return { kind: 'switch', room: u.room, label: G.lightsOn[u.room] ? 'Выключить свет' : 'Включить свет' };
      case 'fuse': return { kind: 'fuse', label: G.power ? 'Щиток: выключить' : 'Щиток: включить' };
      case 'hide': return { kind: 'hide', spot: u.spot, label: 'Спрятаться в шкаф' };
      case 'item': if (u.item.placed) return { kind: 'item', item: u.item, label: 'Взять: ' + u.item.def.name }; break;
      case 'rack': return { kind: 'rack', label: 'Снаряжение' };
      case 'cursed': return { kind: 'cursed', label: CU.cursedPrompt() };
      case 'appliance': return { kind: 'appliance', app: u.app, label: AP.appliancePrompt(u.app) };
      case 'rackItem': {
        const n = G.stock[u.type], d = I.ITEM_DEFS[u.type];
        return { kind: 'rackItem', type: u.type, label: n ? `Взять: ${d.name} (${n} шт.)` : `${d.name}: закончились` };
      }
      case 'vjournal': return { kind: 'vjournal', label: 'Журнал' };
      case 'leave': return { kind: 'leave', label: 'Завершить расследование' };
    }
  }
  return null;
}

function interact() {
  const p = G.player;
  if (!G.running || p.dead) return;
  const t = findTarget();
  if (!t) return;
  switch (t.kind) {
    case 'unhide':
      p.x = p.hidden.out.x; p.z = p.hidden.out.z;
      sfx.wardrobe(p.hidden.x, p.hidden.z);
      p.hidden = null; document.body.classList.remove('hiding');
      break;
    case 'door':
      if (t.door.locked) { toast('Дверь заперта!'); sfx.knock(t.door.cx, t.door.cz); return; }
      t.door.target = t.door.angle > 0.5 ? 0 : 1.45;
      sfx.door(t.door.cx, t.door.cz, t.door.target === 0 && t.door.angle > 1);
      break;
    case 'switch':
      W.setLight(t.room, !G.lightsOn[t.room]);
      sfx.click();
      if (!G.power) toast('Нет электричества — проверьте щиток');
      break;
    case 'fuse':
      if (!G.power && G.ghost.hunting) { toast('Щиток не включается!'); return; }
      G.power = !G.power; sfx.breaker(G.power);
      break;
    case 'hide': {
      const gh = G.ghost;
      p.seenHiding = gh.hunting && gh.mesh.visible !== undefined && !W.segBlocked(gh.x, gh.z, p.x, p.z) && gh.distTo(p.x, p.z) < 15;
      p.hidden = t.spot; p.x = t.spot.x; p.z = t.spot.z;
      p.yaw = t.spot.yaw; p.pitch = 0;
      document.body.classList.add('hiding');
      sfx.wardrobe(p.x, p.z);
      break;
    }
    case 'item': I.pickup(t.item); break;
    case 'rack': UI.openScreen('vanMenu'); break;
    case 'rackItem': I.takeFromStock(t.type); break;
    case 'cursed': CU.useCursed(); break;
    case 'appliance': AP.toggleAppliance(t.app); break;
    case 'vjournal': UI.openScreen('journal'); break;
    case 'leave': {
      const g = GHOSTS.find(x => x.id === G.journal.guess);
      $('leaveText').textContent = g ? `Ваш ответ: ${g.name}` : 'Вы не выбрали тип призрака в журнале!';
      UI.openScreen('leaveConfirm');
      break;
    }
  }
}

// ---------- игрок ----------
let stepAcc = 0, lastIndoor = null;
function updatePlayer(dt) {
  const p = G.player;
  if (p.dead) return;
  let mx = input.mx, mz = input.mz;
  const k = input.keys;
  if (k.KeyW || k.ArrowUp) mz += 1;
  if (k.KeyS || k.ArrowDown) mz -= 1;
  if (k.KeyA) mx -= 1;
  if (k.KeyD) mx += 1;
  if (k.ArrowLeft) p.yaw += 2 * dt;
  if (k.ArrowRight) p.yaw -= 2 * dt;
  const len = Math.hypot(mx, mz);
  if (len > 1) { mx /= len; mz /= len; }
  const wantSprint = sprintToggle || k.ShiftLeft || k.ShiftRight;
  p.moving = len > 0.15 && !p.hidden && !G.uiOpen && !CU.mirrorActive();
  let speed = 1.6;
  if (p.moving && wantSprint && p.stamina > 0 && !p.exhausted) {
    speed = 2.9; p.stamina -= dt;
    if (p.stamina <= 0) { p.exhausted = true; p.stamina = 0; }
  } else {
    p.stamina = Math.min(3, p.stamina + dt * (p.moving ? 0.4 : 0.8));
    if (p.stamina > 1.5) p.exhausted = false;
  }
  if (p.moving) {
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
    const vx = (fx * mz + rx * mx) * speed * dt, vz = (fz * mz + rz * mx) * speed * dt;
    const r = W.collideCircle(p.x + vx, p.z + vz, 0.25);
    const moved = Math.hypot(r.x - p.x, r.z - p.z);
    p.x = r.x; p.z = r.z;
    p.bob += moved * 5.5;
    stepAcc += moved;
    if (stepAcc > (speed > 2 ? 0.75 : 0.6)) {
      stepAcc = 0;
      const r = W.roomAt(p.x, p.z);
      sfx.step(W.inVanArea(p.x, p.z) ? 'metal' : r === '.' ? 'grass' : (r === 'K' || r === 'W') ? 'tile' : 'wood', speed > 2);
    }
  }
  p.room = W.roomAt(p.x, p.z);
  p.inHouse = p.room !== '.';
  p.inVan = W.inVanArea(p.x, p.z);
  const ind = p.inHouse || p.inVan;
  if (ind !== lastIndoor) { lastIndoor = ind; setWindIndoor(ind); }
}

function updateCamera(dt) {
  const p = G.player;
  if (p.dead) {
    const gh = G.ghost;
    const target = new THREE.Vector3(gh.x, 1.55, gh.z);
    const m = new THREE.Matrix4().lookAt(camera.position, target, camera.up);
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    camera.quaternion.slerp(q, Math.min(1, dt * 6));
    camera.position.y = Math.max(0.6, camera.position.y - dt * 0.3);
    return;
  }
  if (p.hidden) {
    const s = p.hidden;
    camera.position.set(s.x + (s.out.x - s.x) * 0.25, 1.5, s.z + (s.out.z - s.z) * 0.25);
  } else {
    camera.position.set(p.x, 1.6 + Math.sin(p.bob) * 0.035, p.z);
  }
  camera.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
}

// ---------- рассудок ----------
function updateSanity(dt) {
  const p = G.player, gh = G.ghost;
  if (!p.inHouse || p.dead) return;
  let drain = W.roomLit(p.room) ? 0 : 0.13;
  // зажжённая свеча рядом успокаивает
  if (drain && [...G.inv, ...G.placed].some(it => it && it.type === 'candle' && it.data.lit &&
      (!it.placed || Math.hypot(it.x - p.x, it.z - p.z) < 2.5))) drain *= 0.5;
  if (gh.m.stillDrain && !p.moving && gh.distTo(p.x, p.z) < 6) drain += 0.25;
  if (gh.m.drainNear && gh.distTo(p.x, p.z) < 5) drain += 0.15;
  if (gh.m.homebody && p.room === gh.home) drain *= 2;
  G.sanity = Math.max(0, G.sanity - drain * G.diff.drain * dt);
}

// ---------- освещение / эффекты ----------
let nvState = false;
function updateEffects(dt) {
  const p = G.player;
  const flick = G.flicker > 0.2 && Math.random() < 0.45;
  flash.intensity = p.flashlight && !flick ? 26 : 0;
  uvLight.intensity = I.uvHeldOn() ? 14 : 0;
  const nv = I.nvHeldOn() && !flick;
  if (nv !== nvState) {
    nvState = nv;
    document.body.classList.toggle('nvon', nv);
    if (nv) camera.layers.enable(2); else camera.layers.disable(2);
  }
  W.ambient.intensity = nv ? 1.5 : 0.1;
  W.ambient.color.setHex(nv ? 0x50ff70 : 0x8090b0);
  if (nv) flash.intensity = 0;
  scene.fog.density = nv ? 0.05 : 0.035;
}

let monitorFrame = 0;
function renderMonitor() {
  const p = G.player;
  if (!p.inVan) return;
  if (++monitorFrame % 4) return;
  const cam = G.placed.find(it => it.type === 'video' && it.on);
  if (!cam) { W.van.monitor.material.map = noSignal; return; }
  const ai = W.ambient.intensity, ac = W.ambient.color.getHex(), fl = flash.intensity;
  W.ambient.intensity = 1.5; W.ambient.color.setHex(0x50ff70); flash.intensity = 0;
  renderer.setRenderTarget(rt);
  renderer.render(scene, cam.cam);
  renderer.setRenderTarget(null);
  W.ambient.intensity = ai; W.ambient.color.setHex(ac); flash.intensity = fl;
  W.van.monitor.material.map = rt.texture;
}

// ---------- фото ----------
function takePhotoNow() {
  photoLight.intensity = 40;
  renderer.render(scene, camera);
  const res = I.evaluatePhoto(camera);
  const c = document.createElement('canvas');
  c.width = 240; c.height = Math.round(240 * canvas.height / canvas.width);
  c.getContext('2d').drawImage(renderer.domElement, 0, 0, c.width, c.height);
  G.photos.push({ img: c.toDataURL('image/jpeg', 0.7), ...res });
  photoLight.intensity = 0;
  const f = $('flash'); f.classList.add('on'); setTimeout(() => f.classList.remove('on'), 60);
  toast('📷 ' + res.label + (res.stars ? ' ' + '★'.repeat(res.stars) : ''));
}

// ---------- атмосфера ----------
const dust = (() => {
  const n = 160, pos = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) pos[i] = (Math.random() - 0.5) * 6;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xbfae90, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.5, depthWrite: false }));
  pts.frustumCulled = false;
  scene.add(pts);
  return pts;
})();
const puffs = [];
let breathT = 0;
const grainEl = $('grain'), sanityFxEl = $('sanityFx');
(() => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'), img = x.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
  x.putImageData(img, 0, 0);
  grainEl.style.backgroundImage = `url(${c.toDataURL()})`;
})();

function updateAtmosphere(dt) {
  const p = G.player;
  // пылинки вокруг игрока, видны в доме при включённом фонаре
  dust.visible = p.inHouse && p.flashlight;
  if (dust.visible) {
    const a = dust.geometry.attributes.position;
    for (let i = 0; i < a.count; i++) {
      let x = a.getX(i) + Math.sin(G.t * 0.3 + i) * 0.002, y = a.getY(i) - 0.0015, z = a.getZ(i);
      if (y < -1.5) y = 1;
      a.setXYZ(i, x, y, z);
    }
    a.needsUpdate = true;
    dust.position.set(Math.round(p.x * 2) / 2, 1.4, Math.round(p.z * 2) / 2);
  }
  // пар изо рта в холодной комнате
  const temp = p.inHouse ? G.temps[p.room] : 8;
  breathT -= dt;
  if (temp < 4 && breathT <= 0 && !p.dead) {
    breathT = 2.6;
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.05, 0), new THREE.MeshBasicMaterial({ color: 0xdde6ee, transparent: true, opacity: 0.35, depthWrite: false }));
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    m.position.set(p.x + fx * 0.25, 1.5, p.z + fz * 0.25);
    scene.add(m);
    puffs.push({ m, life: 1.4, vx: fx * 0.25, vz: fz * 0.25 });
  }
  for (let i = puffs.length - 1; i >= 0; i--) {
    const f = puffs[i];
    f.life -= dt;
    f.m.position.x += f.vx * dt; f.m.position.z += f.vz * dt; f.m.position.y += dt * 0.05;
    f.m.scale.multiplyScalar(1 + dt * 1.6);
    f.m.material.opacity = Math.max(0, f.life / 1.4 * 0.35);
    if (f.life <= 0) { scene.remove(f.m); f.m.geometry.dispose(); f.m.material.dispose(); puffs.splice(i, 1); }
  }
  // чем ниже рассудок, тем темнее края экрана и сильнее зерно
  const ins = p.inHouse ? 1 - G.sanity / 100 : 0;
  sanityFxEl.style.opacity = (Math.max(0, ins - 0.3) * 0.9 + (G.ghost.hunting ? 0.25 : 0)).toFixed(2);
  grainEl.style.opacity = (0.04 + ins * 0.1 + (G.ghost.hunting ? 0.06 : 0)).toFixed(3);
}

// ---------- смерть / конец ----------
let deathT = -1;
G.onPropImpact = (pr, speed) => sfx.impact(pr.mesh.position.x, pr.mesh.position.z, pr.snd, speed);
G.onDeath = () => {
  deathT = 0;
  $('death').classList.add('on');
  setStatic(false);
};
function leave() {
  G.running = false; G.over = true;
  setStatic(false); setHuntAudio(false);
  UI.showResult(false);
}

function pause() {
  if (!G.running) return;
  G.paused = true; UI.openScreen('pause'); suspendAudio(true);
}
function resume() {
  G.paused = false; UI.closeScreen('pause'); suspendAudio(false);
  last = performance.now();
}

UI.initUI({ pause, resume, leave });

// ---------- старт ----------
$('sens').addEventListener('input', (e) => { G.settings.sens = +e.target.value; });
$('quality').addEventListener('change', (e) => { quality = +e.target.value; applyQuality(); });
// ---------- профиль и сложность ----------
function loadProfile() { try { return JSON.parse(localStorage.getItem('phathma.profile')) || { money: 0, xp: 0, games: 0 }; } catch (_) { return { money: 0, xp: 0, games: 0 }; } }
G.profile = loadProfile();
G.saveProfile = () => { try { localStorage.setItem('phathma.profile', JSON.stringify(G.profile)); } catch (_) { /* */ } };
$('profile').textContent = `Уровень ${Math.floor(G.profile.xp / 150) + 1} · $${G.profile.money} · расследований: ${G.profile.games}`;
try { const d = localStorage.getItem('phathma.diff'); if (DIFFS[d]) G.diffKey = d; } catch (_) { /* */ }
function renderDiffs() {
  const box = $('diffs'); box.innerHTML = '';
  for (const k in DIFFS) {
    const b = document.createElement('button');
    b.className = k === G.diffKey ? 'sel' : '';
    b.innerHTML = `${DIFFS[k].name}<small>×${DIFFS[k].reward} $</small>`;
    b.onclick = () => { G.diffKey = k; try { localStorage.setItem('phathma.diff', k); } catch (_) { /* */ } renderDiffs(); };
    box.appendChild(b);
  }
  $('diffDesc').textContent = DIFFS[G.diffKey].desc;
}
renderDiffs();

function applyDifficulty() {
  const D = G.diff = DIFFS[G.diffKey];
  G.sanity = D.sanity;
  if (D.powerOff) G.power = false;
  for (const k in I.ITEM_DEFS) G.stock[k] = Math.max(1, Math.round(I.ITEM_DEFS[k].stock * D.stock));
  I.refreshRack();
  G.ghost.applyDifficulty(D);
}

$('btnStart').addEventListener('click', () => {
  initAudio();
  applyDifficulty();
  UI.hide('menu');
  UI.show('hud');
  G.running = true;
  G.player.flashlight = true;
  try {
    const el = document.documentElement;
    if (el.requestFullscreen && matchMedia('(pointer: coarse)').matches) el.requestFullscreen().then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {});
  } catch (_) { /* */ }
  toast('Возьмите снаряжение со стеллажа слева. «Положить» в фургоне — вернуть на место', 5);
  last = performance.now();
});
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

initScreen(() => {
  camera.aspect = view.w / view.h;
  camera.updateProjectionMatrix();
  applyQuality();
});
initLayoutEditor();
document.querySelectorAll('.orientSel').forEach(sel => {
  sel.value = G.settings.orient;
  sel.addEventListener('change', () => {
    setOrient(sel.value);
    document.querySelectorAll('.orientSel').forEach(o => { o.value = sel.value; });
  });
});
$('btnLayout').addEventListener('click', () => {
  UI.hide('menu');
  openLayoutEditor(() => { UI.hide('hud'); UI.show('menu'); });
});
$('btnLayout2').addEventListener('click', () => {
  UI.closeScreen('pause');
  openLayoutEditor(() => UI.openScreen('pause'));
});

// ---------- цикл ----------
let last = performance.now(), hudT = 0, boardT = 0, heartT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (G.running && !G.paused) {
    G.t += dt;
    updatePlayer(dt);
    if (deathT < 0) {
      G.ghost.update(dt);
      updateSanity(dt);
    } else {
      deathT += dt;
      G.ghost.animate(dt);
      if (deathT > 3) { G.running = false; UI.showResult(true); }
    }
    W.updateDoors(dt);
    W.updateProps(dt);
    W.updateLights(G.t);
    I.updateItems(dt);
    CU.updateCursed(dt);
    AP.updateAppliances(dt);
    updateAtmosphere(dt);
    updateEffects(dt);
    // сердцебиение при охоте рядом
    const gh = G.ghost;
    if (gh.hunting) {
      const d = gh.distTo(G.player.x, G.player.z);
      heartT -= dt;
      if (d < 10 && heartT <= 0) { sfx.heartbeat(0.3 * (1 - d / 10) + 0.05); heartT = 0.4 + d * 0.06; }
      if (d < 9 && Math.random() < dt * 0.25) sfx.growl(gh.x, gh.z);
      if (d < 8 && Math.random() < dt * 1.2) sfx.lightBuzz(gh.x, gh.z);
    }
    hudT -= dt;
    if (hudT <= 0) { hudT = 0.1; target = findTarget(); UI.updateHUD(target); }
    boardT -= dt;
    if (boardT <= 0 && G.player.inVan) { boardT = 1; W.drawSanityBoard(); }
    // старые события
    G.emfSources = G.emfSources.filter(s => s.until > G.t);
  }
  updateCamera(dt);
  updateAudio(dt);
  renderMonitor();
  if (G.pendingPhoto) { G.pendingPhoto = false; takePhotoNow(); }
  const mc = CU.viewCamera(view.w / view.h);
  if (mc) {
    // зеркальце показывает комнату призрака в холодном призрачном свете
    const ai = W.ambient.intensity, ac = W.ambient.color.getHex(), fl = flash.intensity;
    W.ambient.intensity = 1.1; W.ambient.color.setHex(0x9ab4dc); flash.intensity = 0;
    renderer.render(scene, mc);
    W.ambient.intensity = ai; W.ambient.color.setHex(ac); flash.intensity = fl;
  } else renderer.render(scene, camera);
}
W.drawSanityBoard();
updateCamera(0);
$('loading').classList.add('hidden');
requestAnimationFrame(frame);

// для отладки в консоли
window.__G = G;
