// The 3D die's throw always lands on the value that was rolled, and looks like a throw (starts in the air, bounces, ends still).
const test = require('node:test');
const assert = require('node:assert');
const D = require('../shared/dice3d.js');

test('every value lands face up, for many random throws', () => {
  for (let v = 1; v <= 6; v++) {
    for (let k = 0; k < 300; k++) {
      const p = D.plan(v, { size: 68 });
      const last = p.frames[p.frames.length - 1];
      assert.strictEqual(D.topFace(last.q), v, `value ${v}, throw ${k}`);
      assert.deepStrictEqual([last.x, last.y, last.z], [0, 0, 0]);
    }
  }
});

test('the die tumbles: the face on top changes during the throw, and it starts in the air', () => {
  let changed = 0;
  for (let k = 0; k < 100; k++) {
    const p = D.plan(1 + (k % 6));
    assert.ok(p.frames[0].z > 50, 'starts high');
    assert.strictEqual(p.bounces.length, 4, 'falls, then three hops');
    const tops = new Set(p.frames.map((f) => D.topFace(f.q)));
    if (tops.size >= 3) changed++;
  }
  assert.ok(changed > 90, 'most throws show at least 3 different faces on the way: ' + changed);
});

test('it slows down to rest: the last 60 ms barely move', () => {
  for (let k = 0; k < 100; k++) {
    const p = D.plan(1 + (k % 6)), f = p.frames, n = f.length;
    const a = D.qangle(f[n - 5].q, f[n - 1].q);
    assert.ok(a < 0.12, 'still turning ' + a.toFixed(3) + ' rad at the end');
  }
});

test('the frames are smooth: no frame jumps more than a believable spin', () => {
  for (let k = 0; k < 60; k++) {
    const f = D.plan(1 + (k % 6)).frames;
    for (let i = 1; i < f.length; i++) assert.ok(D.qangle(f[i - 1].q, f[i].q) < 0.75, 'jump at frame ' + i);
  }
});

test('bad values are refused', () => {
  assert.throws(() => D.plan(0)); assert.throws(() => D.plan(7));
});
