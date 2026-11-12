'use strict';
// ===== Controls, rendering, HUD =====
const cv = document.getElementById('c'), ctx = cv.getContext('2d');
const $ = id => document.getElementById(id);
const PANEL_H = 190, TEAMC = ['#3d8bff', '#ff5252'], TEAMD = ['#1d4fa8', '#a82323'];
const ui = {cam: {x: 0, y: 0}, Z: 1.5, mx: 0, my: 0, inWin: false, drag: null, pan: null, cmd: null, menu: null, keys: {},
  lastClick: {t: 0, type: null}, lastGroup: {n: 0, t: 0}, coachOff: false, paused: false, card: [], cardSig: '', frame: 0, shift: false};
let terrainCv = null, miniTerrain = null, fogCv = null, fogData = null, last = 0, acc = 0;

// ---------- sound ----------
let actx = null;
const sfxLast = {};
function beep(f, dur, type, vol, slide) {
  if (!actx) return;
  const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime;
  o.type = type || 'square'; o.frequency.setValueAtTime(f, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
  g.gain.setValueAtTime(vol || 0.04, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur);
}
function sfx(name, at) {
  if (!actx || !G) return;
  if (at && !isOnScreen(at.x, at.y)) return;
  const now = performance.now(); if (now - (sfxLast[name] || 0) < 70) return; sfxLast[name] = now;
  switch (name) {
    case 'zap': beep(880, 0.06, 'square', 0.015, 440); break;
    case 'thump': beep(140, 0.18, 'sawtooth', 0.04, 60); break;
    case 'bonk': beep(200, 0.07, 'triangle', 0.04, 120); break;
    case 'pop': beep(500, 0.12, 'triangle', 0.04, 150); break;
    case 'boom': beep(110, 0.4, 'sawtooth', 0.06, 40); break;
    case 'done': beep(660, 0.1, 'triangle', 0.05); setTimeout(() => beep(990, 0.14, 'triangle', 0.05), 90); break;
    case 'spawn': beep(520, 0.07, 'sine', 0.03, 780); break;
    case 'place': beep(300, 0.1, 'triangle', 0.04, 200); break;
    case 'click': beep(700, 0.03, 'sine', 0.025); break;
    case 'cmd': beep(440, 0.05, 'sine', 0.03, 560); break;
    case 'err': beep(160, 0.15, 'square', 0.03); break;
    case 'alert': beep(880, 0.1, 'square', 0.04); setTimeout(() => beep(880, 0.1, 'square', 0.04), 160); break;
  }
}
function toast(msg, kind) {
  const box = $('toasts');
  if ([...box.children].some(c => c.textContent === msg)) return;
  const d = document.createElement('div'); d.className = 'toast' + (kind ? ' ' + kind : ''); d.textContent = msg;
  box.appendChild(d); while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => d.remove(), 3200);
}
function err(msg) { toast(msg, 'bad'); sfx('err'); }

// ---------- camera ----------
function viewW() { return innerWidth / ui.Z; }
function viewH() { return innerHeight / ui.Z; }
function clampCam() {
  ui.cam.x = clamp(ui.cam.x, -40, Math.max(-40, W * TILE - viewW() + 40));
  ui.cam.y = clamp(ui.cam.y, -40, Math.max(-40, H * TILE - viewH() + (PANEL_H + 20) / ui.Z));
}
function centerOn(x, y) { ui.cam.x = x - viewW() / 2; ui.cam.y = y - (innerHeight - PANEL_H) / ui.Z / 2; clampCam(); }
function isOnScreen(x, y) { return x > ui.cam.x && y > ui.cam.y && x < ui.cam.x + viewW() && y < ui.cam.y + viewH() - PANEL_H / ui.Z; }
const toWorld = (sx, sy) => ({x: ui.cam.x + sx / ui.Z, y: ui.cam.y + sy / ui.Z});
function resize() { const d = devicePixelRatio || 1; cv.width = innerWidth * d; cv.height = innerHeight * d; if (G) clampCam(); }
addEventListener('resize', resize); resize();

// ---------- selection helpers ----------
const selEnts = () => G.sel.map(id => G.byId.get(id)).filter(Boolean);
const act = () => { G.stats.actions++; };
function setSel(list) { G.sel = list.map(e => e.id); ui.menu = null; if (ui.cmd && ui.cmd.t !== 'amove') ui.cmd = null; refreshCard(); }
function togglePause() { if (!G || G.over) return; ui.paused = !ui.paused; $('pauseBtn').textContent = ui.paused ? '▶' : '⏸'; }
function pick(wx, wy) {
  let best = null, bd = 1e9;
  for (const e of G.ents) {
    if (e.dead) continue;
    if (e.unit) {
      if (e.team === 1 && !isVisible(e)) continue;
      const d = Math.hypot(e.x - wx, e.y - wy);
      if (d < e.r + 5 && d < bd) { bd = d; best = e; }
    }
  }
  if (best) return best;
  for (const e of G.ents) {
    if (e.dead || e.unit || e.covered) continue;
    if (e.team !== 0 && !isExplored(e)) continue;
    const h = e.size * TILE / 2;
    if (Math.abs(wx - e.x) <= h && Math.abs(wy - e.y) <= h) return e;
  }
  return null;
}

