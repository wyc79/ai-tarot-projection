/**
 * Seeded randomness. No DOM, no imports.
 *
 * The point is reproducible playtests: the same seed must deal the same cards
 * on any machine, so two prompt versions can be compared on identical draws.
 * Math.random() cannot do that, so this is a small explicit PRNG instead.
 *
 * cyrb128 (string -> four 32-bit ints) feeding mulberry32 (one int -> stream).
 * Both are public-domain constructions; neither is cryptographic, and neither
 * needs to be -- this shuffles cards, it does not protect anything.
 */

/** Hash a seed string into a 32-bit integer. */
function hashSeed(seed) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** @returns {() => number} a function yielding floats in [0, 1). */
export function makeRng(seed) {
  let state = hashSeed(String(seed));
  return function next() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A fresh human-readable seed, e.g. "moon-4f2a91". Readable matters: the seed
 * gets logged with every session and quoted when reporting a bad reading.
 */
export function newSeed(entropy = Math.random()) {
  const words = ["moon", "star", "wheel", "tower", "river", "lantern", "thread", "hinge"];
  const word = words[Math.floor(entropy * words.length) % words.length];
  const tail = Math.floor(entropy * 0xffffff).toString(16).padStart(6, "0");
  return `${word}-${tail}`;
}
