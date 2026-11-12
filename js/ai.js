'use strict';
// ===== Enemy commander (plays by the same rules as the player) =====
const AI_CFG = {
  easy:   {label: 'Rookie',    workers: 8,  think: 2.0, firstWave: 330, wave: 3, grow: 2, maxRax: 1, gas: false, units: ['trooper'], factory: false, lab: false, expand: false, maxArmy: 10},
  medium: {label: 'Cadet',     workers: 14, think: 1.2, firstWave: 230, wave: 6, grow: 3, maxRax: 2, gas: true,  units: ['trooper', 'trooper', 'brute', 'lancer'], factory: true, lab: false, expand: false, maxArmy: 24},
  hard:   {label: 'Commander', workers: 22, think: 0.6, firstWave: 160, wave: 8, grow: 4, maxRax: 3, gas: true,  units: ['trooper', 'trooper', 'brute', 'lancer', 'medic'], factory: true, lab: true, expand: true, maxArmy: 44},
};

function aiSpot(hq, s) {
  const res = G.ents.filter(e => e.res);
  const cx = hq.tx + 2, cy = hq.ty + 2;
  for (let r = 4; r < 16; r++) {
    const c = [];
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++)
      if (Math.max(Math.abs(dx), Math.abs(dy)) === r) c.push([cx + dx - (s >> 1), cy + dy - (s >> 1)]);
    for (let i = c.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [c[i], c[j]] = [c[j], c[i]]; }
    for (const [x, y] of c) {
      let ok = true;
      for (let yy = y - 1; yy <= y + s && ok; yy++) for (let xx = x - 1; xx <= x + s; xx++) if (blocked(xx, yy)) { ok = false; break; }
      if (!ok) continue;
      const px = (x + s / 2) * TILE, py = (y + s / 2) * TILE;
      if (res.some(n => Math.hypot(n.x - px, n.y - py) < (s / 2 + 3.5) * TILE)) continue;
      return [x, y];
    }
  }
  return null;
}

function aiBuild(type, hq, workers) {
  const d = DEFS[type];
  if (buildError(1, type)) return false;
  const w = workers.find(w => w.order.t === 'harvest' && !w.carry && G.byId.get(w.order.target) && G.byId.get(w.order.target).res)
    || workers.find(w => w.order.t === 'harvest' || w.order.t === 'idle' || w.order.t === 'return');
  if (!w) return false;
  let spot = null;
  if (type === 'refinery') {
    let bd = 14 * TILE;
    for (const v of G.ents) if (v.type === 'vent' && !v.covered) { const dd = Math.hypot(v.x - hq.x, v.y - hq.y); if (dd < bd) { bd = dd; spot = [v.tx, v.ty]; } }
  } else if (type === 'hq') {
    let bd = 1e9;
    for (const s of G.sites) {
      if (G.ents.some(e => e.type === 'hq' && Math.hypot(e.x / TILE - s.cx, e.y / TILE - s.cy) < 7)) continue;
      const dd = Math.hypot(s.cx * TILE - hq.x, s.cy * TILE - hq.y);
      if (dd < bd && canPlace('hq', s.cx - 2, s.cy - 2, 1)) { bd = dd; spot = [s.cx - 2, s.cy - 2]; }
    }
  } else spot = aiSpot(hq, d.size);
  if (!spot) return false;
  return !orderBuild(w, type, spot[0], spot[1]);
}

