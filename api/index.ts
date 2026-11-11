// Sweet Revenge API: a Neon Function that saves chat messages and finished games to Postgres.
// The site is static, so browsers call this directly. Every request carries the player's login
// proof (the same one the games already use), and nothing is written for anyone who can't prove it.
// Bodies are sent as text/plain JSON so browsers skip the CORS preflight (and keepalive works).
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { Pool, type PoolClient } from 'pg';
import { attachDatabasePool } from '@neon/functions';
import { createHash, timingSafeEqual } from 'node:crypto';
// @ts-ignore: plain JS module, shared with the tests
import { progress } from './progress.mjs';
import { parseTriggerDelivery } from '@neon/functions/triggers';
import { runBridge } from './bridge.ts';

// Same accounts as shared/core.js: only sha256(proof) is stored, never the proof itself.
export const ACCOUNTS: Record<string, { name: string; hash: string }> = {
  'panchara kunju': { name: 'Panchara Kunju', hash: '1c760216a90d9924ba7ea7afe921cce796b25e5a6e4ba08a27dcb8d39ddab814' },
  ammu: { name: 'Ammu', hash: 'be56b7ac72bc7a13c0c7134ac0275310dd0c56a004adc0975a72623c2cc35210' },
};
const KINDS = ['ludo', 'plusfour', 'doodle'];
const ORIGINS = [/^https:\/\/rishirajns13-hue\.github\.io$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
attachDatabasePool(pool);

type Me = { id: string; name: string };
type Body = Record<string, unknown>;
const sha256 = (t: string) => createHash('sha256').update(t).digest();
const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null);
const int = (v: unknown) => (Number.isInteger(v) && Math.abs(v as number) < 1e7 ? (v as number) : null);
const room = (v: unknown) => (typeof v === 'string' && /^[A-Z0-9]{6}$/.test(v) ? v : null);

function check(body: Body): Me | null {
  const id = typeof body.user === 'string' ? body.user.trim().toLowerCase() : '';
  const acc = ACCOUNTS[id];
  if (!acc || typeof body.proof !== 'string' || body.proof.length > 200) return null;
  const want = Buffer.from(acc.hash, 'hex'), got = sha256(body.proof);
  return timingSafeEqual(want, got) ? { id, name: acc.name } : null;
}
async function readBody(c: Context): Promise<Body | null> {
  const text = await c.req.text();
  if (text.length > 64_000) return null;
  try { const b = JSON.parse(text); return b && typeof b === 'object' && !Array.isArray(b) ? b : null; } catch { return null; }
}
async function tx<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query('begin');
    const out = await fn(db);
    await db.query('commit');
    return out;
  } catch (e) {
    await db.query('rollback').catch(() => {});
    throw e;
  } finally { db.release(); }
}
const seen = (db: PoolClient | Pool, ids: Me[]) => Promise.all(ids.map((p) => db.query(
  'insert into players (id, name) values ($1, $2) on conflict (id) do update set name = excluded.name, last_seen = now()',
  [p.id, p.name])));

const app = new Hono();
app.use('*', cors({ origin: (o) => (ORIGINS.some((r) => r.test(o)) ? o : null), allowMethods: ['GET', 'POST'] }));
app.onError((err, c) => { console.error(err); return c.json({ error: 'server' }, 500); });
app.get('/', (c) => c.text('Sweet Revenge API 🍦'));

// Every minute Neon's schedule trigger wakes the relay bridge (api/bridge.ts), for players whose
// network blocks this address. Only genuine trigger deliveries get through.
app.post('/relay-tick', async (c) => {
  const parsed = await parseTriggerDelivery(c.req.raw);
  if (!parsed.ok) return c.text(parsed.error, parsed.error === 'invalid_body' ? 400 : 401);
  return c.json(await runBridge(app));
});

// Every route below needs a valid login.
const authed = (fn: (c: Context, me: Me, body: Body) => Promise<Response>) => async (c: Context) => {
  const body = await readBody(c);
  if (!body) return c.json({ error: 'bad body' }, 400);
  const me = check(body);
  if (!me) return c.json({ error: 'unauthorized' }, 401);
  return fn(c, me, body);
};

/* ---------- chat: { game, room, kind: 'chat'|'sticker', body, cid } ---------- */
app.post('/chat', authed(async (c, me, b) => {
  const game = KINDS.includes(b.game as string) ? (b.game as string) : null;
  const kind = b.kind === 'chat' || b.kind === 'sticker' ? b.kind : null;
  const text = str(b.body, 300), cid = str(b.cid, 40);
  if (!game || !kind || !text) return c.json({ error: 'bad message' }, 400);
  await seen(pool, [me]);
  await pool.query(
    'insert into chat_messages (client_id, game, room, sender, kind, body) values ($1, $2, $3, $4, $5, $6) on conflict (client_id) do nothing',
    [cid, game, room(b.room), me.id, kind, text]);
  return c.json({ ok: true });
}));

