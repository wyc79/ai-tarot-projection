/**
 * Protocol scanner: reads a finished session and reports where the reader broke
 * its own rules.
 *
 *   node scripts/scan.mjs checkpoint/b-deepseek-v4-pro.json
 *   node scripts/scan.mjs checkpoint/*.json
 *
 * Also imported by the seeded fixture and the A/B harness, so one definition of
 * "a violation" covers every way a transcript gets produced.
 *
 * What it is not: a judge. Every check here is a string test over the reader's
 * own words, which means the deal-turn check in particular is a tripwire rather
 * than a proof. A life question that happens to mention the card will pass it,
 * and a genuinely odd projection question may trip it. It is calibrated against
 * the six deal-turns of the 2026-08-25 checkpoint -- three correct, three not --
 * and those are pinned as tests. Treat a finding as a thing to go and read.
 */

import { readFile } from "node:fs/promises";

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

/** Reader turns in order: every question asked, then the closing beat. */
export function readerTurns(session) {
  const turns = session.exchanges.map((e, index) => ({
    index,
    position: e.position,
    text: String(e.q ?? "").trim(),
    question_type: e.question_type ?? null,
  }));
  if (session.closing_reflection) {
    turns.push({
      index: turns.length,
      position: "close",
      text: session.closing_reflection.trim(),
      question_type: "close",
    });
  }
  return turns.filter((t) => t.text);
}

/**
 * The turns that dealt a card: the first exchange at each card's position. That
 * is what a deal turn is -- the reader named the card and handed it over -- and
 * it is derivable from any transcript, including ones recorded before the engine
 * started labelling question_type.
 */
function dealTurnIndexes(session) {
  const seen = new Set();
  const indexes = new Set();
  const positions = new Set(session.cards.map((c) => c.position));
  for (const [index, exchange] of session.exchanges.entries()) {
    if (!positions.has(exchange.position) || seen.has(exchange.position)) continue;
    seen.add(exchange.position);
    indexes.add(index);
  }
  return indexes;
}

const sentencesIn = (text) => text.split(/(?<=[.?!])\s+/).filter(Boolean);

/**
 * @param {object} session a session object, as written by journal.toJson
 * @returns {Array<{index: number, position: string, code: string, message: string, text: string}>}
 */
export function scanSession(session) {
  const findings = [];
  const deals = dealTurnIndexes(session);
  const add = (turn, code, message) =>
    findings.push({ index: turn.index, position: turn.position, code, message, text: turn.text });

  for (const turn of readerTurns(session)) {
    const question = finalQuestion(turn.text);
    const questions = (turn.text.match(/\?/g) ?? []).length;
    const sentences = sentencesIn(turn.text);
    const closing = turn.position === "close";

    if (deals.has(turn.index) && question && !ABOUT_THE_CARD.some((re) => re.test(question))) {
      add(turn, "deal_turn_life_question",
          "dealt a card and then asked about their life; nothing was left to project onto");
    }
    if (!closing && questions === 0) {
      add(turn, "no_question", "the turn does not end on a question");
    }
    if (questions > 1) {
      add(turn, "two_questions", `${questions} questions in one turn; they will answer the easy one`);
    }
    if (sentences.length > 4) {
      add(turn, "over_length", `${sentences.length} sentences; the ceiling is four`);
    }
    if (/\bor\b[^.?!]*\?/i.test(question)) {
      add(turn, "stacked_or", "a forced choice: two questions wearing one coat");
    }
  }

  if (!session.closed) {
    findings.push({
      index: session.exchanges.length, position: "end", code: "unclosed",
      message: "the reading stopped without a closing beat", text: "",
    });
  }
  return findings;
}

/** One line per finding, or one line saying there were none. */
export function formatFindings(label, findings) {
  if (!findings.length) return `${label}: clean`;
  const lines = [`${label}: ${findings.length} finding${findings.length === 1 ? "" : "s"}`];
  for (const f of findings) {
    lines.push(`  turn ${f.index + 1} (${f.position})  ${f.code}`);
    lines.push(`    ${f.message}`);
    if (f.text) lines.push(`    "${f.text.replace(/\s+/g, " ").slice(0, 140)}"`);
  }
  return lines.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error("usage: node scripts/scan.mjs <session.json> [...]");
    process.exit(1);
  }
  let total = 0;
  for (const file of files) {
    const parsed = JSON.parse(await readFile(file, "utf8"));
    const findings = scanSession(parsed.session ?? parsed);
    total += findings.length;
    console.log(formatFindings(file, findings));
  }
  process.exit(total ? 1 : 0);
}