// ---------- commands ----------
function slot(i, n, x, y) {
  const cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
  return {x: x + (i % cols - (cols - 1) / 2) * 26, y: y + (Math.floor(i / cols) - (rows - 1) / 2) * 26};
}
function smart(wx, wy, shift) {
  const sel = selEnts().filter(e => e.team === 0); if (!sel.length) return;
  const t = pick(wx, wy), units = sel.filter(e => e.unit);
  act();
  if (units.length) {
    units.forEach((e, i) => {
      let o;
      if (t && t.team === 1) o = e.def.dmg ? {t: 'attack', target: t.id} : {t: 'move', x: wx, y: wy};
      else if (t && e.def.worker && (t.type === 'crystal' || (t.type === 'refinery' && t.team === 0))) o = {t: 'harvest', target: t.id};
      else if (t && e.def.worker && t.type === 'hq' && t.team === 0 && e.carry > 0) o = {t: 'return', node: 0};
      else o = {t: 'move', ...slot(i, units.length, wx, wy)};
      giveOrder(e, o, shift);
    });
    G.fx.push({k: 'ring', x: wx, y: wy, t: 0.35, T: 0.35, r: 14, c: t && t.team === 1 ? '#ff5252' : '#7dff8a'});
    sfx('cmd');
  } else {
    for (const b of sel) if (b.bld) b.rally = {x: wx, y: wy, target: t && (t.type === 'crystal' || t.type === 'refinery') ? t.id : 0};
    G.fx.push({k: 'ring', x: wx, y: wy, t: 0.35, T: 0.35, r: 14, c: '#ffd34d'});
    sfx('cmd');
  }
}
function doAmove(wx, wy, shift) {
  const units = selEnts().filter(e => e.unit && e.team === 0); if (!units.length) return;
  act(); G.stats.amoves++;
  const t = pick(wx, wy);
  units.forEach((e, i) => {
    if (t && t.team === 1 && e.def.dmg) giveOrder(e, {t: 'attack', target: t.id}, shift);
    else giveOrder(e, {t: 'amove', ...slot(i, units.length, wx, wy)}, shift);
  });
  G.fx.push({k: 'ring', x: wx, y: wy, t: 0.35, T: 0.35, r: 14, c: '#ff5252'});
  sfx('cmd');
}
function placeTile(type, wx, wy) {
  const s = DEFS[type].size;
  if (type === 'refinery') {
    let best = null, bd = 80;
    for (const v of G.ents) if (v.type === 'vent' && !v.covered) { const d = Math.hypot(v.x - wx, v.y - wy); if (d < bd) { bd = d; best = v; } }
    if (best) return [best.tx, best.ty];
  }
  return [Math.round(wx / TILE - s / 2), Math.round(wy / TILE - s / 2)];
}
function doPlace(wx, wy, shift) {
  const type = ui.cmd.type, [x, y] = placeTile(type, wx, wy), s = DEFS[type].size;
  const ws = selEnts().filter(e => e.unit && e.def.worker && e.team === 0);
  if (!ws.length) { ui.cmd = null; return; }
  const px = (x + s / 2) * TILE, py = (y + s / 2) * TILE;
  ws.sort((a, b) => (a.order.t === 'build') - (b.order.t === 'build') || Math.hypot(a.x - px, a.y - py) - Math.hypot(b.x - px, b.y - py));
  const e = orderBuild(ws[0], type, x, y, shift);
  if (e) { err(type === 'refinery' && e.startsWith("Can't") ? 'Gas Pumps go on a green vent 🟢' : e); return; }
  act(); sfx('cmd');
  if (!shift) ui.cmd = null;
}

// ---------- command card ----------
function cardButtons() {
  const sel = selEnts(); if (!sel.length || sel[0].team !== 0) return [];
  const tm = G.teams[0], first = sel[0], out = [];
  const costOk = d => tm.crystal >= d.cost[0] && tm.gas >= d.cost[1];
  if (ui.menu === 'build') {
    for (const k of BUILD_MENU) {
      const d = DEFS[k];
      out.push({icon: d.icon, key: d.key, def: d, off: !!buildError(0, k), extra: d.req && !hasBuilt(0, d.req) ? 'Needs: ' + DEFS[d.req].name : '',
        fn: () => { const e = buildError(0, k); if (e) return err(e); ui.cmd = {t: 'place', type: k}; ui.menu = null; }});
    }
    out.push({icon: '↩️', key: 'Escape', keyLabel: 'Esc', name: 'Back', desc: 'Close the build menu.', fn: () => { ui.menu = null; }});
    return out;
  }
  if (first.unit) {
    const units = sel.filter(e => e.unit);
    out.push({icon: '⚔️', key: 'A', name: 'Attack-move', desc: 'Then left-click the ground. Your units walk there and fight everything on the way. The #1 habit of good commanders!', fn: () => { ui.cmd = {t: 'amove'}; }});
    out.push({icon: '✋', key: 'S', name: 'Stop', desc: 'Stop what you are doing.', fn: () => { units.forEach(e => giveOrder(e, {t: 'idle'})); }});
    out.push({icon: '🛡️', key: 'H', name: 'Hold position', desc: 'Stand still and shoot anything in range.', fn: () => { units.forEach(e => giveOrder(e, {t: 'hold'})); }});
    if (units.some(e => e.def.worker)) out.push({icon: '🏗️', key: 'B', name: 'Build', desc: 'Open the build menu.', fn: () => { ui.menu = 'build'; }});
    const zs = units.filter(e => e.type === 'trooper');
    if (zs.length && tm.up.rush) out.push({icon: '🍭', key: 'R', name: 'Sugar Rush', desc: 'Zappers move and shoot much faster for 6 seconds. 25 second cooldown.', off: !zs.some(e => e.rushCd <= 0),
      fn: () => { let n = 0; zs.forEach(e => { if (useRush(e)) n++; }); if (!n) err('Sugar Rush is recharging!'); else sfx('done'); }});
    return out;
  }
  if (first.bld) {
    if (!first.built) return out;
    for (const k of first.def.trains || []) {
      const d = DEFS[k];
      const maxed = d.kind === 'tech' && tm.up[d.up] + (tm.pending[k] || 0) >= d.max;
      out.push({icon: d.icon, key: d.key, def: d, off: maxed || !costOk(d) || (d.kind === 'unit' && tm.supUsed + d.supply > tm.supMax),
        fn: () => {
          const bs = selEnts().filter(b => b.type === first.type && b.built && b.team === 0).sort((a, b) => a.q.length - b.q.length);
          const e = queueTrain(bs[0], k); if (e) err(e); else sfx('click');
        }});
    }
  }
  return out;
}
function refreshCard() {
  const btns = G ? cardButtons() : [];
  const sig = btns.map(b => b.icon + (b.off ? 0 : 1)).join('|');
  ui.card = btns;
  if (sig === ui.cardSig) return;
  ui.cardSig = sig;
  $('card').innerHTML = btns.map((b, i) => {
    const d = b.def, cost = d ? '💎' + d.cost[0] + (d.cost[1] ? ' ⛽' + d.cost[1] : '') : '';
    return `<div class="btn${b.off ? ' off' : ''}" data-i="${i}"><span class="k">${b.keyLabel || b.key}</span>${b.icon}<span class="c">${cost}</span></div>`;
  }).join('');
  $('tip').style.display = 'none';
}
$('card').addEventListener('mousedown', ev => {
  const el = ev.target.closest('.btn'); if (!el) return;
  const b = ui.card[+el.dataset.i]; if (b) { act(); b.fn(); sfx('click'); refreshCard(); }
});
$('card').addEventListener('mousemove', ev => {
  const el = ev.target.closest('.btn'), tip = $('tip');
  if (!el) { tip.style.display = 'none'; return; }
  const b = ui.card[+el.dataset.i]; if (!b) return;
  const d = b.def;
  let h = `<b>${b.icon} ${d ? d.name : b.name}</b> <kbd>${b.keyLabel || b.key}</kbd><br>${d ? d.desc : b.desc}`;
  if (d) {
    h += `<br>💎 ${d.cost[0]}${d.cost[1] ? ' &nbsp;⛽ ' + d.cost[1] : ''}${d.supply ? ' &nbsp;🏠 ' + d.supply : ''} &nbsp;⏱ ${d.time}s`;
    if (d.kind === 'unit') h += `<br>❤️ ${d.hp}${d.dmg ? ' &nbsp;⚔️ ' + d.dmg + (d.bonus ? ' (+' + d.bonus + ' vs armored)' : '') : ''}${d.range ? ' &nbsp;🎯 range ' + d.range : ''}`;
  }
  if (b.extra) h += `<br><span style="color:#ff9c9c">${b.extra}</span>`;
  tip.innerHTML = h; tip.style.display = 'block';
});
$('card').addEventListener('mouseleave', () => { $('tip').style.display = 'none'; });
$('info').addEventListener('mousedown', ev => {
  const el = ev.target.closest('.qi'); if (!el) return;
  const b = G.byId.get(+el.dataset.b); if (b) { cancelTrain(b, +el.dataset.i); act(); sfx('click'); }
});