// Recent messages in a room (or everywhere): { room?, limit? }
app.post('/chat/history', authed(async (c, _me, b) => {
  const limit = Math.min(Math.max(int(b.limit) || 50, 1), 200), r = room(b.room);
  const { rows } = await pool.query(
    `select m.id, m.game, m.room, m.sender, p.name, m.kind, m.body, m.sent_at from chat_messages m join players p on p.id = m.sender
     where ($1::text is null or m.room = $1) order by m.sent_at desc limit $2`, [r, limit]);
  return c.json({ messages: rows.reverse() });
}));

/* ---------- a finished game ----------
   { game: { kind, gid, room, practice, startedAt, players: [{ name, bot, place, score, team }],
             winners: [name], stats: { name: {...} }, hits: [{ kind, by: name, to: name, cards }] } } */
app.post('/game', authed(async (c, me, b) => {
  const g = (b.game && typeof b.game === 'object' ? b.game : {}) as Body;
  const kind = KINDS.includes(g.kind as string) ? (g.kind as string) : null;
  const gid = typeof g.gid === 'string' && /^[a-z0-9]{1,16}$/.test(g.gid) ? g.gid : null;
  const list = Array.isArray(g.players) ? (g.players as Body[]) : [];
  if (!kind || !gid || list.length < 2 || list.length > 4) return c.json({ error: 'bad game' }, 400);

  // Map each seat's name to a player id. Humans must be real accounts; bots get 'bot:<name>'.
  const ids = new Map<string, string>(), humans: Me[] = [], players: Body[] = [];
  for (const p of list) {
    const name = str(p && p.name, 40);
    if (!name || ids.has(name)) return c.json({ error: 'bad player' }, 400);
    const bot = p.bot === true, acc = ACCOUNTS[name.toLowerCase()];
    if (!bot && !acc) return c.json({ error: 'unknown player' }, 400);
    const id = bot ? `bot:${name}` : name.toLowerCase();
    ids.set(name, id);
    if (!bot) humans.push({ id, name: acc.name });
    players.push({ id, name, bot, place: int(p.place), score: int(p.score), team: int(p.team) });
  }
  if (!humans.some((h) => h.id === me.id)) return c.json({ error: 'not your game' }, 403);
  const idOf = (n: unknown) => (typeof n === 'string' ? ids.get(n) : undefined);

  const winners = (Array.isArray(g.winners) ? g.winners : []).map(idOf).filter(Boolean) as string[];
  const stats: Record<string, unknown> = {};
  if (g.stats && typeof g.stats === 'object') for (const [n, v] of Object.entries(g.stats)) { const id = idOf(n); if (id) stats[id] = v; }
  const hits = (Array.isArray(g.hits) ? (g.hits as Body[]) : []).slice(0, 500).map((h) => ({
    kind: h && (h.kind === 'bonk' || h.kind === 'bomb') ? h.kind : null, by: idOf(h && h.by), to: idOf(h && h.to), cards: int(h && h.cards),
  })).filter((h) => h.kind && h.by && h.to && h.by !== h.to);
  const started = typeof g.startedAt === 'number' && g.startedAt > 1.7e12 && g.startedAt <= Date.now() ? new Date(g.startedAt) : null;

  const saved = await tx(async (db) => {
    await seen(db, humans);
    const r = await db.query(
      `insert into games (id, kind, room, practice, started_at, winners, players, stats, saved_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict (id) do nothing returning id`,
      [`${kind}:${gid}`, kind, room(g.room), g.practice === true, started, winners, JSON.stringify(players), JSON.stringify(stats), me.id]);
    if (!r.rowCount) return false; // another player's browser already saved it
    if (hits.length) await db.query(
      `insert into hits (game_id, kind, by_player, to_player, cards)
       select $1, * from unnest($2::text[], $3::text[], $4::text[], $5::int[])`,
      [`${kind}:${gid}`, hits.map((h) => h.kind), hits.map((h) => h.by), hits.map((h) => h.to), hits.map((h) => h.cards)]);
    return true;
  });
  return c.json({ ok: true, saved });
}));

/* ---------- your profile: level, achievements, revenge board, recent games, and proof the DB is live ----------
   Achievements are worked out from the history (api/progress.mjs); new ones are stored with the time they unlocked. */
