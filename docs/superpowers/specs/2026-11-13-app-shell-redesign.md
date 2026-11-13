# Redesign: one smooth app for Home, Games and Chat (13 Nov 2026)

Status: **built** (13 Nov 2026, commits 8066e14..; see the plan in docs/superpowers/plans/2026-11-13-app-shell-redesign.md). Follows `2026-11-13-chat-as-core-redesign.md` (built in a6452c4 / 51bef40), which put Chat next to Games but left it feeling like two apps.

## Why (the user's words, condensed)
- Home and Chat are "still not smooth", have no animations and "something is missing". They should match the smoothness and look of **Instagram DMs**.
- The laptop Home is "designless" and "blank". The phone Home was never checked.
- Going Home ↔ Chat shows **just the background for about 1 second** before anything appears. That has to go.
- Chat: when a **photo wallpaper** is set, the message bubbles should **take their colours from the photo**, as Instagram does.
- Chat: a **blur slider** for the wallpaper (clear … blurred). Today it's always blurred.
- Look direction picked: **B, "playful but polished"**. Keep the sweets-and-critters personality, drop the heavy outlines, add depth, glass and motion, and make Chat use the same language.
- Use Puppeteer (screenshots before and after), the frontend-design skill and UI/UX Pro Max.

## What the screenshots showed (before, 1440 px and 390 px)
- Laptop Home: two cards at the top and about 60% empty sprinkle background below. The top tab bar is wider than 1440 px, so the **page scrolls sideways** (a purple strip on the right).
- Home is chunky and cartoony (3 px dark outlines, offset shadows, Lilita display font). Chat is clean and Instagram-like (Nunito, soft glass). They read as two different apps.
- Photo wallpaper: `blur(6px)` plus a 52% cover in the theme colour, so the photo is always washed out. Bubble colours come only from the theme.
- The 1 s blank: Home (`index.html`) and Chat (`messages.html`) are separate pages, so every switch is a full page load. Each page then waits for the supabase-js CDN script and `auth.getSession()` before drawing, and the chat's five ES modules load one after another.

## Goals
1. Home → Chat → Games → You switch **instantly** (under 100 ms to the first frame), with real animation, on every phone including iPhones.
2. One visual language across Home, Games, Chat and You (style B).
3. A laptop Home that is full, alive and useful. A phone Home designed on purpose.
4. Photo wallpaper → bubble colours derived from the photo. Blur slider from 0 to 100%.
5. Everything respects `prefers-reduced-motion` and the app's Calm mode.

## Non-goals
- The game pages themselves (Ludo, Doodle Duel and the rest). They stay separate pages and keep their look. Only the way you get into and back out of them is touched.
- New chat features (calls, groups and so on). Only a quick-reply box on Home is new (see 3).
- Database changes. None are needed (see 5).

## Anti-goals (a failure even if it "works")
- Any visible blank or flash when switching sections.
- Janky motion: layout-shifting animations, animations that block input, or motion that ignores reduced motion.
- Losing the app's personality and becoming a generic grey messaging clone.
- Breaking old links (`messages.html`, `index.html#play`, room links, `?next=`).

## Approaches considered
1. **One app page (chosen).** Home, Games list, Trophies/Rivals, Chat and You all live in `index.html`. The chat code (`messages/*.js`) loads into it as a section. Switching never reloads, so it's instant everywhere and can use same-page view transitions (a shared-element morph from the Home chat card to the chat header). Cost: the chat's DOM, CSS and start-up move into the main page.
2. Two pages with the browser preparing the next page in the background (speculation-rules `prerender`) and cross-page view transitions. Less code moves, but prerender is Chrome/Edge only, so the flash stays on iPhone Safari, and cross-page motion is limited.
3. Faster boot only. Cheapest, but adds no motion.

The user handed over the "how", and 1 is the only option that meets goal 1 on every phone.

## The design

