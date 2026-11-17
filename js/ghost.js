// Призраки: типы, поведение, охота
import * as THREE from 'three';
import { G, rand, randi, pick, clamp, completeObjective } from './state.js';
import {
  HOUSE_ROOMS, ROOMS, roomAt, findPath, randomCellIn, doors, switches, props,
  setLight, roomLit, segBlocked, frontDoor, fuseBox, mat,
} from './world.js';
import { sfx, setHuntAudio, setHuntIntensity } from './audio.js';
import { addPrint, tryCrucifix, saltPiles, stepSalt, drawBook, heldElectronicOn } from './items.js';

export const GHOSTS = [
  {
    id: 'skryten', name: 'Скрытень', ev: ['emf', 'book', 'temp'], hunt: 35,
    desc: 'Застенчивый дух, который сторонится живых.',
    strength: 'Почти ничего не делает, когда люди рядом, — его трудно выследить.',
    weakness: 'Начинает охоту только при очень низком рассудке (35%).',
    mods: { shy: true, activity: 0.7 },
  },
  {
    id: 'barabashka', name: 'Барабашка', ev: ['box', 'uv', 'book'], hunt: 50,
    desc: 'Шумный дух, который обожает швырять вещи.',
    strength: 'Может бросить несколько предметов разом; каждый бросок рядом с вами отнимает рассудок.',
    weakness: 'В пустой комнате почти бессилен.',
    mods: { throwMul: 3, multiThrow: true, activity: 1.3 },
  },
  {
    id: 'bes', name: 'Бес', ev: ['uv', 'book', 'temp'], hunt: 70,
    desc: 'Самый агрессивный дух из известных.',
    strength: 'Начинает охоту уже при 70% рассудка и повторяет её чаще.',
    weakness: 'Распятие действует на него в радиусе 5 м, а не 3 м.',
    mods: { cooldown: 18, crucifix: 5, smudge: 60, activity: 1.1 },
  },
  {
    id: 'morok', name: 'Морок', ev: ['emf', 'temp', 'orbs'], hunt: 50,
    desc: 'Дух тьмы, порождение мрака.',
    strength: 'Гасит свет и вырубает щиток. В темноте охотится быстрее и раньше (при 60%).',
    weakness: 'На свету замедляется и реже начинает охоту (40%). Никогда не включает свет.',
    mods: { lightsOff: true, breaker: 3, darkSpeed: true },
  },
  {
    id: 'kikimora', name: 'Кикимора', ev: ['box', 'orbs', 'uv'], hunt: 50,
    desc: 'Пакостница, которая любит хлопать дверьми.',
    strength: 'Очень быстра, пока находится далеко от жертвы.',
    weakness: 'Вблизи сильно замедляется — от неё можно оторваться.',
    mods: { farFast: true, doorMul: 3 },
  },
  {
    id: 'navka', name: 'Навка', ev: ['emf', 'box', 'orbs'], hunt: 50,
    desc: 'Водяной дух утопленницы.',
    strength: 'Часто показывается и поёт. Во время охоты дольше остаётся невидимой.',
    weakness: 'Тянется к воде — постоянно бродит в ванной.',
    mods: { eventMul: 2.2, water: true, blinkOff: true },
  },
  {
    id: 'upyr', name: 'Упырь', ev: ['emf', 'uv', 'orbs'], hunt: 50,
    desc: 'Хищник, питающийся страхом.',
    strength: 'Увидев жертву, стремительно разгоняется. Рядом с ним рассудок тает быстрее.',
    weakness: 'Без прямой видимости двигается очень медленно.',
    mods: { losSpeed: true, drainNear: true },
  },
  {
    id: 'domovoy', name: 'Домовой', ev: ['box', 'temp', 'orbs'], hunt: 50,
    desc: 'Старый хозяин дома, не терпящий чужаков.',
    strength: 'Злится, когда в его комнату приносят вещи: каждый предмет повышает порог охоты на 5%. В его комнате рассудок падает вдвое быстрее.',
    weakness: 'Почти не покидает свою комнату и любит включать свет.',
    mods: { homebody: true, lightsOn: true, itemsAnger: true, activity: 0.9 },
  },
];

