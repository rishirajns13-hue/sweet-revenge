# One Smooth App (Home, Games, Chat) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge Chat into `index.html` as one instant, animated app shell in style B, with a full laptop Home, photo-derived bubble colours and a wallpaper blur slider.

**Architecture:** `index.html` hosts every main section (home, games/trophies/rivals, chat, you). `hub/hub.js` routes by hash. The chat module (`messages/app.js`) stops starting itself and exports `mountChat(root)`, which the hub imports in the background. Chat CSS and theme variables are scoped to `#dm-root` so they can't leak into Home. Section switches use same-document View Transitions with a CSS fallback.

**Tech Stack:** Static HTML/CSS/vanilla JS (classic scripts plus ES modules), supabase-js 2.49.4 from jsDelivr, `node --test`, global `puppeteer-core` driving the installed Edge.

**Spec:** `docs/superpowers/specs/2026-11-13-app-shell-redesign.md`

## Global Constraints
- No build step, no project installs. Puppeteer is global `puppeteer-core`; the Edge profile lives in the scratchpad and is deleted in `finally`.
- Pinned CDN versions only. Real recorded sounds only (no new synthesized sounds).
- Motion: 260–320 ms, `cubic-bezier(.2,.8,.2,1)`. Off under `prefers-reduced-motion` and `body.calm` (instant cross-fade instead).
- Breakpoints: laptop rail ≥ 900 px; Details as a right column ≥ 1200 px; checked at 1440, 1280, 390 and 360 px.
- No horizontal scroll at any checked width. No console errors.
- Old links keep working: `messages.html`, `#play`, `#trophies`, `#rivals`, `#me`, `?room=`, `?next=`.
- Blur: 0–100% maps to 0–24 px, per device, key `dm-wall-blur`, default 0.
- Commit only own paths, in `D:\Projects\Ludo`, on the current branch. Never push unless asked.

## Review Focus
- **Vanish mode on leaving Chat without leaving the page:** switching to Home must run the same sweep as `pagehide` (`D.vanishSweepOnLeave()`), set presence `here:false` and stop typing. Pinned in Task 3.
- **"Seen" while Chat is hidden:** a message arriving while you're on Home must **not** be marked read. `readIfLooking()` must require the chat section to be visible. Pinned in Task 3.
- **Theme leakage:** a dark chat theme (Midnight Sundae) must not recolour Home, the nav or the game cards. `applyTheme` writes vars on `#dm-root` only. Pinned in Task 2.
- **Keyboard shortcuts while typing in chat:** the hub's number-key shortcuts and Escape handlers must not fire from the chat textarea or close the chat's own menus. Pinned in Task 3.
- **Low-contrast photo palettes** (an all-white or all-black photo): bubble text still passes 4.5:1. Pinned in Task 1.

---

### Task 1: Colours from a photo (pure, tested)

**Files:**
- Modify: `messages/logic.mjs` (append)
- Test: `tests/messages.test.js` (append)

**Interfaces:**
- Produces: `contrast(hexA: string, hexB: string) -> number` (WCAG ratio, 1–21).
- Produces: `paletteFromPixels(data: Uint8ClampedArray /* RGBA */) -> { mine: [hex, hex, hex], theirs: hex, accent: hex, dark: boolean, textMine: hex, textTheirs: hex }`.

- [ ] **Step 1: Write failing tests**
  - `contrast('#000000', '#ffffff')` ≈ 21 (±0.01); `contrast('#777777', '#777777')` === 1.
  - Build pixel arrays (helper `px(...rgb)` repeats colours to 64×64): half `#ff2e6e`, half `#3459e6` → `mine` has 3 entries and contains a red-ish hue (h 330–360 or 0–20) and a blue-ish hue (h 210–240).
  - An all-`#ffffff` photo → `dark === false`, and `contrast(textMine, mine[1]) >= 4.5`, `contrast(textTheirs, theirs) >= 4.5`.
  - An all-`#000000` photo → `dark === true`, same two contrast assertions.
  - The same input twice gives deep-equal output (deterministic).
