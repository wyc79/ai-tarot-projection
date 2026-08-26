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
import {
  contentWords, finalQuestion, inTerritory, isOwnershipOffer, questionLevel, questionType,
} from "../web/js/engine/questions.js";
import { levelDistance, levelIndex } from "../web/js/engine/levels.js";
import {
  SETTLE_MIN, disclosureArrivals, flipsAfterExchange, heavyMaterial,
} from "../web/js/engine/state.js";
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
  // The goodbye is stored beside the closing beat rather than as an exchange,
  // because nothing answered it. It is the one turn that is allowed to ask
  // nothing, and the one that owes the session's heavy material a line.
  if (session.farewell) {
    turns.push({
      index: turns.length,
      position: "farewell",
      text: session.farewell.trim(),
      question_type: "close",
    });
  }
  return turns.filter((t) => t.text);
}

/**
 * A turn that ends the reading: no question, and enough of it to be saying what
 * the reading came to rather than saying goodbye.
 *
 * There is exactly one of these in a session. The design that preceded this
 * round produced two -- a reflection over three cards, then a fourth card, then
 * a second reflection reusing the first one's formula -- and from inside the
 * transcript each of them looked correct on its own.
 */
function closingShaped(turn) {
  if (turn.position === "farewell" || turn.position === "opening") return false;
  return !/\?/.test(turn.text) && sentencesIn(turn.text).length >= 2;
}

