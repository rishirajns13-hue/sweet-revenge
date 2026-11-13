-- Let Sticky Situation save its climbs, chat and challenges (13 Nov 2026).
-- Adds 'sticky' to the game kinds everywhere 'sundae' is allowed. Additive: nothing existing changes.

alter table public.games drop constraint games_kind_check;
alter table public.games add constraint games_kind_check
  check (kind in ('ludo', 'plusfour', 'doodle', 'snakes', 'sundae', 'sticky'));

alter table public.challenges drop constraint challenges_kind_check;
alter table public.challenges add constraint challenges_kind_check
  check (kind in ('ludo', 'plusfour', 'doodle', 'snakes', 'sundae', 'sticky'));

-- save_game and save_chat each list the kinds once; swap in the longer list and keep the rest as it is.
do $$
declare f text; def text;
begin
  foreach f in array array['public.save_game(jsonb)', 'public.save_chat(text, text, text, text, text)'] loop
    begin
      def := pg_get_functiondef(f::regprocedure);
    exception when undefined_function then
      raise exception 'function % not found: check its argument list', f;
    end;
    if position('''sundae'')' in def) = 0 then raise exception 'kind list not found in %', f; end if;
    execute replace(def, '''sundae'')', '''sundae'', ''sticky'')');
  end loop;
end $$;
