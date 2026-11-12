# 🍦 Sweet Revenge

A private little game collection for a few friends. It's a static site (GitHub Pages), and players connect through encrypted messages relayed by a public MQTT broker. Built for laptops first, and it works on phones too.

## Getting in
Open the site and log in with your secret name and password. Ask the person who set it up for these. You stay logged in on that device. Pick a game from the home screen, or paste a friend's room code into **Got a code from a friend?** and you'll land in the right game.

## 🃏 Plus Four (the mean one)
Match the colour or the number and be the first to get rid of every card.
1. **New game** makes a room. Share the code (it starts with P). 2–4 players, and you can fill empty seats with bots. **Practice against a bot** needs no friend and no internet room.
2. On your turn, click a glowing card to play it. Can't play? Click the deck (or **Draw**) to take one. If it fits, you can play it straight away or **Keep it**.
3. Wild cards pop up a colour picker: Cherry, Sunny, Mint or Sky.
4. On a laptop: **← →** pick a card, **Enter** plays it (or opens the chat when no card is picked), **D** draws, **P** keeps a drawn card, **O** shouts Ouch, **C** catches, **1–4** pick a wild colour.

The cards: four colours, each with 0–9, Skip, Reverse and +2, plus Wild and Wild +4 (108 cards). With two players, Reverse works like Skip.

House rules: **+2s and +4s stack.** A +2 can go on a +2, and a +4 can go on either; a +2 can't go on a +4. The pile of penalties keeps growing until someone can't stack, and they take the lot. A Wild +4 can be played any time.

**Ouch!** When you're down to one card, hit Ouch (or press O) before the next player moves. You can also hit it just before playing your second-to-last card. If you forget, anyone can hit **Catch!** and you draw 2. Bots usually remember, and they will catch you.

At the end: everyone's leftover cards are shown, plus awards (Card Hoarder, Stack Lord, Caught Napping, Wild Child) and a rematch button.

## 🖍️ Doodle Duel (the quick one)
One player secretly draws a word, everyone else races to guess it.
1. **New game** makes a room. Share the code (it starts with D). 2–4 players.
2. The host picks turns each, time to draw and the word packs: *Easy peasy*, *Silly stuff*, *Desi*, or your own **Inside jokes**.
3. The drawer picks one of three words. Everyone else types guesses. **Wrong guesses pop up on the canvas for everyone to see.**
4. Faster guesses score more. The drawer scores for every person who gets it. Letters appear as hints halfway through.
5. After each drawing, stamp it: MASTERPIECE, WHAT IS THIS, MY EYES, 10/10.
6. At the end: a podium, silly awards (Mind Reader, Picasso, Wild Guesser, Modern Artist, Clutch Master) and a gallery of every drawing with the best wrong guess. Save the ones worth framing.

**Chaos twists** (on by default) make some rounds harder: 🙈 the drawer is blindfolded, 🪞 the pen is mirrored, 👻 ink disappears, 🫨 wobbly hand, 📏 straight lines only.

**Three ways to draw** (no mouse needed): **⌨️ Etch** draws with the arrow keys like an etch-a-sketch (Shift = faster, Space lifts the pen, 4–9 pick colours), **📍 Dots** draws a straight line from each click to the next (Enter or a double-click finishes), and **✏️ Free** is classic freehand. Etch is the default on laptops, Free on phones and tablets.

Drawing tools: 10 colours, 3 brush sizes, fill bucket, eraser, undo and clear. On a laptop: Ctrl/Cmd+Z undoes, 1–3 change the brush, E is the eraser, F is fill.

## 🐍 Snakes & Ladders (the screamy one)
Roll (Space or tap the die), climb ladders, slide down snakes, exact roll to finish on 100. A 6 rolls again. **Land on a friend to bonk them** back to the foot of the last ladder they climbed. Room codes start with S. 2–4 players, bots, practice mode.

## 🎲 Ludo (the long one)
1. **New game**, share the code, and fill empty seats with bots if you like. 2–4 players; with 4 you can play **Teams (2 v 2)**.
2. Tap the dice to roll, then tap a glowing piece. On a laptop: **Space** rolls, **1–4** moves a piece, **Enter** jumps to the chat.
3. Chat (docked beside the board on a laptop), emoji reactions, stickers and hold-to-talk voice notes.

