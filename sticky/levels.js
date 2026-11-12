// Sticky Situation levels. A level is plain data the physics (sticky/physics.js) and the 3D view read.
// Coordinates in metres, y up. `route` lists the platforms in the order you climb them, so a test can
// check every hop is jumpable. Layers are only for looks (the cake's sponge colours).
(function (root) {
  'use strict';
  const H = 0.6; // ledge thickness
  const L = (x, y, w, extra = {}) => ({ x, y, w, h: H, ...extra });

  // ---------- The Birthday Cake: four layers, about 60 m up to the cherry ----------
  const route = [
    // 1 · Sponge: plain frosting ledges, learn to jump together
    L(-6, 1.8, 4), L(-1, 3.6, 3.5), L(3.5, 5.4, 3), L(-0.5, 7.2, 3), L(-5, 9, 3.5), L(-1.5, 10.8, 3), L(2.5, 12.6, 4),
    // 2 · Strawberry: sliding strawberry slices and slippery frosting
    L(-1, 14.4, 2.6, { move: { ax: 2.5, period: 4 }, kind: 'strawberry' }),
    L(-5.5, 16.2, 3, { slip: true }),
    L(-2, 18, 2.4, { move: { ax: 2, period: 3.4, phase: 1.5 }, kind: 'strawberry' }),
    L(2.5, 19.8, 3, { slip: true }),
    L(-1, 21.6, 2.4, { move: { ay: 0.9, period: 3, phase: 0.6 }, kind: 'strawberry' }),
    L(-5, 23.4, 3.5),
    L(-1, 25.2, 2.2, { move: { ax: 2.8, period: 4.6 }, kind: 'strawberry' }),
    L(3, 27, 3.5),
    // 3 · Marshmallow: bounce pads, and thin wafer sticks you'll want to grab
    L(-1, 28.4, 2.2, { bounce: 13.5, kind: 'marshmallow' }),
    L(-4.5, 31.6, 1.2, { kind: 'wafer' }),
    L(-1.5, 33.4, 1.1, { kind: 'wafer' }),
    L(1.8, 35.2, 1.1, { kind: 'wafer' }),
    L(-1.5, 36.6, 2.2, { bounce: 13.5, kind: 'marshmallow' }),
    L(2.5, 39.8, 3),
    L(-1.5, 41.6, 1.1, { kind: 'wafer', move: { ax: 1.5, period: 3.8 } }),
    L(-5, 43.4, 3),
    // 4 · The top: candles and the cherry
    L(-1, 45.2, 2.5, { slip: true }),
    L(3, 47, 2.5),
    L(-0.5, 48.8, 2.2, { move: { ax: 2.2, period: 3.2 }, kind: 'strawberry' }),
    L(-4.5, 50.6, 3),
    L(-1, 52.4, 2.5),
    L(2.5, 54.2, 2.2, { slip: true }),
    L(-1.5, 56, 3.5, { kind: 'top' }),
  ];
  const cake = {
    name: 'The Birthday Cake',
    spawn: { x: 0, y: 1 },
    platforms: [{ x: -12, y: -1, w: 24, h: 1, kind: 'plate' }, ...route],
    route,
    checkpoints: [{ x: 4.5, y: 13.2 }, { x: 5, y: 27.6 }, { x: -3.5, y: 44 }],
    goal: { x: 0.25, y: 57.2, r: 1.6 },
    fallLimit: 10,
    layers: [
      { y0: 0, y1: 13.5, sponge: '#ffe7b3', frosting: '#ff9ad0', name: 'Vanilla sponge' },
      { y0: 13.5, y1: 27.8, sponge: '#ffb3c7', frosting: '#fff3f8', name: 'Strawberry layer' },
      { y0: 27.8, y1: 44.2, sponge: '#8a5a3b', frosting: '#f7f4ff', name: 'Chocolate & marshmallow' },
      { y0: 44.2, y1: 57, sponge: '#c9f1e9', frosting: '#ffe27a', name: 'Mint top' },
    ],
  };

  const api = { cake, list: [cake] };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.StickyLevels = api;
})(typeof window !== 'undefined' ? window : globalThis);
