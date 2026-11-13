-- Messages (messages.html): the private chat between the two friends. Applied 13 Nov 2026 (pasted into the SQL editor).
-- What it adds:
--   tables  dm_messages, dm_reactions, dm_state (theme, nicknames, vanish mode, read times)
--   players.pic / players.pic_mode (profile photo or critter)
--   functions dm_send, dm_edit, dm_unsend, dm_react, dm_read, dm_set, dm_vanish_sweep, set_pic
--   storage buckets dm-voice (voice notes) and pics (profile photos), private to the friends
--   a private realtime channel "dm" for typing dots and "active now"
-- Nothing existing is changed or deleted (only two new columns on players).

create table public.dm_messages (
  id          uuid primary key,
  sender      text not null references public.players(id),
  kind        text not null check (kind in ('text', 'like', 'sticker', 'gif', 'voice', 'system')),
  body        text not null default '' check (length(body) <= 4000),
  meta        jsonb not null default '{}' check (pg_column_size(meta) < 4000),
  reply_to    uuid,
  created_at  timestamptz not null default now(),
  edited_at   timestamptz,
  vanish      boolean not null default false,
  seen_at     timestamptz
);
create index dm_messages_time_idx on public.dm_messages (created_at desc);
create index dm_messages_unseen_idx on public.dm_messages (sender) where seen_at is null;

create table public.dm_reactions (
  message_id  uuid not null references public.dm_messages(id) on delete cascade,
  player      text not null references public.players(id),
  emoji       text not null check (length(emoji) between 1 and 16),
  at          timestamptz not null default now(),
  primary key (message_id, player)
);

create table public.dm_state (
  id          int primary key default 1 check (id = 1),
  theme       text not null default 'candy',
  nicknames   jsonb not null default '{}',
  vanish_on   boolean not null default false,
  vanish_by   text,
  last_read   jsonb not null default '{}',
  updated_at  timestamptz not null default now()
);
insert into public.dm_state (id) values (1);

alter table public.players add column pic text, add column pic_mode text not null default 'critter' check (pic_mode in ('photo', 'critter'));
grant select (pic, pic_mode) on public.players to authenticated;

alter table public.dm_messages enable row level security;
alter table public.dm_reactions enable row level security;
alter table public.dm_state enable row level security;
create policy "friends read dms" on public.dm_messages for select to authenticated
  using (exists (select 1 from public.players p where p.uid = (select auth.uid())));
create policy "friends read dm reactions" on public.dm_reactions for select to authenticated
  using (exists (select 1 from public.players p where p.uid = (select auth.uid())));
create policy "friends read dm state" on public.dm_state for select to authenticated
  using (exists (select 1 from public.players p where p.uid = (select auth.uid())));

