-- Sweet Revenge database. Safe to run again: everything is "if not exists".
-- Apply with: node api/migrate.mjs
-- Player ids are lowercase login names ('ammu'); bots are stored as 'bot:<name>' in games and hits.

create table if not exists players (
  id          text primary key,             -- lowercase login name
  name        text not null,                -- display name
  xp          integer not null default 0,   -- for levels (coming next)
  created_at  timestamptz not null default now(),
  last_seen   timestamptz not null default now()
);

-- One row per finished game. id = '<kind>:<gid>', so every player's browser can send the
-- result and only the first copy is kept.
create table if not exists games (
  id          text primary key,
  kind        text not null,
  room        text,                          -- room code, null for practice
  practice    boolean not null default false,
  started_at  timestamptz,
  ended_at    timestamptz not null default now(),
  winners     text[] not null default '{}',  -- player ids ('bot:…' for bots)
  players     jsonb not null,                -- [{ id, name, bot, place, score, team }]
  stats       jsonb not null default '{}',   -- per-player game stats, keyed by player id
  saved_by    text references players(id)
);
create index if not exists games_ended_idx on games (ended_at desc);
create index if not exists games_winners_idx on games using gin (winners);

-- Every bonk (Ludo) and bomb (Plus Four: a stacked +2/+4 pile someone had to take).
create table if not exists hits (
  id          bigserial primary key,
  game_id     text not null references games(id) on delete cascade,
  kind        text not null,
  by_player   text not null,
  to_player   text not null,
  cards       integer,                       -- bombs: how many cards the pile was
  at          timestamptz not null default now()
);
create index if not exists hits_pair_idx on hits (kind, by_player, to_player);

-- Typed messages and stickers. Voice notes and reactions are never stored.
create table if not exists chat_messages (
  id          bigserial primary key,
  client_id   text unique,                   -- sent by the browser so a retry isn't saved twice
  game        text not null,
  room        text,
  sender      text not null references players(id),
  kind        text not null check (kind in ('chat', 'sticker')),
  body        text not null check (length(body) between 1 and 300),
  sent_at     timestamptz not null default now()
);
create index if not exists chat_room_idx on chat_messages (room, sent_at desc);

-- Unlocked achievements (the list itself lives in the game code; see GAME-IDEAS.md).
create table if not exists achievements (
  player_id    text not null references players(id),
  achievement  text not null,
  game_id      text references games(id) on delete set null,
  unlocked_at  timestamptz not null default now(),
  primary key (player_id, achievement)
);

-- Who bonked / bombed whom, all time.
create or replace view rivalry as
  select kind, by_player, to_player, count(*)::int as times, coalesce(sum(cards), 0)::int as cards
  from hits group by kind, by_player, to_player;

-- Allowed game and hit kinds. Kept as named constraints so new games only need these two lines changed.
-- (Re-running is safe: each is dropped and added again.)
alter table games drop constraint if exists games_kind_check;
alter table games add constraint games_kind_check check (kind in ('ludo', 'plusfour', 'doodle', 'snakes', 'race'));
alter table hits drop constraint if exists hits_kind_check;
alter table hits add constraint hits_kind_check check (kind in ('bonk', 'bomb', 'splat'));
