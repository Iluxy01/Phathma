// Проклятые предметы: в каждом доме лежит один. Дают сведения о призраке, но забирают рассудок
// и могут вызвать «проклятую» охоту, которую не остановить распятием.
import * as THREE from 'three';
import { G, rand, pick, toast, completeObjective, EVIDENCE } from './state.js';
import { ROOMS, mat, box, interactables } from './world.js';
import { sfx } from './audio.js';

const $ = (id) => document.getElementById(id);

// поверхности, на которых может лежать предмет: [x, y, z]
const SPOTS = [
  [2.35, 0.79, 3.2], [7.3, 0.79, 2.05], [1.55, 0.45, 8.05], [12.2, 0.53, 6.9],
  [14.85, 0.85, 3.65], [9.75, 0.8, 7.3], [13.0, 0.56, 1.0], [15.1, 0.56, 9.4],
];

export const CURSED_NAMES = {
  board: 'Говорящая доска', musicbox: 'Музыкальная шкатулка', cards: 'Карты Таро',
  mirror: 'Старое зеркальце', doll: 'Тряпичная кукла',
};

const C = { type: null, mesh: null, broken: false, x: 0, y: 0, z: 0 };
let scene, mirrorCam;

export function spawnCursed(sc, forced) {
  scene = sc;
  C.type = CURSED_NAMES[forced] ? forced : pick(Object.keys(CURSED_NAMES));
  const [x, y, z] = pick(SPOTS);
  Object.assign(C, { x, y, z, broken: false, uses: 0 });
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = rand(0, Math.PI * 2);
  build(g);
  g.traverse(o => { o.userData.kind = 'cursed'; });
  scene.add(g);
  interactables.push(g);
  C.mesh = g;
  if (C.type === 'mirror') {
    mirrorCam = new THREE.PerspectiveCamera(105, 1.6, 0.05, 30);
    mirrorCam.rotation.order = 'YXZ';
  }
  initUI();
}

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'));
  return new THREE.CanvasTexture(c);
}

