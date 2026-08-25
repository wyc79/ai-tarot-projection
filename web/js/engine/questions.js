/**
 * What the reader just asked, on two independent axes. No DOM, no fetch, no
 * imports.
 *
 * questionType: what the question asks them to look at. Two values, and the
 * difference decides how the answer should be scored:
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
 *
 * questionLevel: how far from the immediate the question reaches. A separate
 * axis -- a projection ask can target any level -- and the one the scaffolding
 * rule in levels.js does its arithmetic on.
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

/**
 * How far from the immediate a question reaches, on the scaffolding ladder.
 *
 * A parallel axis to questionType, not a finer version of it: a projection ask
 * can sit at any level. "What does it look like" is a projection question at
 * name; "what's it like for you, watching him walk off" is a projection
 * question at evaluate.
 *
 * Highest match wins, so a question doing two things is scored by the furthest
 * it reaches. Unmatched means name -- a question with no marker is asking what
 * something is, which is the bottom rung and the safe default: the check this
 * feeds flags questions that reach too FAR above the user, so guessing low
 * costs a missed flag rather than a false one.
 *
 * These patterns are written for the ladder the shipped pack defines. A pack
 * with a different ladder needs its own classifier; there is nothing here that
 * reads pack data, and that is the one place this module is not pack-agnostic.
 */
const LEVEL_MARKERS = [
  ["plans", [
    /\bthis week\b/i,
    /\bnext time\b/i,
    /\b(first|smallest|next) step\b/i,
    /\bwhat (will|would|could|might) you (do|try|change|start|stop)\b/i,
    /\bcatch (yourself|it|the one)\b/i,
  ]],
  ["intentions", [
    /\bwhy\b[^?]*\byou(r)?\b/i,
    /\bmatters? to you\b/i,
    /\bwhat (were|are) you hoping\b/i,
    /\bwhat (do|did) you (want|value|care about)\b/i,
    /\bsay about (what|who)\b/i,
  ]],
  ["evaluate", [
    /\bwhat('s| is| was)? it like\b/i,
    /\b(alright|ok|okay|fine) with you\b/i,
    /\bhow('s| has| have)? (it|that|this|things) been\b/i,
    /\bhow (is|was) (that|this|it) for you\b/i,
  ]],
  ["consequences", [
    /\bwhen (did|does|do)\b/i,
    /\bwhat happened\b/i,
    /\bwhat (did|do) you do\b/i,
    /\bwho else\b/i,
    /\bhow long\b/i,
    /\bturn(ed|s)? up\b/i,
    /\bwas there a (time|week|day|moment|year|month)\b/i,
    /\bwhat was different\b/i,
    /\bthen what\b/i,
    /\bafter (this|that|it)\b/i,
  ]],
];

/**
 * @param {string} text a whole reader turn
 * @returns {"name"|"consequences"|"evaluate"|"intentions"|"plans"}
 */
export function questionLevel(text) {
  // The closing turn ends on a step rather than a question, and the step is the
  // thing being classified, so fall back to the whole turn when there is no
  // question in it.
  const subject = finalQuestion(text) || String(text ?? "");
  const found = LEVEL_MARKERS.find(([, patterns]) => patterns.some((re) => re.test(subject)));
  return found ? found[0] : "name";
}
