// Sweet Revenge levels and achievements, worked out from the saved history.
// Pure: shared/records.js gathers the facts from the database, this turns them into XP, a level and a trophy shelf.
// Tested in tests/progress.test.js. The numbers are listed in docs/PROGRESS.md.

// [XP needed, title]. Each level is one more scoop on the cone.
export const LEVELS = [
  [0, 'Sprinkle'], [100, 'Single Scoop'], [250, 'Double Scoop'], [500, 'Waffle Cone'],
  [900, 'Sundae'], [1400, 'Banana Split'], [2100, 'Brain Freeze'], [3000, 'Sweet Revenge Royalty'],
];
export const KINDS = ['ludo', 'plusfour', 'doodle', 'snakes'];

/* facts = {
     games: [{ kind, practice, won, bonks, bombs, bombCards, score, fastest, snakesSlid, longestLadder }]  oldest first
     bigBomb, maxBonkedInGame, revengeBonk, revengeBomb, chats, seriesWon } */
export function xpFor(f) {
  return f.games.reduce((sum, g) => {
    const xp = 10 + (g.won ? 25 : 0) + g.bonks * 3 + g.bombCards + Math.floor((g.score || 0) / 20);
    return sum + (g.practice ? 0 : xp); // practice games against bots give no XP (the user's rule, 13 Nov 2026)
  }, 0);
}

export function levelFor(xp) {
  let i = 0;
  while (i + 1 < LEVELS.length && xp >= LEVELS[i + 1][0]) i++;
  return { level: i + 1, title: LEVELS[i][1], xp, from: LEVELS[i][0], to: i + 1 < LEVELS.length ? LEVELS[i + 1][0] : null };
}

function bestStreak(games) {
  let run = 0, best = 0;
  for (const g of games) { run = g.won ? run + 1 : 0; best = Math.max(best, run); }
  return best;
}
const sum = (games, k) => games.reduce((n, g) => n + (g[k] || 0), 0);

// Each one: [id, icon, name, how you get it, (facts) => [have, need]]
export const ACHIEVEMENTS = [
  ['first_win', '🍒', 'Sweet Victory', 'Win any game', (f) => [f.games.filter((g) => g.won).length, 1]],
  ['regular', '🎟️', 'Regular', 'Play 10 games', (f) => [f.games.length, 10]],
  ['first_bonk', '💥', 'First Bonk', 'Bonk someone in Ludo', (f) => [sum(f.games, 'bonks'), 1]],
  ['bonk_machine', '🔨', 'Bonk Machine', '50 bonks, all time', (f) => [sum(f.games, 'bonks'), 50]],
  ['sweet_revenge', '😈', 'Sweet Revenge', 'Bonk back whoever bonked you, in the same game', (f) => [f.revengeBonk ? 1 : 0, 1]],
  ['special_delivery', '📦', 'Special Delivery', 'Drop a bomb of 8+ cards in Plus Four', (f) => [Math.min(f.bigBomb, 8), 8]],
  ['return_to_sender', '↩️', 'Return to Sender', 'Get bombed, then bomb them back in the same game', (f) => [f.revengeBomb ? 1 : 0, 1]],
  ['bomb_squad', '🧨', 'Bomb Squad', '25 bombs, all time', (f) => [sum(f.games, 'bombs'), 25]],
  ['on_fire', '🔥', 'On Fire', 'Win 3 games in a row', (f) => [Math.min(bestStreak(f.games), 3), 3]],
  ['all_rounder', '🎪', 'All-Rounder', 'Win at least once in every game', (f) => [KINDS.filter((k) => f.games.some((g) => g.kind === k && g.won)).length, KINDS.length]],
  ['punching_bag', '🫠', 'Punching Bag', 'Get bonked 10 times in one game', (f) => [Math.min(f.maxBonkedInGame, 10), 10]],
  ['chatterbox', '🗣️', 'Chatterbox', 'Send 100 chat messages', (f) => [f.chats, 100]],
  ['mind_reader', '🧠', 'Mind Reader', 'Guess a Doodle in under 5 seconds', (f) => [f.games.some((g) => g.kind === 'doodle' && g.fastest > 0 && g.fastest < 5000) ? 1 : 0, 1]],
  ['slippery_slope', '🐍', 'Slippery Slope', 'Slide down 3 snakes in one game', (f) => [Math.min(Math.max(0, ...f.games.map((g) => g.snakesSlid || 0)), 3), 3]],
  ['grudge_champ', '🥊', 'Grudge Champ', 'Win a best-of-5 grudge series against a friend', (f) => [Math.min(f.seriesWon || 0, 1), 1]],
  ['sky_high', '🪜', 'Sky High', 'Climb a ladder 30+ squares long', (f) => [Math.max(0, ...f.games.map((g) => g.longestLadder || 0)) >= 30 ? 1 : 0, 1]],
];

export function progress(f) {
  const xp = xpFor(f);
  // Trophies only count real games against friends: practice games against bots don't count
  // (the user's rule, 13 Nov 2026). bigBomb, maxBonkedInGame and the revenge flags are gathered
  // from real games only by the caller.
  const real = { ...f, games: f.games.filter((g) => !g.practice) };
  return {
    ...levelFor(xp),
    achievements: ACHIEVEMENTS.map(([id, icon, name, how, goal]) => {
      const [have, need] = goal(real);
      return { id, icon, name, how, have: Math.min(have, need), need, done: have >= need };
    }),
  };
}
