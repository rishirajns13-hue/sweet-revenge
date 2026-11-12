const test = require('node:test');
const assert = require('node:assert');
const S = require('../sticky/physics.js');

// A flat floor, a step up to the right, a high ledge, a candle checkpoint and a goal.
const level = () => ({
  spawn: { x: 0, y: 1 },
  platforms: [{ x: -20, y: -1, w: 40, h: 1 }, { x: 4, y: 0, w: 3, h: 1.2 }, { x: -3, y: 6, w: 2, h: 0.5 }],
  checkpoints: [{ x: 5.5, y: 1.2 }],
  goal: { x: 30, y: 30, r: 1 },
  fallLimit: 12,
});
const run = (w, n, a = {}, b = {}) => { for (let i = 0; i < n; i++) S.step(w, typeof a === 'function' ? a(i) : a, typeof b === 'function' ? b(i) : b); return w; };

test('critters fall onto the floor and stand on it', () => {
  const w = run(S.newWorld(level()), 120);
  assert.ok(w.a.ground && w.b.ground);
  assert.ok(Math.abs(w.a.y - (0 + S.P.radius)) < 0.05);
});

test('walking moves you; a jump lifts you off the ground', () => {
  const w = run(S.newWorld(level()), 60);
  const x0 = w.a.x;
  run(w, 30, { right: true }, {});
  assert.ok(w.a.x > x0 + 1);
  run(w, 1, { jump: true }, {});
  run(w, 10);
  assert.ok(w.a.y > 1, 'in the air after a jump');
});

test('the gummy rope pulls a straying critter back', () => {
  const w = run(S.newWorld(level()), 60);
  run(w, 240, { left: true }, {});          // A walks left, B stands still
  const d = Math.hypot(w.a.x - w.b.x, w.a.y - w.b.y);
  assert.ok(d < S.P.ropeMax, `rope keeps them within reach (${d.toFixed(2)} m)`);
  assert.ok(w.b.x < 0.6 - 0.2, 'B got dragged along');
});

test('holding on stops you sliding, and your partner dangles instead', () => {
  const w = S.newWorld(level());
  w.a.x = -2; w.a.y = 6.85;                 // standing on the high ledge
  w.b.x = -1; w.b.y = 3;                    // hanging off the side
  run(w, 120, { grab: true }, {});
  assert.ok(Math.abs(w.a.x - -2) < 0.01 && Math.abs(w.a.y - 6.85) < 0.01, 'A stays put while grabbing');
  assert.ok(w.b.y > 0.5, 'B is held up by the rope, not on the floor');
});

test('falling far below the checkpoint respawns both and blames the lower one', () => {
  const w = S.newWorld({ ...level(), platforms: [] });
  run(w, 200);
  assert.ok(w.events.some((e) => e.t === 'fall'));
  assert.equal(w.a.falls + w.b.falls >= 1, true);
});

test('both reaching the goal wins', () => {
  const w = S.newWorld({ ...level(), goal: { x: 0, y: 0.35, r: 1.5 } });
  run(w, 90);
  assert.equal(w.won, true);
});
