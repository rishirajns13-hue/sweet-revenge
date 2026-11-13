-- Sweet Revenge database on Supabase (project tzksdygcuykycrmwwxrv).
-- This is the four migrations applied on 12 Nov 2026, in order, kept here so the database can be rebuilt
-- on a fresh project (paste into the SQL editor). Player ids are lowercase login names ('ammu');
-- bots are 'bot:<name>'.

/* ===================== 1. tables and read access ===================== */
create table public.players (
  id          text primary key,
  uid         uuid unique references auth.users(id) on delete set null,
  name        text not null,
  avatar      text,
  theme       text,
  xp          integer not null default 0,
  created_at  timestamptz not null default now(),
  last_seen   timestamptz not null default now()
);
create unique index players_name_ci on public.players (lower(name));

create table public.games (
  id          text primary key,
  kind        text not null check (kind in ('ludo', 'plusfour', 'doodle', 'snakes', 'sundae', 'sticky')),
  room        text,
  practice    boolean not null default false,
  started_at  timestamptz,
  ended_at    timestamptz not null default now(),
  winners     text[] not null default '{}',
  players     jsonb not null,
  stats       jsonb not null default '{}',
  saved_by    text references public.players(id)
);
create index games_ended_idx on public.games (ended_at desc);
create index games_players_idx on public.games using gin (players jsonb_path_ops);
create index games_saved_by_idx on public.games (saved_by);

create table public.hits (
  id          bigint generated always as identity primary key,
  game_id     text not null references public.games(id) on delete cascade,
  kind        text not null check (kind in ('bonk', 'bomb')),
  by_player   text not null,
  to_player   text not null,
  cards       integer,
  at          timestamptz not null default now()
);
create index hits_pair_idx on public.hits (kind, by_player, to_player);
create index hits_game_idx on public.hits (game_id);
create index hits_to_idx on public.hits (to_player);

create table public.chat_messages (
  id          bigint generated always as identity primary key,
  client_id   text unique,
  game        text not null,
  room        text,
  sender      text not null references public.players(id),
  kind        text not null check (kind in ('chat', 'sticker')),
  body        text not null check (length(body) between 1 and 300),
  sent_at     timestamptz not null default now()
);
create index chat_room_idx on public.chat_messages (room, sent_at desc);
create index chat_sender_idx on public.chat_messages (sender);

create table public.achievements (
  player_id    text not null references public.players(id),
  achievement  text not null,
  unlocked_at  timestamptz not null default now(),
  primary key (player_id, achievement)
);

create view public.rivalry with (security_invoker = true) as
  select kind, by_player, to_player, count(*)::int as times, coalesce(sum(cards), 0)::int as cards
  from public.hits group by kind, by_player, to_player;

-- The friends who may have an account. Nobody else can sign up.
insert into public.players (id, name) values ('panchara kunju', 'Panchara Kunju'), ('ammu', 'Ammu');

-- Row level security: logged-in friends can read everything; all writes go through the functions below.
alter table public.players enable row level security;
alter table public.games enable row level security;
alter table public.hits enable row level security;
alter table public.chat_messages enable row level security;
alter table public.achievements enable row level security;
create policy "friends read players" on public.players for select to authenticated using (true);
create policy "friends read games" on public.games for select to authenticated using (true);
create policy "friends read hits" on public.hits for select to authenticated using (true);
create policy "friends read chat" on public.chat_messages for select to authenticated using (true);
create policy "friends read achievements" on public.achievements for select to authenticated using (true);

/* ===================== 2. functions the site calls ===================== */
-- Sign-up gate: an account can only be made for a listed friend, once. Links the auth user to the player.
create or replace function public.link_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare uname text := lower(trim(new.raw_user_meta_data ->> 'username'));
begin
  update public.players set uid = new.id where id = uname and uid is null;
  if not found then raise exception 'Sign-ups are closed: % is not on the friends list', coalesce(uname, '?'); end if;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.link_new_user();

-- The player id of whoever is calling (null if not logged in or not a friend).
create or replace function public.my_id() returns text
language sql stable security definer set search_path = '' as $$
  select id from public.players where uid = auth.uid()
$$;

-- Keep-alive for the free plan (called once a day by .github/workflows/keepalive.yml).
create or replace function public.ping() returns text
language sql security definer set search_path = '' as $$
  select 'pong ' || count(*)::text from public.players
$$;

