'use strict';
/* Sugar Rush physics: pure logic, no DOM. Used by race/game.js in the browser (window.RacePhysics)
   and by tests/race.test.js in node.
   The track is a closed loop: a smoothed list of centreline points and a road width. Past the road
   edge is soft frosting (slow), and past that a waffle wall that pushes karts back.
   Laps only count when a kart passes every checkpoint in order, so cutting across never pays. */
(function (root) {
  const LAPS = 3;
  const CHECKPOINTS = 8;
  const ROAD = 150;          // road width
  const VERGE = 46;          // frosting between the road edge and the wall
  const MAX_V = 330;         // top speed on road
  const ACCEL = 260, BRAKE = 520, DRAG = 0.6, REVERSE = 110;
  const TURN = 2.7;          // rad/s at speed
  const GRIP = 7, GRIP_OFF = 3;
  const OFF_MAX = 140;       // top speed on frosting
  const SLOW_MAX = 150;      // top speed while frozen or splatted
  const BOOST_MAX = 470, BOOST_T = 1.2;
  const FREEZE_T = 1.5, SPLAT_T = 1.0;
  const BOX_R = 34, PUDDLE_R = 30;
  const ITEMS = ['freeze', 'splat', 'boost'];

  /* ---------- the track ---------- */
  const CONTROL = [[250, 700], [300, 350], [600, 200], [1000, 280], [1300, 200], [1700, 260], [1900, 550], [1700, 800],
    [1350, 780], [1150, 950], [1350, 1150], [1750, 1200], [1850, 1450], [1500, 1600], [900, 1550], [500, 1500], [280, 1150]];

  function makeTrack(control = CONTROL, width = ROAD, per = 12) {
    const n = control.length, pts = [];
    for (let i = 0; i < n; i++) {
      const p0 = control[(i - 1 + n) % n], p1 = control[i], p2 = control[(i + 1) % n], p3 = control[(i + 2) % n];
      for (let j = 0; j < per; j++) {
        const t = j / per, t2 = t * t, t3 = t2 * t;
        const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        pts.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
      }
    }
    const cum = [0];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      cum.push(cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    const length = cum[pts.length];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    pts.forEach(([x, y]) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); });
    const pad = width / 2 + VERGE + 80;
    const track = { pts, cum, length, width, verge: VERGE, bounds: { x: minX - pad, y: minY - pad, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad } };
    // Item boxes: rows of three across the road at a few spots.
    track.boxes = [];
    [0.16, 0.42, 0.62, 0.86].forEach((f, row) => [-0.28, 0, 0.28].forEach((d, j) => {
      const at = pointAt(track, f * length, d * width);
      track.boxes.push({ id: row * 3 + j, x: at.x, y: at.y });
    }));
    return track;
  }

  // Point on the loop at distance s, pushed sideways by d (positive = right of travel).
  function pointAt(track, s, d = 0) {
    const L = track.length, n = track.pts.length;
    s = ((s % L) + L) % L;
    let lo = 0, hi = n - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (track.cum[mid] <= s) lo = mid; else hi = mid - 1; }
    const a = track.pts[lo], b = track.pts[(lo + 1) % n], segL = track.cum[lo + 1] - track.cum[lo] || 1;
    const t = (s - track.cum[lo]) / segL, tx = (b[0] - a[0]) / segL, ty = (b[1] - a[1]) / segL;
    return { x: a[0] + (b[0] - a[0]) * t - ty * d, y: a[1] + (b[1] - a[1]) * t + tx * d, angle: Math.atan2(ty, tx) };
  }

  // Nearest point on the centreline: distance along (s), signed sideways offset (d), normal.
  function project(track, x, y) {
    const pts = track.pts, n = pts.length;
    let best = null;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      const ex = b[0] - a[0], ey = b[1] - a[1], len2 = ex * ex + ey * ey || 1;
      let t = ((x - a[0]) * ex + (y - a[1]) * ey) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = a[0] + ex * t, py = a[1] + ey * t, dist2 = (x - px) ** 2 + (y - py) ** 2;
      if (!best || dist2 < best.dist2) best = { i, t, px, py, dist2, ex, ey };
    }
    const len = Math.sqrt(best.ex * best.ex + best.ey * best.ey) || 1;
    const tx = best.ex / len, ty = best.ey / len;
    const d = (x - best.px) * -ty + (y - best.py) * tx; // right-hand normal is (-ty, tx)
    return { s: track.cum[best.i] + best.t * len, d, nx: -ty, ny: tx, px: best.px, py: best.py, angle: Math.atan2(ty, tx) };
  }

  const wrapAngle = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  const sectionOf = (track, s) => Math.min(CHECKPOINTS - 1, Math.floor((s / track.length) * CHECKPOINTS));

  /* ---------- karts ---------- */
  // Grid slot i (0 = pole). Two columns, rows 70 apart behind the start line.
  function gridSpot(track, i) {
    const row = Math.floor(i / 2), side = i % 2 ? 1 : -1;
    return pointAt(track, track.length - 70 - row * 70 - (i % 2) * 30, side * track.width * 0.22);
  }
  function newKart(track, slot) {
    const g = gridSpot(track, slot);
    return { x: g.x, y: g.y, a: g.angle, m: g.angle, v: 0, lap: 0, sec: CHECKPOINTS - 1, s: project(track, g.x, g.y).s,
      prog: 0, slowT: 0, slowKind: null, boostT: 0, offroad: false, done: false, time: 0, lapStart: 0, laps: [], bump: 0 };
  }

  // Advance one kart by dt seconds. input: { left, right, gas, brake }. t = race clock (s), for lap times.
  function step(track, k, input, dt, t = 0) {
    if (k.done) { input = { gas: false, brake: true }; }
    k.slowT = Math.max(0, k.slowT - dt);
    if (!k.slowT) k.slowKind = null;
    k.boostT = Math.max(0, k.boostT - dt);
    k.bump = Math.max(0, k.bump - dt);
    let top = k.offroad ? OFF_MAX : MAX_V;
    if (k.boostT) top = BOOST_MAX;
    if (k.slowT) top = Math.min(top, SLOW_MAX);
    if (k.done) top = Math.min(top, 120);
    if (k.boostT) k.v += ACCEL * 2.2 * dt;
    else if (input.gas) k.v += (k.v < 0 ? BRAKE : ACCEL * (1 - Math.max(0, k.v) / (top * 1.25))) * dt;
    if (input.brake) k.v -= (k.v > 0 ? BRAKE : ACCEL * 0.5) * dt;
    if (!input.gas && !input.brake && !k.boostT) k.v -= Math.sign(k.v) * Math.min(Math.abs(k.v), (60 + DRAG * Math.abs(k.v)) * dt);
    if (k.v > top) k.v = Math.max(top, k.v - 600 * dt);
    if (k.v < -REVERSE) k.v = -REVERSE;
    // Steering works best at speed and flips when reversing.
    const steer = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const grip = Math.min(1, Math.abs(k.v) / 110);
    k.a = wrapAngle(k.a + steer * TURN * dt * grip * Math.sign(k.v || 1));
    // Grip: the direction of travel catches up with the nose (less on frosting: a little slide).
    const g = (k.offroad ? GRIP_OFF : GRIP) * dt;
    k.m = wrapAngle(k.m + wrapAngle(k.a - k.m) * Math.min(1, g));
    if (k.v < 0) k.m = k.a;
    k.x += Math.cos(k.m) * k.v * dt;
    k.y += Math.sin(k.m) * k.v * dt;
    // Road, frosting, wall.
    const p = project(track, k.x, k.y), half = track.width / 2, wall = half + track.verge;
    k.offroad = Math.abs(p.d) > half;
    if (k.offroad) k.v -= Math.sign(k.v) * Math.min(Math.abs(k.v), 180 * dt);
    if (Math.abs(p.d) > wall) {
      const side = Math.sign(p.d), push = side * (wall - 2);
      k.x = p.px + p.nx * push; k.y = p.py + p.ny * push;
      // Bounce: lose speed and turn the nose back along the wall.
      k.v *= 0.45;
      const along = wrapAngle(p.angle - k.a);
      if (Math.abs(along) < Math.PI / 2) k.a = wrapAngle(k.a + along * 0.5);
      else k.a = wrapAngle(k.a + wrapAngle(p.angle + Math.PI - k.a) * 0.5);
      k.m = k.a;
      k.bump = 0.25;
    }
    k.s = p.s;
    // Checkpoints, strictly in order. Entering section 0 from the last one is crossing the line.
    const sec = sectionOf(track, p.s), next = (k.sec + 1) % CHECKPOINTS;
    if (sec === next) {
      k.sec = sec;
      if (sec === 0) {
        if (k.lap >= 1) k.laps.push(t - k.lapStart);
        k.lap++;
        k.lapStart = t;
        if (k.lap > LAPS && !k.done) { k.done = true; k.time = t; }
      }
    }
    k.prog = progress(track, k);
    return k;
  }
  // Total distance raced: laps done plus how far into this one. Lets karts be sorted.
  function progress(track, k) {
    const L = track.length;
    let s = k.s;
    if (k.sec === CHECKPOINTS - 1 && s < L / 2) s += L;   // just over the line, not counted yet
    if (k.sec === 0 && s > L / 2) s -= L;                  // backed over the line
    return (k.lap - 1) * L + s;
  }

  // Race order: finishers by finishing time, then everyone else by distance raced.
  function raceOrder(list) {
    return list.slice().sort((a, b) => {
      if (a.done && b.done) return a.time - b.time;
      if (a.done !== b.done) return a.done ? -1 : 1;
      return b.prog - a.prog;
    });
  }

  /* ---------- items ---------- */
  // Revenge rule: the further back you are, the better the odds. place 1 = leading.
  function rollItem(place, count, rnd = Math.random) {
    const back = count > 1 ? (place - 1) / (count - 1) : 0; // 0 = leader, 1 = last
    const odds = { freeze: place === 1 ? 0 : 0.25 + 0.3 * back, boost: 0.25 + 0.3 * back };
    odds.splat = Math.max(0.05, 1 - odds.freeze - odds.boost);
    let r = rnd() * (odds.freeze + odds.boost + odds.splat);
    for (const it of ITEMS) { if ((r -= odds[it]) < 0) return it; }
    return 'splat';
  }
  // The racer directly ahead of k in the given order, or null when k leads.
  function targetAhead(order, k) {
    const i = order.indexOf(k);
    for (let j = i - 1; j >= 0; j--) if (!order[j].done) return order[j];
    return null;
  }
  function applyEffect(k, kind) {
    if (kind === 'boost') { k.boostT = BOOST_T; k.slowT = 0; k.slowKind = null; return k; }
    k.slowT = kind === 'freeze' ? FREEZE_T : SPLAT_T;
    k.slowKind = kind;
    k.boostT = 0;
    k.v = Math.min(k.v, SLOW_MAX);
    return k;
  }
  // Where a jelly puddle lands: a little behind the kart.
  function dropSpot(k) { return { x: k.x - Math.cos(k.a) * 46, y: k.y - Math.sin(k.a) * 46 }; }
  const touches = (k, o, r) => (k.x - o.x) ** 2 + (k.y - o.y) ** 2 < r * r;

  /* ---------- bots ---------- */
  // Follow the centreline a little ahead, wandering across the road a bit so they don't look robotic.
  function botInput(track, k, rnd = Math.random, skill = 1) {
    if (k.lane === undefined) { k.lane = (rnd() - 0.5) * 0.5; k.laneT = 0; }
    if ((k.laneT -= 1) <= 0) { k.laneT = 60 + rnd() * 120; k.lane = Math.max(-0.3, Math.min(0.3, k.lane + (rnd() - 0.5) * 0.3)); }
    const p = project(track, k.x, k.y);
    const look = 90 + Math.max(0, k.v) * 0.45;
    const aim = pointAt(track, p.s + look, k.lane * track.width);
    const want = Math.atan2(aim.y - k.y, aim.x - k.x), diff = wrapAngle(want - k.a);
    const dead = 0.04 + (1 - skill) * 0.1;
    // Way off course (or stuck backwards): reverse a moment.
    if (Math.abs(diff) > 2.4 && k.v < 40) return { left: diff > 0, right: diff < 0, gas: false, brake: true };
    return { left: diff < -dead, right: diff > dead, gas: Math.abs(diff) < 1.1 || k.v < 120, brake: Math.abs(diff) > 0.9 && k.v > 200 };
  }

  const api = { LAPS, CHECKPOINTS, ROAD, VERGE, MAX_V, SLOW_MAX, BOOST_MAX, FREEZE_T, SPLAT_T, BOOST_T, BOX_R, PUDDLE_R, ITEMS,
    makeTrack, pointAt, project, sectionOf, gridSpot, newKart, step, progress, raceOrder, rollItem, targetAhead, applyEffect, dropSpot, touches, botInput, wrapAngle };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RacePhysics = api;
})(typeof window !== 'undefined' ? window : globalThis);
