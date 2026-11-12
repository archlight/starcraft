'use strict';
// ===== Pocket Commanders: simulation core =====
const TILE = 32, W = 64, H = 64, MAXSUP = 100, STEP = 1 / 30;

const DEFS = {
  // ---- units ----
  worker:  {kind:'unit', name:'Bitbot',   icon:'🤖', key:'B', hp:40,  speed:78, r:8,  cost:[50,0],    supply:1, time:10, dmg:4,  cd:1.0, sight:6, worker:true,
            desc:'Gathers crystals and gas, and builds everything.'},
  trooper: {kind:'unit', name:'Zapper',   icon:'⚡', key:'Z', hp:45,  speed:80, r:9,  cost:[50,0],    supply:1, time:14, dmg:6,  range:120, cd:0.75, sight:8,
            desc:'Cheap ranged fighter. Great in groups. Weak to Bonks and Boomers.'},
  brute:   {kind:'unit', name:'Bonk',     icon:'🔨', key:'B', hp:120, speed:92, r:12, cost:[75,25],   supply:2, time:18, dmg:12, cd:0.9, sight:7, armor:1, armored:true,
            desc:'Tough melee bruiser. Smashes Zappers. Weak to Longshots.'},
  lancer:  {kind:'unit', name:'Longshot', icon:'🎯', key:'L', hp:50,  speed:70, r:9,  cost:[75,50],   supply:2, time:20, dmg:14, bonus:14, range:200, cd:1.6, sight:9,
            desc:'Long range. Double damage to armored targets (Bonks, Boomers, buildings).'},
  medic:   {kind:'unit', name:'Patch',    icon:'💚', key:'P', hp:55,  speed:78, r:9,  cost:[50,25],   supply:1, time:16, heal:5, range:70, cd:0.5, sight:8,
            desc:'Heals nearby friends. Cannot attack.'},
  tank:    {kind:'unit', name:'Boomer',   icon:'💥', key:'B', hp:150, speed:58, r:13, cost:[150,100], supply:3, time:30, dmg:22, splash:38, range:180, cd:2.2, sight:9, armor:1, armored:true,
            desc:'Slow cannon with splash damage. Blasts clumped-up armies. Spread out!'},
  // ---- buildings ----
  hq:      {kind:'bld', name:'Base Core',   icon:'🏰', key:'C', size:4, hp:1200, cost:[400,0],  time:70, supplyGive:10, sight:9, trains:['worker'], armored:true,
            desc:'Trains Bitbots. Bitbots drop off crystals and gas here.'},
  depot:   {kind:'bld', name:'Power Pod',   icon:'🔋', key:'P', size:2, hp:350,  cost:[100,0],  time:20, supplyGive:8, sight:5, armored:true,
            desc:'+8 supply. More supply = bigger army.'},
  barracks:{kind:'bld', name:'Academy',     icon:'🎓', key:'A', size:3, hp:700,  cost:[150,0],  time:35, sight:6, trains:['trooper','brute','lancer','medic'], armored:true,
            desc:'Trains Zappers, Bonks, Longshots and Patches.'},
  refinery:{kind:'bld', name:'Gas Pump',    icon:'⛽', key:'G', size:2, hp:400,  cost:[75,0],   time:20, sight:5, armored:true,
            desc:'Build on a green vent. Send 3 Bitbots to collect gas.'},
  factory: {kind:'bld', name:'Workshop',    icon:'🏭', key:'W', size:3, hp:800,  cost:[200,100],time:45, sight:6, trains:['tank'], req:'barracks', armored:true,
            desc:'Builds Boomers.'},
  lab:     {kind:'bld', name:'Lab',         icon:'🧪', key:'L', size:2, hp:450,  cost:[100,50], time:30, sight:5, trains:['up_w','up_a','up_r'], req:'barracks', armored:true,
            desc:'Researches upgrades for your army.'},
  turret:  {kind:'bld', name:'Guard Tower', icon:'🗼', key:'T', size:2, hp:320,  cost:[100,0],  time:25, sight:8, dmg:9, range:170, cd:0.8, req:'barracks', armored:true,
            desc:'Shoots enemies that come close.'},
  // ---- tech ----
  up_w:    {kind:'tech', name:'Sharper Zaps', icon:'🗡️', key:'W', cost:[100,100], time:50, up:'weapons', max:2, desc:'All units deal more damage.'},
  up_a:    {kind:'tech', name:'Thicker Shells', icon:'🛡️', key:'A', cost:[100,100], time:50, up:'armor', max:2, desc:'All units take less damage.'},
  up_r:    {kind:'tech', name:'Sugar Rush', icon:'🍭', key:'R', cost:[100,100], time:40, up:'rush', max:1, desc:'Zappers get the Sugar Rush ability (R): move and shoot faster for 6 seconds.'},
  // ---- resources ----
  crystal: {kind:'res', name:'Crystals', icon:'💎', size:1, desc:'Right-click with Bitbots to gather.'},
  vent:    {kind:'res', name:'Gas Vent', icon:'🟢', size:2, desc:'Build a Gas Pump here.'},
};
const BUILD_MENU = ['depot', 'barracks', 'refinery', 'turret', 'factory', 'lab', 'hq'];

let G = null;
const tl = v => Math.floor(v / TILE);
const idx = (x, y) => y * W + x;
const inMap = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
const blocked = (x, y) => !inMap(x, y) || G.block[idx(x, y)] !== 0;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

