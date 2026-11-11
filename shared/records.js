'use strict';
/* Sweet Revenge history: saves typed chat, stickers and finished games to the database
   (the Neon Function in api/). Voice notes and emoji reactions are never sent.
   Fire and forget: if the API can't be reached the game carries on and that bit just isn't saved.
   Needs shared/core.js (for `me`, the logged-in player and their login proof). */
const RECORDS_URL = 'https://br-empty-shadow-a1673mbz-api.compute.c-1.ap-southeast-1.aws.neon.tech';

const records = (() => {
  // text/plain keeps this a "simple" request: no CORS preflight, and keepalive works on page close.
  function post(path, body) {
    if (!me) return Promise.resolve(null);
    return fetch(RECORDS_URL + path, {
      method: 'POST', keepalive: true, headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ ...body, user: me.user || me.name, proof: me.proof }),
    }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  }
  const cid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  const sent = new Set();
  return {
    // A message this player just sent. `text` is the message, or the sticker's words.
    chat(game, room, kind, text) {
      if ((kind === 'chat' || kind === 'sticker') && text) post('/chat', { game, room: room || null, kind, body: String(text).slice(0, 300), cid: cid() });
    },
    /* A finished game, sent by every human player's browser; the server keeps the first copy.
       { kind, gid, room, practice, startedAt, players: [{ name, bot, place, score, team }],
         winners: [name], stats: { name: {...} }, hits: [{ kind: 'bonk'|'bomb', by: name, to: name, cards }] } */
    game(g) {
      const key = g.kind + ':' + g.gid;
      if (!g.gid || sent.has(key)) return;
      sent.add(key);
      post('/game', { game: g });
    },
    me: () => post('/me', {}),
    chatHistory: (room, limit) => post('/chat/history', { room, limit }),
  };
})();