function aiThink(dt) {
  const A = G.ai, cfg = AI_CFG[G.diff], tm = G.teams[1];
  A.t -= dt; if (A.t > 0) return; A.t = cfg.think;
  if (!A.wave) A.wave = cfg.wave;
  const mine = G.ents.filter(e => e.team === 1 && !e.dead);
  const foes = G.ents.filter(e => e.team === 0 && !e.dead);
  if (!foes.length) return;
  const hqs = mine.filter(e => e.type === 'hq' && e.built);
  const workers = mine.filter(e => e.unit && e.def.worker);
  const army = mine.filter(e => e.unit && !e.def.worker);
  const nearestFoe = (x, y) => {
    let best = null, bd = 1e9;
    for (const f of foes) { const d = Math.hypot(f.x - x, f.y - y) + (f.bld ? 0 : 400); if (d < bd) { bd = d; best = f; } }
    return best;
  };
  if (!hqs.length) {
    for (const u of army) if (u.order.t === 'idle') { const f = nearestFoe(u.x, u.y); giveOrder(u, {t: 'amove', x: f.x, y: f.y}); }
    return;
  }
  const hq = hqs[0];
  const count = t => mine.filter(e => e.type === t).length + workers.filter(w => w.order.t === 'build' && w.order.type === t).length;
  const unbuilt = t => mine.filter(e => e.type === t && !e.built).length + workers.filter(w => w.order.t === 'build' && w.order.type === t).length;

  // economy
  for (const w of workers) if (w.order.t === 'idle') {
    const h = nearestHQ(w) || hq, n = findNode(h.x, h.y);
    if (n) giveOrder(w, {t: 'harvest', target: n.id});
  }
  for (const h of hqs) if (h.q.length === 0 && workers.length < cfg.workers) queueTrain(h, 'worker');
  for (const ref of mine) {
    if (ref.type !== 'refinery' || !ref.built) continue;
    const n = workers.filter(w => (w.order.t === 'harvest' && w.order.target === ref.id) || (w.order.t === 'return' && w.order.node === ref.id)).length;
    if (n < 3) {
      const w = workers.find(w => w.order.t === 'harvest' && !w.carry && G.byId.get(w.order.target) && G.byId.get(w.order.target).res);
      if (w) giveOrder(w, {t: 'harvest', target: ref.id});
    }
  }

  // construction (one decision per think)
  if (tm.supMax < MAXSUP && tm.supMax - tm.supUsed <= 3 && unbuilt('depot') < (tm.supMax > 30 ? 2 : 1)) aiBuild('depot', hq, workers);
  else if (count('barracks') < 1) aiBuild('barracks', hq, workers);
  else if (cfg.gas && count('refinery') < 1) aiBuild('refinery', hq, workers);
  else if (count('barracks') < cfg.maxRax && tm.crystal > 220) aiBuild('barracks', hq, workers);
  else if (cfg.factory && count('factory') < 1 && G.time > 150) aiBuild('factory', hq, workers);
  else if (cfg.lab && count('lab') < 1 && G.time > 240) aiBuild('lab', hq, workers);
  else if (cfg.expand && count('hq') < 2 && G.time > 260) aiBuild('hq', hq, workers);
  else if (cfg.expand && count('refinery') < 2 && hqs.length > 1) aiBuild('refinery', hqs[1], workers);
  else if (G.diff !== 'easy' && count('turret') < 1 && G.time > 200) aiBuild('turret', hq, workers);

  // production
  const gather = {x: hq.x + (W * TILE / 2 - hq.x) * 0.22, y: hq.y + (H * TILE / 2 - hq.y) * 0.22};
  if (army.length < cfg.maxArmy) for (const b of mine) {
    if (!b.bld || !b.built) continue;
    if (!b.rally && b.type !== 'hq') b.rally = {x: gather.x, y: gather.y, target: 0};
    if (b.q.length > 0) continue;
    if (b.type === 'barracks') {
      const k = cfg.units[Math.floor(Math.random() * cfg.units.length)];
      if (queueTrain(b, k)) queueTrain(b, 'trooper');
    } else if (b.type === 'factory') queueTrain(b, 'tank');
    else if (b.type === 'lab') { if (queueTrain(b, 'up_w')) if (queueTrain(b, 'up_a')) queueTrain(b, 'up_r'); }
  }
  if (tm.up.rush) for (const u of army) if (u.type === 'trooper' && u.tgt && u.rushCd <= 0) useRush(u);

  // defend
  const th = tm.threat;
  if (th && G.time - th.time < 4 && mine.some(b => b.bld && Math.hypot(b.x - th.x, b.y - th.y) < 16 * TILE)) {
    for (const u of army) if (u.order.t === 'idle' && !A.squad.has(u.id)) giveOrder(u, {t: 'amove', x: th.x, y: th.y});
  }

  // attack waves
  for (const id of A.squad) if (!G.byId.has(id)) A.squad.delete(id);
  if (A.attacking && A.squad.size < 2) { A.attacking = false; for (const id of A.squad) giveOrder(G.byId.get(id), {t: 'move', x: gather.x, y: gather.y}); A.squad.clear(); }
  if (!A.attacking && G.time > cfg.firstWave) {
    const ready = army.filter(u => u.order.t === 'idle' || u.order.t === 'move');
    if (ready.length >= A.wave) {
      A.attacking = true; A.wave = Math.min(cfg.maxArmy, A.wave + cfg.grow);
      for (const u of ready) A.squad.add(u.id);
    }
  }
  if (A.attacking) for (const id of A.squad) {
    const u = G.byId.get(id);
    if (u.order.t === 'idle' || u.order.t === 'move') { const f = nearestFoe(u.x, u.y); giveOrder(u, {t: 'amove', x: f.x, y: f.y}); }
  }
}
