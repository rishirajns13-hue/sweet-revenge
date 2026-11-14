-- Drawing on the chat, like Instagram's DM "Draw" (15 Nov 2026). APPLIED as migration dm_doodle.
-- A doodle is a transparent webp in dm-once (the sender's own folder), pinned over the chat:
-- meta = { path, anchor (message id under the drawing's top), dy, xf, tw, w, h }.

alter table public.dm_messages drop constraint dm_messages_kind_check;
alter table public.dm_messages add constraint dm_messages_kind_check
  check (kind in ('text', 'like', 'sticker', 'gif', 'voice', 'photo', 'video', 'share', 'system', 'doodle'));

create or replace function public.dm_send(p_id uuid, p_kind text, p_body text, p_meta jsonb default '{}'::jsonb, p_reply_to uuid default null::uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare me text := public.my_id(); clean text := coalesce(p_body, ''); row public.dm_messages%rowtype; v boolean;
begin
  if me is null or me not in ('ammu', 'panchara kunju') then raise exception 'not in this chat'; end if;
  if p_kind not in ('text', 'like', 'sticker', 'gif', 'voice', 'photo', 'doodle') then raise exception 'bad kind'; end if;
  if p_kind = 'text' and length(trim(clean)) = 0 then raise exception 'empty'; end if;
  if p_meta is null or jsonb_typeof(p_meta) <> 'object' then p_meta := '{}'; end if;
  if p_kind in ('voice', 'photo', 'doodle') and coalesce(p_meta ->> 'path', '') !~ ('^' || (select auth.uid())::text || '/') then raise exception 'bad file'; end if;
  if p_kind = 'photo' then
    p_meta := (p_meta - 'opens' - 'gone' - 'opened_at' - 'expired')
      || jsonb_build_object('views', case when (p_meta ->> 'views') in ('1', '2') then (p_meta ->> 'views')::int else 0 end);
  end if;
  if p_kind = 'doodle' then p_meta := p_meta - 'views' - 'gone' - 'bucket' - 'ig'; end if;
  select vanish_on into v from public.dm_state where id = 1;
  insert into public.dm_messages (id, sender, kind, body, meta, reply_to, vanish)
  values (p_id, me, p_kind, left(clean, 4000), p_meta, p_reply_to, coalesce(v, false))
  on conflict (id) do nothing;
  select * into row from public.dm_messages where id = p_id;
  update public.players set last_seen = now() where id = me;
  return to_jsonb(row);
end $function$;
