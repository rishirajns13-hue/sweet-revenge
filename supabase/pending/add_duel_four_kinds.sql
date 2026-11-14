-- PENDING (not applied): lets the database accept the two new games, Island Duel ('duel') and Plonk! ('four').
-- Written 14 Nov 2026. It changes two CHECK constraints (games, challenges) (drop + re-add, so the Supabase MCP will refuse it
-- and it needs the user's OK / the Management API, like add_sticky_kind did) and widens save_chat/save_game.
-- After applying: move this file to supabase/applied/, update supabase/schema.sql, then in duel/game.js and
-- four/game.js set createChat({ game: 'duel' | 'four' }) and save finished games with records.game(...).
-- Before applying, check the live constraint names: select conname from pg_constraint where conname like '%kind%';
begin;
alter table public.games drop constraint if exists games_kind_check;
alter table public.games add constraint games_kind_check check (kind in ('ludo', 'plusfour', 'doodle', 'snakes', 'sundae', 'sticky', 'duel', 'four'));
alter table public.challenges drop constraint if exists challenges_kind_check;
alter table public.challenges add constraint challenges_kind_check check (kind in ('ludo', 'plusfour', 'doodle', 'snakes', 'sundae', 'sticky', 'duel', 'four'));

create or replace function public.save_chat(p_game text, p_room text, p_kind text, p_body text, p_cid text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare me text := public.my_id();
begin
  if me is null then raise exception 'not logged in'; end if;
  if p_game not in ('ludo', 'plusfour', 'doodle', 'snakes', 'sundae', 'sticky', 'duel', 'four') or p_kind not in ('chat', 'sticker') then return false; end if;
  insert into public.chat_messages (client_id, game, room, sender, kind, body)
  values (left(p_cid, 40), p_game, case when p_room ~ '^[A-Z0-9]{6}$' then p_room end, me, p_kind, left(trim(p_body), 300))
  on conflict (client_id) do nothing;
  update public.players set last_seen = now() where id = me;
  return true;
end $$;

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
  if kind not in ('ludo', 'plusfour', 'doodle', 'snakes', 'sundae', 'sticky', 'duel', 'four') or gid !~ '^[a-z0-9]{1,16}$'
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
commit;
