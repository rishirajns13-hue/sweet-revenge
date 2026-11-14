# Fair play audit (14 Nov 2026)

The goal: every game is decided only by **chance and skill**. No seat, host or player gets a hidden edge.

## What was checked and what changed

| Game | Randomness | Who goes first | Finding | Fixed |
|---|---|---|---|---|
| Ludo | Dice from `crypto` with rejection sampling (`ludo/game.js` `randomDie`) | Was always seat 0, the room's creator | Creator always rolled first | A random seat starts (`opts.first`) |
| Plus Four | Seeded shuffle (mulberry32), seed from `Math.random` | Was always seat 0 | Creator always played first; the seed wasn't from a crypto source | Crypto seed (`SR_RNG.seed31`), random starter (`firstSeat`) |
| Snakes & Ladders | Seeded dice (mulberry32), seed from `Math.random` | Was always seat 0 | Same as Plus Four | Crypto seed, random starter |
| Doodle Duel | Word choices from `Math.random` | Drawing order followed join order | Everyone draws the same number of times, so it was already fair; the order always started with the creator | Random drawing order, crypto word picks |

## The shared source: `shared/rng.js`
- `SR_RNG.int(n)`: a whole number from 0 to n−1 from `crypto.getRandomValues`. Values from the uneven top of the 32-bit range are redrawn, so every value is exactly equally likely.
- Also `die()`, `seed31()`, `shuffle(arr)` (Fisher–Yates) and `pick(arr)`.
- Use it for anything that changes the outcome of a game. Cosmetic randomness (sparkles, bot reaction delays) can stay on `Math.random`.
- Tests in `tests/rng.test.js` run chi-square checks: 100k dice rolls, `int` for awkward sizes, 60k shuffles. Each new game's starter rule is checked there too.

## Rules already fair (no change needed)
- **Ludo:** three 6s in a row lose the turn for everyone alike. Safe squares and bonks are the same for every colour.
- **Plus Four:** the first card can't be a Wild +4 for anyone. Stacking, Ouch and catching apply to everyone the same way. Bots use the same rules as people.
- **Snakes & Ladders:** the exact roll to 100 and the three-6s limit apply to everyone the same way.
- **Doodle Duel:** points come from guess speed only. The drawer earns the same way in every round.

## Trust model
The host's browser decides dice, shuffles and moves, and the guests get the result. A host who edited the code in their own browser could cheat. That's fine for a private game between friends. A server-side referee would only be worth building if that ever changed.

## Rules for new games
- Pick the starting player at random (or alternate on rematches) and seat-mirror any map or level (Slingshot islands).
- Use `SR_RNG` for every random outcome. Use seeded generators only with a seed from `SR_RNG.seed31()`.
- Show random modifiers (such as wind) to both players before they act.
