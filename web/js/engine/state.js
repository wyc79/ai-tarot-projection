/**
 * Session state and the rules that move it. No DOM, no fetch, and the only
 * import is the question classifier next door, which is the same kind of
 * thing: a pure function over strings.
 *
 * Everything here is synchronous and testable without a network: the LLM's
 * judgement arrives as a plain gate object, and this module decides what that
 * means for the session. Keeping the decision out of the prompt is what makes
 * the flip rhythm reviewable.
 *
 * flipDecision is the only thing in the codebase that decides a card turns
 * over. The judge used to get a vote too, through a flip_ready boolean, and the
 * 2026-08-25 checkpoint showed what that was worth: false on every gate row of
 * both runs, while every card flipped anyway. Two owners, one of them ignored.
 * The judge now reports depth against a labelled rubric -- the thing it is
 * actually good at -- and the thresholds live here.
 *
 * @typedef {{phrase: string, source: "card"|"life"}} AnchorPhrase
 * @typedef {{theme: string, user_phrases: AnchorPhrase[], resolution_beat: string,
 *            grounded: boolean}} Anchor
 * @typedef {{card_id: string, position: string, user_projection: string,
 *            ai_reading: string, flipped_at: number, flip_reason: string}} DrawnCard
 * @typedef {{q: string, a: string, disclosure_depth: number, position: string,
 *            question_type: "projection"|"life", question_level: string}} Exchange
 * @typedef {{disclosure_depth: number, stakes: "low"|"high"|"crisis",
 *            reading_of_them: string}} Gate
 */

import { questionLevel, questionType } from "./questions.js";

export const STATE_VERSION = 1;

/** The top of the 1-4 disclosure scale: a rich answer earns the next card early. */
export const DEPTH_RICH = 4;
/** A specific situation, with edges. Enough to move on once the rhythm is met. */
export const DEPTH_ENOUGH = 3;
/** The default rhythm: roughly two exchanges per card. */
export const TARGET_EXCHANGES = 2;
/** Hard cap. A thin answer gets one softer follow-up, then the reading moves on
 *  regardless -- a gate the user cannot satisfy is a stalled meter. */
export const MAX_EXCHANGES = 3;

export function createSession({ packId, seed, positions, startedAt = Date.now() }) {
  return {
    schema_version: STATE_VERSION,
    // Seed plus start time: unique enough to key a history list, and readable
    // enough to say out loud when reporting a reading that went wrong.
    session_id: `${seed}-${startedAt}`,
    pack_id: packId,
    seed: String(seed),
    started_at: startedAt,
    positions: positions.map((p) => p.id),
    /** @type {"opening"|"reading"} nothing is dealt until they have been asked */
    phase: "opening",
    /** @type {string|null} what they said they wanted to look at, in their words */
    topic: null,
    /** @type {Anchor|null} committed after the first card, then never contradicted */
    anchor: null,
    /** @type {DrawnCard[]} the ledger */
    cards: [],
    /** @type {Exchange[]} */
    exchanges: [],
    /** @type {"normal"|"drop_frame"} */
    safety_state: "normal",
    /** @type {"low"|"high"|"crisis"} most recent classification */
    last_stakes: "low",
    /** Agency is handed back once, not every turn until they stop mentioning it. */
    handback_given: false,
    closing_reflection: null,
    closed: false,
  };
}

export function currentCard(session) {
  return session.cards.length ? session.cards[session.cards.length - 1] : null;
}

export function currentPosition(session) {
  const index = Math.min(session.cards.length, session.positions.length - 1);
  return session.positions[index];
}

/** Position this card would occupy if flipped now, or null if the spread is full. */
export function nextPosition(session) {
  return session.positions[session.cards.length] ?? null;
}

export function exchangesOnCurrentCard(session) {
  const card = currentCard(session);
  if (!card) return 0;
  return session.exchanges.filter((e) => e.position === card.position).length;
}

/**
 * Has anything of their own life reached this card yet?
 *
 * A card can collect three answers, all of them about the picture, and look
 * from the outside exactly like a card that is going well. This is the question
 * that tells the two apart, and the flip rule below is the only place it
 * changes anything: a card moves on early only when something landed.
 */
export function groundedOnCurrentCard(session) {
  const card = currentCard(session);
  if (!card) return false;
  return session.exchanges.some(
    (e) => e.position === card.position && e.gate?.has_life_content === true);
}

export function flipCard(session, cardId, { flippedAt = Date.now(), reason = "" } = {}) {
  const position = nextPosition(session);
  if (!position) throw new Error("the spread is full");
  session.cards.push({
    card_id: cardId,
    position,
    user_projection: "",
    ai_reading: "",
    flipped_at: flippedAt,
    // Why this card turned, in the words flipDecision used. There is exactly
    // one thing that decides a flip now, and this is it saying so out loud.
    flip_reason: reason,
  });
  return session;
}

/**
 * The turn before anything is dealt. Kept in the transcript like any other
 * exchange, under its own position so it never counts toward a card's rhythm.
 */
export function recordOpening(session, { question, answer, opening }) {
  session.exchanges.push({
    q: question,
    a: answer,
    disclosure_depth: 0,
    position: "opening",
    gate: { ...opening },
  });
  session.topic = opening.has_topic && opening.topic.trim() ? opening.topic.trim() : null;
  session.last_stakes = opening.stakes;
  if (opening.stakes === "crisis") session.safety_state = "drop_frame";
  session.phase = "reading";
  return session;
}

