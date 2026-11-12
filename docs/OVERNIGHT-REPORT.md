# Overnight report (12 Nov 2026)

What happened while you slept. Everything listed as **live** is on the site and tested; anything that isn't is listed under "Not done / rough".

## How I worked
- Three helpers built the new games at the same time, each in its own copy of the project. I worked on the design system and the "later" fixes in the meantime, then merged, tested and published.
- My plan, critiqued and revised before starting:
  - **"Install design skills":** the design guidance was already set up on this machine (frontend-design and the global UI/UX Pro Max script). I used those rather than install anything into the project, per your "no project installs" rule.
  - **Risk of over-designing:** you said it's a private, cozy party-night game, so I kept the background, logo, colours and Ludo as they are, and changed what read as AI-made: the generic fonts, the emoji avatars, the flat chat and missing in-game rewards.
  - UI/UX Pro Max's top font suggestion was exactly the pair the site already used (Fredoka with Nunito). That's a big part of why it felt templated, so I went with a chunkier, more game-like pair.

## Done: design
- **Avatars are drawn critters now**, not emoji: 12 sticker characters (Cool Scoop, Sweetheart, Brainy, Rodeo, Whiskers, Bamboo, Sly Fox, Boo, Hopper, Sparkle, Stripes, Inky), plus a little robot for bots.
  - Each has moods (happy, cheer, sulk, smug, sweat) and blinks.
  - They're used on the home screen, the profile picker, Rivals, chat, and the seats in Ludo, Plus Four and Doodle Duel.
  - Saved choices carry over: each critter is stored under the old emoji, so nobody loses their pick.
- **Type:** Lilita One (chunky, game-poster) for titles and big moments, Baloo 2 (rounded, friendly) for body text. The logo is unchanged.
- **Chat:**
  - Comic speech bubbles with the sender's critter beside them, runs from one sender grouped together, and tilted stickers.
  - A new "{name} is typing…" indicator with bouncing dots.
- **In-game achievements:** every game's end screen shows a rewards strip:
  - "Tallying your XP…", then **+XP**;
  - the bar filling up;
  - **Level up!** when it happens;
  - any trophies just unlocked, popping in as gold medallions, with confetti.
- **Home screen reactions:** your critter's face changes with the mood. It cheers after a win, sulks after a loss, flexes for trophies, and on Rivals the leader looks smug while the one behind sweats.

