// Pure Sundae Bomb rules. Works in the browser (window.SundaeRules) and in node (require).
// A bomb is built from a seed, so both players' screens build exactly the same machine and rulebook.
// The host keeps the match in one plain object `G` and judges every action with act().
(function (root) {
  'use strict';

  const FLAVOURS = ['pink', 'mint', 'vanilla', 'choc', 'blue'];
  const FLAVOUR_NAME = { pink: 'strawberry', mint: 'mint', vanilla: 'vanilla', choc: 'chocolate', blue: 'blueberry' };
  const MODULES = ['tubes', 'stack', 'thermo'];
  const BOMB_SECONDS = 210, STRIKES = 3, BOMBS_PER_MATCH = 3;

  // mulberry32: a tiny seeded random generator.
  function rng(seed) {
    let s = seed | 0;
    return () => {
      let t = (s = (s + 0x6d2b79f5) | 0);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const pick = (r, a) => a[Math.floor(r() * a.length)];
  const count = (a, x) => a.filter((y) => y === x).length;
  const ORD = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'];

  /* ---------------- the case labels ---------------- */
  function caseFor(r) {
    const L = 'ABCDEFGHJKMNPQRSTVWXYZ', D = '0123456789';
    const batch = 'SR-' + pick(r, L) + pick(r, D) + pick(r, L) + pick(r, D);
    return { batch, odd: Number(batch[batch.length - 1]) % 2 === 1, cone: r() < 0.5 ? 'waffle' : 'sugar', cherries: Math.floor(r() * 4) };
  }

  /* ---------------- module 1: syrup tubes ----------------
     Rules per tube count, checked top to bottom; the first that matches says which tube to pull.
     Each rule: [text, test(tubes, case) -> bool, answer(tubes, case) -> index] */
  const lastOf = (t, c) => t.lastIndexOf(c);
  const TUBE_RULES = {
    3: [
      ['If there is no strawberry (pink) tube, pull the second tube.', (t) => !t.includes('pink'), () => 1],
      ['Otherwise, if the last tube is vanilla, pull the last tube.', (t) => t[2] === 'vanilla', () => 2],
      ['Otherwise, if there is more than one blueberry tube, pull the last blueberry tube.', (t) => count(t, 'blue') > 1, (t) => lastOf(t, 'blue')],
      ['Otherwise, pull the first tube.', () => true, () => 0],
    ],
    4: [
      ['If there is more than one strawberry tube and the batch code ends in an odd digit, pull the last strawberry tube.', (t, c) => count(t, 'pink') > 1 && c.odd, (t) => lastOf(t, 'pink')],
      ['Otherwise, if the last tube is chocolate and there is no strawberry tube, pull the first tube.', (t) => t[3] === 'choc' && !t.includes('pink'), () => 0],
      ['Otherwise, if there is exactly one blueberry tube, pull the first tube.', (t) => count(t, 'blue') === 1, () => 0],
      ['Otherwise, if the cone is waffle, pull the last tube.', (t, c) => c.cone === 'waffle', () => 3],
      ['Otherwise, pull the second tube.', () => true, () => 1],
    ],
    5: [
      ['If the last tube is mint and the batch code ends in an odd digit, pull the fourth tube.', (t, c) => t[4] === 'mint' && c.odd, () => 3],
      ['Otherwise, if there is exactly one strawberry tube and more than one vanilla tube, pull the first tube.', (t) => count(t, 'pink') === 1 && count(t, 'vanilla') > 1, () => 0],
      ['Otherwise, if there is no chocolate tube, pull the second tube.', (t) => !t.includes('choc'), () => 1],
      ['Otherwise, if there are 2 or more cherries on top, pull the last tube.', (t, c) => c.cherries >= 2, () => 4],
      ['Otherwise, pull the third tube.', () => true, () => 2],
    ],
    6: [
      ['If there is no vanilla tube and the batch code ends in an odd digit, pull the third tube.', (t, c) => !t.includes('vanilla') && c.odd, () => 2],
      ['Otherwise, if there is exactly one vanilla tube and more than one mint tube, pull the fourth tube.', (t) => count(t, 'vanilla') === 1 && count(t, 'mint') > 1, () => 3],
      ['Otherwise, if there is no strawberry tube, pull the last tube.', (t) => !t.includes('pink'), () => 5],
      ['Otherwise, if the cone is sugar, pull the fifth tube.', (t, c) => c.cone === 'sugar', () => 4],
      ['Otherwise, pull the fourth tube.', () => true, () => 3],
    ],
  };
  function tubesAnswer(tubes, c) {
    for (const [, test, answer] of TUBE_RULES[tubes.length]) if (test(tubes, c)) return answer(tubes, c);
    return 0;
  }

  /* ---------------- module 2: scoop stack ----------------
     Three scoops (bottom to top). The recipe card lists stacks; a stack not on the card uses the fallback rule. */
  function stackRecipes(r) {
    // A fresh card each bomb: 8 rows of [bottom, middle, top] -> lever 1..4
    const rows = [];
    while (rows.length < 8) {
      const s = [pick(r, FLAVOURS), pick(r, FLAVOURS), pick(r, FLAVOURS)];
      if (!rows.some((x) => x.stack.join() === s.join())) rows.push({ stack: s, lever: 1 + Math.floor(r() * 4) });
    }
    return rows;
  }
  const STACK_FALLBACK = 'Stack not on the card? Count the chocolate scoops, add 1, and pull that lever (no chocolate = lever 1).';
  function stackAnswer(stack, recipes) {
    const row = recipes.find((x) => x.stack.join() === stack.join());
    return row ? row.lever : Math.min(4, count(stack, 'choc') + 1);
  }

  /* ---------------- module 3: thermostat ----------------
     Target temperature by flavour label, then adjusted by the case. */
  const THERMO_BASE = { pink: -6, mint: -10, vanilla: -4, choc: -8, blue: -12 };
  const THERMO_RULES = [
    'Find the label\'s flavour in the table: that\'s the base temperature.',
    'Each cherry on top makes it 2° colder.',
    'Sugar cone? Make it 1° warmer.',
    'Turn the dial to the result and press SET.',
  ];
  function thermoAnswer(flavour, c) {
    return THERMO_BASE[flavour] - 2 * c.cherries + (c.cone === 'sugar' ? 1 : 0);
  }

  /* ---------------- a whole bomb ---------------- */
  function makeBomb(seed) {
    const r = rng(seed), c = caseFor(r);
    const n = 3 + Math.floor(r() * 4);
    const tubes = Array.from({ length: n }, () => pick(r, FLAVOURS));
    const stack = [pick(r, FLAVOURS), pick(r, FLAVOURS), pick(r, FLAVOURS)];
    const recipes = stackRecipes(r);
    // Half the time, make sure the stack is on the card (so both rules get used).
    if (r() < 0.5) recipes[Math.floor(r() * recipes.length)].stack = stack.slice();
    const label = pick(r, FLAVOURS), temp = -20 + Math.floor(r() * 25);
    return {
      seed, case: c,
      machine: { tubes, stack, thermo: { label, temp } },
      book: { tubes: TUBE_RULES[n].map(([text]) => text), tubesCount: n, recipes, stackFallback: STACK_FALLBACK, thermoBase: THERMO_BASE, thermoRules: THERMO_RULES },
      answer: { tubes: tubesAnswer(tubes, c), stack: stackAnswer(stack, recipes), thermo: thermoAnswer(label, c) },
    };
  }

  /* ---------------- a match: up to 3 bombs, roles swap each bomb ---------------- */
  function newMatch(players, seed = Date.now()) {
    return {
      players: players.map((p) => ({ k: p.k, name: p.name, avatar: p.avatar })),
      seed: seed | 0, bombNo: 0, results: [], events: [],
      bomb: null,
    };
  }
  // Start the next bomb. The operator alternates; `now` is the host's clock (ms).
  function nextBomb(G, now) {
    const i = G.bombNo;
    G.bomb = {
      no: i + 1, seed: (G.seed + (i + 1) * 7919) | 0,
      operator: G.players[i % 2].k, reader: G.players[(i + 1) % 2].k,
      solved: [], strikes: 0, startedAt: now, endsAt: now + BOMB_SECONDS * 1000, over: null, by: null,
    };
    G.bombNo++;
    G.events.push({ t: 'bomb', no: G.bomb.no });
  }
  const fail = (why) => ({ ok: false, why });
  // The operator does something to a module. Returns { ok, right } or a failure.
  function act(G, k, m, value, now) {
    const b = G.bomb;
    if (!b || b.over) return fail('over');
    if (k !== b.operator) return fail('not operator');
    if (!MODULES.includes(m) || b.solved.includes(m)) return fail('done');
    if (now > b.endsAt) return explode(G, 'time', null);
    const bomb = makeBomb(b.seed), right = Number(value) === bomb.answer[m];
    if (right) {
      b.solved.push(m);
      G.events.push({ t: 'solved', m });
      if (b.solved.length === MODULES.length) finish(G, 'defused', k);
    } else {
      b.strikes++;
      // A mistake also melts 15 s off the clock.
      b.endsAt -= 15000;
      G.events.push({ t: 'strike', m, n: b.strikes });
      if (b.strikes >= STRIKES) finish(G, 'splat', k);
    }
    return { ok: true, right };
  }
  function explode(G, why) { finish(G, 'splat', null, why); return { ok: true, right: false }; }
  function tick(G, now) {
    if (G.bomb && !G.bomb.over && now > G.bomb.endsAt) finish(G, 'splat', null, 'time');
  }
  function finish(G, how, by, why = how) {
    const b = G.bomb;
    b.over = how; b.by = by; b.why = why;
    G.results.push({ no: b.no, how, operator: b.operator, reader: b.reader, secondsLeft: Math.max(0, Math.round((b.endsAt - (b.startedAt + 0)) / 1000)) });
    G.events.push({ t: how, why });
  }
  const matchOver = (G) => G.results.length >= BOMBS_PER_MATCH;
  const defusedCount = (G) => G.results.filter((x) => x.how === 'defused').length;

  const api = { FLAVOURS, FLAVOUR_NAME, MODULES, BOMB_SECONDS, STRIKES, BOMBS_PER_MATCH, ORD, rng, makeBomb, tubesAnswer, stackAnswer, thermoAnswer, TUBE_RULES, THERMO_BASE, newMatch, nextBomb, act, tick, matchOver, defusedCount };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SundaeRules = api;
})(typeof window !== 'undefined' ? window : globalThis);