// ---------- input ----------
addEventListener('mousemove', ev => { ui.mx = ev.clientX; ui.my = ev.clientY; ui.inWin = true; ui.shift = ev.shiftKey; });
document.addEventListener('mouseleave', () => { ui.inWin = false; });
cv.addEventListener('contextmenu', ev => ev.preventDefault());
$('mini').addEventListener('contextmenu', ev => ev.preventDefault());
cv.addEventListener('mousedown', ev => {
  if (!G || G.over) return;
  ev.preventDefault();
  const w = toWorld(ev.clientX, ev.clientY);
  if (ev.button === 0) {
    if (ui.cmd) {
      if (ui.cmd.t === 'amove') { doAmove(w.x, w.y, ev.shiftKey); if (!ev.shiftKey) ui.cmd = null; }
      else if (ui.cmd.t === 'place') doPlace(w.x, w.y, ev.shiftKey);
    } else ui.drag = {sx: ev.clientX, sy: ev.clientY};
  } else if (ev.button === 2) {
    if (ui.cmd) ui.cmd = null; else smart(w.x, w.y, ev.shiftKey);
  } else if (ev.button === 1) ui.pan = {sx: ev.clientX, sy: ev.clientY, cx: ui.cam.x, cy: ui.cam.y};
});
addEventListener('mouseup', ev => {
  if (ev.button === 1) ui.pan = null;
  if (ev.button !== 0 || !ui.drag || !G) return;
  const d = ui.drag; ui.drag = null;
  const a = toWorld(Math.min(d.sx, ev.clientX), Math.min(d.sy, ev.clientY)), b = toWorld(Math.max(d.sx, ev.clientX), Math.max(d.sy, ev.clientY));
  act();
  if (Math.abs(ev.clientX - d.sx) < 6 && Math.abs(ev.clientY - d.sy) < 6) {
    const e = pick(a.x, a.y), now = performance.now();
    if (!e) { if (!ev.shiftKey) setSel([]); return; }
    const dbl = now - ui.lastClick.t < 350 && ui.lastClick.type === e.type;
    ui.lastClick = {t: now, type: e.type};
    if (e.team === 0 && (dbl || ev.ctrlKey)) {
      setSel(G.ents.filter(o => o.team === 0 && o.type === e.type && !o.dead && isOnScreen(o.x, o.y)));
    } else if (ev.shiftKey && e.team === 0 && G.sel.length && selEnts()[0] && selEnts()[0].team === 0) {
      const i = G.sel.indexOf(e.id); if (i >= 0) G.sel.splice(i, 1); else G.sel.push(e.id);
    } else setSel([e]);
    sfx('click');
  } else {
    let units = G.ents.filter(e => e.unit && e.team === 0 && !e.dead && e.x >= a.x && e.x <= b.x && e.y >= a.y && e.y <= b.y);
    const army = units.filter(e => !e.def.worker);
    if (army.length && army.length < units.length) units = army; // boxing an army skips Bitbots
    if (!units.length) units = G.ents.filter(e => e.bld && e.team === 0 && !e.dead && e.x >= a.x && e.x <= b.x && e.y >= a.y && e.y <= b.y).slice(0, 1);
    if (ev.shiftKey) { const s = new Set(G.sel); units.forEach(u => s.add(u.id)); G.sel = [...s]; }
    else if (units.length) setSel(units);
    if (units.length) sfx('click');
  }
});
cv.addEventListener('wheel', ev => {
  ev.preventDefault(); if (!G) return;
  const before = toWorld(ev.clientX, ev.clientY);
  ui.Z = clamp(ui.Z * (ev.deltaY < 0 ? 1.1 : 0.9), 0.8, 2.4);
  ui.cam.x = before.x - ev.clientX / ui.Z; ui.cam.y = before.y - ev.clientY / ui.Z; clampCam();
}, {passive: false});

function miniPos(ev) { const r = $('mini').getBoundingClientRect(); return {x: (ev.clientX - r.left) / r.width * W * TILE, y: (ev.clientY - r.top) / r.height * H * TILE}; }
$('mini').addEventListener('mousedown', ev => {
  if (!G) return; ev.preventDefault();
  const p = miniPos(ev);
  if (ev.button === 2) smart(p.x, p.y, ev.shiftKey);
  else if (ui.cmd && ui.cmd.t === 'amove') { doAmove(p.x, p.y, ev.shiftKey); ui.cmd = null; }
  else { ui.miniDrag = true; centerOn(p.x, p.y); }
});
addEventListener('mousemove', ev => { if (ui.miniDrag && G) { const p = miniPos(ev); centerOn(p.x, p.y); } });
addEventListener('mouseup', () => { ui.miniDrag = false; });

function idleWorker() {
  const ws = G.ents.filter(e => e.team === 0 && e.unit && e.def.worker && e.order.t === 'idle');
  if (!ws.length) return;
  const cur = G.sel[0], i = ws.findIndex(w => w.id === cur), w = ws[(i + 1) % ws.length];
  setSel([w]); centerOn(w.x, w.y); act();
}
$('idleBtn').addEventListener('click', () => { if (G) idleWorker(); });
$('pauseBtn').addEventListener('click', togglePause);

