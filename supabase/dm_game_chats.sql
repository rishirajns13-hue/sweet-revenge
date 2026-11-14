-- Game-room chats also land in Messages (14 Nov 2026). APPLIED as migration dm_game_chats.
-- Every chat line or sticker the two friends send in a game room is copied into dm_messages, tagged with
-- its game (meta.game, shown as "in Ludo" under the bubble) and already seen (both were in the room).
-- Same id scheme as the 14 Nov backfill (md5('game-chat:' || id)), so nothing is ever copied twice.
create or replace function public.dm_from_game_chat() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.sender in ('ammu', 'panchara kunju') and length(trim(coalesce(new.body, ''))) > 0 then
    insert into public.dm_messages (id, sender, kind, body, meta, created_at, seen_at, vanish)
    values (md5('game-chat:' || new.id)::uuid, new.sender, 'text', left(new.body, 4000),
            jsonb_build_object('game', new.game) || case when new.kind = 'sticker' then '{"game_sticker": true}'::jsonb else '{}'::jsonb end,
            new.sent_at, new.sent_at, false)
    on conflict (id) do nothing;
  end if;
  return null;
end $$;
revoke execute on function public.dm_from_game_chat() from public, anon, authenticated;
create trigger chat_to_dm after insert on public.chat_messages for each row execute function public.dm_from_game_chat();