function rng(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ---------- setup ----------
function mkTeam() {
  return {crystal: 50, gas: 0, supUsed: 0, supMax: 0, up: {weapons: 0, armor: 0, rush: 0}, pending: {}, threat: null};
}

function newGame(diff) {
  G = {
    diff, time: 0, tick: 0, ents: [], byId: new Map(), nextId: 1,
    block: new Uint8Array(W * H), terrain: new Uint8Array(W * H), vis: new Uint8Array(W * H), visDirty: true,
    proj: [], fx: [], texts: [], over: null, sel: [], groups: {}, alert: null, lastAlertT: -99,
    teams: [mkTeam(), mkTeam()], hqs: [[], []], cells: [], sites: [], idleWorkers: 0, anyDead: false,
    ai: {t: 2, wave: 0, squad: new Set(), attacking: false},
    stats: {actions: 0, blockedT: 0, idleT: 0, unspent: 0, samples: 0, gathered: 0, gasGot: 0, made: 0, lost: 0, kills: 0, amoves: 0, groupsSet: 0},
  };
  for (let i = 0; i < (W * TILE / 64) * (H * TILE / 64); i++) G.cells.push([]);
  genMap();
  for (const team of [0, 1]) {
    const s = G.sites[team ? 3 : 0];
    const hq = placeBuilding('hq', team, s.cx - 2, s.cy - 2, true);
    onBuilt(hq, true);
    for (let i = 0; i < 5; i++) {
      const p = freeSpotNear(hq, hq.x + (i - 2) * 30, team ? hq.y + 999 : hq.y - 999);
      const u = spawnUnit('worker', team, p.x + (i - 2) * 3, p.y);
      const n = findNode(hq.x, hq.y);
      if (n) u.order = {t: 'harvest', target: n.id};
    }
  }
  recalcSupply(); updateVis();
  return G;
}

const SITE_DEFS = [
  {cx: 9, cy: 54, a0: 100, a1: 205, va: 55},
  {cx: 9, cy: 37, a0: 120, a1: 230, va: 290},
  {cx: 29, cy: 56, a0: 40, a1: 140, va: 180},
];

function genMap() {
  const all = [];
  for (const s of SITE_DEFS) all.push({...s});
  for (const s of SITE_DEFS) all.push({cx: W - 1 - s.cx, cy: H - 1 - s.cy, a0: s.a0 + 180, a1: s.a1 + 180, va: s.va + 180});
  G.sites = all;
  for (let seed = 7; seed < 40; seed++) {
    G.terrain.fill(0);
    const rnd = rng(seed * 977);
    for (let i = 0; i < 15; i++) {
      const bx = 3 + rnd() * (W - 6), by = 3 + rnd() * (H - 6), rad = 1.4 + rnd() * 2.4;
      if (all.some(s => Math.hypot(s.cx - bx, s.cy - by) < 10.5 + rad)) continue;
      for (let y = Math.floor(by - rad); y <= by + rad; y++) for (let x = Math.floor(bx - rad); x <= bx + rad; x++) {
        if (!inMap(x, y) || Math.hypot(x - bx, y - by) > rad || rnd() > 0.9) continue;
        G.terrain[idx(x, y)] = 1; G.terrain[idx(W - 1 - x, H - 1 - y)] = 1;
      }
    }
    G.block.set(G.terrain);
    const a = all[0], b = all[3];
    const p = findPath(a.cx + 3, a.cy - 3, b.cx - 3, b.cy + 3);
    if (p && p.length) {
      const l = p[p.length - 1];
      if (tl(l.x) === b.cx - 3 && tl(l.y) === b.cy + 3) break;
    }
  }
  G.block.set(G.terrain);
  for (const s of all) {
    const R = s.cy > H - 9 || s.cy < 8 ? 6 : 6.5;
    for (let i = 0; i < 8; i++) {
      const a = (s.a0 + (s.a1 - s.a0) * i / 7) * Math.PI / 180;
      const x = Math.round(s.cx + Math.cos(a) * R), y = Math.round(s.cy + Math.sin(a) * R);
      if (!blocked(x, y)) addRes('crystal', x, y, 1200);
    }
    const va = s.va * Math.PI / 180;
    const vx = Math.round(s.cx + Math.cos(va) * 6.5 - 0.5), vy = Math.round(s.cy + Math.sin(va) * 6.5 - 0.5);
    if (!blocked(vx, vy) && !blocked(vx + 1, vy) && !blocked(vx, vy + 1) && !blocked(vx + 1, vy + 1)) addRes('vent', vx, vy, 1e9);
  }
}

// ---------- entities ----------
function addEnt(e) { e.id = G.nextId++; G.ents.push(e); G.byId.set(e.id, e); return e; }
function setBlock(x0, y0, s, v) { for (let y = y0; y < y0 + s; y++) for (let x = x0; x < x0 + s; x++) if (inMap(x, y)) G.block[idx(x, y)] = v; }

function spawnUnit(type, team, x, y) {
  const d = DEFS[type];
  if (team === 0 && G.time > 0) G.stats.made++;
  return addEnt({type, def: d, team, x, y, lx: x, ly: y, hp: d.hp, maxHp: d.hp, r: d.r, dir: team ? Math.PI / 2 : -Math.PI / 2, cd: 0,
    order: {t: 'idle'}, queue: [], path: null, pi: 0, stall: 0, carry: 0, carryKind: 0, rushT: 0, rushCd: 0, tgt: 0, rp: 0,
    scanT: Math.random() * 0.3, unit: true});
}
function addRes(type, x, y, amount) {
  const d = DEFS[type], s = d.size;
  setBlock(x, y, s, 2);
  return addEnt({type, def: d, team: -1, tx: x, ty: y, size: s, x: (x + s / 2) * TILE, y: (y + s / 2) * TILE, r: s * TILE / 2, amount, hp: 1, maxHp: 1, res: true, covered: 0});
}
function placeBuilding(type, team, x, y, built) {
  const d = DEFS[type], s = d.size;
  const e = addEnt({type, def: d, team, tx: x, ty: y, size: s, x: (x + s / 2) * TILE, y: (y + s / 2) * TILE, r: s * TILE / 2,
    hp: built ? d.hp : d.hp * 0.1, maxHp: d.hp, built: !!built, prog: built ? 1 : 0, q: [], trainT: 0, rally: null, cd: 0, tgt: 0, scanT: 0, bld: true});
  if (type === 'refinery') {
    const v = G.ents.find(v => v.type === 'vent' && v.tx === x && v.ty === y && !v.dead);
    if (v) { v.covered = e.id; e.vent = v.id; }
  }
  setBlock(x, y, s, 2);
  for (const u of G.ents) if (u.unit && !u.dead && tl(u.x) >= x && tl(u.x) < x + s && tl(u.y) >= y && tl(u.y) < y + s) {
    const p = freeSpotNear(e, u.x, u.y); u.x = p.x; u.y = p.y; u.path = null;
  }
  return e;
}
function onBuilt(b, silent) {
  if (b.type === 'hq') { const n = findNode(b.x, b.y); if (n) b.rally = {x: n.x, y: n.y, target: n.id}; }
  if (b.team === 0 && !silent) { toast('✅ ' + b.def.name + ' is ready!'); sfx('done'); }
}
function kill(e, by) {
  if (e.dead) return;
  e.dead = true; G.byId.delete(e.id); G.anyDead = true;
  if (e.bld || e.res) {
    setBlock(e.tx, e.ty, e.size, 0);
    if (e.type === 'refinery') { const v = G.byId.get(e.vent); if (v) { v.covered = 0; setBlock(v.tx, v.ty, 2, 2); } }
    if (e.bld) for (const k of e.q) if (DEFS[k].kind === 'tech') G.teams[e.team].pending[k]--;
  }
  if (e.unit) { cancelOrders(e); if (e.team === 0) G.stats.lost++; else if (e.team === 1) G.stats.kills++; }
  if (!e.res) { G.fx.push({k: 'pop', x: e.x, y: e.y, t: 0.45, T: 0.45, r: e.r, c: e.team ? '#ff6b6b' : '#5aa9ff'}); sfx(e.bld ? 'boom' : 'pop', e); }
}

function edgeDist(e, t) {
  if (t.unit) return Math.max(0, Math.hypot(t.x - e.x, t.y - e.y) - t.r);
  const h = t.size * TILE / 2;
  return Math.hypot(Math.max(Math.abs(e.x - t.x) - h, 0), Math.max(Math.abs(e.y - t.y) - h, 0));
}
function hasBuilt(team, type) { return G.ents.some(e => e.team === team && e.type === type && e.built && !e.dead); }
function refund(team, type, f) { const d = DEFS[type], tm = G.teams[team]; tm.crystal += Math.round(d.cost[0] * (f || 1)); tm.gas += Math.round(d.cost[1] * (f || 1)); }

// ---------- spatial hash ----------
const CELL = 64, CW = W * TILE / CELL, CH = H * TILE / CELL;
let _q = 0;
function rebuildHash() {
  for (const c of G.cells) c.length = 0;
  G.hqs[0].length = 0; G.hqs[1].length = 0;
  for (const e of G.ents) {
    if (e.dead || e.team < 0) continue;
    if (e.unit) G.cells[clamp(Math.floor(e.y / CELL), 0, CH - 1) * CW + clamp(Math.floor(e.x / CELL), 0, CW - 1)].push(e);
    else {
      if (e.type === 'hq' && e.built) G.hqs[e.team].push(e);
      const h = e.size * TILE / 2;
      const x0 = Math.floor((e.x - h) / CELL), x1 = Math.floor((e.x + h - 1) / CELL), y0 = Math.floor((e.y - h) / CELL), y1 = Math.floor((e.y + h - 1) / CELL);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) G.cells[y * CW + x].push(e);
    }
  }
}
function forNear(x, y, rad, fn) {
  const q = ++_q;
  const x0 = clamp(Math.floor((x - rad) / CELL), 0, CW - 1), x1 = clamp(Math.floor((x + rad) / CELL), 0, CW - 1);
  const y0 = clamp(Math.floor((y - rad) / CELL), 0, CH - 1), y1 = clamp(Math.floor((y + rad) / CELL), 0, CH - 1);
  for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
    const c = G.cells[cy * CW + cx];
    for (let i = 0; i < c.length; i++) { const e = c[i]; if (e._q === q || e.dead) continue; e._q = q; fn(e); }
  }
}

