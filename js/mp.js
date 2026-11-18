// Игра вдвоём: лобби, синхронизация мира, аватар напарника.
// Хост полностью симулирует мир (призрак, двери, свет, предметы, улики) и 20 раз в секунду
// рассылает снимок. Напарник двигается у себя без задержки, мир рисует по снимкам с
// интерполяцией (на ~120 мс в прошлом — так движение плавное даже при неровной сети),
// а свои действия отправляет хосту запросами. Мир и призрак строятся из общего зерна.
import * as THREE from 'three';
import { G, toast, isHost, isClient, netSend, completeObjective, adjSanity, setSanity, clamp } from './state.js';
import * as W from './world.js';
import * as I from './items.js';
import * as CU from './cursed.js';
import * as AP from './appliances.js';
import * as UI from './ui.js';
import { sfx, playRelayed, initAudio } from './audio.js';
import { RoomLink, PeerLink, MqttLink, getRoom, loadPeerJs, peerAvailable } from './net.js';

const $ = (id) => document.getElementById(id);
const INTERP = 120;              // задержка интерполяции, мс
let ctx = null, link = null, room = null, transport = null;
let partnerNick = '', myNick = 'Игрок', listTimer = 0;
let avatar = null;
const rbuf = [];                 // буфер состояний напарника для интерполяции
let tBase = 0, tRecv = 0;        // синхронизация игрового времени у клиента
let sendT = 0, slowT = 0;

function loadNick() { try { return localStorage.getItem('phathma.nick') || ''; } catch (_) { return ''; } }
function saveNick(n) { try { localStorage.setItem('phathma.nick', n); } catch (_) { /* */ } }
const now = () => performance.now();
const fin = (v) => Number.isFinite(v);

// ================= ЛОББИ =================
export function init(c) {
  ctx = c;
  $('btnMp').addEventListener('click', openLobby);
  try { const m = localStorage.getItem('phathma.mpmode'); if (m) $('mpMode').value = m; } catch (_) { /* */ }
  $('mpMode').addEventListener('change', () => { try { localStorage.setItem('phathma.mpmode', $('mpMode').value); } catch (_) { /* */ } if (!G.running && transport === 'net') openLobby(); });
  $('mpBack').addEventListener('click', closeLobby);
  $('mpCreate').addEventListener('click', () => { initAudio(); ctx.goFullscreen(); createGame(); });
  $('mpJoin').addEventListener('click', () => { initAudio(); ctx.goFullscreen(); joinGame($('mpCode').value.trim()); });
  $('mpGo').addEventListener('click', hostStart);
  $('mpNick').value = loadNick();
  // фон: если хост свернул вкладку, мир всё равно идёт (браузер будит таймер ~раз в секунду)
  let lastHidden = 0;
  setInterval(() => {
    if (!document.hidden || !G.mp || !G.running || !isHost()) { lastHidden = now(); return; }
    const el = Math.min(2, (now() - lastHidden) / 1000); lastHidden = now();
    for (let t = 0; t < el; t += 0.05) ctx.stepGame(0.05);
  }, 250);
}

function setStatus(t) { $('mpStatus').textContent = t; }
function showStep(n) { $('mpStep1').classList.toggle('hidden', n !== 1); $('mpStep2').classList.toggle('hidden', n !== 2); }

