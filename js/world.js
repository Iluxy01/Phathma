// Мир: дом, двери, свет, мебель, фургон, улица, коллизии и навигация
import * as THREE from 'three';
import { G, rand, pick } from './state.js';

export const WALL_H = 2.6;
export const MAP = [
  'KKKKKDDDDDBBBBBB',
  'KKKKKDDDDDBBBBBB',
  'KKKKKDDDDDBBBBBB',
  'KKKKKDDDDDBBBBBB',
  'KKKKKHHHHHHWWWWW',
  'SSSSSHHHHHHWWWWW',
  'LLLLLLLLHHCCCCCC',
  'LLLLLLLLHHCCCCCC',
  'LLLLLLLLHHCCCCCC',
  'LLLLLLLLHHCCCCCC',
];
export const MW = 16, MH = 10;

export const ROOMS = {
  K: { name: 'Кухня',    wall: 0x7f9466, floor: 0xa89a80, tile: true,  lights: [[2.5, 2.5]] },
  D: { name: 'Столовая', wall: 0x9b6f55, floor: 0x6b4a32, lights: [[7.5, 2.0]] },
  B: { name: 'Спальня',  wall: 0x5f6f92, floor: 0x7a5a40, lights: [[13, 2.0]] },
  W: { name: 'Ванная',   wall: 0x8fb4b8, floor: 0xd0d4cc, tile: true,  lights: [[13.5, 5.0]] },
  S: { name: 'Кладовка', wall: 0x6e675c, floor: 0x5a5048, lights: [[2.5, 5.5]] },
  L: { name: 'Гостиная', wall: 0xa27a5a, floor: 0x6e4c34, lights: [[3.5, 8.0]] },
  C: { name: 'Детская',  wall: 0xc09a5e, floor: 0x8a6a4a, lights: [[13, 8.0]] },
  H: { name: 'Коридор',  wall: 0x857a6a, floor: 0x5e4634, lights: [[7.5, 4.9], [8.9, 8.0]] },
};
export const HOUSE_ROOMS = Object.keys(ROOMS);

// двери: пары клеток [ax,ay,bx,by]
const DOOR_DEFS = [
  [4, 1, 5, 1],   // кухня - столовая
  [4, 4, 5, 4],   // кухня - коридор
  [7, 3, 7, 4],   // столовая - коридор
  [10, 3, 10, 4], // спальня - коридор
  [10, 5, 11, 5], // коридор - ванная
  [2, 5, 2, 6],   // кладовка - гостиная
  [7, 7, 8, 7],   // гостиная - коридор
  [9, 8, 10, 8],  // коридор - детская
  [8, 9, 8, 10],  // входная дверь
];
const SWITCH_DOOR = { K: 1, D: 2, B: 3, W: 4, S: 5, L: 6, C: 7, H: 8 };

export function cellRoom(cx, cz) {
  if (cz < 0 || cz >= MH || cx < 0 || cx >= MW) return '.';
  return MAP[cz][cx];
}
export function roomAt(x, z) { return cellRoom(Math.floor(x), Math.floor(z)); }

export const colliders = [];   // {x0,x1,z0,z1,kind,door}
export const interactables = [];
export const doors = [];
export const switches = {};    // room -> switch
export const roomLights = {};  // room -> [{light, bulb}]
export const props = [];
export const hideSpots = [];
export const solidCells = new Set();
export let fuseBox = null;
export let frontDoor = null;
export const van = {};
export let ambient, moon;

const doorEdge = {}; // key -> door

// ---------- материалы ----------
const matCache = new Map();
export function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (matCache.has(key)) return matCache.get(key);
  const m = new THREE.MeshLambertMaterial({ color, flatShading: true, ...opts });
  matCache.set(key, m);
  return m;
}
export function box(w, h, d, color, x, y, z, parent, opts) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), opts && opts.isMaterial ? opts : mat(color, opts));
  m.position.set(x, y, z);
  if (parent) parent.add(m);
  return m;
}
function cyl(rt, rb, h, seg, color, x, y, z, parent) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat(color));
  m.position.set(x, y, z);
  if (parent) parent.add(m);
  return m;
}
// низкополигональная «шероховатость» — случайный сдвиг вершин
function jitter(geo, amt) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i, p.getX(i) + rand(-amt, amt), p.getY(i) + rand(-amt, amt), p.getZ(i) + rand(-amt, amt));
  }
  geo.computeVertexNormals();
  return geo;
}

function addCollider(x0, x1, z0, z1, kind = 'furn', extra = {}) {
  const c = { x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1), kind, ...extra };
  colliders.push(c);
  if (kind === 'furn') {
    for (let cx = Math.floor(c.x0); cx <= Math.floor(c.x1); cx++)
      for (let cz = Math.floor(c.z0); cz <= Math.floor(c.z1); cz++) {
        const ccx = cx + 0.5, ccz = cz + 0.5;
        if (ccx > c.x0 && ccx < c.x1 && ccz > c.z0 && ccz < c.z1) solidCells.add(cx + ',' + cz);
      }
  }
  return c;
}

// ---------- построение ----------
export function buildWorld(scene) {
  scene.background = new THREE.Color(0x070a12);
  scene.fog = new THREE.FogExp2(0x070a12, 0.035);
  ambient = new THREE.AmbientLight(0x8090b0, 0.10);
  scene.add(ambient);
  moon = new THREE.HemisphereLight(0x5060a0, 0x101010, 0.0);
  scene.add(moon);

  buildOutside(scene);
  buildFloors(scene);
  buildWalls(scene);
  buildDoors(scene);
  buildLights(scene);
  buildFurniture(scene);
  buildVan(scene);
  buildRoof(scene);
}