// ---------- pathfinding ----------
const _g = new Float32Array(W * H), _par = new Int32Array(W * H), _st = new Uint32Array(W * H), _cl = new Uint32Array(W * H);
let _gen = 0;
const DX = [1, -1, 0, 0, 1, 1, -1, -1], DY = [0, 0, 1, -1, 1, -1, 1, -1];

function nearestFree(gx, gy, sx, sy) {
  gx = clamp(gx, 0, W - 1); gy = clamp(gy, 0, H - 1);
  if (!blocked(gx, gy)) return [gx, gy];
  for (let r = 1; r < 16; r++) {
    let best = null, bd = 1e9;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x = gx + dx, y = gy + dy;
      if (blocked(x, y)) continue;
      const d = Math.hypot(dx, dy) * 10 + Math.hypot(x - sx, y - sy);
      if (d < bd) { bd = d; best = [x, y]; }
    }
    if (best) return best;
  }
  return null;
}

function findPath(sx, sy, gx, gy, rect) {
  if (!inMap(sx, sy)) return null;
  if (!rect) { const nf = nearestFree(gx, gy, sx, sy); if (!nf) return null; gx = nf[0]; gy = nf[1]; }
  const gen = ++_gen, hn = [], hf = [];
  const h = rect
    ? (x, y) => { const dx = Math.max(rect.x0 - 1 - x, 0, x - rect.x1 - 1), dy = Math.max(rect.y0 - 1 - y, 0, y - rect.y1 - 1); return Math.max(dx, dy) + 0.414 * Math.min(dx, dy); }
    : (x, y) => { const dx = Math.abs(x - gx), dy = Math.abs(y - gy); return Math.max(dx, dy) + 0.414 * Math.min(dx, dy); };
  const push = (n, f) => {
    let i = hn.length; hn.push(n); hf.push(f);
    while (i > 0) { const p = (i - 1) >> 1; if (hf[p] <= f) break; hn[i] = hn[p]; hf[i] = hf[p]; i = p; }
    hn[i] = n; hf[i] = f;
  };
  const pop = () => {
    const top = hn[0], n = hn.pop(), f = hf.pop(), len = hn.length;
    if (len) {
      let i = 0;
      for (;;) {
        let c = i * 2 + 1; if (c >= len) break;
        if (c + 1 < len && hf[c + 1] < hf[c]) c++;
        if (hf[c] >= f) break;
        hn[i] = hn[c]; hf[i] = hf[c]; i = c;
      }
      hn[i] = n; hf[i] = f;
    }
    return top;
  };
  const s = idx(sx, sy); _g[s] = 0; _par[s] = -1; _st[s] = gen;
  let best = s, bestH = h(sx, sy), found = -1, iter = 0;
  push(s, bestH);
  while (hn.length && iter++ < 7000) {
    const c = pop(); if (_cl[c] === gen) continue; _cl[c] = gen;
    const cx = c % W, cy = (c - cx) / W, hc = h(cx, cy);
    if (hc === 0) { found = c; break; }
    if (hc < bestH) { bestH = hc; best = c; }
    for (let k = 0; k < 8; k++) {
      const nx = cx + DX[k], ny = cy + DY[k];
      if (blocked(nx, ny)) continue;
      if (k >= 4 && (blocked(nx, cy) || blocked(cx, ny))) continue;
      const n = idx(nx, ny); if (_cl[n] === gen) continue;
      const ng = _g[c] + (k < 4 ? 1 : 1.414);
      if (_st[n] !== gen || ng < _g[n]) { _g[n] = ng; _par[n] = c; _st[n] = gen; push(n, ng + h(nx, ny)); }
    }
  }
  let end = found >= 0 ? found : best;
  const pts = [];
  while (end !== s && end >= 0) { pts.push({x: (end % W + 0.5) * TILE, y: (Math.floor(end / W) + 0.5) * TILE}); end = _par[end]; }
  return pts.reverse();
}