const FIRST_M = ['Пётр', 'Иван', 'Григорий', 'Семён', 'Николай', 'Фёдор', 'Михаил', 'Алексей'];
const FIRST_F = ['Анна', 'Мария', 'Евдокия', 'Ольга', 'Вера', 'Агата', 'Нина', 'Софья'];
const LAST = ['Соколов', 'Ковалёв', 'Морозов', 'Лебедев', 'Волков', 'Зайцев', 'Беляев', 'Громов'];

function buildGhostMesh(female, height) {
  const g = new THREE.Group();
  const m = new THREE.MeshLambertMaterial({ color: 0x2c3036, emissive: 0x0c0f13, flatShading: true, transparent: true, opacity: 0.88 });
  const skin = new THREE.MeshLambertMaterial({ color: 0x8a9096, emissive: 0x1a1d22, flatShading: true, transparent: true, opacity: 0.9 });
  const add = (geo, mm, x, y, z) => { const o = new THREE.Mesh(geo, mm); o.position.set(x, y, z); g.add(o); return o; };
  add(new THREE.CylinderGeometry(0.2, female ? 0.42 : 0.3, 0.85, 6), m, 0, 0.45, 0);   // низ
  const torso = add(new THREE.CylinderGeometry(0.22, 0.18, 0.6, 6), m, 0, 1.15, 0);
  torso.scale.z = 0.7;
  add(new THREE.CylinderGeometry(0.05, 0.06, 0.12, 5), skin, 0, 1.5, 0);
  const head = add(new THREE.IcosahedronGeometry(0.15, 0), skin, 0, 1.66, 0.01);
  head.scale.set(0.9, 1.12, 0.95);
  if (female) { const hair = add(new THREE.CylinderGeometry(0.14, 0.2, 0.55, 6), m, 0, 1.5, -0.06); hair.scale.z = 0.8; }
  const eyeM = new THREE.MeshBasicMaterial({ color: 0x0a0a0a });
  add(new THREE.BoxGeometry(0.04, 0.025, 0.02), eyeM, -0.05, 1.68, 0.135);
  add(new THREE.BoxGeometry(0.04, 0.025, 0.02), eyeM, 0.05, 1.68, 0.135);
  add(new THREE.BoxGeometry(0.06, 0.02, 0.02), eyeM, 0, 1.59, 0.14);
  const armL = new THREE.Group(), armR = new THREE.Group();
  armL.position.set(-0.26, 1.4, 0); armR.position.set(0.26, 1.4, 0);
  const ag = new THREE.BoxGeometry(0.08, 0.62, 0.08);
  const al = new THREE.Mesh(ag, m); al.position.y = -0.31; armL.add(al);
  const ar = new THREE.Mesh(ag, m); ar.position.y = -0.31; armR.add(ar);
  const hg = new THREE.IcosahedronGeometry(0.05, 0);
  const hl = new THREE.Mesh(hg, skin); hl.position.y = -0.64; armL.add(hl);
  const hr = new THREE.Mesh(hg, skin); hr.position.y = -0.64; armR.add(hr);
  g.add(armL, armR);
  g.scale.setScalar(height);
  g.userData.arms = [armL, armR];
  g.userData.mats = [m, skin];
  return g;
}