function buildFloors(scene) {
  // пол по клеткам с лёгким разбросом цвета
  const pos = [], col = [], c = new THREE.Color();
  for (let z = 0; z < MH; z++) for (let x = 0; x < MW; x++) {
    const r = ROOMS[MAP[z][x]];
    const sub = r.tile ? 2 : 1;
    const s = 1 / sub;
    for (let i = 0; i < sub; i++) for (let j = 0; j < sub; j++) {
      c.setHex(r.floor);
      const k = r.tile ? ((i + j) % 2 ? 0.88 : 1.0) : rand(0.85, 1.05);
      c.multiplyScalar(k);
      const x0 = x + i * s, z0 = z + j * s, x1 = x0 + s, z1 = z0 + s;
      pos.push(x0, 0, z0, x0, 0, z1, x1, 0, z1, x0, 0, z0, x1, 0, z1, x1, 0, z0);
      for (let v = 0; v < 6; v++) col.push(c.r, c.g, c.b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  const floor = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
  floor.position.y = 0.005;
  scene.add(floor);
  // потолок
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(MW, MH), new THREE.MeshLambertMaterial({ color: 0x9a948a, side: THREE.DoubleSide }));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(MW / 2, WALL_H, MH / 2);
  scene.add(ceil);
}

function wallSlab(scene, x, z, w, d, color, y0 = 0, y1 = WALL_H) {
  const m = box(w, y1 - y0, d, color, x, (y0 + y1) / 2, z, scene);
  m.userData.kind = 'block';
  interactables.push(m);
  return m;
}

const EXT = 0x4a3f36, EXT2 = 0x3b322b;

function buildWalls(scene) {
  const T = 0.06; // половина толщины
  const doorKeys = new Set(DOOR_DEFS.map(edgeKey));
  // вертикальные рёбра x = X
  for (let X = 0; X <= MW; X++) {
    let run = null;
    const flush = () => {
      if (!run) return;
      const len = run.end - run.start, zc = (run.start + run.end) / 2;
      if (run.a !== '.') wallSlab(scene, X - T / 2, zc, T, len + 0.12, ROOMS[run.a].wall);
      else wallSlab(scene, X - T / 2, zc, T, len + 0.12, EXT);
      if (run.b !== '.') wallSlab(scene, X + T / 2, zc, T, len + 0.12, ROOMS[run.b].wall);
      else wallSlab(scene, X + T / 2, zc, T, len + 0.12, EXT);
      addCollider(X - 0.07, X + 0.07, run.start - 0.07, run.end + 0.07, 'wall');
      run = null;
    };
    for (let y = 0; y < MH; y++) {
      const a = cellRoom(X - 1, y), b = cellRoom(X, y);
      const isWall = a !== b && !doorKeys.has(`v${X},${y}`);
      if (isWall && run && run.a === a && run.b === b && run.end === y) run.end = y + 1;
      else { flush(); if (isWall) run = { start: y, end: y + 1, a, b }; }
    }
    flush();
  }
  // горизонтальные рёбра z = Z
  for (let Z = 0; Z <= MH; Z++) {
    let run = null;
    const flush = () => {
      if (!run) return;
      const len = run.end - run.start, xc = (run.start + run.end) / 2;
      wallSlab(scene, xc, Z - T / 2, len + 0.12, T, run.a !== '.' ? ROOMS[run.a].wall : EXT);
      wallSlab(scene, xc, Z + T / 2, len + 0.12, T, run.b !== '.' ? ROOMS[run.b].wall : EXT);
      addCollider(run.start - 0.07, run.end + 0.07, Z - 0.07, Z + 0.07, 'wall');
      run = null;
    };
    for (let x = 0; x < MW; x++) {
      const a = cellRoom(x, Z - 1), b = cellRoom(x, Z);
      const isWall = a !== b && !doorKeys.has(`h${x},${Z}`);
      if (isWall && run && run.a === a && run.b === b && run.end === x) run.end = x + 1;
      else { flush(); if (isWall) run = { start: x, end: x + 1, a, b }; }
    }
    flush();
  }
  // плинтус снаружи
  // цоколь — только полоса снаружи стен
  box(MW + 0.36, 0.3, 0.12, EXT2, MW / 2, 0.15, -0.12, scene);
  box(MW + 0.36, 0.3, 0.12, EXT2, MW / 2, 0.15, MH + 0.12, scene);
  box(0.12, 0.3, MH + 0.36, EXT2, -0.12, 0.15, MH / 2, scene);
  box(0.12, 0.3, MH + 0.36, EXT2, MW + 0.12, 0.15, MH / 2, scene);
}

function edgeKey(d) {
  const [ax, ay, bx, by] = d;
  if (ay === by) return `v${Math.max(ax, bx)},${ay}`;
  return `h${ax},${Math.max(ay, by)}`;
}

function buildDoors(scene) {
  DOOR_DEFS.forEach((d, i) => {
    const [ax, ay, bx, by] = d;
    const vertical = ay === by;
    const ra = cellRoom(Math.min(ax, bx), Math.min(ay, by));
    const rb = cellRoom(Math.max(ax, bx), Math.max(ay, by));
    const isFront = rb === '.';
    const pivot = new THREE.Group();
    let cx, cz, base, sign;
    // в какую сторону открывается: в комнату (не в коридор)
    const intoB = isFront ? false : (ra === 'H' ? true : rb === 'H' ? false : true);
    if (vertical) {
      const X = Math.max(ax, bx), y = ay;
      pivot.position.set(X, 0, y + 0.04);
      base = -Math.PI / 2; sign = intoB ? 1 : -1;
      cx = X; cz = y + 0.5;
      // перемычка
      wallSlab(scene, X, cz, 0.12, 1.12, ROOMS[ra]?.wall || EXT, 2.1, WALL_H);
    } else {
      const Z = Math.max(ay, by), x = ax;
      pivot.position.set(x + 0.04, 0, Z);
      base = 0; sign = intoB ? -1 : 1;
      cx = x + 0.5; cz = Z;
      wallSlab(scene, cx, Z, 1.12, 0.12, ROOMS[ra]?.wall || EXT, 2.1, WALL_H);
    }
    pivot.rotation.y = base;
    const panelColor = isFront ? 0x5a2e1e : 0x7a5c3e;
    const panel = box(0.92, 2.06, 0.05, panelColor, 0.46, 1.03, 0, pivot);
    panel.userData.kind = 'door';
    box(0.6, 0.6, 0.06, 0x684c32, 0.46, 1.5, 0, pivot);
    box(0.6, 0.6, 0.06, 0x684c32, 0.46, 0.6, 0, pivot);
    const knob = new THREE.Mesh(new THREE.IcosahedronGeometry(0.035, 0), mat(0xc8b060));
    knob.position.set(0.82, 1.0, 0.05); pivot.add(knob);
    const knob2 = knob.clone(); knob2.position.z = -0.05; pivot.add(knob2);
    scene.add(pivot);
    const door = {
      i, pivot, panel, base, sign, angle: 0, target: 0, speed: 3,
      vertical, cx, cz, ra, rb, isFront, locked: false,
      cells: [[ax, ay], [bx, by]],
    };
    door.collider = vertical
      ? addCollider(cx - 0.07, cx + 0.07, cz - 0.5, cz + 0.5, 'door', { door })
      : addCollider(cx - 0.5, cx + 0.5, cz - 0.07, cz + 0.07, 'door', { door });
    panel.userData.door = door;
    interactables.push(panel);
    doors.push(door);
    doorEdge[edgeKey(d)] = door;
    if (isFront) frontDoor = door;
    if (!isFront && Math.random() < 0.5) { door.angle = door.target = rand(0.6, 1.4); }
  });
  // выключатели
  for (const r of HOUSE_ROOMS) {
    const door = doors[SWITCH_DOOR[r]];
    const sw = makeSwitch(scene, door, r);
    switches[r] = sw;
  }
}

function makeSwitch(scene, door, room) {
  const [ax, ay] = door.cells[0], [bx, by] = door.cells[1];
  let pos, rotY;
  if (door.vertical) {
    const X = door.cx, y = ay;
    const roomIsB = cellRoom(Math.max(ax, bx), ay) === room;
    const off = roomIsB ? 0.075 : -0.075;
    const side = roomIsB ? X : X - 1;
    let z = y - 0.25;
    if (!(cellRoom(side, y - 1) === room && cellRoom(roomIsB ? X - 1 : X, y - 1) !== room)) z = y + 1.25;
    pos = [X + off, 1.3, z]; rotY = roomIsB ? Math.PI / 2 : -Math.PI / 2;
  } else {
    const Z = door.cz, x = ax;
    const roomIsB = cellRoom(ax, Math.max(ay, by)) === room;
    const off = roomIsB ? 0.075 : -0.075;
    const side = roomIsB ? Z : Z - 1;
    let xx = x + 1.25;
    if (!(cellRoom(x + 1, side) === room && cellRoom(x + 1, roomIsB ? Z - 1 : Z) !== room)) xx = x - 0.25;
    pos = [xx, 1.3, Z + off]; rotY = roomIsB ? 0 : Math.PI;
  }
  const g = new THREE.Group();
  g.position.set(...pos); g.rotation.y = rotY;
  const plate = box(0.1, 0.14, 0.02, 0xe8e2d0, 0, 0, 0, g);
  const tog = box(0.03, 0.05, 0.03, 0xd0c8b0, 0, 0.02, 0.015, g);
  plate.userData.kind = 'switch'; plate.userData.room = room;
  tog.userData.kind = 'switch'; tog.userData.room = room;
  interactables.push(plate, tog);
  scene.add(g);
  return { group: g, tog, room, x: pos[0], z: pos[2], y: pos[1], rotY };
}

function buildLights(scene) {
  for (const r of HOUSE_ROOMS) {
    roomLights[r] = [];
    G.lightsOn[r] = false;
    for (const [x, z] of ROOMS[r].lights) {
      const light = new THREE.PointLight(0xffd9a0, 0, 9, 1.4);
      light.position.set(x, WALL_H - 0.35, z);
      scene.add(light);
      // плафон
      const shade = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.18, 6, 1, true), mat(0xd8c8a0, { side: THREE.DoubleSide }));
      shade.position.set(x, WALL_H - 0.2, z);
      scene.add(shade);
      const bulbMat = new THREE.MeshBasicMaterial({ color: 0x302a20 });
      const bulb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.07, 0), bulbMat);
      bulb.position.set(x, WALL_H - 0.3, z);
      scene.add(bulb);
      box(0.02, 0.2, 0.02, 0x222222, x, WALL_H - 0.08, z, scene);
      roomLights[r].push({ light, bulb, x, z });
    }
  }
  // фонарь на крыльце
  const porch = new THREE.PointLight(0xffb070, 3.5, 7, 1.5);
  porch.position.set(8.5, 2.3, 10.6);
  scene.add(porch);
  const pl = new THREE.Mesh(new THREE.IcosahedronGeometry(0.09, 0), new THREE.MeshBasicMaterial({ color: 0xffcc88 }));
  pl.position.set(9.3, 2.2, 10.12); scene.add(pl);
  // щиток в кладовке
  const fb = new THREE.Group();
  fb.position.set(0.12, 1.4, 5.5);
  const body = box(0.08, 0.45, 0.35, 0x6a6e70, 0, 0, 0, fb);
  const lever = box(0.1, 0.12, 0.05, 0xb03020, 0.05, 0.08, 0, fb);
  const ledMat = new THREE.MeshBasicMaterial({ color: 0x20ff40 });
  const led = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.03, 0.03), ledMat);
  led.position.set(0.05, -0.12, 0.1); fb.add(led);
  body.userData.kind = 'fuse'; lever.userData.kind = 'fuse';
  interactables.push(body, lever);
  scene.add(fb);
  fuseBox = { group: fb, lever, led, x: 0.12, z: 5.5 };
}