function los(x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0, d = Math.hypot(dx, dy);
  if (d < 1) return true;
  const n = Math.ceil(d / 10), px = -dy / d * 8, py = dx / d * 8;
  for (let i = 0; i <= n; i++) {
    const x = x0 + dx * i / n, y = y0 + dy * i / n;
    if (blocked(tl(x), tl(y)) || blocked(tl(x + px), tl(y + py)) || blocked(tl(x - px), tl(y - py))) return false;
  }
  return true;
}

function setDest(e, x, y, target) {
  x = clamp(x, 4, W * TILE - 4); y = clamp(y, 4, H * TILE - 4);
  let rect = null;
  if (target && !target.unit) rect = {x0: target.tx, y0: target.ty, x1: target.tx + target.size - 1, y1: target.ty + target.size - 1};
  const p = findPath(tl(e.x), tl(e.y), tl(x), tl(y), rect);
  if (!p) { e.path = null; return false; }
  if (!rect && p.length) { const l = p[p.length - 1]; if (tl(x) === tl(l.x) && tl(y) === tl(l.y)) { l.x = x; l.y = y; } }
  const out = [];
  let cx = e.x, cy = e.y, i = 0;
  while (i < p.length) {
    let j = Math.min(p.length - 1, i + 14);
    while (j > i && !los(cx, cy, p[j].x, p[j].y)) j--;
    out.push(p[j]); cx = p[j].x; cy = p[j].y; i = j + 1;
  }
  e.path = out.length ? out : null; e.pi = 0; e.stall = 0;
  return true;
}

