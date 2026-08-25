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
import { finalQuestion, isOwnershipOffer, questionLevel, questionType } from "../web/js/engine/questions.js";
import { levelDistance, levelIndex } from "../web/js/engine/levels.js";
import { loadPackFromDisk } from "./harness.mjs";

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
 * A forced choice is normally two questions wearing one coat, and people answer
 * the easier one. It is also the designed move for when there is nothing of
 * theirs on the table yet: two contrasting readings give someone with nothing
 * to say something to push against, and the ownership offer hands them the
 * refusal as one of its options on purpose.
 *
 * Permitted, then, when their last answer gave you nothing to work with -- a
 * shrug, or an answer entirely about the picture -- and what is being offered
 * is either a choice between readings of the card or an ownership offer. A
 * forced choice after a real answer about their life is still two questions
 * wearing one coat.
 */
function permittedForcedChoice(session, turn) {
  const previous = session.exchanges[turn.index - 1];
  if (!previous) return false;
  const nothingOfTheirs = previous.disclosure_depth === 1
    || previous.gate?.has_life_content === false;
  return nothingOfTheirs
    && (questionType(turn.text) === "projection" || isOwnershipOffer(turn.text));
}

/**
 * @param {object} session a session object, as written by journal.toJson
 * @param {object} [pack] needed for the scaffolding checks, which are the only
 *   ones that require knowing the ladder's order. Omitted, they are skipped.
 * @returns {Array<{index: number, position: string, code: string, message: string, text: string}>}
 */
export function scanSession(session, pack = null) {
  const findings = [];
  const deals = dealTurnIndexes(session);
  const add = (turn, code, message) =>
    findings.push({ index: turn.index, position: turn.position, code, message, text: turn.text });

  for (const turn of readerTurns(session)) {
    const question = finalQuestion(turn.text);
    const questions = (turn.text.match(/\?/g) ?? []).length;
    const sentences = sentencesIn(turn.text);
    const closing = turn.position === "close";

    if (deals.has(turn.index) && question && questionType(turn.text) !== "projection") {
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
    if (/\bor\b[^.?!]*\?/i.test(question) && !permittedForcedChoice(session, turn)) {
      add(turn, "stacked_or", "a forced choice, and not one the fallback rule allows here");
    }
  }

  if (pack) findings.push(...scanScaffolding(session, pack));

  if (!session.closed) {
    findings.push({
      index: session.exchanges.length, position: "end", code: "unclosed",
      message: "the reading stopped without a closing beat", text: "",
    });
  }
  return findings;
}

/**
 * The scaffolding checks: is the reader standing one step above them, and is it
 * moving at all.
 *
 * Levels are classified from the questions' own words rather than read off
 * question_level, so this works on transcripts recorded before the engine
 * started labelling them -- which is every transcript from before today.
 */
function scanScaffolding(session, pack) {
  const findings = [];
  const reading = session.exchanges.filter((e) => e.position !== "off_frame");
  const asked = [];

  for (const [index, exchange] of reading.entries()) {
    if (exchange.position === "opening" || !exchange.q) continue;
    const level = questionLevel(exchange.q);
    asked.push(level);

    // "Their last level" is the answer immediately before this question, wherever
    // in the spread it fell: that is what they were standing on when they read it.
    const before = reading[index - 1];
    const previous = before?.gate?.user_level;
    if (!previous || levelIndex(pack, previous) === -1) continue;
    const jump = levelDistance(pack, previous, level);
    if (jump > 1) {
      findings.push({
        index: session.exchanges.indexOf(exchange), position: exchange.position,
        code: "level_jump",
        message: `asked at ${level} when they were standing at ${previous}; ` +
                 `${jump} rungs up is a question they have to invent an answer to`,
        text: exchange.q,
      });
      continue;   // one finding per question; the bigger number is the one to read
    }

    // Crossing rails is a step of its own, so a crossing question that also
    // climbs has taken two. c145c7's turn 3 passed the check above -- one rung,
    // name to consequences -- while switching from the card to their life in
    // the same breath, and got a description of the card back.
    const rail = questionType(exchange.q);
    const railBefore = before.question_type ?? (before.q ? questionType(before.q) : null);
    if (railBefore && rail !== railBefore && jump > 0) {
      findings.push({
        index: session.exchanges.indexOf(exchange), position: exchange.position,
        code: "rail_switch_climb",
        message: `crossed from ${railBefore} to ${rail} and climbed to ${level} in one ` +
                 `question, from ${previous}; crossing is already the step`,
        text: exchange.q,
      });
    }
  }

  if (asked.length >= 3 && new Set(asked).size === 1) {
    findings.push({
      index: session.exchanges.length, position: "end", code: "level_flat",
      message: `every question sat at ${asked[0]}; the reading never moved off one rung`,
      text: "",
    });
  }
  return findings;
}

/** The question/answer altitude trace, for reading two arms side by side. */
export function levelTrace(session) {
  return session.exchanges
    .filter((e) => e.position !== "opening" && e.position !== "off_frame" && e.q)
    .map((e) => `${questionLevel(e.q)[0]}${(e.gate?.user_level ?? "?")[0]}`)
    .join(" ");
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
  const pack = await loadPackFromDisk();
  let total = 0;
  for (const file of files) {
    const parsed = JSON.parse(await readFile(file, "utf8"));
    const findings = scanSession(parsed.session ?? parsed, pack);
    total += findings.length;
    console.log(formatFindings(file, findings));
  }
  process.exit(total ? 1 : 0);
}
