# Home screen redesign: a cosy party-game front door

**Date:** 12 Nov 2026
**Status:** built (index.html, hub/, shared/sound.js)

## Why
The first home screen with levels and history felt like a website: everything crammed on one page, nothing moving, and a small red light that didn't explain why the data was missing. The real data problem was the router's DNS blocking the API, not the database. The goal was a proper game feel that stays one click away from playing.

## Decided with the user
- **Feel:** a cosy party game. Playful and bouncy; things wobble and pop.
- **Who reacts:** the player's own avatar emoji. No new mascot.
- **Screens:** Play, Trophies, Rivals & History, switched like a game menu.
- **Sound:** a few quiet real clips (switching tabs, picking a game, trophy, level-up) with a mute button.
- **Keep:** the background, logo, colours and sticker style.
- **Anti-goal:** anything that makes getting into a game slower.

## What was built
- **Loading screen.**
  - Three scoops drop onto a cone as the steps finish: login, scoreboard, trophies.
  - The full version plays on the first open in a browser session and right after login. Returning from a game gets a quick version.
  - It waits at most 4 seconds for the scoreboard, then goes in anyway; the screens fill in when the answer arrives. *Update:* there's no warning card. The user asked for no unwanted messages, so being offline shows only as a small "Reconnecting" chip in the top bar.
- **Every network.** Blocked networks reach the API through the games' MQTT relays and a Neon bridge (`api/bridge.ts`); see the README.
- **Top bar.**
  - Logo and tab bar. Tabs dock at the bottom on phones. Keys 1, 2, 3 and ←/→ switch tabs, and the URL hash keeps the current tab.
  - Level chip (mini cone, level, thin XP bar), a live dot with a status popover, the sound toggle, and the profile avatar.
- **Play.**
  - A greeting with a big, idle-bobbing avatar.
  - Three floating, tilted game cards. Hovering wiggles them and animates their art.
  - Picking a game squishes the card, then a colour wipe runs from where you clicked before the game opens.
  - Also here: a record ribbon on each card, the resume banner, and a "Got a code?" ticket.
- **Trophies.**
  - A level card: big cone, title, striped XP bar.
  - Medallion badges with progress rings. Unlocked ones shine, unseen unlocks wear NEW ribbons, and clicking a badge flips it to show how to get it and when it was unlocked.
  - The tab shows a badge count of unseen unlocks.
- **Rivals & History.**
  - Versus cards: your avatar against theirs, tug-of-war bars for bonks and bombs. The leader gets a crown and a 😏, the one behind sweats 💦. Bots sit in a collapsed "Practice rivals" group.
  - History tickets whose stamps thump in each time you open the screen. New games drop in live.
- **Reactions.** Compared with what this device last saw (`sr-seen:<user>`):
  - a new win → cheer + "You beat X! 😈"
  - a new loss → sulk + "Revenge is coming…"
  - a trophy → flex + jingle + confetti
  - a level-up → cheer + jingle + confetti
- **Sounds.**
  - `shared/sound.js` (`createSamplePlayer`) was pulled out of Plus Four, which now uses it too.
  - The mute setting is shared across pages (`sr-muted`).
  - Clips are in `shared/sounds/ui-*.ogg` (CC0 Kenney Interface Sounds + Music Jingles; see `LICENSE-kenney-ui.txt`).
- **Server.** `/me` now records the visit (`players.last_seen`).

## My calls (not discussed)
- Tab bar position, the 6-second cap, and the minimum loading time (1.3 s full, 0.4 s quick).
- Which Kenney clips to use; chosen by name and length, not by listening.
- Rival avatars use the default avatar per account (custom avatars aren't stored in the database yet).
- Opening the Trophies screen marks new trophies as seen.
