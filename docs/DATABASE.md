# Database (Supabase)

_Moved from Neon to Supabase on 13 Nov 2026. Neon, its relay bridge and its every-minute trigger are gone._

## Where things are
- **Project:** `tzksdygcuykycrmwwxrv` (South Asia, Mumbai), at `https://tzksdygcuykycrmwwxrv.supabase.co`, on the free plan.
- **Schema, security rules and functions:** `supabase/schema.sql`
- **Browser side:**
  - `shared/core.js`: the Supabase client, login and the game-room login check
  - `shared/records.js`: saving games and chat, loading your profile, live updates
  - `shared/progress.mjs`: levels and trophies
- **Keep-alive:** `.github/workflows/keepalive.yml` pings the database once a day, so the free project never pauses for inactivity (Supabase pauses free projects after 7 quiet days). To check it, open the repo's **Actions** tab, then **Keep Supabase awake** → **Run workflow**.

## Keys
- **Publishable key** (`sb_publishable_…`): in `shared/core.js` and the keep-alive workflow. It's meant to be public; what it can do is limited by the security rules.
- **Secret key:** not used anywhere. Don't put it in the site or the repo.

## How it's kept safe
- **Reading:** only logged-in friends can read anything, and the old password hashes are hidden from everyone.
- **Writing:** only through functions that check who you are:
  - `save_game` only accepts games you played in, and keeps the first copy.
  - `save_chat`, `store_progress` and `update_me` act only on your own account.
- **Sign-ups:** only names already in `players` can have an account, and each name only once.

## What the browser reads directly
Besides the functions, logged-in friends read `players` (id, name, avatar, theme) directly: the home screen uses it for friends' critters in Rivals, and Ludo uses it with your game history for its head-to-head scores ("You 3 – 1 Ammu, all time"), so every device agrees and renames don't split a score.

## Speed
- The home screen shows the last profile this device saw immediately. Fresh data follows in one request (`my_profile`).
- Games and trophies arrive live over Realtime, with a refresh every 60 s as a safety net.
- Supabase's API doesn't sleep like Neon's function did, so there's no cold start.
- On Jio (13 Nov 2026) the project address resolved fine and answered in about 0.5 s.

## Not applied yet
A lockout for first-login password guessing (5 wrong tries in 10 minutes per name) was written on 13 Nov 2026 but the migration was declined in the session. The browser already shows a "too many tries" message for it. To apply it, paste `supabase/pending/claim_account_throttle.sql` into the Supabase SQL editor, or ask Claude to apply it again. It only matters until every friend has logged in once, because after that Supabase Auth checks passwords and rate-limits them itself.

## If Jio (or anyone) blocks Supabase again
India blocked `supabase.co` from Feb to Oct 2026. If it happens again:
- Games still work.
- Saves wait in the device outbox (7 days).
- The home screen shows the last data it saw.

The fix would be a proxy on a domain that isn't blocked, such as a Cloudflare Worker in front of the project URL. Players never have to change settings.

## Useful checks
- The keep-alive call by hand: `curl -X POST https://tzksdygcuykycrmwwxrv.supabase.co/rest/v1/rpc/ping -H "apikey: <publishable key>" -H "Content-Type: application/json" -d "{}"`
- Is this network blocking it? `nslookup tzksdygcuykycrmwwxrv.supabase.co` should give Cloudflare addresses (104.x / 172.x).