addEventListener('keydown', ev => {
  if (!G || G.over) return;
  ui.keys[ev.code] = true; ui.shift = ev.shiftKey;
  refreshCard();
  if (ev.repeat && !ev.code.startsWith('Arrow')) { if (ev.code === 'F1' || ev.code === 'Space') ev.preventDefault(); return; }
  if (ev.code.startsWith('Arrow')) { ev.preventDefault(); return; }
  if (ev.code === 'F1') { ev.preventDefault(); idleWorker(); return; }
  if (ev.code === 'Space') {
    ev.preventDefault(); act();
    if (G.alert && G.time - G.alert.time < 30) centerOn(G.alert.x, G.alert.y);
    else { const h = G.hqs[0][0]; if (h) centerOn(h.x, h.y); }
    return;
  }
  if (ev.code === 'F10' || ev.code === 'Pause') { ev.preventDefault(); togglePause(); return; }
  const m = /^Digit([1-9])$/.exec(ev.code);
  if (m) {
    const n = +m[1];
    if (ev.ctrlKey || ev.altKey) {
      ev.preventDefault();
      const own = selEnts().filter(e => e.team === 0);
      if (own.length) { G.groups[n] = own.map(e => e.id); G.stats.groupsSet++; toast('Squad ' + n + ' saved! Press ' + n + ' to select it.'); act(); }
    } else if (ev.shiftKey) {
      const s = new Set(G.groups[n] || []); selEnts().filter(e => e.team === 0).forEach(e => s.add(e.id)); G.groups[n] = [...s]; G.stats.groupsSet++; act();
    } else {
      const g = (G.groups[n] || []).map(id => G.byId.get(id)).filter(Boolean);
      if (g.length) {
        const now = performance.now();
        if (ui.lastGroup.n === n && now - ui.lastGroup.t < 400) centerOn(g.reduce((a, e) => a + e.x, 0) / g.length, g.reduce((a, e) => a + e.y, 0) / g.length);
        ui.lastGroup = {n, t: now};
        setSel(g); act(); sfx('click');
      }
    }
    return;
  }
  if (ev.ctrlKey || ev.altKey || ev.metaKey) return;
  if (ev.code === 'Escape') {
    if (ui.cmd) ui.cmd = null; else if (ui.menu) ui.menu = null; else setSel([]);
    refreshCard(); return;
  }
  const k = ev.key.length === 1 ? ev.key.toUpperCase() : ev.key;
  const b = ui.card.find(b => b.key === k);
  if (b) { ev.preventDefault(); act(); ui.cmd = null; b.fn(); refreshCard(); }
});
addEventListener('keyup', ev => { ui.keys[ev.code] = false; ui.shift = ev.shiftKey; });
addEventListener('blur', () => { ui.keys = {}; ui.inWin = false; });

function updateCamera(dt) {
  if (ui.pan) { ui.cam.x = ui.pan.cx - (ui.mx - ui.pan.sx) / ui.Z; ui.cam.y = ui.pan.cy - (ui.my - ui.pan.sy) / ui.Z; clampCam(); return; }
  let dx = 0, dy = 0; const k = ui.keys, E = 10;
  if (k.ArrowLeft) dx--; if (k.ArrowRight) dx++; if (k.ArrowUp) dy--; if (k.ArrowDown) dy++;
  if (ui.inWin && !ui.drag && document.hasFocus()) {
    if (ui.mx < E) dx--; if (ui.mx > innerWidth - E) dx++; if (ui.my < E) dy--; if (ui.my > innerHeight - E) dy++;
  }
  if (dx || dy) { const s = 900 / ui.Z * dt; ui.cam.x += clamp(dx, -1, 1) * s; ui.cam.y += clamp(dy, -1, 1) * s; clampCam(); }
}

