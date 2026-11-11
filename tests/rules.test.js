// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../ludo/rules.js');

const names = (ps) => Object.fromEntries(ps.map((c) => [c, c]));
function game(players, opts, setup) {
  const s = R.newGame(players, names(players), opts);
  setup(s);
  return s;
}

test('a 6 is counted in stats', () => {
  const s = R.roll(R.newGame(['red', 'yellow'], names(['red', 'yellow'])), 6);
  assert.equal(s.stats.red.sixes, 1);
});

test('landing on an opponent sends it home and counts a bonk', () => {
  const s = game(['red', 'yellow'], {}, (g) => {
    g.tokens.red[0] = 2;      // abs 2
    g.tokens.yellow[0] = 31;  // abs (26 + 31) % 52 = 5
    g.phase = 'move'; g.dice = 3;
  });
  const next = R.move(s, 0);
  assert.equal(next.tokens.yellow[0], -1);
  assert.equal(next.stats.red.bonks, 1);
  assert.equal(next.phase, 'roll');
  assert.equal(R.current(next), 'red'); // bonus roll
});

test('teams pair seats 1+3 and 2+4', () => {
  const s = R.newGame(['red', 'green', 'yellow', 'blue'], names(['red', 'green', 'yellow', 'blue']), { teams: true });
  assert.deepEqual(s.teams, [['red', 'yellow'], ['green', 'blue']]);
});

test('teams are ignored without exactly 4 players', () => {
  const s = R.newGame(['red', 'green', 'yellow'], names(['red', 'green', 'yellow']), { teams: true });
  assert.equal(s.teams, null);
});

test('teammates share a square instead of bonking', () => {
  const s = game(['red', 'green', 'yellow', 'blue'], { teams: true }, (g) => {
    g.tokens.red[0] = 2;
    g.tokens.yellow[0] = 31; // abs 5, red's partner
    g.phase = 'move'; g.dice = 3;
  });
  const next = R.move(s, 0);
  assert.equal(next.tokens.yellow[0], 31);
  assert.equal(next.events[0].captured.length, 0);
});

test('without teams the first player home wins', () => {
  const s = game(['red', 'green', 'yellow'], {}, (g) => {
    g.tokens.red = [56, 56, 56, 53];
    g.phase = 'move'; g.dice = 3;
  });
  const next = R.move(s, 3);
  assert.equal(next.phase, 'over');
  assert.equal(next.winner, 'red');
  assert.deepEqual(next.winners, ['red']);
});

test('in teams, finishing first skips your turns until your partner finishes', () => {
  const s = game(['red', 'green', 'yellow', 'blue'], { teams: true }, (g) => {
    g.tokens.red = [56, 56, 56, 53];
    g.phase = 'move'; g.dice = 3;
  });
  let next = R.move(s, 3);
  assert.equal(next.phase, 'roll');
  assert.equal(next.events[0].finished, true);
  assert.equal(R.current(next), 'green');
  // play green, yellow, blue with no moves; red must be skipped
  for (const c of ['green', 'yellow', 'blue']) {
    assert.equal(R.current(next), c);
    next = R.roll(next, 1); // all in base, 1 = no move
  }
  assert.equal(R.current(next), 'green');
});

test('in teams, the game ends when both partners are home', () => {
  const s = game(['red', 'green', 'yellow', 'blue'], { teams: true }, (g) => {
    g.tokens.red = [56, 56, 56, 56];
    g.tokens.yellow = [56, 56, 56, 55];
    g.turn = 2; g.phase = 'move'; g.dice = 1;
  });
  const next = R.move(s, 3);
  assert.equal(next.phase, 'over');
  assert.deepEqual(next.winners, ['red', 'yellow']);
});

test('3 players take turns in seat order', () => {
  let s = R.newGame(['red', 'green', 'yellow'], names(['red', 'green', 'yellow']));
  const order = [];
  for (let k = 0; k < 4; k++) { order.push(R.current(s)); s = R.roll(s, 2); }
  assert.deepEqual(order, ['red', 'green', 'yellow', 'red']);
});

test('turns are counted', () => {
  let s = R.newGame(['red', 'yellow'], names(['red', 'yellow']));
  s = R.roll(s, 2); s = R.roll(s, 3);
  assert.equal(s.turns, 2);
});

test('every bonk is logged as [bonker, victim] so the history knows who bonked whom', () => {
  const s = game(['red', 'yellow'], {}, (g) => {
    g.tokens.red[0] = 2;      // abs 2
    g.tokens.yellow[0] = 31;  // abs 5
    g.phase = 'move'; g.dice = 3;
  });
  assert.deepEqual(R.newGame(['red', 'yellow'], names(['red', 'yellow'])).hits, []);
  assert.deepEqual(R.move(s, 0).hits, [['red', 'yellow']]);
});
