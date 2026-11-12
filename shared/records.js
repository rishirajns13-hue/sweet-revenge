'use strict';
/* Sweet Revenge history: saves typed chat, stickers and finished games to the Supabase database,
   and loads your profile (level, trophies, rivals, recent games). Voice notes and emoji reactions
   are never sent. Needs shared/core.js (for `sb`, the Supabase client, and `me`).

   Saving goes through checked database functions (save_game, save_chat); the browser can't write
   to the tables directly. Saves wait in an outbox on this device until the database has them,
   so a game finished while offline is sent the next time any page opens. */
const records = (() => {
  const cid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  let progressLib = null;
  const loadProgress = () => (progressLib ||= import('./progress.mjs'));

  /* ---------- outbox: saves wait on this device until the database has them ---------- */
  const OUTBOX = 'sr-outbox2';
  const readBox = () => { const b = store.get(OUTBOX, []); return Array.isArray(b) ? b : []; };
  function save(fn, args) {
    const item = { id: cid(), fn, args, at: Date.now() };
    store.set(OUTBOX, readBox().concat(item).slice(-60));
    deliver(item);
  }
  const offline = (error) => !error.code && /fetch|network|load failed/i.test(error.message || '');
  async function deliver(item) {
    if (!me) return;
    const { error } = await sb.rpc(item.fn, item.args);
    // Done, or refused for good (a bad save won't get better by retrying): drop it from the outbox.
    if (!error || !offline(error)) store.set(OUTBOX, readBox().filter((x) => x.id !== item.id));
    if (error && !offline(error)) console.warn('Not saved:', item.fn, error.message);
  }
  function flush() {
    const week = Date.now() - 7 * 864e5, box = readBox().filter((x) => x.at > week);
    store.set(OUTBOX, box);
    box.forEach((item, i) => setTimeout(() => deliver(item), i * 300));
  }
  addEventListener('online', flush);
  // Once the login is loaded (core.js sets `me` when the page starts), send any leftovers.
  const waitForMe = setInterval(() => { if (me) { clearInterval(waitForMe); flush(); } }, 1000);
  setTimeout(() => clearInterval(waitForMe), 60000);

  /* ---------- your profile ---------- */
  const num = (o, keys) => { for (const k of keys) if (o && typeof o[k] === 'number') return o[k]; return 0; };
  async function profile() {
    if (!me) return null;
    const [{ data: r, error }, P] = await Promise.all([sb.rpc('my_profile'), loadProgress()]);
    if (error || !r) return null;
    const id = r.me.id, none = () => ({ bonks: 0, bombs: 0, bombCards: 0 });
    const hitsBy = new Map();
    let bigBomb = 0;
    for (const h of r.myHits) {
      const e = hitsBy.get(h.game_id) || none();
      if (h.kind === 'bonk') e.bonks += h.n;
      else { e.bombs += h.n; e.bombCards += h.cards; bigBomb = Math.max(bigBomb, h.biggest || 0); }
      hitsBy.set(h.game_id, e);
    }
    const facts = {
      games: r.games.map((g) => ({
        kind: g.kind, practice: g.practice, won: g.winners.includes(id), ...(hitsBy.get(g.id) || none()),
        score: g.kind === 'doodle' ? (g.players.find((p) => p.id === id) || {}).score || 0 : 0,
        fastest: (g.mine && g.mine.fastest) || 0,
        snakesSlid: num(g.mine, ['snakes', 'snakesSlid', 'slid']), longestLadder: num(g.mine, ['longestLadder', 'longest']),
      })),
      bigBomb, maxBonkedInGame: r.maxBonked, chats: r.chats,
      revengeBonk: r.revenge.includes('bonk'), revengeBomb: r.revenge.includes('bomb'),
    };
    const prog = P.progress(facts), when = r.stored;
    // Store XP and any trophy that just unlocked, so it keeps its unlock time.
    const fresh = prog.achievements.filter((a) => a.done && !when[a.id]);
    sb.rpc('store_progress', { p_xp: prog.xp, p_achievements: prog.achievements.filter((a) => a.done).map((a) => a.id) }).then(() => {});
    const now = new Date().toISOString();
    fresh.forEach((a) => (when[a.id] = now));

    // Your display name may have changed on another device: keep this one in step.
    if (r.me.name !== me.name) { saveMe({ name: r.me.name }); document.dispatchEvent(new Event('profilechange')); }

    const played = (k) => facts.games.filter((g) => !k || g.kind === k);
    return {
      me: { id, name: r.me.name, avatar: r.me.avatar, theme: r.me.theme },
      level: { level: prog.level, title: prog.title, xp: prog.xp, from: prog.from, to: prog.to },
      record: { played: played().length, won: played().filter((g) => g.won).length,
        byKind: Object.fromEntries(P.KINDS.map((k) => [k, { played: played(k).length, won: played(k).filter((g) => g.won).length }])) },
      achievements: prog.achievements.map((a) => ({ ...a, unlockedAt: when[a.id] || null })),
      rivalry: r.rivalry,
      recent: r.games.slice(-12).reverse().map((g) => ({
        id: g.id, kind: g.kind, room: g.room, practice: g.practice, startedAt: g.started_at, endedAt: g.ended_at,
        won: g.winners.includes(id), winners: g.winners,
        players: g.players.map((p) => ({ id: p.id, name: p.name, bot: p.bot, place: p.place, score: p.score })),
        mine: { ...(g.mine || {}), ...(hitsBy.get(g.id) || {}) },
      })),
      db: r.db,
    };
  }

  /* ---------- live: tell the page when a game or trophy lands, instead of polling ---------- */
  let channel = null;
  function onChange(cb) {
    if (channel || !me) return;
    let t = 0;
    const ping = () => { clearTimeout(t); t = setTimeout(cb, 400); }; // a game brings several rows at once
    channel = sb.channel('sr-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'games' }, ping)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'achievements' }, ping)
      .subscribe();
  }

  const sent = new Set();
  return {
    // A message this player just sent. `text` is the message, or the sticker's words.
    chat(game, room, kind, text) {
      if ((kind === 'chat' || kind === 'sticker') && text) {
        save('save_chat', { p_game: game, p_room: room || null, p_kind: kind, p_body: String(text).slice(0, 300), p_cid: cid() });
      }
    },
    /* A finished game, sent by every human player's browser; the database keeps the first copy.
       { kind, gid, room, practice, startedAt, players: [{ name, bot, place, score, team }],
         winners: [name], stats: { name: {...} }, hits: [{ kind: 'bonk'|'bomb', by: name, to: name, cards }] } */
    game(g) {
      const key = g.kind + ':' + g.gid;
      if (!g.gid || sent.has(key)) return;
      sent.add(key);
      save('save_game', { g });
    },
    me: profile,
    onChange,
    // Change your display name. Resolves with null when it worked, or a short message saying why not.
    async rename(name) {
      const { data, error } = await sb.rpc('update_me', { p_name: name });
      if (error) return /taken/.test(error.message) ? 'Someone already has that name' : /name:/.test(error.message) ? '2–20 letters, numbers or spaces' : "Couldn't save. Try again?";
      saveMe({ name: data.name });
      document.dispatchEvent(new Event('profilechange'));
      return null;
    },
    // Change your password (you stay logged in).
    async setPassword(pass) {
      const { error } = await sb.auth.updateUser({ password: pass });
      return error ? (/weak|short|characters/i.test(error.message) ? 'Pick a longer password (6+ characters)' : /same/i.test(error.message) ? "That's already your password" : "Couldn't change it. Try again?") : null;
    },
  };
})();
