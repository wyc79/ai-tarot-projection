/**
 * Dealing cards. No DOM, no imports beyond the RNG.
 *
 * Every draw in a session comes from one shuffle of the full deck, so a session
 * can never deal the same card twice, and a re-draw takes the next card off the
 * same pile rather than reshuffling -- which is what makes "the deck answers the
 * same question the same way" true rather than a line the reader says.
 */

import { makeRng } from "./rng.js";

/** Fisher-Yates, driven by the seeded RNG. Returns a new array. */
export function shuffle(items, rng) {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * The shuffled pile for a session. Cards come off the top as positions are
 * reached, so `pile[n]` is fixed by the seed before the reading starts.
 *
 * @returns {{seed: string, pile: string[], take: (n: number) => string[]}}
 */
export function makeDeal(cardIds, seed) {
  const pile = shuffle(cardIds, makeRng(seed));
  let dealt = 0;
  return {
    seed: String(seed),
    pile,
    take(n = 1) {
      const cards = pile.slice(dealt, dealt + n);
      dealt += cards.length;
      return cards;
    },
    get dealtCount() {
      return dealt;
    },
  };
}
