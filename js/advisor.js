'use strict';
// ===== Live advisor: watches the match and says what to do next, why, and how =====
// Uses only what the player could know (own state + enemy units currently or recently in sight).
const ADV = {last: -1e9, sig: '', off: false, intel: {}};
function resetAdvisor() { ADV.last = -1e9; ADV.sig = ''; ADV.off = false; ADV.intel = {}; }

function adviceList() {
  const tm = G.teams[0], t = G.time, out = [];
  const add = (pri, icon, title, why, how) => out.push({pri, icon, title, why, how});
  const K = s => '<kbd>' + s + '</kbd>';
  const mine = G.ents.filter(e => e.team === 0 && !e.dead);
  const workers = mine.filter(e => e.unit && e.def.worker), army = mine.filter(e => e.unit && !e.def.worker);
  const cnt = (type, built) => mine.filter(e => e.type === type && (built === undefined || e.built === built)).length;
  const ordered = type => workers.filter(w => [w.order, ...w.queue].some(o => o.t === 'build' && o.type === type && !o.started)).length;
  const coming = type => cnt(type, false) + ordered(type);
  const hqs = mine.filter(e => e.type === 'hq' && e.built), rax = mine.filter(e => e.type === 'barracks' && e.built);
  const blocked = tm.supUsed >= tm.supMax && tm.supMax < MAXSUP;

  // --- intel: enemy fighters seen in the last two minutes ---
  const seen = {};
  for (const e of G.ents) if (e.team === 1 && e.unit && !e.def.worker && isVisible(e)) seen[e.type] = (seen[e.type] || 0) + 1;
  for (const k in seen) { const o = ADV.intel[k]; ADV.intel[k] = {n: Math.max(seen[k], o && t - o.t < 60 ? o.n : 0), t}; }
  const intel = k => ADV.intel[k] && t - ADV.intel[k].t < 120 ? ADV.intel[k].n : 0;
  const visibleFoes = Object.values(seen).reduce((a, b) => a + b, 0);

  // --- emergencies ---
  const fighting = army.filter(u => t - (u.hitT || -9) < 2 || (u.tgt && u.cd > 0));
  const al = G.alert;
  if (al && t - al.time < 4 && mine.some(b => b.bld && Math.hypot(b.x - al.x, b.y - al.y) < 12 * TILE)) {
    const near = army.filter(u => Math.hypot(u.x - al.x, u.y - al.y) < 10 * TILE).length;
    if (!army.length) add(0, '🚨', 'Your base is under attack and you have no army!', 'Bitbots and buildings cannot fight back.',
      rax.length ? `Train Zappers right now: click the Academy, press ${K('Z')} a few times. A Guard Tower (${K('B')} ${K('T')}) helps too.` : `Build an Academy immediately: Bitbot, ${K('B')} then ${K('A')}.`);
    else if (near < army.length / 2) add(0, '🚨', 'Your base is under attack!', 'Most of your army is somewhere else.',
      `Press ${K('Space')} to jump there. Select your army (${K('1')} if you saved a squad), press ${K('A')} and left-click next to the attackers.`);
  }
  if (fighting.length >= 2) {
    if (tm.up.rush && army.some(u => u.type === 'trooper' && u.rushCd <= 0)) add(1, '🍭', 'Use Sugar Rush now!', 'Your Zappers shoot 40% faster for 6 seconds. Best used at the start of a fight.', `Select your Zappers and press ${K('R')}.`);
    if (seen.tank) add(1, '💥', 'Enemy Boomer in the fight', 'Its blast hits every unit standing close together.', `Right-click the Boomer to focus fire on it, and don't stand in one clump: split your army into two groups coming from different sides.`);
    else if (seen.medic) add(2, '💚', 'Shoot the enemy Patch first', 'It keeps healing everything you damage.', 'Select your army and right-click the white healer to focus fire.');
    const hurt = fighting.filter(u => u.hp < u.maxHp * 0.35).length;
    if (hurt) add(2, '❤️', `Pull back ${hurt} badly hurt unit${hurt > 1 ? 's' : ''}`, 'A unit that survives fights again. A dead one is wasted crystals.', 'Click a unit with a red health bar and right-click behind your army. The enemy will switch targets, then send it back in.');
    if (visibleFoes > army.length * 1.5 && visibleFoes >= 4) add(1, '🏃', 'You are outnumbered: retreat', `About ${visibleFoes} enemies against your ${army.length}.`, 'Select everything and right-click back toward your base. Fight next to your Guard Towers or with reinforcements.');
  }

  // --- supply ---
  const podsComing = coming('depot') + coming('hq');
  if (blocked) {
    if (podsComing) add(2, '🏠', 'Supply blocked, but a Pod is on the way', 'Nothing can be trained until it finishes.', 'Next time start a Power Pod when you are about 3 supply from the limit, so you never have to wait.');
    else add(0, '🏠', `Supply blocked at ${tm.supUsed}/${tm.supMax}!`, 'You cannot train anything until you raise your supply.', `Select a Bitbot, press ${K('B')} then ${K('P')}, and click open ground.`);
  } else if (tm.supMax < MAXSUP && !podsComing && tm.supMax - tm.supUsed <= (rax.length >= 2 ? 5 : 3)) {
    add(2, '🏠', 'Build a Power Pod now', `Only ${tm.supMax - tm.supUsed} supply left. Building it before you hit the limit means production never stops.`, `Bitbot, ${K('B')} then ${K('P')}.${rax.length >= 2 ? ' With several Academies you burn supply fast: build two.' : ''}`);
  }

  // --- economy ---
  if (G.idleWorkers > 0) add(2, '😴', `${G.idleWorkers} Bitbot${G.idleWorkers > 1 ? 's are' : ' is'} doing nothing`, 'Every idle Bitbot is crystals you never get.', `Press ${K('F1')} to select one, then right-click a crystal 💎.`);
  const wantW = Math.min(50, Math.max(1, hqs.length) * 19);
  if (workers.length < wantW && hqs.some(h => !h.q.length) && !blocked) {
    if (tm.crystal >= 50) add(3, '🤖', 'Your Base Core is idle', `You have ${workers.length} Bitbots. Aim for about ${wantW} (2 per crystal patch plus 3 on gas). More Bitbots pay for everything else.`, `Click the Base Core and press ${K('B')}. Do this all game long, even during fights.`);
  }
  if (workers.length > hqs.length * 22 && hqs.length && coming('hq') === 0 && t > 200) {
    add(4, '🏰', 'Time to expand', `${workers.length} Bitbots is more than one crystal field can use, so the extra ones just wait in line.`, `Build a second Base Core (${K('B')} then ${K('C')}) next to another crystal field (cyan dots on the minimap), then move some Bitbots there.`);
  }

  // --- production ---
  const wantUnit = () => {
    const gasOk = cnt('refinery', true) > 0;
    if (intel('brute') >= 2 || intel('tank') >= 1) return gasOk ? `Longshots (${K('L')}), which deal double damage to armored enemies` : `Zappers (${K('Z')}) for now, and get a Gas Pump so you can make Longshots`;
    if (intel('trooper') >= 5) return gasOk ? `Bonks (${K('B')}), which shrug off Zapper shots` : `Zappers (${K('Z')}), and get gas for Bonks`;
    if (intel('lancer') >= 3) return `Zappers (${K('Z')}): cheap, and Longshots fire too slowly to stop a swarm`;
    return `Zappers (${K('Z')})` + (gasOk ? `, with a few Bonks (${K('B')}) in front to soak damage` : '');
  };
  if (!rax.length && !coming('barracks') && t > 40) {
    if (tm.crystal >= 110) add(3, '🎓', 'Build an Academy', 'Without an army, the first enemy wave ends the match.', `Bitbot, ${K('B')} then ${K('A')}, click open ground near your base.`);
  }
  const idleRax = rax.filter(b => !b.q.length).length;
  if (idleRax && tm.crystal >= 50 && !blocked) add(3, '🎓', `${idleRax} Academy${idleRax > 1 ? ' buildings are' : ' is'} idle`, 'A building that is not training anything is wasted time you never get back.', `Click it and train ${wantUnit()}. Queue 2 or 3 so it stays busy.`);
  const fac = mine.filter(e => e.type === 'factory' && e.built);
  if (fac.some(b => !b.q.length) && tm.crystal >= 150 && tm.gas >= 100 && !blocked) add(4, '🏭', 'Your Workshop is idle', 'Boomers blast groups of enemies and outrange Guard Towers.', `Click the Workshop and press ${K('B')}.`);

  // --- counters ---
  if (intel('brute') >= 2 && cnt('lancer') < intel('brute') / 2) add(4, '🔨', `Enemy has ${intel('brute')}+ Bonks`, 'Bonks have armor, so each Zapper shot does little.', `Train Longshots at the Academy (${K('L')}): double damage to armored units. Keep them behind your other units.`);
  if (intel('tank') >= 1 && !seen.tank) add(4, '💥', 'Enemy has Boomers', 'Their splash punishes a tightly packed army.', `Attack from two sides, and kill Boomers first with fast Bonks or Longshots (range 200 beats the Boomer's 180).`);
  if (intel('trooper') >= 6 && cnt('brute') < 2 && cnt('tank') < 1) add(4, '⚡', `Enemy is massing Zappers (${intel('trooper')}+)`, 'Zappers melt against armor and splash damage.', `Add Bonks (${K('B')} at the Academy) to charge in front, or a Boomer from a Workshop.`);
  if (intel('lancer') >= 3 && cnt('trooper') < intel('lancer') * 2) add(5, '🎯', `Enemy has ${intel('lancer')}+ Longshots`, 'They hit hard but reload slowly, so many cheap targets overwhelm them.', `Make lots of Zappers (${K('Z')}) and close the distance fast; don't trade shots at long range.`);

  // --- spending and tech ---
  if (tm.crystal >= 350 && !blocked) {
    const wantRax = 1 + Math.floor(workers.length / 8);
    if (rax.length + coming('barracks') < wantRax && rax.length) add(4, '💎', `${tm.crystal} crystals unspent`, 'Crystals in the bank win nothing. Your Bitbots earn faster than one Academy can spend.', `Build another Academy (Bitbot, ${K('B')} then ${K('A')}) so you can train more units at once.`);
    else if (tm.crystal >= 550 && hqs.length + coming('hq') < 2 && t > 200) add(4, '🏰', `${tm.crystal} crystals unspent: expand`, 'A second base doubles your income and gives you room for more Bitbots.', `Bitbot, ${K('B')} then ${K('C')}, and place it next to another crystal field (cyan dots on the minimap).`);
    else if (tm.crystal >= 500 && rax.length) add(5, '💎', `${tm.crystal} crystals unspent`, 'Strong players keep their bank near zero.', `Queue more units in every building, or add another Academy. Check 💎 every few seconds: if it climbs, spend it.`);
  }
  if (rax.length && !cnt('refinery') && !ordered('refinery') && t > 110) add(5, '⛽', 'Get gas', 'Bonks, Longshots, Boomers and every upgrade need gas.', `Bitbot, ${K('B')} then ${K('G')}, then click the green vent next to your base.`);
  for (const r of mine) if (r.type === 'refinery' && r.built) {
    const n = workers.filter(w => (w.order.t === 'harvest' && w.order.target === r.id) || (w.order.t === 'return' && w.order.node === r.id)).length;
    if (n < 3) { add(4, '⛽', 'Send Bitbots to your Gas Pump', `${n} of 3 Bitbots are collecting gas.`, `Select ${3 - n} Bitbot${3 - n > 1 ? 's' : ''} and right-click the pump.`); break; }
  }
  if (tm.gas >= 150) {
    if (!cnt('factory') && !ordered('factory') && tm.crystal >= 200) add(5, '🏭', 'Spend your gas on a Workshop', `You have ${tm.gas} gas sitting unused.`, `Bitbot, ${K('B')} then ${K('W')}. It builds Boomers.`);
    else if (!cnt('lab') && !ordered('lab')) add(5, '🧪', 'Build a Lab', `You have ${tm.gas} gas sitting unused. Upgrades make every unit you own stronger.`, `Bitbot, ${K('B')} then ${K('L')}.`);
    else if (mine.some(e => e.type === 'lab' && e.built && !e.q.length) && ['up_w', 'up_a', 'up_r'].some(k => tm.up[DEFS[k].up] + (tm.pending[k] || 0) < DEFS[k].max) && tm.crystal >= 100)
      add(5, '🧪', 'Your Lab is idle', 'Upgrades apply to your whole army at once.', `Click the Lab and research Sharper Zaps (${K('W')}), Thicker Shells (${K('A')}) or Sugar Rush (${K('R')}).`);
  }

  // --- control and map ---
  if (army.length >= 4 && G.stats.groupsSet === 0) add(5, '🔢', 'Save your army as squad 1', 'Then you can grab it instantly from anywhere, even while looking at your base.', `Drag a box around the army and press ${K('Ctrl')}+${K('1')}. After that, ${K('1')} selects it and a double-tap jumps to it.`);
  if (t > 120 && !G.ents.some(e => e.team === 1 && e.bld && isExplored(e))) add(6, '🔭', 'Scout the enemy', 'Seeing what they build tells you what to build.', 'Select one Zapper or Bitbot and right-click the top-right corner of the minimap.');
  if (rax.length && army.length >= 3 && rax.every(b => !b.rally)) add(7, '🚩', 'Set a rally point', 'New units will walk to your army by themselves.', 'Click the Academy, then right-click the ground where your army waits.');
  const armySup = army.reduce((a, u) => a + u.def.supply, 0), idleArmy = army.filter(u => u.order.t === 'idle' && !u.tgt).length;
  if (armySup >= 14 && idleArmy >= army.length * 0.7 && t > 150 && !fighting.length) {
    add(6, '⚔️', 'Your army is ready: go attack', `${army.length} fighters are standing around. The enemy gets stronger every minute you wait.`,
      `Select them (${K('1')}), press ${K('A')}, then left-click the enemy base on the minimap (top-right). Keep training units at home while you fight.`);
  }

  if (!out.length) add(9, '👍', 'On track', 'Keep the cycle going: Bitbots, supply, spend, army.', 'Glance at 💎 and 🏠 every few seconds. If crystals climb, spend them. If supply is nearly full, build a Pod.');
  return out.sort((a, b) => a.pri - b.pri).slice(0, 2);
}

function updateAdvisor() {
  const el = $('advisor');
  if (ADV.off || !G || G.over) { el.style.display = 'none'; return; }
  const now = performance.now();
  if (now - ADV.last < 1000) return;
  ADV.last = now;
  const list = adviceList(), sig = list.map(a => a.title).join('|');
  if (sig === ADV.sig) return;
  ADV.sig = sig; el.style.display = 'block';
  el.innerHTML = '<span class="x" id="advX">hide ✕</span><h3>🧭 Advisor</h3>' + list.map(a =>
    `<div class="adv ${a.pri <= 1 ? 'urgent' : a.pri <= 4 ? 'warn' : 'tip'}"><b>${a.icon} ${a.title}</b><p>${a.why}</p><p class="do">👉 ${a.how}</p></div>`).join('');
  $('advX').onclick = () => { ADV.off = true; el.style.display = 'none'; };
}
