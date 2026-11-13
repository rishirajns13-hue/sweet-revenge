# Redesign: a dark "night dessert shop" Home, and an Instagram-style chat inbox (14 Nov 2026)

Status: **approved 14 Nov 2026.** Follows `2026-11-13-app-shell-redesign.md` (live at 7090b4f), which built the one-page app, the glass nav and the light "sugar glass" Home.

## Why (the user's words, condensed)
- The light theme "is not too good". Go **darker**.
- The themes are "too colourful" and "taking too much attention away from the real content".
- Home needs a **structural redesign** for laptop and phone, plus colour correction. They liked the new icons and thumbnails, but they're "very different from what we used to design".
- **Chat** should have the aesthetics of **Instagram DMs**. The rest of Sweet Revenge should keep "its own vibe": critters, sweets, revenge, playful.
- Chat must **not open straight into the conversation**. First an **inbox screen** like Instagram's DM list, showing how many messages there are. Tapping the row opens the conversation. (Picked from options.)
- Dark direction picked: **"Night dessert shop"**. Near-black plum, each of the 6 themes reduced to an accent colour and a soft glow, sprinkles almost gone, dark cards, so the critters and game art are the bright things.

## Goals
1. Home, Games, Trophies, Rivals and You are dark and calm. Only the accent, the critters and the game art carry colour.
2. A new Home structure where the content leads: what to play next, the chat in one glance, the grudge and your level.
3. Chat looks and behaves like Instagram DMs in dark mode: inbox first, then the conversation.
4. Everything from the last redesign stays: one page, instant switching, view transitions, the quick reply, sounds, the photo wallpaper colours and the blur slider.

## Non-goals
- The game pages (ludo.html and the rest) keep their current look. The dark look is scoped to `body.home` (only index.html has it).
- No new features beyond the inbox, and no database changes.
- The login and loading screens only get the dark background; their layout stays.

## Anti-goals
- Pure black-and-grey flatness that loses the playful vibe.
- A neon or gamer look.
- Low contrast: text must stay at least 4.5:1 on dark surfaces.

## Approach
One sensible way: a dark token layer scoped to `body.home`, which redefines the six `pal-*` themes as accent-plus-glow and replaces the glass tokens in `hub/shell.css` and `hub/home.css`. On top of it go a rebuilt Home (markup, renderHome and home.css) and a new inbox view inside `#tab-chat`. Rewriting `hub/hub.css` from scratch was rejected: too much risk for no visible gain.

## The design

### 1. Colour system (body.home)
| Token | Value | Use |
|---|---|---|
| `--night` | `#15111c` | page background (plum-black) |
| `--surface` | `#1e1827` | cards |
| `--surface-2` | `#282133` | raised parts: tiles, inputs, chips |
| `--edge` | `#ffffff14` | 1 px card edges |
| `--text` | `#f4eefb` | main text |
| `--text-2` | `#b2a7c3` | secondary text (at least 4.5:1 on `--surface`) |
| `--accent` | per theme, below | buttons, the active nav item, highlights |

Theme → accent (the names stay; the "Background" picker in You shows the accent and glow, not gradients):
- Candy Pop: `#ff5fa2`
- Deep Sea: `#2ad0c1`
- Picnic: `#ffb03b`
- Arcade Night: `#9b7bff`
- Cotton Candy: `#ff8fc8`
- Jungle: `#3ccf91`

The background is `--night` plus two very soft radial glows: the accent at about 16% top-left, and a second hue at about 8% bottom-right. The drifting sprinkles (`#scene`) go down to about 6% opacity. Card shadows are deep and soft (`0 20px 40px -24px #000c`), with no white glass. The `--cta` and `--focus` variables map to the accent so old hub.css rules follow.

Type stays Fredoka (headings) and Nunito (text), as the user's vibe. White headings, `--text-2` for the rest.

### 2. Home structure

