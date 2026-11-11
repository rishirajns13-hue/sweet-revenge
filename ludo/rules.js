// Pure Ludo rules. Works in the browser (window.LudoRules) and in node (require).
// Token position: -1 = base, 0..50 = main track (relative to own start),
// 51..55 = own home column, 56 = home.
(function (root) {
  'use strict';

  const START = { red: 0, green: 13, yellow: 26, blue: 39 };
  const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47]);
  const LAST_TRACK = 50;
  const HOME = 56;

  const clone = (s) => JSON.parse(JSON.stringify(s));
  const absIndex = (color, pos) => (START[color] + pos) % 52;
  const current = (s) => s.players[s.turn];

  // opts.teams with 4 players pairs seats 1+3 against 2+4 (partners sit opposite).
  function newGame(players, names, opts = {}) {
    const tokens = {}, stats = {};
    players.forEach((c) => { tokens[c] = [-1, -1, -1, -1]; stats[c] = { bonks: 0, sixes: 0 }; });
    const teams = opts.teams && players.length === 4 ? [[players[0], players[2]], [players[1], players[3]]] : null;
    return {
      gid: Math.random().toString(36).slice(2, 10),
      v: 0, players, names, tokens, teams, stats, turns: 0, hits: [], // hits: [[bonker, victim], ...]
      turn: 0, phase: 'roll', dice: null, sixes: 0, winner: null, winners: null, events: [],
    };
  }

  const teamOf = (s, color) => (s.teams && s.teams.find((t) => t.includes(color))) || [color];
  const finished = (s, color) => s.tokens[color].every((p) => p === HOME);

  function legalMoves(s, color = current(s), dice = s.dice) {
    const out = [];
    s.tokens[color].forEach((p, i) => {
      if (p === -1) { if (dice === 6) out.push(i); }
      else if (p !== HOME && p + dice <= HOME) out.push(i);
    });
    return out;
  }

  // Players who are already home (possible in teams) are skipped.
  function nextTurn(s) {
    s.phase = 'roll';
    s.sixes = 0;
    s.turns = (s.turns || 0) + 1;
    for (let k = 0; k < s.players.length; k++) {
      s.turn = (s.turn + 1) % s.players.length;
      if (!finished(s, current(s))) return;
    }
  }

  function roll(s, value) {
    s = clone(s);
    const color = current(s);
    const ev = { type: 'roll', color, value };
    s.dice = value;
    s.events = [ev];
    s.sixes = value === 6 ? s.sixes + 1 : 0;
    if (value === 6 && s.stats) s.stats[color].sixes++;
    if (s.sixes === 3) { ev.note = 'three6'; nextTurn(s); return s; }
    if (!legalMoves(s, color, value).length) {
      ev.note = 'nomove';
      if (value === 6) s.phase = 'roll'; else nextTurn(s);
      return s;
    }
    s.phase = 'move';
    return s;
  }

  function move(s, i) {
    s = clone(s);
    const color = current(s);
    const dice = s.dice;
    if (s.phase !== 'move' || !legalMoves(s, color, dice).includes(i)) throw new Error('illegal move');
    const from = s.tokens[color][i];
    const to = from === -1 ? 0 : from + dice;
    s.tokens[color][i] = to;
    const ev = { type: 'move', color, token: i, from, to, captured: [] };

    if (to <= LAST_TRACK) {
      const a = absIndex(color, to);
      if (!SAFE.has(a)) {
        const team = teamOf(s, color);
        for (const c of s.players) {
          if (team.includes(c)) continue;
          s.tokens[c].forEach((p, j) => {
            if (p >= 0 && p <= LAST_TRACK && absIndex(c, p) === a) {
              s.tokens[c][j] = -1;
              ev.captured.push({ color: c, token: j, from: p });
            }
          });
        }
      }
    }
    if (to === HOME) ev.home = true;
    if (s.stats) s.stats[color].bonks += ev.captured.length;
    if (s.hits) ev.captured.forEach((c) => s.hits.push([color, c.color]));
    s.events = [ev];

    if (finished(s, color)) {
      const team = teamOf(s, color);
      if (team.every((c) => finished(s, c))) { s.winner = color; s.winners = team; s.phase = 'over'; return s; }
      ev.finished = true; // partner still racing: hand the turn on
      nextTurn(s);
      return s;
    }
    if (dice === 6 || ev.captured.length || ev.home) { ev.bonus = true; s.phase = 'roll'; }
    else nextTurn(s);
    return s;
  }

  // Roll, and if there is only one real choice, make it automatically.
  function rollAuto(s, value) {
    s = roll(s, value);
    if (s.phase !== 'move') return s;
    const color = current(s);
    const moves = legalMoves(s);
    const positions = new Set(moves.map((i) => s.tokens[color][i]));
    if (positions.size !== 1) return s;
    const rollEvents = s.events;
    s = move(s, moves[0]);
    s.events = rollEvents.concat(s.events);
    return s;
  }

  const api = { START, SAFE, LAST_TRACK, HOME, absIndex, current, teamOf, newGame, legalMoves, roll, move, rollAuto };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LudoRules = api;
})(this);
