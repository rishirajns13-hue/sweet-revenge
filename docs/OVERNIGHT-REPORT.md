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

## New games
_(filled in below when each one is merged and tested)_

## Not done / rough
_(filled in at the end)_

## Things to look at first in the morning
1. Open the site and play a quick practice round of each new game.
2. Check the critters: are there any you'd like changed?
3. Next session: the network and database discussion (`docs/NETWORK-AND-DATABASE.md`).
