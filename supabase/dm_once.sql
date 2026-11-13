-- Photos in the chat (14 Nov 2026), APPLIED to the live database as two migrations
-- (dm_view_once_photos, then dm_photos_view_limits, which supersedes steps 3-5 of the first).
-- views 0 = unlimited (shown in the chat), 1 = view once, 2 = view twice. Each open of a limited photo is
-- counted; when the views are used up it is 'gone' and the opener's browser deletes the file.
-- Every photo is deleted 3 days after sending. Never part of the chat download (logic.mjs exportChat).
-- (dm_once_opened from the first migration is unused; it can be dropped by hand.)

-- 1. a private place for the photos (both friends can read and delete; you add only to your own folder)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('dm-once', 'dm-once', false, 8388608, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;
create policy "friends read view-once photos" on storage.objects for select to authenticated
  using (bucket_id = 'dm-once' and (select public.dm_member()));
create policy "friends add own view-once photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'dm-once' and (select public.dm_member()) and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "friends remove view-once photos" on storage.objects for delete to authenticated
  using (bucket_id = 'dm-once' and (select public.dm_member()));

-- 2. a new kind of message: 'photo'
alter table public.dm_messages drop constraint dm_messages_kind_check;
alter table public.dm_messages add constraint dm_messages_kind_check
  check (kind in ('text', 'like', 'sticker', 'gif', 'voice', 'photo', 'system'));

-- 3. sending accepts 'photo' (the file must be in your own folder of dm-once)
create or replace function public.dm_send(p_id uuid, p_kind text, p_body text, p_meta jsonb default '{}', p_reply_to uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me text := public.my_id(); clean text := coalesce(p_body, ''); row public.dm_messages%rowtype; v boolean;
begin
  if me is null or me not in ('ammu', 'panchara kunju') then raise exception 'not in this chat'; end if;
  if p_kind not in ('text', 'like', 'sticker', 'gif', 'voice', 'photo') then raise exception 'bad kind'; end if;
  if p_kind = 'text' and length(trim(clean)) = 0 then raise exception 'empty'; end if;
  if p_meta is null or jsonb_typeof(p_meta) <> 'object' then p_meta := '{}'; end if;
  if p_kind in ('voice', 'photo') and coalesce(p_meta ->> 'path', '') !~ ('^' || (select auth.uid())::text || '/') then raise exception 'bad file'; end if;
  if p_kind = 'photo' then p_meta := p_meta - 'opened_at' - 'expired'; end if;
  select vanish_on into v from public.dm_state where id = 1;
  insert into public.dm_messages (id, sender, kind, body, meta, reply_to, vanish)
  values (p_id, me, p_kind, left(clean, 4000), p_meta, p_reply_to, coalesce(v, false))
  on conflict (id) do nothing;
  select * into row from public.dm_messages where id = p_id;
  update public.players set last_seen = now() where id = me;
  return to_jsonb(row);
end $$;

-- 3b. (dm_photos_view_limits) dm_send stores views 0/1/2 and strips opens/gone/opened_at a sender might send.

-- 4. open a limited photo: counts the view; returns { path, last } or null when no views are left
create or replace function public.dm_photo_open(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me text := public.my_id(); m public.dm_messages%rowtype; views int; opens int;
begin
  if me is null or me not in ('ammu', 'panchara kunju') then raise exception 'not in this chat'; end if;
  select * into m from public.dm_messages where id = p_id and kind = 'photo' and sender <> me for update;
  if not found or coalesce((m.meta ->> 'gone')::boolean, false) or m.created_at < now() - interval '3 days' then return null; end if;
  views := coalesce((m.meta ->> 'views')::int, 0); opens := coalesce((m.meta ->> 'opens')::int, 0);
  if views = 0 then return jsonb_build_object('path', m.meta ->> 'path', 'last', false); end if;
  if opens >= views then return null; end if;
  update public.dm_messages set seen_at = coalesce(seen_at, now()),
    meta = meta || jsonb_build_object('opens', opens + 1, 'opened_at', now()) || case when opens + 1 >= views then '{"gone": true}'::jsonb else '{}'::jsonb end
   where id = p_id;
  return jsonb_build_object('path', m.meta ->> 'path', 'last', opens + 1 >= views);
end $$;

-- 5. every photo goes 3 days after sending: marked gone; the files are handed back for the caller to delete
create or replace function public.dm_once_expire() returns text[]
language plpgsql security definer set search_path = '' as $$
declare me text := public.my_id(); paths text[];
begin
  if me is null or me not in ('ammu', 'panchara kunju') then raise exception 'not in this chat'; end if;
  with gone as (
    update public.dm_messages set meta = meta || '{"gone": true}'::jsonb
     where kind = 'photo' and created_at < now() - interval '3 days' and not coalesce((meta ->> 'gone')::boolean, false)
    returning meta ->> 'path' as path)
  select coalesce(array_agg(path) filter (where path is not null), '{}') into paths from gone;
  return paths;
end $$;

grant execute on function public.dm_photo_open(uuid), public.dm_once_expire() to authenticated;
