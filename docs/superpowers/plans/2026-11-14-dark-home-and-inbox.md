# Dark Home and Chat Inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Home, Games and You a calm dark "night dessert shop", restructure Home around an "Up next" hero, and give Chat an Instagram-style dark inbox before the conversation.

**Architecture:** A dark token layer scoped to `body.home` (`hub/shell.css` + `hub/home.css`) redefines the six `pal-*` themes as accent plus glow and replaces the glass tokens. Home is rebuilt in `index.html` (`#tab-home`), `hub/hub.js` (`renderHome`) and `hub/home.css`. Chat themes in `messages/themes.js` all become dark. A new inbox view `#dm-inbox` inside `#tab-chat` is driven by `messages/app.js` (`showInbox()` / `openThread()`) and by the hub's routing.

**Tech Stack:** Static HTML/CSS/vanilla JS, ES modules for the chat, `node --test`, global puppeteer-core with Edge (scratchpad `shoot.mjs`, `fixes.mjs`, `mock-sb.js`).

**Spec:** `docs/superpowers/specs/2026-11-14-dark-home-and-inbox-design.md`

## Global Constraints
- The dark look applies only under `body.home` (index.html). Game pages are unchanged.
- Tokens, exact values: `--night #15111c`, `--surface #1e1827`, `--surface-2 #282133`, `--edge #ffffff14`, `--text #f4eefb`, `--text-2 #b2a7c3`.
- Accents:
  - `pal-sunset #ff5fa2`
  - `pal-lagoon #2ad0c1`
  - `pal-lemonade #ffb03b`
  - `pal-midnight #9b7bff`
  - `pal-bubblegum #ff8fc8`
  - `pal-jungle #3ccf91`
- Chat (all themes): background `#0b0a0f`, their bubbles `#26232c`, text `#f5f3f7`, composer pill `#1f1d24`. Candy Pop "mine" is purple → blue.
- Text contrast is at least 4.5:1 for main and secondary text.
- Fonts: Fredoka (headings) and Nunito (text). Motion is off under reduced motion and Calm mode.
- Keep everything already there: instant switching, view transitions, quick reply (now in the inbox), sounds, photo colours and blur.
- Bump `?v=` on every changed file and keep the chat module imports versioned (fixes.mjs check 5).
- One folder; commit only own paths; push only when asked.

## Review Focus
- **Seen receipts:** the inbox must never mark messages seen. Only the open conversation does (`readIfLooking` needs the thread view, not just `shown`). Pinned in Task 4.
- **Back from the conversation** returns to the inbox, not Home. The browser Back button behaves the same way. Pinned in Task 4.
- **Presence:** "here" is true only while the conversation is open, not on the inbox. Pinned in Task 4.
- **Contrast on dark:** secondary text on `--surface` and on `--surface-2`. Pinned in Task 1.
- **Old deep links:** `#chat` lands on the inbox and `messages.html` still works. Pinned in Task 4.

---

### Task 1: Dark tokens and themes (body.home)
**Files:**
- Modify `hub/shell.css`: new tokens; replace the glass tokens' values; the nav and section-switch surfaces go dark.
- Modify `hub/home.css`: `--sugar*` → dark surfaces.
- Modify `index.html`: bump versions.

**Produces:**
- CSS vars `--night --surface --surface-2 --edge --text --text-2 --accent` on `body.home`.
- `body.home.pal-*` sets `--accent`, `--cta: var(--accent)`, `--focus`, and `--bg` (night plus two glows).

- [ ] **Step 1:** Add a `contrast` check to `shoot.mjs`. On `#home`, take the computed colour of `.hm-hello`, `.hm-sub`, the `.hm-note` text and the nav labels against the colour actually under them (walk up to the first non-transparent background, or `--night`). Assert all are at least 4.5:1. Run it. Expected: FAIL today (white text on the light glass, and the nav).
- [ ] **Step 2:** Write the token layer. `#scene` opacity .06; `body.home::before` uses the night plus glow `--bg`.
- [ ] **Step 3:** Run the contrast check. Expected: PASS at 1440 and 390, in pal-sunset and pal-lagoon. Take screenshots.
- [ ] **Step 4:** Commit "Dark night-dessert-shop tokens and themes for the app".

### Task 2: Home restructure
**Files:**
- Modify `index.html` `#tab-home`:
  - `.hm-head` (greeting, sub-line, level ring);
  - `.hm-next` (Up next hero: `#home-next-art`, `#home-next-title`, `#home-next-sub`, `#home-next-play`, `#home-next-challenge`);
  - `.hm-msgs` (peek critter, `#home-chat-name`, `#home-chat-status`, `#home-chat-count`, `#home-chat-total`);
  - `.hm-grudge` (compact);
  - `.hm-games` (`#home-tiles`);
  - `.hm-level` strip.
  - Remove the Home thread and the quick reply.
- Modify `hub/hub.js` `renderHome()`:
  - fill the new parts;
  - `upNext()` → `{ kind, game, title, sub, href }`, in priority order: resume > revenge (less than 24 h) > pending challenge > most-played > Ludo;
  - the Up next art is the game card's `.art` innerHTML, inside the card's own classes (as the tiles did originally), at large size;
  - the Messages card and the phone row link to `#chat` (the inbox).
