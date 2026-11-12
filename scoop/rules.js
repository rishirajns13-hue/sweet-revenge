'use strict';
/* Scoop Stack rules, pure and shared by the browser (window.ScoopRules) and the tests (node).
   Each player owns one tower and simulates it locally. A scoop swings left and right above the top
   of the tower; dropping it keeps only the part that overlaps the scoop below. Land within PERFECT
   of dead centre and it snaps into place (and grows back a little). Overhang too far and it falls
   off: SPLAT, one life gone. Three perfects in a row charge a Wobble to throw at someone else.
   All sizes are in "field units": the play field is FIELD wide with x = 0 in the middle. */
(function (root, factory) {
  const R = factory();
  if (typeof module === 'object' && module.exports) module.exports = R;
  else root.ScoopRules = R;
})(typeof self !== 'undefined' ? self : this, () => {
  const FIELD = 320;          // play field width
  const SCOOP_H = 30;         // height each scoop adds to the tower
  const START_W = 120;        // width of the first scoop (sits on the cone)
  const AMP = 118;            // how far the swinging scoop travels either side of centre
  const PERFECT = 5;          // within this many units of the scoop below = Perfect!
  const GROW = 6;             // a perfect grows the scoop back by this much (up to START_W)
  const KEEP = 0.35;          // you must overlap at least this share of the scoop below…
  const MIN_W = 14;           // …and keep at least this much, or it falls off
  const LIVES = 3;
  const STREAK = 3;           // perfects in a row that charge a Wobble
  const DURATION = 90000;     // round length, ms
  const WOBBLE_MS = 4000;
  const FLAVOURS = [
    { id: 'strawberry', c: '#ff71ce' }, { id: 'mint', c: '#7ee8d8' }, { id: 'vanilla', c: '#fff6e0' },
    { id: 'mango', c: '#ffce5c' }, { id: 'blueberry', c: '#9ab8ff' },
  ];

  function newTower() {
    return {
      stack: [], x: 0, w: START_W, height: 0, lives: LIVES, perfects: 0, streak: 0,
      charged: false, splats: 0, wobblesSent: 0, phase: 0, wobbleUntil: 0, out: false,
    };
  }
  const flavourAt = (i) => FLAVOURS[((i % FLAVOURS.length) + FLAVOURS.length) % FLAVOURS.length];

  // Swing speed in radians per second: it ramps up as the tower grows. A wobble nearly doubles it.
  function speed(height, wobbling = false) {
    const s = Math.min(6.4, 2.2 + 0.12 * height);
    return wobbling ? s * 1.85 : s;
  }
  const wobbling = (t, now) => now < t.wobbleUntil;
  // Where the swinging scoop is for a given phase. A wobble adds a wild second sway on top.
  function swingX(phase, wob = false) {
    const x = Math.sin(phase) * AMP + (wob ? Math.sin(phase * 3.3 + 1) * AMP * 0.3 : 0);
    return Math.max(-FIELD / 2, Math.min(FIELD / 2, x));
  }
  // Advance the swing by dt ms. Returns the scoop's x.
  function step(t, dt, now = 0) {
    const wob = wobbling(t, now);
    t.phase += speed(t.height, wob) * (dt / 1000);
    return swingX(t.phase, wob);
  }

  /* Drop the swinging scoop at x. Returns what happened:
     { kind: 'perfect' | 'stack' | 'splat', x, w, cut: { x, w } | null, charged: bool, out: bool } */
  function landing(t, x) {
    const off = x - t.x, gap = Math.abs(off);
    if (gap <= PERFECT) return { kind: 'perfect', x: t.x, w: Math.min(START_W, t.w + GROW), cut: null };
    const keep = t.w - gap;
    if (keep < Math.max(MIN_W, t.w * KEEP)) return { kind: 'splat', x, w: t.w, cut: null };
    const nx = t.x + off / 2; // centre of the overlap
    const side = Math.sign(off);
    return { kind: 'stack', x: nx, w: keep, cut: { x: nx + side * (keep / 2 + gap / 2), w: gap } };
  }
  function drop(t, x) {
    if (t.out) return { kind: 'none' };
    const r = landing(t, x);
    r.charged = false;
    if (r.kind === 'splat') {
      t.lives--; t.splats++; t.streak = 0;
      if (t.lives <= 0) { t.lives = 0; t.out = true; }
    } else {
      t.stack.push({ x: r.x, w: r.w, f: t.height % FLAVOURS.length });
      t.height++; t.x = r.x; t.w = r.w;
      if (r.kind === 'perfect') {
        t.perfects++; t.streak++;
        if (t.streak >= STREAK) { t.streak = 0; if (!t.charged) { t.charged = true; r.charged = true; } }
      } else t.streak = 0;
    }
    // Start the next scoop from one end, alternating, so it never appears right on top.
    t.phase = t.height % 2 ? Math.PI / 2 : -Math.PI / 2;
    r.out = t.out;
    return r;
  }
  // Spend a charged wobble. Returns true if there was one.
  function useWobble(t) {
    if (!t.charged || t.out) return false;
    t.charged = false; t.wobblesSent++;
    return true;
  }
  function hitByWobble(t, now) { t.wobbleUntil = Math.max(t.wobbleUntil, now + WOBBLE_MS); }

  // The summary a player sends to the host.
  const summary = (t) => ({ h: t.height, lives: t.lives, perfects: t.perfects, splats: t.splats, wob: t.wobblesSent, out: t.out, charged: t.charged });

  // Is the round over? scores: [{ out }] , elapsed ms
  const roundOver = (scores, elapsed) => elapsed >= DURATION || (scores.length > 0 && scores.every((s) => s.out));

  /* Ranking: tallest first, ties broken by perfects, then fewer splats. Players with the same
     height and perfects share a place. scores: [{ k, h, perfects, splats }] */
  function rank(scores) {
    const sorted = scores.slice().sort((a, b) => (b.h - a.h) || (b.perfects - a.perfects) || ((a.splats || 0) - (b.splats || 0)));
    let place = 0;
    return sorted.map((s, i) => {
      const prev = sorted[i - 1];
      if (!prev || prev.h !== s.h || prev.perfects !== s.perfects || (prev.splats || 0) !== (s.splats || 0)) place = i + 1;
      return { ...s, place };
    });
  }
  const winners = (ranked) => ranked.filter((s) => s.place === 1);

  // Who a wobble should hit: the tallest tower that isn't yours (and isn't out).
  function wobbleTarget(scores, fromK) {
    const others = scores.filter((s) => s.k !== fromK && !s.out);
    if (!others.length) return null;
    return others.slice().sort((a, b) => (b.h - a.h) || (b.perfects - a.perfects))[0].k;
  }

  // A bot's drop: where it lets go, a bit off the centre. skill 0 (sloppy) .. 1 (sharp).
  function botAim(t, rng, skill = 0.6, wob = false) {
    const err = (1 - skill) * 46 + 4 + t.height * 0.6;
    const spread = wob ? err * 2.2 : err;
    if (rng() < 0.12 + skill * 0.25) return t.x + (rng() - 0.5) * PERFECT; // nailed it
    return t.x + (rng() - 0.5) * 2 * spread;
  }

  return {
    FIELD, SCOOP_H, START_W, AMP, PERFECT, GROW, KEEP, MIN_W, LIVES, STREAK, DURATION, WOBBLE_MS, FLAVOURS,
    newTower, flavourAt, speed, wobbling, swingX, step, landing, drop, useWobble, hitByWobble, summary,
    roundOver, rank, winners, wobbleTarget, botAim,
  };
});