- [ ] **Step 2: Run** `node --test tests/messages.test.js`. Expected: the new tests FAIL with "not a function".
- [ ] **Step 3: Implement** in `logic.mjs`:
  1. Bucket pixels into a 12-hue × 3-lightness histogram, skipping alpha < 128.
  2. Score each bucket by count × saturation.
  3. Take the 3 best buckets whose hues are ≥ 25° apart. Fill missing slots by shifting the best hue ±30° in lightness.
  4. Average each bucket's RGB and sort by hue.
  5. `dark` = average luminance < 0.4.
  6. `theirs` = average colour mixed 70% toward white (light) or 70% toward `#1d1830` (dark).
  7. `accent` = the most saturated of `mine`.
  8. Text colours: start with `#ffffff` on mine and `#241c33`/`#f4f0fb` on theirs. If a contrast check fails, darken or lighten the bubble colour in 8% steps until it passes.
- [ ] **Step 4: Run** `node --test tests/*.test.js`. Expected: all pass.
- [ ] **Step 5: Commit** "Chat: colours picked from a photo, with readable text (tested)".

### Task 2: Chat becomes mountable and scoped

**Files:**
- Modify: `messages/messages.css` (every `html`/`body.dm` selector → `#dm-root`, and `body.typing` → `#dm-root.typing`)
- Modify: `messages/themes.js`: `applyTheme(key, vanish, root = document.documentElement)` writes vars and the `dark` class on `root`. Only the standalone page sets `theme-color`/html background.
- Modify: `messages/app.js`
  - Replace the self-running `start()` with `export async function mountChat(root)`.
  - Rename `#hello` → `#dm-hello` (the hub already uses `#hello`).
  - Every `document.body.dataset.wall` / `classList` → `root`.
- Modify: `messages.html`: wrap its markup in `<div id="dm-root" class="dm-root">` and call `mountChat` from an inline module (a temporary standalone harness until Task 3).

**Interfaces:**
- Produces: `mountChat(root: HTMLElement) -> Promise<{ show(): void, hide(): void, isShown(): boolean }>`.
  - `show()`: marks the chat visible, calls `readIfLooking()`, `D.setHere(true)` and focuses the input on fine pointers.
  - `hide()`: `D.vanishSweepOnLeave()`, `D.sendTyping(false)`, `D.setHere(false)`, closes the menu, picker and details.
- Produces: `#dm-root[data-wall]`, `#dm-root.dark`, CSS vars `--m1..--m3 --theirs --chat-bg --accent --text --sub --line --bar --sheet --chip` on `#dm-root`.

- [ ] **Step 1:** Make the edits above.
- [ ] **Step 2: Verify:**
  - Run `node shoot.mjs shots t2` with `SHOTS=chat,details`.
  - Expected: chat and details look the same as `before-*-chat.png` / `before-*-details.png`, and it prints `no page errors`.
  - Assert in the script that `getComputedStyle(document.documentElement).getPropertyValue('--m1') === ''` (theme vars are not on `html`).
- [ ] **Step 3:** `node --test tests/*.test.js` passes.
- [ ] **Step 4: Commit** "Chat: mountable and scoped to its own root (no theme leaks)".

### Task 3: One app shell, nav, routing, transitions

**Files:**
- Modify: `index.html`
  - Remove the top `.tabs` and `#btn-dm`.
  - Add `<nav class="app-nav">` (four links with `data-nav="home|play|chat|me"`, SVG icons, `#nav-chat-badge`, a `.nav-pill` highlight).
  - Add `<section id="tab-chat" class="panel chat" hidden><div id="dm-root" class="dm-root">…chat markup moved from messages.html…</div></section>`.
  - Add `<link rel="stylesheet" href="messages/messages.css">`.
  - Add `<link rel="modulepreload">` for `messages/app.js, data.js, logic.mjs, themes.js, picker.js, voice.js`.