// ---------- movement ----------
function speedOf(e) { return e.def.speed * (e.rushT > 0 ? 1.4 : 1); }
function stepMove(e, dt) {
  if (!e.path) return true;
  const mv = Math.hypot(e.x - e.lx, e.y - e.ly); e.lx = e.x; e.ly = e.y;
  const sp = speedOf(e) * dt;
  if (mv < sp * 0.3) e.stall += dt; else e.stall = 0;
  const last = e.pi === e.path.length - 1, wp = e.path[e.pi];
  const dx = wp.x - e.x, dy = wp.y - e.y, d = Math.hypot(dx, dy);
  if (last && e.stall > 0.35 && d < 64) { e.path = null; return true; }
  if (e.stall > 1.5) { e.stall = 0; e.path = null; return false; }
  if (d <= sp) { e.x = wp.x; e.y = wp.y; e.pi++; if (e.pi >= e.path.length) { e.path = null; return true; } return false; }
  const nx = e.x + dx / d * sp, ny = e.y + dy / d * sp;
  if (blocked(tl(nx), tl(ny)) && !blocked(tl(e.x), tl(e.y))) { e.path = null; return false; }
  e.x = nx; e.y = ny; e.dir = Math.atan2(dy, dx);
  return false;
}
function chase(e, t, dt) {
  e.rp -= dt;
  if (e.rp <= 0 && (!e.path || Math.hypot(t.x - e.pgx, t.y - e.pgy) > 20)) {
    setDest(e, t.x, t.y, t); e.pgx = t.x; e.pgy = t.y; e.rp = 0.3 + Math.random() * 0.2;
  }
  stepMove(e, dt);
}
const isGhost = e => { const t = e.order.t; return t === 'harvest' || t === 'return' || t === 'build'; };
function separate() {
  for (const e of G.ents) {
    if (!e.unit || e.dead || isGhost(e)) continue;
    let px = 0, py = 0;
    forNear(e.x, e.y, 30, o => {
      if (o === e || !o.unit || isGhost(o)) return;
      const dx = e.x - o.x, dy = e.y - o.y, d = Math.hypot(dx, dy), m = e.r + o.r;
      if (d < m) {
        if (d < 0.01) { const a = Math.random() * 6.28; px += Math.cos(a); py += Math.sin(a); }
        else { const f = (m - d) / d * 0.5; px += dx * f; py += dy * f; }
      }
    });
    if (px || py) { const nx = e.x + px, ny = e.y + py; if (!blocked(tl(nx), tl(ny))) { e.x = nx; e.y = ny; } }
  }
}

// ---------- orders ----------
function cancelOrders(e) {
  for (const o of [e.order, ...e.queue]) if (o.t === 'build' && !o.started) { refund(e.team, o.type); o.started = true; }
  e.queue = [];
}
function giveOrder(e, order, queued) {
  if (queued && e.order.t !== 'idle') { e.queue.push(order); return; }
  cancelOrders(e);
  e.order = order; e.path = null; e.tgt = 0; e.rp = 0;
}
function finish(e) { e.path = null; e.tgt = 0; e.rp = 0; e.order = e.queue.length ? e.queue.shift() : {t: 'idle'}; }

function canPlace(type, x, y, team) {
  const s = DEFS[type].size;
  if (type === 'refinery') return G.ents.some(v => v.type === 'vent' && v.tx === x && v.ty === y && !v.covered && !v.dead && (team !== 0 || G.vis[idx(x, y)] > 0));
  for (let yy = y; yy < y + s; yy++) for (let xx = x; xx < x + s; xx++) {
    if (!inMap(xx, yy) || G.block[idx(xx, yy)] !== 0) return false;
    if (team === 0 && G.vis[idx(xx, yy)] === 0) return false;
  }
  return true;
}
function buildError(team, type) {
  const d = DEFS[type], tm = G.teams[team];
  if (d.req && !hasBuilt(team, d.req)) return 'You need a ' + DEFS[d.req].name + ' first!';
  if (tm.crystal < d.cost[0]) return 'Not enough crystals! 💎';
  if (tm.gas < d.cost[1]) return 'Not enough gas! ⛽';
  return null;
}
function orderBuild(e, type, x, y, queued) {
  const err = buildError(e.team, type); if (err) return err;
  if (!canPlace(type, x, y, e.team)) return "Can't build there!";
  const d = DEFS[type], tm = G.teams[e.team];
  const resume = e.order.t === 'harvest' ? e.order.target : e.order.t === 'return' ? e.order.node : e.order.t === 'build' ? e.order.resume : 0;
  tm.crystal -= d.cost[0]; tm.gas -= d.cost[1];
  giveOrder(e, {t: 'build', type, tx: x, ty: y, resume}, queued);
  return null;
}

function trainError(b, key) {
  const d = DEFS[key], tm = G.teams[b.team];
  if (!b.built) return 'Still under construction!';
  if (b.q.length >= 5) return 'Queue is full!';
  if (d.kind === 'tech' && tm.up[d.up] + (tm.pending[key] || 0) >= d.max) return 'Already researched!';
  if (tm.crystal < d.cost[0]) return 'Not enough crystals! 💎';
  if (tm.gas < d.cost[1]) return 'Not enough gas! ⛽ Build a Gas Pump.';
  if (d.kind === 'unit' && tm.supUsed + d.supply > tm.supMax) return tm.supMax >= MAXSUP ? 'Army is at max size!' : 'Supply blocked! Build a Power Pod 🔋';
  return null;
}
function queueTrain(b, key) {
  const err = trainError(b, key); if (err) return err;
  const d = DEFS[key], tm = G.teams[b.team];
  tm.crystal -= d.cost[0]; tm.gas -= d.cost[1];
  b.q.push(key);
  if (d.kind === 'tech') tm.pending[key] = (tm.pending[key] || 0) + 1;
  recalcSupply();
  return null;
}
function cancelTrain(b, i) {
  const k = b.q[i]; if (!k) return;
  b.q.splice(i, 1); if (i === 0) b.trainT = 0;
  refund(b.team, k);
  if (DEFS[k].kind === 'tech') G.teams[b.team].pending[k]--;
  recalcSupply();
}
function useRush(e) {
  if (e.type !== 'trooper' || !G.teams[e.team].up.rush || e.rushCd > 0) return false;
  e.rushT = 6; e.rushCd = 25; return true;
}

