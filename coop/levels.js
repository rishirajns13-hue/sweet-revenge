// Two Peas stages. You're always tied together by the candy rope (4.2 m). Each map is ASCII, top row first,
// one character per 1 m tile; the legend is in coop/physics.js (LEGEND). `hint` is shown in the corner;
// `solve` is a script for coop/bot.js that the tests replay with both heroes, so every stage is solvable.
// Rules of thumb: alone you clear 2 tiles; standing on your partner 3; the rope reaches 4.2 m.
(function (root) {
  'use strict';
  const LEVELS = [
    /* ================= World 1: tied together ================= */
    {
      id: '1-1', world: 1, name: 'Short Leash', hint: 'Boost your partner up, then they hold on (Shift) and reel you in (W).',
      map: [
        '........................',
        '........................',
        '........................',
        '........................',
        '....................E...',
        '.............###########',
        '.............###########',
        '.&@..........###########',
        '#####...################',
        '#####...################',
      ],
      solve: {
        a: [['jumpAt', 4.3, 9], ['go', 12.3], ['say', 'ready'], ['until', 'said:anchored'], ['hold', 1, 3.2], ['go', 16], ['until', 'said:free'], ['door']],
        b: [['wait', 0.25], ['jumpAt', 4.3, 9], ['until', 'said:ready'], ['go', 10.3], ['jumpAt', 10.4, 12.3], ['go', 12.3], ['jumpAt', 12.2, 14.6], ['go', 14.4], ['grab', true], ['say', 'anchored'], ['reel', 'in', 3.0], ['wait', 0.4], ['grab', false], ['go', 18.5], ['say', 'free'], ['wait', 0.3], ['door']],
      },
    },
    {
      id: '1-2', world: 1, name: 'Down the Well', hint: 'One holds on at the edge; the other goes down for the key.',
      map: [
        '................#.......',
        '................#.......',
        '................#.......',
        '................#.......',
        '.&@.............L....E..',
        '#########.##############',
        '#########.##############',
        '#########.##############',
        '#########k##############',
        '########################',
        '########################',
        '########################',
      ],
      solve: {
        a: [['go', 8.55], ['grab', true], ['say', 'anchored'], ['until', 'bHasKey'], ['wait', 0.3], ['reel', 'in', 2.6], ['until', 'said:out'], ['grab', false], ['wait', 0.5], ['jumpAt', 8.6, 11.5], ['until', 'unlocked'], ['until', 'bIn'], ['door']],
        b: [['go', 6.8], ['until', 'said:anchored'], ['jumpAt', 7.0, 9.6], ['go', 9.6], ['until', 'bHasKey'], ['until', 'ropeShort'], ['hold', 1, 0.8], ['say', 'out'], ['go', 15.6], ['until', 'unlocked'], ['door']],
      },
    },
    {
      id: '1-3', world: 1, name: 'Too Tall', hint: 'Crate, then a head, then over. The one on top holds on and hauls the other up.',
      map: [
        '........................',
        '........................',
        '........................',
        '........................',
        '........................',
        '..............#.........',
        '..............#.........',
        '..............#.........',
        '.&@....c......#.....E...',
        '########################',
      ],
      solve: {
        a: [['go', 6.6], ['hold', 1, 3.0], ['jumpAt', 12.6, 13.5], ['say', 'onCrate'], ['until', 'said:anchored'], ['hold', 1, 3.4], ['until', 'said:free'], ['go', 17.5], ['say', 'down'], ['door']],
        b: [['until', 'said:onCrate'], ['go', 10.4], ['jumpAt', 10.5, 13.5], ['go', 13.5], ['jumpAt', 13.4, 14.5], ['go', 14.5], ['grab', true], ['say', 'anchored'], ['reel', 'in', 3.2], ['wait', 0.3], ['grab', false], ['reel', 'out', 0.01], ['say', 'free'], ['until', 'said:down'], ['go', 19.8], ['until', 'aIn'], ['door']],
      },
    },
    {
      id: '1-4', world: 1, name: 'Heavy Stuff', hint: 'Too heavy for one. Push it together.',
      map: [
        '......................#.....',
        '......................#.....',
        '......................#.....',
        '......................#.....',
        '......................#.....',
        '......................#.....',
        '.&@...HH........1.....a...E.',
        '############################',
        '############################',
      ],
      solve: {
        a: [['go', 5.6], ['say', 'ready'], ['until', 'said:behind'], ['hold', 1, 3.9], ['say', 'pushed'], ['jumpAt', 14.4, 19], ['door']],
        b: [['until', 'said:ready'], ['go', 5.0], ['say', 'behind'], ['hold', 1, 3.9], ['wait', 0.8], ['jumpAt', 14.4, 19], ['door']],
      },
    },
    /* ================= World 2: pink and blue ================= */
    {
      id: '2-1', world: 2, name: 'Piggyback', colours: true, hint: 'Pink goo only hurts Blue. Blue goo only hurts Pink.',
      map: [
        '..............................',
        '..............................',
        '..............................',
        '..............................',
        '..............................',
        '..............................',
        '.&@........................E..',
        '#####PPPPP######QQQQQ#########',
        '##############################',
      ],
      solve: {
        a: [['go', 4.2], ['say', 'ready'], ['until', 'bOnA'], ['go', 12.6], ['say', 'over1'], ['until', 'said:bReady'], ['jumpAt', 13.0, 15.0], ['say', 'aboard'], ['until', 'said:over2'], ['go', 24], ['door']],
        b: [['until', 'said:ready'], ['jumpAt', 2.3, 4.2], ['until', 'said:over1'], ['go', 15.0], ['say', 'bReady'], ['until', 'aOnB'], ['go', 22.5], ['say', 'over2'], ['wait', 0.6], ['door']],
      },
    },
    {
      id: '2-2', world: 2, name: 'Hold the Door', colours: true, hint: 'Pink walls let Pink through. Blue walls let Blue through.',
      map: [
        '........p...q...........',
        '........p...q...........',
        '........p...q...........',
        '........p...q...........',
        '........p...q...........',
        '........p...q...........',
        '.&@.....a.1.b.2...E.....',
        '########################',
      ],
      solve: {
        a: [['jumpAt', 6.9, 10.5], ['go', 10.5], ['say', 'aOn1'], ['until', 'pressed2'], ['go', 12.6], ['jumpAt', 13.0, 17], ['say', 'aPast'], ['door']],
        b: [['go', 6.7], ['until', 'said:aOn1'], ['go', 9.6], ['jumpAt', 9.7, 14.5], ['go', 14.5], ['until', 'said:aPast'], ['door']],
      },
    },
  ];
  const api = { LEVELS, byId: (id) => LEVELS.find((l) => l.id === id) };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.CoopLevels = api;
})(this);