export function roomLit(r) {
  return !!(r && r !== '.' && G.power && G.lightsOn[r]);
}

export function setLight(r, on) {
  if (!ROOMS[r]) return;
  G.lightsOn[r] = on;
  const sw = switches[r];
  if (sw) sw.tog.position.y = on ? 0.02 : -0.02;
}

export function updateLights(t) {
  const gh = G.ghost;
  for (const r of HOUSE_ROOMS) {
    for (const L of roomLights[r]) {
      let on = roomLit(r);
      let k = 1;
      if (on && gh && (gh.hunting || gh.eventActive) && Math.hypot(gh.x - L.x, gh.z - L.z) < 8) {
        // мерцание рядом с призраком
        k = Math.sin(t * 37 + L.x) > 0.2 ? (Math.random() < 0.7 ? 0.05 : 1) : 0.2;
      }
      L.light.intensity = on ? 3.2 * k : 0;
      L.bulb.material.color.setHex(on && k > 0.5 ? 0xfff0c0 : 0x302a20);
    }
  }
  fuseBox.led.material.color.setHex(G.power ? 0x20ff40 : 0xff2020);
  fuseBox.lever.position.y = G.power ? 0.08 : -0.08;
}

// ---------- мебель ----------
function furn(scene, x0, z0, x1, z1, top = 1, levels = null) {
  addCollider(x0, x1, z0, z1, 'furn', { top, levels });
}

