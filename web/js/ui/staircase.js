/**
 * White's staircase, drawn. Plain SVG built as a string, no libraries.
 *
 * x is the exchange, y is the level. Two traces over the same grid:
 *
 *   the step line   what the reader asked, level by level. Hollow marks are
 *                   questions about the card, filled ones are about their life
 *   the answers     where each answer actually landed. Hollow is card content,
 *                   green is something of theirs
 *
 * Dashed rules are flips, labelled with the reason the engine recorded. A red
 * ring is a scaffolding violation -- a question more than one rung above them,
 * one crossing off a card that has nothing under it yet, or one
 * that crossed rails and climbed at the same time. A red arrow under a column
 * is a deflection.
 *
 * Reads session.exchanges and the pack's ladder. It adds no state and stores
 * nothing: everything here is already recorded, this only makes the shape of it
 * visible, which is the one thing a column of JSON will not do.
 */

import { levelDistance, levelIndex } from "../engine/levels.js";
import { SETTLE_MIN, disclosureArrivals, flipsAfterExchange } from "../engine/state.js";
import { questionLevel, questionType } from "../engine/questions.js";

const PAD = { left: 62, right: 10, top: 10, bottom: 18 };
// Question and answer belong to the same exchange, so they share a column --
// but they land on the same rung often enough that stacking them hides one.
// Four pixels inside a twenty-six pixel step reads as one column, not two.
const NUDGE = 4;
const STEP = 26;
const ROW = 16;

