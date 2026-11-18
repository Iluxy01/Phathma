// Игра вдвоём: подключение по короткому коду из 4 цифр — без QR и пересылки.
// 1) Знакомство и запасной канал — бесплатные публичные MQTT-серверы (сразу три, для надёжности).
// 2) Затем телефоны сами пробуют соединиться напрямую (WebRTC) — по Wi-Fi это быстрее.
//    Если прямое соединение не вышло (роутер не пускает), игра идёт через серверы.
// Надёжная доставка: у каждого сообщения номер, напарник подтверждает приём,
// неподтверждённое повторяется; повторы и порядок отсекаются по номерам.
// Интерфейс: host(code, nick) / join(code, nick) / send(msg) / setState(obj) / close();
// обратные вызовы: onPartner(nick), onMsg(msg), onState(obj), onLeave(), onBack(), onError(e), onDirect(on).

const PROTO = 4;
export function netSupported() { return typeof WebSocket === 'function' && !window.claude; }

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

export class Link {
  constructor() {
    this.kind = 'net'; this.cb = {}; this.conns = [];
    this.sid = Math.random().toString(36).slice(2, 10);
    this.seq = 0; this.out = []; this.rx = 0; this.early = new Map();
    this.stN = 0; this.lastStN = -1; this.state = null; this.stateDirty = false;
    this.partner = null; this.lastHeard = 0; this.ackDirty = false;
    this.timer = setInterval(() => this.tick(), 50);
  }
  on(cb) { Object.assign(this.cb, cb); }
  setOpen() {}
  brokers() {
    const q = new URLSearchParams(location.search).get('mqtt');
    return q ? q.split(',') : BROKERS;
  }
  // подключение ко всем брокерам; успех — когда готов хотя бы один
  connect(code) {
    this.base = 'phathma/v4/' + code + '/';
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
  // через сервер (всегда для знакомства и сигналов WebRTC)
  pubServer(obj) { obj.f = this.sid; for (const c of this.conns) if (c) c.publish(this.peerTopic, obj); }
  // игровые пакеты: напрямую по Wi-Fi, если канал открыт, иначе через сервер
  pub(obj) {
    if (this.direct()) { obj.f = this.sid; try { this.dc.send(JSON.stringify(obj)); return; } catch (_) { /* на сервер */ } }
    this.pubServer(obj);
  }
  direct() { return !!(this.dc && this.dc.readyState === 'open'); }
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
        if (this.role === 'host') { this.pubServer({ k: 'h', n: this.nick, v: PROTO }); this.startRtc(); }
        this.cb.onPartner && this.cb.onPartner(String(m.n || 'Напарник').slice(0, 16));
      }
      return;
    }
    if (m.k === 'rtc') { this.onRtc(m).catch(() => {}); return; }
    if (m.k === 'ice') { if (m.c) { if (this.pc && this.pc.remoteDescription) this.pc.addIceCandidate(m.c).catch(() => {}); else (this.iceQ = this.iceQ || []).push(m.c); } return; }
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
      if (t - e.t < (this.direct() ? 400 : 700)) continue;
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
    // напрямую — 20 пакетов в секунду, через сервер — 10 (бесплатные серверы не любят частых)
    if (t - (this.lastPub || 0) < (this.direct() ? 45 : 95)) return;
    // всё в одном пакете: состояние, подтверждение, новые/повторные события
    const pk = { k: 'x', a: this.rx };
    if (this.stateDirty) { this.stateDirty = false; pk.n = ++this.stN; pk.s = this.state; }
    const q = this.takeMsgs();
    if (q.length) pk.q = q;
    if (pk.s || pk.q || this.ackDirty || t - (this.lastPub || 0) > 1000) { this.ackDirty = false; this.lastPub = t; this.pub(pk); }
    // долгая тишина: сообщаем, но напарника не забываем — связь может вернуться
    if (!this.lost && t - this.lastHeard > 8000) { this.lost = true; this.cb.onLeave && this.cb.onLeave('timeout'); }
  }
  // ---------- прямое соединение по Wi-Fi (WebRTC), сигналы — через сервер ----------
  newPc() {
    this.pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    this.pc.onicecandidate = (e) => { if (e.candidate) this.pubServer({ k: 'ice', c: e.candidate.toJSON() }); };
    this.pc.ondatachannel = (e) => this.attachDc(e.channel);
  }
  async startRtc() {
    if (typeof RTCPeerConnection !== 'function' || this.pc) return;
    try {
      this.newPc();
      this.attachDc(this.pc.createDataChannel('game', { ordered: true }));
      await this.pc.setLocalDescription(await this.pc.createOffer());
      this.pubServer({ k: 'rtc', t: 'offer', sdp: this.pc.localDescription.sdp });
    } catch (_) { /* остаёмся на сервере */ }
  }
  async onRtc(m) {
    if (typeof RTCPeerConnection !== 'function' || typeof m.sdp !== 'string') return;
    if (m.t === 'offer' && this.role === 'client') {
      if (this.offerSdp === m.sdp) return;            // то же приглашение пришло через другой сервер
      this.offerSdp = m.sdp;
      if (this.pc) { try { this.pc.close(); } catch (_) { /* */ } }
      this.newPc();
      await this.pc.setRemoteDescription({ type: 'offer', sdp: m.sdp });
      this.flushIce();
      await this.pc.setLocalDescription(await this.pc.createAnswer());
      this.pubServer({ k: 'rtc', t: 'answer', sdp: this.pc.localDescription.sdp });
    } else if (m.t === 'answer' && this.role === 'host' && this.pc && !this.pc.remoteDescription) {
      await this.pc.setRemoteDescription({ type: 'answer', sdp: m.sdp });
      this.flushIce();
    }
  }
  flushIce() {
    const q = this.iceQ || []; this.iceQ = [];
    for (const c of q) this.pc.addIceCandidate(c).catch(() => {});
  }
  attachDc(dc) {
    dc.onmessage = (e) => { let d; try { d = JSON.parse(e.data); } catch (_) { return; } this.recv(d); };
    dc.onopen = () => { this.dc = dc; this.cb.onDirect && this.cb.onDirect(true); };
    dc.onclose = () => { if (this.dc === dc) { this.dc = null; this.cb.onDirect && this.cb.onDirect(false); } };
    if (dc.readyState === 'open') dc.onopen();
  }
  close() {
    this.closed = true; clearInterval(this.timer);
    try { this.dc && this.dc.close(); } catch (_) { /* */ }
    try { this.pc && this.pc.close(); } catch (_) { /* */ }
    for (const c of this.conns) c && c.close(); this.conns = [];
  }
}