async function openLobby() {
  UI.hide('menu'); UI.show('mpScreen'); G.uiOpen = 'mpScreen';
  showStep(1);
  $('mpVia').textContent = 'Проверяем, как можно подключиться…';
  $('mpCreate').disabled = true; $('mpJoin').disabled = true;
  if (!transport) {
    room = await getRoom();
    if (room) transport = 'room';
    else if (window.claude) transport = 'noroom';   // claude.ai без доступа к общему каналу
    else transport = 'net';   // HTML-файл / обычный сайт: сервер (MQTT) или P2P на выбор
  }
  if (transport === 'net') {
    $('mpModeRow').classList.remove('hidden');
    const mode = $('mpMode').value;
    $('mpVia').textContent = mode === 'p2p'
      ? 'Напрямую между устройствами (WebRTC). Быстрее, но у некоторых мобильных операторов не соединяется.'
      : 'Через бесплатные серверы связи (сразу три, для надёжности). Работает в любой сети с интернетом.';
    $('mpCreate').disabled = false; $('mpJoin').disabled = false;
    return;
  }
  if (transport === 'room') $('mpVia').textContent = 'Связь через claude.ai. Напарнику нужен доступ к этой странице (кнопка «Поделиться»).';
  else if (transport === 'p2p') $('mpVia').textContent = 'Прямое соединение через интернет (бесплатный сервер PeerJS). Оба игрока должны быть онлайн.';
  else if (transport === 'noroom') { $('mpVia').textContent = 'Здесь нет доступа к общему каналу. Войдите в claude.ai как участник страницы или играйте вдвоём через HTML-файл игры.'; return; }
  else { $('mpVia').textContent = 'Не удалось загрузить сетевой модуль. Проверьте интернет.'; return; }
  $('mpCreate').disabled = false; $('mpJoin').disabled = false;
  if (transport === 'room') {
    // список открытых игр в этой комнате
    if (!link) link = new RoomLink(room);
    clearInterval(listTimer);
    listTimer = setInterval(renderGames, 1000);
    renderGames();
  }
}
function closeLobby() {
  clearInterval(listTimer);
  if (link && !G.running) { link.close(); link = null; G.mp = null; }
  UI.hide('mpScreen'); UI.show('menu'); G.uiOpen = null;
}
function renderGames() {
  const box = $('mpGames');
  const games = link && link.listGames ? link.listGames() : [];
  box.innerHTML = games.length ? '<p class="hint">Открытые игры:</p>' : '';
  for (const g of games) {
    const b = document.createElement('button');
    b.className = 'btn';
    b.textContent = `Войти к «${g.nick}» · код ${g.code}`;
    b.onclick = () => { initAudio(); ctx.goFullscreen(); joinGame(g.code); };
    box.appendChild(b);
  }
}
function nickInput() {
  myNick = ($('mpNick').value || '').trim().slice(0, 14) || 'Игрок';
  saveNick(myNick);
  return myNick;
}
async function ensureMode() {
  if (transport !== 'net' || $('mpMode').value !== 'p2p') return true;
  if (await loadPeerJs()) return true;
  toast('Не удалось загрузить модуль P2P — выберите «Через сервер»', 4);
  return false;
}
// понятное описание ошибки сети
function errText(e) {
  const t = (e && (e.type || e.message)) || String(e);
  const map = {
    'server-error': 'сервер знакомства P2P не отвечает',
    'network': 'нет связи с сервером знакомства P2P',
    'unavailable-id': 'такой код уже занят — создайте игру ещё раз',
    'peer-unavailable': 'игра с этим кодом не найдена',
    'browser-incompatible': 'этот браузер не поддерживает P2P',
    'socket-error': 'обрыв связи с сервером',
  };
  return map[t] || t;
}
function newLink() {
  if (link) { link.close(); link = null; }
  link = transport === 'room' ? new RoomLink(room) : $('mpMode').value === 'p2p' ? new PeerLink() : new MqttLink();
  link.on({ onPartner, onMsg, onState, onLeave, onBack, onError: (e) => setStatus('Ошибка сети: ' + errText(e) + (link && link.kind === 'p2p' ? '. Попробуйте способ «Через сервер».' : '')) });
}

async function createGame() {
  nickInput();
  if (!(await ensureMode())) return;
  const code = String(Math.floor(transport === 'room' ? 1000 + Math.random() * 9000 : 100000 + Math.random() * 900000));
  newLink();
  G.mp = { role: 'host', send: (t, d) => link.send([t, d]) };
  showStep(2);
  $('mpShowCode').textContent = code;
  $('mpGo').classList.add('hidden');
  setStatus('Создаём игру…');
  try { await link.host(code, myNick); }
  catch (e) { setStatus('Не удалось создать игру: ' + errText(e) + (link.kind === 'p2p' ? '. Попробуйте способ «Через сервер».' : '. Попробуйте ещё раз.')); return; }
  setStatus('Ждём напарника… Скажите ему код игры.');
}

