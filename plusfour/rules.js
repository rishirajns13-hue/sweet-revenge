// Pure Plus Four rules. Works in the browser (window.PlusFourRules) and in node (require).
// The host keeps the whole game in one plain object `G`, so it survives being sent to a new host.
// Every change appends events to G.events; the host sends those out so every screen animates them.
(function (root) {
  'use strict';

  const COLORS = ['r', 'y', 'g', 'b'];
  const HAND = 7;

  function newDeck() {
    const deck = [];
    for (const c of COLORS) {
      deck.push({ id: `${c}0`, c, v: '0' });
      for (const v of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'skip', 'rev', 'd2']) {
        deck.push({ id: `${c}${v}a`, c, v }, { id: `${c}${v}b`, c, v });
      }
    }
    for (let n = 1; n <= 4; n++) deck.push({ id: `wild${n}`, c: 'w', v: 'wild' }, { id: `w4${n}`, c: 'w', v: 'w4' });
    return deck;
  }

  // mulberry32, with its state kept in G so a new host carries on the same shuffle.
  function rand(G) {
    let t = (G.seed = (G.seed + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function shuffle(G, arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rand(G) * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  const top = (G) => G.discard[G.discard.length - 1];
  const cur = (G) => G.players[G.turn].k;
  const emit = (G, e) => G.events.push(e);
  const step = (G, n = 1) => { G.turn = (((G.turn + G.dir * n) % G.players.length) + G.players.length) % G.players.length; };

  // firstSeat: the seat that plays first (picked at random by the host, so the room's creator has no edge).
  function newGame(players, seed = Date.now(), firstSeat = 0) {
    const G = {
      players: players.map((p) => ({ k: p.k, name: p.name, avatar: p.avatar, bot: !!p.bot })),
      hands: {}, draw: [], discard: [], color: 'r', dir: 1, turn: Number.isInteger(firstSeat) && firstSeat >= 0 && firstSeat < players.length ? firstSeat : 0,
      pending: 0, pendingKind: null, pendingBy: null, drawn: null, ouch: null, preShout: null, winner: null,
      seed: seed | 0, events: [],
      hits: [], // bombs: a stacked pile someone had to take, credited to whoever stacked last
      stats: Object.fromEntries(players.map((p) => [p.k, { drawn: 0, stacked: 0, caught: 0, played: 0, wilds: 0 }])),
    };
    G.draw = shuffle(G, newDeck());
    for (let n = 0; n < HAND; n++) for (const p of G.players) (G.hands[p.k] = G.hands[p.k] || []).push(G.draw.pop());
    emit(G, { t: 'deal', n: HAND });
    // The first card can't be a Wild +4: tuck it back in and flip another.
    let first = G.draw.pop();
    while (first.v === 'w4') { G.draw.unshift(first); shuffle(G, G.draw); first = G.draw.pop(); }
    G.discard.push(first);
    G.color = first.c === 'w' ? COLORS[Math.floor(rand(G) * 4)] : first.c;
    emit(G, { t: 'start', card: first, color: G.color });
    if (first.v === 'skip') { emit(G, { t: 'skip', k: cur(G) }); step(G); }
    else if (first.v === 'rev') {
      if (G.players.length === 2) { emit(G, { t: 'skip', k: cur(G) }); step(G); }
      else { G.dir = -1; step(G); emit(G, { t: 'reverse', dir: G.dir }); } // play goes the other way from the first seat
    } else if (first.v === 'd2') { G.pending = 2; G.pendingKind = 'd2'; emit(G, { t: 'stack', total: 2, k: cur(G) }); }
    return G;
  }

  function canPlay(G, card) {
    if (G.pending > 0) return card.v === 'w4' || (card.v === 'd2' && G.pendingKind === 'd2');
    const t = top(G);
    return card.c === 'w' || card.c === G.color || card.v === t.v;
  }
  function legalMoves(G, k) {
    if (G.winner || cur(G) !== k) return [];
    const hand = G.hands[k];
    if (G.drawn) return hand.filter((c) => c.id === G.drawn && canPlay(G, c));
    return hand.filter((c) => canPlay(G, c));
  }

  // Take n cards off the draw pile, reshuffling the discards (all but the top) when it runs out.
  function take(G, n) {
    const got = [];
    for (let i = 0; i < n; i++) {
      if (!G.draw.length) {
        if (G.discard.length <= 1) break;
        const keep = G.discard.pop();
        G.draw = shuffle(G, G.discard);
        G.discard = [keep];
        emit(G, { t: 'reshuffle', n: G.draw.length });
      }
      got.push(G.draw.pop());
    }
    return got;
  }
  function give(G, k, n, why) {
    const cards = take(G, n);
    G.hands[k].push(...cards);
    G.stats[k].drawn += cards.length;
    emit(G, { t: 'draw', k, ids: cards.map((c) => c.id), why });
    if (G.ouch && G.ouch.k === k && G.hands[k].length > 1) G.ouch = null;
    return cards;
  }
  // Anyone else acting closes the window to catch a player who didn't shout.
  function acted(G, k) { if (G.ouch && G.ouch.k !== k) G.ouch = null; }

  const fail = (why) => ({ ok: false, why });

  function play(G, k, id, color) {
    if (G.winner) return fail('over');
    if (cur(G) !== k) return fail('turn');
    const hand = G.hands[k], i = hand.findIndex((c) => c.id === id);
    if (i < 0) return fail('card');
    const card = hand[i];
    if (G.drawn && G.drawn !== id) return fail('drawn');
    if (!canPlay(G, card)) return fail('match');
    if (card.c === 'w' && !COLORS.includes(color)) return fail('color');
    acted(G, k);
    hand.splice(i, 1);
    G.discard.push(card);
    G.color = card.c === 'w' ? color : card.c;
    G.drawn = null;
    G.stats[k].played++;
    if (card.c === 'w') G.stats[k].wilds++;
    emit(G, { t: 'play', k, card, color: G.color });
    if (hand.length === 1) { G.ouch = { k, said: G.preShout === k }; if (G.ouch.said) emit(G, { t: 'ouch', k }); }
    G.preShout = null;
    if (!hand.length) {
      G.winner = k;
      emit(G, { t: 'win', k });
      return { ok: true };
    }
    if (card.v === 'skip' || (card.v === 'rev' && G.players.length === 2)) {
      step(G); emit(G, { t: 'skip', k: cur(G) }); step(G);
    } else if (card.v === 'rev') {
      G.dir *= -1; emit(G, { t: 'reverse', dir: G.dir }); step(G);
    } else if (card.v === 'd2' || card.v === 'w4') {
      if (G.pending) G.stats[k].stacked++;
      G.pending += card.v === 'd2' ? 2 : 4;
      G.pendingKind = card.v;
      G.pendingBy = k;
      step(G);
      emit(G, { t: 'stack', total: G.pending, k: cur(G) });
    } else step(G);
    return { ok: true };
  }

  // Draw: either take the stacked penalty and lose the turn, or draw one and maybe play it.
  function draw(G, k) {
    if (G.winner) return fail('over');
    if (cur(G) !== k) return fail('turn');
    if (G.drawn) return fail('drawn');
    acted(G, k);
    G.preShout = null;
    if (G.pending) {
      const n = G.pending, by = G.pendingBy;
      G.pending = 0; G.pendingKind = null; G.pendingBy = null;
      if (by && by !== k) G.hits.push({ by, to: k, n });
      give(G, k, n, 'stack');
      step(G);
      return { ok: true };
    }
    const [card] = give(G, k, 1, 'turn');
    if (card && canPlay(G, card)) G.drawn = card.id;
    else { emit(G, { t: 'pass', k }); step(G); }
    return { ok: true };
  }
  function pass(G, k) {
    if (cur(G) !== k || !G.drawn) return fail('pass');
    G.drawn = null;
    emit(G, { t: 'pass', k });
    step(G);
    return { ok: true };
  }

  // "Ouch!": say it with one card left, or just before you play your second-to-last card.
  function shout(G, k) {
    if (G.winner) return fail('over');
    if (G.ouch && G.ouch.k === k && !G.ouch.said) { G.ouch.said = true; emit(G, { t: 'ouch', k }); return { ok: true }; }
    if (cur(G) === k && G.hands[k].length === 2 && G.preShout !== k) { G.preShout = k; emit(G, { t: 'ouch', k, early: true }); return { ok: true }; }
    return fail('shout');
  }
  function catchOut(G, by, k) {
    if (G.winner || by === k || !G.ouch || G.ouch.k !== k || G.ouch.said) return fail('catch');
    G.ouch = null;
    G.stats[k].caught++;
    emit(G, { t: 'caught', k, by });
    give(G, k, 2, 'caught');
    return { ok: true };
  }

  // A sensible bot: stack when it can, hit players who are nearly out, keep wilds for last.
  function botMove(G, k) {
    const moves = legalMoves(G, k);
    if (G.drawn) return moves.length ? { t: 'play', id: moves[0].id, color: bestColor(G, k) } : { t: 'pass' };
    if (!moves.length) return { t: 'draw' };
    const next = G.players[(((G.turn + G.dir) % G.players.length) + G.players.length) % G.players.length].k;
    const danger = G.hands[next].length <= 2;
    const score = (c) => {
      if (c.v === 'w4') return danger ? 9 : 1;
      if (c.v === 'wild') return 2;
      if (['d2', 'skip', 'rev'].includes(c.v)) return danger ? 8 : 5;
      return 4 + (c.c === G.color ? 1 : 0) + Number(c.v) / 10;
    };
    const best = moves.slice().sort((a, b) => score(b) - score(a))[0];
    return { t: 'play', id: best.id, color: best.c === 'w' ? bestColor(G, k, best.id) : undefined };
  }
  function bestColor(G, k, skipId) {
    const count = { r: 0, y: 0, g: 0, b: 0 };
    G.hands[k].forEach((c) => { if (c.id !== skipId && c.c !== 'w') count[c.c]++; });
    return COLORS.slice().sort((a, b) => count[b] - count[a])[0];
  }

  // Everything one player is allowed to see.
  function viewFor(G, k) {
    return {
      players: G.players.map((p) => ({ ...p, n: G.hands[p.k].length })),
      hand: G.hands[k] || [],
      top: G.discard.slice(-6),
      drawN: G.draw.length,
      color: G.color, dir: G.dir, turn: cur(G), pending: G.pending, pendingKind: G.pendingKind,
      drawn: G.drawn && cur(G) === k ? G.drawn : null,
      ouch: G.ouch, preShout: G.preShout, winner: G.winner,
      hands: G.winner ? G.hands : null,
      stats: G.winner ? G.stats : null,
      hits: G.winner ? G.hits || [] : null,
    };
  }
  // Events as one player may see them: drawn cards stay secret from everyone but the drawer.
  const BY_ID = Object.fromEntries(newDeck().map((c) => [c.id, c]));
  function eventsFor(events, k) {
    return events.map((e) => {
      if (e.t !== 'draw') return e;
      const out = { t: 'draw', k: e.k, n: e.ids.length, why: e.why };
      if (e.k === k) out.cards = e.ids.map((id) => BY_ID[id]);
      return out;
    });
  }

  const api = { COLORS, HAND, newDeck, newGame, rand, shuffle, top, cur, canPlay, legalMoves, play, draw, pass, shout, catchOut, botMove, bestColor, viewFor, eventsFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PlusFourRules = api;
})(typeof window !== 'undefined' ? window : globalThis);
