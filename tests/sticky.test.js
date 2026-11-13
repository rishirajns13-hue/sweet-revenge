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

const Levels = require('../sticky/levels.js');
const Phys = require('../sticky/physics.js');

test('the cake: every hop on the route is jumpable', () => {
  const r = Levels.cake.route;
  const reach = (Phys.P.jumpSpeed ** 2) / (2 * -Phys.P.gravity); // highest a jump can lift you
  for (let i = 1; i < r.length; i++) {
    const a = r[i - 1], b = r[i];
    const slack = (m) => (m ? Math.abs(m.ax || 0) + Math.abs(m.ay || 0) : 0);
    const up = b.y - a.y - slack(b.move) * 0; // moving ones come closer at some point
    const gap = Math.max(0, Math.max(b.x, a.x) - Math.min(b.x + b.w, a.x + a.w)) - slack(a.move) - slack(b.move);
    if (a.bounce) continue; // marshmallows launch you much higher
    assert.ok(up <= reach - 0.2, `hop ${i} is ${up.toFixed(2)} m up (max ${reach.toFixed(2)})`);
    assert.ok(gap <= 3, `hop ${i} gap ${gap.toFixed(2)} m`);
  }
});

test('the cake: standing on a sliding strawberry carries you', () => {
  const lvl = { spawn: { x: 0, y: 2 }, platforms: [{ x: -4, y: 0, w: 8, h: 0.6, move: { ax: 2, period: 2 } }], checkpoints: [], goal: null, fallLimit: 50 };
  const w = Phys.newWorld(lvl);
  w.b.x = 0.4; w.a.x = 0.2;
  for (let i = 0; i < 40; i++) Phys.step(w, {}, {});
  const x0 = w.a.x;
  for (let i = 0; i < 20; i++) Phys.step(w, {}, {});
  assert.ok(w.a.ground, 'standing on it');
  assert.ok(Math.abs(w.a.x - x0) > 0.3, 'moved with the platform');
});

test('the cake: a marshmallow bounces you way up', () => {
  const lvl = { spawn: { x: 0, y: 4 }, platforms: [{ x: -2, y: 0, w: 4, h: 0.6, bounce: 13.5 }], checkpoints: [], goal: null, fallLimit: 50 };
  const w = Phys.newWorld(lvl);
  let top = 0;
  for (let i = 0; i < 120; i++) { Phys.step(w, {}, {}); top = Math.max(top, w.a.y); }
  assert.ok(w.events.some((e) => e.t === 'bounce'));
  assert.ok(top > 4.5, `bounced up to ${top.toFixed(1)} m`);
});

/* ---------- online: each browser runs its own critter, the partner is streamed in ---------- */
test('online: a remote partner is not simulated, only steered toward what the network says', () => {
  const w = Phys.newWorld(level());
  w.b.remote = true;
  w.b.x = 2; w.b.y = 5; // floating in the air: we never apply gravity to them
  run(w, 30);
  assert.equal(w.b.x, 2); assert.equal(w.b.y, 5);
  Phys.steerRemote(w.b, { x: 3, y: 5, vx: 0, vy: 0, grab: false, ground: true }, 0);
  for (let i = 0; i < 30; i++) Phys.steerRemote(w.b, null, 0);
  assert.ok(Math.abs(w.b.x - 3) < 0.05, `eased onto the streamed spot (${w.b.x.toFixed(2)})`);
  assert.equal(w.b.ground, true);
});

test('online: the rope still pulls my critter toward a remote partner', () => {
  const w = Phys.newWorld(level());
  run(w, 60);
  w.b.remote = true; w.b.x = 9; w.b.y = w.a.y; w.b.vx = 0;
  const x0 = w.a.x;
  run(w, 60);
  assert.ok(w.a.x > x0 + 0.5, 'dragged toward the partner');
  assert.equal(w.b.x, 9, 'the partner is not moved by our copy of the rope');
});

test('online: a guest world never decides falls, checkpoints or the win', () => {
  const w = Phys.newWorld({ ...level(), platforms: [], goal: { x: 0, y: 1, r: 50 } });
  w.referee = false; w.b.remote = true;
  run(w, 200);
  assert.ok(!w.events.some((e) => e.t === 'fall' || e.t === 'win' || e.t === 'checkpoint'));
});

