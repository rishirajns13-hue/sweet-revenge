-- Messages, part 2 (13 Nov 2026): only Ammu and Panchara Kunju can use the chat.
-- Paste into the SQL editor and run once. Already folded into supabase/dm.sql.

-- Only the two friends are in this chat (other accounts, like the old test account, can't read or write it).
create or replace function public.dm_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.players where uid = auth.uid() and id in ('ammu', 'panchara kunju'))
$$;
revoke execute on function public.dm_member() from public, anon;
grant execute on function public.dm_member() to authenticated;

drop policy if exists "friends read dms" on public.dm_messages;
drop policy if exists "friends read dm reactions" on public.dm_reactions;
drop policy if exists "friends read dm state" on public.dm_state;
drop policy if exists "friends read dm files" on storage.objects;
drop policy if exists "friends add own dm files" on storage.objects;
drop policy if exists "friends remove own dm files" on storage.objects;
drop policy if exists "friends use dm channel" on realtime.messages;
drop policy if exists "friends send on dm channel" on realtime.messages;

create policy "friends read dms" on public.dm_messages for select to authenticated
  using ((select public.dm_member()));
create policy "friends read dm reactions" on public.dm_reactions for select to authenticated
  using ((select public.dm_member()));
create policy "friends read dm state" on public.dm_state for select to authenticated
  using ((select public.dm_member()));
create policy "friends read dm files" on storage.objects for select to authenticated
  using (bucket_id in ('dm-voice', 'pics') and (select public.dm_member()));
create policy "friends add own dm files" on storage.objects for insert to authenticated
  with check (bucket_id in ('dm-voice', 'pics') and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.dm_member()));
create policy "friends remove own dm files" on storage.objects for delete to authenticated
  using (bucket_id in ('dm-voice', 'pics') and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "friends use dm channel" on realtime.messages for select to authenticated
  using (realtime.topic() = 'dm' and (select public.dm_member()));
create policy "friends send on dm channel" on realtime.messages for insert to authenticated
  with check (realtime.topic() = 'dm' and (select public.dm_member()));

-- Send a message. The browser makes the id, so a retried send is ignored. Returns the stored row.
create or replace function public.dm_send(p_id uuid, p_kind text, p_body text, p_meta jsonb default '{}', p_reply_to uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me text := public.my_id(); clean text := coalesce(p_body, ''); row public.dm_messages%rowtype; v boolean;
begin
  if me is null or me not in ('ammu', 'panchara kunju') then raise exception 'not in this chat'; end if;
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
  if me is null or me not in ('ammu', 'panchara kunju') then raise exception 'not in this chat'; end if;
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
  if me is null or me not in ('ammu', 'panchara kunju') then raise exception 'not in this chat'; end if;
  delete from public.dm_messages where id = p_id and sender = me returning meta ->> 'path' into path;
  return path;
end $$;

-- React to a message (one reaction each; null removes yours).
create or replace function public.dm_react(p_id uuid, p_emoji text) returns void
language plpgsql security definer set search_path = '' as $$
declare me text := public.my_id();
begin
  if me is null or me not in ('ammu', 'panchara kunju') then raise exception 'not in this chat'; end if;
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
  if me is null or me not in ('ammu', 'panchara kunju') then raise exception 'not in this chat'; end if;
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
  if me is null or me not in ('ammu', 'panchara kunju') then raise exception 'not in this chat'; end if;
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
  if me is null or me not in ('ammu', 'panchara kunju') then raise exception 'not in this chat'; end if;
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
  if me is null or me not in ('ammu', 'panchara kunju') then raise exception 'not in this chat'; end if;
  if p_mode not in ('photo', 'critter') then raise exception 'bad mode'; end if;
  if p_path is not null and p_path !~ ('^' || (select auth.uid())::text || '/[A-Za-z0-9._-]{1,80}$') then raise exception 'bad path'; end if;
  update public.players set pic = coalesce(p_path, pic), pic_mode = p_mode where id = me;
end $$;
