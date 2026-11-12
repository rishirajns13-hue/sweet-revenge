// Run with: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../race/physics.js');

const T = P.makeTrack();
const GAS = { gas: true }, NONE = {};
// A kart parked on the track at distance s (offset d sideways), facing along it.
function kartAt(s, d = 0) {
  const k = P.newKart(T, 0), p = P.pointAt(T, s, d);
  Object.assign(k, { x: p.x, y: p.y, a: p.angle, m: p.angle, s, lap: 1, sec: P.sectionOf(T, s) });
  return k;
}
const run = (k, input, steps) => { for (let i = 0; i < steps; i++) P.step(T, k, input, 1 / 60, 0); return k; };
// Same, but the kart is kept pointing along the road so long runs don't end in a wall.
const cruise = (k, input, steps) => { for (let i = 0; i < steps; i++) { P.step(T, k, input, 1 / 60, 0); const p = P.pointAt(T, P.project(T, k.x, k.y).s); k.x = p.x; k.y = p.y; k.a = k.m = p.angle; } return k; };
// Seeded randomness so bot runs repeat exactly.
const seeded = (seed) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

test('the track is a closed loop with item boxes on the road', () => {
  assert.ok(T.length > 3000);
  assert.ok(T.boxes.length >= 6);
  T.boxes.forEach((b) => assert.ok(Math.abs(P.project(T, b.x, b.y).d) < T.width / 2));
});

test('gas accelerates up to top speed, brake slows down then reverses', () => {
  const k = kartAt(1000);
  run(k, GAS, 30);
  assert.ok(k.v > 50, 'speeds up');
  const k2 = kartAt(1000);
  cruise(k2, GAS, 300);
  assert.ok(k2.v <= P.MAX_V + 1 && k2.v > P.MAX_V * 0.6, 'near top speed: ' + k2.v);
  const fast = k2.v;
  run(k2, { brake: true }, 20);
  assert.ok(k2.v < fast - 100, 'brakes hard');
  run(k2, { brake: true }, 120);
  assert.ok(k2.v < 0, 'then reverses');
});

test('steering turns the kart, and only when it is moving', () => {
  const still = kartAt(1000), a0 = still.a;
  run(still, { right: true }, 30);
  assert.ok(Math.abs(P.wrapAngle(still.a - a0)) < 0.01, 'no turning on the spot');
  const k = kartAt(1000);
  run(k, GAS, 40);
  const a1 = k.a;
  run(k, { gas: true, right: true }, 10);
  assert.ok(P.wrapAngle(k.a - a1) > 0.1, 'right turns clockwise');
  const a2 = k.a;
  run(k, { gas: true, left: true }, 10);
  assert.ok(P.wrapAngle(k.a - a2) < -0.1, 'left turns back');
});

test('driving on the frosting is slower than the road', () => {
  const road = kartAt(1000), off = kartAt(1000, T.width / 2 + 25);
  for (let i = 0; i < 90; i++) {
    P.step(T, road, GAS, 1 / 60); P.step(T, off, GAS, 1 / 60);
    // Hold the off-road kart on the frosting.
    const p = P.project(T, off.x, off.y), at = P.pointAt(T, p.s, T.width / 2 + 25);
    off.x = at.x; off.y = at.y; off.a = off.m = at.angle;
  }
  assert.ok(off.offroad);
  assert.ok(off.v < road.v * 0.6, `${off.v} vs ${road.v}`);
});

test('walls keep karts in: driving straight at one never escapes', () => {
  for (const side of [1, -1]) {
    const k = kartAt(2000);
    k.a = k.m = k.a + side * Math.PI / 2;
    for (let i = 0; i < 600; i++) {
      P.step(T, k, GAS, 1 / 60);
      assert.ok(Math.abs(P.project(T, k.x, k.y).d) <= T.width / 2 + T.verge + 0.5);
    }
  }
});

test('a lap only counts after every checkpoint, in order', () => {
  const k = P.newKart(T, 0), L = T.length;
  const goTo = (s) => { const p = P.pointAt(T, s); k.x = p.x; k.y = p.y; k.v = 0; P.step(T, k, NONE, 1 / 60, 1); };
  goTo(10);
  assert.equal(k.lap, 1, 'crossing the line starts lap 1');
  // Shortcut: jump from early in the lap to just before the line, then cross it.
  goTo(L * 0.2); goTo(L - 20); goTo(15);
  assert.equal(k.lap, 1, 'skipping checkpoints does not count');
  // Now go round properly.
  for (let s = 30; s < L + 100; s += L / 40) goTo(s % L);
  assert.equal(k.lap, 2);
  assert.equal(k.laps.length, 1);
  // Backing over the line and forward again doesn't count twice.
  goTo(L - 10); goTo(20);
  assert.equal(k.lap, 2);
});

test('finishing: completing lap 3 marks the kart done with its time', () => {
  const k = P.newKart(T, 0), L = T.length;
  let t = 0;
  for (let lap = 0; lap < 5 && !k.done; lap++) {
    for (let s = 0; s < L && !k.done; s += L / 40) { const p = P.pointAt(T, s + 5); k.x = p.x; k.y = p.y; k.v = 0; t += 0.5; P.step(T, k, NONE, 1 / 60, t); }
  }
  assert.ok(k.done);
  assert.equal(k.lap, P.LAPS + 1);
  assert.equal(k.laps.length, P.LAPS);
  assert.ok(k.time > 0);
});