// ---------- pre-rendered layers ----------
function buildTerrain() {
  terrainCv = document.createElement('canvas'); terrainCv.width = W * TILE; terrainCv.height = H * TILE;
  const c = terrainCv.getContext('2d'), rnd = rng(42);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    c.fillStyle = (x + y) % 2 ? '#7cc653' : '#82cc58'; c.fillRect(x * TILE, y * TILE, TILE, TILE);
    if (rnd() < 0.12) { c.fillStyle = '#6fb848'; c.beginPath(); c.arc(x * TILE + rnd() * TILE, y * TILE + rnd() * TILE, 2 + rnd() * 3, 0, 7); c.fill(); }
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (G.terrain[idx(x, y)]) {
    c.fillStyle = '#5b6472'; c.fillRect(x * TILE, y * TILE, TILE, TILE);
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (G.terrain[idx(x, y)]) {
    c.fillStyle = '#8791a1'; c.beginPath(); c.roundRect(x * TILE + 2, y * TILE + 1, TILE - 4, TILE - 7, 7); c.fill();
    c.fillStyle = '#a3adbb'; c.beginPath(); c.roundRect(x * TILE + 6, y * TILE + 4, TILE - 16, 8, 4); c.fill();
  }
  miniTerrain = document.createElement('canvas'); miniTerrain.width = miniTerrain.height = 174;
  miniTerrain.getContext('2d').drawImage(terrainCv, 0, 0, 174, 174);
  fogCv = document.createElement('canvas'); fogCv.width = W; fogCv.height = H;
  fogData = fogCv.getContext('2d').createImageData(W, H);
}
function updateFog() {
  const d = fogData.data, v = G.vis;
  for (let i = 0; i < v.length; i++) { d[i * 4] = 8; d[i * 4 + 1] = 12; d[i * 4 + 2] = 28; d[i * 4 + 3] = v[i] === 2 ? 0 : v[i] === 1 ? 125 : 255; }
  fogCv.getContext('2d').putImageData(fogData, 0, 0);
  G.visDirty = false;
}

// ---------- drawing ----------
function hpBar(e, w, y) {
  const f = clamp(e.hp / e.maxHp, 0, 1);
  ctx.fillStyle = '#0008'; ctx.fillRect(e.x - w / 2 - 1, y - 1, w + 2, 6);
  ctx.fillStyle = f > 0.6 ? '#56d364' : f > 0.3 ? '#ffd34d' : '#ff5252'; ctx.fillRect(e.x - w / 2, y, w * f, 4);
}
function drawUnit(e, selected) {
  const r = e.r, c = TEAMC[e.team], dk = TEAMD[e.team], t = G.time;
  const moving = !!e.path, bob = moving ? Math.sin(t * 14 + e.id) * 1.5 : 0;
  if (selected) { ctx.strokeStyle = '#7dff8a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(e.x, e.y + r * 0.5, r + 5, (r + 5) * 0.6, 0, 0, 7); ctx.stroke(); }
  ctx.fillStyle = '#0003'; ctx.beginPath(); ctx.ellipse(e.x, e.y + r * 0.7, r, r * 0.45, 0, 0, 7); ctx.fill();
  ctx.save(); ctx.translate(e.x, e.y + bob);
  const dx = Math.cos(e.dir), dy = Math.sin(e.dir);
  if (e.rushT > 0) { ctx.fillStyle = '#ffb34766'; ctx.beginPath(); ctx.arc(0, 0, r + 5 + Math.sin(t * 20) * 1.5, 0, 7); ctx.fill(); }
  ctx.lineWidth = 2; ctx.strokeStyle = '#10203c';
  if (e.type === 'lancer') { ctx.strokeStyle = '#333'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(dx * (r + 10), dy * (r + 10)); ctx.stroke(); ctx.lineWidth = 2; ctx.strokeStyle = '#10203c'; }
  if (e.type === 'tank') {
    ctx.fillStyle = dk; ctx.beginPath(); ctx.roundRect(-r, -r, r * 2, r * 2, 5); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#222'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(dx * (r + 8), dy * (r + 8)); ctx.stroke();
    ctx.lineWidth = 2; ctx.strokeStyle = '#10203c'; ctx.fillStyle = c; ctx.beginPath(); ctx.arc(0, 0, r * 0.62, 0, 7); ctx.fill(); ctx.stroke();
  } else {
    ctx.fillStyle = e.type === 'medic' ? '#f4f7ff' : c;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill(); ctx.stroke();
    if (e.type === 'medic') { ctx.strokeStyle = c; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, r - 2.5, 0, 7); ctx.stroke(); ctx.fillStyle = '#e33'; ctx.fillRect(-1.5, r - 6.5, 3, 5); ctx.fillRect(-3, r - 5, 6, 2); }
    if (e.type === 'brute') { ctx.fillStyle = '#fff'; for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(s * r * 0.5, -r * 0.75); ctx.lineTo(s * r * 1.05, -r * 1.35); ctx.lineTo(s * r * 0.95, -r * 0.4); ctx.fill(); } ctx.fillStyle = dk; ctx.beginPath(); ctx.arc(0, r * 0.2, r * 0.55, 0.2, Math.PI - 0.2); ctx.fill(); }
    if (e.type === 'worker') { ctx.fillStyle = '#ffd34d'; ctx.beginPath(); ctx.arc(0, -r * 0.25, r * 0.95, Math.PI, 0); ctx.fill(); ctx.fillRect(-r - 1, -r * 0.3, r * 2 + 2, 2.5); }
    if (e.type === 'trooper') { ctx.strokeStyle = '#10203c'; ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(0, -r - 6); ctx.stroke(); ctx.fillStyle = '#ffe14d'; ctx.beginPath(); ctx.arc(0, -r - 7, 2.6, 0, 7); ctx.fill(); }
    // eyes
    const ex = dx * r * 0.35, ey = dy * r * 0.3 + (e.type === 'worker' ? 2 : 0);
    for (const s of [-1, 1]) {
      const ox = ex + s * r * 0.38 * Math.abs(dy) + s * r * 0.36 * (1 - Math.abs(dy)), oy = ey;
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ox, oy, r * 0.27, 0, 7); ctx.fill();
      ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(ox + dx * 1.2, oy + dy * 1.2, r * 0.13, 0, 7); ctx.fill();
    }
  }
  if (e.carry > 0) { ctx.fillStyle = e.carryKind ? '#6dff7a' : '#7fe9ff'; ctx.strokeStyle = '#0a3550'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-dx * r, -dy * r - 5); ctx.lineTo(-dx * r + 4, -dy * r); ctx.lineTo(-dx * r, -dy * r + 5); ctx.lineTo(-dx * r - 4, -dy * r); ctx.closePath(); ctx.fill(); ctx.stroke(); }
  ctx.restore();
  if (e.hp < e.maxHp || selected) hpBar(e, r * 2 + 4, e.y - r - 12);
}
function drawBuilding(e, selected) {
  const h = e.size * TILE / 2, x = e.x - h, y = e.y - h, s = e.size * TILE;
  if (selected) { ctx.strokeStyle = e.team === 0 ? '#7dff8a' : '#ff8080'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.roundRect(x - 2, y - 2, s + 4, s + 4, 12); ctx.stroke(); }
  ctx.globalAlpha = e.built ? 1 : 0.55;
  ctx.fillStyle = '#0003'; ctx.beginPath(); ctx.roundRect(x + 3, y + 6, s - 4, s - 4, 10); ctx.fill();
  ctx.fillStyle = TEAMD[e.team]; ctx.beginPath(); ctx.roundRect(x + 2, y + 2, s - 4, s - 4, 10); ctx.fill();
  ctx.fillStyle = TEAMC[e.team]; ctx.beginPath(); ctx.roundRect(x + 5, y + 4, s - 10, s - 13, 8); ctx.fill();
  ctx.fillStyle = '#ffffff22'; ctx.beginPath(); ctx.roundRect(x + 8, y + 6, s - 16, (s - 13) * 0.4, 6); ctx.fill();
  ctx.font = Math.round(s * 0.42) + 'px "Segoe UI Emoji", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff'; ctx.fillText(e.def.icon, e.x, e.y - 2);
  ctx.globalAlpha = 1;
  if (!e.built) { ctx.fillStyle = '#0009'; ctx.fillRect(x + 6, e.y + h - 14, s - 12, 7); ctx.fillStyle = '#ffd34d'; ctx.fillRect(x + 7, e.y + h - 13, (s - 14) * e.prog, 5); }
  else if (e.q.length && e.team === 0) { ctx.fillStyle = '#0009'; ctx.fillRect(x + 6, e.y + h - 14, s - 12, 7); ctx.fillStyle = '#56d364'; ctx.fillRect(x + 7, e.y + h - 13, (s - 14) * e.trainT / DEFS[e.q[0]].time, 5); }
  if (e.hp < e.maxHp && e.built || selected) hpBar(e, s - 10, y - 8);
}
function drawRes(e, selected) {
  if (e.covered) return;
  if (e.type === 'crystal') {
    const f = 0.55 + 0.45 * e.amount / 1200;
    ctx.fillStyle = '#0003'; ctx.beginPath(); ctx.ellipse(e.x, e.y + 10, 13, 5, 0, 0, 7); ctx.fill();
    for (const [ox, oy, sc] of [[-6, 3, 0.8], [6, 4, 0.7], [0, -2, 1.1]]) {
      const hh = 13 * sc * f, ww = 7 * sc;
      ctx.fillStyle = '#35c9f5'; ctx.strokeStyle = '#0b6a94'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(e.x + ox, e.y + oy - hh); ctx.lineTo(e.x + ox + ww, e.y + oy); ctx.lineTo(e.x + ox, e.y + oy + hh * 0.5); ctx.lineTo(e.x + ox - ww, e.y + oy); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#b8f1ff'; ctx.beginPath(); ctx.moveTo(e.x + ox, e.y + oy - hh); ctx.lineTo(e.x + ox, e.y + oy + hh * 0.5); ctx.lineTo(e.x + ox - ww, e.y + oy); ctx.closePath(); ctx.fill();
    }
  } else {
    ctx.fillStyle = '#3a4a3a'; ctx.beginPath(); ctx.ellipse(e.x, e.y, 26, 20, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#58e06a'; ctx.beginPath(); ctx.ellipse(e.x, e.y, 17, 12, 0, 0, 7); ctx.fill();
    const p = (G.time * 0.6 + e.id) % 1;
    ctx.fillStyle = `rgba(160,255,170,${0.6 * (1 - p)})`; ctx.beginPath(); ctx.arc(e.x, e.y - p * 22, 5 + p * 7, 0, 7); ctx.fill();
  }
  if (selected) { ctx.strokeStyle = '#ffd34d'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 3, 0, 7); ctx.stroke(); }
}

