// Plonk! (four in a row): the rules and a bot. Pure; window.FourRules in the page, module.exports in tests.
// A 7 x 6 board; discs fall to the lowest empty spot of a column; four in a line (any direction) wins.
(function (root) {
  'use strict';
  const COLS = 7, ROWS = 6;
  // board[c][r], r = 0 is the bottom row; values: 0 empty, 'a', 'b'
  function newGame(first = 'a') { return { board: Array.from({ length: COLS }, () => Array(ROWS).fill(0)), turn: first, first, moves: [], winner: null, line: null, draw: false }; }
  const canDrop = (g, c) => !g.winner && !g.draw && c >= 0 && c < COLS && g.board[c][ROWS - 1] === 0;
  function drop(g, c, who = g.turn) {
    if (who !== g.turn || !canDrop(g, c)) return null;
    const r = g.board[c].indexOf(0);
    g.board[c][r] = who;
    g.moves.push(c);
    const line = winLine(g.board, c, r);
    if (line) { g.winner = who; g.line = line; }
    else if (g.moves.length === COLS * ROWS) g.draw = true;
    else g.turn = who === 'a' ? 'b' : 'a';
    return { c, r, who };
  }
  const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];
  function winLine(board, c, r) {
    const who = board[c][r];
    for (const [dc, dr] of DIRS) {
      const cells = [[c, r]];
      for (const s of [1, -1]) { let k = 1; while (true) { const x = c + dc * k * s, y = r + dr * k * s; if (x < 0 || x >= COLS || y < 0 || y >= ROWS || board[x][y] !== who) break; cells.push([x, y]); k++; } }
      if (cells.length >= 4) return cells.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    }
    return null;
  }
  /* ---------- the bot: alpha-beta search with a simple window score ---------- */
  function scoreWindow(cells, me, them) {
    const m = cells.filter((x) => x === me).length, t = cells.filter((x) => x === them).length, e = 4 - m - t;
    if (m === 4) return 1000; if (m === 3 && e === 1) return 6; if (m === 2 && e === 2) return 2;
    if (t === 3 && e === 1) return -5; return 0;
  }
  function evaluate(board, me) {
    const them = me === 'a' ? 'b' : 'a';
    let s = 0;
    for (let r = 0; r < ROWS; r++) if (board[3][r] === me) s += 3; // the middle column is worth more
    for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) for (const [dc, dr] of DIRS) {
      const ec = c + dc * 3, er = r + dr * 3;
      if (ec < 0 || ec >= COLS || er < 0 || er >= ROWS) continue;
      s += scoreWindow([0, 1, 2, 3].map((k) => board[c + dc * k][r + dr * k]), me, them);
    }
    return s;
  }
  const ORDER = [3, 2, 4, 1, 5, 0, 6];
  function search(g, depth, alpha, beta, me) {
    if (g.winner) return g.winner === me ? 100000 + depth : -100000 - depth;
    if (g.draw) return 0;
    if (depth === 0) return evaluate(g.board, me);
    const maxing = g.turn === me;
    let best = maxing ? -Infinity : Infinity;
    for (const c of ORDER) {
      if (!canDrop(g, c)) continue;
      const copy = { board: g.board.map((col) => col.slice()), turn: g.turn, moves: g.moves.slice(), winner: null, line: null, draw: false };
      drop(copy, c);
      const v = search(copy, depth - 1, alpha, beta, me);
      if (maxing) { best = Math.max(best, v); alpha = Math.max(alpha, v); } else { best = Math.min(best, v); beta = Math.min(beta, v); }
      if (beta <= alpha) break;
    }
    return best;
  }
  // level: 1 (relaxed) .. 3 (sharp). A little randomness so it isn't the same game every time.
  function botMove(g, level = 2, rnd = Math.random) {
    const me = g.turn, depth = [2, 4, 6][Math.max(0, Math.min(2, level - 1))];
    let best = [], bestV = -Infinity;
    for (const c of ORDER) {
      if (!canDrop(g, c)) continue;
      const copy = { board: g.board.map((col) => col.slice()), turn: g.turn, moves: g.moves.slice(), winner: null, line: null, draw: false };
      drop(copy, c);
      const v = search(copy, depth - 1, -Infinity, Infinity, me) + (level < 3 ? rnd() * 4 : 0);
      if (v > bestV + 0.5) { bestV = v; best = [c]; } else if (Math.abs(v - bestV) <= 0.5) best.push(c);
    }
    return best[Math.floor(rnd() * best.length)];
  }
  const api = { COLS, ROWS, newGame, canDrop, drop, winLine, botMove, evaluate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FourRules = api;
})(this);
