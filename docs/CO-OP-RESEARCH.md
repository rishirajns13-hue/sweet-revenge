# Co-op duo games: research for our next game

_13 Nov 2026. We're designing an original two-player game for Sweet Revenge, inspired by how these games work. We're not copying any one of them: no names, characters, art, levels or exact rules. Nothing is built yet._

## The game you mentioned
**BOMBANANA!** (Lefto Studio, released 2 Sep 2026, 96% positive on Steam) is a three-player bomb defusal game based on the three wise monkeys:
- one monkey **can't see** and is the one touching the bomb;
- one **can't speak** and holds the manual;
- one **can't hear** but can see and talk.

The game imposes no way to communicate, so players wave, shout and throw bananas. The fun comes from **splitting the senses and the information so nobody can win alone**.

## The family it belongs to
| Game | Players | The core trick | What we can learn |
|---|---|---|---|
| Keep Talking and Nobody Explodes | 2+ | One sees the bomb, the other(s) read a manual they can't show | Information split + time pressure = shouting and laughing |
| We Were Here (series) | 2 | Separate rooms, walkie-talkie; each sees clues the other needs | Describing what you see is the game |
| Operation: Tango | 2 | Spy/hacker on different screens, sharing codes and maps | Two different views of the same puzzle |
| Tick Tock: A Tale for Two | 2 | Each screen shows half of every clue | Very cheap to build: two images, one answer |
| Chained Together | 1–4 | Players chained, climbing together | Physical dependence makes funny failures |
| Spaceteam | 2–8 | Shout instructions for controls on someone else's screen | Chaos and fast talk; works on phones |
| Overcooked / Unrailed | 2–4 | Real-time shared tasks under a timer | Fun, but needs low-latency sync (harder for us) |
| It Takes Two / Split Fiction | 2 | Two different abilities that combine | Asymmetric powers, but a big 3D production |

**What works for two friends:** each player sees or controls something the other needs; there's a timer or a funny penalty; rounds are short (2–5 min); and failures are hilarious, not frustrating.

## What fits our setup
Sweet Revenge runs in the browser, laptop-first, with rooms over the encrypted relay we already use.
- **Easy:** turn-based or slow real-time puzzles, separate screens per player, shared timer, generated rules each round (so it never repeats), stickers and voice notes already built.
- **Medium:** live voice. You can just be on a phone call. Or we add push-to-talk walkie-talkie inside the game (we have voice notes; live audio would need WebRTC, signalled over our relay).
- **Hard:** fast real-time action with physics shared between two browsers.

## Original concepts for us (pick one to design in detail)
1. **Sundae Bomb** (closest to what you asked for)
   - **The setup:** a ticking ice-cream machine is about to explode. One player sees the machine (wires, flavour dials, sprinkle buttons, a dripping timer) but has no manual. The other has the manual (a generated booklet of silly rules: "If there are two pink wires and the cone is waffle, cut the last one") but can't see the machine.
   - **Twist rounds** borrow the "senses" idea: in some rounds the reader can only answer with critter emotes, or the operator's screen goes dark every few seconds ("brain freeze").
   - **Swap roles** every bomb. A best-of series feeds the grudge tracker.
2. **Lights Out Heist**
   - One player walks a dark vault maze and sees only a few tiles around them.
   - The other sees the full map with guards and laser timing, but only from a stolen security camera that switches rooms.
   - Steal the golden scoop together.
3. **Sense Swap**
   - Each round, each of you gets one channel: draw only (Doodle Duel's canvas), emoji only, or voice only.
   - Shared goal: pick the right 3 items from a grid of 20 before time runs out.
   - It reuses a lot of what's already built.
4. **Two Keys**
   - A safe with symbols; each of you sees half of every symbol and half of the rules.
   - Tap in the right order together.
   - It's the cheapest to build and very replayable with generated puzzles.

My lean is **Sundae Bomb**: it's the experience you described, it suits two people perfectly, and the "senses" twists come in as round modifiers.

## Questions to settle before building
1. Will you play on a call (phone or Discord), or should the game have its own push-to-talk walkie-talkie?
2. How long per round: about 3 minutes (quick) or about 8 minutes (bigger bombs)?
3. Laptop-only, or should one role work well on a phone? The manual reader on a phone is a nice fit.
4. Should failing be cute (the machine sprays ice cream on both critters) and does a series count toward Rivals/XP?

## Sources
- [BOMBANANA! on Steam](https://store.steampowered.com/app/4656000/BOMBANANA/)
- [Notebookcheck: three monkeys defusing bombs](https://www.notebookcheck.net/Blind-deaf-and-mute-New-Steam-hit-96-positive-has-three-monkeys-defusing-bombs.1391805.0.html)
- [The Gamerz Theory on BOMBANANA!](https://thegamerztheory.com/article/2026-07-21_bombanana-play-as-the-three-wise-monkeys-trying-to-defuse-a-bomb)
- [GamesRadar: best co-op games 2026](https://www.gamesradar.com/best-co-op-games/1)
- [Operation: Tango](https://nodal.gg/game/operation-tango-1335790), [We Were Here Together](https://nodal.gg/game/we-were-here-together-865360), [Tick Tock: A Tale for Two](https://nodal.gg/game/tick-tock-a-tale-for-two-790740)
- [Chained Together (Wikipedia)](https://en.wikipedia.org/wiki/Chained_Together)