async function joinGame(code) {
  if (!/^\d{4,6}$/.test(code)) { toast('Введите код из 4–6 цифр'); return; }
  nickInput();
  if (!(await ensureMode())) return;
  newLink();
  G.mp = { role: 'client', send: (t, d) => link.send([t, d]) };
  showStep(2);
  $('mpShowCode').textContent = code;
  $('mpGo').classList.add('hidden');
  setStatus('Подключаемся…');
  try { await link.join(code, myNick); }
  catch (e) { setStatus('Не удалось подключиться: ' + errText(e) + (link.kind === 'p2p' ? '. Попробуйте способ «Через сервер» (оба игрока).' : '')); G.mp = null; return; }
  setStatus('Ищем игру с этим кодом…');
  setTimeout(() => { if (!partnerNick && G.mp && !G.running) setStatus('Игра не найдена. Проверьте код и что у обоих выбран один способ связи. Хост должен держать экран лобби открытым.'); }, 15000);
}

function onPartner(nick) {
  partnerNick = nick;
  if (G.running) { onBack(); toast(`${nick} снова на связи`); return; }
  if (isHost()) {
    setStatus(`${nick} подключился! Сложность — как выбрана в главном меню.`);
    $('mpGo').classList.remove('hidden');
  } else {
    link.send(['hello', { n: myNick }]);
    setStatus(`Подключено к «${nick}». Ждём, когда хост начнёт…`);
  }
}

function hostStart() {
  if (!partnerNick) return;
  const seed = (Math.random() * 2 ** 31) | 0;
  link.send(['init', { seed, diff: G.diffKey, n: myNick }]);
  if (link.setOpen) link.setOpen(false);
  clearInterval(listTimer);
  ctx.startGame({ seed, diffKey: G.diffKey, role: 'host' });
}

function onLeave() {
  if (!G.running) {
    partnerNick = '';
    setStatus(isHost() ? 'Напарник отключился. Ждём нового…' : 'Хост отключился.');
    $('mpGo').classList.add('hidden');
    return;
  }
  // связь пропала: ждём до 60 с, вдруг вернётся (сворачивали приложение, плохая сеть)
  if (lostTimer) return;
  if (G.remote) G.remote.ok = false;
  if (avatar) avatar.group.visible = false;
  toast(isHost() ? 'Связь с напарником прервалась — ждём переподключения…' : 'Связь с хостом прервалась — ждём переподключения…', 6);
  lostTimer = setTimeout(() => {
    lostTimer = 0;
    if (!G.running) return;
    if (isHost()) toast('Напарник так и не вернулся. Можно продолжать одному.', 5);
    else ctx.endGame('Связь с хостом потеряна — игра прервана.');
  }, 60000);
}
let lostTimer = 0;
function onBack() {
  if (!lostTimer) return;
  clearTimeout(lostTimer); lostTimer = 0;
  toast('Связь восстановлена', 3);
}

// ================= ИГРА =================
export function onGameStart(role) {
  clearInterval(listTimer);
  G.mp.role = role;
  G.mp.partnerNick = partnerNick;
  G.onJournal = () => netSend('jr', { ev: G.journal.evidence, g: G.journal.guess });
  buildAvatar();
  $('mpInfo').classList.remove('hidden');
  if (isClient()) G.itemsById.clear();
}
export function partnerAlive() { return !!(G.remote && G.remote.ok && !G.remote.dead); }
export function requestEnd() {
  if (isClient()) netSend('leave', {});
  else { netSend('end', { r: 'leave' }); ctx.endGame(''); }
}
// оба погибли
export function allDead() {
  if (isHost()) { netSend('end', { r: 'dead' }); ctx.endGame('Вся команда погибла.'); }
}

// ---------- состояние своего игрока ----------
function myState() {
  const p = G.player, it = I.selected();
  const hid = p.hidden ? W.hideSpots.indexOf(p.hidden) : -1;
  return {
    x: +p.x.toFixed(2), z: +p.z.toFixed(2), yw: +p.yaw.toFixed(2), pt: +p.pitch.toFixed(2),
    fl: p.flashlight ? 1 : 0, h: it ? it.type : '', o: it && it.on ? 1 : 0,
    hid, sh: p.seenHiding ? 1 : 0, run: p.running ? 1 : 0, dead: p.dead ? 1 : 0,
    san: Math.round(G.sanity), inH: p.inHouse ? 1 : 0, rm: p.room, el: I.heldElectronicOn() ? 1 : 0,
    cl: G.inv.some(i => i && i.type === 'candle' && i.data.lit) ? 1 : 0,
    ps: G.photos.reduce((a, ph) => a + ph.stars, 0), n: myNick,
  };
}