Rules: you need a 6 to bring a piece out; a 6 gives another roll, but three 6s in a row skips your turn. Landing on an opponent sends them back to base (💥 BONK!) and gives you another roll. ★ squares are safe, and teammates never bonk each other. You need the exact number to get home. First to get all 4 pieces home wins; in teams, both partners must finish.

## If someone leaves
In every game the host's browser runs the game and everyone else keeps a copy. If the host leaves, the next player in seat order takes over automatically and the others reconnect to them. In Ludo and Plus Four a bot plays for anyone who drops out, and the home screen offers **Back to your game**. In Plus Four the next player in line keeps a private backup of the game so they can take over. In Doodle Duel, the round that was being drawn is skipped and the next one starts.

## Chat (every game)
Every game has the same chat: messages, game-specific stickers, an emoji wheel (tap it, or press and slide to an emoji) and hold-to-talk voice notes. On a wide laptop screen it's docked beside the game in Ludo and Plus Four; otherwise the **Message** button opens it. In Doodle Duel, anything you type in the chat while someone is drawing counts as a guess, so nobody can spoil the word.

## Your look
Tap your avatar to pick an avatar and a colour palette (Sunset, Lagoon or Lemonade). It applies to every game.

## History (saved to the database)
Typed chat messages, stickers and every finished game (players, winner, stats, plus every Ludo bonk and Plus Four bomb) are saved in a **Supabase** Postgres database. Voice notes and emoji reactions are never saved. The site stays static; browsers talk to Supabase directly with the publishable key, which is safe to be public:
- **Reading** needs a login, and only friends can log in.
- **Writing** goes through checked database functions (`save_game`, `save_chat`, `store_progress`, `update_me`); the tables can't be written to directly.
- Saves wait in an outbox on the device, so a game finished offline is sent the next time a page opens.
- The home screen opens instantly with what the device saw last time, then swaps in fresh data. New games and trophies arrive live (Supabase Realtime) instead of by polling.
- Levels and trophies are worked out in the browser from your history (`shared/progress.mjs`).
- **Keep-alive:** free Supabase projects pause after a week without activity, so a GitHub Action (`.github/workflows/keepalive.yml`) calls the database's `ping()` once a day.
- The whole database setup is in `supabase/schema.sql`. More in `docs/DATABASE.md`.

## How logins work
Supabase Auth, with a name and password. Only the friends listed in the `players` table can have an account; the database refuses any other sign-up. The first time a friend logs in after the move to Supabase (13 Nov 2026), the database checks their password against the old login and creates their account with that same password, so nobody had to sign up again. You stay logged in on each device for weeks.

In a game room, the host checks each friend who joins by asking Supabase who their login belongs to (`checkProof` in `shared/core.js`), so changing your name or password never locks you out of a room.

## Project layout
- `index.html`, `hub/`: the Sweet Revenge front door, with login and the game picker. The logo is an inline SVG in `index.html`.
- `supabase/schema.sql`: the database (tables, security rules and functions)
- `.github/workflows/keepalive.yml`: the daily keep-alive ping
- `shared/`: design system (`base.css`), login, icons and profile (`core.js`), networking (`net.js`), the chat every game uses (`chat.js`, `chat.css`), saving history and your profile (`records.js`), levels and trophies (`progress.mjs`), sound clips player (`sound.js`), and card and menu sounds (`sounds/`, CC0 from Kenney)
- `doodle.html`, `doodle/`: Doodle Duel (`logic.js` is the pure, tested part; `words.js` has the word packs)
- `plusfour.html`, `plusfour/`: Plus Four (`rules.js` is the pure, tested part; `cards.js` draws the cards and moves them)
- `ludo.html`, `ludo/`: Ludo (`rules.js` is the pure, tested part)
- `docs/`: `PROGRESS.md` (the games, levels and trophies) and `concepts/`, the design mockups the interface was chosen from

## Running locally
Serve the folder with any static server, for example `python -m http.server 8765`, and open it in two tabs. Run the tests with `node --test tests/*.test.js`. Nothing needs installing.

To add a friend, add a row to the `players` table with their login name (lowercase) and display name, and set `legacy_hash` to `sha256(sha256("name:password"))` (hex). Their account is created the first time they log in with that password.
