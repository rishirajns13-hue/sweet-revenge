// Run with: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../snakes/rules.js');

const players = (n) => ['ann', 'ben', 'cat', 'dan'].slice(0, n).map((k) => ({ k, name: k, avatar: '🤖', bot: true }));
function game(n, extra = {}) {
  const G = R.newGame(players(n), 7);
  Object.assign(G, extra);
  return G;
}

test('board squares wind back and forth from the bottom left', () => {
  assert.deepEqual(R.coord(1), { row: 0, col: 0 });
  assert.deepEqual(R.coord(10), { row: 0, col: 9 });
  assert.deepEqual(R.coord(11), { row: 1, col: 9 });
  assert.deepEqual(R.coord(20), { row: 1, col: 0 });
  assert.deepEqual(R.coord(21), { row: 2, col: 0 });
  assert.deepEqual(R.coord(100), { row: 9, col: 0 });
  const seen = new Set();
  for (let n = 1; n <= 100; n++) { const c = R.coord(n); seen.add(c.row * 10 + c.col); }
  assert.equal(seen.size, 100);
});

test('snakes go down, ladders go up, and none chain into each other', () => {
  const starts = new Set([...Object.keys(R.SNAKES), ...Object.keys(R.LADDERS)].map(Number));
  for (const [h, t] of Object.entries(R.SNAKES)) { assert.ok(t < +h); assert.ok(!starts.has(t)); assert.notEqual(+h, 100); }
  for (const [f, t] of Object.entries(R.LADDERS)) { assert.ok(t > +f); assert.ok(!starts.has(t)); }
  assert.ok(Object.keys(R.SNAKES).length >= 8 && Object.keys(R.LADDERS).length >= 8);
});

test('landing on a ladder foot climbs it and counts it', () => {
  const G = game(2);
  R.roll(G, 'ann', 3); // 1 -> 4 -> 14
  assert.equal(G.pos.ann, 14);
  assert.equal(G.stats.ann.ladders, 1);
  assert.equal(G.stats.ann.longest, 10);
  assert.equal(G.lastFoot.ann, 4);
  assert.ok(G.events.some((e) => e.t === 'ladder' && e.from === 4 && e.to === 14));
});

test('landing on a snake head slides down and counts it', () => {
  const G = game(2);
  G.pos.ann = 14;
  R.roll(G, 'ann', 3); // 17 -> 7
  assert.equal(G.pos.ann, 7);
  assert.equal(G.stats.ann.snakes, 1);
  assert.ok(G.events.some((e) => e.t === 'snake' && e.from === 17 && e.to === 7));
});

test('you need the exact roll for 100; extra bounces back', () => {
  const G = game(2);
  G.pos.ann = 97;
  R.roll(G, 'ann', 5); // 98, 99, 100, 99, 98 -> snake 98 -> 79
  const mv = G.events.find((e) => e.t === 'move');
  assert.deepEqual(mv.path, [98, 99, 100, 99, 98]);
  assert.equal(mv.bounce, true);
  assert.equal(G.pos.ann, 79);
  const H = game(2);
  H.pos.ann = 96;
  R.roll(H, 'ann', 5); // 101 -> 99
  assert.equal(H.pos.ann, 99);
  assert.equal(H.winner, null);
  R.roll(H, 'ben', 2);
  R.roll(H, 'ann', 1);
  assert.equal(H.winner, 'ann');
});

test('only the current player can roll, and not after the game ends', () => {
  const G = game(2);
  assert.equal(R.roll(G, 'ben').why, 'turn');
  G.winner = 'ann';
  assert.equal(R.roll(G, 'ann').why, 'over');
});

test('a 6 rolls again, but only three times in a row', () => {
  const G = game(2);
  G.pos.ann = 30;
  R.roll(G, 'ann', 6);
  assert.equal(R.cur(G), 'ann');
  R.roll(G, 'ann', 6);
  assert.equal(R.cur(G), 'ann');
  R.roll(G, 'ann', 6);
  assert.equal(R.cur(G), 'ben');
  assert.equal(G.streak, 0);
  assert.equal(G.stats.ann.sixes, 3);
  // A normal roll passes the turn and resets the streak
  R.roll(G, 'ben', 2);
  assert.equal(R.cur(G), 'ann');
});

test('landing on someone bonks them to the foot of their last ladder', () => {
  const G = game(2);
  G.pos.ann = 33; G.pos.ben = 30; G.lastFoot.ann = 9;
  G.turn = 1;
  R.roll(G, 'ben', 3);
  assert.equal(G.pos.ben, 33);
  assert.equal(G.pos.ann, 9);
  assert.deepEqual(G.hits, [{ by: 'ben', to: 'ann' }]);
  assert.equal(G.stats.ben.bonksGiven, 1);
  assert.equal(G.stats.ann.bonksTaken, 1);
  assert.ok(G.events.some((e) => e.t === 'bonk' && e.k === 'ann' && e.by === 'ben' && e.to === 9));
});

test('a bonk with no ladder climbed goes back to square 1; bonks work after a ladder too', () => {
  const G = game(3);
  G.pos.ben = 14; G.pos.cat = 14;
  R.roll(G, 'ann', 3); // climbs 4 -> 14, lands on both
  assert.equal(G.pos.ann, 14);
  assert.equal(G.pos.ben, 1);
  assert.equal(G.pos.cat, 1);
  assert.equal(G.hits.length, 2);
  assert.equal(G.stats.ann.bonksGiven, 2);
});

function playOut(n, seed) {
  const G = R.newGame(players(n), seed);
  let moves = 0;
  while (!G.winner && moves < 5000) {
    const k = R.cur(G);
    const m = R.botMove(G, k);
    assert.equal(m.t, 'roll');
    assert.equal(R.roll(G, k).ok, true);
    for (const p of G.players) assert.ok(G.pos[p.k] >= 1 && G.pos[p.k] <= 100);
    G.events = [];
    moves++;
  }
  return G;
}

for (const n of [2, 3, 4]) {
  test(`a bot-only game with ${n} players finishes with a winner`, () => {
    for (let seed = 1; seed <= 30; seed++) {
      const G = playOut(n, seed);
      assert.ok(G.winner, `seed ${seed} never finished`);
      assert.equal(G.pos[G.winner], 100);
      const rank = R.ranking(G);
      assert.equal(rank[0].k, G.winner);
      assert.equal(rank.length, n);
      const st = Object.values(G.stats);
      assert.equal(st.reduce((a, s) => a + s.bonksGiven, 0), G.hits.length);
      assert.equal(st.reduce((a, s) => a + s.bonksTaken, 0), G.hits.length);
    }
  });
}

test('the same seed rolls the same game; the view survives JSON', () => {
  const a = playOut(3, 99), b = playOut(3, 99);
  assert.deepEqual(a.pos, b.pos);
  assert.equal(a.winner, b.winner);
  const v = R.viewFor(a);
  assert.deepEqual(JSON.parse(JSON.stringify(v)), v);
});
