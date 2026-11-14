// The co-op platformer's stages. Each map is ASCII, top row first, one character per 1 m tile; the legend is
// in coop/physics.js (LEGEND). `hint` is shown in the corner; `solve` is a script for coop/bot.js that the
// tests replay with both heroes, so every stage is proven solvable.
// Rules of thumb for these maps: alone you clear 2 tiles; standing on your partner you clear 3.
(function (root) {
  'use strict';
  const LEVELS = [
    /* ================= World 1: together ================= */
    {
      id: '1-1', world: 1, name: 'Boost Me Up', hint: 'Stand still and let your partner jump on your head.',
      map: [
        '........................',
        '........................',
        '........................',
        '........................',
        '.............#..........',
        '.............#..........',
        '..&@.........a.....1.E..',
        '########################',
        '########################',
      ],
      solve: {
        a: [['go', 12.1], ['say', 'ready'], ['until', 'pressed1'], ['go', 16], ['say', 'through'], ['door']],
        b: [['until', 'said:ready'], ['go', 8.2], ['jumpAt', 8.3, 12.1], ['jumpAt', 12.0, 16], ['go', 19.5], ['until', 'said:through'], ['door']],
      },
    },
    {
      id: '1-2', world: 1, name: 'Finders Keepers', hint: 'The key is out of reach for one. Bring it to the lock.',
      map: [
        '...................#......',
        '...................#......',
        '...................#......',
        '...................#......',
        '...................#......',
        '........k..........#......',
        '.......###.........#......',
        '...................#......',
        '..&@...............L....E.',
        '##########################',
      ],
      solve: {
        a: [['go', 6.4], ['say', 'ready'], ['until', 'unlocked'], ['until', 'bIn'], ['door']],
        b: [['until', 'said:ready'], ['jumpAt', 3.0, 6.4], ['go', 6.4], ['jumpAt', 6.3, 8.5], ['go', 18.6], ['until', 'unlocked'], ['door']],
      },
    },
    {
      id: '1-3', world: 1, name: 'Heavy Stuff', hint: 'Too heavy for one. Push it together.',
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
    {
      id: '1-4', world: 1, name: 'Stair Master', hint: 'A crate, a partner, and a very tall wall.',
      map: [
        '........................',
        '........................',
        '........................',
        '........................',
        '........................',
        '..............#.........',
        '..............#.........',
        '..............#.........',
        '.&@....c......a..E...1..',
        '########################',
      ],
      solve: {
        a: [['go', 6.6], ['hold', 1, 3.0], ['jumpAt', 12.6, 13.5], ['say', 'onCrate'], ['until', 'pressed1'], ['go', 12.3], ['hold', 1, 1.2], ['jumpAt', 14.4, 17.5], ['say', 'through'], ['door']],
        b: [['until', 'said:onCrate'], ['go', 10.4], ['jumpAt', 10.5, 13.5], ['jumpAt', 13.3, 15.6], ['go', 21.5], ['until', 'said:through'], ['door']],
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
        '........p.......q.........',
        '........p.......q.........',
        '........p.......q.........',
        '........p.......q.........',
        '........p.......q.........',
        '........p.......q.........',
        '.&@.....a..1....b...2..E..',
        '##########################',
      ],
      solve: {
        a: [['jumpAt', 6.9, 11.5], ['go', 11.5], ['until', 'said:bPast'], ['until', 'pressed2'], ['go', 18.4], ['jumpAt', 18.6, 23.5], ['say', 'aPast'], ['door']],
        b: [['until', 'pressed1'], ['go', 10.0], ['jumpAt', 10.2, 14.5], ['jumpAt', 15.0, 20.5], ['go', 20.5], ['say', 'bPast'], ['until', 'said:aPast'], ['door']],
      },
    },
    /* ================= World 3: moving parts ================= */
    {
      id: '3-1', world: 3, name: 'Going Up', hint: 'Someone has to hold the button.',
      map: [
        '...................#....',
        '...................#....',
        '...................#....',
        '...............k...#....',
        '............######.#....',
        '...................#....',
        '...................#....',
        '...................#....',
        '...................#....',
        '...................#....',
        '.&@....1...........L..E.',
        '########################',
      ],
      props: [{ type: 'lift', x: 9, y: 1, w: 2, rise: 7, button: 1, speed: 2.2 }],
      solve: {
        a: [['go', 6.2], ['say', 'ready'], ['until', 'said:onLift'], ['go', 7.5], ['until', 'bHasKey'], ['wait', 0.5], ['until', 'unlocked'], ['until', 'bIn'], ['door']],
        b: [['until', 'said:ready'], ['jumpAt', 4.4, 10.0], ['go', 10.0], ['say', 'onLift'], ['wait', 3.8], ['jumpAt', 10.4, 15.5], ['go', 18.9], ['until', 'unlocked'], ['door']],
      },
    },
    {
      id: '3-2', world: 3, name: 'Boing', hint: 'One of you holds the gate; the spring does the rest.',
      map: [
        '......................',
        '......................',
        '......................',
        '......................',
        '......................',
        '.............2....E...',
        '...------#############',
        '.....a................',
        '.....a................',
        '.....a................',
        '1@&..a.*..............',
        '######################',
      ],
      props: [{ type: 'lift', x: 1, y: 1, w: 2, rise: 5, button: 2, speed: 2 }],
      solve: {
        a: [['go', 0.5], ['say', 'holding'], ['until', 'said:up'], ['go', 2.0], ['say', 'onLift'], ['until', 'pressed2'], ['wait', 2.8], ['go', 11], ['say', 'aTop'], ['door']],
        b: [['until', 'said:holding'], ['go', 7.5], ['wait', 0.3], ['go', 11], ['say', 'up'], ['until', 'said:onLift'], ['go', 13.5], ['until', 'said:aTop'], ['door']],
      },
    },
    {
      id: '3-3', world: 3, name: 'The Ferry', hint: 'The ferry only moves while someone stands on a button. Shout STOP!',
      map: [
        '..........................',
        '..........................',
        '..........................',
        '..........................',
        '..........................',
        '..........................',
        '1.@&.................2.E..',
        '######.........###########',
        '######.........###########',
      ],
      props: [{ type: 'mover', x: 9.5, y: 1.6, w: 2, ax: 3.5, period: 6, phase: -Math.PI / 2, buttons: [1, 2] }],
      solve: {
        a: [['go', 1.6], ['until', 'said:bAboard'], ['go', 0.5], ['until', 'said:parked'], ['go', 6.9], ['say', 'aOn'], ['until', 'ferryRight'], ['go', 17.5], ['say', 'aOff'], ['door']],
        b: [['go', 7.0], ['say', 'bAboard'], ['until', 'ferryRight'], ['go', 17.5], ['go', 21.5], ['until', 'ferryLeft'], ['go', 20.0], ['say', 'parked'], ['until', 'said:aOn'], ['go', 21.5], ['until', 'said:aOff'], ['door']],
      },
    },
  ];
  const api = { LEVELS, byId: (id) => LEVELS.find((l) => l.id === id) };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.CoopLevels = api;
})(this);