function freeSpotNear(b, px, py) {
  for (let r = 1; r < 6; r++) {
    let best = null, bd = 1e9;
    for (let y = b.ty - r; y < b.ty + b.size + r; y++) for (let x = b.tx - r; x < b.tx + b.size + r; x++) {
      if (blocked(x, y)) continue;
      const cx = (x + 0.5) * TILE, cy = (y + 0.5) * TILE, d = Math.hypot(cx - px, cy - py);
      if (d < bd) { bd = d; best = {x: cx, y: cy}; }
    }
    if (best) return best;
  }
  return {x: b.x, y: b.y};
}
function findNode(x, y, exclude, freeOnly) {
  let best = null, bd = 1e9;
  for (const n of G.ents) {
    if (n.type !== 'crystal' || n.dead || n === exclude || n.amount <= 0) continue;
    const busy = G.time - (n.minerT || -9) < 0.15;
    if (freeOnly && busy) continue;
    const d = Math.hypot(n.x - x, n.y - y) + (busy ? 60 : 0);
    if (d < bd && d < (freeOnly ? 7 : 13) * TILE) { bd = d; best = n; }
  }
  return best;
}
function nearestHQ(e) {
  let best = null, bd = 1e9;
  for (const h of G.hqs[e.team]) { const d = Math.hypot(h.x - e.x, h.y - e.y); if (d < bd) { bd = d; best = h; } }
  return best;
}

// ---------- combat ----------
function rangeOf(e) { return e.def.range || e.r + 14; }
function dmgOf(e) { return e.def.dmg + (e.unit ? G.teams[e.team].up.weapons * Math.max(1, Math.round(e.def.dmg * 0.15)) : 0); }
function findTarget(e, rad) {
  let best = null, bs = 1e9;
  forNear(e.x, e.y, rad + 70, c => {
    if (c.team === e.team) return;
    const d = edgeDist(e, c); if (d > rad) return;
    const s = d + (c.bld ? (c.def.dmg ? 0 : 160) : 0) + (c.def.worker ? 40 : 0) + (c.def.heal ? 20 : 0);
    if (s < bs) { bs = s; best = c; }
  });
  return best;
}
function findHeal(e, rad) {
  let best = null, bs = 1e9;
  forNear(e.x, e.y, rad, c => {
    if (c.team !== e.team || !c.unit || c === e || c.hp >= c.maxHp) return;
    const d = edgeDist(e, c); if (d < bs && d <= rad) { bs = d; best = c; }
  });
  return best;
}
function fire(e, t) {
  const d = e.def;
  if (d.heal) { t.hp = Math.min(t.maxHp, t.hp + d.heal); G.fx.push({k: 'beam', x: e.x, y: e.y, x2: t.x, y2: t.y, t: 0.18, T: 0.18, c: '#8f8'}); return; }
  if (d.range) {
    G.proj.push({x: e.x, y: e.y, tid: t.id, gx: t.x, gy: t.y, dmg: dmgOf(e), bonus: d.bonus || 0, splash: d.splash || 0, team: e.team, src: e.id, sp: d.splash ? 300 : 520, big: e.type === 'tank' || e.type === 'lancer'});
    sfx(d.splash ? 'thump' : 'zap', e);
  } else { hit(t, dmgOf(e), 0, e); G.fx.push({k: 'boom', x: t.x, y: t.y, t: 0.12, T: 0.12, r: 7, c: '#fff'}); sfx('bonk', e); }
}
function hit(t, dmg, bonus, src) {
  if (t.dead || t.res) return;
  const armor = (t.def.armor || 0) + (t.unit ? G.teams[t.team].up.armor : 0);
  t.hp -= Math.max(1, dmg + (t.def.armored ? bonus : 0) - armor);
  t.hitT = G.time;
  if (src && !src.dead && t.unit && t.order.t === 'idle' && !t.tgt) t.tgt = src.id;
  if (t.team === 0) alertAttack(t); else G.teams[1].threat = {x: t.x, y: t.y, time: G.time};
  if (t.hp <= 0) kill(t, src);
}
function alertAttack(t) {
  G.alert = {x: t.x, y: t.y, time: G.time};
  if (G.time - G.lastAlertT > 7) {
    G.lastAlertT = G.time;
    const onScreen = typeof isOnScreen === 'function' && isOnScreen(t.x, t.y);
    if (!onScreen) { toast('⚠️ Your ' + t.def.name + ' is under attack! Press Space to look', 'bad'); sfx('alert'); }
  }
}
function autoFight(e, dt, noMove) {
  const d = e.def;
  if ((!d.dmg && !d.heal) || d.worker) return false;
  let t = e.tgt && G.byId.get(e.tgt);
  e.scanT -= dt;
  if (e.scanT <= 0) {
    e.scanT = 0.3;
    const rad = noMove ? rangeOf(e) : d.sight * TILE;
    const n = d.heal ? findHeal(e, rad) : findTarget(e, rad);
    if (d.heal) t = n;
    else if (n && (!t || noMove || edgeDist(e, t) > rangeOf(e))) t = n;
    e.tgt = t ? t.id : 0;
  }
  if (!t) return false;
  if (d.heal && t.hp >= t.maxHp) { e.tgt = 0; return false; }
  const dist = edgeDist(e, t);
  if (dist > d.sight * TILE * 1.6) { e.tgt = 0; return false; }
  if (dist <= rangeOf(e)) {
    e.path = null; e.dir = Math.atan2(t.y - e.y, t.x - e.x);
    if (e.cd <= 0) { fire(e, t); e.cd = d.cd * (e.rushT > 0 ? 0.6 : 1); }
  } else if (!noMove) chase(e, t, dt);
  else { e.tgt = 0; return false; }
  return true;
}

