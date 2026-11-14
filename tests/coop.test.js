// The co-op platformer: every stage can be cleared together, and its rules really need two.
const test = require('node:test');
const assert = require('node:assert');
const Phys = require('../coop/physics.js');
const Bot = require('../coop/bot.js');
const { LEVELS } = require('../coop/levels.js');

test('every stage is cleared by its two-player script, with no deaths', () => {
  assert.ok(LEVELS.length >= 6);
  for (const lv of LEVELS) {
    const r = Bot.run(Phys, lv, lv.solve, { maxSeconds: 60 });
    assert.ok(r.done, `${lv.id} ${lv.name} was not cleared (left: ${JSON.stringify(r.left)})`);
    assert.strictEqual(r.deaths, 0, `${lv.id}: deaths`);
  }
});

test('stage ids are unique and every map is rectangular with one start each and an exit', () => {
  const ids = new Set();
  for (const lv of LEVELS) {
    assert.ok(!ids.has(lv.id), 'duplicate ' + lv.id); ids.add(lv.id);
    const w = lv.map[0].length; lv.map.forEach((row, i) => assert.strictEqual(row.length, w, `${lv.id} row ${i} width`));
    const all = lv.map.join('');
    for (const ch of ['@', '&', 'E']) assert.strictEqual(all.split(ch).length - 1, 1, `${lv.id} needs exactly one ${ch}`);
    for (const ch of all) assert.ok(ch in Phys.LEGEND, `${lv.id}: unknown tile "${ch}"`);
  }
});

const flat = (extra = []) => ({ name: 't', map: [...extra, '........................', '.@.&..................E.', '########################'] });
function jumpPeak(W, k, inputsFor) {
  let peak = W[k].y;
  for (let i = 0; i < 90; i++) { Phys.step(W, inputsFor(i)); peak = Math.max(peak, W[k].y); }
  return peak;
}

test('alone you jump about 2.4 m: two tiles yes, three tiles no', () => {
  const W = Phys.newWorld(flat());
  const peak = jumpPeak(W, 'a', (i) => ({ a: { jump: i === 0 } })) - 1;
  assert.ok(peak > 2.2 && peak < 2.9, 'peak ' + peak.toFixed(2));
});

test('standing on your partner gets you past three tiles', () => {
  const W = Phys.newWorld(flat());
  // b walks under... put a on b's head directly
  W.a.x = W.b.x; W.a.y = W.b.y + Phys.P.h; Phys.step(W, {});
  assert.strictEqual(W.a.onId, 'b', 'a stands on b');
  const peak = jumpPeak(W, 'a', (i) => ({ a: { jump: i === 0 } })) - 1;
  assert.ok(peak > 3.1, 'stacked peak ' + peak.toFixed(2));
});

test('a heavy crate needs both of you pushing the same way', () => {
  const lv = { name: 't', map: ['..........................', '.@&...HH...............E.', '##########################'] };
  const W = Phys.newWorld(lv);
  const x0 = W.crates[0].x;
  // a alone pushes for 2 s
  W.b.x = 1.0; W.a.x = 5.6;
  for (let i = 0; i < 120; i++) Phys.step(W, { a: { right: true } });
  assert.ok(Math.abs(W.crates[0].x - x0) < 0.01, 'one hero moved it');
  // now b pushes a, who pushes the crate
  W.b.x = W.a.x - Phys.P.w - 0.01;
  for (let i = 0; i < 120; i++) Phys.step(W, { a: { right: true }, b: { right: true } });
  assert.ok(W.crates[0].x - x0 > 2, 'both moved it: ' + (W.crates[0].x - x0).toFixed(2));
});

test('pink goo hurts only Blue, blue goo hurts only Pink', () => {
  const lv = { name: 't', colours: true, map: ['............', '.@.&.......E', '####PPQQ####'] };
  let W = Phys.newWorld(lv);
  W.a.x = 4.5; W.b.x = 9; for (let i = 0; i < 30; i++) Phys.step(W, {});
  assert.strictEqual(W.a.deaths, 0, 'pink on pink goo is fine');
  W = Phys.newWorld(lv); W.b.x = 4.5; W.a.x = 9; for (let i = 0; i < 30; i++) Phys.step(W, {});
  assert.strictEqual(W.b.deaths, 1, 'blue on pink goo dies');
  W = Phys.newWorld(lv); W.a.x = 6.5; W.b.x = 9.5; for (let i = 0; i < 30; i++) Phys.step(W, {});
  assert.strictEqual(W.a.deaths, 1, 'pink on blue goo dies');
});