function table(scene, cx, cz, w, d, color = 0x7a5432, h = 0.76) {
  box(w, 0.06, d, color, cx, h, cz, scene);
  const lx = w / 2 - 0.08, lz = d / 2 - 0.08;
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) box(0.06, h, 0.06, color, cx + sx * lx, h / 2, cz + sz * lz, scene);
  furn(scene, cx - w / 2, cz - d / 2, cx + w / 2, cz + d / 2, h + 0.03);
  return h + 0.03;
}
function chair(scene, cx, cz, face, color = 0x6a4a2e) {
  const g = new THREE.Group(); g.position.set(cx, 0, cz); g.rotation.y = face;
  box(0.42, 0.05, 0.42, color, 0, 0.45, 0, g);
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) box(0.04, 0.45, 0.04, color, sx * 0.18, 0.225, sz * 0.18, g);
  box(0.42, 0.5, 0.04, color, 0, 0.72, -0.19, g);
  scene.add(g);
}
function bed(scene, cx, cz, w, l, color = 0x8a3a3a, rot = 0) {
  const g = new THREE.Group(); g.position.set(cx, 0, cz); g.rotation.y = rot;
  box(w, 0.3, l, 0x5a3a24, 0, 0.15, 0, g);
  box(w - 0.06, 0.18, l - 0.1, 0xe8e0d0, 0, 0.39, 0.02, g);
  box(w - 0.04, 0.08, l * 0.6, color, 0, 0.5, l * 0.18, g);
  box(w * 0.35, 0.1, 0.3, 0xf0f0f0, -w * 0.22, 0.52, -l / 2 + 0.25, g);
  box(w * 0.35, 0.1, 0.3, 0xf0f0f0, w * 0.22, 0.52, -l / 2 + 0.25, g);
  box(w, 0.9, 0.06, 0x5a3a24, 0, 0.45, -l / 2, g);
  scene.add(g);
  const hw = rot ? l / 2 : w / 2, hl = rot ? w / 2 : l / 2;
  furn(scene, cx - hw, cz - hl, cx + hw, cz + hl, 0.56);
}
function wardrobe(scene, cx, cz, rot, room) {
  const g = new THREE.Group(); g.position.set(cx, 0, cz); g.rotation.y = rot;
  const body = box(1.0, 2.0, 0.6, 0x5c3f28, 0, 1.0, 0, g);
  const d1 = box(0.48, 1.9, 0.03, 0x6e4d32, -0.25, 1.0, 0.31, g);
  const d2 = box(0.48, 1.9, 0.03, 0x6e4d32, 0.25, 1.0, 0.31, g);
  box(0.03, 0.15, 0.03, 0xc8b060, -0.04, 1.1, 0.34, g);
  box(0.03, 0.15, 0.03, 0xc8b060, 0.04, 1.1, 0.34, g);
  scene.add(g);
  const fx = Math.sin(rot), fz = Math.cos(rot);
  const spot = { x: cx, z: cz, out: { x: cx + fx * 0.75, z: cz + fz * 0.75 }, yaw: Math.atan2(-fx, -fz), room, group: g };
  for (const m of [body, d1, d2]) { m.userData.kind = 'hide'; m.userData.spot = spot; interactables.push(m); }
  hideSpots.push(spot);
  const hw = rot % Math.PI ? 0.3 : 0.5, hd = rot % Math.PI ? 0.5 : 0.3;
  furn(scene, cx - hw, cz - hd, cx + hw, cz + hd, 2.0);
}
function shelf(scene, x0, z0, x1, z1, h = 1.8, color = 0x5e4a36) {
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0;
  for (let i = 0; i < 4; i++) box(w, 0.04, d, color, cx, 0.1 + i * (h - 0.1) / 3, cz, scene);
  box(0.04, h, d, color, x0 + 0.02, h / 2, cz, scene);
  box(0.04, h, d, color, x1 - 0.02, h / 2, cz, scene);
  // коробки
  for (let i = 0; i < 4; i++) {
    const s = rand(0.18, 0.3);
    box(s, s, Math.min(s, d - 0.05), pick([0x8a7050, 0x9a8060, 0x705a40, 0x4a5a6a]), rand(x0 + 0.2, x1 - 0.2), 0.12 + Math.floor(rand(0, 3)) * (h - 0.1) / 3 + s / 2, cz, scene);
  }
  furn(scene, x0, z0, x1, z1, h, [0, 1, 2, 3].map(i => 0.12 + i * (h - 0.1) / 3));
}
function plant(scene, x, z) {
  cyl(0.15, 0.11, 0.3, 6, 0x8a4a30, x, 0.15, z, scene);
  const leaves = new THREE.Mesh(jitter(new THREE.IcosahedronGeometry(0.3, 0), 0.06), mat(0x3a6a34));
  leaves.position.set(x, 0.6, z); scene.add(leaves);
  furn(scene, x - 0.2, z - 0.2, x + 0.2, z + 0.2, 0.9);
}
function rug(scene, cx, cz, w, d, color) {
  const m = box(w, 0.01, d, color, cx, 0.012, cz, scene);
  return m;
}

function addProp(scene, kind, x, y, z) {
  let geo, color, r = 0.08, snd = 'wood';
  switch (kind) {
    case 'cup': snd = 'ceramic'; geo = new THREE.CylinderGeometry(0.045, 0.035, 0.1, 6); color = pick([0xd0d0d0, 0xc04040, 0x4060a0]); r = 0.05; break;
    case 'book': geo = new THREE.BoxGeometry(0.16, 0.04, 0.22); color = pick([0x803030, 0x305080, 0x406030, 0x705020]); r = 0.1; break;
    case 'bottle': snd = 'glass'; geo = new THREE.CylinderGeometry(0.035, 0.045, 0.25, 6); color = 0x3a7040; r = 0.05; break;
    case 'plate': snd = 'ceramic'; geo = new THREE.CylinderGeometry(0.11, 0.09, 0.025, 8); color = 0xe8e8e0; r = 0.11; break;
    case 'toy': snd = 'plastic'; geo = new THREE.IcosahedronGeometry(0.09, 0); color = pick([0xe0c030, 0xe05050, 0x50a0e0]); r = 0.09; break;
    case 'box': geo = new THREE.BoxGeometry(0.2, 0.15, 0.2); color = 0x9a7a50; r = 0.12; break;
    default: geo = new THREE.BoxGeometry(0.1, 0.1, 0.1); color = 0x888888;
  }
  const m = new THREE.Mesh(geo, mat(color));
  geo.computeBoundingBox();
  const hy = (geo.boundingBox.max.y - geo.boundingBox.min.y) / 2;
  m.position.set(x, y + hy, z);
  m.rotation.y = rand(0, Math.PI * 2);
  scene.add(m);
  props.push({ mesh: m, vx: 0, vy: 0, vz: 0, r, hy, snd, rest: true, room: roomAt(x, z) });
}

