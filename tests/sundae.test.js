const test = require('node:test');
const assert = require('node:assert');
const S = require('../sundae/rules.js');

const C = (o = {}) => ({ batch: 'SR-A1B2', odd: false, cone: 'sugar', cherries: 0, ...o });

test('the same seed builds the same bomb (both screens agree)', () => {
  assert.deepEqual(S.makeBomb(42), S.makeBomb(42));
  assert.notDeepEqual(S.makeBomb(42).machine, S.makeBomb(43).machine);
});

test('every bomb is solvable: answers are in range', () => {
  for (let seed = 1; seed < 400; seed++) {
    const b = S.makeBomb(seed);
    assert.ok(b.answer.tubes >= 0 && b.answer.tubes < b.machine.tubes.length, 'tube in range');
    assert.ok(b.answer.stack >= 1 && b.answer.stack <= 4, 'lever 1-4');
    assert.ok(Number.isInteger(b.answer.thermo), 'whole degrees');
    assert.equal(b.book.tubes.length, S.TUBE_RULES[b.machine.tubes.length].length);
  }
});

test('syrup tube rules read top to bottom', () => {
  assert.equal(S.tubesAnswer(['mint', 'blue', 'choc'], C()), 1);              // no pink -> second
  assert.equal(S.tubesAnswer(['pink', 'mint', 'vanilla'], C()), 2);           // last vanilla -> last
  assert.equal(S.tubesAnswer(['blue', 'pink', 'blue'], C()), 2);              // >1 blue -> last blue
  assert.equal(S.tubesAnswer(['pink', 'mint', 'choc'], C()), 0);              // otherwise first
  assert.equal(S.tubesAnswer(['pink', 'pink', 'mint', 'choc'], C({ odd: true })), 1); // last pink
  assert.equal(S.tubesAnswer(['mint', 'mint', 'mint', 'mint'], C({ cone: 'waffle' })), 3);
  assert.equal(S.tubesAnswer(['pink', 'pink', 'pink', 'pink', 'pink', 'pink'], C({ cone: 'waffle' })), 3);
});

test('scoop stack: card first, then the chocolate fallback', () => {
  const card = [{ stack: ['pink', 'mint', 'choc'], lever: 4 }];
  assert.equal(S.stackAnswer(['pink', 'mint', 'choc'], card), 4);
  assert.equal(S.stackAnswer(['choc', 'choc', 'mint'], card), 3);
  assert.equal(S.stackAnswer(['mint', 'mint', 'mint'], card), 1);
});

test('thermostat: base, minus 2 per cherry, sugar cone +1', () => {
  assert.equal(S.thermoAnswer('mint', C({ cherries: 0, cone: 'waffle' })), -10);
  assert.equal(S.thermoAnswer('mint', C({ cherries: 2, cone: 'sugar' })), -13);
});

test('a match: operator acts, mistakes strike and melt time, three solved defuses, roles swap', () => {
  const G = S.newMatch([{ k: 'a', name: 'A' }, { k: 'b', name: 'B' }], 7);
  S.nextBomb(G, 0);
  assert.equal(G.bomb.operator, 'a');
  const bomb = S.makeBomb(G.bomb.seed);
  assert.equal(S.act(G, 'b', 'tubes', bomb.answer.tubes, 1).ok, false); // the reader can't act
  const before = G.bomb.endsAt;
  assert.equal(S.act(G, 'a', 'thermo', bomb.answer.thermo + 1, 1).right, false);
  assert.equal(G.bomb.strikes, 1);
  assert.equal(G.bomb.endsAt, before - 15000);
  for (const m of S.MODULES) S.act(G, 'a', m, bomb.answer[m], 2);
  assert.equal(G.bomb.over, 'defused');
  S.nextBomb(G, 10);
  assert.equal(G.bomb.operator, 'b');
});

test('three strikes or running out of time is a splat', () => {
  const G = S.newMatch([{ k: 'a' }, { k: 'b' }], 9);
  S.nextBomb(G, 0);
  for (let i = 0; i < 3; i++) S.act(G, 'a', 'stack', 99, 1);
  assert.equal(G.bomb.over, 'splat');
  S.nextBomb(G, 0);
  S.tick(G, S.BOMB_SECONDS * 1000 + 1);
  assert.equal(G.bomb.over, 'splat');
});