// ---------- снимок мира (хост) ----------
function worldState() {
  const gh = G.ghost;
  const st = {
    t: +G.t.toFixed(2), g: gh.netState(), d: W.doorsState(), fd: W.frontDoor.locked ? 1 : 0,
    L: W.lightsBits(), pw: G.power ? 1 : 0, ap: AP.appliancesBits(),
    pp: W.propsState(),
    em: G.emfSources.slice(-8).map(e => [+e.x.toFixed(1), +e.z.toFixed(1), e.level, +(e.until - G.t).toFixed(1)]),
    se: G.soundEvents.filter(e => G.t - e.t < 1.5).slice(-6).map(e => [+e.x.toFixed(1), +e.z.toFixed(1), +e.vol.toFixed(2), +(G.t - e.t).toFixed(2)]),
  };
  slowT -= 0.05;
  if (slowT <= 0) {
    // редко меняющееся — раз в секунду
    slowT = 1;
    st.tp = W.HOUSE_ROOMS.map(r => +(G.temps[r] ?? 15).toFixed(1));
    st.ac = G.activity.slice(-36);
  }
  return st;
}

// ---------- приём состояния напарника ----------
function onState(s) {
  if (!s || typeof s !== 'object') return;
  const me = s.me;
  if (me && fin(me.x) && fin(me.z)) {
    if (!G.remote) G.remote = {};
    const r = G.remote;
    Object.assign(r, {
      ok: true, x: me.x, z: me.z, yaw: me.yw || 0, pitch: me.pt || 0, fl: !!me.fl, h: typeof me.h === 'string' ? me.h : '',
      on: !!me.o, hid: me.hid | 0, sh: !!me.sh, run: !!me.run, dead: !!me.dead, san: clamp(me.san ?? 100, 0, 100),
      inHouse: !!me.inH, room: typeof me.rm === 'string' ? me.rm : '.', el: !!me.el, cl: !!me.cl, ps: me.ps | 0, n: String(me.n || partnerNick).slice(0, 16),
    });
    rbuf.push({ at: now(), x: me.x, z: me.z, yaw: r.yaw, pitch: r.pitch });
    if (rbuf.length > 40) rbuf.shift();
  }
  if (isClient() && s.w && G.running && G.ghost) applyWorld(s.w);
}

function applyWorld(w) {
  const at = now();
  if (fin(w.t)) { tBase = w.t; tRecv = at; }
  G.ghost.netApply(w.g, at);
  W.applyDoorsState(w.d, w.fd);
  if (fin(w.L)) W.applyLightsBits(w.L);
  if (!(G.predPower > performance.now())) G.power = !!w.pw;
  if (fin(w.ap)) AP.applyAppliancesBits(w.ap);
  W.applyPropsState(w.pp);
  if (Array.isArray(w.em)) G.emfSources = w.em.filter(e => Array.isArray(e) && e.every(fin)).map(e => ({ x: e[0], z: e[1], level: e[2], until: G.t + e[3] }));
  if (Array.isArray(w.se)) G.soundEvents = w.se.filter(e => Array.isArray(e) && e.every(fin)).map(e => ({ x: e[0], z: e[1], vol: e[2], t: G.t - e[3] }));
  if (Array.isArray(w.tp)) W.HOUSE_ROOMS.forEach((r, i) => { if (fin(w.tp[i])) G.temps[r] = w.tp[i]; });
  if (Array.isArray(w.ac)) G.activity = w.ac.filter(fin);
}

// клиент: игровое время = время хоста (для отпечатков, часов, огоньков)
export function syncTime() {
  if (!tRecv) return;
  G.t = tBase + (now() - tRecv) / 1000;
}
export function renderAt() { return now() - interp(); }
// через серверы снимки приходят 10 раз в секунду — смотрим чуть дальше в прошлое
function interp() { return link && link.kind === 'mqtt' ? 220 : INTERP; }

