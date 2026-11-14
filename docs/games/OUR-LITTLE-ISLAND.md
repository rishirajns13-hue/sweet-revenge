# Our Little Island: design (draft, 14 Nov 2026)

_The cozy one. A small island that belongs to the two of you. It keeps living when you're apart, and it's always nicer when you're both there. This is a draft for the user to react to before building; parts are taken from the 14 Nov plan (I1–I6)._

## Why it fits
- There are no fail states, no timer and no pressure. It's for between study sessions: hop in for 3 minutes, water the garden, leave a note.
- **Apart:** whatever one of you does stays for the other one to find (a note in the mailbox, a flower that grew, a mural half painted).
- **Together:** you walk around side by side, and the walkie-talkie and chat work as in every game.
- What we learned from cozy hits (Stardew, Animal Crossing): a real clock, small daily rewards, progress you can see, and a reason to come back tomorrow.

## The world
- A small 3D island, about 40 × 40 m, built from the same CC0 kits (Kenney Nature and Pirate kits, Quaternius Stylized Nature).
  - It uses the `shared/3d` engine from Locked In: WASD to walk, a third-person camera, E to use things.
  - Your Human or Critter from Locked In.
- **Time:**
  - Day and night follow real India time, with sunrise and sunset colours.
  - Seasons follow the month: monsoon rain from June to September, a cool winter haze from December to January.
  - The weather is seeded by the date, so both of you see the same sky.
- **Places:**
  - the house (inside, decorated together on a grid);
  - the garden;
  - the beach and the pier (fishing);
  - the mailbox;
  - the mural wall;
  - a hilltop bench for sunsets.

## Things to do (one phase each)
1. **I1, walk together:** the island, day and night, weather, the two of you walking around and sitting on the bench, waving, stickers.
2. **I2, garden:** plant seeds. They grow over real hours and watering helps. Harvest gives coins and flowers for the house.
3. **I3, the house:** place furniture on a grid together (Kenney Furniture Kit, already in the repo). Coins from the garden buy new pieces.
4. **I4, Pixel Mural:** a 32 × 32 wall you paint together, live or apart.
   - *Pixel-by-number:* the cells show numbers, and clicking or dragging fills the right colour with a soft pop.
   - *Free paint.*
   - Finished murals hang as framed pictures in the house.
   - It's stored as one small array, saved after every change.
5. **I5, fishing, shells and a shared journal:** a museum shelf of everything you've found together.
6. **I6, notes and gifts:** leave a note or a flower in the mailbox. A photo mode sends a picture to Messages. Weekly "island wishes" (build a bridge, plant 20 flowers) are done together.

## How it's stored (needs new database tables; ask before creating them)
- `island`: one row per pair. It holds the state as JSON (garden plots, furniture, mural cells, journal) and `updated_at`.
- `island_act(kind, payload)`: a security-definer RPC that checks the action and stamps the server time, so plants grow by the real clock and nobody can fake it.
- **Live:** when both of you are on, a room with a fixed code from the pair (the first one in hosts). Moves stream like in Two Peas.

## Performance rules (her laptop may be slower)
- Instanced vegetation, a 2048 shadow map at most.
- The quality governor from the stage, with the low tier on integrated GPUs.
- Under 150 draw calls; the first load under 5 MB.
- It never loads on Home or in chat.

## Questions for the user before building
1. Does the plan above feel right, or do you want fewer activities and more polish (for example walk + garden + mural first)?
2. Should the island show in Home (a tiny preview of today's garden), or only open as a game?
3. Is it OK to add the `island` table to the database (one row for the two of you)?