- Modify `hub/home.css`: the laptop grid (Up next 8 columns, Messages + Grudge 4 columns, Games full width, Level strip) and the phone stack (inbox-style row first; Grudge + Level side by side).

- [ ] **Step 1:** Update the shoot.mjs `flow` and `home` checks:
  - Home shows `.hm-next` with a non-empty title;
  - clicking `.hm-msgs` lands on `#chat` with the inbox visible and the thread hidden;
  - no sideways scroll at 1440, 1280, 390 and 360.

  Run. Expected: FAIL (no `.hm-next`).
- [ ] **Step 2:** Build it.
- [ ] **Step 3:** Run. Expected: PASS. Review the screenshots at 4 sizes and fix what looks off.
- [ ] **Step 4:** Commit "Home: Up next hero, Messages card, game row, level strip (dark)".

### Task 3: Chat themes go dark (Instagram style)
**Files:**
- Modify `messages/themes.js`: every theme `dark: true`, `bg '#0b0a0f'`, `theirs '#26232c'`; candy `mine ['#a033ff', '#6a4dff', '#2f7bff']`.
- Modify `messages/logic.mjs` `paletteFromPixels`: add a `forceDark` option. The app always passes `true`.
- Modify `messages/messages.css`: black glass header and composer, the `#1f1d24` pill.
- Test: `tests/messages.test.js`.

- [ ] **Step 1:** Write the tests (importing themes.js via a dynamic import in the test):
  - every theme is `dark === true`;
  - `contrast('#f5f3f7', theme.theirs) >= 4.5`;
  - `contrast('#ffffff', each mine colour) >= 3.0` (gradient bubbles carry white text; Instagram parity);
  - `paletteFromPixels(white, { forceDark: true }).dark === true`, and `textTheirs` passes 4.5 on `theirs`.

  Run. Expected: FAIL.
- [ ] **Step 2:** Implement.
- [ ] **Step 3:** Run the tests. Expected: PASS. Take chat screenshots.
- [ ] **Step 4:** Commit "Chat: dark, Instagram-style themes".

### Task 4: The inbox
**Files:**
- Modify `index.html`: inside `#dm-root`, before `.dm-app`, add `<section id="dm-inbox">` with:
  - a header "Messages";
  - `#inbox-total` ("1,240 messages · since 27 Oct");
  - `#inbox-row` (button: face with ring, name, `#inbox-line`, unread dot);
  - `#inbox-reply` (quick reply form).
- Modify `messages/app.js`:
  - `view` state `'inbox' | 'thread'`;
  - `showInbox()` and `openThread()` (slide animation, or a view transition when available);
  - `looking()` requires `view === 'thread'`;
  - `D.setHereFn(() => shown && view === 'thread' && !document.hidden)`;
  - `#btn-back` → `showInbox()`;
  - `renderInbox()` on every data change;
  - export via the api: `openThread()`, `showInbox()`, `view()`.
- Modify `hub/hub.js`:
  - `#chat` → inbox;
  - `history.pushState` when opening the thread, so the browser Back returns to the inbox;
  - entering Chat from the nav always shows the inbox;
  - leaving the thread for another section counts as leaving (as now).
- Modify `messages/messages.css`: inbox styles. Laptop ≥ 900: inbox as a 360 px left column next to the thread, with the row highlighted while the thread is open; the empty thread area shows "Pick a chat" when the thread is closed. Phone: one view at a time.

- [ ] **Step 1:** Add to `fixes.mjs`/`shoot.mjs`:
  - (a) nav Chat → the inbox is visible, the thread is hidden on the phone, and **no** `dm_read` RPC fires even with unread messages;
  - (b) the inbox shows "messages" and a count;
  - (c) clicking the row → the thread is visible, then `dm_read` fires;
  - (d) the back button → the inbox; browser `goBack()` from the thread → the inbox (hash `#chat`);
  - (e) the presence track log is `false` on the inbox and `true` in the thread;
  - (f) the inbox quick reply sends (`dm_send`);
  - (g) `messages.html` → the inbox.

  Run. Expected: FAIL.
- [ ] **Step 2:** Implement.
- [ ] **Step 3:** Run. Expected: all PASS at 1440 and 390. Take screenshots.
- [ ] **Step 4:** Commit "Chat: an Instagram-style inbox before the conversation".

### Task 5: Games, Trophies, Rivals, You and login in the dark look; final pass
**Files:**
- Modify `hub/shell.css`: the style-B override layer uses dark surfaces (`--surface`, `--edge`, `--text`); game art stays bright; medals keep gold; the You "Background" picker shows accent swatches.
- Modify `index.html`: version bumps.

- [ ] **Step 1:** Extend the contrast check to `#play`, `#trophies`, `#rivals` and `#me`. Run. Expected: FAIL.
- [ ] **Step 2:** Implement.
- [ ] **Step 3:** Full run:
  - `SHOTS=home,play,trophies,rivals,me,chat,photo,boot,flow` at 4 sizes;
  - `node fixes.mjs`;
  - `node reduced.mjs`;
  - `node --test tests/*.test.js`.

  Expected: all PASS, no page errors.
- [ ] **Step 4:** Commit "Games, Trophies, Rivals and You in the dark look".
