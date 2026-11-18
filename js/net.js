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

// ---------- MQTT через публичные бесплатные серверы (основной способ для HTML-файла) ----------
// Подключаемся сразу к нескольким брокерам и шлём через все: если один недоступен
// или упал — игра продолжается через остальные. Повторы отсекаются по номерам.
const BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://test.mosquitto.org:8081/mqtt',
];
const te = new TextEncoder(), td = new TextDecoder();
function mqStr(s) { const b = te.encode(s); const o = new Uint8Array(2 + b.length); o[0] = b.length >> 8; o[1] = b.length & 255; o.set(b, 2); return o; }
function mqPacket(type, body) {
  const len = []; let x = body.length;
  do { let d = x % 128; x = Math.floor(x / 128); if (x > 0) d |= 128; len.push(d); } while (x > 0);
  const o = new Uint8Array(1 + len.length + body.length);
  o[0] = type; o.set(len, 1); o.set(body, 1 + len.length);
  return o;
}
function cat(...parts) { const n = parts.reduce((a, p) => a + p.length, 0); const o = new Uint8Array(n); let i = 0; for (const p of parts) { o.set(p, i); i += p.length; } return o; }

// один брокер
class MqttConn {
  constructor(url, clientId, onMsg, onState) {
    this.url = url; this.ok = false; this.onMsg = onMsg; this.onState = onState; this.buf = new Uint8Array(0); this.subs = [];
    try { this.ws = new WebSocket(url, ['mqtt']); } catch (_) { onState(this, false); return; }
    this.ws.binaryType = 'arraybuffer';
    this.ws.onopen = () => {
      const vh = cat(mqStr('MQTT'), new Uint8Array([4, 2, 0, 30]));   // MQTT 3.1.1, clean session, keepalive 30 с
      this.ws.send(mqPacket(0x10, cat(vh, mqStr(clientId))));
    };
    this.ws.onmessage = (e) => this.data(new Uint8Array(e.data));
    this.ws.onclose = this.ws.onerror = () => { if (this.dead) return; this.dead = true; this.ok = false; clearInterval(this.ping); onState(this, false); };
  }
  data(chunk) {
    this.buf = cat(this.buf, chunk);
    while (this.buf.length >= 2) {
      let mul = 1, len = 0, i = 1, b;
      do { if (i >= this.buf.length) return; b = this.buf[i++]; len += (b & 127) * mul; mul *= 128; } while (b & 128);
      if (this.buf.length < i + len) return;
      const type = this.buf[0] >> 4, body = this.buf.subarray(i, i + len);
      this.buf = this.buf.slice(i + len);
      if (type === 2) {                    // CONNACK
        if (body[1] !== 0) { this.ws.close(); return; }
        this.ok = true;
        for (const t of this.subs) this.sendSub(t);
        this.ping = setInterval(() => { try { this.ws.send(new Uint8Array([0xC0, 0])); } catch (_) { /* */ } }, 20000);
        this.onState(this, true);
      } else if (type === 3) {             // PUBLISH (QoS 0)
        const tl = (body[0] << 8) | body[1];
        const topic = td.decode(body.subarray(2, 2 + tl));
        try { this.onMsg(topic, JSON.parse(td.decode(body.subarray(2 + tl)))); } catch (_) { /* мусор */ }
      }
    }
  }
  sendSub(topic) { this.ws.send(mqPacket(0x82, cat(new Uint8Array([0, 1]), mqStr(topic), new Uint8Array([0])))); }
  subscribe(topic) { this.subs.push(topic); if (this.ok) this.sendSub(topic); }
  publish(topic, obj) {
    if (!this.ok) return;
    try { this.ws.send(mqPacket(0x30, cat(mqStr(topic), te.encode(JSON.stringify(obj))))); } catch (_) { /* */ }
  }
  close() { this.dead = true; clearInterval(this.ping); try { this.ws.send(new Uint8Array([0xE0, 0])); this.ws.close(); } catch (_) { /* */ } }
}

