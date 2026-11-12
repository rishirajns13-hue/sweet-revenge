// Run with: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../scoop/rules.js');

// A tiny seeded random, so the simulated round is the same every run.
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

test('a slightly off drop keeps only the overlap', () => {
  const t = R.newTower();
  const r = R.drop(t, 20);
  assert.equal(r.kind, 'stack');
  assert.equal(t.height, 1);
  assert.equal(t.w, R.START_W - 20);
  assert.equal(t.x, 10); // centre of the overlap
  assert.equal(r.cut.w, 20);
  assert.ok(r.cut.x > t.x); // the overhang falls off the right side
  assert.equal(t.lives, R.LIVES);
});

test('a total miss, or too much overhang, is a splat and costs a life', () => {
  const t = R.newTower();
  assert.equal(R.drop(t, 200).kind, 'splat');
  assert.equal(t.height, 0);
  assert.equal(t.lives, R.LIVES - 1);
  assert.equal(t.splats, 1);
  // 90 off on a 120 scoop keeps only 30 (< 35%): falls off
  assert.equal(R.drop(t, -90).kind, 'splat');
  assert.equal(t.w, R.START_W); // a splat doesn't shrink the tower
});

test('a near-perfect drop snaps to the centre and grows back a bit', () => {
  const t = R.newTower();
  R.drop(t, 30); // narrows to 90, centre 15
  const r = R.drop(t, 15 + R.PERFECT - 1);
  assert.equal(r.kind, 'perfect');
  assert.equal(t.x, 15);
  assert.equal(t.w, 90 + R.GROW);
  assert.equal(t.perfects, 1);
  // never grows past the starting width
  const u = R.newTower();
  R.drop(u, 0);
  assert.equal(u.w, R.START_W);
});

test('three splats and you are out; no more drops count', () => {
  const t = R.newTower();
  R.drop(t, 0);
  for (let i = 0; i < 3; i++) R.drop(t, 999);
  assert.equal(t.lives, 0);
  assert.equal(t.out, true);
  assert.equal(R.drop(t, 0).kind, 'none');
  assert.equal(t.height, 1);
});

test('the swing speeds up as the tower grows, and a wobble makes it wilder', () => {
  assert.ok(R.speed(10) > R.speed(0));
  assert.ok(R.speed(20) > R.speed(10));
  assert.ok(R.speed(500) <= 6.4); // capped
  assert.ok(R.speed(5, true) > R.speed(5));
  const t = R.newTower();
  for (let i = 0; i < 100; i++) assert.ok(Math.abs(R.step(t, 16)) <= R.FIELD / 2);
});

test('three perfects in a row charge a wobble; a miss resets the streak; using it spends it', () => {
  const t = R.newTower();
  R.drop(t, 0); R.drop(t, 0);
  R.drop(t, 40); // streak broken
  assert.equal(t.streak, 0);
  R.drop(t, t.x); R.drop(t, t.x);
  assert.equal(t.charged, false);
  const r = R.drop(t, t.x);
  assert.equal(r.charged, true);
  assert.equal(t.charged, true);
  assert.equal(t.streak, 0);
  assert.equal(R.useWobble(t), true);
  assert.equal(t.charged, false);
  assert.equal(t.wobblesSent, 1);
  assert.equal(R.useWobble(t), false);
});

test('a wobble lasts four seconds', () => {
  const t = R.newTower();
  R.hitByWobble(t, 1000);
  assert.equal(R.wobbling(t, 4999), true);
  assert.equal(R.wobbling(t, 5001), false);
});

test('ranking: tallest wins, ties broken by perfects, exact ties share a place', () => {
  const ranked = R.rank([
    { k: 'a', h: 10, perfects: 1, splats: 1 }, { k: 'b', h: 12, perfects: 0, splats: 3 },
    { k: 'c', h: 10, perfects: 4, splats: 1 }, { k: 'd', h: 10, perfects: 1, splats: 1 },
  ]);
  assert.deepEqual(ranked.map((s) => s.k), ['b', 'c', 'a', 'd']);
  assert.deepEqual(ranked.map((s) => s.place), [1, 2, 3, 3]);
  assert.deepEqual(R.winners(ranked).map((s) => s.k), ['b']);
});

test('the round ends at 90 seconds or when everyone is out', () => {
  assert.equal(R.roundOver([{ out: false }, { out: true }], 1000), false);
  assert.equal(R.roundOver([{ out: true }, { out: true }], 1000), true);
  assert.equal(R.roundOver([{ out: false }], R.DURATION), true);
});

test('a wobble goes to the tallest tower that is still in', () => {
  const s = [{ k: 'a', h: 3 }, { k: 'b', h: 9, out: true }, { k: 'c', h: 5 }];
  assert.equal(R.wobbleTarget(s, 'a'), 'c');
  assert.equal(R.wobbleTarget([{ k: 'a', h: 1 }], 'a'), null);
});

test('a bot-only round plays out and ends with a winner', () => {
  const rand = rng(7);
  const bots = ['ann', 'ben', 'cat'].map((k, i) => ({ k, t: R.newTower(), skill: 0.4 + i * 0.2, next: 800 }));
  let now = 0;
  const scores = () => bots.map((b) => ({ k: b.k, ...R.summary(b.t) }));
  while (!R.roundOver(scores(), now)) {
    now += 16;
    bots.forEach((b) => {
      R.step(b.t, 16, now);
      if (b.t.out || now < b.next) return;
      R.drop(b.t, R.botAim(b.t, rand, b.skill, R.wobbling(b.t, now)));
      b.next = now + 700 + rand() * 700;
      if (b.t.charged && R.useWobble(b.t)) {
        const to = bots.find((x) => x.k === R.wobbleTarget(scores(), b.k));
        if (to) R.hitByWobble(to.t, now);
      }
    });
  }
  const ranked = R.rank(scores());
  assert.ok(now <= R.DURATION + 16);
  assert.ok(ranked[0].h > 0);
  assert.equal(ranked[0].place, 1);
  assert.ok(R.winners(ranked).length >= 1);
  assert.ok(bots.some((b) => b.t.perfects > 0));
});