// ---------- сообщения ----------
function onMsg(m) {
  if (!Array.isArray(m) || typeof m[0] !== 'string') return;
  const [type, d0] = m;
  const d = d0 && typeof d0 === 'object' ? d0 : {};
  // общие
  switch (type) {
    case 'hello': if (typeof d.n === 'string') partnerNick = d.n.slice(0, 16); return;
    case 'sx': playRelayed(d0); return;
    case 'obj': if (typeof d.id === 'string') completeObjective(d.id); return;
    case 'jr':
      if (d.ev && typeof d.ev === 'object') {
        const ev = {};
        for (const k in d.ev) if (fin(d.ev[k])) ev[k] = d.ev[k] | 0;
        G.journal.evidence = ev;
        G.journal.guess = typeof d.g === 'string' ? d.g : null;
        if (G.uiOpen === 'journal') UI.renderJournal();
      }
      return;
    case 'toss': I.remoteToss(d.s, d.f); return;
    case 'toast': if (typeof d.t === 'string') toast(d.t.slice(0, 200), fin(d.d) ? d.d : 3); return;
  }
  if (isHost()) hostMsg(type, d); else clientMsg(type, d);
}

function hostMsg(type, d) {
  const gh = G.ghost;
  if (!G.running && type !== 'hello') return;
  switch (type) {
    // клиент уже показал результат у себя — звук не пересылаем обратно
    case 'door': G.noRelay++; ctx.toggleDoor(W.doors[d.i]); G.noRelay--; break;
    case 'sw': G.noRelay++; ctx.toggleSwitch(d.r, true); G.noRelay--; break;
    case 'fuse': ctx.toggleFuse(); break;
    case 'app': { const a = AP.appliances[d.i]; if (a) { G.noRelay++; AP.toggleAppliance(a, 'remote'); G.noRelay--; } break; }
    case 'take': {
      const t = d.t;
      if (!I.ITEM_DEFS[t]) break;
      if (!G.stock[t]) { netSend('toast', { t: 'Этого предмета больше нет' }); netSend('stock', G.stock); break; }
      G.stock[t]--;
      const it = I.createItem(t);
      netSend('give', { s: I.serItem(it) });
      netSend('stock', G.stock);
      I.refreshRack();
      break;
    }
    case 'ret': if (I.ITEM_DEFS[d.t]) { if (!d.u) G.stock[d.t]++; I.refreshRack(); netSend('stock', G.stock); } break;
    case 'pick': {
      const it = G.itemsById.get(d.i);
      if (it && it.placed) { I.removeFromWorld(it); netSend('pr', { i: it.id }); netSend('give', { s: I.serItem(it) }); }
      else netSend('toast', { t: 'Предмет уже кто-то взял' });
      break;
    }
    case 'place': {
      const it = I.itemFromNet(d.s);
      if (it && [d.x, d.z, d.y, d.yaw].every(fin)) I.placeItem(it, d.x, d.z, d.yaw, false, d.y);
      break;
    }
    case 'salt': if (fin(d.x) && fin(d.z)) I.makeSaltPile(d.x, d.z); break;
    case 'smudge': if (fin(d.x) && fin(d.z)) gh.onSmudge(d.x, d.z); break;
    case 'ask': if (fin(d.x) && fin(d.z)) { netSend('boxr', { a: gh.spiritBoxAnswer(d.x, d.z) ? 1 : 0 }); gh.provoke(); } break;
    case 'cur':
      if (d.a === 'use') CU.hostUse('R');
      else if (d.a === 'ask' && fin(d.q)) CU.hostAsk('R', d.q | 0);
      else if (d.a === 'curse') CU.hostCurse();
      break;
    case 'leave': netSend('end', { r: 'leave' }); ctx.endGame(`${partnerNick || 'Напарник'} завершил расследование.`); break;
  }
}