// ---------- per-entity update ----------
function updateUnit(e, dt) {
  e.cd -= dt; if (e.rushT > 0) e.rushT -= dt; if (e.rushCd > 0) e.rushCd -= dt;
  const o = e.order, tm = G.teams[e.team];
  switch (o.t) {
    case 'idle':
      if (e.queue.length) { finish(e); break; }
      if (!autoFight(e, dt, false)) e.path = null;
      break;
    case 'hold': autoFight(e, dt, true); break;
    case 'move':
      if (!e.path && !setDest(e, o.x, o.y)) { finish(e); break; }
      if (stepMove(e, dt)) finish(e);
      break;
    case 'amove':
      if (autoFight(e, dt, false)) { o.eng = true; break; }
      if (o.eng) { o.eng = false; e.path = null; }
      if (!e.path && !setDest(e, o.x, o.y)) { finish(e); break; }
      if (stepMove(e, dt)) finish(e);
      break;
    case 'attack': {
      const t = G.byId.get(o.target);
      if (!t || t.team === e.team) { finish(e); break; }
      if (edgeDist(e, t) <= rangeOf(e)) {
        e.path = null; e.dir = Math.atan2(t.y - e.y, t.x - e.x);
        if (e.cd <= 0 && e.def.dmg) { fire(e, t); e.cd = e.def.cd * (e.rushT > 0 ? 0.6 : 1); }
      } else chase(e, t, dt);
      break;
    }
    case 'harvest': {
      let n = G.byId.get(o.target);
      if (e.carry > 0 && !(o.mt > 0)) { e.order = {t: 'return', node: o.target}; e.path = null; e.rp = 0; break; }
      if (!n) { n = findNode(e.x, e.y); if (!n) { finish(e); break; } o.target = n.id; e.path = null; e.rp = 0; }
      if (n.bld && (!n.built || n.team !== e.team)) { if (n.team !== e.team) finish(e); else if (edgeDist(e, n) > 24) chase(e, n, dt); break; }
      if (edgeDist(e, n) <= 24) {
        e.path = null;
        if (n.miner !== e.id && G.time - (n.minerT || -9) < 0.15) {
          if (n.res) { const alt = findNode(n.x, n.y, n, true); if (alt) { o.target = alt.id; e.rp = 0; } }
          break;
        }
        n.miner = e.id; n.minerT = G.time; o.mt = (o.mt || 0) + dt; e.dir = Math.atan2(n.y - e.y, n.x - e.x);
        if (o.mt >= (n.res ? 2.0 : 1.5)) {
          o.mt = 0; n.minerT = -9;
          if (n.res) { const amt = Math.min(5, n.amount); n.amount -= amt; e.carry = amt; e.carryKind = 0; if (n.amount <= 0) kill(n); }
          else { e.carry = 6; e.carryKind = 1; }
          e.order = {t: 'return', node: n.id}; e.rp = 0;
        }
      } else { o.mt = 0; chase(e, n, dt); }
      break;
    }
    case 'return': {
      const hq = nearestHQ(e);
      if (!hq) { finish(e); break; }
      if (edgeDist(e, hq) <= 24) {
        if (e.carry) {
          tm[e.carryKind ? 'gas' : 'crystal'] += e.carry;
          if (e.team === 0) { G.stats.gathered += e.carry; if (e.carryKind) G.stats.gasGot += e.carry; G.texts.push({x: e.x, y: e.y - 10, s: '+' + e.carry, c: e.carryKind ? '#9f9' : '#9ef', t: 0.8}); }
          e.carry = 0;
        }
        e.path = null; e.rp = 0;
        const n = G.byId.get(o.node) || findNode(e.x, e.y);
        if (n) e.order = {t: 'harvest', target: n.id}; else finish(e);
      } else chase(e, hq, dt);
      break;
    }
    case 'build': {
      const s = DEFS[o.type].size, site = {tx: o.tx, ty: o.ty, size: s, x: (o.tx + s / 2) * TILE, y: (o.ty + s / 2) * TILE};
      if (edgeDist(e, site) <= 28) {
        o.started = true;
        if (canPlace(o.type, o.tx, o.ty, -1)) { placeBuilding(o.type, e.team, o.tx, o.ty, false); if (e.team === 0) sfx('place'); }
        else { refund(e.team, o.type); if (e.team === 0) toast("Can't build there! Something is in the way.", 'bad'); }
        const res = o.resume; finish(e);
        if (e.order.t === 'idle' && res) { const n = G.byId.get(res); if (n) e.order = {t: 'harvest', target: n.id}; }
      } else chase(e, site, dt);
      break;
    }
  }
}