export class Ghost {
  constructor(scene, def) {
    this.scene = scene;
    this.def = def;
    this.m = def.mods || {};
    this.home = pick(HOUSE_ROOMS.filter(r => r !== 'H'));
    [this.x, this.z] = randomCellIn(this.home);
    this.female = Math.random() < 0.5;
    this.fullName = pick(this.female ? FIRST_F : FIRST_M) + ' ' + pick(LAST) + (this.female ? 'а' : '');
    this.age = randi(9, 88);
    this.mesh = buildGhostMesh(this.female, rand(0.92, 1.05));
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.path = null; this.pauseUntil = 0; this.yaw = 0;
    this.hunting = false; this.eventActive = false;
    this.tInteract = G.t + 6; this.tEvent = G.t + rand(45, 80); this.tHuntCheck = G.t + 20;
    this.cooldownUntil = 0; this.smudgeUntil = 0; this.blindUntil = 0;
    this.stepAcc = 0; this.footprints = 0; this.losTime = 0; this.repathT = 0;
    this.anger = 0;
    this.orbs = [];
    if (def.ev.includes('orbs')) {
      const om = new THREE.MeshBasicMaterial({ color: 0xe8f4ff, transparent: true, opacity: 0.9, fog: false });
      for (let i = 0; i < 3; i++) {
        const o = new THREE.Mesh(new THREE.IcosahedronGeometry(0.035, 0), om);
        const [ox, oz] = randomCellIn(this.home);
        o.userData = { bx: ox, bz: oz, by: rand(0.8, 2.0), ph: rand(0, 6) };
        o.layers.set(2);
        scene.add(o); this.orbs.push(o);
      }
    }
    // температура
    for (const r of HOUSE_ROOMS) G.temps[r] = r === this.home ? rand(11, 13) : rand(14, 17.5);
    this.baseTemps = { ...G.temps };
    for (const r of HOUSE_ROOMS) this.baseTemps[r] = r === this.home ? 0 : G.temps[r];
  }

  has(ev) { return this.def.ev.includes(ev); }
  distTo(x, z) { return Math.hypot(this.x - x, this.z - z); }

  huntThreshold() {
    let th = this.def.hunt;
    if (this.m.lightsOff || this.m.darkSpeed) th = roomLit(G.player.room) ? 40 : 60;
    if (this.m.itemsAnger) th = Math.min(75, th + 5 * this.anger);
    return th;
  }

  emf(x, z, base) {
    const level = this.has('emf') && Math.random() < 0.25 ? 5 : base;
    G.emfSources.push({ x, z, level, until: G.t + 20 });
  }
  sound(x, z, vol) { G.soundEvents.push({ x, z, vol, t: G.t }); if (G.soundEvents.length > 40) G.soundEvents.shift(); }

  // ---------- основной цикл ----------
  update(dt) {
    const t = G.t;
    this.animate(dt);
    this.updateTemps(dt);
    for (const o of this.orbs) {
      const u = o.userData;
      o.position.set(u.bx + Math.sin(t * 0.3 + u.ph) * 0.8, u.by + Math.sin(t * 0.7 + u.ph) * 0.3, u.bz + Math.cos(t * 0.25 + u.ph) * 0.8);
    }
    if (this.hunting) { this.updateHunt(dt); return; }
    if (this.eventActive) { this.updateEvent(dt); return; }
    // блуждание
    if (this.path && this.path.length) {
      this.moveAlong(dt, 0.9, 0.2);
      if (!this.path.length) { this.path = null; this.pauseUntil = t + rand(1.5, 6); }
    } else if (t > this.pauseUntil) {
      this.chooseRoamTarget();
    }
    if (t > this.tInteract) {
      this.interact();
      const sanF = 1 + (100 - G.sanity) / 80;
      const near = this.distTo(G.player.x, G.player.z) < 8 ? 1.3 : 1;
      const out = G.player.inHouse ? 1 : 0.5;
      this.tInteract = t + rand(7, 15) / ((this.m.activity || 1) * sanF * near * out);
    }
    if (t > this.tEvent) {
      this.tEvent = t + rand(8, 16);
      if (G.player.inHouse && this.distTo(G.player.x, G.player.z) < 10 && Math.random() < 0.45 * (this.m.eventMul || 1)) this.startEvent();
    }
    if (t > this.tHuntCheck) { this.tHuntCheck = t + 4; this.tryHunt(); }
  }

  updateTemps(dt) {
    const gr = roomAt(this.x, this.z);
    for (const r of HOUSE_ROOMS) {
      let target = this.baseTemps[r];
      if (r === this.home) target = this.has('temp') ? -4 : 5.5;
      else if (r === gr) target = Math.min(target, 9);
      G.temps[r] += (target - G.temps[r]) * Math.min(1, dt * 0.03);
    }
  }