function clientMsg(type, d) {
  switch (type) {
    case 'init':
      if (!G.running && fin(d.seed)) ctx.startGame({ seed: d.seed | 0, diffKey: d.diff, role: 'client' });
      break;
    case 'stock': if (d && typeof d === 'object') { for (const k in I.ITEM_DEFS) if (fin(d[k])) G.stock[k] = d[k]; I.refreshRack(); } break;
    case 'give': I.giveItem(d.s); break;
    case 'pl': {
      const it = I.itemFromNet(d.s);
      if (it && [d.x, d.z, d.y, d.yaw].every(fin)) {
        // предмет в своих руках не трогаем (например, отправленный запрос устарел)
        if (G.inv.includes(it)) break;
        I.placeItem(it, d.x, d.z, d.yaw, !!d.ly, d.y);
      }
      break;
    }
    case 'pr': { const it = G.itemsById.get(d.i); if (it && it.placed) I.removeFromWorld(it); break; }
    case 'print': I.printFromNet(d.r, d.a, d.f); break;
    case 'salt': if (fin(d.x) && fin(d.z)) I.makeSaltPile(d.x, d.z); break;
    case 'saltStep': { const p = I.saltPiles[d.i]; if (p) I.stepSalt(p); break; }
    case 'boxr': I.boxAnswer(!!d.a); break;
    case 'san': if (fin(d.d)) adjSanity('L', d.d); else if (fin(d.v)) setSanity('L', d.v); break;
    case 'kill':
      if (!G.player.dead) {
        G.player.dead = true;
        sfx.scream();
        try { navigator.vibrate && navigator.vibrate(700); } catch (_) { /* */ }
        if (G.onDeath) G.onDeath();
      }
      break;
    case 'scare': sfx.scream(); break;
    case 'candleOut': for (const it of G.inv) if (it && it.type === 'candle' && it.data.lit) it.data.lit = false; break;
    case 'card': CU.showCard(String(d.n || ''), String(d.t || '')); break;
    case 'board': CU.boardReply(String(d.t || ''), fin(d.c) ? d.c : 0); break;
    case 'cs': CU.applyCursedState(d); break;
    case 'end': ctx.endGame(d.r === 'dead' ? 'Вся команда погибла.' : d.r === 'leave' ? `${partnerNick || 'Хост'} завершил расследование.` : ''); break;
  }
}

// ================= АВАТАР НАПАРНИКА =================
function nameTag(text) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  x.font = 'bold 30px sans-serif'; x.textAlign = 'center';
  x.fillStyle = 'rgba(0,0,0,0.55)'; x.fillRect(20, 10, 216, 44);
  x.fillStyle = '#e9dfc6'; x.fillText(text, 128, 43);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false }));
  sp.scale.set(0.8, 0.2, 1);
  return sp;
}
function buildAvatar() {
  const scene = ctx.scene;
  const g = new THREE.Group();
  const coat = new THREE.MeshLambertMaterial({ color: isHost() ? 0x2f6a8a : 0x8a5a2a, flatShading: true });
  const dark = new THREE.MeshLambertMaterial({ color: 0x1e2226, flatShading: true });
  const skin = new THREE.MeshLambertMaterial({ color: 0xc8a080, flatShading: true });
  const add = (geo, m, x, y, z, parent = g) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); parent.add(o); return o; };
  add(new THREE.CylinderGeometry(0.09, 0.1, 0.8, 6), dark, -0.1, 0.4, 0);
  add(new THREE.CylinderGeometry(0.09, 0.1, 0.8, 6), dark, 0.1, 0.4, 0);
  const torso = add(new THREE.CylinderGeometry(0.2, 0.24, 0.62, 7), coat, 0, 1.12, 0); torso.scale.z = 0.7;
  const head = new THREE.Group(); head.position.set(0, 1.55, 0); g.add(head);
  add(new THREE.IcosahedronGeometry(0.13, 0), skin, 0, 0, 0, head);
  add(new THREE.BoxGeometry(0.2, 0.06, 0.2), dark, 0, 0.1, 0, head);        // шапка
  add(new THREE.BoxGeometry(0.16, 0.04, 0.03), dark, 0, 0.01, -0.12, head); // повязка фонаря
  const arm = new THREE.Group(); arm.position.set(0.24, 1.38, 0); g.add(arm);
  add(new THREE.BoxGeometry(0.08, 0.5, 0.08), coat, 0, -0.22, -0.08, arm).rotation.x = 0.6;
  add(new THREE.BoxGeometry(0.08, 0.5, 0.08), coat, -0.48, -0.25, 0);
  const hand = new THREE.Group(); hand.position.set(0, -0.42, -0.3); arm.add(hand);
  // фонарь напарника — постоянный источник (число источников не меняется)
  const spot = new THREE.SpotLight(0xfff2dc, 0, 16, 0.5, 0.5, 1.2);
  spot.position.set(0, 0.02, -0.12); head.add(spot);
  spot.target.position.set(0, -0.3, -4); head.add(spot.target);
  const tag = nameTag(partnerNick || 'Напарник'); tag.position.set(0, 1.95, 0); g.add(tag);
  g.visible = false;
  g.traverse(o => { o.userData.noMerge = true; });
  scene.add(g);
  avatar = { group: g, head, hand, spot, held: null, heldType: '', stepAcc: 0, lx: 0, lz: 0 };
}
const heldCache = new Map();
function heldMesh(type) {
  if (!heldCache.has(type)) heldCache.set(type, I.displayMesh(type));
  return heldCache.get(type);
}