export class MqttLink {
  constructor() {
    this.kind = 'mqtt'; this.cb = {}; this.conns = [];
    this.sid = Math.random().toString(36).slice(2, 10);
    this.seq = 0; this.out = []; this.rx = 0; this.early = new Map();
    this.stN = 0; this.lastStN = -1; this.state = null; this.stateDirty = false;
    this.partner = null; this.lastHeard = 0; this.ackDirty = false;
    this.timer = setInterval(() => this.tick(), 50);
  }
  on(cb) { Object.assign(this.cb, cb); }
  listGames() { return []; }
  setOpen() {}
  brokers() {
    const q = new URLSearchParams(location.search).get('mqtt');
    return q ? q.split(',') : BROKERS;
  }
  // подключение ко всем брокерам; успех — когда готов хотя бы один
  connect(code) {
    this.base = 'phathma/v2/' + code + '/';
    this.myTopic = this.base + (this.role === 'host' ? 'h' : 'c');
    this.peerTopic = this.base + (this.role === 'host' ? 'c' : 'h');
    return new Promise((res, rej) => {
      let done = false, failed = 0;
      const urls = this.brokers();
      const to = setTimeout(() => { if (!done) { done = true; rej(new Error('нет связи ни с одним сервером. Проверьте интернет')); } }, 10000);
      const open = (url, idx) => {
        const c = new MqttConn(url, 'ph' + this.sid + Math.random().toString(36).slice(2, 6), (t, m) => this.recv(m), (conn, up) => {
          if (up) { this.urlUp = this.urlUp || {}; this.urlUp[idx] = true; this.retry = this.retry || {}; this.retry[idx] = 0; }
          if (up && !done) { done = true; clearTimeout(to); res(); }
          if (!up && !done && ++failed === urls.length) { done = true; clearTimeout(to); rej(new Error('серверы связи недоступны. Проверьте интернет')); }
          // оборвался работавший сервер — переподключаемся
          // (повторяем, пока сервер не вернётся: 2, 4, 6… до 10 с между попытками)
          if (!up && this.urlUp && this.urlUp[idx] && !this.closed) {
            this.retry[idx] = Math.min(5, (this.retry[idx] || 0) + 1);
            setTimeout(() => { if (!this.closed) open(url, idx); }, 2000 * this.retry[idx]);
          }
        });
        c.subscribe(this.myTopic);
        this.conns[idx] = c;
      };
      urls.forEach((u, i) => open(u, i));
    });
  }
  pub(obj) { obj.f = this.sid; for (const c of this.conns) if (c) c.publish(this.peerTopic, obj); }
  async host(code, nick) { this.role = 'host'; this.nick = nick; await this.connect(code); }
  async join(code, nick) { this.role = 'client'; this.nick = nick; await this.connect(code); this.pub({ k: 'h', n: nick, v: PROTO }); this.helloT = performance.now(); }
  recv(m) {
    if (!m || typeof m !== 'object' || m.f === this.sid) return;
    // хост держит одного напарника
    if (this.partner && m.f !== this.partner) { if (m.k === 'h' && this.role === 'host') this.pub({ k: 'full' }); return; }
    if (m.k === 'full') { this.cb.onError && this.cb.onError({ type: 'в этой игре уже двое игроков' }); return; }
    this.lastHeard = performance.now();
    if (this.lost && this.partner === m.f) { this.lost = false; this.cb.onBack && this.cb.onBack(); }
    if (m.k === 'x') {
      if (Number.isFinite(m.a)) this.recv({ k: 'a', a: m.a, f: m.f });
      if (m.q) this.recv({ k: 'm', q: m.q, f: m.f });            // сначала события (например, «старт»)
      if (m.s) this.recv({ k: 's', n: m.n, s: m.s, f: m.f });
      return;
    }
    if (m.k === 'h') {
      if (m.v !== PROTO) return;
      if (!this.partner) {
        this.partner = m.f; this.lastStN = -1;
        // неотправленное — с номера 1
        this.out = this.out.map((e, i) => ({ s: i + 1, m: e.m, t: 0 })); this.seq = this.out.length;
        if (this.role === 'host') this.pub({ k: 'h', n: this.nick, v: PROTO });
        this.cb.onPartner && this.cb.onPartner(String(m.n || 'Напарник').slice(0, 16));
      }
      return;
    }
    if (m.k === 'a') { const a = m.a | 0; this.out = this.out.filter(e => e.s > a); return; }
    if (m.k === 's') {
      if (m.n <= this.lastStN && m.n > this.lastStN - 1000) return;   // повтор с другого брокера
      this.lastStN = m.n;
      try { this.cb.onState && this.cb.onState(m.s); } catch (err) { console.error(err); }
      return;
    }
    if (m.k === 'm' && Array.isArray(m.q)) {
      for (const [s, msg] of m.q) if (s > this.rx && !this.early.has(s)) this.early.set(s, msg);
      // доставляем строго по порядку
      while (this.early.has(this.rx + 1)) {
        const msg = this.early.get(this.rx + 1); this.early.delete(this.rx + 1); this.rx++;
        try { this.cb.onMsg && this.cb.onMsg(msg); } catch (err) { console.error(err); }
      }
      this.ackDirty = true;
    }
  }
  send(m) { this.out.push({ s: ++this.seq, m, t: 0 }); }
  takeMsgs() {
    const t = performance.now();
    // новые и давно не подтверждённые (повтор через 600 мс), до ~8 КБ за пакет
    const q = []; let size = 0;
    for (const e of this.out) {
      if (t - e.t < 600) continue;
      const b = JSON.stringify(e.m).length;
      if (size + b > 8000 && q.length) break;
      q.push([e.s, e.m]); e.t = t; size += b;
    }
    return q;
  }
  setState(s) { this.state = s; this.stateDirty = true; }
  tick() {
    const t = performance.now();
    if (this.role === 'client' && !this.partner && this.conns.some(c => c && c.ok) && t - (this.helloT || 0) > 1500) {
      this.pub({ k: 'h', n: this.nick, v: PROTO }); this.helloT = t;   // повторяем приветствие, пока хост не ответит
    }
    if (!this.partner) return;
    if (t - (this.lastPub || 0) < 95) return;          // ~10 пакетов в секунду на сервер
    // всё в одном пакете: состояние, подтверждение, новые/повторные события
    const pk = { k: 'x', a: this.rx };
    if (this.stateDirty) { this.stateDirty = false; pk.n = ++this.stN; pk.s = this.state; }
    const q = this.takeMsgs();
    if (q.length) pk.q = q;
    if (pk.s || pk.q || this.ackDirty || t - (this.lastPub || 0) > 1000) { this.ackDirty = false; this.lastPub = t; this.pub(pk); }
    // долгая тишина: сообщаем, но напарника не забываем — связь может вернуться
    if (!this.lost && t - this.lastHeard > 8000) { this.lost = true; this.cb.onLeave && this.cb.onLeave('timeout'); }
  }
  close() { this.closed = true; clearInterval(this.timer); for (const c of this.conns) c && c.close(); this.conns = []; }
}