  animate(dt) {
    const g = this.mesh;
    g.position.set(this.x, Math.sin(G.t * 2) * 0.03, this.z);
    g.rotation.y = this.yaw;
    const [aL, aR] = g.userData.arms;
    const k = this.hunting ? 1.2 : 0.3;
    aL.rotation.x = Math.sin(G.t * 6) * 0.4 * k - (this.hunting ? 0.6 : 0);
    aR.rotation.x = -Math.sin(G.t * 6) * 0.4 * k - (this.hunting ? 0.6 : 0);
  }

  chooseRoamTarget() {
    const here = roomAt(this.x, this.z);
    let room;
    if (this.m.homebody) room = Math.random() < 0.92 ? this.home : null;
    else if (this.m.water && Math.random() < 0.35) room = 'W';
    else if (here !== this.home) room = Math.random() < 0.8 ? this.home : null;
    else room = Math.random() < 0.72 ? this.home : null;
    const [tx, tz] = randomCellIn(room);
    this.path = findPath(this.x, this.z, tx, tz);
    if (!this.path) this.pauseUntil = G.t + 2;
  }

  moveAlong(dt, speed, stepVol) {
    if (!this.path || !this.path.length) return;
    const [tx, tz] = this.path[0];
    const dx = tx - this.x, dz = tz - this.z, d = Math.hypot(dx, dz);
    const s = speed * dt;
    if (d <= s) { this.x = tx; this.z = tz; this.path.shift(); }
    else { this.x += dx / d * s; this.z += dz / d * s; }
    if (d > 0.01) {
      const ty = Math.atan2(dx, dz);
      let diff = ty - this.yaw; while (diff > Math.PI) diff -= Math.PI * 2; while (diff < -Math.PI) diff += Math.PI * 2;
      this.yaw += diff * Math.min(1, dt * 8);
    }
    this.stepAcc += Math.min(d, s);
    if (this.stepAcc > 0.7) {
      this.stepAcc = 0;
      this.sound(this.x, this.z, stepVol);
      if (this.hunting) sfx.ghostStep(this.x, this.z);
      if (this.footprints > 0) {
        this.footprints--;
        addPrint(this.scene, this.x + Math.cos(this.yaw) * (this.footprints % 2 ? 0.1 : -0.1), 0.012, this.z, this.yaw + Math.PI, true, -Math.PI / 2);
      }
    }
    // соль
    for (const p of saltPiles) {
      if (!p.stepped && Math.hypot(p.x - this.x, p.z - this.z) < 0.4) {
        stepSalt(p); this.footprints = 4; completeObjective('salt');
        this.sound(p.x, p.z, 0.5);
      }
    }
  }