/**
 * A turn with no card in front of it. Happens when the frame was dropped before
 * anything was dealt: the conversation continues, the reading does not.
 */
export function recordOffFrame(session, { question, answer, stakes = "crisis" }) {
  session.exchanges.push({
    q: question,
    a: answer,
    disclosure_depth: 0,
    position: "off_frame",
    gate: { stakes },
  });
  session.last_stakes = stakes;
  return session;
}

/** The user's first words about a card are the projection; later ones are follow-ups. */
export function recordExchange(session, { question, answer, gate }) {
  const card = currentCard(session);
  if (!card) throw new Error("no card is face up");

  if (!card.user_projection) card.user_projection = answer;
  session.exchanges.push({
    q: question,
    a: answer,
    disclosure_depth: gate.disclosure_depth,
    position: card.position,
    // What they were asked, on both axes: what it pointed them at, and how far
    // it reached. The first tells you which depth rubric produced this number;
    // the second is what the scaffolding check compares against the level the
    // answer before it landed on.
    question_type: questionType(question),
    question_level: questionLevel(question),
    // The whole verdict, not just the depth: re-running a transcript after a
    // prompt change is only useful if you can see what the judge thought then.
    gate: { ...gate },
  });

  session.last_stakes = gate.stakes;
  // Crisis is one-way. Once the frame is dropped it stays dropped for the
  // session: coming back with "anyway, your next card..." would be worse than
  // never having dropped it.
  if (gate.stakes === "crisis") session.safety_state = "drop_frame";
  return session;
}

/**
 * Attach a reader turn to the card it was about. `offset` steps back through the
 * ledger: a bridge turn answers the previous card while the next one is already
 * face up, so it belongs to the card behind it.
 */
export function recordReading(session, text, { offset = 0 } = {}) {
  const card = session.cards[session.cards.length - 1 - offset];
  if (card) card.ai_reading = text;
  return session;
}

export function commitAnchor(session, anchor) {
  if (session.anchor) return session; // committed once, then elaborated only
  // Tolerate a bare string: transcripts written before phrases carried a source
  // still load, and they load as what they were, which was untagged.
  const phrases = (anchor.user_phrases ?? []).map((p) =>
    (typeof p === "string" ? { phrase: p, source: "card" } : { phrase: p.phrase, source: p.source }));
  session.anchor = {
    theme: anchor.theme,
    user_phrases: phrases,
    resolution_beat: anchor.resolution_beat,
    // Derived here rather than asked of the judge, so it cannot disagree with
    // the tags it just wrote. An anchor built entirely out of the picture is an
    // anchor about nobody, and the rest of the reading needs to know that.
    grounded: phrases.some((p) => p.source === "life"),
  };
  return session;
}

/**
 * The flip gate. Returns why, not just whether, because the debug page shows
 * the reason and a reason that reads badly is a rule that is wrong.
 *
 * @param {object} session
 * @param {Gate} gate
 * @returns {{flip: boolean, reason: string}}
 */
export function flipDecision(session, gate) {
  if (session.safety_state === "drop_frame") {
    return { flip: false, reason: "frame dropped; cards are not the point now" };
  }
  const count = exchangesOnCurrentCard(session);
  if (count === 0) {
    return { flip: false, reason: "no answer on this card yet" };
  }

  // Nothing of theirs has reached this card. The early exits below are rewards
  // for a card that did its job, so they are switched off -- but only the early
  // ones. The counted exits still fire: a gate someone cannot satisfy is a
  // stalled meter, and someone who will not talk about themselves is allowed to
  // have that be the reading. When it happens the reason says so, because a
  // ledger full of ungrounded flips is the diagnosis for a whole session.
  const grounded = groundedOnCurrentCard(session);
  const ungrounded = grounded ? "" : " — ungrounded, nothing of theirs landed on this card";

  if (grounded && gate.disclosure_depth >= DEPTH_RICH) {
    return { flip: true, reason: `rich answer (depth ${gate.disclosure_depth}) earns the next card early` };
  }
  // The last card has nowhere to advance to: flipping it means closing. So its
  // budget is tighter than the others' and depth stops being a condition --
  // the projection exchange, one follow-up at most, then the closing beat.
  // A reading that ends without one is worse than a reading that ends early.
  if (nextPosition(session) === null && count >= TARGET_EXCHANGES) {
    return { flip: true, reason: `last card and ${count} exchanges; closing regardless of depth${ungrounded}` };
  }
  if (grounded && gate.disclosure_depth >= DEPTH_ENOUGH && count >= TARGET_EXCHANGES) {
    return { flip: true, reason: `depth ${gate.disclosure_depth} after ${count} exchanges` };
  }
  if (count >= MAX_EXCHANGES) {
    return { flip: true, reason: `${count} exchanges on one card; moving on rather than stalling${ungrounded}` };
  }
  return { flip: false, reason: `depth ${gate.disclosure_depth} after ${count}; one softer follow-up${ungrounded}` };
}

/** True once every position has been read to its depth. */
export function spreadComplete(session) {
  return session.cards.length >= session.positions.length && nextPosition(session) === null;
}

export function isReadyToClose(session, gate) {
  return spreadComplete(session) && flipDecision(session, gate).flip;
}

export function close(session, reflection) {
  session.closing_reflection = reflection;
  session.closed = true;
  return session;
}