function render() {
  const dpr = devicePixelRatio || 1, S = ui.Z * dpr;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#080c1c'; ctx.fillRect(0, 0, cv.width, cv.height);
  if (!G) return;
  ctx.setTransform(S, 0, 0, S, -ui.cam.x * S, -ui.cam.y * S);
  ctx.drawImage(terrainCv, 0, 0);
  const x0 = ui.cam.x - 80, y0 = ui.cam.y - 80, x1 = ui.cam.x + viewW() + 80, y1 = ui.cam.y + viewH() + 80;
  const on = e => e.x > x0 && e.x < x1 && e.y > y0 && e.y < y1;
  const sel = new Set(G.sel);
  for (const e of G.ents) if (e.res && on(e) && isExplored(e)) drawRes(e, sel.has(e.id));
  for (const e of G.ents) if (e.bld && on(e) && (e.team === 0 || isExplored(e))) drawBuilding(e, sel.has(e.id));
  // rally lines
  for (const id of G.sel) { const b = G.byId.get(id); if (b && b.bld && b.team === 0 && b.rally) { ctx.strokeStyle = '#ffd34daa'; ctx.lineWidth = 2; ctx.setLineDash([6, 5]); ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.rally.x, b.rally.y); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = '#ffd34d'; ctx.beginPath(); ctx.arc(b.rally.x, b.rally.y, 4, 0, 7); ctx.fill(); } }
  // queued build sites
  for (const e of G.ents) if (e.unit && e.team === 0) for (const o of [e.order, ...e.queue]) if (o.t === 'build' && !o.started) {
    const s = DEFS[o.type].size * TILE; ctx.strokeStyle = '#ffffffaa'; ctx.lineWidth = 2; ctx.setLineDash([5, 4]); ctx.strokeRect(o.tx * TILE + 2, o.ty * TILE + 2, s - 4, s - 4); ctx.setLineDash([]);
  }
  for (const e of G.ents) if (e.unit && on(e) && (e.team === 0 || isVisible(e))) drawUnit(e, sel.has(e.id));
  for (const p of G.proj) {
    ctx.fillStyle = p.team ? '#ffb3b3' : '#c8f2ff'; ctx.beginPath(); ctx.arc(p.x, p.y, p.big ? 4.5 : 2.8, 0, 7); ctx.fill();
  }
  for (const f of G.fx) {
    const k = f.t / f.T;
    if (f.k === 'ring') { ctx.strokeStyle = f.c; ctx.lineWidth = 2.5; ctx.globalAlpha = k; ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (0.4 + k), 0, 7); ctx.stroke(); }
    else if (f.k === 'boom') { ctx.fillStyle = f.c; ctx.globalAlpha = k * 0.7; ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (1.1 - k * 0.5), 0, 7); ctx.fill(); }
    else if (f.k === 'pop') { ctx.fillStyle = f.c; ctx.globalAlpha = k; for (let i = 0; i < 7; i++) { const a = i * 0.9 + f.x; ctx.beginPath(); ctx.arc(f.x + Math.cos(a) * (1 - k) * (f.r + 16), f.y + Math.sin(a) * (1 - k) * (f.r + 16), 2 + f.r * 0.25 * k, 0, 7); ctx.fill(); } }
    else if (f.k === 'beam') { ctx.strokeStyle = f.c; ctx.globalAlpha = k; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(f.x2, f.y2); ctx.stroke(); }
    ctx.globalAlpha = 1;
  }
  ctx.font = 'bold 12px "Segoe UI", sans-serif'; ctx.textAlign = 'center';
  for (const t of G.texts) { ctx.globalAlpha = Math.min(1, t.t * 2); ctx.fillStyle = t.c; ctx.fillText(t.s, t.x, t.y); }
  ctx.globalAlpha = 1;
  if (G.visDirty) updateFog();
  ctx.imageSmoothingEnabled = true; ctx.drawImage(fogCv, 0, 0, W * TILE, H * TILE);
  // placement ghost
  if (ui.cmd && ui.cmd.t === 'place') {
    const w = toWorld(ui.mx, ui.my), [tx, ty] = placeTile(ui.cmd.type, w.x, w.y), s = DEFS[ui.cmd.type].size * TILE, ok = canPlace(ui.cmd.type, tx, ty, 0);
    ctx.fillStyle = ok ? '#56d36466' : '#ff525266'; ctx.strokeStyle = ok ? '#56d364' : '#ff5252'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(tx * TILE, ty * TILE, s, s, 8); ctx.fill(); ctx.stroke();
    ctx.font = Math.round(s * 0.42) + 'px "Segoe UI Emoji", sans-serif'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff'; ctx.fillText(DEFS[ui.cmd.type].icon, tx * TILE + s / 2, ty * TILE + s / 2);
  }
  // screen-space overlays
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (ui.drag && (Math.abs(ui.mx - ui.drag.sx) > 5 || Math.abs(ui.my - ui.drag.sy) > 5)) {
    ctx.fillStyle = '#7dff8a22'; ctx.strokeStyle = '#7dff8a'; ctx.lineWidth = 1.5;
    ctx.fillRect(ui.drag.sx, ui.drag.sy, ui.mx - ui.drag.sx, ui.my - ui.drag.sy); ctx.strokeRect(ui.drag.sx, ui.drag.sy, ui.mx - ui.drag.sx, ui.my - ui.drag.sy);
  }
  if (ui.cmd) {
    ctx.font = 'bold 15px "Segoe UI", sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
    const s = ui.cmd.t === 'amove' ? '⚔️ Left-click where to attack' : '🏗️ Left-click to place  (right-click cancels)';
    ctx.strokeText(s, ui.mx + 18, ui.my + 22); ctx.fillText(s, ui.mx + 18, ui.my + 22);
  }
  if (ui.paused) { ctx.fillStyle = '#0008'; ctx.fillRect(0, 0, innerWidth, innerHeight); ctx.fillStyle = '#fff'; ctx.font = 'bold 48px "Segoe UI", sans-serif'; ctx.textAlign = 'center'; ctx.fillText('⏸ Paused (F10)', innerWidth / 2, innerHeight / 2 - 60); }
  cv.style.cursor = ui.cmd ? 'crosshair' : 'default';
}

