# 🍦 Sweet Revenge: games, levels and trophies

**Sweet Revenge is one app with a few proper games inside it.** One login, one profile, one level and one trophy shelf follow you from game to game. Every game feeds the same history: who won, who bonked whom, who bombed whom.

**Games now:** 🎲 Ludo (the long one) · 🃏 Plus Four (the mean one) · 🖍️ Doodle Duel (the quick one) · 🐍 Snakes & Ladders (the screamy one) · 🚪 Two Peas (3D co-op platformer, rebuilt from Sticky Situation) · 🏝️ Island Duel (3D slingshot duel) · 🟡 Plonk! (four in a row, 3D). The last three names are working titles.

**The lineup (decided 14 Nov 2026, at most 10 games):** the seven above, then Our Little Island (cozy 3D island, with a pixel mural), Locked In (3D escape story, last), and one more chosen at the end. Sundae Bomb was removed on 14 Nov 2026; Sugar Rush and Scoop Stack on 13 Nov. Fair play notes: docs/FAIRNESS.md.

**Not saved to the history yet:** Island Duel and Plonk! need two new game kinds in the database (supabase/pending/add_duel_four_kinds.sql, waiting for approval).

## Levels
You earn XP in every game, and it all adds up to one Sweet Revenge level. The level shows next to your avatar everywhere.
- **XP:** play a game +10 · win +25 · each bonk +3 · each bomb +1 per card · Doodle +1 per 20 points. Practice games against bots give no XP and don't count toward trophies.
- **Level titles:** Sprinkle → Single Scoop → Double Scoop → Waffle Cone → Sundae → Banana Split → Brain Freeze 🥶 → Sweet Revenge Royalty 👑
- A level-up gets confetti and a toast on the home screen.

The code that works all this out is `shared/progress.mjs`; the numbers there are the real ones.

## Trophies
| | Name | How you get it |
|---|---|---|
| 🍒 | Sweet Victory | Win any game |
| 🎟️ | Regular | Play 10 games |
| 💥 | First Bonk | Bonk someone in Ludo |
| 🔨 | Bonk Machine | 50 bonks, all time |
| 😈 | Sweet Revenge | Bonk back whoever bonked you, in the same game |
| 📦 | Special Delivery | Drop a bomb of 8+ cards in Plus Four |
| ↩️ | Return to Sender | Get bombed, then bomb them back in the same game |
| 🧨 | Bomb Squad | 25 bombs, all time |
| 🔥 | On Fire | Win 3 games in a row |
| 🎪 | All-Rounder | Win at least once in every game |
| 🫠 | Punching Bag | Get bonked 10 times in one game |
| 🗣️ | Chatterbox | Send 100 chat messages |
| 🧠 | Mind Reader | Guess a Doodle in under 5 seconds |
| 🐍 | Slippery Slope | Slide down 3 snakes in one game |
| 🪜 | Sky High | Climb a ladder 30+ squares long |
| ⭐ | Not a Scratch | Clear a stage of Two Peas without anyone going splat |
| 🫛 | Two Peas in a Pod | Clear 5 stages of Two Peas together |
| 🥊 | Grudge Champ | Win a best-of-5 grudge series against a friend (first to 3, across all games) |

## Still to decide
- (Decided 13 Nov: practice games count for neither XP nor trophies.)
