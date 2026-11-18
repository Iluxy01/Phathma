// Игра вдвоём по одной сети Wi-Fi — без интернета и без серверов.
// Телефоны соединяются напрямую (WebRTC). Чтобы найти друг друга, они один раз
// обмениваются «кодами подключения» — через QR-код или копированием текста:
//   хост: makeOffer() → код-приглашение → напарник: acceptOffer(код) → код-ответ → хост: acceptAnswer(код)
// Интерфейс для игры: send(msg) / setState(obj) / close(); обратные вызовы
// onPartner(nick), onMsg(msg), onState(obj), onLeave(), onError(e).

const PROTO = 3;
const CODE_PREFIX = 'PH3';

// ---------- упаковка кода подключения (SDP) ----------
// Оставляем только нужное и сжимаем, чтобы QR-код был поменьше.
function slimSdp(sdp) {
  return sdp.split(/\r?\n/).filter(l => {
    if (!l) return false;
    if (l.startsWith('a=candidate:')) return / udp /i.test(l) && / typ host/.test(l);   // в своей сети нужны только прямые UDP-адреса
    if (/^a=(extmap-allow-mixed|msid-semantic|ice-options)/.test(l)) return false;
    return true;
  }).join('\r\n') + '\r\n';
}
const b64u = (u8) => { let s = ''; for (const b of u8) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64u = (s) => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const b = atob(s); return Uint8Array.from(b, c => c.charCodeAt(0)); };
async function pipe(u8, stream) { return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(stream)).arrayBuffer()); }
async function encodeSdp(type, sdp) {
  const raw = new TextEncoder().encode(slimSdp(sdp));
  const t = type === 'offer' ? 'O' : 'A';
  if (typeof CompressionStream === 'function') {
    try { return CODE_PREFIX + t + 'z' + b64u(await pipe(raw, new CompressionStream('deflate-raw'))); } catch (_) { /* без сжатия */ }
  }
  return CODE_PREFIX + t + 'r' + b64u(raw);
}
async function decodeSdp(code, want) {
  code = String(code || '').replace(/\s+/g, '');
  const i = code.indexOf(CODE_PREFIX);
  if (i < 0) throw new Error('это не код подключения Phathma');
  code = code.slice(i);
  const t = code[3], z = code[4], body = code.slice(5);
  if (want === 'offer' && t !== 'O') throw new Error('нужен код-приглашение хоста, а это код-ответ');
  if (want === 'answer' && t !== 'A') throw new Error('нужен код-ответ напарника, а это приглашение');
  let bytes = unb64u(body);
  if (z === 'z') bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
  return new TextDecoder().decode(bytes);
}

function gathered(pc, ms = 5000) {
  return new Promise((res) => {
    if (pc.iceGatheringState === 'complete') return res();
    const to = setTimeout(res, ms);
    pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(to); res(); } });
  });
}

// на claude.ai прямые соединения запрещены — там только одиночная игра
export function lanSupported() { return typeof RTCPeerConnection === 'function' && !window.claude; }

export class LanLink {
  constructor() {
    this.kind = 'lan'; this.cb = {}; this.pc = null; this.dc = null; this.queue = [];
    this.state = null; this.stateDirty = false; this.nick = 'Игрок';
    this.timer = setInterval(() => this.flushState(), 50);
  }
  on(cb) { Object.assign(this.cb, cb); }
  setOpen() {}
  newPc() {
    // без STUN/TURN: только адреса в своей сети
    this.pc = new RTCPeerConnection({ iceServers: [] });
    this.pc.addEventListener('connectionstatechange', () => {
      const s = this.pc && this.pc.connectionState;
      if (s === 'failed') this.cb.onError && this.cb.onError(new Error('телефоны не видят друг друга. Подключитесь к одной сети Wi-Fi (или раздайте точку доступа с одного телефона) и попробуйте снова'));
    });
  }
  // хост: код-приглашение
  async makeOffer(nick) {
    this.nick = nick; this.role = 'host';
    this.newPc();
    this.attach(this.pc.createDataChannel('game', { ordered: true }));
    await this.pc.setLocalDescription(await this.pc.createOffer());
    await gathered(this.pc);
    return encodeSdp('offer', this.pc.localDescription.sdp);
  }
  // напарник: принять приглашение, вернуть код-ответ
  async acceptOffer(code, nick) {
    this.nick = nick; this.role = 'client';
    const sdp = await decodeSdp(code, 'offer');
    this.newPc();
    this.pc.addEventListener('datachannel', (e) => this.attach(e.channel));
    await this.pc.setRemoteDescription({ type: 'offer', sdp });
    await this.pc.setLocalDescription(await this.pc.createAnswer());
    await gathered(this.pc);
    return encodeSdp('answer', this.pc.localDescription.sdp);
  }
  // хост: принять ответ — соединение устанавливается само
  async acceptAnswer(code) {
    const sdp = await decodeSdp(code, 'answer');
    await this.pc.setRemoteDescription({ type: 'answer', sdp });
  }
  attach(dc) {
    this.dc = dc;
    dc.onopen = () => {
      dc.send(JSON.stringify({ t: 'h', n: this.nick, v: PROTO }));
      for (const m of this.queue) dc.send(JSON.stringify({ t: 'm', m }));
      this.queue = [];
    };
    dc.onmessage = (e) => {
      let d; try { d = JSON.parse(e.data); } catch (_) { return; }
      if (!d || typeof d !== 'object') return;
      try {
        if (d.t === 'h') { if (d.v === PROTO) this.cb.onPartner && this.cb.onPartner(String(d.n || 'Напарник').slice(0, 16)); else this.cb.onError && this.cb.onError(new Error('у напарника другая версия игры — используйте одинаковый файл')); }
        else if (d.t === 'm') this.cb.onMsg && this.cb.onMsg(d.m);
        else if (d.t === 's') this.cb.onState && this.cb.onState(d.s);
      } catch (err) { console.error(err); if (window.__reportError) window.__reportError(err); }
    };
    dc.onclose = () => { if (this.dc === dc && !this.closed) this.cb.onLeave && this.cb.onLeave('left'); };
    // канал мог открыться раньше, чем мы подписались
    if (dc.readyState === 'open') dc.onopen();
  }
  send(m) {
    if (this.dc && this.dc.readyState === 'open') this.dc.send(JSON.stringify({ t: 'm', m }));
    else this.queue.push(m);
  }
  setState(s) { this.state = s; this.stateDirty = true; }
  flushState() {
    if (!this.stateDirty || !this.dc || this.dc.readyState !== 'open') return;
    // не забиваем канал, если телефон не успевает отправлять
    if (this.dc.bufferedAmount > 64 * 1024) return;
    this.stateDirty = false;
    this.dc.send(JSON.stringify({ t: 's', s: this.state }));
  }
  close() {
    this.closed = true;
    clearInterval(this.timer);
    try { this.dc && this.dc.close(); } catch (_) { /* */ }
    try { this.pc && this.pc.close(); } catch (_) { /* */ }
  }
}