function buildFurniture(scene) {
  // Кухня
  box(3.4, 0.9, 0.62, 0x9a9488, 1.8, 0.45, 0.42, scene);
  box(3.45, 0.05, 0.66, 0x3a3a3a, 1.8, 0.92, 0.42, scene);
  furn(scene, 0.1, 0.1, 3.5, 0.75, 0.945);
  box(0.75, 1.9, 0.7, 0xdcdcd4, 4.1, 0.95, 0.45, scene); furn(scene, 3.72, 0.1, 4.48, 0.82, 1.9);
  box(0.6, 0.05, 0.5, 0x202020, 1.0, 0.95, 0.42, scene); // плита
  let h = table(scene, 2.0, 3.0, 1.4, 0.9);
  chair(scene, 2.0, 2.3, 0); chair(scene, 2.0, 3.7, Math.PI);
  addProp(scene, 'cup', 1.7, h, 3.0); addProp(scene, 'plate', 2.2, h, 2.9); addProp(scene, 'bottle', 2.5, 0.95, 0.4);
  addProp(scene, 'cup', 0.4, 0.95, 0.45); addProp(scene, 'plate', 3.0, 0.95, 0.4);
  // Столовая
  rug(scene, 7.5, 1.8, 3.2, 2.0, 0x6a2a2a);
  h = table(scene, 7.5, 1.8, 2.4, 1.1, 0x5a3a20);
  chair(scene, 6.9, 1.0, 0); chair(scene, 8.1, 1.0, 0); chair(scene, 6.9, 2.6, Math.PI); chair(scene, 8.1, 2.6, Math.PI);
  addProp(scene, 'plate', 7.0, h, 1.7); addProp(scene, 'plate', 8.0, h, 1.9); addProp(scene, 'cup', 7.5, h, 1.6); addProp(scene, 'bottle', 7.6, h, 2.0);
  box(0.5, 1.2, 1.6, 0x4e3420, 9.65, 0.6, 1.4, scene); furn(scene, 9.38, 0.6, 9.92, 2.2, 1.2);
  addProp(scene, 'book', 9.65, 1.2, 1.0);
  plant(scene, 5.4, 0.4);
  // Спальня
  bed(scene, 13.5, 1.3, 1.6, 2.1, 0x7a2a3a);
  wardrobe(scene, 10.65, 0.42, 0, 'B');
  box(0.45, 0.5, 0.45, 0x5a3a24, 15.5, 0.25, 0.5, scene); furn(scene, 15.27, 0.27, 15.92, 0.73, 0.5);
  addProp(scene, 'book', 15.5, 0.5, 0.5);
  box(1.2, 0.85, 0.5, 0x6a4a2e, 15.2, 0.425, 3.6, scene); furn(scene, 14.6, 3.35, 15.92, 3.92, 0.85);
  addProp(scene, 'box', 15.0, 0.85, 3.6); addProp(scene, 'cup', 15.5, 0.85, 3.6);
  rug(scene, 13.5, 3.0, 2.0, 1.2, 0x3a4a6a);
  // Ванная
  box(1.7, 0.6, 0.85, 0xf0f0ec, 15.0, 0.3, 4.55, scene); box(1.5, 0.05, 0.65, 0x8ac0d0, 15.0, 0.58, 4.55, scene); furn(scene, 14.15, 4.1, 15.92, 4.98, 0.6);
  box(0.4, 0.4, 0.5, 0xf4f4f0, 11.9, 0.2, 4.35, scene); box(0.4, 0.4, 0.15, 0xf4f4f0, 11.9, 0.6, 4.15, scene); furn(scene, 11.68, 4.08, 12.12, 4.62, 0.42);
  box(0.6, 0.85, 0.4, 0xe8e8e4, 13.2, 0.425, 5.75, scene); furn(scene, 12.9, 5.55, 13.5, 5.95, 0.85);
  box(0.5, 0.6, 0.02, 0xa0c8d8, 13.2, 1.5, 5.93, scene);
  addProp(scene, 'bottle', 13.0, 0.85, 5.75); addProp(scene, 'cup', 13.4, 0.85, 5.75);
  // Кладовка
  shelf(scene, 0.1, 5.05, 1.6, 5.42);
  shelf(scene, 3.2, 5.05, 4.9, 5.42);
  addProp(scene, 'box', 4.5, 0, 5.75);
  // Гостиная
  rug(scene, 2.2, 7.9, 2.6, 2.2, 0x4a5a3a);
  box(0.45, 0.5, 1.6, 0x3a3030, 0.3, 0.25, 7.8, scene); furn(scene, 0.08, 7.0, 0.53, 8.6, 0.5);
  box(0.08, 0.6, 1.0, 0x101010, 0.3, 0.85, 7.8, scene); // телевизор
  const sofa = new THREE.Group(); sofa.position.set(3.4, 0, 7.8);
  box(0.9, 0.42, 1.9, 0x4a5a7a, 0, 0.21, 0, sofa); box(0.25, 0.85, 1.9, 0x4a5a7a, 0.33, 0.42, 0, sofa);
  box(0.9, 0.6, 0.2, 0x4a5a7a, 0, 0.3, 0.95, sofa); box(0.9, 0.6, 0.2, 0x4a5a7a, 0, 0.3, -0.95, sofa);
  scene.add(sofa); furn(scene, 2.95, 6.8, 3.85, 8.8, 0.42);
  h = table(scene, 1.6, 7.8, 0.7, 1.0, 0x6a4a2e, 0.42);
  addProp(scene, 'cup', 1.5, h, 7.6); addProp(scene, 'book', 1.7, h, 8.0);
  shelf(scene, 4.6, 6.08, 6.6, 6.45, 1.9, 0x4a3420);
  addProp(scene, 'book', 5.2, 0.71, 6.27); addProp(scene, 'book', 6.0, 1.31, 6.27);
  box(0.8, 0.45, 0.8, 0x7a3a2a, 5.6, 0.22, 9.35, scene); box(0.8, 0.5, 0.15, 0x7a3a2a, 5.6, 0.6, 9.7, scene); furn(scene, 5.2, 8.95, 6.0, 9.75, 0.45);
  plant(scene, 7.6, 9.6);
  // Детская
  bed(scene, 15.2, 9.0, 1.0, 1.7, 0x3a7aa0);
  wardrobe(scene, 15.6, 6.75, -Math.PI / 2, 'C');
  box(0.6, 0.4, 0.4, 0xc05030, 12.5, 0.2, 9.6, scene); furn(scene, 12.2, 9.38, 12.8, 9.82, 0.4);
  addProp(scene, 'toy', 12.4, 0.4, 9.6); addProp(scene, 'toy', 12.7, 0.4, 9.6);
  h = table(scene, 12.0, 7.0, 0.8, 0.6, 0xe0d0a0, 0.5);
  addProp(scene, 'cup', 12.0, h, 7.0); addProp(scene, 'toy', 11.8, h, 7.1);
  rug(scene, 12.8, 8.2, 1.6, 1.6, 0xd08aa0);
  // Коридор
  box(0.35, 0.8, 0.9, 0x4e3420, 9.75, 0.4, 7.0, scene); furn(scene, 9.55, 6.55, 9.93, 7.45, 0.8);
  addProp(scene, 'box', 9.75, 0.8, 7.0);
  plant(scene, 5.4, 5.6);
  rug(scene, 8.9, 8.0, 1.2, 3.0, 0x5a3a3a);
}

