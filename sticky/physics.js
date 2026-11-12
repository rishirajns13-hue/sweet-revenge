// Sticky Situation physics: two critters joined by a gummy rope, climbing platforms.
// Pure and deterministic (fixed time step), so it runs the same in the browser (window.StickyPhysics)
// and in node tests. Units: metres and seconds; y points up.
(function (root) {
  'use strict';

  const P = {
    gravity: -24, moveSpeed: 6.5, airControl: 0.55, accel: 40, friction: 30,
    jumpSpeed: 10.5, coyote: 0.1, jumpBuffer: 0.12,
    radius: 0.35,                 // a critter is a circle for collisions
    ropeSlack: 3.2,               // no pull until the rope is longer than this
    ropeStiffness: 55,            // how hard the gummy rope pulls back once stretched
    ropeDamping: 4,
    ropeMax: 5.5,                 // past this the rope snaps you back hard (it's candy, not elastic forever)
    maxFall: -26, dt: 1 / 60,
  };

  const critter = (x, y) => ({ x, y, vx: 0, vy: 0, ground: false, grab: false, coyote: 0, buffer: 0, falls: 0, peak: y, checkpoint: { x, y } });
  function newWorld(level) {
    const s = level.spawn;
    return { t: 0, level, a: critter(s.x - 0.6, s.y), b: critter(s.x + 0.6, s.y), won: false, events: [] };
  }

  // Circle vs axis-aligned box: push the critter out, report which side it hit.
  function collide(c, box) {
    const r = P.radius;
    const nx = Math.max(box.x, Math.min(c.x, box.x + box.w)), ny = Math.max(box.y, Math.min(c.y, box.y + box.h));
    const dx = c.x - nx, dy = c.y - ny, d2 = dx * dx + dy * dy;
    if (d2 >= r * r) return null;
    const d = Math.sqrt(d2) || 1e-6;
    if (d2 === 0) { // centre inside the box: push up
      c.y = box.y + box.h + r; if (c.vy < 0) c.vy = 0; return 'top';
    }
    const push = r - d;
    c.x += (dx / d) * push; c.y += (dy / d) * push;
    if (Math.abs(dy) >= Math.abs(dx)) {
      if (dy > 0) { if (c.vy < 0) c.vy = 0; return 'top'; }
      if (c.vy > 0) c.vy = 0; return 'bottom';
    }
    if ((dx > 0 && c.vx < 0) || (dx < 0 && c.vx > 0)) c.vx = 0;
    return 'side';
  }
  // Touching any platform (a little wider than colliding) lets you grab it.
  function touching(c, boxes) {
    const r = P.radius + 0.08;
    return boxes.some((b) => {
      const nx = Math.max(b.x, Math.min(c.x, b.x + b.w)), ny = Math.max(b.y, Math.min(c.y, b.y + b.h));
      return (c.x - nx) ** 2 + (c.y - ny) ** 2 <= r * r;
    });
  }

  // input: { left, right, jump (pressed this step), grab (held) }
  function moveCritter(c, input, boxes, dt) {
    const wantGrab = !!input.grab && touching(c, boxes);
    c.grab = wantGrab;
    if (c.grab) { c.vx = 0; c.vy = 0; return; } // stuck to the frosting
    const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const control = c.ground ? 1 : P.airControl;
    const target = dir * P.moveSpeed;
    const rate = (dir ? P.accel : P.friction) * control * dt;
    c.vx += Math.max(-rate, Math.min(rate, target - c.vx));
    c.coyote = c.ground ? P.coyote : Math.max(0, c.coyote - dt);
    c.buffer = input.jump ? P.jumpBuffer : Math.max(0, c.buffer - dt);
    if (c.buffer > 0 && c.coyote > 0) { c.vy = P.jumpSpeed; c.buffer = 0; c.coyote = 0; c.jumped = true; }
    c.vy = Math.max(P.maxFall, c.vy + P.gravity * dt);
  }

  // The gummy rope pulls the two together once it's stretched past its slack.
  function rope(a, b, dt) {
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1e-6;
    if (d <= P.ropeSlack) return d;
    const ux = dx / d, uy = dy / d, stretch = d - P.ropeSlack;
    const relV = (b.vx - a.vx) * ux + (b.vy - a.vy) * uy;
    let f = P.ropeStiffness * stretch + P.ropeDamping * relV;
    if (d > P.ropeMax) f += 400 * (d - P.ropeMax); // way too far: snap back
    // Whoever is holding on doesn't move; the other one takes all the pull.
    const shareA = a.grab ? 0 : b.grab ? 1 : 0.5, shareB = 1 - shareA;
    if (!a.grab) { a.vx += ux * f * dt * (shareA * 2 || 0); a.vy += uy * f * dt * (shareA * 2 || 0); }
    if (!b.grab) { b.vx -= ux * f * dt * (shareB * 2 || 0); b.vy -= uy * f * dt * (shareB * 2 || 0); }
    return d;
  }

  function integrate(c, boxes, dt) {
    if (c.grab) return;
    c.x += c.vx * dt; c.y += c.vy * dt;
    c.ground = false;
    for (const b of boxes) if (collide(c, b) === 'top') c.ground = true;
  }

  // One fixed step for both critters. Returns the world (mutated) with any new events.
  function step(w, inA, inB) {
    const dt = P.dt, boxes = w.level.platforms;
    w.t += dt;
    moveCritter(w.a, inA || {}, boxes, dt);
    moveCritter(w.b, inB || {}, boxes, dt);
    w.ropeLength = rope(w.a, w.b, dt);
    integrate(w.a, boxes, dt);
    integrate(w.b, boxes, dt);
    for (const [k, c] of [['a', w.a], ['b', w.b]]) {
      if (c.jumped) { w.events.push({ t: 'jump', k }); c.jumped = false; }
      // Reaching a checkpoint (a candle) while standing saves it for both.
      for (const cp of w.level.checkpoints || []) {
        if (c.ground && Math.abs(c.x - cp.x) < 0.8 && Math.abs(c.y - cp.y) < 1 && (w.a.checkpoint.y < cp.y)) {
          w.a.checkpoint = { x: cp.x - 0.5, y: cp.y + 0.5 }; w.b.checkpoint = { x: cp.x + 0.5, y: cp.y + 0.5 };
          w.events.push({ t: 'checkpoint', k, y: cp.y });
        }
      }
      c.peak = Math.max(c.peak, c.y);
    }
    // Fell way below the last checkpoint: both respawn there, and the fall is blamed on whoever is lower.
    const floor = Math.min(w.a.checkpoint.y, w.b.checkpoint.y) - (w.level.fallLimit || 12);
    if (w.a.y < floor || w.b.y < floor) {
      const blame = w.a.y < w.b.y ? 'a' : 'b';
      w[blame].falls++;
      for (const c of [w.a, w.b]) { c.x = c.checkpoint.x; c.y = c.checkpoint.y; c.vx = c.vy = 0; c.grab = false; }
      w.events.push({ t: 'fall', k: blame });
    }
    const g = w.level.goal;
    if (!w.won && g && [w.a, w.b].every((c) => Math.abs(c.x - g.x) < g.r && Math.abs(c.y - g.y) < g.r + 0.5)) {
      w.won = true; w.events.push({ t: 'win' });
    }
    return w;
  }

  const api = { P, newWorld, step, collide, touching, rope };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.StickyPhysics = api;
})(typeof window !== 'undefined' ? window : globalThis);
