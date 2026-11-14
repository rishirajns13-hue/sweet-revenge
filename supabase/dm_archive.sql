-- The old Instagram chat, imported into Messages (14 Nov 2026). APPLIED as migration dm_archive.
-- Imported rows carry meta.ig = true. Their photos, videos and voice notes live in the private
-- dm-archive bucket and are kept for good (no 3-day expiry). Only the import (secret key) writes there.

-- 1. two new kinds: 'video' (an mp4 from the archive) and 'share' (a reel/post/story link card)
alter table public.dm_messages drop constraint dm_messages_kind_check;
alter table public.dm_messages add constraint dm_messages_kind_check
  check (kind in ('text', 'like', 'sticker', 'gif', 'voice', 'photo', 'video', 'share', 'system'));

-- 2. the archive: both friends can read it; nobody can add or remove through the app
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('dm-archive', 'dm-archive', false, 20971520,
   array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'audio/ogg', 'audio/mp4'])
on conflict (id) do nothing;
create policy "friends read the archive" on storage.objects for select to authenticated
  using (bucket_id = 'dm-archive' and (select public.dm_member()));

-- 3. imported photos never expire
create or replace function public.dm_once_expire() returns text[]
language plpgsql security definer set search_path = '' as $$
declare me text := public.my_id(); paths text[];
begin
  if me is null or me not in ('ammu', 'panchara kunju') then raise exception 'not in this chat'; end if;
  with gone as (
    update public.dm_messages set meta = meta || '{"gone": true}'::jsonb
     where kind = 'photo' and created_at < now() - interval '3 days' and not coalesce((meta ->> 'gone')::boolean, false)
       and not coalesce((meta ->> 'ig')::boolean, false)
    returning meta ->> 'path' as path)
  select coalesce(array_agg(path) filter (where path is not null), '{}') into paths from gone;
  return paths;
end $$;
