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

  /* Platform kinds:  { x, y, w, h }  plain
       slip: true      slippery frosting (you keep sliding)
       bounce: 14      marshmallow: landing launches you up at this speed
       move: { ax, ay, period, phase }  slides back and forth and carries whoever stands on it */
  function boxesAt(level, t) {
    return level.platforms.map((b) => {
      if (!b.move) return b;
      const k = Math.sin((2 * Math.PI * t) / b.move.period + (b.move.phase || 0));
      return { ...b, x: b.x + (b.move.ax || 0) * k, y: b.y + (b.move.ay || 0) * k, src: b };
    });
  }

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
  function touchIndex(c, boxes) {
    const r = P.radius + 0.08;
    return boxes.findIndex((b) => {
      if (b.bounce) return false; // too squishy to hold
      const nx = Math.max(b.x, Math.min(c.x, b.x + b.w)), ny = Math.max(b.y, Math.min(c.y, b.y + b.h));
      return (c.x - nx) ** 2 + (c.y - ny) ** 2 <= r * r;
    });
  }
  const touching = (c, boxes) => touchIndex(c, boxes) >= 0;

  // input: { left, right, jump (pressed this step), grab (held) }
  function moveCritter(c, input, boxes, dt) {
    const at = input.grab ? touchIndex(c, boxes) : -1;
    c.grab = at >= 0;
    c.holdIndex = c.grab ? at : null;
    if (c.grab) { c.vx = 0; c.vy = 0; return; } // stuck to the frosting
    const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const control = c.ground ? (c.on && c.on.slip ? 0.12 : 1) : P.airControl;
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

  function integrate(c, boxes, prev, dt) {
    if (c.grab) {
      // Holding a moving platform: ride along with it.
      const i = c.holdIndex;
      if (i != null && boxes[i].src) { c.x += boxes[i].x - prev[i].x; c.y += boxes[i].y - prev[i].y; }
      return;
    }
    // Standing on a moving platform last step: get carried by how far it moved.
    if (c.ground && c.onIndex != null && boxes[c.onIndex].src) {
      c.x += boxes[c.onIndex].x - prev[c.onIndex].x; c.y += boxes[c.onIndex].y - prev[c.onIndex].y;
    }
    const falling = c.vy;
    c.x += c.vx * dt; c.y += c.vy * dt;
    c.ground = false; c.on = null; c.onIndex = null;
    boxes.forEach((b, i) => {
      if (collide(c, b) !== 'top') return;
      if (b.bounce && falling < -2) { c.vy = b.bounce; c.bounced = true; return; }
      c.ground = true; c.on = b; c.onIndex = i;
    });
  }

  // One fixed step for both critters. Returns the world (mutated) with any new events.
  function step(w, inA, inB) {
    const dt = P.dt, prev = boxesAt(w.level, w.t);
    w.t += dt;
    const boxes = boxesAt(w.level, w.t);
    moveCritter(w.a, inA || {}, boxes, dt);
    moveCritter(w.b, inB || {}, boxes, dt);
    w.ropeLength = rope(w.a, w.b, dt);
    integrate(w.a, boxes, prev, dt);
    integrate(w.b, boxes, prev, dt);
    for (const [k, c] of [['a', w.a], ['b', w.b]]) {
      if (c.jumped) { w.events.push({ t: 'jump', k }); c.jumped = false; }
      if (c.bounced) { w.events.push({ t: 'bounce', k }); c.bounced = false; }
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

  const api = { P, newWorld, step, collide, touching, rope, boxesAt };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.StickyPhysics = api;
})(typeof window !== 'undefined' ? window : globalThis);
