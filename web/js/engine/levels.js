/**
 * The scaffolding ladder: how far a question stands from what is immediately in
 * front of someone. No DOM, no fetch, no imports.
 *
 * A question that sits one step above where they are standing is answerable and
 * takes them somewhere. Two steps above is a question they have to invent an
 * answer for, and inventing an answer is how a session turns into an interview.
 *
 * This module owns the arithmetic and nothing else. The ladder itself -- which
 * levels there are, what they are called, what they sound like, how high each
 * position may go -- is pack data, in the order the pack lists them. Swap the
 * pack and the ladder changes; none of the rules below do.
 *
 * The rule has two halves and the second one is the one that matters:
 *
 *   target = min(where they are + 1, this position's ceiling)
 *
 * with one amendment: a question that crosses from the card rail to the life
 * rail, or back, targets where they are standing rather than one above it.
 * Changing medium and climbing are each a step; doing both at once is two.
 *
 * and target is a CEILING ON DISTANCE, never a quota. People jump levels on
 * their own all the time -- someone answering "when did it start" will hand you
 * why it matters in the same breath -- and when they do, the reader meets them
 * there. Nothing here says a question must be as high as the target. It says
 * what a question may not be higher than.
 */

/** Every level id the pack defines, low to high. Array order is the ordering. */
export const levelIds = (pack) => pack.levels.map((l) => l.id);

/** Position on the ladder, or -1. */
export function levelIndex(pack, id) {
  return pack.levels.findIndex((l) => l.id === id);
}

/** The lowest level. Where someone stands before they have said anything. */
export const lowestLevel = (pack) => pack.levels[0].id;

/**
 * How far the next question may reach.
 *
 * @param {object} pack
 * @param {object} options
 * @param {string|null} options.userLevel  where their last answer operated
 * @param {string|null} options.ceiling    this arc position's limit
 * @param {boolean} options.deflected      they gave a one-word answer or a shrug
 * @param {boolean} options.crossingRails   the question changes medium: it asks
 *   about their life where the last one asked about the card, or the reverse
 * @returns {string} a level id
 */
export function targetLevel(pack, { userLevel, ceiling, deflected = false, crossingRails = false }) {
  const ids = levelIds(pack);
  const here = levelIndex(pack, userLevel);
  const cap = levelIndex(pack, ceiling);
  const top = cap === -1 ? ids.length - 1 : cap;

  // Nothing said yet: start at the bottom and ask what it is.
  if (here === -1) return ids[0];

  // A deflection does not get climbed away from. Their level has already
  // dropped -- that is what the judge saw -- and the answer to a shrug is not a
  // slightly higher question, it is the same altitude asked more concretely.
  // At the bottom rung that is the forced choice, which is where the fallback
  // in the persona already lives.
  if (deflected) return ids[Math.min(here, top)];

  // The staircase has two rails. A question can be about the card or about
  // their life, and moving between them is already the whole work of a turn:
  // it asks someone to change what they are talking about. Climbing at the
  // same time makes it two steps, and two steps is a question they have to
  // invent an answer to -- which is exactly what "when did that judging first
  // turn up for you?" got, one turn after they had only described a picture.
  if (crossingRails) return ids[Math.min(here, top)];

  return ids[Math.min(here + 1, top)];
}

/** How many rungs `to` is above `from`. Negative means below. */
export function levelDistance(pack, from, to) {
  return levelIndex(pack, to) - levelIndex(pack, from);
}