- Modify: `messages.html` → only `<script>location.replace('index.html' + location.search + '#chat')</script>` plus a `<noscript>` link.
- Modify: `hub/hub.js`
  - `TABS = ['home','play','trophies','rivals','chat','me']`.
  - `showTab` wraps panel swaps in `document.startViewTransition` when it exists and motion is allowed, and sets `data-dir` (forward/back) on `<html>` for the slide direction.
  - A new `ensureChat()` lazily imports `./messages/app.js` once (on idle after the hub is shown, or on first open) and calls `mountChat($('#dm-root'))`.
  - Entering `chat` calls `chat.show()`. Leaving calls `chat.hide()`.
  - The nav badge reuses `countUnread()`.
  - The keydown handler ignores events from inside `#dm-root`.
  - `routeAway` maps `next=messages.html` to `#chat`.
- Modify: `hub/hub.css`: `.app-nav` as a rail ≥ 900 px and a bottom bar below that, `.nav-pill` slide, `::view-transition-*` rules, and the panel layout beside the rail.

**Interfaces:**
- Consumes: `mountChat` from Task 2.
- Produces: `showTab(name, opts)` accepts `'chat'`. The `view-transition-name: peer-face` goes on both `#home-chat-face` and `#peer-face` (Task 5 relies on it).

- [ ] **Step 1:** Make the edits above.
- [ ] **Step 2: Extend `shoot.mjs`** with a `flow` shot. On load at `#home`:
  - click the Chat nav, then assert within 150 ms that `#tab-chat` is visible and `#thread` has ≥ 1 child;
  - assert `document.documentElement.scrollWidth <= innerWidth`;
  - with a new mock message delivered while on Home, assert its `seen_at` stays null (Review Focus);
  - with a vanish message seen in chat, switching to Home calls `dm_vanish_sweep` (log the RPC in the mock);
  - press `2` inside the textarea and assert the tab is still `chat`;
  - open `messages.html` and assert it lands on `index.html#chat`.
- [ ] **Step 3:** Run it at 1440 and 390. Expected: all assertions pass and `no page errors`.
- [ ] **Step 4: Commit** "One app: Chat lives inside the main page, new nav, instant animated switching".

### Task 4: Draw first, check later (boot speed)

**Files:**
- Modify: `shared/core.js`: add `peekMe() -> me | null`. It reads `localStorage['sr-auth']` (`access_token`, `user.user_metadata.username`, `expires_at`) and `ludo-me` synchronously, and returns null if the token is missing or more than 7 days past `expires_at`.
- Modify: `hub/hub.js`: `boot()` paints from `peekMe()` and the caches straight away, then runs `loadMe()`. If that returns null, it shows login. `loadDmPeek()` writes `sr-home-peek:<user>` and `renderHome()` reads it first.
- Modify: `index.html`: add `defer` to the supabase-js and classic scripts in order, and a preload for the Fredoka/Nunito CSS.

- [ ] **Step 1:** Make the edits above.
- [ ] **Step 2: Verify** in `shoot.mjs`:
  - make the mock's `getSession` resolve after 1500 ms;
  - on a reload with caches seeded, assert that `#tab-home .home-card` is visible at `DOMContentLoaded + 200 ms`;
  - with no `sr-auth`, assert the login screen shows.
- [ ] **Step 3: Commit** "Home draws from saved data before the login check".

### Task 5: Home redesign (style B)