const escape = (text) => String(text).replace(/[<>&"]/g,
  (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));

/**
 * Turns worth drawing: everything asked once the cards were out, plus the
 * question hanging in the air.
 *
 * A question and its answer share one exchange record, so a diagram built from
 * exchanges alone is always one turn behind what is on screen -- it cannot show
 * the question you are currently being asked. That is the turn most worth
 * seeing, because a question aimed two rungs too high is visible while you are
 * still deciding how to answer it.
 */
function drawable(session, pending) {
  const turns = session.exchanges
    .map((exchange, index) => ({ exchange, index }))
    .filter(({ exchange }) => exchange.q
      && exchange.position !== "opening" && exchange.position !== "off_frame");
  if (pending && session.cards.length) {
    turns.push({
      exchange: { q: pending, a: "", position: session.cards[session.cards.length - 1].position },
      index: session.exchanges.length,
      pending: true,
    });
  }
  return turns;
}

/**
 * Which columns broke the scaffolding rules, and why, without re-running the
 * scanner. Three ways: too high, crossing and climbing at once, or crossing off
 * a card with nothing under it yet.
 */
function violations(pack, turns) {
  const bad = new Map();
  for (const [column, { exchange, index }] of turns.entries()) {
    const previous = turns[column - 1]?.exchange ?? null;
    const standing = previous?.gate?.user_level;
    if (!standing || levelIndex(pack, standing) === -1) continue;
    const level = questionLevel(exchange.q);
    const jump = levelDistance(pack, standing, level);
    const rail = questionType(exchange.q);
    const railBefore = previous.question_type ?? questionType(previous.q ?? "");
    // Answers already on this card when this question was asked.
    const here = turns.slice(0, column)
      .map((t) => t.exchange)
      .filter((e) => e.position === exchange.position);
    // Premature and too-high are separate faults with separate repairs, and one
    // turn can be both -- c145c7's turn 3 is. Height reports once: the bigger
    // number is the one to read, same as the scanner.
    const reasons = [];
    if (rail === "life" && rail !== railBefore
        && here.length > 0 && here.length < SETTLE_MIN
        && !here.some((e) => e.gate?.has_life_content === true)) {
      reasons.push(`crossed off ${here.length} answer on this card`);
    }
    if (jump > 1) {
      reasons.push(`asked at ${level} from ${standing}`);
    } else if (rail !== railBefore && jump > 0) {
      reasons.push(`crossed to ${rail} and climbed to ${level}`);
    }
    if (reasons.length) bad.set(index, reasons.join("; "));
  }
  return bad;
}

/**
 * @param {object} session
 * @param {object} pack
 * @returns {string} SVG markup, or "" when there is nothing to draw yet
 */
export function staircaseSvg(session, pack, { pending = "" } = {}) {
  const turns = drawable(session, pending);
  if (!turns.length) return "";

  const levels = [...pack.levels].reverse();
  const width = PAD.left + PAD.right + STEP * turns.length;
  const height = PAD.top + PAD.bottom + ROW * levels.length;
  const x = (column) => PAD.left + STEP * column + STEP / 2;
  const y = (levelId) => {
    const row = levels.findIndex((l) => l.id === levelId);
    return row === -1 ? null : PAD.top + ROW * row + ROW / 2;
  };

  const bad = violations(pack, turns);
  const parts = [];

  for (const level of levels) {
    const row = y(level.id);
    parts.push(`<line class="grid" x1="${PAD.left}" y1="${row}" x2="${width - PAD.right}" y2="${row}"/>`);
    parts.push(`<text class="rung" x="${PAD.left - 5}" y="${row + 2.5}" text-anchor="end">${level.id}</text>`);
  }

  // Flips first, so the marks sit on top of their rules. A flip belongs to the
  // exchange it followed, which is how a card that turned over and then had
  // nothing said about it still gets a line.
  const flips = flipsAfterExchange(session);
  const arrivals = disclosureArrivals(session);
  for (const [after, card] of flips) {
    const column = turns.findIndex(({ index }) => index === after);
    if (column === -1) continue;
    const onDisclosure = arrivals.has(after);
    const at = x(column) + STEP / 2;
    parts.push(`<line class="flip${onDisclosure ? " on-disclosure" : ""}" x1="${at}" `
      + `y1="${PAD.top}" x2="${at}" y2="${height - PAD.bottom}"><title>`
      + `${escape(card.flip_reason ?? "flip")}`
      + `${onDisclosure ? " — turned over on the turn they first said something of their own" : ""}`
      + `</title></line>`);
  }

  const line = [];
  for (const [column, { exchange, index, pending: unanswered }] of turns.entries()) {
    const asked = questionLevel(exchange.q);
    const at = x(column);
    const askedAt = at - NUDGE;
    const askedY = y(asked);
    if (askedY !== null) line.push(`${askedAt},${askedY}`);

    const projection = questionType(exchange.q) === "projection";
    parts.push(`<circle class="${projection ? "q-card" : "q-life"}${unanswered ? " pending" : ""}" `
      + `cx="${askedAt}" cy="${askedY}" r="3.2">`
      + `<title>${escape(exchange.q)}${unanswered ? " (waiting on you)" : ""}</title></circle>`);

    const landed = exchange.gate?.user_level;
    const landedY = landed ? y(landed) : null;
    if (landedY !== null) {
      const grounded = exchange.gate?.has_life_content === true;
      const answerAt = at + NUDGE;
      // The moment the reading found them. Everything the dwell rule protects
      // happens in the two columns after this one.
      if (arrivals.has(index)) {
        parts.push(`<circle class="arrival" cx="${answerAt}" cy="${landedY}" r="6">`
          + `<title>first time they said something of their own</title></circle>`);
      }
      if (exchange.gate?.hedged) {
        parts.push(`<text class="hedge" x="${answerAt + 7}" y="${landedY - 4}">?</text>`);
      }
      parts.push(`<rect class="${grounded ? "u-life" : "u-card"}" x="${answerAt - 3}" y="${landedY - 3}" `
        + `width="6" height="6" transform="rotate(45 ${answerAt} ${landedY})">`
        + `<title>${escape(exchange.a ?? "")}</title></rect>`);
    }

    if (!unanswered && exchange.disclosure_depth === 1) {
      const foot = height - PAD.bottom + 5;
      parts.push(`<path class="drop" d="M${at},${foot - 5} L${at},${foot} M${at - 2.5},${foot - 2.5} `
        + `L${at},${foot} L${at + 2.5},${foot - 2.5}"><title>deflection</title></path>`);
    }
    if (bad.has(index)) {
      parts.push(`<circle class="violation" cx="${askedAt}" cy="${askedY}" r="6.5">`
        + `<title>${escape(bad.get(index))}</title></circle>`);
    }
    parts.push(`<text class="tick" x="${at}" y="${height - 5}" text-anchor="middle">${index + 1}</text>`);
  }

  parts.unshift(`<polyline class="asked" points="${line.join(" ")}"/>`);

  return `<svg class="staircase" viewBox="0 0 ${width} ${height}" role="img" `
    + `aria-label="scaffolding levels per exchange">${parts.join("")}</svg>`;
}