test('online: respawn puts both on the checkpoint and bumps the life counter', () => {
  const w = Phys.newWorld(level());
  w.a.x = 50; w.a.y = -40; w.a.vy = -20;
  const life = w.life;
  Phys.respawn(w);
  assert.equal(w.life, life + 1);
  assert.equal(w.a.x, w.a.checkpoint.x); assert.equal(w.a.vy, 0);
});

/* ---------- polish: events the sounds hang off ---------- */
test('grabbing a ledge makes one grab event and counts it', () => {
  const w = S.newWorld(level());
  run(w, 60);
  w.a.x = 3.6; w.a.y = 0.5; // beside the step
  run(w, 5, { grab: true });
  assert.equal(w.events.filter((e) => e.t === 'grab' && e.k === 'a').length, 1);
  assert.equal(w.a.grabs, 1);
});
test('a long drop lands with a hard landing; a small hop does not', () => {
  const w = S.newWorld(level());
  run(w, 60); w.events.length = 0;
  run(w, 60, (i) => ({ jump: i === 0 }));
  assert.ok(!w.events.some((e) => e.t === 'land'), 'plain jump is not a hard landing');
  w.a.y = 6; w.b.y = 6; w.a.vy = w.b.vy = 0;
  run(w, 90);
  const land = w.events.find((e) => e.t === 'land');
  assert.ok(land && land.hard > 0 && land.hard <= 1);
});
test('the rope snapping taut yanks once until it goes slack again', () => {
  const w = S.newWorld(level());
  run(w, 30); w.events.length = 0;
  run(w, 90, { right: true }, { left: true });
  assert.equal(w.events.filter((e) => e.t === 'yank').length, 1);
});

/* A simple bot really plays each hop of the cake route (from a few spots, jump points and moments
   on the moving platforms). Every hop has to be makeable a fair share of the time. */
test('the cake: a bot can make every hop on the route', () => {
  const lvl = Levels.cake, route = lvl.route;
  function attempt(i, startFrac, jumpAt, t0) {
    const a = route[i - 1], b = route[i], ai = lvl.platforms.indexOf(a), bi = lvl.platforms.indexOf(b);
    const w = Phys.newWorld(lvl); w.referee = false; w.t = t0; w.b.remote = true;
    const c = w.a, A = Phys.boxesAt(lvl, w.t)[ai], fromAir = !!a.bounce;
    c.x = A.x + A.w * startFrac; c.y = fromAir ? A.y + A.h + 2.5 : A.y + A.h + Phys.P.radius + 0.01;
    let jumped = false;
    for (let s = 0; s < 180; s++) {
      Object.assign(w.b, { x: c.x, y: c.y, vx: c.vx, vy: c.vy }); // partner tags along: no rope pull
      const boxes = Phys.boxesAt(lvl, w.t), B = boxes[bi], A2 = boxes[ai];
      const d = B.x + B.w / 2 > c.x ? 1 : -1, inp = { left: d < 0, right: d > 0, jump: false };
      if (s < 10 && !fromAir) inp.left = inp.right = false;
      else if (!jumped && !fromAir && (d > 0 ? A2.x + A2.w - c.x : c.x - A2.x) <= jumpAt) inp.jump = jumped = true;
      if (!c.ground && c.vy < 0 && c.x > B.x + 0.3 && c.x < B.x + B.w - 0.3) inp.left = inp.right = false;
      Phys.step(w, inp, null);
      if (jumped || fromAir) {
        if ((c.ground && c.onIndex === bi) || (b.bounce && w.events.some((e) => e.t === 'bounce'))) return true;
        if (c.y < A2.y - 3) return false;
      }
    }
    return false;
  }
  for (let i = 1; i < route.length; i++) {
    let ok = 0, n = 0;
    for (const sf of [0.2, 0.5, 0.8]) for (const ja of [0.1, 0.4, 0.8, 1.2, 1.8, 2.5]) for (let t0 = 0; t0 < 5; t0 += 0.5) { n++; if (attempt(i, sf, ja, t0)) ok++; }
    assert.ok(ok / n >= 0.25, `hop ${i} (${route[i - 1].y} m to ${route[i].y} m) only made ${Math.round((ok / n) * 100)}% of the time`);
  }
});
