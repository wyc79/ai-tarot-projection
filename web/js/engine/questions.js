/**
 * What kind of question the reader just asked. No DOM, no fetch, no imports.
 *
 * There are two, and the difference decides how the answer should be scored:
 *
 *   projection  "what does it look like it's pointing at for you?"
 *               They were asked to read the card. What they choose to see in it
 *               is the disclosure, so describing the picture is the answer
 *               working, not the answer dodging.
 *
 *   life        "when did the tiredness first turn up?"
 *               They were asked about themselves. Describing the picture here is
 *               a retreat into it -- the same words that were a 3 a turn ago.
 *
 * Derived from the question's own words rather than from which turn asked it.
 * Turn kind is close but not equal: the reader is supposed to point at the
 * picture when someone stalls, and that is a projection question arriving on a
 * follow-up turn. Classifying by turn kind would score that answer as a dodge.
 *
 * The same predicate is what scripts/scan.mjs uses to check that a turn dealing
 * a card asked a card question, so the protocol check and the scoring cannot
 * drift apart. It is a string test and it is fallible; see scan.mjs.
 */

/** The last question in a turn. It is the one they actually answer. */
export function finalQuestion(text) {
  const sentences = String(text ?? "").trim().split(/(?<=[.?!])\s+/);
  for (let i = sentences.length - 1; i >= 0; i -= 1) {
    if (sentences[i].includes("?")) return sentences[i];
  }
  return "";
}

// Four ways a question can be about the card in front of them. Any one is
// enough; the point is to catch a question that is about none of them.
const ABOUT_THE_CARD = [
  // names the object: "who in that picture", "the figure on the left"
  /\b(picture|image|card|figure|scene|drawing|deck)\b/i,
  // asks after it in the third person: "what does it look like", "what is he doing"
  /\b(?:what|who|which|where|how)\b[^?]*?\b(?:does|do|is|are|did|would|has|have)\s+(?:it|he|she|they|this|that)\b/i,
  // predicates appearance on it: "he looks like", "they seem about to"
  /\b(?:it|he|she|they|this|that)\s+(?:\w+\s+){0,1}(?:look|looks|looking|feel|feels|seem|seems|doing|about to)\b/i,
  // points them at their own looking: "what do you see", "where does your eye go"
  /\b(?:you\s+(?:see|notice|make of)|your eye)\b/i,
];

/**
 * @param {string} text a whole reader turn
 * @returns {"projection"|"life"} what its closing question asked for
 */
export function questionType(text) {
  const question = finalQuestion(text);
  if (!question) return "life";
  return ABOUT_THE_CARD.some((re) => re.test(question)) ? "projection" : "life";
}
