// Fairness: the shared random source is unbiased, and every game lets any seat start.
const test = require('node:test');
const assert = require('node:assert');
const RNG = require('../shared/rng.js');

// Chi-square goodness of fit; the critical values are for p = 0.001, so a fair source fails about 1 run in 1000.
function chi(counts, expected) { return counts.reduce((s, c) => s + ((c - expected) ** 2) / expected, 0); }

test('dice: every face equally likely (100k rolls)', () => {
  const c = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 100000; i++) { const d = RNG.die(); assert.ok(d >= 1 && d <= 6); c[d - 1]++; }
  assert.ok(chi(c, 100000 / 6) < 20.52, 'chi-square ' + chi(c, 100000 / 6).toFixed(2) + ' counts ' + c);
});

test('int(n) is unbiased for awkward n too (n = 7, 52, 1000)', () => {
  for (const [n, lim] of [[7, 22.46], [52, 87.97], [1000, 1143.9]]) {
    const c = new Array(n).fill(0), N = n * 200;
    for (let i = 0; i < N; i++) c[RNG.int(n)]++;
    assert.ok(chi(c, 200) < lim, `n=${n}: chi-square ${chi(c, 200).toFixed(1)}`);
  }
  assert.throws(() => RNG.int(0));
});

test('shuffle: every position equally likely for every card (4 cards, 60k shuffles)', () => {
  const c = Array.from({ length: 4 }, () => [0, 0, 0, 0]);
  for (let i = 0; i < 60000; i++) RNG.shuffle([0, 1, 2, 3]).forEach((card, pos) => c[card][pos]++);
  for (const row of c) assert.ok(chi(row, 15000) < 16.27, 'chi-square ' + chi(row, 15000).toFixed(2));
});

test('seed31 stays in 1..2^31-1', () => {
  for (let i = 0; i < 10000; i++) { const s = RNG.seed31(); assert.ok(Number.isInteger(s) && s >= 1 && s <= 0x7fffffff); }
});

test('Ludo, Snakes and Plus Four start with whichever seat the host picks', () => {
  const LR = require('../ludo/rules.js'), SR = require('../snakes/rules.js'), PR = require('../plusfour/rules.js');
  const Ludo = LR.newGame ? LR : LR.LudoRules || LR;
  assert.strictEqual(Ludo.newGame(['red', 'green'], {}, { first: 1 }).turn, 1);
  assert.strictEqual(Ludo.newGame(['red', 'green'], {}, { first: 9 }).turn, 0, 'bad first falls back to seat 0');
  const seats = [{ k: 'a', name: 'A' }, { k: 'b', name: 'B' }, { k: 'c', name: 'C' }];
  assert.strictEqual(SR.newGame(seats, 5, 2).turn, 2);
  for (let seed = 1; seed < 300; seed++) {
    const g = PR.newGame(seats, seed, 1);
    const first = g.discard[0];
    // a Reverse first card in a 3-player game hands play to the seat before the starter; Skip to the one after
    const expect = first.v === 'rev' ? 0 : first.v === 'skip' ? 2 : 1;
    assert.strictEqual(g.turn, expect, `seed ${seed}, first card ${first.v}`);
  }
});
