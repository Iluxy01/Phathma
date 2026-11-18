// Интерфейс: журнал, фургон, результаты, HUD
import { G, EVIDENCE } from './state.js';
import { GHOSTS } from './ghost.js';
import { ITEM_DEFS, takeFromStock, returnToStock, useLabel, selected } from './items.js';

const $ = (id) => document.getElementById(id);

export function show(id) { const e = $(id); if (e) e.classList.remove('hidden'); }
export function hide(id) { const e = $(id); if (e) e.classList.add('hidden'); }

export function openScreen(id) {
  G.uiOpen = id;
  show(id);
  if (id === 'journal') renderJournal();
  if (id === 'vanMenu') renderVan();
}
export function closeScreen(id) {
  hide(id);
  if (G.uiOpen === id) G.uiOpen = null;
}

export function initUI(handlers) {
  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => closeScreen(b.dataset.close)));
  document.querySelectorAll('.tab[data-tab]').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.tab[data-tab]').forEach(x => x.classList.toggle('active', x === b));
    for (const t of ['ev', 'info', 'photos']) $('tab-' + t).classList.toggle('hidden', t !== b.dataset.tab);
    renderJournal();
  }));
  $('btnJournal').addEventListener('click', () => openScreen('journal'));
  $('btnPause').addEventListener('click', handlers.pause);
  $('btnResume').addEventListener('click', handlers.resume);
  $('btnRestart').addEventListener('click', () => location.reload());
  $('btnHelp').addEventListener('click', () => openScreen('help'));
  $('btnHelp2').addEventListener('click', () => openScreen('help'));
  $('btnLeaveYes').addEventListener('click', () => { closeScreen('leaveConfirm'); handlers.leave(); });
}

// ---------- журнал ----------
let viewGhost = null;
export function renderJournal() {
  const ev = G.journal.evidence;
  const evList = $('evList');
  evList.innerHTML = '<h3>Улики</h3>';
  for (const k in EVIDENCE) {
    const st = ev[k] || 0; // 0 нет, 1 есть, 2 исключено
    const b = document.createElement('button');
    b.className = 'ev' + (st === 1 ? ' yes' : st === 2 ? ' no' : '');
    b.innerHTML = `<span class="mark">${st === 1 ? '✓' : st === 2 ? '✕' : ''}</span><span>${EVIDENCE[k].name}</span>`;
    b.onclick = () => { ev[k] = ((ev[k] || 0) + 1) % 3; if (G.onJournal) G.onJournal(); renderJournal(); };
    evList.appendChild(b);
  }
  const yes = Object.keys(ev).filter(k => ev[k] === 1);
  const no = Object.keys(ev).filter(k => ev[k] === 2);
  const gl = $('ghostList');
  gl.innerHTML = '<h3>Призраки</h3>';
  for (const g of GHOSTS) {
    const possible = yes.every(e => g.ev.includes(e)) && !no.some(e => g.ev.includes(e)) && yes.length <= 3;
    const b = document.createElement('button');
    b.className = 'gh' + (possible ? '' : ' out') + (G.journal.guess === g.id ? ' sel' : '') + (viewGhost === g.id ? ' view' : '');
    b.innerHTML = `${G.journal.guess === g.id ? '◉ ' : ''}${g.name}<span class="evs">${g.ev.map(e => EVIDENCE[e].short).join(' · ')}</span>`;
    b.onclick = () => {
      if (viewGhost === g.id) { G.journal.guess = G.journal.guess === g.id ? null : g.id; if (G.onJournal) G.onJournal(); }
      viewGhost = g.id;
      renderJournal();
    };
    gl.appendChild(b);
  }
  const gi = $('ghostInfo');
  const g = GHOSTS.find(x => x.id === viewGhost);
  if (g) {
    gi.innerHTML = `<h3>${g.name}</h3><p>${g.desc}</p>
      <p><span class="k">Сила:</span> ${g.strength}</p>
      <p><span class="bad">Слабость:</span> ${g.weakness}</p>
      <p><span class="k">Улики:</span> ${g.ev.map(e => EVIDENCE[e].name).join(', ')}</p>
      <p class="hint">${G.journal.guess === g.id ? 'Выбран как ответ. Нажмите ещё раз, чтобы снять выбор.' : 'Нажмите ещё раз, чтобы выбрать как ответ.'}</p>`;
  } else {
    gi.innerHTML = '<h3>Описание</h3><p class="hint">Отмечайте найденные улики (повторное нажатие — исключить). Нажмите на призрака, чтобы прочитать о нём, и ещё раз — чтобы выбрать его как ответ.</p>';
  }
  // задания
  const gh = G.ghost;
  let html = `<h3>Дело</h3><div class="obj">Имя призрака: <b>${gh.fullName}</b>, возраст при смерти: ${gh.age}</div>`;
  html += '<div class="obj">В доме спрятан проклятый предмет. Он может многое рассказать о призраке — но дорого обойдётся.</div>';
  html += `<div class="obj">Сложность: <b>${G.diff.name}</b> · призрак оставляет улик: <b>${G.diff.evidence}</b> из 3</div>`;
  html += '<h3>Задания</h3>';
  html += `<div class="obj ${G.journal.guess ? 'done' : ''}">${G.journal.guess ? '✓' : '○'} Определить тип призрака (выбрать в журнале)</div>`;
  for (const o of G.objectives) html += `<div class="obj ${G.done[o.id] ? 'done' : ''}">${G.done[o.id] ? '✓' : '○'} ${o.text}</div>`;
  html += `<h3>Подсказка</h3><p class="hint">Рассудок команды показан на табло в фургоне. Чем ниже рассудок — тем активнее и опаснее призрак.</p>`;
  $('tab-info').innerHTML = html;
  // фото
  const ph = $('tab-photos');
  if (!G.photos.length) ph.innerHTML = '<p class="hint">Пока нет снимков. Возьмите фотоаппарат в фургоне.</p>';
  else ph.innerHTML = '<div class="photos">' + G.photos.map(p => `<div class="photo"><img src="${p.img}"><div>${p.label} ${'★'.repeat(p.stars)}</div></div>`).join('') + '</div>';
}

