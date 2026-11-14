// Slingshot Island Duel: the simulation. Two mirrored islands, a fort of wood/stone/glass on each, a critter
// inside, a slingshot behind. Turn-based: a shot (weapon, angle, power) is played out by Box2D (planck.js)
// until everything settles. Deterministic: both browsers rebuild the world from the same snapshot at the start
// of every turn and simulate the same shot, so only the shot travels over the network; the shooter's final
// snapshot then corrects any drift. Pure (no DOM): window.DuelSim in the page, module.exports in node tests.
// Units: metres, seconds; x right, y up; the sea is at y = 0; the left island belongs to seat 'a'.
(function (root, factory) {
  const pl = typeof module === 'object' && module.exports ? require('../shared/vendor/planck-1.4.3.min.js') : root.planck;
  const api = factory(pl);
  if (typeof module === 'object' && module.exports) module.exports = api; else root.DuelSim = api;
})(typeof self !== 'undefined' ? self : globalThis, function (planck) {
  'use strict';
  const V = planck.Vec2;
  const C = {
    gravity: -15, dt: 1 / 60, minX: -34, maxX: 34, step: 0.5,      // terrain samples every 0.5 m
    islandCentre: 18, islandHalf: 11, plateau: 3,
    sling: 24.5, slingY: 1.6,                                    // slingshot x (mirrored) and height above ground
    maxPower: 30, maxWind: 3.2, maxTurnSecs: 9,
    critterR: 0.55, hp: 100,
    sea: 0,
  };
  const MATERIAL = {
    wood: { density: 0.7, friction: 0.6, restitution: 0.1, hp: 55 },
    stone: { density: 2.2, friction: 0.8, restitution: 0.05, hp: 140 },
    glass: { density: 0.9, friction: 0.3, restitution: 0.05, hp: 18 },
  };
  // r: radius, d: density, blast: explosion radius (0 = none), crater: terrain bite, dmg: blast damage at centre
  const WEAPONS = {
    rock: { name: 'Rock', emoji: '🪨', r: 0.32, d: 5, blast: 0, ammo: Infinity },
    bomb: { name: 'Bomb', emoji: '💣', r: 0.36, d: 3, blast: 2.4, crater: 1.6, dmg: 38, ammo: 2 },
    split: { name: 'Splitter', emoji: '✨', r: 0.26, d: 4, blast: 0, ammo: 2, split: 3 },
    bounce: { name: 'Bouncer', emoji: '🏀', r: 0.34, d: 2.5, blast: 1.5, crater: 0.9, dmg: 22, ammo: 2, bounces: 3, rest: 0.75 },
    anvil: { name: 'Anvil', emoji: '🧱', r: 0.5, d: 14, blast: 0, ammo: 1 },
  };

  /* ---------- seeded randomness (fair: both islands are mirror images) ---------- */
  function mulberry(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  /* ---------- a new match ---------- */
  const N = Math.round((C.maxX - C.minX) / C.step) + 1;
  const xAt = (i) => C.minX + i * C.step;
  function islandHeight(x, bumps) {
    const d = Math.abs(Math.abs(x) - C.islandCentre);
    if (d > C.islandHalf + 3) return -4;
    const t = Math.max(0, Math.min(1, (C.islandHalf + 2.5 - d) / 4)); // beach slope at the edges
    const smooth = t * t * (3 - 2 * t);
    let h = -2.5 + smooth * (C.plateau + 2.5);
    const ax = Math.abs(x);
    for (const b of bumps) h += b.h * Math.exp(-(((ax - b.x) / b.w) ** 2)) * smooth;
    return h;
  }
  const FORTS = [
    // [kind, dx from the critter's spot (toward the sea is +), y above ground, w, h, angle]
    [['wood', -1.0, 0, 0.35, 1.8], ['wood', 1.0, 0, 0.35, 1.8], ['wood', 0, 1.8, 2.6, 0.3], ['stone', 2.0, 0, 0.6, 1.4], ['glass', 2.0, 1.4, 0.3, 1.2], ['wood', 0, 2.1, 0.35, 1.2], ['stone', -1.9, 0, 0.6, 0.9]],
    [['stone', 1.6, 0, 0.7, 2.2], ['wood', -1.3, 0, 0.35, 2.0], ['wood', 0.15, 2.2, 3.4, 0.3], ['glass', 0.9, 2.5, 0.3, 1.0], ['glass', -0.6, 2.5, 0.3, 1.0], ['wood', 0.15, 3.5, 2.2, 0.3], ['wood', 2.6, 0, 0.35, 1.2]],
    [['wood', 1.3, 0, 0.35, 1.5], ['wood', 2.3, 0, 0.35, 1.5], ['wood', 1.8, 1.5, 1.5, 0.3], ['stone', 1.8, 1.8, 0.6, 0.6], ['glass', 3.1, 0, 0.3, 1.8], ['wood', -1.2, 0, 1.0, 0.6], ['stone', -1.2, 0.6, 0.5, 0.5]],
  ];
  function newMatch(seed = 1) {
    const r = mulberry(seed);
    const bumps = Array.from({ length: 3 }, () => ({ x: C.islandCentre - 7 + r() * 14, w: 1.2 + r() * 2, h: (r() - 0.4) * 1.4 }));
    // keep the fort spot and the slingshot spot flat-ish
    const terrain = Array.from({ length: N }, (_, i) => +islandHeight(xAt(i), bumps).toFixed(3));
    const spot = C.islandCentre - 3.5; // the critter sits a little toward the sea from the island's middle
    const fort = FORTS[Math.floor(r() * FORTS.length)];
    const flatten = (x0, x1) => { const y = groundAt(terrain, (x0 + x1) / 2); for (let i = 0; i < N; i++) { const ax = Math.abs(xAt(i)); if (ax >= x0 && ax <= x1) terrain[i] = +y.toFixed(3); } };
    flatten(spot - 3.4, spot + 3.6); flatten(C.sling - 1, C.sling + 1);
    const blocks = [];
    let id = 0;
    for (const seat of ['a', 'b']) {
      const s = seat === 'a' ? -1 : 1, base = groundAt(terrain, s * spot);
      for (const [kind, dx, dy, w, h] of fort) blocks.push({ id: id++, kind, x: s * (spot - dx), y: base + dy + h / 2, a: 0, w, h, hp: MATERIAL[kind].hp, seat });
    }
    const critters = {};
    for (const seat of ['a', 'b']) { const s = seat === 'a' ? -1 : 1; critters[seat] = { x: s * spot, y: groundAt(terrain, s * spot) + C.critterR, a: 0, hp: C.hp }; }
    const ammo = Object.fromEntries(Object.entries(WEAPONS).map(([k, w]) => [k, w.ammo === Infinity ? -1 : w.ammo]));
    return { v: 1, seed, turn: 0, shooter: 'a', terrain, blocks, critters, ammo: { a: { ...ammo }, b: { ...ammo } }, wind: windFor(seed, 0), over: false, winner: null, nextId: id };
  }
  // The wind for a turn is known before you aim (and the same for both players' screens).
  function windFor(seed, turn) { const r = mulberry((seed * 31 + turn * 977) >>> 0); r(); return +((r() * 2 - 1) * C.maxWind).toFixed(2); }
  function groundAt(terrain, x) {
    const f = (x - C.minX) / C.step, i = Math.max(0, Math.min(N - 2, Math.floor(f))), t = Math.max(0, Math.min(1, f - i));
    return terrain[i] * (1 - t) + terrain[i + 1] * t;
  }
  const slingPos = (state, seat) => { const x = (seat === 'a' ? -1 : 1) * C.sling; return { x, y: groundAt(state.terrain, x) + C.slingY }; };
  const launchVel = (seat, angle, power) => { const s = seat === 'a' ? 1 : -1, p = Math.max(0, Math.min(1, power)) * C.maxPower; return { vx: s * Math.cos(angle) * p, vy: Math.sin(angle) * p }; };

  /* ---------- the live world for one turn ---------- */
  function build(state) {
    const world = new planck.World({ gravity: V(0, C.gravity) });
    const ground = world.createBody({ type: 'static' });
    ground.setUserData({ type: 'ground' });
    const W = { world, state: JSON.parse(JSON.stringify(state)), ground, groundFx: [], bodies: new Map(), critterBody: {}, shots: [], events: [], t: 0, damage: [], toDestroy: new Set(), craterQueue: [], done: false };
    rebuildGround(W);
    for (const b of W.state.blocks) addBlock(W, b);
    for (const seat of ['a', 'b']) {
      const c = W.state.critters[seat];
      if (c.hp <= 0) continue;
      const body = world.createBody({ type: 'dynamic', position: V(c.x, c.y), angle: c.a, angularDamping: 2, linearDamping: 0.1 });
      body.createFixture(planck.Circle(C.critterR), { density: 1.1, friction: 0.7, restitution: 0.15 });
      body.setUserData({ type: 'critter', seat });
      W.critterBody[seat] = body;
    }
    world.on('post-solve', (contact, impulse) => onImpact(W, contact, impulse));
    world.on('begin-contact', (contact) => onTouch(W, contact));
    return W;
  }
  function rebuildGround(W) {
    W.groundFx.forEach((f) => W.ground.destroyFixture(f)); W.groundFx = [];
    // one chain per island (above the sea floor), so nothing pointless is tested against the deep sea
    let run = [];
    const flush = () => { if (run.length > 2) W.groundFx.push(W.ground.createFixture(planck.Chain(run.map((p) => V(p[0], p[1])), false), { friction: 0.9 })); run = []; };
    for (let i = 0; i < N; i++) { const h = W.state.terrain[i]; if (h > -3.5) run.push([xAt(i), h]); else flush(); }
    flush();
  }
  function addBlock(W, b) {
    const m = MATERIAL[b.kind];
    const body = W.world.createBody({ type: 'dynamic', position: V(b.x, b.y), angle: b.a, angularDamping: 0.4 });
    body.createFixture(planck.Box(b.w / 2, b.h / 2), { density: m.density, friction: m.friction, restitution: m.restitution });
    body.setUserData({ type: 'block', id: b.id });
    W.bodies.set(b.id, body);
  }

  /* ---------- damage ---------- */
  function onImpact(W, contact, impulse) {
    // Only real knocks hurt: resting weight also pushes a little every step, so small impulses and the
    // first moments of a turn (everything settling) never count.
    const imp = impulse.normalImpulses[0] + (impulse.normalImpulses[1] || 0);
    if (imp < 1.6 || W.t < 0.25) return;
    for (const fx of [contact.getFixtureA(), contact.getFixtureB()]) {
      const u = fx.getBody().getUserData();
      if (!u) continue;
      if (u.type === 'block') W.damage.push({ id: u.id, amount: (imp - 1.2) * 4 });
      else if (u.type === 'critter' && imp > 2.2) W.damage.push({ seat: u.seat, amount: (imp - 2.2) * 5.5, why: 'hit' });
    }
  }
  function onTouch(W, contact) {
    for (const fx of [contact.getFixtureA(), contact.getFixtureB()]) {
      const u = fx.getBody().getUserData();
      if (u && u.type === 'shot' && !u.done) { u.touches = (u.touches || 0) + 1; u.touched = true; }
    }
  }
  function explode(W, x, y, wpn) {
    W.events.push({ t: 'boom', x, y, r: wpn.blast });
    // bite the terrain
    if (wpn.crater) W.craterQueue.push({ x, y, r: wpn.crater });
    for (let b = W.world.getBodyList(); b; b = b.getNext()) {
      if (!b.isDynamic()) continue;
      const u = b.getUserData() || {}, p = b.getPosition(), dx = p.x - x, dy = p.y - y, d = Math.hypot(dx, dy);
      if (d > wpn.blast || u.type === 'shot') continue;
      const k = 1 - d / wpn.blast, push = k * 14 * Math.sqrt(b.getMass() + 0.2);
      b.applyLinearImpulse(V((dx / (d || 1)) * push, (dy / (d || 1)) * push + push * 0.4), p, true);
      if (u.type === 'block') W.damage.push({ id: u.id, amount: k * 120 });
      if (u.type === 'critter') W.damage.push({ seat: u.seat, amount: k * wpn.dmg, why: 'blast' });
    }
  }
  function applyCrater(W, { x, y, r }) {
    let changed = false;
    for (let i = 0; i < N; i++) {
      const dx = xAt(i) - x;
      if (Math.abs(dx) >= r) continue;
      const bottom = y - Math.sqrt(r * r - dx * dx);
      if (W.state.terrain[i] > bottom) { W.state.terrain[i] = +Math.max(-2.4, bottom).toFixed(3); changed = true; }
    }
    if (changed) { rebuildGround(W); W.events.push({ t: 'crater', x, y, r }); for (let b = W.world.getBodyList(); b; b = b.getNext()) b.setAwake(true); }
  }

  /* ---------- a shot ---------- */
  function fire(W, seat, weapon, angle, power) {
    const wpn = WEAPONS[weapon];
    if (!wpn) throw new Error('unknown weapon');
    const am = W.state.ammo[seat];
    if (am[weapon] === 0) throw new Error('no ammo');
    if (am[weapon] > 0) am[weapon]--;
    const s = slingPos(W.state, seat), v = launchVel(seat, angle, power);
    spawnShot(W, weapon, s.x, s.y, v.vx, v.vy, seat);
    W.events.push({ t: 'fire', seat, weapon });
  }
  function spawnShot(W, weapon, x, y, vx, vy, seat, child = false) {
    const wpn = WEAPONS[weapon];
    const body = W.world.createBody({ type: 'dynamic', position: V(x, y), bullet: true, linearVelocity: V(vx, vy), angularDamping: 0.2 });
    body.createFixture(planck.Circle(child ? wpn.r * 0.75 : wpn.r), { density: wpn.d, friction: 0.5, restitution: wpn.rest || 0.15 });
    const u = { type: 'shot', weapon, seat, born: W.t, child, done: false, touches: 0 };
    body.setUserData(u);
    W.shots.push(body);
  }

  // One fixed step. Returns true while the turn is still playing out.
  function step(W) {
    const dt = C.dt;
    W.t += dt;
    // wind pushes shots that are in the air
    for (const s of W.shots) { const u = s.getUserData(); if (!u.done && !u.touched) s.applyForceToCenter(V(W.state.wind * s.getMass(), 0), true); }
    W.world.step(dt, 8, 3);
    // shot behaviour after this step
    for (const s of W.shots.slice()) {
      const u = s.getUserData(), p = s.getPosition(), v = s.getLinearVelocity(), wpn = WEAPONS[u.weapon];
      if (u.done) continue;
      if (wpn.split && !u.child && v.y < 0 && W.t - u.born > 0.25) { // splitter: at the top of its arc, into three
        u.done = true; W.toDestroy.add(s); W.events.push({ t: 'split', x: p.x, y: p.y });
        for (const da of [-0.22, 0, 0.22]) { const sp = Math.hypot(v.x, v.y), a = Math.atan2(v.y, v.x) + da; spawnShot(W, 'split', p.x, p.y, Math.cos(a) * sp, Math.sin(a) * sp, u.seat, true); }
        continue;
      }
      if (wpn.blast && !wpn.bounces && u.touched) { u.done = true; W.toDestroy.add(s); explode(W, p.x, p.y, wpn); continue; }
      if (wpn.bounces && (u.touches >= wpn.bounces || W.t - u.born > 4)) { u.done = true; W.toDestroy.add(s); explode(W, p.x, p.y, wpn); continue; }
      if (p.y < C.sea - 0.2) { u.done = true; W.toDestroy.add(s); W.events.push({ t: 'splash', x: p.x, big: false }); continue; }
      if (Math.abs(p.x) > C.maxX + 6) { u.done = true; W.toDestroy.add(s); continue; }
      if (u.touched && Math.hypot(v.x, v.y) < 0.4) { u.done = true; } // a resting rock stays as debris until the turn ends
    }
    // damage collected during the step
    for (const d of W.damage.splice(0)) {
      if (d.id !== undefined) {
        const b = W.state.blocks.find((x) => x.id === d.id);
        if (!b || b.hp <= 0) continue;
        b.hp -= d.amount;
        if (b.hp <= 0) { W.toDestroy.add(W.bodies.get(b.id)); W.events.push({ t: 'break', id: b.id, kind: b.kind, x: W.bodies.get(b.id).getPosition().x, y: W.bodies.get(b.id).getPosition().y }); }
      } else if (d.seat) {
        const c = W.state.critters[d.seat];
        if (c.hp <= 0 || d.amount < 0.5) continue;
        const amt = Math.min(c.hp, Math.round(d.amount));
        c.hp -= amt;
        W.events.push({ t: 'hurt', seat: d.seat, amount: amt, why: d.why });
      }
    }
    for (const b of W.toDestroy) {
      if (!b) continue;
      const u = b.getUserData();
      if (u.type === 'block') { W.bodies.delete(u.id); W.state.blocks = W.state.blocks.filter((x) => x.id !== u.id); }
      if (u.type === 'shot') W.shots = W.shots.filter((x) => x !== b);
      W.world.destroyBody(b);
    }
    W.toDestroy.clear();
    for (const c of W.craterQueue.splice(0)) applyCrater(W, c);
    // splashes: blocks or critters that fall into the sea
    for (const seat of ['a', 'b']) {
      const body = W.critterBody[seat], c = W.state.critters[seat];
      if (body && c.hp > 0 && body.getPosition().y < C.sea + 0.1) { W.events.push({ t: 'splash', x: body.getPosition().x, big: true, seat }); W.events.push({ t: 'hurt', seat, amount: c.hp, why: 'sea' }); c.hp = 0; }
    }
    for (const [id, body] of W.bodies) if (body.getPosition().y < -1.5) { W.toDestroy.add(body); W.events.push({ t: 'sink', id }); }
    // has everything settled?
    const moving = (b) => b.isAwake() && (b.getLinearVelocity().length() > 0.08 || Math.abs(b.getAngularVelocity()) > 0.1);
    let busy = W.shots.some((s) => !s.getUserData().done);
    if (!busy) for (let b = W.world.getBodyList(); b && !busy; b = b.getNext()) if (b.isDynamic() && moving(b)) busy = true;
    if (!busy || W.t > C.maxTurnSecs) { finish(W); return false; }
    return true;
  }

  // The turn is over: write the bodies back into the state, decide a winner, hand the turn over.
  function finish(W) {
    if (W.done) return;
    W.done = true;
    const st = W.state;
    for (const b of st.blocks) { const body = W.bodies.get(b.id); if (!body) continue; const p = body.getPosition(); b.x = +p.x.toFixed(4); b.y = +p.y.toFixed(4); b.a = +body.getAngle().toFixed(4); b.hp = Math.round(b.hp); }
    st.blocks = st.blocks.filter((b) => b.y > -1.2);
    for (const seat of ['a', 'b']) { const body = W.critterBody[seat], c = st.critters[seat]; if (body) { const p = body.getPosition(); c.x = +p.x.toFixed(4); c.y = +p.y.toFixed(4); c.a = +body.getAngle().toFixed(4); } }
    const deadA = st.critters.a.hp <= 0, deadB = st.critters.b.hp <= 0;
    if (deadA || deadB) { st.over = true; st.winner = deadA && deadB ? null : deadA ? 'b' : 'a'; W.events.push({ t: 'over', winner: st.winner }); }
    else {
      st.turn++;
      st.shooter = st.shooter === 'a' ? 'b' : 'a';
      st.wind = windFor(st.seed, st.turn);
      // after 12 shots each, the healthier critter wins (ties go on)
      if (st.turn >= 24 && st.critters.a.hp !== st.critters.b.hp) { st.over = true; st.winner = st.critters.a.hp > st.critters.b.hp ? 'a' : 'b'; W.events.push({ t: 'over', winner: st.winner, onPoints: true }); }
    }
    W.events.push({ t: 'settled' });
  }

  // Play a whole shot without drawing (bots and tests). Returns the final state and all events.
  function simulate(state, seat, weapon, angle, power, maxSteps = 60 * 12) {
    const W = build(state);
    fire(W, seat, weapon, angle, power);
    const events = [];
    for (let i = 0; i < maxSteps && step(W); i++) events.push(...W.events.splice(0));
    events.push(...W.events.splice(0));
    if (!W.done) finish(W);
    return { state: W.state, events, W };
  }

  // A bot: tries a fan of shots and picks the one that hurts the other critter most (with a little aim error).
  function botShot(state, seat, { tries = 26, error = 0.05, rnd = Math.random } = {}) {
    const other = seat === 'a' ? 'b' : 'a';
    const weapons = Object.keys(WEAPONS).filter((w) => state.ammo[seat][w] !== 0);
    let best = null;
    for (let i = 0; i < tries; i++) {
      const weapon = i < tries * 0.6 ? 'rock' : weapons[Math.floor(rnd() * weapons.length)];
      const angle = 0.35 + rnd() * 0.85, power = 0.55 + rnd() * 0.45;
      const r = simulate(state, seat, weapon, angle, power, 60 * 8);
      const dmg = state.critters[other].hp - r.state.critters[other].hp, self = state.critters[seat].hp - r.state.critters[seat].hp;
      const score = dmg * 2 - self * 3 - (weapon !== 'rock' ? 4 : 0);
      if (!best || score > best.score) best = { weapon, angle, power, score };
    }
    return { weapon: best.weapon, angle: best.angle + (rnd() - 0.5) * error, power: Math.min(1, best.power + (rnd() - 0.5) * error) };
  }

  return { C, WEAPONS, MATERIAL, newMatch, windFor, groundAt, slingPos, launchVel, build, fire, step, finish, simulate, botShot, N, xAt };
});