  // ---------- взаимодействия ----------
  interact() {
    const p = G.player;
    const pd = this.distTo(p.x, p.z);
    if (this.m.shy && pd < 4.5 && Math.random() < 0.65) return;
    const opts = [];
    const nearDoors = doors.filter(d => !d.locked && this.distTo(d.cx, d.cz) < 3.2);
    if (nearDoors.length) opts.push(['door', 3 * (this.m.doorMul || 1)]);
    const room = roomAt(this.x, this.z);
    const sw = switches[room];
    if (sw && G.power) {
      const lit = G.lightsOn[room];
      if (this.m.lightsOff) { if (lit) opts.push(['light', 4]); }
      else if (this.m.lightsOn) { if (!lit) opts.push(['light', 2.5]); else opts.push(['light', 0.3]); }
      else opts.push(['light', lit ? 2 : 0.8]);
    }
    const nearProps = props.filter(pr => pr.rest && Math.hypot(pr.mesh.position.x - this.x, pr.mesh.position.z - this.z) < 3.5);
    if (nearProps.length) opts.push(['throw', 2 * (this.m.throwMul || 1)]);
    opts.push(['sound', 1.5]);
    if (G.power) opts.push(['breaker', (this.m.breaker || 0.12)]);
    if (this.m.lightsOn && !G.power) opts.push(['breakerOn', 2]);
    const books = this.has('book') ? G.placed.filter(it => it.type === 'book' && !it.data.written && this.distTo(it.x, it.z) < 3.5) : [];
    if (books.length) opts.push(['book', 6]);
    let tot = opts.reduce((a, o) => a + o[1], 0), r = Math.random() * tot, act = opts[0][0];
    for (const o of opts) { r -= o[1]; if (r <= 0) { act = o[0]; break; } }

    switch (act) {
      case 'door': {
        const d = pick(nearDoors);
        const wasOpen = d.angle > 0.6;
        d.target = wasOpen ? (Math.random() < 0.5 ? 0 : rand(0.2, 0.5)) : rand(0.5, 1.4);
        sfx.door(d.cx, d.cz, wasOpen && d.target === 0);
        this.emf(d.cx, d.cz, 2);
        this.sound(d.cx, d.cz, 0.8);
        if (this.has('uv')) addPrint(d.pivot, rand(0.62, 0.82), rand(0.95, 1.35), Math.random() < 0.5 ? 0.031 : -0.031, 0);
        // отпечаток на обратной стороне смотрит в другую сторону
        const pr = G.prints[G.prints.length - 1];
        if (pr && pr.mesh.position.z < 0 && pr.mesh.parent === d.pivot) pr.mesh.rotation.y = Math.PI;
        break;
      }
      case 'light': {
        setLight(room, !G.lightsOn[room]);
        sfx.click(sw.x, sw.z);
        this.emf(sw.x, sw.z, 2);
        this.sound(sw.x, sw.z, 0.5);
        if (this.has('uv')) addPrint(sw.group, 0, 0, 0.013, 0);
        break;
      }
      case 'throw': {
        const n = this.m.multiThrow ? randi(1, 3) : 1;
        for (let i = 0; i < Math.min(n, nearProps.length); i++) {
          const pr = nearProps[i];
          let ang = rand(0, Math.PI * 2);
          if (Math.random() < 0.4) ang = Math.atan2(p.x - pr.mesh.position.x, p.z - pr.mesh.position.z);
          const sp = rand(2.5, 5);
          pr.vx = Math.sin(ang) * sp; pr.vz = Math.cos(ang) * sp; pr.vy = rand(1, 2.5); pr.rest = false;
          const px = pr.mesh.position.x, pz = pr.mesh.position.z;
          this.emf(px, pz, 3);
          this.sound(px, pz, 0.9);
          if (this.m.multiThrow && pd < 5) G.sanity = Math.max(0, G.sanity - 2);
        }
        break;
      }
      case 'sound': {
        const s = pick(['knock', 'whisper', 'breath', 'steps']);
        if (s === 'knock') sfx.knock(this.x, this.z);
        else if (s === 'whisper') sfx.whisper(this.x, this.z);
        else if (s === 'breath') sfx.breath(this.x, this.z);
        else for (let i = 0; i < 3; i++) setTimeout(() => sfx.ghostStep(this.x, this.z), i * 500);
        this.sound(this.x, this.z, 1);
        break;
      }
      case 'breaker':
        G.power = false; sfx.breaker(false);
        this.emf(fuseBox.x + 0.3, fuseBox.z, 2);
        break;
      case 'breakerOn':
        G.power = true; sfx.breaker(true);
        break;
      case 'book': {
        const it = pick(books);
        it.data.written = true; drawBook(it, true);
        this.sound(it.x, it.z, 0.4);
        break;
      }
    }
  }

  provoke() { this.tInteract = Math.min(this.tInteract, G.t + rand(1, 4)); }

  onItemPlaced(it) {
    if (this.m.itemsAnger && it.room === this.home) { this.anger++; this.provoke(); }
  }