// ---------- фургон ----------
export function renderVan() {
  const sl = $('stockList');
  sl.innerHTML = '';
  for (const k in ITEM_DEFS) {
    const d = ITEM_DEFS[k];
    const b = document.createElement('button');
    b.className = 'stock';
    b.disabled = !G.stock[k];
    b.innerHTML = `<b>${d.icon}</b>${d.name}<br><i>осталось: ${G.stock[k]}</i>`;
    b.onclick = () => { takeFromStock(k); renderVan(); };
    sl.appendChild(b);
  }
  const il = $('invList');
  il.innerHTML = '<h3 style="margin:4px 0 8px;color:var(--accent);font-size:15px">В руках</h3>';
  G.inv.forEach((it, i) => {
    const row = document.createElement('div');
    row.className = 'invitem';
    if (it) {
      row.innerHTML = `<span>${it.def.icon} ${it.def.name}</span>`;
      const b = document.createElement('button');
      b.textContent = 'Вернуть';
      b.onclick = () => { returnToStock(i); renderVan(); };
      row.appendChild(b);
    } else row.innerHTML = '<span style="color:var(--muted)">— пусто —</span>';
    il.appendChild(row);
  });
  const p = document.createElement('p');
  p.className = 'hint';
  p.textContent = 'Предметы, оставленные в доме, можно забрать и вернуть позже.';
  il.appendChild(p);
}

