// Plays a level from a script, for both heroes at once: the tests use it to prove every level can be solved.
// A script is { a: [...commands], b: [...commands] }. Commands (each hero runs its own list in order):
//   ['go', x]            walk to x (stops within 0.2 m)
//   ['jumpAt', x, to]    walk toward `to`, jump when passing x
//   ['jump']             jump now (waits until standing)
//   ['hold', dir, secs]  hold left (-1) or right (1) for a while (pushing crates)
//   ['wait', secs]       do nothing for a while
//   ['until', name]      wait until a named condition (see COND) is true
//   ['door']             step into the exit door (walks to it first)
//   ['say', name]        mark a sync point other scripts can wait for with ['until', 'said:name']
//   ['grab', true|false] start/stop anchoring (feet planted) — stays on until switched off
//   ['reel', 'in'|'out', secs]  while anchored: pull your partner in / let them out
(function (root) {
  'use strict';
  const COND = {
    aOnB: (W) => W.a.onId === 'b', bOnA: (W) => W.b.onId === 'a',
    pressed1: (W) => W.pressed[1], pressed2: (W) => W.pressed[2], pressed3: (W) => W.pressed[3],
    unlocked: (W) => W.locks.some((l) => l.open), allUnlocked: (W) => W.locks.every((l) => l.open),
    aHasKey: (W) => W.a.carry >= 0, bHasKey: (W) => W.b.carry >= 0,
    aIn: (W) => W.a.inDoor, bIn: (W) => W.b.inDoor,
    aHang: (W) => !!W.a.hang, bHang: (W) => !!W.b.hang, aGround: (W) => W.a.ground, bGround: (W) => W.b.ground,
    ropeShort: (W) => W.ropeL < 1.6,
    ferryLeft: (W) => W.movers[0] && W.movers[0].cx < W.movers[0].x - (W.movers[0].ax || 0) + 0.25,
    ferryRight: (W) => W.movers[0] && W.movers[0].cx > W.movers[0].x + (W.movers[0].ax || 0) - 0.25,
  };
  function run(Phys, level, script, { maxSeconds = 120, log = false } = {}) {
    const W = Phys.newWorld(level);
    const said = new Set();
    const st = { a: { q: (script.a || []).slice(), t: 0 }, b: { q: (script.b || []).slice(), t: 0 } };
    const frames = Math.round(maxSeconds / Phys.P.dt);
    const trace = [];
    for (let f = 0; f < frames && !W.done; f++) {
      const inputs = {};
      for (const k of ['a', 'b']) {
        const s = st[k], h = W[k], inp = { grab: !!s.grab };
        inputs[k] = inp;
        if (h.dead > 0) continue;
        while (s.q.length) {
          const [cmd, p1, p2] = s.q[0];
          const next = () => { s.q.shift(); s.t = 0; };
          if (cmd === 'say') { said.add(p1); next(); continue; }
          if (cmd === 'grab') { s.grab = !!p1; inp.grab = s.grab; next(); continue; }
          if (cmd === 'reel') { s.t += Phys.P.dt; if (p1 === 'in') inp.reelIn = true; else inp.reelOut = true; if (s.t >= p2) { next(); continue; } break; }
          if (cmd === 'until') { const ok = p1.startsWith('said:') ? said.has(p1.slice(5)) : COND[p1](W); if (ok) { next(); continue; } break; }
          if (cmd === 'wait') { s.t += Phys.P.dt; if (s.t >= p1) { next(); continue; } break; }
          if (cmd === 'go' || cmd === 'door') {
            const x = cmd === 'door' ? W.L.exit.x + 0.5 : p1, d = x - h.x;
            if (Math.abs(d) < 0.2 && Math.abs(h.vx) < 1.5) {
              if (cmd === 'door') { if (h.inDoor) { next(); continue; } if (h.ground) inp.up = true; break; }
              next(); continue;
            }
            if (Math.abs(d) > 0.12) { if (d > 0) inp.right = true; else inp.left = true; }
            if (Math.abs(d) < 0.45 && Math.abs(h.vx) > 2.5) { inp.right = false; inp.left = false; } // brake
            break;
          }
          if (cmd === 'jumpAt') {
            const d = p2 - h.x;
            if (d > 0) inp.right = true; else inp.left = true;
            if (!s.jumped && ((d > 0 && h.x >= p1) || (d < 0 && h.x <= p1)) && h.ground) { inp.jump = true; s.jumped = true; }
            if (s.jumped && h.ground && s.t > 0.15) { s.jumped = false; next(); continue; }
            if (s.jumped) s.t += Phys.P.dt;
            if (Math.abs(d) < 0.15) { s.jumped = false; next(); continue; }
            break;
          }
          if (cmd === 'leap') { // walk toward p2, jump at p1, and grab as soon as you're in the air (for hooks)
            const d = p2 - h.x; if (d > 0) inp.right = true; else inp.left = true;
            if (!s.jumped && ((d > 0 && h.x >= p1) || (d < 0 && h.x <= p1)) && h.ground) { inp.jump = true; s.jumped = true; }
            if (s.jumped && !h.ground) { s.grab = true; inp.grab = true; }
            if (h.hang) { s.jumped = false; next(); continue; }
            if (s.jumped && h.ground && s.t > 0.3) { s.jumped = false; s.grab = false; next(); continue; }
            if (s.jumped) s.t += Phys.P.dt;
            break;
          }
          if (cmd === 'jump') { if (h.ground) { inp.jump = true; next(); continue; } break; }
          if (cmd === 'hold') { s.t += Phys.P.dt; if (p1 > 0) inp.right = true; else inp.left = true; if (s.t >= p2) { next(); continue; } break; }
          throw new Error('unknown bot command ' + cmd);
        }
      }
      Phys.step(W, inputs);
      if (log && f % 30 === 0) trace.push(`${W.t.toFixed(1)}s a(${W.a.x.toFixed(2)},${W.a.y.toFixed(2)}${W.a.inDoor ? ' in' : ''}) b(${W.b.x.toFixed(2)},${W.b.y.toFixed(2)}${W.b.inDoor ? ' in' : ''}) q:${st.a.q.length}/${st.b.q.length} ${st.a.q[0] ? st.a.q[0].join(' ') : '-'} | ${st.b.q[0] ? st.b.q[0].join(' ') : '-'}`);
    }
    return { W, done: W.done, seconds: W.t, deaths: W.a.deaths + W.b.deaths, trace, left: { a: st.a.q, b: st.b.q } };
  }
  const api = { run, COND };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.CoopBot = api;
})(this);