### 1. App shell (one page)
- `index.html` gets a `#screen-app` with sections `home`, `games` (with the Games / Trophies / Rivals segmented control), `chat` and `you`. The hash still routes: `#home`, `#play`, `#trophies`, `#rivals`, `#me`, and the new `#chat`.
- `messages.html` becomes a tiny redirect to `index.html#chat` (it keeps working as a bookmark and in `?next=`).
- **Navigation:**
  - **Laptop (≥ 900 px):** a slim left rail, glass over the background. Logo cone at the top. Home, Games, Chat and You use SVG line icons (from `shared/core.js` `ICONS`, plus new home, gamepad and user icons) with labels. Chat shows the unread badge and the other person's face. Your critter and level ring sit at the bottom.
  - **Phone:** a bottom tab bar, glass, with the same four items. A pill highlight **slides** between items. It hides while the chat's keyboard is up.
  - This replaces today's top tab bar, which fixes the sideways scroll.
- **Section switches:** the same-document View Transitions API where the browser has it (Chrome/Edge, Safari 18+), with a CSS fallback.
  - Home → Chat: a shared-axis slide (chat comes in from the right, Home drifts left and fades). The Home chat card's face **morphs** into the chat header's face (`view-transition-name`).
  - Chat → back: the reverse.
  - Between the other nav items: a quick cross-fade with a 12 px lift.
  - Timing: 260–320 ms, `cubic-bezier(.2,.8,.2,1)`. Input is never blocked, and a new tap cancels the running transition.
- The chat module is imported **in the background once Home is idle** (`requestIdleCallback` → `import('./messages/app.js')`). It renders the cached thread into the hidden chat section, so opening Chat is just showing it.

### 2. Speed: draw first, check later
- Boot reads the saved session straight from `localStorage['sr-auth']` (where supabase-js keeps it) and draws the whole shell from cached data **before** the network: the profile cache, the chat cache, and a new `sr-home-peek` cache for the Home chat card. `getSession()` and `refresh()` then confirm and refresh quietly. If the saved session turns out invalid, the login screen shows.
- The supabase-js script gets `defer`. The chat modules get `<link rel="modulepreload">`. The main fonts are preloaded.
- Coming back from a game page is still a page load, but it now paints Home from cache in the first frame (and the back/forward cache keeps working).

### 3. Home (style B)

**Laptop (bento grid, 12 columns, max 1240 px, centred next to the rail):**
```
┌ rail ┐ ┌──────────────────────────────────────────────────────────┐
│ 🍦   │ │ Good evening, Ammu                     [cone Lv 7 ▓▓▓░ ] │
│ Home │ ├──────────────────────────────┬───────────────────────────┤
│ Games│ │  CHAT (big, wallpaper inside) │  CONTINUE / PLAY           │
│ Chat●│ │  (face●) Panchara Kunju        │  [Ludo art]  Your turn!    │
│ You  │ │   ┌ last 3 messages as real   │  ── game tiles carousel ── │
│      │ │   └ bubbles, typing dots      │  [🎂][💣][✏️][🎲][+4][🐍]   │
│      │ │  [ Quick reply…        ➤ ]    │                            │
│ (you)│ ├───────────────┬──────────────┴───────────┬───────────────┤
└──────┘ │ RIVALRY        │ TROPHIES                  │ TODAY          │
         │ you 3 – 2 them │ next: "Bonk Master" ▓▓░   │ season line /  │
         │ [Challenge ⚔️] │ shelf of 4 latest         │ critter waving │
         └────────────────┴──────────────────────────┴────────────────┘
```
- **Chat card (the hero):** shows the chat's own wallpaper and theme in miniature. It has the last three messages as real bubbles, the "Active now" dot, live typing dots, and the unread count. **Quick reply** (proposal; easy to drop) sends a text without leaving Home, and the bubble flies into the card. Clicking the card opens Chat with the face morph.
- **Play card:** "Continue" first (the resume banner and any pending challenge), then a horizontal carousel of game tiles that reuse each game's existing art. Hovering lifts a tile and plays its art's little loop.
- **Rivalry, Trophies and Today cards:** the grudge score against the other person (from the profile already loaded) with a Challenge button, your level cone with the XP to the next level and the latest trophies, and the season line or a critter.
- **Look:** soft clay cards: 24 px radius, two-layer soft shadows, a 1 px light inner edge, a slightly translucent fill over the theme background, no dark outlines. Fredoka for headings, Nunito for text. The theme background and drifting sprinkles stay, but slower and fainter.
- **Entrance:** cards fade and rise in a 40 ms stagger on first paint (only on the first visit of the session, not on every switch).