function build(g) {
  switch (C.type) {
    case 'board': {
      const tex = canvasTex(256, 170, (x) => {
        x.fillStyle = '#6b4424'; x.fillRect(0, 0, 256, 170);
        x.strokeStyle = '#2a1608'; x.lineWidth = 4; x.strokeRect(6, 6, 244, 158);
        x.fillStyle = '#1e0e04'; x.font = 'bold 22px serif';
        x.fillText('ДА', 24, 34); x.fillText('НЕТ', 186, 34);
        x.font = 'bold 15px serif';
        const a = 'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЭЮЯ';
        for (let i = 0; i < a.length; i++) x.fillText(a[i], 18 + (i % 15) * 15.2, 72 + Math.floor(i / 15) * 26);
        x.fillText('1 2 3 4 5 6 7 8 9 0', 50, 130);
        x.font = 'bold 17px serif'; x.fillText('ПРОЩАЙ', 92, 156);
        x.beginPath(); x.arc(128, 26, 12, 0, 7); x.stroke();
      });
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.015, 0.31), [mat(0x4a2a14), mat(0x4a2a14), new THREE.MeshLambertMaterial({ map: tex }), mat(0x4a2a14), mat(0x4a2a14), mat(0x4a2a14)]);
      b.position.y = 0.0075; g.add(b);
      const pl = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.012, 3), mat(0xd8c8a0));
      pl.position.set(0, 0.022, 0.02); g.add(pl);
      const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.014, 8), mat(0x222222));
      hole.position.set(0, 0.023, 0.02); g.add(hole);
      C.planchette = [pl, hole];
      break;
    }
    case 'musicbox': {
      box(0.18, 0.1, 0.13, 0x6a3a1e, 0, 0.05, 0, g);
      box(0.17, 0.005, 0.12, 0xb0302a, 0, 0.1, 0, g);
      const lid = new THREE.Group(); lid.position.set(0, 0.1, -0.065); g.add(lid);
      box(0.18, 0.015, 0.13, 0x7a4424, 0, 0.007, 0.065, lid);
      lid.rotation.x = -1.2;
      const dancer = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.06, 5), mat(0xe8d8e8));
      dancer.position.set(0, 0.13, 0.01); g.add(dancer);
      box(0.01, 0.01, 0.05, 0xc8b060, 0.1, 0.05, 0, g);
      C.dancer = dancer;
      break;
    }
    case 'cards': {
      const tex = canvasTex(64, 96, (x) => {
        x.fillStyle = '#3a1450'; x.fillRect(0, 0, 64, 96);
        x.strokeStyle = '#d8b450'; x.lineWidth = 3; x.strokeRect(4, 4, 56, 88);
        x.fillStyle = '#d8b450'; x.beginPath(); x.arc(32, 48, 12, 0, 7); x.fill();
        x.fillStyle = '#3a1450'; x.beginPath(); x.arc(36, 46, 10, 0, 7); x.fill();
      });
      const deck = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.025, 0.105),
        [mat(0xe8e0d0), mat(0xe8e0d0), new THREE.MeshLambertMaterial({ map: tex }), mat(0xe8e0d0), mat(0xe8e0d0), mat(0xe8e0d0)]);
      deck.position.y = 0.0125; g.add(deck);
      C.deck = deck; C.cardsLeft = 10;
      const loose = deck.clone(); loose.scale.y = 0.08; loose.position.set(0.09, 0.002, 0.02); loose.rotation.y = 0.5; g.add(loose);
      break;
    }
    case 'mirror': {
      const frame = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.015, 10), mat(0x8a7040));
      frame.position.y = 0.008; g.add(frame);
      C.glass = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.017, 10), new THREE.MeshBasicMaterial({ color: 0x9aa8b8 }));
      C.glass.position.y = 0.009; g.add(C.glass);
      box(0.03, 0.012, 0.12, 0x8a7040, 0, 0.006, 0.14, g);
      break;
    }
    case 'doll': {
      const cloth = mat(0xa08a6a);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.12, 6), cloth);
      body.rotation.x = Math.PI / 2; body.position.set(0, 0.04, 0); g.add(body);
      const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.045, 0), cloth);
      head.position.set(0, 0.045, -0.095); g.add(head);
      for (const sx of [-1, 1]) {
        const eye = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.004, 0.014), mat(0x111111));
        eye.position.set(sx * 0.016, 0.09, -0.1); g.add(eye);
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.07, 5), cloth);
        arm.rotation.z = Math.PI / 2; arm.position.set(sx * 0.07, 0.03, -0.02); g.add(arm);
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.08, 5), cloth);
        leg.rotation.x = Math.PI / 2; leg.position.set(sx * 0.025, 0.02, 0.09); g.add(leg);
      }
      const mouth = box(0.04, 0.003, 0.004, 0x601010, 0, 0.088, -0.07, g);
      mouth.rotation.x = -0.6;
      C.pins = [];
      for (let i = 0; i < 10; i++) {
        const pin = new THREE.Group();
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.07, 3), mat(0xcccccc));
        shaft.position.y = 0.035; pin.add(shaft);
        const headM = new THREE.Mesh(new THREE.IcosahedronGeometry(0.008, 0), new THREE.MeshBasicMaterial({ color: [0xe03030, 0x3060e0, 0xe0c030, 0x30a040][i % 4] }));
        headM.position.y = 0.07; pin.add(headM);
        pin.position.set(rand(-0.035, 0.035), 0.06, rand(-0.12, 0.06));
        pin.rotation.set(rand(-0.4, 0.4), 0, rand(-0.4, 0.4));
        g.add(pin); C.pins.push(pin);
      }
      C.pinsLeft = 10;
      break;
    }
  }
}

// ---------- подсказка и использование ----------
export function cursedPrompt() {
  const n = CURSED_NAMES[C.type];
  if (C.broken) return n + ' (сломан)';
  switch (C.type) {
    case 'board': return 'Говорящая доска: задать вопрос';
    case 'musicbox': return C.playing ? 'Шкатулка играет…' : 'Завести музыкальную шкатулку';
    case 'cards': return `Вытянуть карту Таро (${C.cardsLeft})`;
    case 'mirror': return C.mirrorOn ? 'Опустить зеркальце' : 'Посмотреть в зеркальце';
    case 'doll': return `Воткнуть иглу в куклу (${C.pinsLeft})`;
  }
  return n;
}
export function mirrorActive() { return !!C.mirrorOn; }