test('item effects: freeze lasts 1.5s, splat 1s, boost raises top speed then wears off', () => {
  const k = kartAt(1000);
  run(k, GAS, 100);
  P.applyEffect(k, 'freeze');
  assert.equal(k.slowKind, 'freeze');
  run(k, GAS, 30);
  assert.ok(k.v <= P.SLOW_MAX + 0.01);
  run(k, GAS, 58);
  assert.equal(k.slowKind, 'freeze', 'still frozen before 1.5s');
  run(k, GAS, 3);
  assert.equal(k.slowKind, null, 'thawed after 1.5s');
  P.applyEffect(k, 'splat');
  run(k, GAS, 58);
  assert.equal(k.slowKind, 'splat');
  run(k, GAS, 3);
  assert.equal(k.slowKind, null, 'unstuck after 1s');
  const b = kartAt(1000);
  cruise(b, GAS, 30);
  const c = { ...b, laps: [] };
  P.applyEffect(b, 'boost');
  cruise(b, GAS, 40); cruise(c, GAS, 40);
  assert.ok(b.v > c.v + 40, `boost is faster: ${b.v} vs ${c.v}`);
  cruise(b, GAS, 40);
  assert.equal(b.boostT, 0, 'and wears off');
  cruise(b, GAS, 120);
  assert.ok(b.v <= P.MAX_V + 1, 'back to normal top speed');
});

test('revenge rule: last place gets better items and the leader never gets a freeze', () => {
  const rnd = seeded(3), count = (place) => {
    const c = { freeze: 0, splat: 0, boost: 0 };
    for (let i = 0; i < 4000; i++) c[P.rollItem(place, 4, rnd)]++;
    return c;
  };
  const first = count(1), last = count(4);
  assert.equal(first.freeze, 0);
  assert.ok(last.freeze + last.boost > first.freeze + first.boost + 1000);
  assert.ok(first.splat > last.splat);
});

test('brain freeze targets the racer directly ahead', () => {
  const order = P.raceOrder([{ k: 'a', prog: 100 }, { k: 'b', prog: 900 }, { k: 'c', prog: 500 }]);
  assert.deepEqual(order.map((o) => o.k), ['b', 'c', 'a']);
  assert.equal(P.targetAhead(order, order[2]).k, 'c');
  assert.equal(P.targetAhead(order, order[0]), null);
});

test('race order: finishers by time first, then distance raced', () => {
  const order = P.raceOrder([
    { k: 'slow', prog: 9000, done: false }, { k: 'second', done: true, time: 70, prog: 1 },
    { k: 'first', done: true, time: 61, prog: 0 }, { k: 'back', prog: 200, done: false },
  ]);
  assert.deepEqual(order.map((o) => o.k), ['first', 'second', 'slow', 'back']);
});

test('jelly drops behind the kart, out of its own way', () => {
  const k = kartAt(1000), spot = P.dropSpot(k);
  const ahead = { x: k.x + Math.cos(k.a) * 10, y: k.y + Math.sin(k.a) * 10 };
  assert.ok(Math.hypot(spot.x - ahead.x, spot.y - ahead.y) > Math.hypot(spot.x - k.x, spot.y - k.y));
  assert.ok(!P.touches(k, spot, P.PUDDLE_R));
});

test('bots finish 3 laps from every grid slot, staying inside the walls', () => {
  for (let slot = 0; slot < 4; slot++) {
    const k = P.newKart(T, slot), rnd = seeded(11 + slot);
    for (let i = 0; i < 60 * 240 && !k.done; i++) {
      P.step(T, k, P.botInput(T, k, rnd, 0.85), 1 / 60, i / 60);
      assert.ok(Math.abs(P.project(T, k.x, k.y).d) <= T.width / 2 + T.verge + 0.5);
    }
    assert.ok(k.done, `slot ${slot} finished (lap ${k.lap})`);
    assert.equal(k.laps.length, P.LAPS);
  }
});

test('the grid starts behind the line with no progress yet', () => {
  for (let slot = 0; slot < 4; slot++) {
    const k = P.newKart(T, slot);
    assert.equal(k.lap, 0);
    assert.ok(k.prog <= 0);
  }
});

test('karts bump: an overlapping kart is pushed clear and loses a little speed', () => {
  const a = { x: 100, y: 100, v: 200 }, b = { x: 110, y: 100, v: 150 };
  assert.equal(P.bump(a, [b]), true);
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= P.KART_R * 2 - 1e-9);
  assert.ok(a.v < 200);
  const far = { x: 0, y: 0, v: 100 };
  assert.equal(P.bump(far, [b]), false);
  assert.equal(far.v, 100);
  // two karts on exactly the same spot still separate, and a kart never bumps itself
  const c = { x: 5, y: 5, v: 10 };
  assert.equal(P.bump(c, [c, { x: 5, y: 5, v: 0 }]), true);
});
