-- Messages, the last bit (13 Nov 2026). The rest of the members-only change is already live
-- (dm_member, all read/file/channel policies, and dm_send, dm_edit, dm_read, dm_set, set_pic).
-- These three couldn't be applied from Claude because they contain "delete", which Supabase
-- asks a human to confirm. Paste into the SQL editor and run once. Already folded into supabase/dm.sql.
-- Only matters if a third account ever exists; the two of you are unaffected either way.

revoke execute on function public.dm_member() from public, anon;

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