export function useCursed() {
  if (C.broken) { toast('Предмет больше не действует'); return; }
  completeObjective('cursed');
  const gh = G.ghost;
  switch (C.type) {
    case 'board': openBoard(); break;
    case 'musicbox': {
      if (C.playing) return;
      C.playing = true; C.playEnd = G.t + 9;
      sfx.musicBox(C.x, C.z, 9);
      if (gh.distTo(C.x, C.z) < 10 && !gh.hunting) setTimeout(() => { if (!gh.hunting) gh.startEvent('walk', 8); }, 2500);
      break;
    }
    case 'cards': drawCard(); break;
    case 'mirror':
      C.mirrorOn = !C.mirrorOn;
      document.body.classList.toggle('mirroring', C.mirrorOn);
      sfx.whoosh();
      break;
    case 'doll': {
      C.pinsLeft--;
      const pin = C.pins[C.pinsLeft];
      pin.position.y = 0.035;
      sfx.needle(C.x, C.z);
      if (Math.random() < 0.1 || C.pinsLeft === 0) {
        G.sanity = Math.max(0, G.sanity - 10);
        toast('Игла вошла прямо в сердце куклы…', 3);
        curse();
      } else {
        G.sanity = Math.max(0, G.sanity - 5);
        gh.interact(); gh.provoke();
      }
      break;
    }
  }
}

function curse() {
  C.broken = true;
  C.mirrorOn = false;
  document.body.classList.remove('mirroring');
  sfx.curse();
  G.ghost.startHunt(true);
}

// ---------- говорящая доска ----------
const QUESTIONS = [
  { q: 'Где ты?', cost: 25, a: (g) => ROOMS[g.home].name.toUpperCase() },
  { q: 'Сколько тебе лет?', cost: 5, a: (g) => String(g.age) },
  { q: 'Как тебя зовут?', cost: 5, a: (g) => g.fullName.split(' ')[0].toUpperCase() },
  { q: 'Ты здесь?', cost: 5, a: () => 'ДА' },
  { q: 'Покажись!', cost: 20, a: (g) => { setTimeout(() => g.startEvent('stand', 4), 1200); return 'СМОТРИ'; } },
  { q: 'Прощай', cost: 0, a: () => 'ПРОЩАЙ', bye: true },
];
function openBoard() {
  G.uiOpen = 'cursed';
  $('cursedUI').classList.remove('hidden');
  $('cursedTitle').textContent = 'Говорящая доска';
  $('cursedText').textContent = 'Каждый вопрос отнимает рассудок. Не забудьте попрощаться.';
  const list = $('cursedBtns');
  list.innerHTML = '';
  for (const q of QUESTIONS) {
    const b = document.createElement('button');
    b.className = 'btn';
    b.textContent = q.q + (q.cost ? ` (−${q.cost}% рассудка)` : '');
    b.onclick = () => askBoard(q);
    list.appendChild(b);
  }
}
function closeCursedUI() {
  $('cursedUI').classList.add('hidden');
  if (G.uiOpen === 'cursed') G.uiOpen = null;
}
function askBoard(q) {
  if (C.broken || C.busy) return;
  C.busy = true;
  sfx.scrape(C.x, C.z);
  $('cursedText').textContent = '…указатель двигается…';
  C.moveUntil = G.t + 2;
  setTimeout(() => {
    C.busy = false;
    if (G.sanity < q.cost) {
      $('cursedText').textContent = 'Доска треснула!';
      setTimeout(closeCursedUI, 900);
      curse();
      return;
    }
    G.sanity -= q.cost;
    $('cursedText').textContent = '«' + q.a(G.ghost) + '»';
    if (q.bye) { C.broken = true; setTimeout(closeCursedUI, 1400); }
    C.uses++;
  }, 2000);
}

