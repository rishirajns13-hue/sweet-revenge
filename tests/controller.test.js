'use strict';
// The 3D character controller (shared/3d/controller.js): walking, walls, steps, jumping, landing.
const test = require('node:test');
const assert = require('node:assert');
const CC = require('../shared/3d/controller.js');

const box = (x0, y0, z0, x1, y1, z1, extra = {}) => ({ min: [x0, y0, z0], max: [x1, y1, z1], ...extra });
const run = (c, input, boxes, secs, dt = 1 / 60) => { const outs = []; for (let t = 0; t < secs; t += dt) outs.push(CC.step(c, input, boxes, dt)); return outs; };

test('walks forward at walking speed and runs faster', () => {
  const a = CC.create(), b = CC.create();
  run(a, { mz: 1 }, [], 1);
  run(b, { mz: 1, run: true }, [], 1);
  assert.ok(Math.abs(a.vz - CC.P.walk) < 0.01, 'reaches walk speed');
  assert.ok(b.z > a.z * 1.5, 'running covers more ground');
  assert.ok(a.ground && a.y === 0);
});

test('stops smoothly when the keys are let go', () => {
  const c = CC.create();
  run(c, { mz: 1 }, [], 1);
  run(c, {}, [], 0.4);
  assert.ok(c.speed < 0.01);
});

test('a wall stops you and you slide along it', () => {
  const wall = box(-5, 0, 2, 5, 3, 2.2);
  const c = CC.create();
  run(c, { mz: 1, mx: 0.5 }, [wall], 3);
  assert.ok(c.z <= 2 - CC.P.r + 0.001, 'never inside the wall: z=' + c.z);
  assert.ok(c.x > 1, 'slid sideways along it');
});

test('corners where two walls meet hold', () => {
  const walls = [box(-5, 0, 2, 5, 3, 2.2), box(2, 0, -5, 2.2, 3, 5)];
  const c = CC.create();
  run(c, { mz: 1, mx: 1, run: true }, walls, 3);
  assert.ok(c.z <= 2 - CC.P.r + 0.001 && c.x <= 2 - CC.P.r + 0.001, `in corner ${c.x},${c.z}`);
});

test('walks up a low step without jumping, but not up a high one', () => {
  const low = box(-2, 0, 1, 2, 0.25, 30), high = box(-2, 0, 1, 2, 0.7, 30);
  const a = CC.create(), b = CC.create();
  run(a, { mz: 1 }, [low], 1.5);
  run(b, { mz: 1 }, [high], 1.5);
  assert.ok(Math.abs(a.y - 0.25) < 1e-6 && a.z > 1.5, 'stepped up');
  assert.ok(b.y === 0 && b.z < 1, 'blocked by the tall box');
});

test('stairs: a run of small steps is climbed', () => {
  const stairs = [];
  for (let i = 0; i < 8; i++) stairs.push(box(-1, 0, 1 + i * 0.3, 1, 0.2 * (i + 1), 1 + (i + 1) * 0.3));
  stairs.push(box(-1, 0, 3.4, 1, 1.6, 30));
  const c = CC.create();
  run(c, { mz: 1 }, stairs, 4);
  assert.ok(Math.abs(c.y - 1.6) < 1e-6, 'reached the landing at y=' + c.y);
});

test('jumping onto a table and landing reports the fall', () => {
  const table = box(-1, 0, 0.8, 1, 0.75, 2);
  const c = CC.create();
  let landed = 0, jumped = false;
  for (let t = 0; t < 2; t += 1 / 60) {
    const near = c.z > 0.25 && !jumped;          // run up, hop near the edge, stop once on top
    if (near) jumped = true;
    const o = CC.step(c, { mz: c.z < 1.3 ? 1 : 0, jump: near }, [table], 1 / 60);
    if (o.landed) landed = o.landed;
  }
  assert.ok(Math.abs(c.y - 0.75) < 1e-6, 'standing on the table at y=' + c.y);
  assert.ok(landed > 0);
});

test('walking off a ledge falls to the floor below and never tunnels', () => {
  const ledge = box(-1, 0, -1, 1, 3, 1);
  const c = CC.create({ y: 3 });
  let landed = 0;
  for (let t = 0; t < 3; t += 1 / 60) { const o = CC.step(c, { mz: 1 }, [ledge], 1 / 60); if (o.landed) landed = o.landed; }
  assert.strictEqual(c.y, 0);
  assert.ok(landed > 5, 'hard landing reported: ' + landed);
});

test('a door box that is "off" lets you through', () => {
  const door = box(-1, 0, 2, 1, 3, 2.2);
  const shut = CC.create(), open = CC.create();
  run(shut, { mz: 1 }, [door], 3);
  run(open, { mz: 1 }, [{ ...door, off: true }], 3);
  assert.ok(shut.z < 2 && open.z > 3);
});

test('footsteps come at a steady rhythm while walking', () => {
  const c = CC.create();
  const steps = run(c, { mz: 1 }, [], 3).reduce((s, o) => s + o.steps, 0);
  assert.ok(steps >= 10 && steps <= 14, 'steps: ' + steps);
});

test('the body turns to face the way it walks', () => {
  const c = CC.create();
  run(c, { mx: 1 }, [], 1);
  assert.ok(Math.abs(c.yaw - Math.PI / 2) < 0.05, 'yaw ' + c.yaw);
});