// ---------- улица ----------
function buildOutside(scene) {
  const ground = new THREE.Mesh(jitter(new THREE.PlaneGeometry(80, 80, 24, 24), 0.0), new THREE.MeshLambertMaterial({ color: 0x1e3020, emissive: 0x08120a, flatShading: true }));
  ground.rotation.x = -Math.PI / 2;
  const p = ground.geometry.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, rand(-0.15, -0.03));
  ground.geometry.computeVertexNormals();
  ground.position.set(8, -0.02, 10);
  scene.add(ground);
  // дорожка
  for (let z = 10.5; z < 15; z += 0.7) {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.38, 0.06, 6), new THREE.MeshLambertMaterial({ color: 0x5a5a5a, emissive: 0x111111, flatShading: true }));
    s.position.set(8.5 + rand(-0.1, 0.1), 0.02, z); scene.add(s);
  }
  // крыльцо
  box(2.2, 0.15, 1.2, 0x4a3a2a, 8.5, 0.07, 10.6, scene);
  // деревья
  const treeMat = new THREE.MeshLambertMaterial({ color: 0x1a3a22, emissive: 0x061008, flatShading: true });
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x3a2a1a, emissive: 0x0a0604, flatShading: true });
  let n = 0;
  while (n < 46) {
    const x = rand(-18, 34), z = rand(-16, 34);
    if (x > -3 && x < 19 && z > -3 && z < 13) continue;
    if (x > 4 && x < 13 && z > 9 && z < 23) continue;
    if (Math.hypot(x - 8, z - 10) < 9) continue;
    const t = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 1.2, 5), trunkMat); trunk.position.y = 0.6; t.add(trunk);
    const hgt = rand(2.5, 5);
    for (let k = 0; k < 3; k++) {
      const c = new THREE.Mesh(jitter(new THREE.ConeGeometry(rand(1.0, 1.6) * (1 - k * 0.25), hgt * 0.5, 6), 0.1), treeMat);
      c.position.y = 1.2 + k * hgt * 0.28 + hgt * 0.2; t.add(c);
    }
    t.position.set(x, 0, z); t.rotation.y = rand(0, 6);
    scene.add(t); n++;
  }
  // забор
  const fenceMat = new THREE.MeshLambertMaterial({ color: 0x3a3026, emissive: 0x0a0806, flatShading: true });
  const fence = (x0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0), steps = Math.floor(len / 1.2);
    for (let i = 0; i <= steps; i++) {
      const tt = i / steps;
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.1, 0.12), fenceMat);
      post.position.set(x0 + (x1 - x0) * tt, 0.55, z0 + (z1 - z0) * tt); scene.add(post);
    }
    const rail = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(x1 - x0) + 0.1, 0.08, Math.abs(z1 - z0) + 0.1), fenceMat);
    rail.position.set((x0 + x1) / 2, 0.85, (z0 + z1) / 2); scene.add(rail);
    const rail2 = rail.clone(); rail2.position.y = 0.45; scene.add(rail2);
  };
  fence(-3, -3, 19, -3); fence(-3, -3, -3, 21); fence(19, -3, 19, 21); fence(-3, 21, 6.5, 21); fence(10.5, 21, 19, 21);
  addCollider(-3.2, -2.8, -3, 21, 'wall'); addCollider(18.8, 19.2, -3, 21, 'wall');
  addCollider(-3, 19, -3.2, -2.8, 'wall'); addCollider(-3, 19, 20.8, 21.2, 'wall');
  // дорога за воротами
  const road = new THREE.Mesh(new THREE.PlaneGeometry(80, 6), new THREE.MeshLambertMaterial({ color: 0x1a1a1c, emissive: 0x050505 }));
  road.rotation.x = -Math.PI / 2; road.position.set(8, 0.0, 25); scene.add(road);
  // луна и звёзды
  const moonM = new THREE.Mesh(new THREE.IcosahedronGeometry(3, 1), new THREE.MeshBasicMaterial({ color: 0xdde4ff, fog: false }));
  moonM.position.set(-40, 45, -60); scene.add(moonM);
  const sp = [];
  for (let i = 0; i < 500; i++) {
    const a = rand(0, Math.PI * 2), e = rand(0.15, 1.4), r = 90;
    sp.push(Math.cos(a) * Math.cos(e) * r + 8, Math.sin(e) * r, Math.sin(a) * Math.cos(e) * r + 10);
  }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.35, fog: false })));
}

function buildRoof(scene) {
  const s = new THREE.Shape();
  s.moveTo(-5.5, 0); s.lineTo(5.5, 0); s.lineTo(0, 2.4); s.lineTo(-5.5, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: 16.8, bevelEnabled: false });
  g.rotateY(Math.PI / 2);
  const roof = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0x4a2a24, emissive: 0x0e0606, flatShading: true }));
  roof.position.set(-0.4, WALL_H + 0.03, 5);
  scene.add(roof);
  box(1.0, 1.4, 1.0, 0x5a4a40, 12.5, WALL_H + 1.8, 3.5, scene); // труба
}