function drawMini() {
  const m = $('mini').getContext('2d'), k = 174 / (W * TILE);
  m.drawImage(miniTerrain, 0, 0);
  for (const e of G.ents) {
    if (e.dead || e.covered) continue;
    if (e.res) { if (isExplored(e)) { m.fillStyle = e.type === 'crystal' ? '#4fe0ff' : '#58e06a'; m.fillRect(e.x * k - 1.5, e.y * k - 1.5, 3, 3); } continue; }
    if (e.team === 1 && !(e.bld ? isExplored(e) : isVisible(e))) continue;
    m.fillStyle = e.team ? '#ff4040' : '#4da0ff';
    const s = e.bld ? e.size * TILE * k : 3;
    m.fillRect(e.x * k - s / 2, e.y * k - s / 2, s, s);
  }
  m.imageSmoothingEnabled = false; m.drawImage(fogCv, 0, 0, 174, 174);
  if (G.alert && G.time - G.alert.time < 4) { m.strokeStyle = '#ff0'; m.lineWidth = 2; m.beginPath(); m.arc(G.alert.x * k, G.alert.y * k, 5 + (G.time * 12) % 8, 0, 7); m.stroke(); }
  m.strokeStyle = '#fff'; m.lineWidth = 1.5; m.strokeRect(ui.cam.x * k, ui.cam.y * k, viewW() * k, (viewH() - PANEL_H / ui.Z) * k);
}

// ---------- HUD ----------
const COACH = [
  {h: '1. Grow your crew', p: 'Click your <b>Base Core 🏰</b>, then press <kbd>B</kbd> to train a <b>Bitbot 🤖</b>. More Bitbots = more crystals. Pros never stop making them!', ok: () => G.stats.made >= 1 || G.hqs[0].some(h => h.q.length)},
  {h: '2. Power up', p: 'Select a Bitbot, press <kbd>B</kbd> for Build, then <kbd>P</kbd>, and click open ground to place a <b>Power Pod 🔋</b>. Pods raise your supply 🏠 so you can have more units.', ok: () => count0('depot') >= 1},
  {h: '3. Build an Academy', p: 'Select a Bitbot, press <kbd>B</kbd> then <kbd>A</kbd> and place an <b>Academy 🎓</b>. It trains your army.', ok: () => count0('barracks') >= 1},
  {h: '4. Train 4 Zappers', p: 'Click the Academy and press <kbd>Z</kbd> four times. Keep making Bitbots at your Base Core too!', ok: () => count0('trooper') >= 4},
  {h: '5. Make a squad', p: 'Drag a box around your Zappers, then press <kbd>Ctrl</kbd>+<kbd>1</kbd> (or <kbd>Alt</kbd>+<kbd>1</kbd>). Now <kbd>1</kbd> selects them from anywhere. Tap it twice to jump to them.', ok: () => G.stats.groupsSet > 0},
  {h: '6. Get gas', p: 'Build a <b>Gas Pump ⛽</b> (<kbd>B</kbd> then <kbd>G</kbd>) on the green vent near your base. Then select 3 Bitbots and right-click the pump. Gas unlocks stronger units.', ok: () => G.stats.gasGot > 0},
  {h: '7. Attack-move!', p: 'Select your army, press <kbd>A</kbd>, then left-click toward the enemy (top-right corner of the map). Your squad fights everything on the way.', ok: () => G.stats.amoves > 0},
  {h: '8. Win the match!', p: 'Destroy every enemy building. <b>Bonks 🔨</b> smash Zappers, <b>Longshots 🎯</b> pop Bonks, <b>Boomers 💥</b> blast clumps, so spread out! Spend your crystals and never get supply blocked.', ok: () => false},
];
const count0 = t => G.ents.reduce((a, e) => a + (e.team === 0 && e.type === t && !e.dead ? 1 : 0), 0);
let coachI = 0, coachShown = -1;
function updateCoach() {
  const el = $('coach');
  if (ui.coachOff) { el.style.display = 'none'; return; }
  while (coachI < COACH.length - 1 && COACH[coachI].ok()) { coachI++; sfx('done'); }
  if (coachShown === coachI) return;
  coachShown = coachI; el.style.display = 'block';
  el.innerHTML = `<span class="x" id="coachX">hide ✕</span><h3>🎓 Coach: ${COACH[coachI].h}</h3><p>${COACH[coachI].p}</p>`;
  $('coachX').onclick = () => { ui.coachOff = true; el.style.display = 'none'; };
}
function updateHud() {
  const tm = G.teams[0], t = Math.floor(G.time);
  $('rC').textContent = tm.crystal; $('rG').textContent = tm.gas; $('rS').textContent = tm.supUsed + '/' + tm.supMax;
  $('supPill').className = 'pill' + (tm.supUsed >= tm.supMax && tm.supMax < MAXSUP ? ' bad' : '');
  $('rT').textContent = Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
  $('rA').textContent = Math.round(G.stats.actions / Math.max(0.25, G.time / 60));
  const ib = $('idleBtn');
  ib.style.display = G.idleWorkers ? 'block' : 'none'; ib.textContent = '😴 ' + G.idleWorkers + ' idle Bitbot' + (G.idleWorkers > 1 ? 's' : '') + '  [F1]';
  G.sel = G.sel.filter(id => G.byId.has(id));
  const sel = selEnts(), info = $('info');
  let h = '';
  if (!sel.length) h = '<div class="ds" style="font-size:15px;margin-top:8px">Nothing selected. Click a unit or drag a box around your army.</div>';
  else if (sel.length === 1) {
    const e = sel[0], d = e.def;
    h = `<div class="nm">${d.icon} ${d.name}${e.team === 1 ? ' <span style="color:#ff8080;font-size:14px">(enemy)</span>' : ''}</div><div class="ds">${d.desc}</div>`;
    if (e.res) h += `<div class="st">${e.type === 'crystal' ? '💎 ' + e.amount + ' left' : ''}</div>`;
    else {
      h += `<div class="bar"><i style="width:${clamp(e.hp / e.maxHp * 100, 0, 100)}%"></i></div><div class="st">❤️ ${Math.ceil(e.hp)}/${e.maxHp}`;
      if (e.unit && d.dmg) h += ` &nbsp;⚔️ ${dmgOf(e)}${d.bonus ? ' (+' + d.bonus + ' vs armored)' : ''}`;
      if (e.unit) h += ` &nbsp;🛡️ ${(d.armor || 0) + G.teams[e.team].up.armor}`;
      if (e.type === 'trooper' && e.team === 0 && tm.up.rush) h += ` &nbsp;🍭 ${e.rushCd > 0 ? Math.ceil(e.rushCd) + 's' : 'ready (R)'}`;
      h += '</div>';
      if (e.bld && e.team === 0) {
        if (!e.built) h += `<div class="st">🏗️ Building… ${Math.floor(e.prog * 100)}%</div>`;
        else if (e.q.length) h += '<div class="qrow">' + e.q.map((k, i) => `<div class="qi" data-b="${e.id}" data-i="${i}" title="Click to cancel">${DEFS[k].icon}${i === 0 ? `<b style="width:${e.trainT / DEFS[k].time * 100}%"></b>` : ''}</div>`).join('') + '<span class="ds">click to cancel</span></div>';
        else if (d.trains) h += '<div class="st" style="color:#ffd34d">💤 Not making anything. Use the buttons on the right. Right-click the ground to set a rally point.</div>';
      }
    }
  } else {
    const c = {}; for (const e of sel) c[e.type] = (c[e.type] || 0) + 1;
    h = `<div class="nm">${sel.length} selected</div>` + Object.keys(c).map(k => `<span class="grp">${DEFS[k].icon} ${DEFS[k].name} ×${c[k]}</span>`).join('');
  }
  if (h !== ui.infoHtml) { ui.infoHtml = h; info.innerHTML = h; }
  refreshCard(); updateCoach();
}