-- A chat message or sticker. Duplicates (same client id) are ignored.
create or replace function public.save_chat(p_game text, p_room text, p_kind text, p_body text, p_cid text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare me text := public.my_id();
begin
  if me is null then raise exception 'not logged in'; end if;
  if p_game not in ('ludo', 'plusfour', 'doodle', 'snakes', 'sundae', 'sticky') or p_kind not in ('chat', 'sticker') then return false; end if;
  insert into public.chat_messages (client_id, game, room, sender, kind, body)
  values (left(p_cid, 40), p_game, case when p_room ~ '^[A-Z0-9]{6}$' then p_room end, me, p_kind, left(trim(p_body), 300))
  on conflict (client_id) do nothing;
  update public.players set last_seen = now() where id = me;
  return true;
end $$;

/* A finished game, sent by every human player's browser; the first copy is kept.
   g = { kind, gid, room, practice, startedAt, players: [{ name, bot, place, score, team }],
         winners: [name], stats: { name: {...} }, hits: [{ kind, by: name, to: name, cards }] } */
create or replace function public.save_game(g jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  me text := public.my_id();
  kind text := g ->> 'kind';
  gid text := g ->> 'gid';
  ids jsonb := '{}';            -- seat name -> player id
  players jsonb := '[]';
  p jsonb; pname text; pid text; is_bot boolean;
  stats jsonb := '{}'; k text; v jsonb;
  winners text[] := '{}';
  started timestamptz;
  game_id text;
begin
  if me is null then raise exception 'not logged in'; end if;
  if kind not in ('ludo', 'plusfour', 'doodle', 'snakes', 'sundae', 'sticky') or gid !~ '^[a-z0-9]{1,16}$'
     or jsonb_typeof(g -> 'players') <> 'array' or jsonb_array_length(g -> 'players') not between 2 and 4 then
    raise exception 'bad game';
  end if;
  for p in select * from jsonb_array_elements(g -> 'players') loop
    pname := left(trim(p ->> 'name'), 40);
    is_bot := coalesce((p ->> 'bot')::boolean, false);
    if pname is null or pname = '' or ids ? pname then raise exception 'bad player'; end if;
    if is_bot then pid := 'bot:' || pname;
    else
      select id into pid from public.players where lower(name) = lower(pname) or id = lower(pname) limit 1;
      if pid is null then raise exception 'unknown player %', pname; end if;
    end if;
    ids := ids || jsonb_build_object(pname, pid);
    players := players || jsonb_build_array(jsonb_build_object('id', pid, 'name', pname, 'bot', is_bot,
      'place', case when jsonb_typeof(p -> 'place') = 'number' then p -> 'place' end,
      'score', case when jsonb_typeof(p -> 'score') = 'number' then p -> 'score' end,
      'team',  case when jsonb_typeof(p -> 'team')  = 'number' then p -> 'team'  end));
  end loop;
  if not exists (select 1 from jsonb_each_text(ids) e where e.value = me) then raise exception 'not your game'; end if;

  select coalesce(array_agg(ids ->> w), '{}') into winners
    from jsonb_array_elements_text(coalesce(g -> 'winners', '[]')) w where ids ? w;
  if jsonb_typeof(g -> 'stats') = 'object' then
    for k, v in select * from jsonb_each(g -> 'stats') loop
      if ids ? k then stats := stats || jsonb_build_object(ids ->> k, v); end if;
    end loop;
  end if;
  if jsonb_typeof(g -> 'startedAt') = 'number' and (g ->> 'startedAt')::numeric between 1.7e12 and extract(epoch from now()) * 1000 then
    started := to_timestamp((g ->> 'startedAt')::numeric / 1000);
  end if;

  game_id := kind || ':' || gid;
  insert into public.games (id, kind, room, practice, started_at, winners, players, stats, saved_by)
  values (game_id, kind, case when g ->> 'room' ~ '^[A-Z0-9]{6}$' then g ->> 'room' end,
          coalesce((g ->> 'practice')::boolean, false), started, winners, players, stats, me)
  on conflict (id) do nothing;
  if not found then return false; end if;   -- another player's browser already saved it

  insert into public.hits (game_id, kind, by_player, to_player, cards)
  select game_id, h ->> 'kind', ids ->> (h ->> 'by'), ids ->> (h ->> 'to'),
         case when jsonb_typeof(h -> 'cards') = 'number' then (h ->> 'cards')::int end
  from (select h from jsonb_array_elements(coalesce(g -> 'hits', '[]')) h limit 500) x
  where h ->> 'kind' in ('bonk', 'bomb') and ids ? (h ->> 'by') and ids ? (h ->> 'to') and h ->> 'by' <> h ->> 'to';
  update public.players set last_seen = now() where id = me;
  return true;
end $$;

-- Everything the home screen needs, in one round trip. Levels and trophies are worked out in the
-- browser (shared/progress.mjs); store_progress() saves the result.
create or replace function public.my_profile() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me text := public.my_id(); out jsonb;
begin
  if me is null then raise exception 'not logged in'; end if;
  update public.players set last_seen = now() where id = me;
  select jsonb_build_object(
    'me', (select jsonb_build_object('id', id, 'name', name, 'avatar', avatar, 'theme', theme) from public.players where id = me),
    'games', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'room', room, 'practice', practice,
        'started_at', started_at, 'ended_at', ended_at, 'winners', winners, 'players', players, 'mine', stats -> me) order by ended_at)
      from public.games where players @> jsonb_build_array(jsonb_build_object('id', me))), '[]'),
    'myHits', coalesce((select jsonb_agg(t) from (select game_id, kind, count(*)::int as n, coalesce(sum(cards), 0)::int as cards,
        max(cards)::int as biggest from public.hits where by_player = me group by game_id, kind) t), '[]'),
    'maxBonked', (select coalesce(max(n), 0)::int from (select count(*) as n from public.hits
        where kind = 'bonk' and to_player = me group by game_id) t),
    'revenge', coalesce((select jsonb_agg(distinct a.kind) from public.hits a where a.to_player = me and exists (
        select 1 from public.hits b where b.game_id = a.game_id and b.kind = a.kind and b.by_player = me
        and b.to_player = a.by_player and b.id > a.id)), '[]'),
    'chats', (select count(*)::int from public.chat_messages where sender = me),
    'rivalry', coalesce((select jsonb_agg(r) from (select r.*, coalesce(pb.name, replace(r.by_player, 'bot:', '')) as by_name,
        coalesce(pt.name, replace(r.to_player, 'bot:', '')) as to_name
        from public.rivalry r left join public.players pb on pb.id = r.by_player left join public.players pt on pt.id = r.to_player
        where r.by_player = me or r.to_player = me order by r.times desc) r), '[]'),
    'db', jsonb_build_object('games', (select count(*) from public.games), 'messages', (select count(*) from public.chat_messages),
        'hits', (select count(*) from public.hits), 'last_game', (select max(ended_at) from public.games), 'at', now()),
    'stored', coalesce((select jsonb_object_agg(achievement, unlocked_at) from public.achievements where player_id = me), '{}')
  ) into out;
  return out;