**Laptop (≥ 900 px):**
```
rail │ Evening, Ammu.                                        (you · Lv 5 ring)
     │ Kunju sent you 6 messages.
     │ ┌──────────── Up next (8 cols) ────────────────┐ ┌── Messages (4 cols) ─────┐
     │ │ the game's own art, big, on its colour       │ │   (critter peeks over)   │
     │ │ Revenge at Ludo                              │ │ (face●) Kunju            │
     │ │ Kunju won 20 min ago      [Play]  [Challenge]│ │ 6 new · 2m               │
     │ └──────────────────────────────────────────────┘ │ 1,240 messages so far    │
     │                                                  ├── The grudge ────────────┤
     │ Games                                     All    │   You 1 – 1 Kunju  ●●○   │
     │ [tile] [tile] [tile] [tile] [tile] [tile]        └──────────────────────────┘
     │ Level 5 Sundae ▓▓▓▓░░ 403 XP to Banana Split   🍒 🎟 💥 📦   All trophies
```
- **Up next**: the hero, and the one bright thing. It shows the most relevant game, in this priority order:
  1. an unfinished game (resume);
  2. a loss in the last day (revenge);
  3. a pending challenge;
  4. otherwise the game you've played most ("Your Ludo rematch?").
  It's drawn with that game's real card art at large size.
- **Messages card**: their critter peeks over the top edge (kept from last time, smaller). It shows their name, "Active now", the unread count, the last message time and the total messages sent. Tapping it opens the **inbox**, not the conversation. The quick reply moves into the inbox (see 3).
- **Grudge**: compact. The score, the pips and a "Challenge" button.
- **Games**: six dark tiles, each with its game art and name. Pointing at one lifts it.
- **Level strip**: one line with the cone, the XP bar, the next level and the latest trophies.

**Phone:**
```
Evening, Ammu.            (Lv)
Kunju sent you 6 messages.
┌ (face●) Kunju · 6 new · 2m   › ┐   ← an inbox-style row
┌──────── Up next ───────────────┐
│ art · Revenge at Ludo  [Play]  │
└────────────────────────────────┘
Games  [tile][tile][tile]→ (swipe)
┌ Grudge 1–1 ┐ ┌ Level 5 ▓▓░ ┐     ← two small cards side by side
```

### 3. Chat: Instagram DMs, dark
- **Every chat theme becomes dark**, as on Instagram in dark mode:
  - background near-black (`#0b0a0f`); their bubbles `#26232c`; text `#f5f3f7`;
  - your bubbles keep each theme's own gradient, and Candy Pop becomes Instagram-like purple → blue;
  - header and composer: black glass; the composer is a `#1f1d24` pill.
  - The photo wallpaper, its colours and the blur slider are unchanged; the photo palette is always "dark".
- **Inbox screen** (new, `#dm-inbox` inside `#tab-chat`). Chat in the nav and the Home Messages card both land here:
  ```
  ┌ Messages                         ✎ ┐
  │ ── 1,240 messages · since 27 Oct ──│   ← "how many messages have been sent"
  │ (face●) Panchara Kunju        ●    │
  │         6 new messages · 2m        │
  │ ── Quick reply… ──────────────── ➤ │
  └────────────────────────────────────┘
  ```
  - One row: the other person. Their face shows a ring when there's something unread; then the nickname or name, "N new messages · 2m" (or the last message preview when everything is read), and a blue dot for unread.
  - Under it, a quick reply.
  - Tapping the row slides the conversation in from the right, as Instagram does; the back arrow returns to the inbox. On a laptop the inbox becomes a left column (about 360 px) beside the conversation, like Instagram on the web; the inbox row is highlighted while open.
  - Reading still only happens while the conversation is on screen. The inbox never marks messages seen.
- Hash routes: `#chat` is the inbox; `#chat/open` (or a state flag) is the conversation. Back from the conversation returns to the inbox, never straight Home.

### 4. Games, Trophies, Rivals, You
The same dark surfaces and accent: game cards become dark cards with their bright art, trophies are dark cards with gold medals, and the You settings sit on dark surfaces. The structure stays.

## Testing
- Screenshots before and after at 1440, 1280, 390 and 360, of Home, the inbox, the conversation, Games and You, in two themes (Candy Pop and Deep Sea).
- Contrast: a script measures the text and background of main and secondary text on Home and the inbox (at least 4.5:1).
- Flow: nav Chat → inbox (the conversation is not shown, nothing is marked read) → row → conversation (now read) → back → inbox → Home.
- The quick reply from the inbox sends.
- All existing checks still pass: shoot.mjs, fixes.mjs, 109 unit tests and reduced motion.

## Constraints
Static site, no installs (global puppeteer-core only), pinned CDNs, recorded CC0 sounds only, one folder, commit only my own paths, push only when asked.

## Left to the builder
Exact glow positions, spacing, and the choice of featured-game copy.
