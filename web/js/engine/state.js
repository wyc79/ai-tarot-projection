/**
 * Session state and the rules that move it. No DOM, no fetch, no imports.
 *
 * Everything here is synchronous and testable without a network: the LLM's
 * judgement arrives as a plain gate object, and this module decides what that
 * means for the session. Keeping the decision out of the prompt is what makes
 * the flip rhythm reviewable.
 *
 * @typedef {{theme: string, user_phrases: string[], resolution_beat: string}} Anchor
 * @typedef {{card_id: string, position: string, user_projection: string,
 *            ai_reading: string, flipped_at: number}} DrawnCard
 * @typedef {{q: string, a: string, disclosure_depth: number, position: string}} Exchange
 * @typedef {{disclosure_depth: number, flip_ready: boolean,
 *            stakes: "low"|"high"|"crisis"}} Gate
 */

export const STATE_VERSION = 1;

/** The top of the 1-4 disclosure scale: a rich answer earns the next card early. */
export const DEPTH_RICH = 4;
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

export function flipCard(session, cardId, flippedAt = Date.now()) {
  const position = nextPosition(session);
  if (!position) throw new Error("the spread is full");
  session.cards.push({
    card_id: cardId,
    position,
    user_projection: "",
    ai_reading: "",
    flipped_at: flippedAt,
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
  session.anchor = {
    theme: anchor.theme,
    user_phrases: [...anchor.user_phrases],
    resolution_beat: anchor.resolution_beat,
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
  if (gate.disclosure_depth >= DEPTH_RICH) {
    return { flip: true, reason: `rich answer (depth ${gate.disclosure_depth}) earns the next card early` };
  }
  if (gate.flip_ready && count >= TARGET_EXCHANGES) {
    return { flip: true, reason: `judge says ready after ${count} exchanges` };
  }
  if (count >= MAX_EXCHANGES) {
    return { flip: true, reason: `${count} exchanges on one card; moving on rather than stalling` };
  }
  return { flip: false, reason: `depth ${gate.disclosure_depth} after ${count}; one softer follow-up` };
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