/** The ground the reading found: what they named, and their own phrases. */
export function anchorTerritory(session) {
  return [
    ...(session.topic ? [session.topic] : []),
    ...(session.anchor?.user_phrases ?? [])
      .map((p) => (typeof p === "string" ? p : p.phrase))
      .filter(Boolean),
  ];
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

// Ways of offering to stop. Narrow on purpose: this exempts a turn from the
// forced-choice rule, and every one of these is an exit rather than a subject.
const OFFERS_TO_STOP = [
  /\bleave (it|this|them) (here|there)\b/i,
  /\bfor (today|now)\b/i,
  /\b(stop|finish|end|leave off) (here|there)\b/i,
  /\bcome back to (it|this)\b/i,
  /\banother (day|time)\b/i,
];

/**
 * Reader turns nobody answered.
 *
 * Every reader turn but one is stored twice: as the next exchange's question and
 * as the card's ai_reading. The exception is the last thing said before a
 * session stopped, which exists only on the card -- and in both c145c7 and
 * river-89c1fb that is the turn worth reading.
 */
function trailingTurns(session) {
  const answered = new Set(session.exchanges.map((e) => e.q).filter(Boolean));
  return session.cards
    .filter((c) => c.ai_reading && !answered.has(c.ai_reading))
    .map((c) => ({ index: session.exchanges.length, position: c.position, text: c.ai_reading }));
}

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
  // The opening turn offers "something particular, or just curious?" because the
  // persona tells it to make declining easy. There is nothing on the table for
  // it to be a forced choice about yet, so the rule does not apply.
  if (turn.position === "opening") return true;
  // The other end of the session: "we can sit with this, or leave it here for
  // today" is the sanctioned way out of an afterglow that has stopped going
  // anywhere. The second option is the door, not a second question.
  if (OFFERS_TO_STOP.some((re) => re.test(turn.text))) return true;
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
  const turns = readerTurns(session);
  // Everything the reading ended on, deduplicated by what was actually said.
  //
  // Every reader turn is stored twice -- as the next exchange's question and as
  // the card's reading or the closing reflection -- so the one correct beat
  // appears twice in this list and is not two beats. Two DIFFERENT closings
  // are, and that is the shape this round exists to stop.
  const closes = [];
  const saidBefore = new Set();
  for (const turn of turns.filter(closingShaped)) {
    const key = turn.text.replace(/\s+/g, " ").trim();
    if (saidBefore.has(key)) continue;
    saidBefore.add(key);
    closes.push(turn.index);
  }
  const territory = anchorTerritory(session);
  const add = (turn, code, message) =>
    findings.push({ index: turn.index, position: turn.position, code, message, text: turn.text });

  for (const turn of turns) {
    const question = finalQuestion(turn.text);
    const questions = (turn.text.match(/\?/g) ?? []).length;
    const sentences = sentencesIn(turn.text);
    // A closing beat is a closing beat wherever it sits, including one that
    // landed in the tail because the reading closed twice. The second one is a
    // double close, which is the finding worth having; reporting the first as a
    // turn that forgot its question is the wrong diagnosis of the same defect.
    const closing = closes.indexOf(turn.index);
    if (closing > 0) {
      add(turn, "double_close",
          "a second closing turn; the reading already ended once, and two endings "
          + "read as the reader losing track of where it finished");
      continue;
    }
    // Two turn shapes end without asking anything: the closing beat, which ends
    // on a step, and the farewell, which ends. The afterglow is the third and
    // it is a permission rather than a shape -- a turn there MAY receive what
    // was said and stop. Nothing else may, the short tail after the close
    // included: a reading that trails off is not a reading that ended.
    const mayNotAsk = closing === 0 || turn.position === "close"
      || turn.position === "farewell" || turn.position === "afterglow";
    if ((turn.position === "afterward" || turn.position === "afterglow")
        && question && !inTerritory(turn.text, territory)) {
      add(turn, "off_territory",
          "after the close, and asking about something the reading never found; "
          + "a new subject here is an interview, not a conversation");
    }

    if (deals.has(turn.index) && question && questionType(turn.text) !== "projection") {
      add(turn, "deal_turn_life_question",
          "dealt a card and then asked about their life; nothing was left to project onto");
    }
    if (!mayNotAsk && questions === 0) {
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

  findings.push(...scanTempo(session));
  // Trailing turns included: the last thing the reader said before a session
  // stopped lives on the card, not on an exchange, and both checks above care
  // about it.
  findings.push(...scanHedges(session, [...readerTurns(session), ...trailingTurns(session)]));
  if (pack) findings.push(...scanScaffolding(session, pack), ...scanPremises(session, pack));

  findings.push(...scanHeavyMaterial(session, turns));

  if (!session.closed) {
    findings.push({
      index: session.exchanges.length, position: "end", code: "unclosed",
      message: "the reading stopped without a closing beat", text: "",
    });
  }
  return findings;
}

/**
 * Did the session's heaviest material survive to the end of it?
 *
 * Someone says a thing with real consequence in it -- a lease running out, a
 * diagnosis, money that decides something -- and the reading acknowledges it,
 * hands agency back once, and moves on. That is correct. What is not correct is
 * the ending never coming back to it: the closing beat about the three cards,
 * a tail about something else entirely, and the heaviest thing anyone said that
 * hour left where it fell.
 *
 * The test is word reuse from the closing beat onward, which is crude in the
 * same way scanHedges is crude. A finding is an ending to go and read.
 */
function scanHeavyMaterial(session, turns) {
  const heavy = heavyMaterial(session);
  if (!heavy.length || !session.closed) return [];
  const from = turns.findIndex((t) => closingShaped(t));
  const ending = turns.slice(from === -1 ? turns.length : from);
  if (!ending.length) return [];
  const theirs = new Set(heavy.flatMap((e) => [...contentWords(e.a)]));
  const acknowledged = ending.some((t) =>
    [...contentWords(t.text)].some((w) => theirs.has(w)));
  if (acknowledged) return [];
  const last = ending[ending.length - 1];
  return [{
    index: last.index, position: last.position, code: "heavy_material_dropped",
    message: `they said something with real stakes in it ("${
      String(heavy[0].a).replace(/\s+/g, " ").slice(0, 60)}") and nothing from the `
      + "closing beat onward comes back to it; the ending is about everything else",
    text: last.text,
  }];
}

/**
 * Words the reader used that came from the pack rather than from them.
 *
 * details[] and the meanings exist so the reader can recognise what someone
 * points at and answer them on it. They are not a description to hand back.
 * c145c7's obstacle turn said "the ones holding the plans" and "building what
 * they want" -- plans and building are both in the pack for that card, neither
 * was ever said by the person, and the turn asserts both as facts about a
 * picture only they could see.
 *
 * Naming the card is not an assertion about the scene, so the card's own name
 * is exempt. So is anything they have already said: once someone offers a
 * bench, the reader may talk about the bench.
 *
 * A heuristic over word stems, and it will have both kinds of error. A finding
 * is a turn to go and read.
 */
function scanPremises(session, pack) {
  const findings = [];
  const said = new Set();
  const positionOf = new Map(session.cards.map((c) => [c.position, c]));

  for (const [index, exchange] of [
    ...session.exchanges,
    ...trailingTurns(session).map((t) => ({ q: t.text, a: "", position: t.position })),
  ].entries()) {
    const entry = positionOf.get(exchange.position);
    const card = entry && pack.card(entry.card_id);
    if (card && exchange.q) {
      // The imagery line is the one description the persona permits offering,
      // and only to someone who has frozen. Offering it is the reader doing as
      // it is told, so after a deflection its words do not count against it --
      // the details and the meanings still do.
      const previous = session.exchanges[index - 1];
      const offering = previous?.disclosure_depth === 1;
      const fromPack = new Set([
        ...contentWords(card.imagery_line),
        ...contentWords(card.details.join(" ")),
        ...contentWords(pack.meaning(card, exchange.position)),
        ...contentWords(card.meanings.general),
      ]);
      for (const word of contentWords(card.name)) fromPack.delete(word);
      for (const word of said) fromPack.delete(word);
      if (offering) for (const word of contentWords(card.imagery_line)) fromPack.delete(word);

      const used = [...contentWords(exchange.q)].filter((w) => fromPack.has(w));
      if (used.length) {
        findings.push({
          index, position: exchange.position, code: "unearned_card_vocabulary",
          message: `asserted ${used.map((w) => `"${w}"`).join(", ")} about the picture; ` +
                   `${used.length === 1 ? "it is" : "they are"} in the pack, not in anything they said`,
          text: exchange.q,
        });
      }
    }
    for (const word of contentWords(exchange.a)) said.add(word);
  }
  return findings;
}

/**
 * Tempo: did a card turn over on the turn someone first said something of their
 * own?
 *
 * The flip is the reward mechanic, so a flip landing on a first disclosure
 * teaches that opening up ends the subject. It is the one shape on the map that
 * is always wrong, and it is invisible in a transcript -- both halves look fine
 * separately.
 */
function scanTempo(session) {
  const findings = [];
  const flips = flipsAfterExchange(session);
  const arrived = new Set();

  for (const [index, exchange] of session.exchanges.entries()) {
    const first = exchange.gate?.has_life_content === true && !arrived.has(exchange.position);
    if (exchange.gate?.has_life_content === true) arrived.add(exchange.position);
    if (first && flips.has(index)) {
      findings.push({
        index, position: exchange.position, code: "flip_on_disclosure",
        message: `${flips.get(index).card_id} turned over on the turn they first said `
          + "something of their own; the reward for opening up was the subject changing",
        text: exchange.a,
      });
    }
  }
  return findings;
}

// Ways of holding a hedged thing lightly while asking again.
const SOFTENERS = [
  /\bcould be nothing\b/i, /\bmaybe\b/i, /\bmight\b/i, /\bor not\b/i,
  /\bif (that|it|there)('s| is|s)?\b/i, /\bno pressure\b/i, /\bonly if\b/i,
  /\bdoes that sound\b/i, /\bam I wrong\b/i, /\bor have I\b/i,
];

// Phrasings that overrule a hedge outright rather than repeating past it.
// river's turn does this in the clear: "You weren't sure at first, but
// 'repurposed' turned out to be you."
const OVERRIDES = [
  /\bturn(ed|s)? out to be\b/i,
  /\bweren'?t sure\b[^.?!]*\bbut\b/i,
  /\bwas'?n?'?t sure\b[^.?!]*\bbut\b/i,
  /\bso (it|that|this)('s| is| was)\b/i,
  /\bthat'?s you\b/i,
  /\b(clearly|obviously|definitely|of course)\b/i,
];

/**
 * Did the reader take something they were offered tentatively and hand it back
 * as settled?
 *
 * "i guess so?" is someone checking whether it was safe to say. Answering it
 * with "that turned out to be you" decides for them. The test is crude: does
 * the next turn reuse the hedged answer's words without any of the phrasings
 * that leave a way out.
 */
function scanHedges(session, turns) {
  const findings = [];
  for (const [index, exchange] of session.exchanges.entries()) {
    if (!exchange.gate?.hedged) continue;
    const next = turns.find((t) => t.index === index + 1);
    if (!next?.text) continue;
    if (SOFTENERS.some((re) => re.test(next.text))) continue;
    const theirs = contentWords(exchange.a);
    const reused = [...contentWords(next.text)].filter((w) => theirs.has(w));
    const overruled = OVERRIDES.some((re) => re.test(next.text));
    if (overruled || reused.length >= 2) {
      findings.push({
        index: next.index, position: next.position, code: "built_on_hedge",
        message: overruled
          ? "overruled the hedge outright; they put a question mark on it and the "
            + "turn took it off again"
          : `built on "${String(exchange.a).replace(/\s+/g, " ").slice(0, 48)}" as settled `
            + "fact; they had put a question mark on it",
        text: next.text,
      });
    }
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
  const reading = session.exchanges.filter((e) => e.position !== "off_frame" && !e.aside);
  const asked = [];

  for (const [index, exchange] of reading.entries()) {
    if (exchange.position === "opening" || !exchange.q) continue;
    // A turn with no question in it is not a question, and the altitude rules
    // are about questions. What lands here is a closing beat -- exempt from the
    // ceiling by design -- that got stored as an exchange because the reading
    // closed twice, and reading it as a question two rungs up is a finding
    // about the wrong defect.
    if (!exchange.q.includes("?")) continue;
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

    const rail = questionType(exchange.q);
    const railBefore = before.question_type ?? (before.q ? questionType(before.q) : null);

    // A crossing needs somewhere to launch from. Two answers on this card, or
    // one that already had something of their own in it -- before that there is
    // nothing under the question but one sentence about a picture, and the
    // crossing reads as an agenda rather than an offer. lantern-be7743's turn 2
    // is the fixture: "whose offer is that in your world" after "something in
    // the sky is offering rain to the pond", answered with "couldnt think of
    // any". It clears the level check, because it does not climb.
    const here = session.exchanges
      .slice(0, session.exchanges.indexOf(exchange))
      .filter((e) => e.position === exchange.position);
    if (railBefore && rail === "life" && rail !== railBefore
        && here.length > 0 && here.length < SETTLE_MIN
        && !here.some((e) => e.gate?.has_life_content === true)) {
      findings.push({
        index: session.exchanges.indexOf(exchange), position: exchange.position,
        code: "rail_switch_unsettled",
        message: `crossed to their life off ${here.length} answer on this card, and nothing ` +
                 "of theirs was in it; the bridge had nothing to ride on",
        text: exchange.q,
      });
      // No `continue`: a crossing can be both premature and too high, and those
      // are different repairs. c145c7's turn 3 is both.
    }

    // Crossing rails is a step of its own, so a crossing question that also
    // climbs has taken two. c145c7's turn 3 passed the check above -- one rung,
    // name to consequences -- while switching from the card to their life in
    // the same breath, and got a description of the card back.
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
    .filter((e) => e.position !== "opening" && e.position !== "off_frame" && !e.aside && e.q)
    .map((e) => `${questionLevel(e.q)[0]}${(e.gate?.user_level ?? "?")[0]}`)
    .join(" ");
}

/**
 * White's staircase, drawn. Levels are rows, exchanges are columns.
 *
 *   Q  the reader's question, on the card rail   q  the same, on the life rail
 *   U  their answer, with something of their life in it       u  card only
 *   *  both landed on the same rung
 *   !  a ZPD violation in that column           |  a card turned over after it
 *
 * The point of it is the shape. A staircase that climbs looks like a staircase;
 * c145c7 looks like a flat line along the bottom with one spike, and you can
 * see that in a second where seven lines of findings take a minute.
 */
export function staircase(session, pack) {
  const turns = session.exchanges
    .map((e, index) => ({ e, index }))
    .filter(({ e }) => e.position !== "opening" && e.position !== "off_frame"
                       && !e.aside && e.q);
  if (!turns.length) return "";

  const flagged = new Set(
    scanSession(session, pack)
      .filter((f) => f.code === "level_jump" || f.code === "rail_switch_climb"
                     || f.code === "rail_switch_unsettled")
      .map((f) => f.index));
  const flips = new Map();
  for (const [at, card] of flipsAfterExchange(session)) flips.set(at, card.flip_reason ?? "");
  // Where they first said something of their own, per card. A flip in the same
  // column is the shape this round exists to stop.
  const arrivals = disclosureArrivals(session);

  const width = Math.max(2, ...turns.map((t) => String(t.index + 1).length + 1));
  const cell = (text) => String(text).padEnd(width);
  const label = (text) => String(text).slice(0, 12).padEnd(13);

  const rows = [...pack.levels].reverse().map((level) => {
    const marks = turns.map(({ e }) => {
      const asked = questionLevel(e.q) === level.id;
      const landed = e.gate?.user_level === level.id;
      if (asked && landed) return cell("*");
      if (asked) return cell(questionType(e.q) === "projection" ? "Q" : "q");
      if (landed) return cell(e.gate?.has_life_content ? "U" : "u");
      return cell(".");
    });
    return `${label(level.id)}${marks.join("")}`;
  });

  const ruler = `${label("")}${turns.map((t) => cell(t.index + 1)).join("")}`;
  const alerts = `${label("")}${turns.map((t) => {
    const arrival = arrivals.has(t.index);
    const flip = flips.has(t.index);
    if (arrival && flip) return cell("X");   // flipped on the disclosure itself
    if (flagged.has(t.index)) return cell("!");
    if (arrival) return cell("+");
    if (flip) return cell("|");
    return cell(" ");
  }).join("")}`;
  const notes = [...flips.entries()]
    .filter(([, reason]) => reason)
    .map(([index, reason]) => `    | at ${index + 1}: ${reason}`);
  const noAnswers = turns.every(({ e }) => !e.gate?.user_level);

  return [...rows, alerts, ruler, ...notes,
          "    Q/q question (card/life rail)  U/u answer (life/card content)  * both",
          "    + first disclosure on a card  | card turned after  X turned ON the disclosure  ! ZPD violation",
          ...(noAnswers
            ? ["    (no answer rows: this transcript predates user_level on the gate)"]
            : [])]
    .join("\n");
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
    // Three shapes reach this: a journal export {session}, a bare session, and
    // whatever someone pasted out of localStorage, which the storage module
    // wraps as {v, data}. The last one used to arrive as a TypeError about
    // reading 'map' of undefined.
    const session = parsed.session ?? parsed.data ?? parsed;
    if (!Array.isArray(session?.exchanges)) {
      console.error(`${file}: not a session (no exchanges array)`);
      total += 1;
      continue;
    }
    const findings = scanSession(session, pack);
    total += findings.length;
    console.log(formatFindings(file, findings));
    const drawn = staircase(session, pack);
    if (drawn) console.log(`\n${drawn}\n`);
  }
  process.exit(total ? 1 : 0);
}