test('1-1 cannot be cleared alone: the wall is too tall for one', () => {
  const lv = LEVELS.find((l) => l.id === '1-1');
  const r = Bot.run(Phys, lv, { a: [['go', 11], ['jumpAt', 11.5, 16], ['jumpAt', 11.5, 16], ['jumpAt', 11.5, 16], ['door']] }, { maxSeconds: 15 });
  assert.ok(!r.done && r.W.a.x < 13, 'A got past alone: ' + r.W.a.x);
});

test('online: the host snapshot carries the shared state and the guest adopts it', () => {
  const lv = LEVELS.find((l) => l.id === '1-2');
  const r = Bot.run(Phys, lv, lv.solve, { maxSeconds: 60 });
  const guest = Phys.newWorld(lv);
  const snap = JSON.parse(JSON.stringify(Phys.snapshot(r.W)));
  assert.ok(JSON.stringify(snap).length < 2000, 'snapshot stays small');
  Phys.adopt(guest, snap);
  assert.strictEqual(guest.done, true);
  assert.ok(guest.locks.every((l) => l.open));
  assert.deepStrictEqual(guest.keys.map((k) => k.used), r.W.keys.map((k) => k.used));
});

test('a gate closing on someone lifts them out instead of trapping them', () => {
  const lv = { name: 't', map: ['......', '.@&a1E', '######'] };
  const W = Phys.newWorld(lv);
  W.a.x = 3.5; W.a.y = 1; // standing inside the gate cell while it is closed
  Phys.step(W, {});
  assert.ok(W.a.y >= 2 - 1e-6, 'lifted to ' + W.a.y);
});

/* ---------- the rope (tied together) ---------- */
const ledge = { name: 't', map: ['..............', '..............', '..............', '..............', '.@&...........', '#####.........', '#####.........', '..............', '..............', '..............', '..........E...', '##############'] };
const dangle = (anchor, frames = 240) => { const W = Phys.newWorld(ledge); for (let i = 0; i < frames; i++) Phys.step(W, { a: { grab: anchor }, b: { right: i < 40 } }); return W; };

test('the rope never stretches past its length', () => {
  const W = dangle(true);
  const d = Math.hypot(W.b.x - W.a.x, W.b.y - W.a.y);
  assert.ok(d <= Phys.P.ropeLen + 0.15, 'rope length ' + d.toFixed(2));
});

test('standing still, a dangling partner drags you toward the edge; holding on (anchor) stops it', () => {
  const free = dangle(false), held = dangle(true);
  assert.ok(free.a.x > 1.8, 'free hero was dragged: ' + free.a.x.toFixed(2));
  assert.ok(Math.abs(held.a.x - 1.5) < 0.05, 'anchored hero stayed: ' + held.a.x.toFixed(2));
});

test('an anchored hero reels the partner in, and the rope eases back out when nobody holds on', () => {
  const W = dangle(true, 120);
  const y0 = W.b.y;
  for (let i = 0; i < 90; i++) Phys.step(W, { a: { grab: true, reelIn: true }, b: {} });
  assert.ok(W.b.y > y0 + 1, `pulled up from ${y0.toFixed(2)} to ${W.b.y.toFixed(2)}`);
  for (let i = 0; i < 120; i++) Phys.step(W, { a: {}, b: {} });
  assert.ok(Math.abs(W.ropeL - Phys.P.ropeLen) < 1e-6, 'rope back to full length');
});

test('tied together: if one goes splat, both go back to the flag (only one splat counted)', () => {
  const lv = { name: 't', map: ['............', '.@&.^......E', '############'] };
  const W = Phys.newWorld(lv);
  W.b.x = 4.5; Phys.step(W, {});
  assert.strictEqual(W.b.deaths, 1);
  assert.strictEqual(W.a.deaths, 0);
  assert.ok(W.a.dead > 0, 'the partner is pulled back too');
});
