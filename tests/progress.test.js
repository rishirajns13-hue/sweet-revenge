// Run with: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../api/progress.mjs');

const g = (o = {}) => ({ kind: 'ludo', practice: false, won: false, bonks: 0, bombs: 0, bombCards: 0, score: 0, fastest: 0, ...o });
const facts = (o = {}) => ({ games: [], bigBomb: 0, maxBonkedInGame: 0, revengeBonk: false, revengeBomb: false, chats: 0, ...o });
const ach = (f, id) => P.progress(f).achievements.find((a) => a.id === id);

test('XP: play +10, win +25, bonk +3, bomb +1 per card; practice is half', () => {
  assert.equal(P.xpFor(facts({ games: [g()] })), 10);
  assert.equal(P.xpFor(facts({ games: [g({ won: true, bonks: 2 })] })), 41);
  assert.equal(P.xpFor(facts({ games: [g({ kind: 'plusfour', bombCards: 6 })] })), 16);
  assert.equal(P.xpFor(facts({ games: [g({ practice: true, won: true })] })), 17);
});

test('levels climb by XP thresholds and the last level has no ceiling', () => {
  assert.deepEqual(P.levelFor(0), { level: 1, title: 'Sprinkle', xp: 0, from: 0, to: 100 });
  assert.equal(P.levelFor(99).level, 1);
  assert.equal(P.levelFor(100).title, 'Single Scoop');
  const top = P.levelFor(99999);
  assert.equal(top.level, P.LEVELS.length);
  assert.equal(top.to, null);
});

test('achievements report progress and unlock at their goal', () => {
  const bonky = facts({ games: [g({ bonks: 30 }), g({ bonks: 20 })] });
  assert.equal(ach(bonky, 'first_bonk').done, true);
  assert.deepEqual([ach(bonky, 'bonk_machine').have, ach(bonky, 'bonk_machine').done], [50, true]);
  assert.deepEqual([ach(facts(), 'bonk_machine').have, ach(facts(), 'bonk_machine').done], [0, false]);
});

test('On Fire needs 3 wins in a row, not just 3 wins', () => {
  const games = [true, true, false, true, true].map((won) => g({ won }));
  assert.equal(ach(facts({ games }), 'on_fire').done, false);
  assert.equal(ach(facts({ games: games.concat(g({ won: true })) }), 'on_fire').done, true);
});

test('All-Rounder needs a win in every mini-game', () => {
  const games = [g({ kind: 'ludo', won: true }), g({ kind: 'plusfour', won: true })];
  assert.equal(ach(facts({ games }), 'all_rounder').have, 2);
  assert.equal(ach(facts({ games: games.concat(g({ kind: 'doodle', won: true })) }), 'all_rounder').have, 3);
});

test('one-off feats: big bomb, revenge, punching bag, mind reader', () => {
  assert.equal(ach(facts({ bigBomb: 8 }), 'special_delivery').done, true);
  assert.equal(ach(facts({ bigBomb: 6 }), 'special_delivery').done, false);
  assert.equal(ach(facts({ revengeBonk: true }), 'sweet_revenge').done, true);
  assert.equal(ach(facts({ revengeBomb: true }), 'return_to_sender').done, true);
  assert.equal(ach(facts({ maxBonkedInGame: 10 }), 'punching_bag').done, true);
  assert.equal(ach(facts({ games: [g({ kind: 'doodle', fastest: 4200 })] }), 'mind_reader').done, true);
  assert.equal(ach(facts({ games: [g({ kind: 'doodle', fastest: 0 })] }), 'mind_reader').done, false);
});

test('new games: snake slides, long ladders, photo finishes and splats unlock trophies', () => {
  const sn = (o) => g({ kind: 'snakes', ...o }), rc = (o) => g({ kind: 'race', ...o });
  assert.equal(ach(facts({ games: [sn({ snakesSlid: 2 }), sn({ snakesSlid: 2 })] }), 'slippery_slope').done, false);
  assert.equal(ach(facts({ games: [sn({ snakesSlid: 3 })] }), 'slippery_slope').done, true);
  assert.equal(ach(facts({ games: [sn({ longestLadder: 29 })] }), 'sky_high').done, false);
  assert.equal(ach(facts({ games: [sn({ longestLadder: 30 })] }), 'sky_high').done, true);
  assert.equal(ach(facts({ games: [rc({ won: true, margin: 400 })] }), 'photo_finish').done, true);
  assert.equal(ach(facts({ games: [rc({ won: true, margin: 900 })] }), 'photo_finish').done, false);
  assert.equal(ach(facts({ games: [rc({ splats: 6 }), rc({ splats: 4 })] }), 'brain_freezer').done, true);
});

test('splats give XP and All-Rounder now needs every game', () => {
  assert.equal(P.xpFor(facts({ games: [g({ kind: 'race', splats: 3 })] })), 16);
  const five = ['ludo', 'plusfour', 'doodle', 'snakes', 'race'].map((kind) => g({ kind, won: true }));
  assert.equal(ach(facts({ games: five }), 'all_rounder').done, false);
  assert.equal(ach(facts({ games: five.concat(g({ kind: 'scoop', won: true })) }), 'all_rounder').done, true);
  assert.equal(ach(facts({ games: [g({ kind: 'scoop', height: 21 })] }), 'tower_boss').done, true);
  assert.equal(ach(facts({ games: [g({ kind: 'scoop', height: 12 })] }), 'tower_boss').have, 12);
});