const MINE = "players @> jsonb_build_array(jsonb_build_object('id', $1::text))";
app.post('/me', authed(async (c, me) => {
  const q = (sql: string, args: unknown[] = [me.id]) => pool.query(sql, args).then((r) => r.rows);
  await seen(pool, [me]); // so a visit shows up as players.last_seen, even before any game is saved
  const [games, myHits, bonked, revenge, chats, rivalry, saved, stored] = await Promise.all([
    q(`select id, kind, room, practice, started_at, ended_at, winners, players, stats -> $1 as mine from games where ${MINE} order by ended_at`),
    q(`select game_id, kind, count(*)::int as n, coalesce(sum(cards), 0)::int as cards, max(cards)::int as biggest
       from hits where by_player = $1 group by game_id, kind`),
    q(`select coalesce(max(n), 0)::int as m from (select count(*) as n from hits where kind = 'bonk' and to_player = $1 group by game_id) t`),
    q(`select distinct a.kind from hits a where a.to_player = $1 and exists (
         select 1 from hits b where b.game_id = a.game_id and b.kind = a.kind and b.by_player = $1 and b.to_player = a.by_player and b.id > a.id)`),
    q('select count(*)::int as n from chat_messages where sender = $1'),
    q(`select r.*, coalesce(pb.name, replace(r.by_player, 'bot:', '')) as by_name, coalesce(pt.name, replace(r.to_player, 'bot:', '')) as to_name
       from rivalry r left join players pb on pb.id = r.by_player left join players pt on pt.id = r.to_player
       where r.by_player = $1 or r.to_player = $1 order by r.times desc`),
    q(`select (select count(*) from games)::int as games, (select count(*) from chat_messages)::int as messages,
              (select count(*) from hits)::int as hits, (select max(ended_at) from games) as last_game`, []),
    q('select achievement, unlocked_at from achievements where player_id = $1'),
  ]);

  const hitsBy = new Map<string, { bonks: number; bombs: number; bombCards: number }>();
  let bigBomb = 0;
  for (const h of myHits) {
    const e = hitsBy.get(h.game_id) || { bonks: 0, bombs: 0, bombCards: 0 };
    if (h.kind === 'bonk') e.bonks += h.n; else { e.bombs += h.n; e.bombCards += h.cards; bigBomb = Math.max(bigBomb, h.biggest || 0); }
    hitsBy.set(h.game_id, e);
  }
  const facts = {
    games: games.map((g) => ({
      kind: g.kind, practice: g.practice, won: g.winners.includes(me.id), ...(hitsBy.get(g.id) || { bonks: 0, bombs: 0, bombCards: 0 }),
      score: g.kind === 'doodle' ? (g.players.find((p: Body) => p.id === me.id) || {}).score || 0 : 0,
      fastest: (g.mine && g.mine.fastest) || 0,
    })),
    bigBomb, maxBonkedInGame: bonked[0].m, chats: chats[0].n,
    revengeBonk: revenge.some((r) => r.kind === 'bonk'), revengeBomb: revenge.some((r) => r.kind === 'bomb'),
  };
  type Ach = { id: string; icon: string; name: string; how: string; have: number; need: number; done: boolean };
  const prog: { level: number; title: string; xp: number; from: number; to: number | null; achievements: Ach[] } = progress(facts);

  // Store any achievement that just unlocked, so it keeps its unlock time.
  const when = new Map(stored.map((r) => [r.achievement, r.unlocked_at]));
  const fresh = prog.achievements.filter((a) => a.done && !when.has(a.id));
  if (fresh.length) {
    await pool.query(
      `insert into achievements (player_id, achievement) select $1, unnest($2::text[]) on conflict do nothing`, [me.id, fresh.map((a) => a.id)]);
    fresh.forEach((a) => when.set(a.id, new Date()));
  }
  await pool.query('update players set xp = $2, last_seen = now() where id = $1', [me.id, prog.xp]);

  const recent = games.slice(-12).reverse().map((g) => ({
    id: g.id, kind: g.kind, room: g.room, practice: g.practice, startedAt: g.started_at, endedAt: g.ended_at,
    won: g.winners.includes(me.id), winners: g.winners,
    players: g.players.map((p: Body) => ({ id: p.id, name: p.name, bot: p.bot, place: p.place, score: p.score })),
    mine: { ...(g.mine || {}), ...(hitsBy.get(g.id) || {}) },
  }));
  const played = (k?: string) => facts.games.filter((g) => !k || g.kind === k);
  return c.json({
    me, level: { level: prog.level, title: prog.title, xp: prog.xp, from: prog.from, to: prog.to },
    record: { played: played().length, won: played().filter((g) => g.won).length,
      byKind: Object.fromEntries(['ludo', 'plusfour', 'doodle'].map((k) => [k, { played: played(k).length, won: played(k).filter((g) => g.won).length }])) },
    achievements: prog.achievements.map((a) => ({ ...a, unlockedAt: when.get(a.id) || null })),
    rivalry, recent, db: { ...saved[0], at: new Date() },
  });
}));

export default app;
