# Messages: a private DM app inside Sweet Revenge

## Context
Rishi and Ammu are leaving Instagram for 6 months. Study files will go over WhatsApp. For everyday chatting they want a messaging app of their own inside Sweet Revenge, kept separate from the games the way Instagram keeps DMs apart from Reels. They expect to use it almost daily, so it has to be fast, smooth and without friction, with real animation and polish. Every message must be kept in the database so the history survives. (Moving it into Instagram later isn't possible because Instagram can't import chats, so a full download/export replaces that.)

**What they said they want:** text, voice notes, stickers, GIFs (GIPHY, they'll provide a key), reactions + replies, seen + typing + active status, chat themes + nicknames, profile pics (each person picks a photo or their critter), edit/unsend, and Instagram-style vanish mode: drag the chat up from the bottom to turn it on.

**Not in scope:**
- Voice or video calls.
- Push notifications. They'll just open the app once or twice a day, so an unread badge is enough.
- Group chats or other friends. It's only the two of them.
- Sending photos or files. That happens on WhatsApp.

**Constraints:**
- Static site on GitHub Pages: no build step and no installs. Libraries come from a CDN with pinned versions and `?v=` cache busting.
- Supabase project `tzksdygcuykycrmwwxrv`. Writes go through security-definer RPCs, as `save_chat` does.
- Sounds must be real recorded samples, few and quiet (Kenney CC0 files are already in `shared/sounds/`).
- Respect `body.calm` and `prefers-reduced-motion`.
- Must work well on a laptop (her main device) and on phones.

**Separate TODO (not this session):** the walkie-talkie is broken because the other person hears nothing. Add it to the memory TODO list (`todo-next.md`) at the start of implementation.

## Design

### Where it lives
- A new page `messages.html` with code in `messages/`: `app.js` (UI), `logic.mjs` (pure, testable), `store.js` (cache + data + realtime), `voice.js`, `picker.js` (GIF/sticker/emoji), `messages.css`.
- **Entry:** a 💬 button in the hub topbar (`index.html:102`, inside `.me-chip`) with a live unread count, like Instagram's DM icon. Prefetched with speculation rules, opened with the same view-transition cross-fade the games use. Add `messages.html` to the `next=` allowlist (`hub/hub.js:160`).
- The page calls `requireLogin()` (`shared/core.js:144`). Back arrow returns to `index.html`.
- There is only one conversation, so the page opens straight into it with no inbox list (my call).

### Database (one migration named `dm`, also added to `supabase/schema.sql` as section 6)
- `dm_messages`:
  - `id uuid` (made in the browser, so sends are optimistic and duplicates are dropped), `sender` → players.
  - `kind` in (`text`, `like`, `sticker`, `gif`, `voice`, `system`), `body text` (≤ 4000), `meta jsonb` (GIF id/url/size, sticker id, voice path/duration/waveform, system event).
  - `reply_to uuid`, `created_at`, `edited_at`, `vanish bool`, `seen_at`.
  - Index on `(created_at desc)`.
- `dm_reactions (message_id, player, emoji)`, primary key `(message_id, player)`: one reaction per person, like Instagram.
- `dm_state`: a single row holding `theme`, `nicknames jsonb`, `vanish_on`, `vanish_by`, plus `last_read jsonb {player: timestamptz}`.
- `players.pic text` (storage path of the photo) and `players.pic_mode` (`photo` | `critter`). Add them to the column grant at `schema.sql:275`.
- **RLS:** these tables can be read only when `public.my_id() is not null`. Only the two of them can have accounts, so that already means "just us". Nothing can be written directly.
- **RPCs:**
  - `dm_send(id, kind, body, meta, reply_to)`
  - `dm_edit(id, body)`: own message, within 15 minutes
  - `dm_unsend(id)`: own message, deletes the row and its voice file path is returned
  - `dm_react(id, emoji|null)`
  - `dm_read()`: marks the other person's messages seen and updates `last_read`
  - `dm_set(theme?, nick_for?, nick?, vanish?)`: also writes a `system` message such as "Ammu changed the theme"
  - `dm_vanish_sweep()`
  - `set_pic(path, mode)`
  - Grants follow the pattern at `schema.sql:257-263`.
- **Realtime:** add `dm_messages`, `dm_reactions` and `dm_state` to the `supabase_realtime` publication.
- **Storage:** private buckets `dm-voice` and `pics`, readable and writable only when `my_id()` is not null. Each file is uploaded under its sender's id.
- Have the daily keepalive workflow also call `dm_vanish_sweep()` as a backstop.

### Speed (the top priority)
- **Instant open:** keep the last ~400 messages (plus reactions and state) cached in IndexedDB and draw them before any network call. Then fetch only what's newer than the newest cached message. Load older messages in pages of 50 as she scrolls up.
- **Optimistic send:** the bubble appears at once in a "sending" state (faint) and settles when the RPC confirms. Failed sends wait in an outbox and retry, the same idea as the outbox in `shared/records.js:14-38`. A failed bubble shows "Tap to retry".
- **One Supabase channel `dm`** carries:
  - `postgres_changes` for messages, reactions and state
  - `broadcast` for typing, which is never stored
  - `presence` for "Active now"; the "Active 5m ago" fallback comes from `players.last_seen`
  - On reconnect or tab focus, refetch only what's newer.
- Voice notes upload in the background while the bubble already shows locally. GIFs use GIPHY's small `fixed_width` webp versions, with the size reserved in advance so the chat doesn't jump.

### Features
1. **Bubbles:**
   - Messages in a run are grouped, with Instagram-style corner shapes for first, middle and last.
   - My bubbles use the theme gradient pinned to the screen, so the colour shifts as you scroll.
   - A message of 1–3 emoji only is shown large. Links become clickable.
   - A time divider appears after a gap of more than an hour. Times show on hover (laptop) or a left swipe (phone).
2. **Like:** when the composer is empty, the send button becomes ❤️, which sends a big animated heart.
3. **Reactions:** double-tap or double-click = ❤️ with a heart burst. Long-press or right-click opens a springy bar with 6 emoji and a ➕ for the full picker. Reactions show as a pill under the bubble; tap it to see who reacted or to remove yours.
4. **Reply:** swipe right on a bubble (phone, with a small haptic buzz via `navigator.vibrate`) or use the hover ↩ button (laptop). A reply preview sits above the composer. The quoted part of a reply jumps to the original message and flashes it.
5. **Edit / Unsend / Copy** from the long-press menu. Edit only works within 15 minutes and marks the message "Edited". Unsend removes it for both of you.
6. **Seen / typing / active:**
   - "Seen" (or "Seen 3m ago") under my last message she has read.
   - A typing bubble with her avatar and three bouncing dots.
   - A green dot and "Active now" in the header.
   - Read receipts are sent when the chat is visible and the tab is focused.
7. **Voice notes:**
   - Hold the mic to record, slide left to cancel, slide up to lock hands-free. On a laptop, click to start and click to stop.
   - A live waveform shows while recording. Maximum 5 minutes.
   - Format detection reuses the logic in `shared/chat.js:242-245`, so Safari falls back to mp4/aac.
   - Playback bubble: waveform bars fill as it plays, 1×/1.5×/2× speed, and the next voice note plays automatically.
   - The waveform (~40 numbers) is worked out before upload and stored in `meta`.
8. **GIFs and stickers:**
   - A picker sheet with tabs: GIFs (GIPHY search + trending, typing debounced), Stickers (GIPHY stickers + our own critter sticker pack), and Recent.
   - The critter stickers are built from `shared/avatars.js` moods and animated with CSS, so they're original and on-theme.
   - The GIPHY key sits in the page source. A static site can't hide it, which is fine for a private app. Without a key, only the critter stickers and emoji show.
9. **Emoji:** the `emoji-picker-element` web component from jsDelivr (pinned version). It's used for the composer and the ➕ reaction.
10. **Chat themes:**
    - About 8 themes, each a gradient for bubbles, a background and an accent, plus light and dark variants.
    - Chosen from the details panel and synced to both of you, with a system line announcing the change.
    - Separate from the app-wide palette.
11. **Nicknames:** set one for yourself and for her. They show in the header and system lines.
12. **Profile pics:**
    - Each person picks Photo or Critter. A photo is uploaded, cropped square on a canvas, shrunk to 256px webp and saved to `pics`.
    - The setting lives in the chat details panel.
    - Shown in Messages and on the hub's 💬 button (my call: the games keep critters).
13. **Vanish mode:**
    - Drag the chat up past the bottom (touch overscroll, or mouse/trackpad drag on the scroller). A ring fills as you pull, and releasing turns it on with a dark ink-spread animation. There's also a toggle in details.
    - Shows the system line "Rishi turned on vanish mode".
    - Vanish messages use a dark style and are deleted (plus their voice files) once seen and the chat is closed: on `pagehide` or `visibilitychange`, plus `dm_vanish_sweep` on the next open.
    - They're never exported.
14. **Details panel (ⓘ):** theme, nicknames, profile pic mode, vanish toggle, search in chat (client-side over the cache plus a server `ilike` fallback), and "Download our chat".
15. **Export:** a ZIP made with JSZip from cdnjs (pinned version). It holds `chat.json` (every message, reaction and edit time), a readable `chat.html` and a `voice/` folder.
16. **Unread:**
    - The hub's 💬 count updates live, using the same realtime approach as `shared/records.js:143-167`.
    - The hub shows a small in-app banner "💬 Ammu: hey…" when a message arrives while she's there.
    - On the Messages page itself, the tab title shows "(2) Messages" when the tab isn't focused.
17. **Sounds:** a soft send sound and a receive sound from the existing Kenney samples (`ui-pop`, `ui-drop`) via `createSamplePlayer` (`shared/sound.js`), respecting the shared mute.
18. **Animations:**
    - Sent bubbles spring up from the composer; received ones pop in from the left.
    - Reaction bar spring, heart burst, typing dots, reply swipe with elastic snap-back, vanish ink transition, and a picker sheet that slides up.
    - Pure CSS keyframes and transitions, using the easing variables in `shared/base.css`, plus the Web Animations API for gestures.
19. **Fonts:** headers in Fredoka (the app's own). Bubble text in Nunito (Google Fonts) for comfortable reading every day (my call).

### Reuse
- Login and data helpers from `shared/core.js`: `sb`, `requireLogin`, `me`, `store`, `toast`, `escapeHtml`, `hydrateIcons`/`ICONS` (it already has `send`, `mic`, `smile`, `back`, `trash`, `download`, `play`, `pause`).
- `shared/avatars.js` → `avatarHTML(key, mood)` for critters and critter stickers.
- Voice recording ideas from `shared/chat.js:215-291`.
- Realtime subscription pattern from `shared/records.js:143-167`.
- `shared/sound.js` → `createSamplePlayer`.
- `shared/base.css` variables and `.sheet`/`.btn`/`.icon-btn` where they fit.

## Build order (each step committed on its own)
1. Save the design as `docs/superpowers/specs/2026-11-13-messages-design.md`. Add the walkie-talkie bug to memory `todo-next.md`.
2. Apply the `dm` migration through the Supabase MCP (needs `/mcp` sign-in if it has expired), create both storage buckets and their policies, and update `schema.sql` section 6. Check with `get_advisors`.
3. `messages/logic.mjs` with `node:test` tests in `tests/messages.test.js`:
   - grouping and corner shapes
   - time dividers
   - emoji-only detection
   - which message gets "Seen"
   - vanish eligibility
   - edit window
   - waveform downsampling
   - export format
4. Page shell + hub 💬 entry. Text messaging with cache, optimistic send, outbox, realtime, paging, grouping, animations and sounds.
5. Seen / typing / active, reactions, replies, edit / unsend / copy.
6. Voice notes.
7. Emoji picker, GIPHY GIFs and stickers, critter stickers. This is where the GIPHY key is needed.
8. Themes, nicknames, profile pics, details panel, search.
9. Vanish mode.
10. Hub unread badge and banner, export ZIP.

## Verification
- `node --test tests/*.test.js`: all tests pass, old and new.
- Serve the site locally (as described in the README) and open it in two browser windows: the normal profile logged in as one person, and one reused temporary profile in Temp, deleted afterwards (per the disk-growth rule), logged in as the other. Check:
  - instant send/receive
  - the typing dots
  - "Seen"
  - reactions both ways
  - a reply that jumps to the original
  - an edit, then an unsend that disappears on both sides
  - a recorded voice note that plays on the other side
  - a GIF and a sticker
  - a theme or nickname change that shows a system line on both
  - vanish on → message seen → close → gone for both, and the row is gone in the DB (`execute_sql`)
  - the hub 💬 count going up and clearing
  - export ZIP contents
- Reload with the network offline: cached history still shows and a send waits in the outbox, then delivers when back online.
- Phone-width check (DevTools device mode): swipe-to-reply, long-press, drag-up vanish, hold-to-record.
- Supabase `get_advisors` (security) after the migration: no new RLS warnings.
