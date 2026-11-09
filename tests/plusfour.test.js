// Run with: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../plusfour/rules.js');

const players = (n) => ['ann', 'ben', 'cat', 'dan'].slice(0, n).map((k) => ({ k, name: k }));
const card = (id) => R.newDeck().find((c) => c.id === id);
// A game with chosen hands and a chosen top card, so each test controls the table.
function table(n, hands, topId, extra = {}) {
  const G = R.newGame(players(n), 7);
  Object.keys(G.hands).forEach((k, i) => { G.hands[k] = (hands[i] || ['r5a']).map(card); });
  G.discard = [card(topId)];
  G.color = G.discard[0].c;
  Object.assign(G, { turn: 0, dir: 1, pending: 0, pendingKind: null, drawn: null, ouch: null, events: [] }, extra);
  return G;
}

test('the deck has 108 cards with unique ids', () => {
  const d = R.newDeck();
  assert.equal(d.length, 108);
  assert.equal(new Set(d.map((c) => c.id)).size, 108);
  assert.equal(d.filter((c) => c.v === 'w4').length, 4);
  assert.equal(d.filter((c) => c.c === 'r' && c.v === '0').length, 1);
  assert.equal(d.filter((c) => c.c === 'b' && c.v === 'd2').length, 2);
});

test('a new game deals 7 each and never starts on a Wild +4', () => {
  for (let seed = 1; seed < 200; seed++) {
    const G = R.newGame(players(3), seed);
    Object.values(G.hands).forEach((h) => assert.equal(h.length, 7));
    assert.notEqual(R.top(G).v, 'w4');
    assert.equal(G.draw.length + G.discard.length + 21, 108);
  }
});

test('the same seed shuffles the same way', () => {
  assert.deepEqual(R.newGame(players(2), 42).hands, R.newGame(players(2), 42).hands);
});

test('match by colour, by number or symbol, or play a wild', () => {
  const G = table(2, [['r2a', 'b7a', 'g9a', 'wild1', 'yskipa']], 'r7a');
  const ok = R.legalMoves(G, 'ann').map((c) => c.id).sort();
  assert.deepEqual(ok, ['b7a', 'r2a', 'wild1']);
});

test('a wild needs a colour and sets it', () => {
  const G = table(2, [['wild1', 'r1a'], ['b1a']], 'g3a');
  assert.equal(R.play(G, 'ann', 'wild1').ok, false);
  assert.equal(R.play(G, 'ann', 'wild1', 'y').ok, true);
  assert.equal(G.color, 'y');
  assert.equal(R.cur(G), 'ben');
});

test('you can only play on your turn, and only cards you hold', () => {
  const G = table(2, [['r1a', 'r2a'], ['r3a']], 'r7a');
  assert.equal(R.play(G, 'ben', 'r3a').why, 'turn');
  assert.equal(R.play(G, 'ann', 'r3a').why, 'card');
});

test('skip jumps a player; reverse flips direction with 3+', () => {
  let G = table(3, [['rskipa', 'r1a'], ['r1b'], ['r2b']], 'r7a');
  R.play(G, 'ann', 'rskipa');
  assert.equal(R.cur(G), 'cat');
  G = table(3, [['rreva', 'r1a'], ['r1b'], ['r2b']], 'r7a');
  R.play(G, 'ann', 'rreva');
  assert.equal(G.dir, -1);
  assert.equal(R.cur(G), 'cat');
});

test('with two players, reverse works like skip', () => {
  const G = table(2, [['rreva', 'r1a'], ['r1b']], 'r7a');
  R.play(G, 'ann', 'rreva');
  assert.equal(R.cur(G), 'ann');
});

test('+2s stack, then the stuck player draws the lot and loses the turn', () => {
  const G = table(3, [['rd2a', 'r1a'], ['bd2a', 'b1a'], ['g1a', 'g2a']], 'r7a');
  R.play(G, 'ann', 'rd2a');
  assert.equal(G.pending, 2);
  // ben can only stack now, not play a normal card
  assert.deepEqual(R.legalMoves(G, 'ben').map((c) => c.id), ['bd2a']);
  R.play(G, 'ben', 'bd2a');
  assert.equal(G.pending, 4);
  assert.equal(G.stats.ben.stacked, 1);
  R.draw(G, 'cat');
  assert.equal(G.hands.cat.length, 6);
  assert.equal(G.pending, 0);
  assert.equal(R.cur(G), 'ann');
});

test('a +4 stacks on a +2, but a +2 cannot go on a +4', () => {
  let G = table(2, [['rd2a', 'r1a'], ['w41', 'b1a']], 'r7a');
  R.play(G, 'ann', 'rd2a');
  assert.equal(R.play(G, 'ben', 'w41', 'g').ok, true);
  assert.equal(G.pending, 6);
  G = table(2, [['w41', 'r1a'], ['bd2a', 'b1a']], 'r7a');
  R.play(G, 'ann', 'w41', 'b');
  assert.deepEqual(R.legalMoves(G, 'ben'), []);
});

