'use strict';
/* Character movement for the 3D games (Locked In, later the Island). Pure maths, no three.js, so it is
   tested in node (tests/controller.test.js). Units are metres and seconds; y is up.
   A character is an upright cylinder (radius r, height h) standing at (x, y, z) = the middle of its feet.
   The world is a list of axis-aligned boxes: { min: [x, y, z], max: [x, y, z], off?: true }.
   Boxes block sideways movement if they rise more than STEP above the feet, and anything lower that the
   feet are over becomes the ground (so low steps, rugs and stairs are walked up without a jump).
     const c = CharacterController.create({ x: 0, z: 0 });
     CharacterController.step(c, { mx, mz, run, jump }, boxes, dt)   // mx/mz: wanted direction in world space
   step() returns { landed: fallSpeed | 0, steps: footsteps this frame } for sounds and squash. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CharacterController = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  const P = {
    r: 0.32, h: 1.3,
    walk: 2.7, run: 4.8,      // top speeds
    accel: 22, decel: 18,     // how fast you reach / lose them (snappy but not instant)
    airControl: 0.35,
    gravity: 24, jumpV: 6.4,  // a short, floaty-but-snappy cartoon hop (about 0.85 m high)
    coyote: 0.1, buffer: 0.12,
    step: 0.32,               // highest ledge you walk up without jumping
    turn: 14,                 // how fast the body turns to face where it moves (rad/s, eased)
    stride: 0.62,             // metres per footstep at walking pace
    maxFall: 30,
  };

  function create({ x = 0, y = 0, z = 0, yaw = 0 } = {}) {
    return { x, y, z, vx: 0, vy: 0, vz: 0, yaw, ground: true, air: 0, jumpBuf: 0, stepAcc: 0, speed: 0, canJump: true };
  }

  // Highest box top under the feet circle that is at most `reach` above the feet (the ground to stand on).
  function groundAt(x, z, y, r, boxes, reach) {
    let best = -Infinity;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.off) continue;
      const top = b.max[1];
      if (top > y + reach) continue;
      // circle vs rectangle overlap in the xz plane (shrunk a little so you don't stand on a corner pixel)
      const cx = Math.max(b.min[0], Math.min(x, b.max[0])), cz = Math.max(b.min[2], Math.min(z, b.max[2]));
      const dx = x - cx, dz = z - cz, rr = r * 0.6;
      if (dx * dx + dz * dz > rr * rr) continue;
      if (top > best) best = top;
    }
    return best;
  }

  // Push the circle out of every blocking box. A few passes settle corners where two boxes meet.
  function pushOut(c, boxes, r, h) {
    let hit = false;
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i];
        if (b.off) continue;
        if (b.max[1] <= c.y + P.step || b.min[1] >= c.y + h) continue; // walkable or overhead
        const cx = Math.max(b.min[0], Math.min(c.x, b.max[0])), cz = Math.max(b.min[2], Math.min(c.z, b.max[2]));
        let dx = c.x - cx, dz = c.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-10) {
          const d = Math.sqrt(d2), push = r - d;
          dx /= d; dz /= d;
          c.x += dx * push; c.z += dz * push;
          // slide: remove the velocity going into the wall
          const into = c.vx * dx + c.vz * dz;
          if (into < 0) { c.vx -= into * dx; c.vz -= into * dz; }
        } else {
          // centre is inside the box: leave by the nearest face
          const opts = [[c.x - b.min[0], -1, 0], [b.max[0] - c.x, 1, 0], [c.z - b.min[2], 0, -1], [b.max[2] - c.z, 0, 1]];
          opts.sort((a, b2) => a[0] - b2[0]);
          const [dist, ox, oz] = opts[0];
          c.x += ox * (dist + r); c.z += oz * (dist + r);
          if (ox) c.vx = 0; if (oz) c.vz = 0;
        }
        moved = true; hit = true;
      }
      if (!moved) break;
    }
    return hit;
  }

  function step(c, input, boxes, dt) {
    const out = { landed: 0, steps: 0, bumped: false };
    dt = Math.min(dt, 1 / 20);
    // wanted velocity
    let mx = input.mx || 0, mz = input.mz || 0;
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }
    const top = input.run ? P.run : P.walk;
    const tx = mx * top, tz = mz * top;
    const control = c.ground ? 1 : P.airControl;
    const rate = (len > 0.01 ? P.accel : P.decel) * control * dt;
    const ddx = tx - c.vx, ddz = tz - c.vz, dd = Math.hypot(ddx, ddz);
    if (dd <= rate) { c.vx = tx; c.vz = tz; } else { c.vx += (ddx / dd) * rate; c.vz += (ddz / dd) * rate; }

    // jumping (with a little forgiveness both before landing and after walking off a ledge)
    if (input.jump) c.jumpBuf = P.buffer; else c.jumpBuf = Math.max(0, c.jumpBuf - dt);
    if (c.ground) c.air = 0; else c.air += dt;
    if (c.jumpBuf > 0 && c.air <= P.coyote && c.canJump !== false) {
      c.vy = P.jumpV; c.ground = false; c.air = P.coyote + 1; c.jumpBuf = 0; out.jumped = true;
    }

    // move sideways, then settle out of walls
    c.x += c.vx * dt; c.z += c.vz * dt;
    out.bumped = pushOut(c, boxes, P.r, P.h);

    // vertical: fall, then snap to whatever ground is under us
    const floor = Math.max(groundAt(c.x, c.z, c.y, P.r, boxes, P.step), input.floor ?? 0);
    const snap = c.vy <= 0 && c.ground && !out.jumped && Math.abs(c.y - floor) <= P.step + 0.01;
    if (!snap) {
      const prevY = c.y;
      c.vy = Math.max(c.vy - P.gravity * dt, -P.maxFall);
      c.y += c.vy * dt;
      // bonk heads on ceilings
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i];
        if (b.off || c.vy <= 0) continue;
        const cx = Math.max(b.min[0], Math.min(c.x, b.max[0])), cz = Math.max(b.min[2], Math.min(c.z, b.max[2]));
        if ((c.x - cx) ** 2 + (c.z - cz) ** 2 < P.r * P.r * 0.5 && c.y + P.h > b.min[1] && c.y < b.min[1]) { c.y = b.min[1] - P.h; c.vy = 0; }
      }
      // the ground is the highest top we were above at the start of this frame (no tunnelling at speed)
      const below = Math.max(groundAt(c.x, c.z, prevY, P.r, boxes, 0.02), input.floor ?? 0);
      if (c.y <= below) {
        if (!c.ground) out.landed = -c.vy;
        c.y = below; c.vy = 0; c.ground = true;
      } else c.ground = false;
    } else {
      // walking: stick to the floor, including stepping up small ledges and down small drops
      const wasY = c.y;
      c.y = floor; c.ground = true; c.vy = 0;
      if (c.y - wasY > 0.05) out.stepUp = c.y - wasY;
    }

    // facing: turn toward the way we're moving
    c.speed = Math.hypot(c.vx, c.vz);
    if (c.speed > 0.2) {
      const want = Math.atan2(c.vx, c.vz);
      let d = want - c.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      c.yaw += d * Math.min(1, P.turn * dt);
    }
    // footsteps
    if (c.ground && c.speed > 0.5) {
      c.stepAcc += c.speed * dt;
      const stride = P.stride * (input.run ? 1.35 : 1);
      while (c.stepAcc >= stride) { c.stepAcc -= stride; out.steps++; }
    } else c.stepAcc = Math.min(c.stepAcc, P.stride * 0.5);
    return out;
  }

  // Is a point inside an axis-aligned box, grown by `pad`? (used for "you are standing in the doorway" checks)
  function inside(b, x, y, z, pad = 0) {
    return x >= b.min[0] - pad && x <= b.max[0] + pad && z >= b.min[2] - pad && z <= b.max[2] + pad && y >= b.min[1] - pad && y <= b.max[1] + pad;
  }

  return { P, create, step, groundAt, inside };
}));
