/**
 * What makes a resolution beat a plan rather than a verdict.
 *
 * The beat is where the reading is walking. If it is phrased as a finding, every
 * question after it steers toward confirming that finding, and the session stops
 * being about the person and starts being about the sentence the anchor already
 * wrote. river-89c1fb's beat did this off one headline answer:
 *
 *   "...that the change isn't a break, it's a repurposing, and something from
 *    the before is still alive in it."
 *
 * They never said that. They said they used to have a different major. The beat
 * decided what it meant, and would have spent two more cards proving it.
 *
 * The form that works names the question and leaves the answers open:
 *
 *   "where the old major stands in the new one — still feeding it, or genuinely
 *    left behind."
 *
 * A string test, so it is fallible in both directions. It is used to re-ask the
 * judge once, not to reject an answer outright, because the cost of being wrong
 * about a beat is one extra judge call.
 */

/** Phrasings that assert what the session will find rather than what it will ask. */
const ASSERTS = [
  /\b(is|isn'?t|was|wasn'?t)\b[^.?!]*\bit'?s\b/i,   // "isn't a break, it's a repurposing"
  /\bturns out\b/i,
  /\bthe (truth|point|real \w+) is\b/i,
  /\bwhat'?s really\b/i,
  /\breally (is|means|about)\b/i,
  /\bactually (is|means|about)\b/i,
];

/** Phrasings that hold two or more possibilities open. */
const OFFERS = [
  /\bwhether\b/i,
  /\bor\b/i,
  /\bhow much\b/i,
  /\bwhich of\b/i,
  /\bif .* still\b/i,
];

/**
 * @param {string} beat
 * @returns {boolean} true when it reads as a question the session is walking
 *   toward, false when it reads as a conclusion the session will confirm
 */
export function beatIsTerritory(beat) {
  const text = String(beat ?? "");
  if (!text.trim()) return false;
  if (ASSERTS.some((re) => re.test(text))) return false;
  return OFFERS.some((re) => re.test(text));
}

/** What to tell the judge when its first beat was a verdict. */
export const BEAT_RETRY_NOTE = `Your resolution beat reads as a conclusion: it
says what this session will find. Write it again as the question the session is
walking toward, naming at least two live possibilities, either of which could
turn out to be true. Say where to look, not what is there.`;
