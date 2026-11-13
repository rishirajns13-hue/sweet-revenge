# Sticky Situation: design

_An original two-player co-op climber for Sweet Revenge (started 13 Nov 2026). It's on the `sticky-situation` branch and not live yet._

## The pitch
Two critters are glued together by a stretchy gummy rope. Climb a giant birthday cake to the cherry on top, together. If one slips, the rope yanks the other down. If one holds on, the other can swing.

## The feel
- **Rope:** it stretches up to about 3.2 m with no pull, then pulls like gummy candy. It's springy, not rigid, so falls are funny rather than brutal.
- **Grab:** hold GRAB while touching a ledge and you stick to the frosting. Your partner can then dangle from you and climb past.
- **Jump:** jump, with coyote time and a jump buffer so it feels fair.
- **Checkpoints:** candle checkpoints on each cake layer, where you respawn after a long fall.
- **Moments to laugh at:**
  - one of you grabbing just in time and the other swinging like a pendulum;
  - both of you falling three layers because someone let go;
  - a bonus "who caused the fall" counter shown at the end.

## Building it in parts
1. **Physics core** (`sticky/physics.js`, pure and tested; done in this part): two critters, platforms, gravity, jumping, grabbing, the gummy rope, checkpoints.
2. **The cake level:** layers, frosting ledges, sprinkle hazards, a moving cake-stand turntable, candles as checkpoints, the cherry finish.
3. **3D view** (three.js): side-on camera that follows both, chunky toon cake, critters as the players' avatars, rope as a stretchy tube that thins as it stretches.
4. **Online:** each player runs their own critter. The partner's position streams over the room relay about 20 times a second, and the rope force is computed on each side from the latest positions. Rooms, chat and walkie-talkie work as in Sundae Bomb (codes start with G).
5. **Polish:** sounds, squash and stretch, a height meter, a "who caused the fall" counter, the end screen, history (`kind: 'sticky'`) and trophies.

## Status (13 Nov 2026)
Parts 1 to 5 are built on the `sticky-situation` branch. Still to do: hand-play tuning of the jump and rope, a real two-laptop climb. The database already accepts Sticky climbs, chat and challenges (migration `add_sticky_kind`, 13 Nov).

**Online, as built:** the host's browser is the referee (checkpoints, falls, win) and tells the guest; positions go over `link.sendFast` (unnumbered, newest wins), 20 a second on the direct link and about 7 over the public relay. `life` counts respawns so stale positions are dropped. Keys 1–4 send stickers (HOLD ON!, JUMP!, WAIT FOR ME, SORRY).

## Controls (laptop)
- **Move:** A/D or ←/→.
- **Jump:** W, ↑ or Space.
- **Grab:** hold Shift or J.
- **Shout:** 1–4 (online).
- **Talk:** the walkie-talkie is V.