// ---------- фургон ----------
function buildVan(scene) {
  const g = new THREE.Group();
  g.position.set(8.5, 0, 17.2);
  const vanCol = 0xd8d8d0;
  const vm = (c) => new THREE.MeshLambertMaterial({ color: c, emissive: 0x111111, flatShading: true });
  const add = (w, h, d, c, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), vm(c)); m.position.set(x, y, z); g.add(m); return m; };
  add(2.4, 0.1, 4.4, 0x444444, 0, 0.35, 0);                 // пол
  add(0.08, 2.0, 4.4, vanCol, -1.2, 1.35, 0);                // левая стенка
  add(0.08, 2.0, 4.4, vanCol, 1.2, 1.35, 0);                 // правая
  add(2.4, 0.08, 4.4, vanCol, 0, 2.35, 0);                   // крыша
  add(2.4, 2.0, 0.08, vanCol, 0, 1.35, 2.2);                 // перегородка
  add(2.4, 1.3, 1.6, vanCol, 0, 1.0, 3.0);                   // кабина
  add(2.2, 0.6, 0.05, 0x223344, 0, 1.4, 3.8).rotation.x = -0.3; // лобовое
  add(0.08, 0.6, 0.8, 0x223344, 1.21, 1.6, 3.0);
  add(0.08, 0.6, 0.8, 0x223344, -1.21, 1.6, 3.0);
  add(2.5, 0.3, 4.9, 0x333333, 0, 0.3, 0.6);                 // днище
  for (const [x, z] of [[-1.15, -1.3], [1.15, -1.3], [-1.15, 2.8], [1.15, 2.8]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.3, 8), vm(0x111111));
    w.rotation.z = Math.PI / 2; w.position.set(x, 0.4, z); g.add(w);
  }
  const dl = add(1.2, 1.9, 0.06, vanCol, -1.75, 1.3, -2.2); dl.rotation.y = 0;
  const dr = add(1.2, 1.9, 0.06, vanCol, 1.75, 1.3, -2.2);
  add(1.0, 0.4, 0.05, 0x223344, -1.75, 1.7, -2.24); add(1.0, 0.4, 0.05, 0x223344, 1.75, 1.7, -2.24);
  // надпись на борту (полоса)
  add(0.02, 0.25, 3.0, 0x2a4a7a, -1.25, 1.5, 0); add(0.02, 0.25, 3.0, 0x2a4a7a, 1.25, 1.5, 0);
  // стеллаж с оборудованием на левой стене: перфопанель и две полки
  add(0.03, 1.55, 3.95, 0x2b313b, -1.145, 1.33, 0);
  for (let i = 0; i < 40; i++) add(0.005, 0.02, 0.02, 0x14181e, -1.128, 0.7 + (i % 5) * 0.32, -1.85 + Math.floor(i / 5) * 0.53);
  const rackSlots = [];
  for (const [row, y] of [[0, 1.62], [1, 1.02]]) {
    add(0.24, 0.03, 3.95, 0x5a5f68, -1.02, y - 0.015, 0);
    add(0.02, 0.06, 3.95, 0x777c84, -0.9, y + 0.015, 0);
    for (let i = 0; i < 8; i++) rackSlots.push({ x: 8.5 - 1.03, y, z: 17.2 - 1.7 + i * 0.486 });
  }
  // стол с монитором и пультом
  add(0.6, 0.06, 2.2, 0x55555a, 0.88, 0.95, 0.3);
  // монитор камеры
  const monitor = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.6), new THREE.MeshBasicMaterial({ color: 0x9fdf9f }));
  monitor.position.set(1.14, 1.65, 0.75); monitor.rotation.y = -Math.PI / 2; g.add(monitor);
  // табло рассудка
  const sc = document.createElement('canvas'); sc.width = 256; sc.height = 128;
  const stex = new THREE.CanvasTexture(sc);
  const sanityBoard = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.4), new THREE.MeshBasicMaterial({ map: stex }));
  sanityBoard.position.set(1.14, 1.6, -0.3); sanityBoard.rotation.y = -Math.PI / 2; g.add(sanityBoard);
  // журнал
  const journal = add(0.3, 0.04, 0.4, 0x7a2a2a, 0.85, 1.0, -0.5);
  journal.userData.kind = 'vjournal'; interactables.push(journal);
  // кнопка «уехать»
  const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.06, 8), new THREE.MeshBasicMaterial({ color: 0xff3030 }));
  btn.position.set(0.85, 1.01, 1.2); g.add(btn);
  btn.userData.kind = 'leave'; interactables.push(btn);
  add(0.35, 0.03, 0.35, 0x222222, 0.85, 0.99, 1.2).userData.kind = 'leave';
  // свет в фургоне
  const vl = new THREE.PointLight(0xc0d8ff, 2.5, 6, 1.2);
  vl.position.set(0, 2.1, 0); g.add(vl);
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.04, 0.15), new THREE.MeshBasicMaterial({ color: 0xe0f0ff }));
  lamp.position.set(0, 2.29, 0); g.add(lamp);
  scene.add(g);
  // коллизии фургона
  addCollider(7.2, 7.4, 15.0, 19.4, 'van'); addCollider(9.6, 9.8, 15.0, 19.4, 'van');
  addCollider(7.2, 9.8, 19.3, 21.0, 'van');
  addCollider(5.9, 7.3, 14.9, 15.1, 'van'); addCollider(9.7, 11.1, 14.9, 15.1, 'van');
  addCollider(7.3, 7.62, 15.2, 19.2, 'furn', { top: 2 }); // стеллаж
  addCollider(9.2, 9.6, 16.35, 18.6, 'furn', { top: 0.98 }); // стол
  Object.assign(van, { group: g, rackSlots, monitor, sanityBoard, sanityCanvas: sc, sanityTex: stex, x: 8.5, z: 17.2 });
}

export function inVanArea(x, z) { return x > 7.3 && x < 9.7 && z > 15.0 && z < 19.4; }

export function drawSanityBoard() {
  const c = van.sanityCanvas, ctx = c.getContext('2d');
  ctx.fillStyle = '#0a1a10'; ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = '#7f7'; ctx.font = 'bold 22px monospace';
  ctx.fillText('РАССУДОК', 16, 32);
  ctx.font = 'bold 48px monospace';
  const s = Math.round(G.sanity);
  ctx.fillStyle = s > 50 ? '#7f7' : s > 25 ? '#fd5' : '#f55';
  ctx.fillText(s + '%', 16, 92);
  ctx.fillStyle = '#244'; ctx.fillRect(140, 30, 100, 70);
  ctx.fillStyle = s > 50 ? '#3c3' : s > 25 ? '#cb3' : '#c33';
  ctx.fillRect(140, 30 + 70 * (1 - s / 100), 100, 70 * s / 100);
  van.sanityTex.needsUpdate = true;
}

// ---------- коллизии ----------
function colliderActive(c) {
  if (c.kind === 'door') return c.door.angle < 0.35;
  return true;
}

export function collideCircle(x, z, r) {
  for (let pass = 0; pass < 2; pass++) {
    for (const c of colliders) {
      if (!colliderActive(c)) continue;
      const nx = Math.max(c.x0, Math.min(x, c.x1)), nz = Math.max(c.z0, Math.min(z, c.z1));
      const dx = x - nx, dz = z - nz, d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2), push = r - d;
          x += dx / d * push; z += dz / d * push;
        } else {
          // центр внутри — выталкиваем по наименьшей оси
          const l = x - c.x0, rr = c.x1 - x, t = z - c.z0, b = c.z1 - z;
          const m = Math.min(l, rr, t, b);
          if (m === l) x = c.x0 - r; else if (m === rr) x = c.x1 + r; else if (m === t) z = c.z0 - r; else z = c.z1 + r;
        }
      }
    }
  }
  return { x, z };
}