test('drawing a playable card lets you play it or pass; a dud passes for you', () => {
  let G = table(2, [['b1a', 'b2a'], ['g1a']], 'r7a');
  G.draw = [card('r3a')];
  R.draw(G, 'ann');
  assert.equal(G.drawn, 'r3a');
  assert.equal(R.cur(G), 'ann');
  assert.equal(R.play(G, 'ann', 'b1a').why, 'drawn');
  assert.equal(R.pass(G, 'ann').ok, true);
  assert.equal(R.cur(G), 'ben');
  G = table(2, [['b1a', 'b2a'], ['g1a']], 'r7a');
  G.draw = [card('g3a')];
  R.draw(G, 'ann');
  assert.equal(G.drawn, null);
  assert.equal(R.cur(G), 'ben');
});

test('an empty draw pile reshuffles the discards, keeping the top card', () => {
  const G = table(2, [['b1a', 'b2a'], ['g1a']], 'r7a');
  G.draw = [];
  G.discard = [card('y1a'), card('y2a'), card('r7a')];
  R.draw(G, 'ann');
  assert.equal(R.top(G).id, 'r7a');
  assert.equal(G.discard.length, 1);
  assert.equal(G.hands.ann.length, 3);
  assert.ok(G.events.some((e) => e.t === 'reshuffle'));
});

test('forget to shout Ouch! and you can be caught for 2 cards', () => {
  const G = table(2, [['r1a', 'r2a'], ['b1a', 'b2a']], 'r7a');
  G.draw = R.newDeck().slice(0, 10);
  R.play(G, 'ann', 'r1a');
  assert.deepEqual(G.ouch, { k: 'ann', said: false });
  assert.equal(R.catchOut(G, 'ann', 'ann').ok, false);
  assert.equal(R.catchOut(G, 'ben', 'ann').ok, true);
  assert.equal(G.hands.ann.length, 3);
  assert.equal(G.stats.ann.caught, 1);
});

test('shouting in time, or before playing, makes you safe', () => {
  let G = table(2, [['r1a', 'r2a'], ['b1a', 'b2a']], 'r7a');
  R.play(G, 'ann', 'r1a');
  assert.equal(R.shout(G, 'ann').ok, true);
  assert.equal(R.catchOut(G, 'ben', 'ann').ok, false);
  G = table(2, [['r1a', 'r2a'], ['b1a', 'b2a']], 'r7a');
  assert.equal(R.shout(G, 'ann').ok, true);
  R.play(G, 'ann', 'r1a');
  assert.equal(G.ouch.said, true);
});

test('the catch window closes once the next player acts', () => {
  const G = table(2, [['r1a', 'r2a'], ['r3a', 'b2a']], 'r7a');
  R.play(G, 'ann', 'r1a');
  R.play(G, 'ben', 'r3a');
  assert.equal(R.catchOut(G, 'ben', 'ann').ok, false);
});

test('playing your last card wins', () => {
  const G = table(2, [['r1a'], ['b1a']], 'r7a');
  R.play(G, 'ann', 'r1a');
  assert.equal(G.winner, 'ann');
  assert.equal(R.play(G, 'ben', 'b1a').why, 'over');
});

test('views hide other hands and other people\'s drawn cards', () => {
  const G = table(2, [['b1a', 'b2a'], ['g1a']], 'r7a');
  G.draw = [card('y3a')];
  R.draw(G, 'ann');
  const v = R.viewFor(G, 'ben');
  assert.equal(v.hand.length, 1);
  assert.equal(v.players[0].n, 3);
  assert.equal(v.hands, null);
  const [mine] = R.eventsFor(G.events.filter((e) => e.t === 'draw'), 'ann');
  const [theirs] = R.eventsFor(G.events.filter((e) => e.t === 'draw'), 'ben');
  assert.equal(mine.cards[0].id, 'y3a');
  assert.equal(theirs.cards, undefined);
  assert.equal(theirs.n, 1);
});

test('bots always make a legal move and games end', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const G = R.newGame(players(2 + (seed % 3)), seed);
    let guard = 0;
    while (!G.winner && guard++ < 3000) {
      const k = R.cur(G), m = R.botMove(G, k);
      const r = m.t === 'play' ? R.play(G, k, m.id, m.color) : m.t === 'pass' ? R.pass(G, k) : R.draw(G, k);
      assert.ok(r.ok, `seed ${seed}: ${JSON.stringify(m)} → ${r.why}`);
      if (G.ouch && !G.ouch.said) R.shout(G, G.ouch.k);
    }
    assert.ok(G.winner, `seed ${seed} never finished`);
    const total = Object.values(G.hands).flat().length + G.draw.length + G.discard.length;
    assert.equal(total, 108);
  }
});
