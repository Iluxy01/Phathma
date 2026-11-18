// Сеть на двоих. Два транспорта с одинаковым интерфейсом:
//  • RoomLink — канал claude.ai (room). Всё идёт через presence: его может отправлять любой
//    зритель, а события (emit) по умолчанию доступны только редакторам. Поверх presence
//    сделана надёжная доставка: у каждого сообщения номер, напарник подтверждает приём (ack),
//    неподтверждённые сообщения повторяются в каждом обновлении presence.
//  • PeerLink — прямое WebRTC-соединение через бесплатный сервер PeerJS (для HTML-файла
//    и обычного хостинга). Сигнальный сервер нужен только для знакомства.
// Интерфейс: host(code) / join(code) / send(msg) / setState(obj) / close();
// обратные вызовы: onPartner(nick), onMsg(msg), onState(obj), onLeave(reason).

const PROTO = 2;
const PEER_PREFIX = 'phathma-v2-';
const enc = new TextEncoder();
const bytes = (o) => enc.encode(JSON.stringify(o)).length;

// ---------- claude.ai room ----------
export class RoomLink {
  constructor(room) {
    this.room = room;
    this.kind = 'room';
    this.code = null; this.role = null; this.nick = 'Игрок'; this.open = 0;
    this.seq = 0; this.out = []; this.rx = 0; this.partner = null;
    this.state = null; this.lastStateRef = null;
    this.dirty = true; this.cb = {};
    this.sid = Math.random().toString(36).slice(2, 8);
    this.unsub = room.onPeers((ch) => this.onPeers(ch), () => { this.cb.onLeave && this.cb.onLeave('error'); });
    this.timer = setInterval(() => this.flush(), 50);
  }
  on(cb) { Object.assign(this.cb, cb); }
  listGames() {
    const out = [];
    for (const p of this.room.peers()) {
      const pr = p.presence || {};
      if (p.sameTab || pr.v !== PROTO || pr.r !== 'host' || !pr.o || typeof pr.c !== 'string') continue;
      out.push({ code: pr.c.slice(0, 8), nick: String(pr.n || 'Игрок').slice(0, 16), guest: p.guest });
    }
    return out;
  }
  host(code, nick) { this.code = code; this.role = 'host'; this.nick = nick; this.open = 1; this.reset(); return Promise.resolve(); }
  join(code, nick) { this.code = code; this.role = 'client'; this.nick = nick; this.open = 0; this.reset(); return Promise.resolve(); }
  setOpen(v) { this.open = v ? 1 : 0; this.dirty = true; }
  reset() { this.seq = 0; this.out = []; this.rx = 0; this.partner = null; this.dirty = true; this.flush(true); }
  send(m) {
    this.out.push([++this.seq, m]); this.dirty = true;
    // не ждём следующего такта: сообщение уходит сразу (не чаще ~30 раз в секунду)
    const dt = performance.now() - (this.lastFlush || 0);
    if (dt > 33) this.flush();
    else if (!this.soon) this.soon = setTimeout(() => { this.soon = 0; this.flush(); }, 34 - dt);
  }
  setState(s) { this.state = s; this.dirty = true; }
  flush(force) {
    if (!this.code) return;
    if (!this.dirty && !force) return;
    // presence ≤ 4 КиБ: состояние + неподтверждённые сообщения по порядку, сколько влезет
    const base = { v: PROTO, c: this.code, r: this.role, n: this.nick, o: this.open, i: this.sid, a: this.rx, s: this.state, q: [] };
    let size = bytes(base);
    for (const e of this.out) {
      const b = bytes(e) + 1;
      if (size + b > 3900) break;
      base.q.push(e); size += b;
    }
    this.dirty = false;
    this.lastFlush = performance.now();
    this.room.presence(base).catch(() => { this.dirty = true; });
  }
  onPeers(ch) {
    if (!this.code) return;
    // напарник ушёл (закрыл вкладку, перезагрузил или сменил код)
    if (this.partner) {
      const cur = ch.peers.find(p => p.peer === this.partner.peer);
      const pr = cur && cur.presence;
      if (!cur || !pr || pr.c !== this.code || pr.v !== PROTO) {
        this.partner = null;
        this.cb.onLeave && this.cb.onLeave('left');
      }
    }
    let partner = null;
    for (const p of ch.peers) {
      if (p.sameTab) continue;
      const pr = p.presence || {};
      if (pr.v !== PROTO || pr.c !== this.code || pr.r === this.role || !pr.r) continue;
      if (this.role === 'client' && pr.r !== 'host') continue;
      // хост держит одного напарника
      if (this.partner && p.peer !== this.partner.peer) continue;
      partner = p; break;
    }
    if (!partner) return;
    const pr = partner.presence;
    if (!this.partner || this.partner.peer !== partner.peer || this.partner.sid !== pr.i) {
      // новый напарник (или он перезагрузил страницу) — начинаем обмен заново
      this.partner = { peer: partner.peer, sid: pr.i };
      this.rx = 0;
      // неотправленное перенумеровываем с 1 — новый напарник ждёт сообщение №1
      this.out = this.out.map((e, i) => [i + 1, e[1]]);
      this.seq = this.out.length;
      this.dirty = true;
      this.cb.onPartner && this.cb.onPartner(String(pr.n || 'Напарник').slice(0, 16));
    }
    // подтверждения: убираем доставленное
    const a = pr.a | 0;
    if (a > 0) { const i = this.out.findIndex(e => e[0] > a); this.out = i < 0 ? [] : this.out.slice(i); }
    // новые сообщения строго по порядку
    if (Array.isArray(pr.q)) {
      for (const e of pr.q) {
        if (!Array.isArray(e) || e[0] !== this.rx + 1) continue;
        this.rx = e[0]; this.dirty = true;
        try { this.cb.onMsg && this.cb.onMsg(e[1]); } catch (err) { console.error(err); }
      }
    }
    if (pr.s && pr.s !== this.lastStateRef) {
      this.lastStateRef = pr.s;
      try { this.cb.onState && this.cb.onState(pr.s); } catch (err) { console.error(err); }
    }
  }
  close() {
    clearInterval(this.timer);
    this.code = null;
    try { this.room.presence({ v: null, c: null, r: null, q: null, s: null, o: null }); } catch (_) { /* */ }
    if (this.unsub) this.unsub();
  }
}

