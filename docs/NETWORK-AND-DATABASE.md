# Network & database: open issues (to discuss next session)

_Written 12 Nov 2026, after the scoreboard went live. Nothing here is decided yet._

## The problem in one paragraph
Saving (chat, games, trophies) uses a Neon Postgres database behind a Neon Function at `*.aws.neon.tech`. **Jio blocks every `*.aws.neon.tech` address at the DNS level.** This is not a fault on our side, and it's the same kind of block Jio put on Supabase in India in 2025. The database, the function and Neon's routers are all unreachable from Jio, while `console.neon.tech`, `vercel.app`, `netlify.app` and `github.io` work fine. Players must not have to change settings, so the current workaround is a **relay bridge**:
- Blocked browsers send encrypted requests through the public MQTT relays the games already use (EMQX, HiveMQ).
- A Neon Function woken every minute by a schedule trigger (`api/bridge.ts`) answers them.

It works, as tested from Jio:
- about 15 s for the first answer when the bridge is asleep;
- about 1 s once it's awake.

It's a workaround, not a clean fix.

## Limitations compared with the version before the database (11 Nov)
**Players might notice**
1. Slower first load: the loading screen adds about 1.3 s on the first open in a session, and about 0.4 s when coming back from a game.
2. On blocked networks the scoreboard can take up to a minute to appear after a quiet spell. Games themselves aren't slowed.
3. Old history isn't in the database, only games played since 11 Nov. The home screen no longer shows the old per-device scores, and the Ludo page still uses its own per-device score, so the two can disagree.
4. Rivals show each friend's default avatar, because chosen avatars aren't stored in the database.
5. Being offline is only a small "Reconnecting" chip (by request), so it's easy to miss that saving isn't working.

**What can break**

6. More outside services to depend on: GitHub Pages, the MQTT relays, Neon (database, function, every-minute trigger), and on blocked networks also the relays' persistent sessions. A relay outage or dropped message can lose a save.
7. On blocked networks, closing the tab right after a game can lose that save. The direct route survives page close (keepalive); the relay route doesn't.
8. Free plan: Neon Functions give 10 active and 400 waiting Capacity-Hours and 1M invocations a month. The trigger alone makes about 43k calls a month, plus the bridge's awake time. Heavy use, or someone keeping the bridge busy, could pause saving until next month.

**Fairness and safety (fine for friends)**

9. XP is easy to farm: practice games against bots give half XP, and bonks against bots count.
10. A logged-in player could post a fake game result from the browser console. The server only checks the login and that they were in the game.
11. The repo is public. Anyone can see the API address and relay topic. They can't read or write data without a password, but junk requests can keep the bridge awake and use up free hours.

**Upkeep**

12. Accounts live in two places, `shared/core.js` and `api/index.ts`. Adding a friend means editing both and running `neon deploy --env .env.local`.
13. The bridge's private key (`RELAY_PRIVATE_KEY`) exists only in `.env.local` on the laptop. If it's lost: generate a new pair, put the public half in `shared/records.js`, and redeploy.
14. The home-screen sounds (Kenney clips) were chosen by name and length, not by listening.

## Options for fixing the network problem properly
Ranked by how cleanly they solve it. Things to check before choosing are marked **verify**.

| # | Option | What it needs | Fixes Jio? | Notes |
|---|---|---|---|---|
| A | **Proxy on a well-reached domain**: a Cloudflare Worker, or a Vercel or Netlify rewrite in front of the Neon Function. | A free account on one of those (signing in with GitHub works). | Yes: the proxy reaches Neon server-to-server. | Smallest change: one config file, swap `RECORDS_URL`, delete the bridge and trigger. **Verify** the chosen `*.workers.dev`/`*.vercel.app` address resolves on Jio and on mobile data. User declined a new account on 12 Nov; revisit. |
| B | **Own domain behind Cloudflare** (about ₹800–1000 a year), e.g. `api.sweetrevenge.xyz` proxied (orange cloud) to the Neon Function. | Buy a domain plus a free Cloudflare account. | Yes: browsers only see Cloudflare's address. | Also gives the site a proper address. A Neon custom domain on its own does **not** fix it (it CNAMEs to `*.aws.neon.tech`, which Jio blocks). |
| C | **Move to Firebase (Firestore)** | The Google account the user already has. Free Spark plan. | Very likely: `googleapis.com` is never blocked. **Verify**. | Realtime listeners would replace polling and the relay (a truly live home screen). Needs a rewrite of `api/` logic as security rules or client code, and a new login scheme (Firebase Auth custom tokens, or anonymous auth plus rules that check our proof). Biggest change, but removes Neon, the bridge and the MQTT dependency for saving. |
| D | **Other hosted databases**: Turso (`*.turso.io`), Appwrite Cloud, PocketBase on a small VPS. | A new account each. | Unknown: **verify** on Jio. | Avoid Supabase (blocked by Jio in 2025). |
| E | **Keep the relay bridge** (current), hardened | Nothing new. | Yes, with delays. | Hardening ideas: retry unsent saves from localStorage (fixes #7); cap the bridge's awake minutes per day and ignore junk (fixes #8 and #11); shorter wake interval only when there's recent activity. |

My current lean: **A** (one free account, no rewrite) if the user is okay with an account, otherwise **C** if we want truly live updates and to drop the relay entirely. Keep **E** as the fallback.

## Questions for the user next session
1. Is a free Cloudflare or Vercel account acceptable now, or is "no new accounts" firm?
2. Would they pay about ₹1000 a year for their own domain (fixes this and gives a nicer link)?
3. How much does "truly live" matter (instant updates when a friend finishes a game) compared with a 20-second refresh?
4. Should we import the old per-device scores into the database (#3)?
5. Should bots count for XP and achievements (#9)?

## Quick test commands (from the laptop)
- See whether this network blocks Neon: `nslookup br-empty-shadow-a1673mbz-api.compute.c-1.ap-southeast-1.aws.neon.tech`. No address means it's blocked.
- Bridge activity: `neon logs query --branch production --source function --since 15m`
- Trigger status: `neon triggers list`