  spiritBoxAnswer(px, pz) {
    if (!this.has('box') || this.hunting) return false;
    if (roomLit(roomAt(px, pz))) return false;
    const d = this.distTo(px, pz);
    const sameRoom = roomAt(px, pz) === roomAt(this.x, this.z);
    if (d > 5.5 && !(sameRoom && d < 8)) return false;
    return Math.random() < 0.6;
  }

  onSmudge(x, z) {
    const d = this.distTo(x, z);
    if (this.hunting) {
      if (d < 6) { this.blindUntil = G.t + 6; this.lastKnown = null; this.path = null; completeObjective('smudgeHunt'); }
    } else {
      if (d < 6 || roomAt(x, z) === roomAt(this.x, this.z)) this.smudgeUntil = G.t + (this.m.smudge || 90);
      if (this.eventActive) this.endEvent();
    }
  }

  // ---------- явления ----------
  startEvent() {
    const p = G.player;
    if (segBlocked(this.x, this.z, p.x, p.z) || this.distTo(p.x, p.z) > 7) {
      // появиться рядом с игроком
      let found = false;
      for (let i = 0; i < 14 && !found; i++) {
        const a = rand(0, Math.PI * 2), r = rand(2.2, 4.5);
        const x = p.x + Math.sin(a) * r, z = p.z + Math.cos(a) * r;
        if (roomAt(x, z) === '.' || segBlocked(p.x, p.z, x, z)) continue;
        this.x = x; this.z = z; found = true;
      }
      if (!found) return;
    }
    this.eventActive = true;
    this.eventMode = this.m.water && Math.random() < 0.5 ? 'sing' : pick(['stand', 'walk', 'walk']);
    this.eventUntil = G.t + rand(2.2, 4);
    this.eventSeen = false;
    this.mesh.visible = true;
    this.path = null;
    this.yaw = Math.atan2(p.x - this.x, p.z - this.z);
    this.emf(this.x, this.z, 4);
    this.sound(this.x, this.z, 0.8);
    if (this.eventMode === 'sing') sfx.singing(this.x, this.z);
    else if (Math.random() < 0.5) sfx.whisper(this.x, this.z);
  }

  updateEvent(dt) {
    const p = G.player;
    this.yaw = Math.atan2(p.x - this.x, p.z - this.z);
    if (this.eventMode === 'walk') {
      const d = this.distTo(p.x, p.z);
      if (d > 0.8) { this.x += (p.x - this.x) / d * dt * 1.1; this.z += (p.z - this.z) / d * dt * 1.1; }
      else { sfx.scream(); G.sanity = Math.max(0, G.sanity - 5); this.endEvent(); return; }
    }
    const left = this.eventUntil - G.t;
    this.mesh.visible = left > 0.8 || Math.random() < 0.5;
    G.flicker = this.distTo(p.x, p.z) < 8 ? 0.6 : 0;
    if (!this.eventSeen && this.playerLooksAtMe()) {
      this.eventSeen = true;
      G.sanity = Math.max(0, G.sanity - 10);
      completeObjective('event');
    }
    if (left <= 0) this.endEvent();
  }

  endEvent() {
    this.eventActive = false;
    this.mesh.visible = false;
    G.flicker = 0;
    this.tEvent = G.t + rand(35, 75) / (this.m.eventMul || 1);
  }

  playerLooksAtMe() {
    const p = G.player;
    const dx = this.x - p.x, dz = this.z - p.z, d = Math.hypot(dx, dz);
    if (d > 14 || segBlocked(p.x, p.z, this.x, this.z)) return false;
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    return (dx * fx + dz * fz) / d > 0.6;
  }

  // ---------- охота ----------
  tryHunt() {
    if (this.hunting || this.eventActive || G.t < this.cooldownUntil || G.t < this.smudgeUntil) return;
    if (!G.player.inHouse || G.player.dead) return;
    const th = this.huntThreshold();
    if (G.sanity > th) return;
    const chance = 0.2 + (th - G.sanity) / 100;
    if (Math.random() > chance) return;
    if (tryCrucifix(this.x, this.z, this.m.crucifix || 3)) { this.cooldownUntil = G.t + 20; return; }
    this.startHunt();
  }