// ---------- карты Таро ----------
const CARDS = [
  { n: 'Шут', w: 20, t: 'Шут лишь смеётся над вами. Ничего не произошло.', f: () => {} },
  { n: 'Колесо фортуны', w: 18, t: '', f: (g, card) => { const up = Math.random() < 0.5; G.sanity = Math.max(0, Math.min(100, G.sanity + (up ? 25 : -25))); card.t = up ? 'Карта горит зелёным: +25% рассудка.' : 'Карта горит красным: −25% рассудка.'; } },
  { n: 'Башня', w: 16, t: 'Призрак приходит в ярость и устраивает погром.', f: (g) => { for (let i = 0; i < 3; i++) setTimeout(() => g.interact(), i * 700); } },
  { n: 'Дьявол', w: 10, t: 'Призрак является перед вами.', f: (g) => g.startEvent('walk', 3) },
  { n: 'Смерть', w: 9, t: 'Призрак начинает проклятую охоту!', f: () => curse() },
  { n: 'Отшельник', w: 10, t: 'Призрак возвращается в свою комнату и затихает на минуту.', f: (g) => { g.path = null; g.smudgeUntil = G.t + 60; const r = ROOMS[g.home].lights[0]; g.x = r[0]; g.z = r[1]; } },
  { n: 'Солнце', w: 5, t: 'Рассудок полностью восстановлен.', f: () => { G.sanity = 100; } },
  { n: 'Луна', w: 5, t: 'Рассудок упал до нуля.', f: () => { G.sanity = 0; } },
  { n: 'Верховная жрица', w: 5, t: '', f: (g, card) => {
    const ks = Object.keys(EVIDENCE).filter(k => !g.def.ev.includes(k) && G.journal.evidence[k] !== 2);
    if (!ks.length) { card.t = 'Жрице нечего вам открыть.'; return; }
    const k = pick(ks); G.journal.evidence[k] = 2;
    card.t = `Жрица вычеркнула из журнала улику: «${EVIDENCE[k].name}».`;
  } },
  { n: 'Повешенный', w: 2, t: 'Вы чувствуете, как петля затягивается…', f: (g) => setTimeout(() => g.kill(), 1200) },
];
function drawCard() {
  if (C.cardsLeft <= 0) return;
  C.cardsLeft--;
  let r = Math.random() * CARDS.reduce((a, c) => a + c.w, 0), card = CARDS[0];
  for (const c of CARDS) { r -= c.w; if (r <= 0) { card = c; break; } }
  const shown = { ...card };
  sfx.cardFlip();
  card.f(G.ghost, shown);
  const el = $('tarotCard');
  el.querySelector('b').textContent = shown.n.toUpperCase();
  el.querySelector('p').textContent = shown.t;
  el.classList.remove('hidden');
  clearTimeout(C.cardTimer);
  C.cardTimer = setTimeout(() => el.classList.add('hidden'), 3500);
  C.deck.scale.y = Math.max(0.1, C.cardsLeft / 10);
  C.deck.position.y = 0.0125 * C.deck.scale.y;
  if (C.cardsLeft <= 0) { C.broken = true; C.deck.visible = false; }
}

// ---------- обновление ----------
export function updateCursed(dt) {
  if (!C.type) return;
  const p = G.player;
  if (C.type === 'board' && C.planchette && G.t < (C.moveUntil || 0)) {
    const a = G.t * 5;
    for (const m of C.planchette) m.position.set(Math.sin(a) * 0.12, m.position.y, Math.cos(a * 1.3) * 0.08);
  }
  if (C.type === 'musicbox' && C.playing) {
    C.dancer.rotation.y += dt * 4;
    if (Math.hypot(p.x - C.x, p.z - C.z) < 5) G.sanity = Math.max(0, G.sanity - dt * 2);
    if (G.t > C.playEnd) {
      C.playing = false;
      const gh = G.ghost;
      if (gh.distTo(p.x, p.z) < 3 || gh.distTo(C.x, C.z) < 2.5) curse();
      else { C.broken = true; toast('Мелодия стихла. Шкатулка сломалась.'); }
    }
  }
  if (C.type === 'mirror' && C.mirrorOn) {
    // зеркальце показывает комнату призрака
    if (Math.hypot(p.x - C.x, p.z - C.z) > 2.2) { C.mirrorOn = false; document.body.classList.remove('mirroring'); return; }
    G.sanity = Math.max(0, G.sanity - dt * 7.5);
    const L = ROOMS[G.ghost.home].lights[0];
    mirrorCam.position.set(L[0], 2.3, L[1]);
    mirrorCam.rotation.set(-0.9, G.t * 0.4, 0, 'YXZ');
    C.glass.material.color.setHex(Math.random() < 0.9 ? 0x9aa8b8 : 0x506070);
    if (G.sanity <= 0) {
      C.glass.material.color.setHex(0x222222);
      toast('Зеркальце треснуло!', 3);
      curse();
    }
  }
}

export function viewCamera(aspect) {
  if (C.mirrorOn && mirrorCam) {
    if (mirrorCam.aspect !== aspect) { mirrorCam.aspect = aspect; mirrorCam.updateProjectionMatrix(); }
    return mirrorCam;
  }
  return null;
}

let uiInited = false;
function initUI() {
  if (uiInited) return;
  uiInited = true;
  $('cursedClose').addEventListener('click', closeCursedUI);
}

export function cursedInfo() { return C; }
