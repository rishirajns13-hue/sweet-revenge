// Pure Snakes & Ladders rules. Works in the browser (window.SnakesRules) and in node (require).
// The host keeps the whole game in one plain object `G`, so it survives being sent to a new host.
// Every change appends events to G.events; the host sends those out so every screen animates them.
(function (root) {
  'use strict';

  const SIZE = 10, LAST = 100, MAX_SIXES = 3;
  // head -> tail
  const SNAKES = { 17: 7, 54: 34, 62: 19, 48: 26, 87: 36, 93: 73, 95: 75, 98: 79 };
  // foot -> top
  const LADDERS = { 4: 14, 9: 31, 20: 38, 28: 84, 40: 59, 51: 67, 63: 81, 71: 91 };

  // Square n (1..100) on the board: row 0 is the bottom, rows snake back and forth.
  function coord(n) {
    const i = n - 1, row = Math.floor(i / SIZE), along = i % SIZE;
    return { row, col: row % 2 === 0 ? along : SIZE - 1 - along };
  }

  // mulberry32, with its state kept in G so a new host carries on the same dice.
  function rand(G) {
    let t = (G.seed = (G.seed + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  const cur = (G) => G.players[G.turn].k;
  const emit = (G, e) => G.events.push(e);
  const blankStats = () => ({ rolls: 0, sixes: 0, snakes: 0, ladders: 0, longest: 0, bonksGiven: 0, bonksTaken: 0 });

  function newGame(players, seed = Date.now()) {
    return {
      players: players.map((p) => ({ k: p.k, name: p.name, avatar: p.avatar, bot: !!p.bot })),
      pos: Object.fromEntries(players.map((p) => [p.k, 1])),
      lastFoot: Object.fromEntries(players.map((p) => [p.k, 1])), // foot of the last ladder climbed
      turn: 0, streak: 0, last: null, winner: null,
      seed: seed | 0, events: [], hits: [],
      stats: Object.fromEntries(players.map((p) => [p.k, blankStats()])),
    };
  }

  // Where a roll of d from square `from` ends up (before snakes and ladders), and every square on the way.
  function walk(from, d) {
    const path = [];
    let at = from, dir = 1;
    for (let s = 0; s < d; s++) {
      if (at === LAST) dir = -1;
      at += dir;
      path.push(at);
    }
    return { to: at, path };
  }

  const fail = (why) => ({ ok: false, why });

  // `die` is only for tests; the host never passes one through from a guest.
  function roll(G, k, die) {
    if (G.winner) return fail('over');
    if (cur(G) !== k) return fail('turn');
    const d = die >= 1 && die <= 6 ? die | 0 : 1 + Math.floor(rand(G) * 6);
    const st = G.stats[k];
    st.rolls++;
    if (d === 6) { st.sixes++; G.streak++; } else G.streak = 0;
    G.last = { k, d };
    emit(G, { t: 'roll', k, d, streak: G.streak });

    const from = G.pos[k];
    const { to, path } = walk(from, d);
    let at = to;
    emit(G, { t: 'move', k, from, to, path, bounce: from + d > LAST });
    if (LADDERS[at]) {
      const top = LADDERS[at];
      st.ladders++;
      st.longest = Math.max(st.longest, top - at);
      G.lastFoot[k] = at;
      emit(G, { t: 'ladder', k, from: at, to: top });
      at = top;
    } else if (SNAKES[at]) {
      const tail = SNAKES[at];
      st.snakes++;
      emit(G, { t: 'snake', k, from: at, to: tail });
      at = tail;
    }
    G.pos[k] = at;

    if (at === LAST) {
      G.winner = k;
      emit(G, { t: 'win', k });
      return { ok: true };
    }
    // Revenge: land on someone and they go back to the foot of their last ladder.
    if (at !== 1) {
      G.players.forEach((p) => {
        if (p.k === k || G.pos[p.k] !== at) return;
        const back = G.lastFoot[p.k] || 1;
        G.pos[p.k] = back;
        st.bonksGiven++;
        G.stats[p.k].bonksTaken++;
        G.hits.push({ by: k, to: p.k });
        emit(G, { t: 'bonk', k: p.k, by: k, from: at, to: back });
      });
    }

    if (d === 6 && G.streak < MAX_SIXES) emit(G, { t: 'again', k, streak: G.streak });
    else {
      G.streak = 0;
      G.turn = (G.turn + 1) % G.players.length;
      emit(G, { t: 'turn', k: cur(G) });
    }
    return { ok: true };
  }

  const botMove = () => ({ t: 'roll' });

  // Players finish in order of how far up the board they got.
  function ranking(G) {
    return G.players.slice().sort((a, b) => (a.k === G.winner ? -1 : b.k === G.winner ? 1 : G.pos[b.k] - G.pos[a.k]));
  }

  // Nothing is secret in this game: everyone sees the same thing.
  function viewFor(G) {
    return {
      players: G.players.map((p) => ({ ...p })),
      pos: { ...G.pos }, lastFoot: { ...G.lastFoot },
      turn: cur(G), streak: G.streak, last: G.last, winner: G.winner,
      stats: G.stats, hits: G.hits,
    };
  }

  const api = { SIZE, LAST, MAX_SIXES, SNAKES, LADDERS, coord, rand, cur, newGame, walk, roll, botMove, ranking, viewFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SnakesRules = api;
})(typeof window !== 'undefined' ? window : globalThis);