// ---------- PeerJS (WebRTC) ----------
function peerOptions() {
  const q = new URLSearchParams(location.search);
  const o = { debug: 0 };
  if (q.get('peerhost')) { o.host = q.get('peerhost'); o.port = +(q.get('peerport') || 9000); o.path = '/'; o.secure = false; }
  return o;
}
export function peerAvailable() { return !!(window.peerjs && window.peerjs.Peer) || !!window.Peer; }

export class PeerLink {
  constructor() {
    this.kind = 'p2p'; this.cb = {}; this.conn = null; this.peer = null; this.queue = [];
    this.state = null; this.stateDirty = false;
    this.timer = setInterval(() => this.flushState(), 50);
  }
  on(cb) { Object.assign(this.cb, cb); }
  listGames() { return []; }
  setOpen() {}
  _peer(id) {
    const P = (window.peerjs && window.peerjs.Peer) || window.Peer;
    return new Promise((res, rej) => {
      const peer = id ? new P(id, peerOptions()) : new P(peerOptions());
      const to = setTimeout(() => rej(new Error('timeout')), 12000);
      peer.on('open', () => { clearTimeout(to); res(peer); });
      peer.on('error', (e) => { clearTimeout(to); rej(e); this.cb.onError && this.cb.onError(e); });
      this.peer = peer;
    });
  }
  async host(code, nick) {
    this.nick = nick;
    const peer = await this._peer(PEER_PREFIX + code);
    peer.on('connection', (c) => {
      if (this.conn && this.conn.open) { c.on('open', () => c.close()); return; }
      this.attach(c);
    });
    peer.on('disconnected', () => { try { peer.reconnect(); } catch (_) { /* */ } });
  }
  async join(code, nick) {
    this.nick = nick;
    const peer = await this._peer(null);
    const c = peer.connect(PEER_PREFIX + code, { reliable: true, serialization: 'json' });
    this.attach(c);
    await new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error('Игра с таким кодом не найдена')), 12000);
      c.on('open', () => { clearTimeout(to); res(); });
      peer.on('error', (e) => { clearTimeout(to); rej(e); });
    });
  }
  attach(c) {
    this.conn = c;
    c.on('open', () => {
      c.send({ t: 'h', n: this.nick, v: PROTO });
      for (const m of this.queue) c.send({ t: 'm', m });
      this.queue = [];
    });
    c.on('data', (d) => {
      if (!d || typeof d !== 'object') return;
      try {
        if (d.t === 'h') { if (d.v === PROTO) this.cb.onPartner && this.cb.onPartner(String(d.n || 'Напарник').slice(0, 16)); }
        else if (d.t === 'm') this.cb.onMsg && this.cb.onMsg(d.m);
        else if (d.t === 's') this.cb.onState && this.cb.onState(d.s);
      } catch (err) { console.error(err); }
    });
    c.on('close', () => { if (this.conn === c) { this.conn = null; this.cb.onLeave && this.cb.onLeave('left'); } });
    c.on('error', () => {});
  }
  send(m) { if (this.conn && this.conn.open) this.conn.send({ t: 'm', m }); else this.queue.push(m); }
  setState(s) { this.state = s; this.stateDirty = true; }
  flushState() {
    if (!this.stateDirty || !this.conn || !this.conn.open) return;
    this.stateDirty = false;
    this.conn.send({ t: 's', s: this.state });
  }
  close() {
    clearInterval(this.timer);
    try { this.conn && this.conn.close(); } catch (_) { /* */ }
    try { this.peer && this.peer.destroy(); } catch (_) { /* */ }
  }
}

// claude.ai room, если страница открыта на claude.ai (иначе null через ≤10 с)
export async function getRoom() {
  if (!window.claude || typeof window.claude.use !== 'function') return null;
  try { return await window.claude.use('room'); } catch (_) { return null; }
}

// подключить скрипт PeerJS по требованию (в сборке одним файлом он уже встроен)
export function loadPeerJs() {
  if (peerAvailable()) return Promise.resolve(true);
  return new Promise((res) => {
    const s = document.createElement('script');
    s.src = 'lib/peerjs.min.js';
    s.onload = () => res(peerAvailable());
    s.onerror = () => res(false);
    document.head.appendChild(s);
  });
}