function updateBuilding(b, dt) {
  const tm = G.teams[b.team];
  if (!b.built) {
    b.prog += dt / b.def.time; b.hp = Math.min(b.maxHp, b.hp + b.maxHp * 0.9 * dt / b.def.time);
    if (b.prog >= 1) { b.built = true; onBuilt(b); }
    return;
  }
  if (b.def.dmg) { b.cd -= dt; autoFight(b, dt, true); }
  if (b.q.length) {
    const k = b.q[0], d = DEFS[k];
    b.trainT += dt;
    if (b.trainT >= d.time) {
      b.trainT = 0; b.q.shift();
      if (d.kind === 'tech') { tm.up[d.up]++; tm.pending[k]--; if (b.team === 0) { toast('🧪 ' + d.name + ' researched!'); sfx('done'); } }
      else {
        const r = b.rally, p = freeSpotNear(b, r ? r.x : b.x, r ? r.y : b.y + 999);
        const u = spawnUnit(k, b.team, p.x, p.y);
        if (r) {
          const t = r.target && G.byId.get(r.target);
          if (d.worker && t && (t.type === 'crystal' || t.type === 'refinery')) u.order = {t: 'harvest', target: t.id};
          else if (d.worker && r.target) { const n = findNode(r.x, r.y); u.order = n ? {t: 'harvest', target: n.id} : {t: 'move', x: r.x, y: r.y}; }
          else u.order = {t: 'move', x: r.x + (Math.random() - 0.5) * 40, y: r.y + (Math.random() - 0.5) * 40};
        }
        if (b.team === 0) sfx('spawn');
      }
    }
  }
}

function updateProj(dt) {
  for (let i = G.proj.length - 1; i >= 0; i--) {
    const p = G.proj[i], t = G.byId.get(p.tid);
    if (t) { p.gx = t.x; p.gy = t.y; }
    const dx = p.gx - p.x, dy = p.gy - p.y, d = Math.hypot(dx, dy), sp = p.sp * dt;
    if (d <= sp) {
      const src = G.byId.get(p.src);
      if (p.splash) {
        forNear(p.gx, p.gy, p.splash + 20, c => { if (c.team !== p.team && edgeDist({x: p.gx, y: p.gy}, c) <= p.splash) hit(c, p.dmg, p.bonus, src); });
        G.fx.push({k: 'boom', x: p.gx, y: p.gy, t: 0.3, T: 0.3, r: p.splash, c: '#ffb347'});
      } else if (t) hit(t, p.dmg, p.bonus, src);
      G.proj.splice(i, 1);
    } else { p.x += dx / d * sp; p.y += dy / d * sp; }
  }
}

function recalcSupply() {
  for (const tm of G.teams) { tm.supUsed = 0; tm.supMax = 0; }
  for (const e of G.ents) {
    if (e.dead || e.team < 0) continue;
    const tm = G.teams[e.team];
    if (e.unit) tm.supUsed += e.def.supply;
    else if (e.built) { tm.supMax += e.def.supplyGive || 0; for (const k of e.q) tm.supUsed += DEFS[k].supply || 0; }
  }
  for (const tm of G.teams) tm.supMax = Math.min(MAXSUP, tm.supMax);
}

function updateVis() {
  const v = G.vis;
  for (let i = 0; i < v.length; i++) if (v[i] === 2) v[i] = 1;
  for (const e of G.ents) {
    if (e.team !== 0 || e.dead) continue;
    const r = e.bld && !e.built ? 3 : e.def.sight, cx = tl(e.x), cy = tl(e.y), r2 = (r + 0.5) * (r + 0.5);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const x = cx + dx, y = cy + dy;
      if (inMap(x, y)) v[idx(x, y)] = 2;
    }
  }
  G.visDirty = true;
}
const isVisible = e => G.vis[idx(clamp(tl(e.x), 0, W - 1), clamp(tl(e.y), 0, H - 1))] === 2;
const isExplored = e => G.vis[idx(clamp(tl(e.x), 0, W - 1), clamp(tl(e.y), 0, H - 1))] > 0;

// ---------- main tick ----------
function tick(dt) {
  if (G.over) return;
  G.time += dt; G.tick++;
  rebuildHash();
  for (let i = 0; i < G.ents.length; i++) {
    const e = G.ents[i];
    if (e.dead) continue;
    if (e.unit) updateUnit(e, dt); else if (e.bld) updateBuilding(e, dt);
  }
  separate();
  updateProj(dt);
  for (let i = G.fx.length - 1; i >= 0; i--) if ((G.fx[i].t -= dt) <= 0) G.fx.splice(i, 1);
  for (let i = G.texts.length - 1; i >= 0; i--) { const t = G.texts[i]; t.y -= 22 * dt; if ((t.t -= dt) <= 0) G.texts.splice(i, 1); }
  if (G.anyDead) { G.ents = G.ents.filter(e => !e.dead); G.anyDead = false; }
  recalcSupply();
  if (G.tick % 6 === 0) updateVis();
  aiThink(dt);
  // coaching stats
  const tm = G.teams[0], st = G.stats;
  let idle = 0;
  for (const e of G.ents) if (e.team === 0 && e.unit && e.def.worker && e.order.t === 'idle') idle++;
  G.idleWorkers = idle; st.idleT += idle * dt;
  if (tm.supUsed >= tm.supMax && tm.supMax < MAXSUP) st.blockedT += dt;
  if (G.tick % 30 === 0) {
    st.unspent += tm.crystal; st.samples++;
    let b0 = 0, b1 = 0;
    for (const e of G.ents) if (e.bld) { if (e.team === 0) b0++; else b1++; }
    if (!b1) G.over = {win: true}; else if (!b0) G.over = {win: false};
  }
}
