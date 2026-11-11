# 🍦 Sweet Revenge: game plan & ideas

**Sweet Revenge is one game with mini-games inside it.** One login, one profile, one level and one trophy shelf that follow you from game to game. Every mini-game feeds the same history: who won, who bonked whom, who bombed whom.

**Mini-games now:** 🎲 Ludo (the long one) · 🃏 Plus Four (the mean one) · 🖍️ Doodle Duel (the quick one)
**Next mini-game:** 🐍 Snakes & Ladders

## ✅ Done: history is saved (11 Nov 2026)
Everything goes into the Neon database through a small API (`api/`). Each player's browser sends the finished game, and the database keeps one copy.
- **Chat:** every typed message and sticker, with who sent it, which game and which room.
- **Voice notes are NOT saved.** They stay temporary, like before. Emoji reactions aren't saved either.
- **Game history:** every finished game (practice included, marked as practice): players, winner, places, scores and each player's stats.
- **Bonks (Ludo):** every bonk, with who bonked whom.
- **Bombs (Plus Four):** every stacked +2/+4 pile someone had to take, credited to whoever stacked last, with how many cards it was.
- **Achievements:** the table is ready. Nothing unlocks yet; that's the next step.

## ✅ Done: home screen with levels, trophies and live history (12 Nov 2026)
The home screen now shows your level (an ice-cream cone that gains a scoop each level), XP bar, wins and losses, the Revenge board (who bonked and bombed whom), your last 12 games and the trophy shelf. It checks the database every 20 seconds: a green "Live" light means saving works, and new games, trophies and level-ups pop in with confetti. Levels and achievements are worked out from the saved history (`api/progress.mjs`), and each trophy is stored with the time it unlocked.

## Levels and achievements (live now; the numbers below are what the code uses)

### Levels
You earn XP in every mini-game, and it all adds up to one Sweet Revenge level. The level shows next to your avatar everywhere.
- **XP ideas:** play a game +10 · win +25 · each bonk +3 · each bomb +1 per card · Doodle: each correct guess +5. Practice games vs bots give half XP.
- **Level titles (ice-cream themed):** Sprinkle → Single Scoop → Double Scoop → Waffle Cone → Sundae → Banana Split → Brain Freeze 🥶 → Sweet Revenge Royalty 👑
- A level-up gets a big moment: confetti and a toast on the home screen. _Still to do: show it to everyone in the room, and a "+25 XP" on each end screen._

### Achievements (first list; all of these can be worked out from what's already saved)
| | Name | How you get it |
|---|---|---|
| 💥 | First Bonk | Bonk someone in Ludo |
| 🔨 | Bonk Machine | 50 bonks, all time |
| 😈 | Sweet Revenge | Bonk the person who bonked you last, in the same game |
| 📦 | Special Delivery | Drop a bomb of 8+ cards |
| ↩️ | Return to Sender | Get bombed, then bomb the same person back in the same game |
| 🧨 | Bomb Squad | 25 bombs, all time |
| 🔥 | On Fire | Win 3 games in a row (any mini-game) |
| 🎪 | All-Rounder | Win at least once in every mini-game |
| 🫠 | Punching Bag | Get bonked 10 times in one game (a funny one, not a shameful one) |
| 🗣️ | Chatterbox | Send 100 chat messages |
| 🧠 | Mind Reader | Guess a Doodle in under 5 seconds |
| 🍒 | Sweet Victory | Win any game |
| 🎟️ | Regular | Play 10 games |

### To decide together
- Do bonks and bombs against bots count, or only against each other? (For now everything counts, practice included; practice gives half XP.)
- Where it shows: a profile page with level, trophy shelf and "who bonked whom" all-time scores, plus a little "+25 XP" on every end screen.

## 💡 Old ideas list
_(Ideas from before. On 9 Nov 2026 we said none of these were the next pick; kept here for reference.)_

## 🏆 Top picks

### 1. Doodle Duel ⭐⭐⭐⭐⭐ 🛠 M
**Concept:** Pictionary for two. One person secretly gets a word and draws it on a shared canvas. The other watches the lines appear live and types guesses.
- **A round:** 60 seconds per drawing, then swap. The faster the guess, the more points for both. It's co-op, so you're chasing a high score together.
- **Why it's fun:** bad drawings are hilarious, and watching someone's mind go "wait… is that a cow or a car?" never gets old.
- **Twists:** a "custom words" pack made of your inside jokes, names and places you've been. "Hard mode": only straight lines, or the canvas slowly fades away. At the end you get a gallery of every masterpiece to save.

### 2. How Well Do You Know Me? ⭐⭐⭐⭐⭐ 🛠 S
**Concept:** Both of you answer the same question about *yourselves* in secret, then guess what the *other* person said. For example: "Your perfect lazy Sunday?", "What would you grab first in a fire?", "Rate pineapple on pizza 1–10".
- **A round:** 10 questions, then answers are revealed one by one with a drumroll. Matches burst into confetti. Misses trigger a big "😱 HOW DID YOU NOT KNOW THAT".
- **Why it's fun:** the reveals start conversations. It's half game, half "wait, really?!"
- **Twists:** you can write questions for each other. A final "sync score" with a silly title ("Telepathic Twins 🧠", "Total Strangers 🫣"). Multiple-choice and slider questions keep it quick.

