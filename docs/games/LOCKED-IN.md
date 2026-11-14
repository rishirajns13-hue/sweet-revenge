# Locked In: design

_A two-player co-op escape adventure in 3D for Sweet Revenge (started 14 Nov 2026). "Locked In" is a working title._

## The pitch
You both wake up in different wings of the Hotel Halfway, an old hotel owned by an eccentric puzzle-maker. Each of you sees clues the other can't. Talk it through, pass things through the old dumbwaiter, and get out together before dawn. You only meet again in the last chapter.

It's built on what makes couples' co-op games work (It Takes Two, Portal 2 co-op, We Were Here):
- equal roles;
- something new every chapter;
- information that is truly split between you;
- puzzles designed around *what they make you explain*.

## Controls (laptop)
- **Walk:** W A S D or the arrows. **Run:** hold Shift. **Hop:** Space.
- **Camera:** drag the mouse, or Z / C to turn it; scroll to zoom.
- **Use or inspect:** E, or click the glowing thing.
- **Inspecting:** drag or W A S D to turn the object, scroll to zoom, E or Esc to put it back.
- **Emotes:** 1 nods, 2 shakes your head. **Pause:** Esc. **How to play:** H or the "?" button.

## Your look
Pick **Critter** or **Human** (two separate options).
- **Critter:** your own Sweet Revenge critter in 3D. The face comes from the same art, with 3D ears, horns and hats, and it animates in code.
- **Human:** a Kenney Mini Character, with 12 styles. You recolour skin, hair, top and bottom, and can add glasses or sunglasses.

The look is saved on this laptop under `li-look`. It moves to your profile in L1.

## How it's built
- `lockedin.html` is the only page that loads three.js (0.180 from jsDelivr through an importmap) and the shared 3D engine, so the rest of the site stays light.
- **The shared 3D engine (`shared/3d/`), reused later by the Island:**
  - `stage.js`: renderer, quality levels and a governor that steps quality down when frames drop.
  - `assets.js`: models, cached and kept in a versioned Cache Storage bucket.
  - `controller.js`: movement and collision; pure, and tested by `tests/controller.test.js`.
  - `camera.js`, `input.js`, `interact.js`: the glow, the E prompt and inspect.
  - `people.js` and `critters3d.js`: the two character types.
  - `textures.js`: painted wallpaper, wood, carpet, marble and paper.
- **The game:** `lockedin/builder.js` (rooms in code, with static pieces merged by material), `lockedin/levels/*.js`, `lockedin/game.js` and `lockedin/lockedin.css`.
- **Assets:** CC0 Kenney models in `assets/3d/` (about 3.5 MB, licence in `assets/3d/LICENSE-kenney.txt`) and recorded CC0 sounds in `shared/sounds/lockedin/`.

## Performance (measured on this laptop's Intel UHD, 1440×900)
| Graphics | fps | 95th-percentile frame | Draw calls |
|---|---|---|---|
| Auto, starts at Low on integrated GPUs | 60 | 17 ms | 134 |
| High / Ultra (bloom) | 46 | 34 ms | 150 |

The JS heap is about 17 MB, and loading reaches the menu in about 3 s.

Other pages were compared against a baseline taken before any 3D work: they make the same requests and download the same bytes, and none of them loads a 3D file.

## Phases
- **L0** (done): the lobby to explore, characters and the creator, controls, inspect, inventory, How to Play, the quality governor.
- **L1:** Chapter 1 "Check-In", online for two:
  - rooms with K codes, chat, a 📸 snapshot of your view, 📍 pings, the dumbwaiter;
  - a hub card, the DB kind `lockedin`, and your look saved in your profile.
- **L2:** Chapter 2 "Kitchen & Boiler", hints, checkpoints and resume.
- **L3:** Chapter 3 "Hall of Mirrors": mirrored rooms and pushing furniture.
- **L4:** Chapter 4 "Ballroom & Radio Room": a melody only one of you can hear.
- **L5:** Chapter 5 "Rooftop": together at last, then the balloon escape, credits, trophies and a final polish.