-- Send a message. The browser makes the id, so a retried send is ignored. Returns the stored row.
create or replace function public.dm_send(p_id uuid, p_kind text, p_body text, p_meta jsonb default '{}', p_reply_to uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me text := public.my_id(); clean text := coalesce(p_body, ''); row public.dm_messages%rowtype; v boolean;
begin
  if me is null then raise exception 'not logged in'; end if;
  if p_kind not in ('text', 'like', 'sticker', 'gif', 'voice') then raise exception 'bad kind'; end if;
  if p_kind = 'text' and length(trim(clean)) = 0 then raise exception 'empty'; end if;
  if p_meta is null or jsonb_typeof(p_meta) <> 'object' then p_meta := '{}'; end if;
  if p_kind = 'voice' and coalesce(p_meta ->> 'path', '') !~ ('^' || (select auth.uid())::text || '/') then raise exception 'bad voice'; end if;
  select vanish_on into v from public.dm_state where id = 1;
  insert into public.dm_messages (id, sender, kind, body, meta, reply_to, vanish)
  values (p_id, me, p_kind, left(clean, 4000), p_meta, p_reply_to, coalesce(v, false))
  on conflict (id) do nothing;
  select * into row from public.dm_messages where id = p_id;
  update public.players set last_seen = now() where id = me;
  return to_jsonb(row);
end $$;

-- Edit your own text message within 15 minutes of sending it.
create or replace function public.dm_edit(p_id uuid, p_body text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me text := public.my_id(); row public.dm_messages%rowtype;
begin
  if me is null then raise exception 'not logged in'; end if;
  if length(trim(coalesce(p_body, ''))) = 0 then raise exception 'empty'; end if;
  update public.dm_messages set body = left(p_body, 4000), edited_at = now()
   where id = p_id and sender = me and kind = 'text' and created_at > now() - interval '15 minutes'
   returning * into row;
  if not found then raise exception 'too late to edit'; end if;
  return to_jsonb(row);
end $$;

-- Unsend your own message (gone for both). Returns its voice file path, if any, so the browser can delete the file.
create or replace function public.dm_unsend(p_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare me text := public.my_id(); path text;
begin
  if me is null then raise exception 'not logged in'; end if;
  delete from public.dm_messages where id = p_id and sender = me returning meta ->> 'path' into path;
  return path;
end $$;

-- React to a message (one reaction each; null removes yours).
create or replace function public.dm_react(p_id uuid, p_emoji text) returns void
language plpgsql security definer set search_path = '' as $$
declare me text := public.my_id();
begin
  if me is null then raise exception 'not logged in'; end if;
  if p_emoji is null or p_emoji = '' then
    delete from public.dm_reactions where message_id = p_id and player = me;
  else
    insert into public.dm_reactions (message_id, player, emoji) values (p_id, me, left(p_emoji, 16))
    on conflict (message_id, player) do update set emoji = excluded.emoji, at = now();
  end if;
end $$;

-- Mark everything the other person sent as seen. Returns how many were newly seen.
create or replace function public.dm_read() returns int
language plpgsql security definer set search_path = '' as $$
declare me text := public.my_id(); n int;
begin
  if me is null then raise exception 'not logged in'; end if;
  update public.dm_messages set seen_at = now() where sender <> me and seen_at is null;
  get diagnostics n = row_count;
  update public.players set last_seen = now() where id = me;
  if n > 0 then
    update public.dm_state set last_read = last_read || jsonb_build_object(me, now()), updated_at = now() where id = 1;
  end if;
  return n;
end $$;

-- Change the chat theme, a nickname, or vanish mode. Each change leaves a small system line in the chat.
create or replace function public.dm_set(p_theme text default null, p_nick_for text default null, p_nick text default null, p_vanish boolean default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me text := public.my_id(); st public.dm_state%rowtype; clean text;
begin
  if me is null then raise exception 'not logged in'; end if;
  if p_theme is not null and p_theme ~ '^[a-z]{1,16}$' then
    update public.dm_state set theme = p_theme, updated_at = now() where id = 1;
    insert into public.dm_messages (id, sender, kind, meta) values (gen_random_uuid(), me, 'system', jsonb_build_object('event', 'theme', 'value', p_theme));
  end if;
  if p_nick_for is not null and exists (select 1 from public.players where id = p_nick_for) then
    clean := nullif(left(regexp_replace(trim(coalesce(p_nick, '')), '\s+', ' ', 'g'), 30), '');
    update public.dm_state set nicknames = case when clean is null then nicknames - p_nick_for else nicknames || jsonb_build_object(p_nick_for, clean) end,
      updated_at = now() where id = 1;
    insert into public.dm_messages (id, sender, kind, meta) values (gen_random_uuid(), me, 'system', jsonb_build_object('event', 'nick', 'for', p_nick_for, 'value', clean));
  end if;
  if p_vanish is not null then
    select * into st from public.dm_state where id = 1;
    if st.vanish_on is distinct from p_vanish then
      update public.dm_state set vanish_on = p_vanish, vanish_by = me, updated_at = now() where id = 1;
      insert into public.dm_messages (id, sender, kind, meta, vanish) values (gen_random_uuid(), me, 'system', jsonb_build_object('event', 'vanish', 'value', p_vanish), false);
    end if;
  end if;
  select * into st from public.dm_state where id = 1;
  return to_jsonb(st);
end $$;

-- Vanish messages you have seen disappear when you leave the chat (p_mine_only), and any seen more
-- than an hour ago always go. Returns the voice file paths of what was deleted.
create or replace function public.dm_vanish_sweep(p_mine_only boolean default true) returns text[]
language plpgsql security definer set search_path = '' as $$
declare me text := public.my_id(); paths text[];
begin
  if me is null then raise exception 'not logged in'; end if;
  with gone as (
    delete from public.dm_messages where vanish and seen_at is not null
      and ((p_mine_only and sender <> me) or not p_mine_only or seen_at < now() - interval '1 hour')
    returning meta ->> 'path' as path)
  select coalesce(array_agg(path) filter (where path is not null), '{}') into paths from gone;
  return paths;
end $$;

-- Your profile picture: a photo stored in the pics bucket, or your critter.
create or replace function public.set_pic(p_path text, p_mode text) returns void
language plpgsql security definer set search_path = '' as $$
declare me text := public.my_id();
begin
  if me is null then raise exception 'not logged in'; end if;
  if p_mode not in ('photo', 'critter') then raise exception 'bad mode'; end if;
  if p_path is not null and p_path !~ ('^' || (select auth.uid())::text || '/[A-Za-z0-9._-]{1,80}$') then raise exception 'bad path'; end if;
  update public.players set pic = coalesce(p_path, pic), pic_mode = p_mode where id = me;
end $$;

revoke execute on function public.dm_send(uuid, text, text, jsonb, uuid), public.dm_edit(uuid, text), public.dm_unsend(uuid),
  public.dm_react(uuid, text), public.dm_read(), public.dm_set(text, text, text, boolean), public.dm_vanish_sweep(boolean),
  public.set_pic(text, text) from public, anon;
grant execute on function public.dm_send(uuid, text, text, jsonb, uuid), public.dm_edit(uuid, text), public.dm_unsend(uuid),
  public.dm_react(uuid, text), public.dm_read(), public.dm_set(text, text, text, boolean), public.dm_vanish_sweep(boolean),
  public.set_pic(text, text) to authenticated;

alter publication supabase_realtime add table public.dm_messages, public.dm_reactions, public.dm_state;

-- Storage: voice notes and profile photos, private to the friends. Each person writes under their own login uid.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('dm-voice', 'dm-voice', false, 6291456, array['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/wav']),
  ('pics', 'pics', false, 1048576, array['image/webp', 'image/jpeg', 'image/png']);
create policy "friends read dm files" on storage.objects for select to authenticated
  using (bucket_id in ('dm-voice', 'pics') and exists (select 1 from public.players p where p.uid = (select auth.uid())));
create policy "friends add own dm files" on storage.objects for insert to authenticated
  with check (bucket_id in ('dm-voice', 'pics') and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (select 1 from public.players p where p.uid = (select auth.uid())));
create policy "friends remove own dm files" on storage.objects for delete to authenticated
  using (bucket_id in ('dm-voice', 'pics') and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Live typing and "active now" go over a private realtime channel only the friends can join.
create policy "friends use dm channel" on realtime.messages for select to authenticated
  using (realtime.topic() = 'dm' and exists (select 1 from public.players p where p.uid = (select auth.uid())));
create policy "friends send on dm channel" on realtime.messages for insert to authenticated
  with check (realtime.topic() = 'dm' and exists (select 1 from public.players p where p.uid = (select auth.uid())));