// ---------- HUD ----------
let lastSlots = '';
export function updateHUD(target) {
  // слоты
  const sig = G.inv.map(it => it ? it.type + (it.on ? 1 : 0) + it.charges : '-').join('|') + G.sel;
  if (sig !== lastSlots) {
    lastSlots = sig;
    document.querySelectorAll('.slot').forEach((el, i) => {
      const it = G.inv[i];
      el.classList.toggle('sel', i === G.sel);
      el.classList.toggle('on', !!(it && it.on && it.def.toggle));
      el.innerHTML = it ? `${it.def.icon}<small>${it.def.name}</small>` : '<small>пусто</small>';
    });
  }
  // показания
  const r = G.readout, ro = $('readout');
  if (!r) ro.innerHTML = '';
  else if (r.kind === 'emf') {
    const cols = ['#2f4', '#8f2', '#fe2', '#f82', '#f22'];
    ro.innerHTML = 'ЭМП ' + cols.map((c, i) => `<span class="led" style="background:${i < r.lvl ? c : '#222'};box-shadow:${i < r.lvl ? '0 0 6px ' + c : 'none'}"></span>`).join('');
  } else ro.textContent = r.text;
  // подсказка
  $('prompt').textContent = target ? target.label : '';
  $('cross').classList.toggle('act', !!target);
  $('bInteract').classList.toggle('ready', !!target);
  const it = selected();
  $('useLbl').textContent = useLabel(it);
  $('bUse').classList.toggle('on', !!(it && it.on && it.def.toggle));
  $('bAsk').classList.toggle('hidden', !(it && it.type === 'box' && it.on));
  $('bLight').classList.toggle('on', G.player.flashlight);
  $('stamina').firstElementChild.style.width = (G.player.stamina / 3 * 100) + '%';
  $('stamina').style.opacity = G.player.stamina < 2.95 ? 1 : 0;
}

// ---------- результаты ----------
export function showResult(dead, note = '') {
  const gh = G.ghost;
  if (!gh) return;
  const guess = GHOSTS.find(g => g.id === G.journal.guess);
  const correct = guess && guess.id === gh.def.id;
  let money = 0;
  const lines = [];
  if (correct) { money += 100; lines.push('Тип призрака определён верно: +$100'); }
  else lines.push(`<span class="bad-text">Тип призрака ${guess ? 'определён неверно (' + guess.name + ')' : 'не определён'}</span>`);
  for (const o of G.objectives) {
    if (G.done[o.id]) { money += 40; lines.push(`✓ ${o.text}: +$40`); }
    else lines.push(`<span style="color:var(--muted)">○ ${o.text}</span>`);
  }
  const best = G.photos.reduce((a, p) => a + p.stars, 0);
  if (best) { money += best * 10; lines.push(`Фотографии (${best}★): +$${best * 10}`); }
  if (dead) { money = Math.round(money * 0.5); lines.push('<span class="bad-text">Вы погибли — награда уменьшена вдвое</span>'); }
  const mul = G.diff.reward;
  if (mul !== 1) lines.push(`Сложность «${G.diff.name}»: ×${mul}`);
  money *= mul;
  if (G.profile && !G.rewarded) {
    G.rewarded = true;
    G.profile.money += money; G.profile.xp += money + (correct ? 20 : 0); G.profile.games++;
    G.saveProfile();
    lines.push(`Всего на счету: $${G.profile.money} · уровень ${Math.floor(G.profile.xp / 150) + 1}`);
  }
  if (G.mp && G.remote && G.remote.n) lines.push(`Напарник ${G.remote.n}: ${G.remote.dead ? '<span class="bad-text">погиб</span>' : 'выжил'}${G.remote.ps ? ` · фото ${G.remote.ps}★` : ''}`);
  if (gh.hidden && gh.hidden.length) lines.push(`<span style="color:var(--muted)">Скрытые улики: ${gh.hidden.map(e => EVIDENCE[e].name).join(', ')}</span>`);
  $('resultBody').innerHTML = `
    <h2>${dead ? 'Вас настиг призрак' : 'Расследование завершено'}</h2>
    ${note ? `<p class="hint">${note.replace(/[<>&]/g, '')}</p>` : ''}
    <p>Это был</p>
    <div class="result-ghost">${gh.def.name}</div>
    <p>${gh.fullName}, ${gh.age} лет · комната: ${roomName(gh.home)}</p>
    <p style="text-align:left">${lines.join('<br>')}</p>
    <h2>Итого: $${money}</h2>
    <button class="btn primary" onclick="location.reload()">Новое расследование</button>`;
  show('result');
}

const RN = { K: 'Кухня', D: 'Столовая', B: 'Спальня', W: 'Ванная', S: 'Кладовка', L: 'Гостиная', C: 'Детская', H: 'Коридор' };
function roomName(r) { return RN[r] || r; }
