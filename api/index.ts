// Sweet Revenge API: a Neon Function that saves chat messages and finished games to Postgres.
// The site is static, so browsers call this directly. Every request carries the player's login
// proof (the same one the games already use), and nothing is written for anyone who can't prove it.
// Bodies are sent as text/plain JSON so browsers skip the CORS preflight (and keepalive works).
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { Pool, type PoolClient } from 'pg';
import { attachDatabasePool } from '@neon/functions';
import { createHash, timingSafeEqual } from 'node:crypto';

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

/* ---------- your history: totals per game, who you've bonked/bombed, recent games ---------- */
app.post('/me', authed(async (c, me) => {
  const [totals, rivalry, recent, achievements] = await Promise.all([
    pool.query(
      `select kind, count(*)::int as played, count(*) filter (where $1 = any(winners))::int as won
       from games where players @> jsonb_build_array(jsonb_build_object('id', $1::text)) group by kind`, [me.id]),
    pool.query('select * from rivalry where by_player = $1 or to_player = $1 order by times desc', [me.id]),
    pool.query(
      `select id, kind, room, practice, ended_at, winners, players from games
       where players @> jsonb_build_array(jsonb_build_object('id', $1::text)) order by ended_at desc limit 10`, [me.id]),
    pool.query('select achievement, unlocked_at from achievements where player_id = $1 order by unlocked_at', [me.id]),
  ]);
  return c.json({ me, totals: totals.rows, rivalry: rivalry.rows, recent: recent.rows, achievements: achievements.rows });
}));

export default app;
