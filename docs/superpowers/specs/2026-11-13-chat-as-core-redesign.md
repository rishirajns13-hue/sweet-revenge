# Redesign: Chat becomes a core part of Sweet Revenge (13 Nov 2026)

Status: **design only, not built yet.** Written at the end of a session with little budget left. It is meant to be picked up by the next session or agent. The Messages app itself is already live and works (`messages.html`, `messages/`, spec `2026-11-13-messages-design.md`). This redesign is about *where it lives and how it looks*, not the chat features.

## What the user said (their words, condensed)
- Opening the link should **not** drop you straight into the games home. The 💬 button as one small icon in the top bar is not good enough.
- Messaging is "one core part" of the app, as important as the games.
- It must not feel like "another page with a white background where I can text". It should feel built into the app, as on Instagram.
- **Better themes and backgrounds** for the chat, and it should be customizable.
- **Bottom navigation on phones.**
- The flow they want:
  - A **home page with two options: Games or Chat**.
  - From Games you can go to Chat.
  - From Chat you can go to Games.

## The new structure

```
login ──► HOME (choice)
            ├── Games  (today's hub: Play / Trophies / Rivals / You)
            └── Chat   (today's messages.html, restyled)
     Games ◄──────────► Chat   (one tap, from the nav, either way)
```

### 1. Home (new; first screen after login)
- Two big, alive cards side by side on a laptop and stacked on a phone.
  - **Games card**: the critters and game art, plus a short line such as "Your turn in Ludo" or "3 games this week".
  - **Chat card**: the other person's face with the green "Active now" dot, the last message as a preview ("Ammu: hiii 🥰"), the unread count as a big badge, and a "typing…" state.
- Greeting at the top ("Hey, Ammu!").
- Background: the current app theme (`shared/themes.css`), not white.
- **Your call:** remember the last section chosen and offer "Open where I left off". Default: always show Home. Opening the link always lands here.
- Implementation: a new screen `#home` in `index.html` (hash `#home`, now the default instead of `#play`). `hub/hub.js` `tabFromHash` currently defaults to `'play'`; change it to `'home'`. Keep `#play` deep links working.

### 2. One app shell with the same navigation everywhere
- **Phone (≤ 760px): a bottom nav bar** on every main screen, both the games hub and Chat. Items: **Home · Games · Chat · You**.
  - Chat shows an unread badge.
  - The hub's existing bottom tab bar (`.tabs` in `index.html`, Play/Trophies/Rivals/You) becomes this one. Move Trophies and Rivals inside Games as sub-tabs or a segmented control at the top of Games.
- **Laptop: a slim left rail** with the same four items: icons and labels, the unread badge on Chat, and the other person's face on Chat.
- Inside an open chat on a phone, the bottom nav hides while the keyboard is up (as Instagram does) and comes back when the composer isn't focused.
- **Remove** the small 💬 icon from the hub top bar (`#btn-dm` in `index.html`); the nav replaces it. Keep the live unread logic in `hub/hub.js` `startMessages()` and point it at the nav badge.
- Moving between Games and Chat uses the cross-document **view transition** the games already use, so it feels like one app, not a page load. `messages.html` stays a separate file for speed and code isolation, but has the same shell and nav. Add `messages.html` to the speculation-rules prefetch so it opens instantly (it's already in the `.dm-link` selector).

### 3. Chat looks like part of the app, and customizable
Today's chat themes only colour the bubbles on a mostly plain background. Changes:
- **Wallpapers.** Each chat theme gets a full background, not just a tint. Ideas that fit the dessert / critter world:
  - **Sprinkles:** scattered CSS confetti on pastel.
  - **Hearts:** soft floating hearts.
  - **Starry night:** dark, with twinkling dots.
  - **Critter pattern:** a repeating tiny-critter SVG pattern.
  - **Gradient mesh:** slow-moving blobs.
  - **Notebook paper:** lines and doodles, to match Doodle Duel.
  - **Photo:** your own picture, blurred and dimmed for readability, stored in the `pics` bucket as `wall.webp`.
- The **wallpaper is synced for both people**, like the theme. Add `wallpaper text` to `dm_state` and extend `dm_set(p_wallpaper)`, keeping the system line ("Ammu changed the wallpaper"). The user will need to paste the SQL, or Claude runs it through the Supabase Management API with a token the user provides (the MCP blocks SQL containing `delete`/`drop`/`revoke`).
- Theme picker in Details shows **live preview tiles**: a mini chat with two bubbles on each wallpaper.
- The header, composer and Details panel become frosted glass over the wallpaper (backdrop-filter, with a solid fallback) instead of white bars.
- **Bubble style options:** round (current) or "bouncy" (bigger radius, softer shadow), and text size (S/M/L), kept per device in localStorage.
- **Your call:** an app-wide toggle so the chat theme can also colour the Home and Games screens. Default off.
- Keep all motion respecting `prefers-reduced-motion` and `body.calm`. Animated wallpapers pause when the tab is hidden.

### 4. Chat screen layout (phone)
```
┌────────────────────────────┐
│ ←  (face●) Ammu   Active now ⓘ│  frosted, over wallpaper
│                            │
│   wallpaper + bubbles      │
│                            │
│ [😊 Message…   🎤 🖼️ ]  ➤ │  frosted composer
├────────────────────────────┤
│ 🏠 Home  🎮 Games  💬 Chat• 👤 You │  bottom nav (hidden while typing)
└────────────────────────────┘
```
On a laptop: left rail | chat (max-width ~760px, centred) | Details as a right column on wide screens (≥1200px) instead of a slide-over.

## Build order (each step committed on its own, tested at 390px and 1280px)
1. App shell: the shared nav component (`shared/nav.js` + CSS) with bottom bar and left rail, used by both `index.html` and `messages.html`, with the unread badge.
2. The Home screen with the Games and Chat cards (live preview and unread via the existing `sr-dm-badge` channel logic).
3. Games section: move Trophies and Rivals under Games and remove `#btn-dm`.
4. Chat wallpapers (CSS-only first), frosted header and composer, theme picker previews.
5. DB: `dm_state.wallpaper` and `dm_set(p_wallpaper)`, plus the photo wallpaper.
6. Bubble style and text size options.
7. Re-run the existing tests:
   - `node --test tests/*.test.js`
   - Messages browser test: scratchpad `dm-test.mjs` with `mock-sb.js`, also with `MOBILE=1 W=390 H=844`
   - phone overflow check (`phone.mjs` / `phone-rest.mjs` pattern)

## Constraints (unchanged)
- Static site, no build step, no installs. CDN libraries must be pinned.
- Real recorded sounds only.
- One folder (`D:\Projects\Ludo`), never worktrees. Commit only your own paths.
- Push only when the user says so.
