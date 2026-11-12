-- NOT APPLIED YET (declined in the 13 Nov 2026 session). Paste into the Supabase SQL editor to apply.
-- Locks a name for 10 minutes after 5 wrong first-login passwords, so nobody can brute-force a friend's
-- password before that friend has logged in once. The site already shows a "too many tries" message.
create table public.login_failures (
  username text not null,
  at timestamptz not null default now()
);
create index login_failures_idx on public.login_failures (username, at desc);
alter table public.login_failures enable row level security;  -- no policies: only claim_account touches it

create or replace function public.claim_account(p_user text, p_pass text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  uname text := lower(trim(p_user));
  pl public.players%rowtype;
  new_id uuid := gen_random_uuid();
  email text;
begin
  select * into pl from public.players where id = uname;
  if not found or pl.legacy_hash is null or length(p_pass) not between 1 and 100 then return null; end if;
  email := replace(pl.id, ' ', '-') || '@sweetrevenge.local';
  if pl.uid is not null then return email; end if;
  if (select count(*) from public.login_failures where username = uname and at > now() - interval '10 minutes') >= 5 then
    raise exception 'too many tries';
  end if;
  if pl.legacy_hash <> encode(extensions.digest(encode(extensions.digest(uname || ':' || p_pass, 'sha256'), 'hex'), 'sha256'), 'hex') then
    insert into public.login_failures (username) values (uname);
    delete from public.login_failures where at < now() - interval '1 day';
    return null;
  end if;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', new_id, 'authenticated', 'authenticated', email,
    extensions.crypt(p_pass, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', jsonb_build_object('username', uname), now(), now(), '', '', '', '');
  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (new_id::text, new_id, jsonb_build_object('sub', new_id::text, 'email', email, 'email_verified', true), 'email', now(), now(), now());
  return email;
end $$;
revoke execute on function public.claim_account(text, text) from public;
grant execute on function public.claim_account(text, text) to anon, authenticated;