## Done: the "later" list
- **Saves are never lost:** chat and finished games wait in an outbox on the device until the server confirms them, and get resent next time any page opens. This fixes limitation #7 in `docs/NETWORK-AND-DATABASE.md`.
- **Bridge budget:** the relay bridge naps after at most 8 minutes, and junk messages no longer keep it awake (#8, #11).
- **Network notes:** `docs/NETWORK-AND-DATABASE.md` (for our next chat) is committed.
- **Database:** now accepts the new games (`snakes`, `race`) and a new hit type (`splat`, for Sugar Rush freezes and splats). The migration was applied to `production`; it only widens what's allowed.
- **Trophies:** four new ones:
  - 🐍 Slippery Slope: 3 snakes in one game.
  - 🪜 Sky High: a 30+ square ladder.
  - 🏁 Photo Finish: win a race by under 0.5 s.
  - 🥶 Brain Freezer: 10 freezes or splats.
  - Also: All-Rounder now needs a win in every mini-game, and freezes and splats give XP.

## New games (live)
### 🐍 Snakes & Ladders
- 2–4 players, with bots or practice against one.
- A 10×10 board with 8 chunky cartoon snakes and 8 ladders.
- You need the exact roll to finish, and overshooting bounces you back. A 6 rolls again, up to 3 in a row.
- **Revenge twist:** land on a friend and they get bonked back to the foot of the last ladder they climbed.
- Tokens hop square by square, ease up ladders and slide along the snake's curve. Bonks fly back with a "BONK!".
- End screen awards: Snake Charmer, Ladder Climber, Bonked Most, Revenge Dealer, Lucky Sixes.
- **Checked:** 30 seeded bot-only games each for 2, 3 and 4 players finish. In a real browser: the board, a practice game, the end screen with rewards, and a 390 px phone.
- **Not checked:** two real devices playing online. It uses the same proven room code as Plus Four.

### 🏎️ Sugar Rush (original candy kart race)
- 2–4 racers plus bots, 3 laps. Steer with the arrows or WASD, Space uses your item. On phones it accelerates by itself and shows touch buttons.
- Items:
  - 🍦 **Brain Freeze** slows the racer directly ahead.
  - 🍬 **Jelly Splat** drops a sticky puddle behind you.
  - ✨ **Sprinkle Boost** gives a burst of speed.
  - Whoever is in last place gets better items (the revenge rule).
- **Lag-proof:** your own kart is simulated on your device, so it never stutters. Other racers are smoothed.
- **Checked:** I drove a practice race in a real browser (timer, items, bots freezing each other, minimap) at laptop and phone size, with no errors. In headless simulations, bots finish 3 laps from every grid slot.
- **Not checked:** two real devices racing online.
- **Known gaps:** if the host leaves mid-race, the race ends. Karts pass through each other (no bumping).

### 🍦 Scoop Stack (the surprise third game)
- A scoop swings over your cone and you drop it with Space or a tap. Only the overlap stays, and a bad miss splats (3 lives).
- Dead-centre drops are **Perfect!** and grow the scoop back. 3 in a row charge a **Wobble** that sends the tallest rival's swing haywire for 4 seconds.
- A 90-second round; the tallest tower wins.
- **Lag-proof:** everyone plays their own tower, and only heights are shared.
- End screen awards: Tower Boss, Perfectionist, Wobble Master, Floor Dessert. There's a new 🍦 **Tower Boss** trophy for stacking 20 in one round.
- **Checked:** practice in a real browser at laptop and phone size, and a two-player online round.

## Online play: tested with two browsers
I ran two separate headless browsers on this laptop, one logged in as Ammu (host) and one as Panchara Kunju (guest). They connected through the real public relay, like two homes would:
- **Snakes & Ladders:** room created, guest joined, turns alternated, and both screens showed the same board (Ammu on 7, Kunju on 14, a snake slide included). No errors.
- **Sugar Rush:** each saw the other's kart racing beside them in real time. No errors.
- **Scoop Stack:** a full round with both players dropping scoops, the host ending it, and podium, awards and rewards on both screens. No errors.

## Also improved
- **Sugar Rush bumper karts:** karts now bump off each other instead of driving through. Each player's own kart gets nudged, so it stays lag-free.
- The game cards on the home screen centre their last row; Plus Four no longer says NEW; small text and plural fixes.

## Not done / rough
- **No host handover in Sugar Rush or Scoop Stack.** If the host closes their tab mid-round, the round ends for everyone; a rematch starts a fresh one. Ludo, Plus Four and Snakes do hand over.
- **No joining mid-round** in Sugar Rush or Scoop Stack: a late player waits for the next round.
- **Sugar Rush trusts each player's own finish time**, which is fine between friends.
- **Not tested on real phones or real touch screens:** I checked phone-sized layouts in an emulated browser, but no actual device.
- **The new sounds were chosen by name, not by listening.**
- **Network/database decision is still open:** see `docs/NETWORK-AND-DATABASE.md`. On Jio, scores may take up to a minute to appear after a quiet spell.
- **Storage:** you mentioned your disk filling up. I've noted it for next session (it's in my memory). Likely suspects are the helper copies of the project in `.claude/worktrees/` and `node_modules`. I didn't delete anything of yours.

## Things to look at first in the morning
1. Open the site and play a quick practice round of each new game.
2. Check the critters: are there any you'd like changed?
3. Next session: the network and database discussion (`docs/NETWORK-AND-DATABASE.md`).
