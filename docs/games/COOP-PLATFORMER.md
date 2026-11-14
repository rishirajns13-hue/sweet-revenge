# The co-op platformer (rebuilt Sticky Situation): design

_Started 14 Nov 2026. It replaces Sticky Situation, which had the right idea but looked flat._

**Name:** to be picked by the user. In the code it's `coop` (`coop.html`, `coop/`), and the page shows a working title until the name is chosen. Name ideas are listed at the end.

## The pitch
Two little heroes (your own critter, or your human from Locked In) get through short, clever puzzle stages that **only work together**. It's in the genre of Pico Park (stand on each other's heads, push the heavy block together, carry the key to the door), with original levels and original art. The art is Kenney's CC0 Platformer Kit in real 3D, viewed side-on.

## Rules of the world
- **Get both of you through the door.** Walk into the exit door and press ↑ (or W) to step in, and the same to step out. When both are in, the stage is cleared.
- **Heads are floors.** You can stand on your partner and get carried around.
- **Keys:** walk into the key to pick it up. Bring it to the lock block and the block opens.
- **Buttons (pressure plates):** a button holds its gates open only while someone, or a crate, stands on it.
- **Crates:** a small crate moves when one of you pushes it. A **heavy crate** only moves when you both push it the same way.
- **Springs** launch you up. **Spikes** and falling off the map send you back to the last flag.
- **World 2, the rope:** you're tied together by a stretchy rope. If one of you falls, the other one swings.
- **World 3, colours:** you're Pink and Blue. Pink goo is fine for Pink and deadly for Blue, and the other way round. Coloured walls only let their own colour through.
- **World 4, moving parts:** lifts that need a button held, platforms that slide, timed puzzles.

## Built for chat and the walkie-talkie
- No frame-perfect "jump at the same time" moments. Anything you do together has a generous window (at least half a second) or simply waits for you.
- Keys 1–4 send stickers: "HOLD ON!", "JUMP!", "WAIT FOR ME", "SORRY". Stickers, chat and the walkie-talkie work the same as in the other games.

## How it's built
- `coop/physics.js` holds the physics: pure, fixed 60 Hz steps, tile and box collisions, keys, buttons, gates, crates, the rope and colours. It's tested in node.
- `coop/levels.js` holds the stages as ASCII maps, plus a solution script for every stage. The tests replay each script with both players, so every stage is proven solvable.
- `coop/view.js` draws everything with three.js 0.180 on the shared `shared/3d` stage:
  - Kenney blocks for the ground and its edges; one instanced mesh per model, so there are few draw calls.
  - Props, a sky gradient and distant hills.
  - The players' 3D critters or humans.
  - A camera that keeps both of you in view.
- **Online:** each player runs their own hero, and the partner's position arrives about 20 times a second. The host is the referee for keys, buttons, crates, gates, flags and the exit, and sends their state with its own position. Rooms, chat and the walkie-talkie come from `shared/net.js` and `shared/chat.js`, as in the other games.
- **Couch:** two players on one keyboard (WASD and the arrows).
- **Low-end laptops:** the stage's quality governor applies. Static tiles are merged and instanced, and there's no post-processing on the low tiers.

## Name ideas (for the user)
Two Peas · Knot Together · Tag Along · Plus One · Hold the Door · Both or Nothing
