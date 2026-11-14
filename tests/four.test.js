// Plonk! (four in a row): drops, wins in every direction, draws, turn order and the bot.
const test = require('node:test');
const assert = require('node:assert');
const F = require('../four/rules.js');

const play = (cols, first = 'a') => { const g = F.newGame(first); cols.forEach((c) => F.drop(g, c)); return g; };

test('discs fall to the lowest empty spot and turns alternate', () => {
  const g = F.newGame('b');
  assert.deepStrictEqual(F.drop(g, 3), { c: 3, r: 0, who: 'b' });
  assert.deepStrictEqual(F.drop(g, 3), { c: 3, r: 1, who: 'a' });
  assert.strictEqual(g.turn, 'b');
  assert.strictEqual(F.drop(g, 3, 'a'), null, 'you cannot drop out of turn');
});

test('four in a row wins: across, up, and both diagonals', () => {
  assert.strictEqual(play([0, 0, 1, 1, 2, 2, 3]).winner, 'a');                   // across
  assert.strictEqual(play([0, 1, 0, 1, 0, 1, 0]).winner, 'a');                   // up
  assert.strictEqual(play([0, 1, 1, 2, 2, 3, 2, 3, 3, 6, 3]).winner, 'a');       // diagonal /
  assert.strictEqual(play([3, 2, 2, 1, 1, 0, 1, 0, 0, 6, 0]).winner, 'a');       // diagonal \
  const g = play([0, 0, 1, 1, 2, 2, 3]);
  assert.deepStrictEqual(g.line, [[0, 0], [1, 0], [2, 0], [3, 0]]);
  assert.strictEqual(F.drop(g, 4), null, 'no moves after a win');
});

test('a full column refuses more discs, and a full board with no line is a draw', () => {
  const g = play([0, 0, 0, 0, 0, 0]);
  assert.strictEqual(F.canDrop(g, 0), false);
  // a known drawn fill order
  const order = [0, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 2, 3, 2, 3, 2, 3, 3, 2, 3, 2, 3, 2, 4, 5, 4, 5, 4, 5, 5, 4, 5, 4, 5, 4, 6, 6, 6, 6, 6, 6];
  const d = play(order);
  assert.strictEqual(d.winner, null);
  assert.strictEqual(d.draw, true);
});

test('the bot takes a win when it has one and blocks yours', () => {
  const win = play([0, 6, 1, 6, 2]);  // a has 0,1,2 on the bottom; b to move: must block at 3
  assert.strictEqual(F.botMove(win, 2, () => 0.5), 3, 'blocks');
  const own = play([0, 6, 1, 6, 2, 6]); // a to move with three in a row: wins at 3
  assert.strictEqual(F.botMove(own, 1, () => 0.5), 3, 'wins');
});

test('the sharp bot beats a random player almost every time', () => {
  let wins = 0;
  for (let i = 0; i < 10; i++) {
    let s = i + 1; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const g = F.newGame(i % 2 ? 'a' : 'b');
    while (!g.winner && !g.draw) {
      const c = g.turn === 'a' ? F.botMove(g, 3, rnd) : (() => { const ok = [0, 1, 2, 3, 4, 5, 6].filter((x) => F.canDrop(g, x)); return ok[Math.floor(rnd() * ok.length)]; })();
      F.drop(g, c);
    }
    if (g.winner === 'a') wins++;
  }
  assert.ok(wins >= 9, 'bot won ' + wins + ' of 10');
});