### 3. Secret Signal (co-op word spy) ⭐⭐⭐⭐⭐ 🛠 M
**Concept:** Inspired by Codenames Duet. There's a 5×5 grid of words. Each of you sees a *different* secret key showing which words are "agents" (good) and which are "bombs". You take turns giving the other a one-word clue plus a number ("ocean, 2"), and they try to tap the right words.
- **Win:** find all 15 agents together before running out of turns. Tapping a bomb loses instantly.
- **Why it's fun:** lots of "how could you possibly link *banana* and *moon*?!" moments, and when a clever clue lands it feels amazing.
- **Twists:** themed word packs, a campaign map where each win unlocks a new city, and a "clue history" to laugh at afterwards.

### 4. Bomb Squad (asymmetric co-op) ⭐⭐⭐⭐⭐ 🛠 L
**Concept:** Inspired by Keep Talking and Nobody Explodes. One of you sees a ticking bomb with wires, buttons and symbols. The other has the defusal manual, but can't see the bomb. You have to talk it through on a call.
- **A round:** a 3–5 minute timer, with several mini-puzzles per bomb. Each round you swap roles.
- **Why it's fun:** chaotic yelling, panicked descriptions ("the squiggly one! no, the OTHER squiggly one!"), and huge relief when you defuse it.
- **Twists:** bombs are randomly generated so every game is new, and harder levels add more modules and less time.

### 5. Wordle Race ⭐⭐⭐⭐ 🛠 S
**Concept:** Same secret word, two boards, a race. You can see the other person's *colours* (🟩🟨⬛) live, but not their letters.
- **Why it's fun:** watching their row go green while you're stuck is pure panic. Each round takes 2 minutes.
- **Twists:** best of 5. A "sabotage" power you earn by winning a round, which hides one of their yellow hints. A "daily word" so you can each play it during the day and compare at night.

## 🎲 Solid fun options

### 6. Ultimate Tic-Tac-Toe ⭐⭐⭐⭐ 🛠 S
A 3×3 grid of tic-tac-toe boards. The square you play in decides which board your opponent has to play on next. It's surprisingly deep and strategic, and each game takes about 10 minutes. Cute animated X/O stickers.

### 7. Card Clash ⭐⭐⭐⭐ 🛠 M
Rock-paper-scissors grown into a quick card game. Each round you both secretly pick a card at the same time. Some cards have powers: *Mirror* copies their card, *Shield* blocks a loss, *Double* means the next win counts twice. First to 7 points wins. It's all mind games and "I KNEW you'd play that."

### 8. Mini Golf Party ⭐⭐⭐⭐ 🛠 M
Turn-based 2D mini golf: drag back to aim, release to shoot. 9 silly holes with windmills, bouncy walls and a hole on a moving platform. It's turn-based, so lag doesn't matter. You see a "ghost" of the other person's ball path.

### 9. Ship Bonk (Battleship) ⭐⭐⭐ 🛠 S
Classic Battleship with cute ships that have faces, dramatic splash and explosion animations, and emoji taunts. Twist: a "radar" power-up once per game reveals a 3×3 area.

### 10. Would You Rather: Predict ⭐⭐⭐⭐ 🛠 S
Both of you pick an answer to "Would you rather…" *and* predict what the other picked. You get points for reading each other correctly. Quick to play while on a call.

### 11. Story Swap ⭐⭐⭐ 🛠 S
Write a silly story together, one sentence each. Each of you also gets a secret word to sneak into the story without the other noticing. At the end you guess each other's secret word. The finished story is often a masterpiece of nonsense.

### 12. Spot the Sneaky Change ⭐⭐⭐ 🛠 M
One of you gets a cute scene (a room, a beach) and secretly changes 3 things: moves a cat, recolours a lamp, deletes a cloud. The other has to spot the changes against the clock. Then swap.

## 💡 Quick extras (smaller ideas)
- **Memory Match Race:** the same face-down cards on both screens, and whoever clears their board first wins.
- **Emoji Movie Quiz:** describe a movie or song only in emojis 🦁👑 and the other guesses.
- **Daily Duo Puzzle:** one small puzzle a day, played separately. In the evening you see each other's time and moves. Great when you can't both be online.
- **Connect 4 with Gravity Flip:** once per game you can flip the board upside down 🙃.
- **Snake Duel:** two snakes, one arena. Real-time, so it may stutter if the connection is slow.

## 🧭 If I had to pick what to build next
1. **How Well Do You Know Me?** Easiest to build, and the most laughs per minute.
2. **Doodle Duel.** The classic, and it's endlessly replayable.
3. **Secret Signal.** For when you want something clever and co-op.

Idea: a single **"Party Hub"** page that uses the same login, with each game as a button. One link, all your games. 🎉

## 📝 Our notes
_(Add thoughts here as you discuss: favourites, changes, inside-joke word lists, etc.)_