// высота ближайшей поверхности под точкой (стол, кровать, полка...); 0 — пол.
// y — текущая высота низа предмета: учитываются только поверхности не выше него
export function surfaceAt(x, z, y = Infinity, r = 0) {
  let h = 0;
  for (const c of colliders) {
    if (c.kind !== 'furn' || !c.top) continue;
    if (!(x > c.x0 - r && x < c.x1 + r && z > c.z0 - r && z < c.z1 + r)) continue;
    for (const lv of (c.levels || [c.top])) if (lv <= y + 0.06 && lv > h) h = lv;
  }
  return h;
}
// препятствие для летящего предмета на высоте y: стены, закрытые двери, мебель выше y (стеллажи открыты)
export function solidAt(x, z, y, r = 0.05) {
  for (const c of colliders) {
    if (c.kind === 'door' && c.door.angle >= 0.35) continue;
    if (c.kind === 'furn' && (c.levels || (c.top || 1) <= y)) continue;
    if (x > c.x0 - r && x < c.x1 + r && z > c.z0 - r && z < c.z1 + r) return true;
  }
  return false;
}

export function pointBlocked(x, z, r = 0.05) {
  for (const c of colliders) {
    if (!colliderActive(c)) continue;
    if (x > c.x0 - r && x < c.x1 + r && z > c.z0 - r && z < c.z1 + r) return true;
  }
  return false;
}

// пересечение отрезка со стенами/закрытыми дверями (линия видимости)
export function segBlocked(x0, z0, x1, z1) {
  const dx = x1 - x0, dz = z1 - z0;
  for (const c of colliders) {
    if (c.kind !== 'wall' && !(c.kind === 'door' && c.door.angle < 0.35)) continue;
    let tmin = 0, tmax = 1;
    if (Math.abs(dx) < 1e-9) { if (x0 < c.x0 || x0 > c.x1) continue; }
    else {
      let t1 = (c.x0 - x0) / dx, t2 = (c.x1 - x0) / dx;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }
    if (Math.abs(dz) < 1e-9) { if (z0 < c.z0 || z0 > c.z1) continue; }
    else {
      let t1 = (c.z0 - z0) / dz, t2 = (c.z1 - z0) / dz;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }
    return true;
  }
  return false;
}

// ---------- навигация (A* по клеткам) ----------
function passable(ax, az, bx, bz) {
  const ra = cellRoom(ax, az), rb = cellRoom(bx, bz);
  if (ra === '.' || rb === '.') return false;
  if (ra === rb) return true;
  const key = ax === bx ? `h${ax},${Math.max(az, bz)}` : `v${Math.max(ax, bx)},${az}`;
  return !!doorEdge[key];
}
export function doorBetween(ax, az, bx, bz) {
  const key = ax === bx ? `h${ax},${Math.max(az, bz)}` : `v${Math.max(ax, bx)},${az}`;
  return doorEdge[key] || null;
}

export function findPath(sx, sz, tx, tz) {
  const start = [Math.floor(sx), Math.floor(sz)], goal = [Math.floor(tx), Math.floor(tz)];
  if (cellRoom(...start) === '.' || cellRoom(...goal) === '.') return null;
  const key = (x, z) => z * MW + x;
  const open = [[start[0], start[1]]];
  const came = new Map(), gS = new Map([[key(...start), 0]]);
  const h = (x, z) => Math.abs(x - goal[0]) + Math.abs(z - goal[1]);
  const fS = new Map([[key(...start), h(...start)]]);
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (fS.get(key(...open[i])) < fS.get(key(...open[bi]))) bi = i;
    const [cx, cz] = open.splice(bi, 1)[0];
    if (cx === goal[0] && cz === goal[1]) {
      const path = [[cx + 0.5, cz + 0.5]];
      let k = key(cx, cz);
      while (came.has(k)) { const p = came.get(k); path.unshift([p[0] + 0.5, p[1] + 0.5]); k = key(...p); }
      path.shift();
      path.push([tx, tz]);
      return path;
    }
    for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + ox, nz = cz + oz;
      if (!passable(cx, cz, nx, nz)) continue;
      const ng = gS.get(key(cx, cz)) + 1;
      const nk = key(nx, nz);
      if (ng < (gS.has(nk) ? gS.get(nk) : 1e9)) {
        came.set(nk, [cx, cz]); gS.set(nk, ng); fS.set(nk, ng + h(nx, nz));
        if (!open.some(o => o[0] === nx && o[1] === nz)) open.push([nx, nz]);
      }
    }
  }
  return null;
}

export function randomCellIn(room) {
  const cells = [];
  for (let z = 0; z < MH; z++) for (let x = 0; x < MW; x++) {
    if ((room ? MAP[z][x] === room : true) && !solidCells.has(x + ',' + z)) cells.push([x, z]);
  }
  const c = pick(cells);
  return [c[0] + rand(0.25, 0.75), c[1] + rand(0.25, 0.75)];
}

export function updateDoors(dt) {
  for (const d of doors) {
    const diff = d.target - d.angle;
    if (Math.abs(diff) > 0.001) d.angle += Math.sign(diff) * Math.min(Math.abs(diff), d.speed * dt);
    d.pivot.rotation.y = d.base + d.sign * d.angle;
  }
}

// ---------- физика предметов ----------
export function updateProps(dt) {
  for (const p of props) {
    if (p.rest) continue;
    const m = p.mesh;
    p.vy -= 9.8 * dt;
    const bottom = m.position.y - p.hy;
    let nx = m.position.x + p.vx * dt, nz = m.position.z + p.vz * dt, ny = m.position.y + p.vy * dt;
    if (solidAt(nx, m.position.z, bottom, p.r * 0.6)) { p.vx *= -0.4; nx = m.position.x; }
    if (solidAt(m.position.x, nz, bottom, p.r * 0.6)) { p.vz *= -0.4; nz = m.position.z; }
    const floor = surfaceAt(nx, nz, bottom) + p.hy;
    if (ny < floor) {
      ny = floor;
      if (p.vy < -1 && G.onPropImpact) G.onPropImpact(p, -p.vy);
      if (Math.abs(p.vy) > 1.2) p.vy = -p.vy * 0.3; else p.vy = 0;
      p.vx *= 0.6; p.vz *= 0.6;
      if (Math.abs(p.vx) + Math.abs(p.vz) < 0.1 && p.vy === 0) { p.rest = true; p.room = roomAt(nx, nz); }
    } else {
      m.rotation.x += p.vx * dt * 3; m.rotation.z += p.vz * dt * 3;
    }
    m.position.set(nx, ny, nz);
  }
}