end $$;

-- Save your XP and any trophies that just unlocked (keeps the first unlock time).
create or replace function public.store_progress(p_xp int, p_achievements text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare me text := public.my_id();
begin
  if me is null then raise exception 'not logged in'; end if;
  update public.players set xp = greatest(0, least(p_xp, 1000000)) where id = me;
  insert into public.achievements (player_id, achievement)
  select me, a from unnest(p_achievements[1:40]) a where a ~ '^[a-z_]{1,40}$' on conflict do nothing;
end $$;

-- Change your display name, avatar or theme (nulls leave a field as it is).
create or replace function public.update_me(p_name text default null, p_avatar text default null, p_theme text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me text := public.my_id(); clean text := regexp_replace(trim(p_name), '\s+', ' ', 'g');
begin
  if me is null then raise exception 'not logged in'; end if;
  if p_name is not null then
    if length(clean) not between 2 and 20 or clean !~ '^[[:alnum:] ._''-]+$' then raise exception 'name: 2–20 letters, numbers or spaces'; end if;
    if exists (select 1 from public.players where lower(name) = lower(clean) and id <> me) then raise exception 'name taken'; end if;
    update public.players set name = clean where id = me;
  end if;
  if p_avatar is not null and length(p_avatar) <= 24 then update public.players set avatar = p_avatar where id = me; end if;
  if p_theme is not null and p_theme ~ '^[a-z]{1,16}$' then update public.players set theme = p_theme where id = me; end if;
  return (select jsonb_build_object('id', id, 'name', name, 'avatar', avatar, 'theme', theme) from public.players where id = me);
end $$;

-- Who is behind a login token (game hosts use this to check a joining friend). Needs a logged-in caller.
create or replace function public.whois(p_uid uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', id, 'name', name) from public.players where uid = p_uid and auth.uid() is not null
$$;

-- Only logged-in friends may call these; the keep-alive ping is the one public function.
revoke execute on function public.link_new_user(), public.my_id(), public.save_chat(text, text, text, text, text),
  public.save_game(jsonb), public.my_profile(), public.store_progress(int, text[]), public.update_me(text, text, text),
  public.whois(uuid) from public, anon;
grant execute on function public.save_chat(text, text, text, text, text), public.save_game(jsonb),
  public.my_profile(), public.store_progress(int, text[]), public.update_me(text, text, text), public.whois(uuid) to authenticated;
grant execute on function public.ping() to anon, authenticated;
revoke execute on function public.link_new_user(), public.my_id() from authenticated;

-- Live updates on the home screen: new games and trophies arrive instantly.
alter publication supabase_realtime add table public.games, public.achievements, public.players;

/* ===================== 3. first login after the move from the old hard-coded accounts ===================== */
-- The old login check: sha256(sha256(lower(name) + ':' + password)).
alter table public.players add column legacy_hash text;
update public.players set legacy_hash = '1c760216a90d9924ba7ea7afe921cce796b25e5a6e4ba08a27dcb8d39ddab814' where id = 'panchara kunju';
update public.players set legacy_hash = 'be56b7ac72bc7a13c0c7134ac0275310dd0c56a004adc0975a72623c2cc35210' where id = 'ammu';
-- Nobody can read the hashes from the browser.
revoke select on public.players from anon, authenticated;
grant select (id, uid, name, avatar, theme, xp, created_at, last_seen) on public.players to authenticated;

-- If the name and password match the old login, create the real account with that same password
-- (no email is ever sent). Returns the login email, or null.
create or replace function public.claim_account(p_user text, p_pass text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  uname text := lower(trim(p_user));
  pl public.players%rowtype;
  new_id uuid := gen_random_uuid();
  email text;
begin
  select * into pl from public.players where id = uname;
  if not found or pl.legacy_hash is null or length(p_pass) not between 1 and 100 then return null; end if;
  email := replace(pl.id, ' ', '-') || '@sweetrevenge.local';
  if pl.uid is not null then return email; end if;
  if pl.legacy_hash <> encode(extensions.digest(encode(extensions.digest(uname || ':' || p_pass, 'sha256'), 'hex'), 'sha256'), 'hex') then
    return null;
  end if;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', new_id, 'authenticated', 'authenticated', email,
    extensions.crypt(p_pass, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', jsonb_build_object('username', uname), now(), now(), '', '', '', '');
  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (new_id::text, new_id, jsonb_build_object('sub', new_id::text, 'email', email, 'email_verified', true), 'email', now(), now(), now());
  return email;
end $$;
revoke execute on function public.claim_account(text, text) from public;
grant execute on function public.claim_account(text, text) to anon, authenticated;

/* ===================== 4. (13 Nov 2026) practice games don't count toward trophies ===================== */
-- my_profile() was replaced so 'maxBonked' and 'revenge' skip practice games: in both subqueries the hits
-- are joined to public.games and filtered with "and not g.practice". The rest of the function is as in
-- section 2. XP and the other trophies skip practice games in shared/progress.mjs.

/* ===================== 5. (13 Nov 2026) challenges ===================== */
-- Table public.challenges (from_player, to_player, kind, room, status open|accepted|declined|cancelled),
-- readable by either player; RPCs send_challenge(to, kind), challenge_room(id, room) and
-- answer_challenge(id, accept); added to the supabase_realtime publication. Applied as migration "challenges".
-- Its kind check allows ('ludo', 'plusfour', 'doodle', 'snakes', 'sundae', 'sticky'); 'sticky' added 13 Nov 2026 by migration "add_sticky_kind" (also in save_game and save_chat).

/* ===================== 6. (13 Nov 2026) Messages ===================== */
-- The private chat (messages.html): tables dm_messages, dm_reactions, dm_state; players.pic / pic_mode;
-- RPCs dm_send, dm_edit, dm_unsend, dm_react, dm_read, dm_set, dm_vanish_sweep, set_pic; storage buckets
-- dm-voice and pics; a private realtime channel 'dm'. The full SQL is in supabase/dm.sql.
