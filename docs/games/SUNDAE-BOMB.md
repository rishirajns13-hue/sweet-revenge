# Sundae Bomb: design

_An original two-player co-op game for Sweet Revenge (13 Nov 2026). It's in the spirit of "one sees, the other knows" bomb games, with our own machine, rules and look._

## The pitch
A ticking ice-cream machine is about to blow. **The Operator** sees the machine but has no idea how to defuse it. **The Reader** has the rulebook but can't see the machine. Talk fast, or get covered in sundae. Swap roles every bomb.

## How a round goes
- **Players:** two humans in a room, using the same room codes as the other games (they start with B).
- **Bombs:** each bomb has 3 modules and a 3:30 timer, and 3 mistakes = SPLAT.
- **Same bomb for both:** both screens build it from a shared random seed, so each player sees their own half of the same bomb.
- **Who decides:** the host's browser judges every action (the same model as the other games).
- **Swapping:** after each bomb (defused or splatted), roles swap. A match is best of 3 bombs; the score is "bombs defused together".

## The machine (Operator's screen)
- **Labels on the case**, which the rules refer to:
  - the **batch code** (like `SR-4K7`; the last digit is odd or even);
  - the **cone** (waffle or sugar);
  - the **cherries** on top (0–3).
- **Module 1, Syrup Tubes:** 3–6 coloured syrup tubes (strawberry pink, mint, vanilla, chocolate, blueberry). Pull exactly the right one.
- **Module 2, Scoop Stack:** three scoops stacked on a cone, and four levers. The rulebook's recipe card says which lever to pull for that stack.
- **Module 3, Thermostat:** a thermometer showing a temperature, and a flavour label. Turn the dial to the target temperature the rulebook gives for that flavour (adjusted by cherries), then press SET.

## The rulebook (Reader's screen)
A booklet with one page per module, freshly worded each bomb ("If there is no pink tube, pull the second one…"). The Reader never sees the machine.

## Talking without a call (she prefers messages)
- **Operator callouts:** tap any part of the machine (a tube, a scoop, the thermometer, the batch code) to drop a one-tap callout into the chat, like "Tube 3: 🍫 chocolate" or "Batch: SR-4K7".
- **Reader pings:** tap a rule line to ping it to the Operator, who sees it highlighted.
- **Quick replies:** "Which tube?", "Say again", "DONE", "WAIT".
- **Walkie-talkie** (optional): hold a key to talk live, for when she's in the mood.

## Twists (from bomb 2 on)
- **Brain freeze:** every ~45 s, the Operator's screen fogs over for 3 seconds.
- **Emoji-only round:** the chat only allows emoji and callouts.
- **Melting timer:** each mistake speeds the clock up.

## The vibe
- Ice cream drips more as time runs out, the machine wobbles, and the ticking gets faster.
- **Defused:** confetti and both critters cheer.
- **SPLAT:** both critters get a scoop on the head, and the end screen shows "Defused by: …" or "Splatted by: …" (the action that blew it).

## Practice
**Solo training** shows the machine and the rulebook side by side, so one person can learn the rules. It gives no XP and doesn't count for trophies, like all practice.

## Build plan
1. `sundae/rules.js`: seeded bomb generator + rule checker, pure and unit-tested.
2. `sundae.html` + `sundae/game.js` + `sundae/sundae.css`: rooms (same pattern as Snakes), the two role screens, timer, strikes, swap.
3. Callouts/pings in the shared chat, plus quick replies.
4. Walkie-talkie: hold-to-talk live audio over WebRTC, signalled through the room (a shared module so other games can use it).
5. Home card, history (`kind: 'sundae'`), a co-op XP rule, trophies.
