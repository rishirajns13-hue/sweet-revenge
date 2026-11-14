// The co-op platformer's physics: two heroes in a tile world with keys, locks, buttons, gates, crates,
// springs, spikes, a rope and colours. Pure and deterministic (fixed 60 Hz steps), so it runs the same in
// the page (window.CoopPhysics) and in node tests. Units: metres and seconds; x right, y up.
// A level map is ASCII, top row first; every character is one 1x1 m tile (see LEGEND).
(function (root) {
  'use strict';

  const P = {
    gravity: -30, moveSpeed: 5.2, airControl: 0.7, accel: 45, friction: 40,
    jumpSpeed: 12, coyote: 0.1, jumpBuffer: 0.12, maxFall: -22,
    springSpeed: 18,
    w: 0.7, h: 0.9,                 // a hero's box (x is its middle, y its feet)
    crateSpeed: 2.4,
    ropeSlack: 3.4, ropeStiffness: 60, ropeDamping: 5, ropeMax: 5.6,
    dt: 1 / 60,
  };
  // Jump height = jumpSpeed^2 / (2 * -gravity) = 2.4 m: two tiles alone, three only standing on your partner (0.9 + 2.4).

  const LEGEND = {
    '#': 'ground', '-': 'ledge (stand on it, jump up through it)', '^': 'spikes', '*': 'spring',
    '@': 'start (hero A, pink)', '&': 'start (hero B, blue)', E: 'exit door', k: 'key', L: 'lock block',
    c: 'crate', H: 'heavy crate (both push)', f: 'flag (checkpoint)',
    '1': 'button 1', '2': 'button 2', '3': 'button 3', '4': 'button 4',
    a: 'gate open while button 1 is pressed', b: 'gate (button 2)', d: 'gate (button 3)', g: 'gate (button 4)',
    A: 'gate CLOSED while button 1 is pressed', P: 'pink goo (deadly to blue)', Q: 'blue goo (deadly to pink)',
    p: 'pink-only wall', q: 'blue-only wall', '.': 'air',
  };
  const GATE = { a: 1, b: 2, d: 3, g: 4 };

  /* ---------- level parsing ---------- */
  function parse(level) {
    const rows = level.map, H = rows.length, W = Math.max(...rows.map((r) => r.length));
    const at = (c, r) => (rows[r] && rows[r][c]) || '.';
    const L = { name: level.name, W, H, grid: [], spawn: {}, exit: null, keys: [], locks: [], crates: [], buttons: [], gates: [], flags: [], springs: [], rope: !!level.rope, colours: !!level.colours, props: level.props || [] };
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        const ch = at(c, r), x = c, y = H - 1 - r;
        let cell = 0; // 0 air, 1 solid, 2 ledge, 3 spikes, 4 pink goo (solid), 5 blue goo (solid), 6 pink wall, 7 blue wall
        if (ch === '#') cell = 1; else if (ch === '-') cell = 2; else if (ch === '^') cell = 3;
        else if (ch === 'P') cell = 4; else if (ch === 'Q') cell = 5; else if (ch === 'p') cell = 6; else if (ch === 'q') cell = 7;
        else if (ch === '@') L.spawn.a = { x: x + 0.5, y };
        else if (ch === '&') L.spawn.b = { x: x + 0.5, y };
        else if (ch === 'E') L.exit = { x, y };
        else if (ch === 'k') L.keys.push({ x: x + 0.5, y: y + 0.15 });
        else if (ch === 'L') L.locks.push({ x, y });
        else if (ch === 'c') L.crates.push({ x: x + 0.5, y, w: 0.9, h: 0.9, need: 1 });
        else if (ch === 'H' && at(c - 1, r) !== 'H') { let n = 1; while (at(c + n, r) === 'H') n++; L.crates.push({ x: x + n / 2, y, w: n - 0.05, h: 1.4, need: 2 }); }
        else if (ch === 'f') L.flags.push({ x: x + 0.5, y });
        else if (ch === '*') L.springs.push({ x, y });
        else if (ch >= '1' && ch <= '4') L.buttons.push({ x, y, n: +ch });
        else if (GATE[ch]) L.gates.push({ x, y, n: GATE[ch], inverted: false });
        else if (ch === 'A') L.gates.push({ x, y, n: 1, inverted: true });
        L.grid.push(cell);
      }
    }
    if (!L.spawn.a || !L.spawn.b || !L.exit) throw new Error(`level "${level.name}" needs @, & and E`);
    return L;
  }
  const cellAt = (L, x, y) => (x < 0 || x >= L.W ? 1 : y < 0 || y >= L.H ? 0 : L.grid[(L.H - 1 - y) * L.W + x]);

  /* ---------- world ---------- */
  const hero = (s, colour) => ({ x: s.x, y: s.y, vx: 0, vy: 0, ground: false, coyote: 0, buffer: 0, face: 1, colour, inDoor: false, carry: -1, dead: 0, deaths: 0, jumps: 0, upHeld: false, onId: null });
  function newWorld(level) {
    const L = parse(level);
    const W = {
      t: 0, L, done: false, events: [],
      a: hero(L.spawn.a, 'pink'), b: hero(L.spawn.b, 'blue'),
      checkpoint: { a: { ...L.spawn.a }, b: { ...L.spawn.b } },
      keys: L.keys.map((k) => ({ ...k, holder: null, used: false })),
      locks: L.locks.map((l) => ({ ...l, open: false })),
      crates: L.crates.map((c) => ({ ...c, vx: 0, vy: 0 })),
      pressed: [false, false, false, false, false],
      lifts: L.props.filter((p) => p.type === 'lift').map((p) => ({ ...p, off: 0, dx: 0, dy: 0 })),
      // a mover slides along sin(ph); with `buttons` it only moves while one of them is pressed (a ferry)
      movers: L.props.filter((p) => p.type === 'mover').map((p) => { const ph = p.phase || 0; return { ...p, ph, cx: p.x + (p.ax || 0) * Math.sin(ph), cy: p.y + (p.ay || 0) * Math.sin(ph), dx: 0, dy: 0 }; }),
      flags: L.flags.map((f) => ({ ...f, on: false })),
    };
    return W;
  }

  /* ---------- solids ---------- */
  const gateClosed = (W, g) => (g.inverted ? W.pressed[g.n] : !W.pressed[g.n]);
  // Every moving or switchable solid this step, as boxes {x0, y0, x1, y1, id, dx, dy}.
  function bodies(W, skip) {
    const out = [];
    for (const g of W.L.gates) if (gateClosed(W, g)) out.push({ x0: g.x, y0: g.y, x1: g.x + 1, y1: g.y + 1, id: 'gate' });
    for (const l of W.locks) if (!l.open) out.push({ x0: l.x, y0: l.y, x1: l.x + 1, y1: l.y + 1, id: 'lock' });
    W.crates.forEach((c, i) => { if (skip !== 'c' + i) out.push({ x0: c.x - c.w / 2, y0: c.y, x1: c.x + c.w / 2, y1: c.y + c.h, id: 'c' + i, dx: c.vx * P.dt, dy: 0, crate: i }); });
    W.lifts.forEach((l, i) => out.push({ x0: l.x, y0: l.y + l.off - 0.4, x1: l.x + l.w, y1: l.y + l.off, id: 'l' + i, dx: 0, dy: l.dy, lift: true })); // flush with the floor when down
    W.movers.forEach((m, i) => out.push({ x0: m.cx, y0: m.cy, x1: m.cx + m.w, y1: m.cy + 0.4, id: 'm' + i, dx: m.dx, dy: m.dy }));
    for (const k of ['a', 'b']) if (skip !== k && !W[k].inDoor && !W[k].dead) {
      const h = W[k];
      out.push({ x0: h.x - P.w / 2, y0: h.y, x1: h.x + P.w / 2, y1: h.y + P.h, id: k, dx: h.lastDx || 0, dy: h.lastDy || 0, hero: true });
    }
    return out;
  }
  // Is grid cell (cx, cy) solid for this hero? Ledges only from above (handled in the y pass).
  function solidCell(W, cx, cy, colour) {
    const c = cellAt(W.L, cx, cy);
    if (c === 1 || c === 4 || c === 5) return true;
    if (c === 6) return colour !== 'pink';
    if (c === 7) return colour !== 'blue';
    return false;
  }

  // Move a box (centre x, feet y, size w x h) by (dx, dy) against the grid and the bodies.
  // Returns { hitX, ground: body id | 'grid' | null, ceiling }.
  function moveBox(W, o, w, h, dx, dy, colour, solids, wasAbove) {
    const res = { hitX: 0, ground: null, ceiling: false, blockers: [] };
    // ---- x ----
    if (dx) {
      o.x += dx;
      const x0 = o.x - w / 2, x1 = o.x + w / 2, y0 = o.y + 0.001, y1 = o.y + h - 0.001;
      for (let cy = Math.floor(y0); cy <= Math.floor(y1); cy++) {
        for (let cx = Math.floor(x0); cx <= Math.floor(x1 - 1e-9); cx++) {
          if (!solidCell(W, cx, cy, colour)) continue;
          if (dx > 0) o.x = Math.min(o.x, cx - w / 2); else o.x = Math.max(o.x, cx + 1 + w / 2);
          res.hitX = Math.sign(dx);
        }
      }
      for (const b of solids) {
        const bx0 = o.x - w / 2, bx1 = o.x + w / 2;
        if (bx1 <= b.x0 || bx0 >= b.x1 || o.y + h <= b.y0 + 0.001 || o.y >= b.y1 - 0.001) continue;
        if (dx > 0 && (o.x - dx) + w / 2 <= b.x0 + 0.02) { o.x = b.x0 - w / 2; res.hitX = 1; res.blockers.push(b); }
        else if (dx < 0 && (o.x - dx) - w / 2 >= b.x1 - 0.02) { o.x = b.x1 + w / 2; res.hitX = -1; res.blockers.push(b); }
      }
    }
    // ---- y ----
    o.y += dy;
    const x0 = o.x - w / 2 + 0.001, x1 = o.x + w / 2 - 0.001;
    if (dy <= 0) {
      const feetCell = Math.floor(o.y);
      for (let cx = Math.floor(x0); cx <= Math.floor(x1); cx++) {
        const c = cellAt(W.L, cx, feetCell);
        const top = feetCell + 1;
        const solid = solidCell(W, cx, feetCell, colour) || (c === 2 && wasAbove >= top - 0.05);
        if (solid && o.y < top) { o.y = top; res.ground = res.ground || 'grid'; res.groundCell = c; }
      }
      for (const b of solids) {
        if (x1 <= b.x0 || x0 >= b.x1) continue;
        if (o.y < b.y1 && wasAbove >= b.y1 - 0.06 - Math.max(0, b.dy || 0)) { o.y = b.y1; res.ground = b.id; res.groundBody = b; }
      }
    } else {
      const headCell = Math.floor(o.y + h);
      for (let cx = Math.floor(x0); cx <= Math.floor(x1); cx++) if (solidCell(W, cx, headCell, colour) && o.y + h > headCell) { o.y = headCell - h; res.ceiling = true; }
      for (const b of solids) {
        if (x1 <= b.x0 || x0 >= b.x1 || b.hero) continue; // you can jump up "through" your partner's sides; landing on them is the y<=0 case
        if (o.y + h > b.y0 && o.y + h - dy <= b.y0 + 0.02) { o.y = b.y0 - h; res.ceiling = true; }
      }
    }
    return res;
  }

  /* ---------- a step ----------
     inputs: { a: {left, right, jump (pressed), up (pressed)}, b: {...} }
     opts.sim: which heroes this computer moves ({a: true, b: true} for couch / tests)
     opts.authority: this computer referees keys, buttons, crates, flags, gates and the exit */
  function step(W, inputs = {}, opts = {}) {
    const sim = opts.sim || { a: true, b: true }, authority = opts.authority !== false, dt = P.dt;
    W.events = [];
    W.t += dt;
    if (authority) {
      for (const l of W.lifts) { const want = W.pressed[l.button] ? l.rise : 0; const before = l.off; const sp = l.speed || 2; l.off += Math.max(-sp * dt, Math.min(sp * dt, want - l.off)); l.dy = l.off - before; }
      for (const m of W.movers) { if (!m.buttons || m.buttons.some((n) => W.pressed[n])) m.ph += (2 * Math.PI * P.dt) / m.period; const k = Math.sin(m.ph); const nx = m.x + (m.ax || 0) * k, ny = m.y + (m.ay || 0) * k; m.dx = nx - m.cx; m.dy = ny - m.cy; m.cx = nx; m.cy = ny; }
    }
    for (const k of ['a', 'b']) if (sim[k]) moveHero(W, k, inputs[k] || {}, dt);
    if (W.L.rope) rope(W, sim, dt);
    if (authority) referee(W, inputs, dt);
    return W;
  }

  function moveHero(W, k, input, dt) {
    const h = W[k], other = W[k === 'a' ? 'b' : 'a'];
    const x0 = h.x, y0 = h.y;
    if (h.dead > 0) { h.dead -= dt; if (h.dead <= 0) respawn(W, k); h.lastDx = 0; h.lastDy = 0; return; }
    if (input.up && h.ground && nearExit(W, h)) { h.inDoor = !h.inDoor; W.events.push({ t: h.inDoor ? 'door-in' : 'door-out', k }); }
    if (h.inDoor) { h.vx = 0; h.vy = 0; h.lastDx = 0; h.lastDy = 0; return; }
    const solids = bodies(W, k);
    // ride whatever you stand on (lift, mover, crate, partner)
    if (h.onId) { const b = solids.find((s) => s.id === h.onId); if (b) { h.x += b.dx || 0; h.y += Math.min(0, b.dy || 0); } }
    const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (dir) h.face = dir;
    const control = h.ground ? 1 : P.airControl;
    const rate = (dir ? P.accel : P.friction) * control * dt;
    h.vx += Math.max(-rate, Math.min(rate, dir * P.moveSpeed - h.vx));
    h.coyote = h.ground ? P.coyote : Math.max(0, h.coyote - dt);
    h.buffer = input.jump ? P.jumpBuffer : Math.max(0, h.buffer - dt);
    if (h.buffer > 0 && h.coyote > 0) { h.vy = P.jumpSpeed; h.buffer = 0; h.coyote = 0; h.jumps++; W.events.push({ t: 'jump', k }); }
    h.vy = Math.max(P.maxFall, h.vy + P.gravity * dt);
    const wasGround = h.ground, fall = h.vy;
    const r = moveBox(W, h, P.w, P.h, h.vx * dt, h.vy * dt, h.colour, solids, y0);
    h.pushing = r.hitX && dir === r.hitX ? r.blockers.filter((b) => b.crate !== undefined).map((b) => b.crate) : [];
    if (r.hitX) h.vx = 0;
    h.ground = !!r.ground; h.onId = r.ground && r.ground !== 'grid' ? r.ground : null;
    if (r.ceiling && h.vy > 0) h.vy = 0;
    if (h.ground) {
      if (!wasGround && fall < -6) W.events.push({ t: 'land', k, v: -fall });
      h.vy = 0;
      if (r.groundCell === 4 && h.colour !== 'pink') return die(W, k, 'goo');
      if (r.groundCell === 5 && h.colour !== 'blue') return die(W, k, 'goo');
      for (const s of W.L.springs) if (Math.abs(h.x - (s.x + 0.5)) < 0.55 && h.y >= s.y - 0.05 && h.y < s.y + 0.45) { h.vy = P.springSpeed; h.ground = false; h.onId = null; W.events.push({ t: 'spring', k }); }
    }
    // spikes: touching a spike tile's lower half
    const sx0 = Math.floor(h.x - P.w / 2 + 0.1), sx1 = Math.floor(h.x + P.w / 2 - 0.1);
    for (let cx = sx0; cx <= sx1; cx++) if (cellAt(W.L, cx, Math.floor(h.y + 0.05)) === 3 && h.y - Math.floor(h.y + 0.05) < 0.45) return die(W, k, 'spikes');
    if (h.y < -3) return die(W, k, 'fall');
    h.lastDx = h.x - x0; h.lastDy = h.y - y0;
  }
  const nearExit = (W, h) => W.L.exit && Math.abs(h.x - (W.L.exit.x + 0.5)) < 0.6 && Math.abs(h.y - W.L.exit.y) < 0.3;
  function die(W, k, why) {
    const h = W[k];
    h.dead = 0.9; h.deaths++; h.vx = 0; h.vy = 0; h.inDoor = false;
    if (h.carry >= 0) { const key = W.keys[h.carry]; if (key) { key.holder = null; key.x = h.x; key.y = Math.max(0, h.y); } h.carry = -1; }
    W.events.push({ t: 'die', k, why });
  }
  function respawn(W, k) {
    const h = W[k], s = W.checkpoint[k];
    Object.assign(h, { x: s.x, y: s.y, vx: 0, vy: 0, dead: 0, ground: false, onId: null, lastDx: 0, lastDy: 0 });
    W.events.push({ t: 'respawn', k });
  }

  // The rope: each computer pulls its own hero(es) toward the other once the rope is past its slack.
  function rope(W, sim, dt) {
    const a = W.a, b = W.b;
    if (a.dead || b.dead || a.inDoor || b.inDoor) return;
    const dx = b.x - a.x, dy = (b.y + P.h / 2) - (a.y + P.h / 2), d = Math.hypot(dx, dy) || 1e-6;
    W.ropeLen = d;
    if (d <= P.ropeSlack) return;
    const ux = dx / d, uy = dy / d, stretch = d - P.ropeSlack;
    const rel = (b.vx - a.vx) * ux + (b.vy - a.vy) * uy;
    let f = (P.ropeStiffness * stretch + P.ropeDamping * rel) * dt;
    if (d > P.ropeMax) f += (d - P.ropeMax) * 0.5 / dt * dt * 10; // candy rope: very stiff past the max
    // a hero standing on the ground resists the pull (feet planted) unless the pull is upward-ish
    const share = (h, s) => (h.ground && Math.abs(s * uy) < 0.5 ? 0.35 : 1);
    if (sim.a) { const s = share(a, 1); a.vx += ux * f * s; a.vy += uy * f * s; }
    if (sim.b) { const s = share(b, -1); b.vx -= ux * f * s; b.vy -= uy * f * s; }
    if (d > P.ropeMax + 0.2) W.events.push({ t: 'rope-taut' });
  }

  // The referee: crates, buttons, keys, locks, flags and the exit.
  function referee(W, inputs, dt) {
    // crates: pushed by enough heroes in the same direction
    W.crates.forEach((c, i) => {
      // who pushes: a hero against the crate, plus a hero pushing that hero the same way (a push chain)
      const dirOf = (k) => { const inp = inputs[k] || {}, h = W[k]; return h.dead || h.inDoor ? 0 : (inp.right ? 1 : 0) - (inp.left ? 1 : 0); };
      const sameRow = (h, y0, y1) => h.y < y1 - 0.05 && h.y + P.h > y0 + 0.05;
      const against = (h, dir, x0, x1) => (dir > 0 ? Math.abs(h.x + P.w / 2 - x0) < 0.1 : Math.abs(h.x - P.w / 2 - x1) < 0.1);
      const counted = new Set();
      for (let pass = 0; pass < 2; pass++) for (const k of ['a', 'b']) {
        const h = W[k], dir = dirOf(k);
        if (!dir || counted.has(k)) continue;
        if ((sameRow(h, c.y, c.y + c.h) && against(h, dir, c.x - c.w / 2, c.x + c.w / 2)) || (h.pushing || []).includes(i)) { counted.add(k); continue; }
        const o = W[k === 'a' ? 'b' : 'a'];
        if (counted.has(k === 'a' ? 'b' : 'a') && dirOf(k === 'a' ? 'b' : 'a') === dir && sameRow(h, o.y, o.y + P.h) && against(h, dir, o.x - P.w / 2, o.x + P.w / 2)) counted.add(k);
      }
      let pushL = 0, pushR = 0;
      counted.forEach((k) => { if (dirOf(k) > 0) pushR++; else pushL++; });
      // a hero standing on top of the crate can't push it (they'd ride it); helpers behind count
      const want = pushR >= c.need ? 1 : pushL >= c.need ? -1 : 0;
      c.vx = want * P.crateSpeed;
      c.vy = Math.max(P.maxFall, c.vy + P.gravity * dt);
      const before = c.y;
      const r = moveBox(W, c, c.w, c.h, c.vx * dt, c.vy * dt, 'none', bodies(W, 'c' + i).filter((b) => !b.hero), before);
      if (r.hitX) c.vx = 0;
      if (r.ground) c.vy = 0;
      if (c.y < -4) { const s = W.L.crates[i]; Object.assign(c, { x: s.x, y: s.y, vx: 0, vy: 0 }); W.events.push({ t: 'crate-reset', i }); }
    });
    // buttons
    const was = W.pressed.slice();
    W.pressed = [false, false, false, false, false];
    const onButton = (x0, x1, y, bt) => x1 > bt.x + 0.15 && x0 < bt.x + 0.85 && Math.abs(y - bt.y) < 0.3;
    for (const bt of W.L.buttons) {
      let on = false;
      for (const k of ['a', 'b']) { const h = W[k]; if (!h.dead && !h.inDoor && onButton(h.x - P.w / 2, h.x + P.w / 2, h.y, bt)) on = true; }
      for (const c of W.crates) if (onButton(c.x - c.w / 2, c.x + c.w / 2, c.y, bt)) on = true;
      if (on) W.pressed[bt.n] = true;
    }
    for (let n = 1; n <= 4; n++) if (was[n] !== W.pressed[n]) W.events.push({ t: W.pressed[n] ? 'press' : 'release', n });
    // a gate that closes on top of someone pushes them out upward (never traps anyone inside a wall)
    for (const g of W.L.gates) if (gateClosed(W, g)) for (const k of ['a', 'b']) { const h = W[k]; if (h.x + P.w / 2 > g.x && h.x - P.w / 2 < g.x + 1 && h.y < g.y + 1 && h.y + P.h > g.y) h.y = g.y + 1; }
    // keys follow their holder; touching a free key picks it up
    W.keys.forEach((key, i) => {
      if (key.used) return;
      if (key.holder) { const h = W[key.holder]; key.x = h.x - h.face * 0.25; key.y = h.y + P.h + 0.05; return; }
      for (const k of ['a', 'b']) {
        const h = W[k];
        if (h.dead || h.inDoor || h.carry >= 0) continue;
        if (Math.abs(h.x - key.x) < 0.55 && key.y >= h.y - 0.3 && key.y <= h.y + P.h + 0.2) { key.holder = k; h.carry = i; W.events.push({ t: 'key', k }); break; }
      }
    });
    // a carried key opens a lock it touches
    for (const l of W.locks) {
      if (l.open) continue;
      for (const k of ['a', 'b']) {
        const h = W[k];
        if (h.carry < 0) continue;
        if (h.x + P.w / 2 + 0.25 > l.x && h.x - P.w / 2 - 0.25 < l.x + 1 && h.y < l.y + 1.05 && h.y + P.h > l.y - 0.05) {
          l.open = true; const key = W.keys[h.carry]; key.used = true; key.holder = null; h.carry = -1;
          W.events.push({ t: 'unlock', k });
          break;
        }
      }
    }
    // flags: reaching one moves both checkpoints there
    for (const f of W.flags) {
      if (f.on) continue;
      for (const k of ['a', 'b']) {
        const h = W[k];
        if (!h.dead && Math.abs(h.x - f.x) < 0.7 && Math.abs(h.y - f.y) < 1) { f.on = true; W.checkpoint = { a: { x: f.x - 0.4, y: f.y }, b: { x: f.x + 0.4, y: f.y } }; W.events.push({ t: 'flag', k }); break; }
      }
    }
    if (!W.done && W.a.inDoor && W.b.inDoor) { W.done = true; W.events.push({ t: 'clear' }); }
  }

  /* ---------- online: what the host sends and the guest adopts ---------- */
  function snapshot(W) {
    return {
      t: +W.t.toFixed(3), done: W.done, pressed: W.pressed.map(Number).join(''),
      keys: W.keys.map((k) => [+k.x.toFixed(2), +k.y.toFixed(2), k.holder || 0, k.used ? 1 : 0]),
      locks: W.locks.map((l) => (l.open ? 1 : 0)).join(''),
      crates: W.crates.map((c) => [+c.x.toFixed(3), +c.y.toFixed(3), +c.vx.toFixed(2)]),
      lifts: W.lifts.map((l) => +l.off.toFixed(3)),
      movers: W.movers.map((m) => +m.ph.toFixed(4)),
      flags: W.flags.map((f) => (f.on ? 1 : 0)).join(''), cp: W.checkpoint,
      carry: { a: W.a.carry, b: W.b.carry },
    };
  }
  function adopt(W, s) {
    W.done = s.done;
    W.pressed = s.pressed.split('').map((c) => c === '1');
    s.keys.forEach((k, i) => { const key = W.keys[i]; if (!key) return; key.x = k[0]; key.y = k[1]; key.holder = k[2] || null; key.used = !!k[3]; });
    s.locks.split('').forEach((c, i) => W.locks[i] && (W.locks[i].open = c === '1'));
    s.crates.forEach((c, i) => { const cr = W.crates[i]; if (!cr) return; cr.x = c[0]; cr.y = c[1]; cr.vx = c[2]; });
    s.lifts.forEach((o, i) => { const l = W.lifts[i]; if (l) { l.dy = o - l.off; l.off = o; } });
    (s.movers || []).forEach((ph, i) => { const m = W.movers[i]; if (!m) return; m.ph = ph; const nx = m.x + (m.ax || 0) * Math.sin(ph), ny = m.y + (m.ay || 0) * Math.sin(ph); m.dx = nx - m.cx; m.dy = ny - m.cy; m.cx = nx; m.cy = ny; });
    s.flags.split('').forEach((c, i) => W.flags[i] && (W.flags[i].on = c === '1'));
    W.checkpoint = s.cp;
    W.a.carry = s.carry.a; W.b.carry = s.carry.b;
  }

  const api = { P, LEGEND, parse, newWorld, step, snapshot, adopt, cellAt };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.CoopPhysics = api;
})(this);
