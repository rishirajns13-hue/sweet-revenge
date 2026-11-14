// Slingshot Island Duel: the simulation is deterministic, fair (mirrored), and its rules hold.
const test = require('node:test');
const assert = require('node:assert');
const S = require('../duel/sim.js');

test('the same shot from the same state always plays out the same (that is what keeps two screens in sync)', () => {
  const st = S.newMatch(7);
  const a = S.simulate(st, 'a', 'bomb', 0.72, 0.84), b = S.simulate(st, 'a', 'bomb', 0.72, 0.84);
  assert.strictEqual(JSON.stringify(a.state), JSON.stringify(b.state));
  assert.deepStrictEqual(a.events.map((e) => e.t), b.events.map((e) => e.t));
});

test('forts stand by themselves: a shot into the sea breaks nothing and hurts nobody', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const st = S.newMatch(seed);
    const r = S.simulate(st, 'a', 'rock', 1.45, 0.25);
    assert.strictEqual(r.events.filter((e) => e.t === 'break' || e.t === 'hurt').length, 0, 'seed ' + seed);
    assert.strictEqual(r.state.blocks.length, st.blocks.length);
  }
});

test('fair: the islands, forts and critters are mirror images', () => {
  for (let seed = 1; seed <= 6; seed++) {
    const st = S.newMatch(seed);
    for (let i = 0; i < S.N; i++) assert.ok(Math.abs(st.terrain[i] - st.terrain[S.N - 1 - i]) < 1e-6, 'terrain not mirrored');
    const left = st.blocks.filter((b) => b.seat === 'a'), right = st.blocks.filter((b) => b.seat === 'b');
    assert.strictEqual(left.length, right.length);
    left.forEach((b, i) => { assert.ok(Math.abs(b.x + right[i].x) < 1e-9 && b.y === right[i].y && b.kind === right[i].kind); });
    assert.strictEqual(st.critters.a.x, -st.critters.b.x);
  }
});

test('fair: with no wind, the same shot does about the same damage from either side', () => {
  let diffs = 0, tried = 0;
  for (const [w, ang, pow] of [['rock', 0.66, 0.84], ['bomb', 0.7, 0.85], ['rock', 0.8, 0.8], ['bounce', 0.55, 0.86]]) {
    const st = S.newMatch(11); st.wind = 0;
    const ra = S.simulate(st, 'a', w, ang, pow), sb = { ...st, shooter: 'b' }, rb = S.simulate(sb, 'b', w, ang, pow);
    const da = 100 - ra.state.critters.b.hp, db = 100 - rb.state.critters.a.hp;
    tried++; if (Math.abs(da - db) > 6) diffs++;
  }
  assert.ok(diffs <= 1, `mirrored shots differ too much in ${diffs} of ${tried}`);
});

test('ammo: special shots run out, rocks never do', () => {
  const st = S.newMatch(3);
  const W = S.build(st);
  S.fire(W, 'a', 'anvil', 0.8, 0.8);
  assert.strictEqual(W.state.ammo.a.anvil, 0);
  assert.throws(() => S.fire(W, 'a', 'anvil', 0.8, 0.8), /no ammo/);
  S.fire(W, 'a', 'rock', 0.8, 0.8);
  assert.strictEqual(W.state.ammo.a.rock, -1);
});

test('the turn passes to the other player with fresh wind, and a critter in the sea loses', () => {
  const st = S.newMatch(5);
  const r = S.simulate(st, 'a', 'rock', 1.4, 0.2);
  assert.strictEqual(r.state.shooter, 'b');
  assert.strictEqual(r.state.turn, 1);
  assert.strictEqual(r.state.wind, S.windFor(5, 1));
  const sea = JSON.parse(JSON.stringify(st));
  sea.critters.b.x = 10; sea.critters.b.y = 1.2; // dangling over the sea off the beach
  sea.terrain = sea.terrain.map((h, i) => (S.xAt(i) > 6 && S.xAt(i) < 11 ? -3 : h));
  const r2 = S.simulate(sea, 'a', 'rock', 1.45, 0.25);
  assert.strictEqual(r2.state.critters.b.hp, 0);
  assert.strictEqual(r2.state.over, true);
  assert.strictEqual(r2.state.winner, 'a');
});

test('the bot finds shots that land: over a few turns it hurts the other critter', () => {
  let st = S.newMatch(9);
  let hurt = 0;
  for (let turn = 0; turn < 4 && !st.over; turn++) {
    let seed = 1 + turn; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const shot = S.botShot(st, st.shooter, { tries: 24, error: 0, rnd });
    const before = st.critters[st.shooter === 'a' ? 'b' : 'a'].hp;
    const r = S.simulate(st, st.shooter, shot.weapon, shot.angle, shot.power);
    hurt += before - r.state.critters[st.shooter === 'a' ? 'b' : 'a'].hp;
    st = r.state;
  }
  assert.ok(hurt > 10, 'bot damage over 4 turns: ' + hurt);
});

test('a state survives JSON (it is what the network sends) and rebuilds into the same world', () => {
  const st = S.simulate(S.newMatch(2), 'a', 'bomb', 0.7, 0.85).state;
  const copy = JSON.parse(JSON.stringify(st));
  const x = S.simulate(st, 'b', 'rock', 0.7, 0.8), y = S.simulate(copy, 'b', 'rock', 0.7, 0.8);
  assert.strictEqual(JSON.stringify(x.state), JSON.stringify(y.state));
});