**Files:**
- Modify: `index.html` `#tab-home`: header (greeting, level ring, your face); `.bento` with `.card-chat` (mini thread `#home-thread`, typing dots, quick reply form `#home-reply`), `.card-play` (continue slot plus a `.tile` carousel reusing each game's art), `.card-rival`, `.card-trophy`, `.card-today`.
- Modify: `hub/hub.css`:
  - style-B tokens `--clay-bg`, `--clay-shadow` (two layers), `--clay-edge`, radius 24 px;
  - the bento grid (12 columns, max 1240 px; stacked under 900 px);
  - entrance stagger (40 ms, first visit of the session only, `sessionStorage['sr-home-seen']`);
  - hover lift and press scale .97;
  - slower and fainter `#scene` sprinkles.
- Modify: `hub/hub.js`: `renderHome()` fills the cards:
  - the chat card mirrors the chat's wallpaper and theme vars (from the `dm-cache:<user>` state) and the last 3 non-system messages;
  - the rivalry card shows the grudge score from the profile;
  - quick reply calls `ensureChat()` then the exported `sendText(body)`.
- Modify: `messages/app.js`: export `sendText(body: string) -> void` (the same path as the composer).

- [ ] **Step 1:** Make the edits above.
- [ ] **Step 2:** Screenshots at 1440, 1280, 390 and 360. Review against the spec sketch: no empty lower half on laptop, no sideways scroll, cards readable on all 6 palettes (loop `ludo-palette`).
- [ ] **Step 3:** In the flow test, sending "hi" via quick reply makes `#home-thread` show "hi" and the `dm_send` RPC gets called.
- [ ] **Step 4: Commit** "Home: a full, alive bento in style B with a live chat card and quick reply".

### Task 6: Chat in style B with motion and an intro hero

**Files:**
- Modify: `messages/messages.css`:
  - clay and glass header and composer;
  - keyframes `bub-send` (translateY 18 px, scale .92 → 1, 240 ms spring), `bub-arrive` (translateX −12 px, fade);
  - heart ↔ arrow morph; reaction pop; menu scale-from-origin; jump-down bounce;
  - the Details right column ≥ 1200 px.
- Modify: `messages/app.js` `renderHello()` → the hero card (large face, name and nickname, "Chatting since <first message date> · N messages", a "Play a game together" chip linking `#play`).

- [ ] **Step 1:** Make the edits above.
- [ ] **Step 2:** Screenshots, plus a 6-frame capture of sending a message (every 50 ms), checked visually for the spring.
- [ ] **Step 3: Commit** "Chat: style B, springy bubbles and an intro card".

### Task 7: Photo wallpaper colours and the blur slider

**Files:**
- Modify: `messages/app.js`
  - In `applyLook()`, when `wallKind === 'photo'`: load the image (crossOrigin anonymous), draw it at 64×64, call `L.paletteFromPixels`, cache the result in `dm-wall-pal:<path>`, and apply it to `#dm-root` (overriding the theme vars). Otherwise apply the theme.
  - The theme grid shows a "From your photo" tile while a photo is set.
- Modify: `messages.html` markup moved in Task 3 (`index.html` `#dm-root` Details): `<input type="range" id="wall-blur" min="0" max="100" step="1">` with a value label.
- Modify: `messages/messages.css`: the photo layer uses `filter: blur(calc(var(--wall-blur, 0) * .24px))` on a `::before` with `inset: -40px` (no edge halo). Remove the 52% cover. Add soft fades under the header and composer only.

- [ ] **Step 1:** Make the edits above.
- [ ] **Step 2:** In `shoot.mjs`, serve a test photo from the scratchpad as the mock wallpaper, then screenshot at blur 0 and 60. Assert the `--m1` computed on `#dm-root` differs from the theme's `#8f6bff` and that `localStorage['dm-wall-blur'] === '60'` after the slider is set.
- [ ] **Step 3: Commit** "Chat: bubbles take the photo's colours; wallpaper blur slider".

### Task 8: Games and You in the same style, then final check

**Files:**
- Modify: `hub/hub.css`: `.game-card`, `.games-sub`, Trophies, Rivals and You cards use the clay tokens, with no 3 px outlines.

- [ ] **Step 1:** Make the edits above.
- [ ] **Step 2: Full run:**
  - `SHOTS=home,play,chat,details,flow` at 1440, 1280, 390 and 360;
  - `node --test tests/*.test.js`;
  - check reduced motion with `page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}])` (no animation over 0.01 s).
- [ ] **Step 3:** Update `docs/superpowers/specs/2026-11-13-app-shell-redesign.md` status to "built".
- [ ] **Step 4: Commit** "Games and You in style B; redesign complete".