**Phone:** the same cards stacked in this order: a compact header (greeting, level ring and your face), Chat (hero, with quick reply), Continue/Play (the carousel swipes sideways), Rivalry, Trophies. The bottom tab bar sits below. Checked at 360, 390 and 430 px.

### 4. Chat (same language, more motion)
- It fills the chat section, with the rail on laptop. The conversation column is max 760 px. On ≥ 1200 px, Details opens as a right column instead of sliding over.
- **Intro (top of the thread):** a hero card with a large face, their name and nickname, "You've been chatting since …" and the message count, with a "Play a game together" chip. It replaces today's plain hi-card.
- **Motion:**
  - A sent bubble springs up from the composer (translate plus scale, 240 ms).
  - Arriving bubbles slide in from the left with a fade.
  - The send button morphs heart ↔ arrow.
  - Reactions pop, and the long-press menu scales from the bubble.
  - Typing dots wave. Date dividers fade.
  - Scrolling to the bottom is smooth. The jump-down button bounces in.
  - The bubble gradient stays fixed to the screen as it does today: bubbles change colour as they scroll, as on Instagram.

### 5. Photo wallpaper colours and the blur slider
- **Colours from the photo:** when the wallpaper is a photo, the page draws it into a 64×64 canvas and picks:
  - the three most vivid, distinct colours for my gradient (`--m1/--m2/--m3`), sorted by hue;
  - a glassy version of the photo's average colour for their bubbles (`--theirs`);
  - text colour from the luminance (WCAG 4.5:1 on both bubble types, nudged darker or lighter until it passes).
  The result is cached in localStorage per photo path. The same photo gives the same colours on both phones, so **no database change** is needed. Picking a preset theme afterwards switches back to theme colours. The theme picker shows a "From your photo" tile while a photo is set.
- **Blur slider** in Details → Wallpaper: from 0 (clear) to 100% (= 24 px), **just on this device**, saved as `dm-wall-blur`, with a live preview while dragging. Default 0%. The fixed 52% cover goes. Readability comes from the bubbles (solid colour) plus a soft fade behind the header and composer only. The slider also applies to the preset wallpapers.

### 6. Games and You
These get the same card style, nav and transitions. The content and features stay the same. Trophies and Rivals stay under Games.

## Testing
- Before/after Puppeteer screenshots at 1440×900, 1280×800, 390×844 and 360×740, of Home, Games, Chat, Details and You, plus a photo wallpaper at blur 0 and 60%.
- Speed: measure the time from a nav click to the chat being visible (target < 100 ms), and from first paint on reload to Home drawn from cache.
- No sideways scroll at any width. No console errors.
- `node --test tests/*.test.js` still passes. Add tests for the colour-picking function (`messages/logic.mjs`, pure).
- Reduced motion: transitions become instant cross-fades.

## Constraints
Static site, no build step, no project installs (Puppeteer is global, `puppeteer-core` with the installed Edge, and its profile goes in the scratchpad and is deleted afterwards). Pinned CDN versions only. Real recorded sounds only. One folder, no worktrees. Commit only my own paths. Push only when asked.

## Left to the builder
Exact spacing, shadow values, icon drawings and the order of commits (shell → Home → Chat motion → wallpaper colours/blur → Games/You polish), each checked with screenshots.
