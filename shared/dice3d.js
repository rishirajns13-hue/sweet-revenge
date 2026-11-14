/* Sweet Revenge dice: a real-looking 3D die that is thrown in, bounces, tumbles and settles.
   The VALUE is always decided first (by the host, with shared/rng.js); the throw is then planned so
   that exactly that face lands on top. The animation never changes what was rolled.

   How the throw is planned (Dice3D.plan, pure, tested in tests/dice3d.test.js):
   - the die starts in the air, off to one side, and falls to its resting spot with 3 shrinking bounces;
   - it rolls in the direction it travels, losing spin at every bounce and stopping on the last skid;
   - the free tumble ends in some orientation; a small correction rotation is blended in over the whole
     throw (invisible while it spins fast) so the chosen face ends up facing the viewer.
   Drawing: a CSS 3D cube (6 faces + 3 inner planes so rounded corners look solid), moved with one
   translate3d + matrix3d per frame (GPU only, no layout), a soft shadow on the "table", and per-face
   shading from a fixed light so it reads as a solid object.
   Sound: one recorded CC0 die hit (Kenney Casino Audio) per bounce, quieter each time. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.Dice3D = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';
  /* ---------- quaternions [w, x, y, z], CSS axes: x right, y down, z toward the viewer ---------- */
  const qmul = (a, b) => [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ];
  const qconj = (q) => [q[0], -q[1], -q[2], -q[3]];
  const qnorm = (q) => { const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]; };
  const qaxis = (x, y, z, ang) => { const l = Math.hypot(x, y, z) || 1, s = Math.sin(ang / 2); return [Math.cos(ang / 2), (x / l) * s, (y / l) * s, (z / l) * s]; };
  const qexp = (wx, wy, wz, dt) => { const a = Math.hypot(wx, wy, wz) * dt; return a < 1e-9 ? [1, 0, 0, 0] : qaxis(wx, wy, wz, a); };
  const qangle = (a, b) => { const d = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]); return 2 * Math.acos(Math.min(1, d)); };
  function qslerpId(q, s) { // slerp from identity to q by s
    let w = q[0], x = q[1], y = q[2], z = q[3];
    if (w < 0) { w = -w; x = -x; y = -y; z = -z; }
    const half = Math.acos(Math.min(1, w)), sh = Math.sin(half);
    if (sh < 1e-6) return [1, 0, 0, 0];
    const k = Math.sin(half * s) / sh;
    return qnorm([Math.cos(half * s), x * k, y * k, z * k]);
  }
  function rotate(q, v) { // rotate vector v by q
    const p = qmul(qmul(q, [0, v[0], v[1], v[2]]), qconj(q));
    return [p[1], p[2], p[3]];
  }
  // column-major 4x4 for CSS matrix3d (rotation only)
  function qmat(q) {
    const [w, x, y, z] = q;
    return [
      1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y), 0,
      2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x), 0,
      2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y), 0,
    ];
  }

  /* ---------- the faces ---------- */
  // Outward normal of each face in the die's own frame (opposite faces add up to 7).
  const NORMAL = { 1: [0, 0, 1], 6: [0, 0, -1], 3: [1, 0, 0], 4: [-1, 0, 0], 2: [0, -1, 0], 5: [0, 1, 0] };
  // The rotation that turns face v toward the viewer (+z).
  const UP = { 1: [1, 0, 0, 0], 6: qaxis(0, 1, 0, Math.PI), 3: qaxis(0, 1, 0, -Math.PI / 2), 4: qaxis(0, 1, 0, Math.PI / 2), 2: qaxis(1, 0, 0, -Math.PI / 2), 5: qaxis(1, 0, 0, Math.PI / 2) };
  // Which face points at the viewer for orientation q.
  function topFace(q) {
    let best = 1, bz = -2;
    for (const v of [1, 2, 3, 4, 5, 6]) { const n = rotate(q, NORMAL[v]); if (n[2] > bz) { bz = n[2]; best = v; } }
    return best;
  }
  // Resting orientation for v: face v up, turned around the view axis by a small, natural angle.
  const rest = (v, yaw = 0) => qmul(qaxis(0, 0, 1, yaw), UP[v]);

  /* ---------- plan a throw ---------- */
  // Returns { T, frames: [{t, x, y, z, q}], bounces: [ms...] }; x, y, z in px, relative to the resting spot.
  function plan(value, opts = {}) {
    if (!UP[value]) throw new RangeError('die value must be 1-6');
    const rnd = opts.rnd || Math.random; // looks only: the value is already decided
    const size = opts.size || 68, T = opts.duration || 1050, fps = 60;
    const ang = opts.fromAngle != null ? opts.fromAngle : (-150 + rnd() * 120) * (Math.PI / 180); // thrown from above-left .. above-right
    const dist = size * (1.25 + rnd() * 0.5);
    const x0 = Math.cos(ang) * dist, y0 = Math.sin(ang) * dist, z0 = size * (1.5 + rnd() * 0.4);
    // phases: fall, three hops, then a short skid
    const f0 = 0.27 * T, hops = [0.23 * T, 0.14 * T, 0.08 * T];
    const g = (2 * z0) / (f0 * f0);
    const bounces = [f0]; hops.forEach((d) => bounces.push(bounces[bounces.length - 1] + d));
    const skid0 = bounces[bounces.length - 1];
    function height(t) {
      if (t < f0) { const r = f0 - t; return 0.5 * g * r * r; } // falling onto the table
      let start = f0;
      for (const d of hops) { if (t < start + d) { const u = t - start; return Math.max(0, g * 0.5 * u * (d - u)); } start += d; }
      return 0;
    }
    // spin: rolling in the direction of travel (top tips forward), plus a little wobble and twist
    const vx = -x0, vy = -y0, vl = Math.hypot(vx, vy) || 1;
    const roll = 15 + rnd() * 6;
    let w = [(-vy / vl) * roll + (rnd() - 0.5) * 4, (vx / vl) * roll + (rnd() - 0.5) * 4, (rnd() - 0.5) * 7];
    let q = qnorm(qmul(qaxis(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5, rnd() * Math.PI * 2), [1, 0, 0, 0]));
    const raw = [], dt = 1000 / fps, n = Math.ceil(T / dt);
    let nextBounce = 0;
    for (let i = 0; i <= n; i++) {
      const t = Math.min(T, i * dt);
      while (nextBounce < bounces.length && t >= bounces[nextBounce]) {
        const keep = [0.6, 0.5, 0.4, 0.3][nextBounce];
        w = [w[0] * keep + (rnd() - 0.5) * 3, w[1] * keep + (rnd() - 0.5) * 3, w[2] * keep + (rnd() - 0.5) * 2];
        nextBounce++;
      }
      if (t > skid0) { const k = Math.exp(-(dt / 1000) * 9); w = [w[0] * k, w[1] * k, w[2] * k]; }
      const u = t / T, p = 1 - Math.pow(1 - u, 2.6); // travel slows with every bounce
      raw.push({ t, x: x0 * (1 - p), y: y0 * (1 - p), z: height(t), q });
      q = qnorm(qmul(qexp(w[0], w[1], w[2], dt / 1000), q));
    }
    // pick the resting turn closest to where the free tumble ended, kept near square to the screen
    const end = raw[raw.length - 1].q;
    let bestYaw = 0, bestA = Infinity;
    for (let d = 0; d < 360; d += 3) { const yaw = (d * Math.PI) / 180, a = qangle(rest(value, yaw), end); if (a < bestA) { bestA = a; bestYaw = yaw; } }
    const quarter = Math.round(bestYaw / (Math.PI / 2)) * (Math.PI / 2), lim = (16 * Math.PI) / 180;
    const yaw = quarter + Math.max(-lim, Math.min(lim, bestYaw - quarter));
    const target = rest(value, yaw);
    const fix = qmul(target, qconj(end));
    const frames = raw.map((f) => {
      const u = f.t / T, s = u * u * (3 - 2 * u);
      return { t: f.t, x: f.x, y: f.y, z: f.z, q: qnorm(qmul(qslerpId(fix, s), f.q)) };
    });
    frames[frames.length - 1] = { t: T, x: 0, y: 0, z: 0, q: target };
    return { T, frames, bounces, yaw };
  }

  /* ---------- DOM ---------- */
  const PIPS = { 1: [5], 2: [3, 7], 3: [3, 5, 7], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
  const LIGHT = (() => { const l = [-0.45, -0.65, 0.85], n = Math.hypot(...l); return l.map((c) => c / n); })();
  // recorded CC0 hits (Kenney Casino Audio); `at` = ms from the start of the clip to the knock
  const HITS = [['die-hit-1.ogg', 160], ['die-hit-2.ogg', 80], ['die-hit-3.ogg', 70], ['die-hit-4.ogg', 120]];
  let hitPlayer = null;
  function sounds() {
    if (hitPlayer !== null || typeof createSamplePlayer !== 'function') return hitPlayer;
    try { hitPlayer = createSamplePlayer({ takes: Object.fromEntries(HITS.map(([f], i) => ['h' + i, [f]])), volume: 0.7 }); hitPlayer.load(); } catch (e) { hitPlayer = false; }
    return hitPlayer;
  }

  // mount(el, {size}) puts a die inside `el` (usually the roll button). Returns { show(v), roll(v, opts) }.
  function mount(el, { size = 68 } = {}) {
    el.classList.add('d3-host');
    el.insertAdjacentHTML('beforeend', `<span class="d3-stage" style="--d3:${size}px" aria-hidden="true"><span class="d3-shadow"></span><span class="d3-die">` +
      '<span class="d3-core a"></span><span class="d3-core b"></span><span class="d3-core c"></span>' +
      [1, 2, 3, 4, 5, 6].map((v) => `<span class="d3-face f${v}">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => `<i${PIPS[v].includes(k) ? ' class="on"' : ''}></i>`).join('')}<b></b></span>`).join('') +
      '</span></span>');
    const stage = el.querySelector('.d3-stage'), die = stage.querySelector('.d3-die'), shadow = stage.querySelector('.d3-shadow');
    const faces = [1, 2, 3, 4, 5, 6].map((v) => stage.querySelector('.f' + v));
    let current = rest(6, 0), raf = 0, token = 0;
    function draw(x, y, z, q) {
      const m = qmat(q);
      die.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,${z.toFixed(1)}px) matrix3d(${m.map((c) => c.toFixed(4)).join(',')},0,0,0,1)`;
      const lift = Math.min(1, z / (size * 1.6));
      shadow.style.transform = `translate(${(x + z * 0.18).toFixed(1)}px,${(y + z * 0.28).toFixed(1)}px) scale(${(1 - lift * 0.35).toFixed(3)})`;
      shadow.style.opacity = (0.55 - lift * 0.35).toFixed(3);
      for (let i = 0; i < 6; i++) {
        const nrm = rotate(q, NORMAL[i + 1]);
        const lit = nrm[0] * LIGHT[0] + nrm[1] * LIGHT[1] + nrm[2] * LIGHT[2];
        faces[i].style.setProperty('--dark', Math.max(0, Math.min(0.5, (0.85 - lit) * 0.42)).toFixed(3));
      }
    }
    function show(v) {
      cancelAnimationFrame(raf); token++;
      current = rest(v, 0);
      draw(0, 0, 0, current);
    }
    function roll(v, { duration = 1050, sound = true } = {}) {
      cancelAnimationFrame(raf);
      const my = ++token;
      const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      const p = plan(v, { size, duration: reduced ? 360 : duration });
      if (reduced) p.frames.forEach((f) => { f.x = 0; f.y = 0; f.z = 0; }); // a quick spin in place, no throw
      const sp = sound && !reduced && sounds();
      if (sp) p.bounces.forEach((b, i) => { const [, at] = HITS[i % HITS.length]; sp.sample('h' + (i % HITS.length), { vol: [0.55, 0.38, 0.24, 0.14][i] || 0.1, when: Math.max(0, (b - at) / 1000) }); });
      el.classList.add('d3-rolling');
      return new Promise((resolve) => {
        const t0 = performance.now();
        const step = (now) => {
          if (my !== token) return resolve(false);
          // (the first frame's timestamp can be a little before t0, hence the clamp at 0)
          const t = Math.max(0, Math.min(p.T, now - t0)), fr = p.frames, last = fr.length - 1;
          const pos = (t / p.T) * last, i = Math.min(last, Math.floor(pos)), j = Math.min(last, i + 1), k = pos - i;
          const a = fr[i], b = fr[j], dot = a.q[0] * b.q[0] + a.q[1] * b.q[1] + a.q[2] * b.q[2] + a.q[3] * b.q[3], sg = dot < 0 ? -1 : 1;
          draw(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k,
            qnorm([0, 1, 2, 3].map((c) => a.q[c] * (1 - k) + sg * b.q[c] * k))); // blend between planned frames (smooth on 120 Hz screens)
          if (t < p.T) { raf = requestAnimationFrame(step); return; }
          current = p.frames[p.frames.length - 1].q;
          el.classList.remove('d3-rolling');
          el.classList.remove('d3-land'); void el.offsetWidth; el.classList.add('d3-land');
          resolve(true);
        };
        raf = requestAnimationFrame(step);
      });
    }
    draw(0, 0, 0, current);
    return { show, roll, el };
  }

  return { plan, mount, topFace, rest, qangle };
});
