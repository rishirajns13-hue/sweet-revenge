-- Photos are kept (14 Nov 2026). APPLIED as migration dm_photos_keep.
-- Unlimited photos stay for good (1 GB of storage is plenty). View-once/view-twice photos go once their
-- views are used: the opener's browser deletes the file when the viewer closes, and dm_once_expire (now a
-- cleanup, same name so older browsers keep working) hands back any used-up file that was missed.

-- 1. opening a limited photo no longer has a 3-day limit
create or replace function public.dm_photo_open(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me text := public.my_id(); m public.dm_messages%rowtype; views int; opens int;
begin
  if me is null or me not in ('ammu', 'panchara kunju') then raise exception 'not in this chat'; end if;
  select * into m from public.dm_messages where id = p_id and kind = 'photo' and sender <> me for update;
  if not found or coalesce((m.meta ->> 'gone')::boolean, false) then return null; end if;
  views := coalesce((m.meta ->> 'views')::int, 0); opens := coalesce((m.meta ->> 'opens')::int, 0);
  if views = 0 then return jsonb_build_object('path', m.meta ->> 'path', 'last', false); end if;
  if opens >= views then return null; end if;
  update public.dm_messages set seen_at = coalesce(seen_at, now()),
    meta = meta || jsonb_build_object('opens', opens + 1, 'opened_at', now()) || case when opens + 1 >= views then '{"gone": true}'::jsonb else '{}'::jsonb end
   where id = p_id;
  return jsonb_build_object('path', m.meta ->> 'path', 'last', opens + 1 >= views);
end $$;

-- 2. no more 3-day expiry: only photos whose views are used up (gone) hand their file back, once
create or replace function public.dm_once_expire() returns text[]
language plpgsql security definer set search_path = '' as $$
declare me text := public.my_id(); paths text[];
begin
  if me is null or me not in ('ammu', 'panchara kunju') then raise exception 'not in this chat'; end if;
  with done as (
    update public.dm_messages set meta = meta || '{"cleaned": true}'::jsonb
     where kind = 'photo' and coalesce((meta ->> 'gone')::boolean, false)
       and not coalesce((meta ->> 'cleaned')::boolean, false) and not coalesce((meta ->> 'ig')::boolean, false)
       and coalesce((meta ->> 'opened_at')::timestamptz, created_at) < now() - interval '10 minutes' -- not while it's still on screen
    returning meta ->> 'path' as path)
  select coalesce(array_agg(path) filter (where path is not null), '{}') into paths from done;
  return paths;
end $$;