function updateAvatar(dt) {
  if (!avatar) return;
  const r = G.remote;
  const g = avatar.group;
  if (!r || !r.ok || r.dead || r.hid >= 0) { g.visible = false; avatar.spot.intensity = 0; return; }
  // интерполяция между снимками
  const t = now() - interp();
  let a = rbuf[0], c = rbuf[rbuf.length - 1];
  if (!a) return;
  for (let i = 0; i < rbuf.length - 1; i++) if (rbuf[i].at <= t && rbuf[i + 1].at >= t) { a = rbuf[i]; c = rbuf[i + 1]; break; }
  if (t >= c.at) a = c;
  const k = c.at > a.at ? clamp((t - a.at) / (c.at - a.at), 0, 1) : 1;
  const x = a.x + (c.x - a.x) * k, z = a.z + (c.z - a.z) * k;
  let dy = c.yaw - a.yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
  const yaw = a.yaw + dy * k, pitch = a.pitch + (c.pitch - a.pitch) * k;
  g.visible = true;
  g.position.set(x, 0, z);
  g.rotation.y = yaw;
  avatar.head.rotation.x = pitch;
  avatar.spot.intensity = r.fl ? 22 : 0;
  // предмет в руке
  if (r.h !== avatar.heldType) {
    if (avatar.held) avatar.hand.remove(avatar.held);
    avatar.held = r.h && I.ITEM_DEFS[r.h] ? heldMesh(r.h) : null;
    if (avatar.held) { avatar.held.scale.setScalar(1.3); avatar.hand.add(avatar.held); }
    avatar.heldType = r.h;
  }
  // шаги
  const moved = Math.hypot(x - avatar.lx, z - avatar.lz);
  avatar.lx = x; avatar.lz = z;
  if (moved < 1) avatar.stepAcc += moved;
  if (avatar.stepAcc > (r.run ? 0.75 : 0.6)) {
    avatar.stepAcc = 0;
    const rm = W.roomAt(x, z);
    sfx.remoteStep(x, z, W.inVanArea(x, z) ? 'metal' : rm === '.' ? 'grass' : (rm === 'K' || rm === 'W') ? 'tile' : 'wood', r.run);
  }
}

function updateInfo() {
  const r = G.remote;
  const el = $('mpInfo');
  if (!r || !r.ok) { el.textContent = '👤 нет связи'; return; }
  const where = r.dead ? '☠ погиб' : r.hid >= 0 ? 'прячется' : r.inHouse ? 'в доме' : W.inVanArea(r.x, r.z) ? 'в фургоне' : 'на улице';
  el.textContent = `👤 ${r.n || partnerNick} · ${where}`;
}

// каждый шаг игры
let infoT = 0, deadSince = 0;
export function update(dt) {
  if (!link || !G.mp) return;
  // хост: погибли оба — конец
  if (isHost() && G.running && G.player.dead && G.remote && G.remote.dead) {
    if (!deadSince) deadSince = now();
    else if (now() - deadSince > 3500) allDead();
  }
  updateAvatar(dt);
  infoT -= dt;
  if (infoT <= 0) { infoT = 0.5; updateInfo(); }
  sendT -= dt;
  if (sendT <= 0) {
    sendT = 0.05;
    const st = { me: myState() };
    if (isHost()) st.w = worldState();
    link.setState(st);
  }
}