  startHunt() {
    this.hunting = true;
    this.graceUntil = G.t + 3.5;
    this.huntEnd = G.t + rand(28, 40);
    this.losTime = 0; this.lastKnown = null; this.path = null; this.blinkT = 0;
    if (frontDoor.angle > 0.1) sfx.door(frontDoor.cx, frontDoor.cz, true);
    frontDoor.target = 0; frontDoor.locked = true;
    this.mesh.visible = true;
    setHuntAudio(true);
    G.stats.hunts++;
  }

  endHunt() {
    this.hunting = false;
    this.mesh.visible = false;
    frontDoor.locked = false;
    setHuntAudio(false);
    this.cooldownUntil = G.t + (this.m.cooldown || 25);
    G.flicker = 0;
    this.path = null; this.pauseUntil = G.t + 2;
    if (!G.player.dead) completeObjective('survive');
  }

  updateHunt(dt) {
    const p = G.player, t = G.t;
    const d = this.distTo(p.x, p.z);
    const blind = t < this.blindUntil;
    let sees = false, detect = false, elec = false;
    if (!blind && p.inHouse && !p.dead) {
      sees = !p.hidden && d < 20 && !segBlocked(this.x, this.z, p.x, p.z);
      elec = heldElectronicOn() && d < 7.5;
      detect = sees || elec;
    }
    this.losTime = sees ? this.losTime + dt : Math.max(0, this.losTime - dt * 2);
    if (detect) {
      this.lastKnown = { x: p.x, z: p.z };
      this.knowsHidden = !!p.hidden && (p.seenHiding || elec);
    }
    this.repathT -= dt;
    if (sees) this.path = [[p.x, p.z]];
    else if (this.repathT <= 0 || !this.path || !this.path.length) {
      this.repathT = 0.5;
      if (this.lastKnown) {
        if (this.distTo(this.lastKnown.x, this.lastKnown.z) < 0.4) this.lastKnown = null;
        else this.path = findPath(this.x, this.z, this.lastKnown.x, this.lastKnown.z);
      }
      if (!this.lastKnown && (!this.path || !this.path.length)) {
        const [tx, tz] = randomCellIn(null);
        this.path = findPath(this.x, this.z, tx, tz);
      }
    }
    // скорость
    let speed = 1.7 * (1 + Math.min(this.losTime / 13, 1) * 0.65);
    if (this.m.farFast) speed = d > 8 ? 2.7 : d < 3 ? 1.25 : 1.25 + (d - 3) / 5 * 1.45;
    if (this.m.losSpeed) speed = sees ? 1.4 + Math.min(this.losTime / 3, 1) * 1.6 : 1.0;
    if (this.m.darkSpeed) speed *= roomLit(roomAt(this.x, this.z)) ? 0.8 : 1.15;
    if (blind) speed = 1.0;
    this.moveAlong(dt, speed, 1.0);

    // поимка
    if (t > this.graceUntil && d < 0.75 && p.inHouse && !p.dead) {
      if (!p.hidden || this.knowsHidden) { this.kill(); return; }
    }
    // мерцание видимости
    this.blinkT -= dt;
    if (this.blinkT <= 0) {
      this.mesh.visible = !this.mesh.visible;
      this.blinkT = this.mesh.visible ? rand(0.25, 0.8) : (this.m.blinkOff ? rand(0.4, 1.0) : rand(0.08, 0.35));
    }
    G.flicker = d < 10 ? 1 : 0;
    setHuntIntensity(clamp(1 - d / 15, 0, 1));
    if (t > this.huntEnd) this.endHunt();
  }

  kill() {
    const p = G.player;
    p.dead = true;
    this.mesh.visible = true;
    // встать прямо перед игроком
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    this.x = p.x + fx * 0.7; this.z = p.z + fz * 0.7;
    this.yaw = Math.atan2(p.x - this.x, p.z - this.z);
    this.hunting = false;
    setHuntAudio(false);
    sfx.scream();
    if (G.onDeath) G.onDeath();
  }
}
