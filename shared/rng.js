/* Sweet Revenge fair randomness: one place for every random choice that changes a game's outcome
   (dice, shuffles, who goes first). Uses the browser's crypto generator with rejection sampling,
   so every value is exactly equally likely; nothing here leans towards the host or any seat.
   Cosmetic randomness (sparkles, bot delays) can keep using Math.random. Works in the page
   (window.SR_RNG) and in node tests (module.exports). */
(function (root, factory) {
  const api = factory(root.crypto || (typeof require === 'function' ? require('crypto').webcrypto : null));
  if (typeof module === 'object' && module.exports) module.exports = api; else root.SR_RNG = api;
})(typeof self !== 'undefined' ? self : globalThis, function (crypto) {
  'use strict';
  const buf = new Uint32Array(1);
  const u32 = () => { crypto.getRandomValues(buf); return buf[0]; };
  // A whole number from 0 to n-1, unbiased: values from the uneven top end of the 32-bit range are redrawn.
  function int(n) {
    if (!(n >= 1 && n <= 0x100000000)) throw new RangeError('SR_RNG.int needs 1..2^32, got ' + n);
    const limit = 0x100000000 - (0x100000000 % n);
    let x; do x = u32(); while (x >= limit);
    return x % n;
  }
  const die = () => 1 + int(6);
  const seed31 = () => int(0x7fffffff) + 1; // a seed for the games' own seeded shuffles (1..2^31-1)
  function shuffle(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = int(i + 1); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }
  const pick = (arr) => arr[int(arr.length)];
  return { int, die, seed31, shuffle, pick };
});