// ---------- screens ----------
function stars(n) { return '★'.repeat(n) + '☆'.repeat(5 - n); }
function showEnd() {
  const s = G.stats, min = Math.max(0.5, G.time / 60), apm = Math.round(s.actions / min), avg = s.samples ? Math.round(s.unspent / s.samples) : 0;
  const g = (v, th) => 5 - th.filter(t => v > t).length; // lower is better
  const rows = [
    ['🖱 Speed (APM)', apm, 1 + [15, 30, 50, 80].filter(t => apm >= t).length, 'Use hotkeys instead of clicking buttons to get faster.'],
    ['🏠 Supply blocked', Math.round(s.blockedT) + 's', g(s.blockedT, [5, 20, 45, 90]), 'Build Power Pods before you hit the supply limit.'],
    ['😴 Idle Bitbots', Math.round(s.idleT) + 's', g(s.idleT, [10, 40, 90, 180]), 'Press F1 to find idle Bitbots and put them to work.'],
    ['💎 Unspent crystals', avg, g(avg, [150, 300, 500, 900]), 'Crystals in the bank win nothing. Build more Academies and spend!'],
  ];
  const worst = rows.slice().sort((a, b) => a[2] - b[2])[0];
  const t = Math.floor(G.time);
  $('endPanel').innerHTML = `<h1>${G.over.win ? '🏆 Victory!' : '💥 Defeat'}</h1>
    <h2>${G.over.win ? 'You crushed the ' + AI_CFG[G.diff].label + ' enemy' : 'Your base was destroyed'} in ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}. Units made: ${s.made} · lost: ${s.lost} · enemies popped: ${s.kills}</h2>
    <div style="font-size:18px;font-weight:800;color:#ffd34d">Commander report card</div>
    <div class="stats">${rows.map(r => `<div>${r[0]}</div><div><b>${r[1]}</b></div><div class="s">${stars(r[2])}</div>`).join('')}</div>
    <div id="protip">💡 Next time: ${worst[3]}</div>
    <button class="big" id="again">Play again</button>`;
  $('end').style.display = 'grid';
  $('again').onclick = () => { $('end').style.display = 'none'; $('menu').style.display = 'grid'; };
  sfx(G.over.win ? 'done' : 'boom');
}
function startGame(diff) {
  if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* no sound */ } }
  newGame(diff);
  buildTerrain();
  ui.cmd = null; ui.menu = null; ui.paused = false; ui.cardSig = '?'; ui.infoHtml = ''; ui.coachOff = false; ui.endShown = false; coachI = 0; coachShown = -1; acc = 0;
  $('menu').style.display = 'none';
  const hq = G.hqs[0][0] || G.ents.find(e => e.team === 0 && e.type === 'hq');
  centerOn(hq.x, hq.y);
  toast('Welcome, Commander! Follow the Coach in the top-left corner.');
}
document.querySelectorAll('.diff').forEach(b => b.addEventListener('click', () => startGame(b.dataset.d)));

function frame(ts) {
  const dt = Math.min(0.1, (ts - last) / 1000 || 0); last = ts; ui.frame++;
  if (G) {
    if (!G.over && !ui.paused) { acc += dt; let n = 0; while (acc >= STEP && n++ < 5) { tick(STEP); acc -= STEP; } if (acc > STEP) acc = 0; }
    updateCamera(dt);
    render();
    if (ui.frame % 5 === 0) { updateHud(); drawMini(); }
    if (G.over && !ui.endShown) { ui.endShown = true; showEnd(); }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
