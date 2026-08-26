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
/** The default rhythm, for a pack whose positions do not set their own. */
export const TARGET_EXCHANGES = 2;
/** Default hard cap. A thin answer gets one softer follow-up, then the reading
 *  moves on regardless -- a gate the user cannot satisfy is a stalled meter. */
export const MAX_EXCHANGES = 3;
/** Exchanges to spend inside a fresh disclosure before the card may turn. */
export const DWELL_MIN = 1;
/** Exchanges to spend on a card before the bridge to their life is eligible. */
export const SETTLE_MIN = 2;
/** How far past the hard cap a card may run, and only to stay inside a
 *  disclosure. The cap exists so nobody is stuck on a card they have nothing to
 *  say about; someone who has just said something is not that person. */
export const DWELL_GRACE = 1;

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
    // Per-position pacing, denormalised off the pack the way positions are, and
    // for the same two reasons: the rules in this file stay pack-agnostic, and a
    // session replayed months later paces the way it actually paced rather than
    // the way the pack does now.
    //
    // It rises across the arc, alongside the level ceiling, because the two are
    // the same shape: setup, then tension, then resolution. The card whose job
    // is to find the ground does not need long to find out that it has not, and
    // the cards after it are working with material that took a while to arrive.
    budget: Object.fromEntries(positions.map((p) => [p.id, {
      target: p.target ?? TARGET_EXCHANGES,
      max: p.max ?? MAX_EXCHANGES,
    }])),
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
    /** The spread is done and the closing beat has been given. */
    closed: false,
    /** They said they were done. Only a person sets this. */
    ended: false,
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

/**
 * What the card currently face up is allowed to spend.
 *
 * Falls back to the constants, so a session recorded before positions carried a
 * budget still paces -- every fixture in tests/ is one of those.
 */
export function budgetOnCurrentCard(session) {
  const card = currentCard(session);
  const budget = card && session.budget?.[card.position];
  return {
    target: budget?.target ?? TARGET_EXCHANGES,
    max: budget?.max ?? MAX_EXCHANGES,
  };
}

export function exchangesOnCurrentCard(session) {
  const card = currentCard(session);
  if (!card) return 0;
  return session.exchanges.filter((e) => e.position === card.position).length;
}

/**
 * The same count, minus the answers they held at arm's length.
 *
 * A hedged answer does not advance the card toward its early exits: someone
 * saying "i guess so?" is checking whether it was safe, and treating that as
 * progress is how a reading walks off with something the person had not decided
 * to give it.
 *
 * The hard cap still counts every exchange. Otherwise a person who hedges
 * everything is a person the reading can never move on from, which is the
 * stalled meter this design has been avoiding since the first flip rule.
 */
export function countingExchangesOnCurrentCard(session) {
  const card = currentCard(session);
  if (!card) return 0;
  return session.exchanges.filter(
    (e) => e.position === card.position && !e.gate?.hedged).length;
}

/**
 * Has anything of their own life reached this card yet?
 *
 * A card can collect three answers, all of them about the picture, and look
 * from the outside exactly like a card that is going well. This is the question
 * that tells the two apart, and the flip rule below is the only place it
 * changes anything: a card moves on early only when something landed.
 */
/**
 * Whether the card is holding something they have only just said, and how much
 * has been spent inside it.
 *
 * The flip is the reward mechanic, so what it rewards is what the reading
 * teaches. Flipping on the turn someone first says something real teaches that
 * opening up ends the subject -- which is the gradient this whole design exists
 * to run the other way. So the first life disclosure on a card buys a turn
 * inside itself before the card can turn over.
 *
 * Hedged answers do not count toward the dwell. "I guess so?" is someone
 * checking whether it was safe to say, and answering that with a scene change
 * is the same mistake in a smaller font.
 */
export function dwellOnCurrentCard(session) {
  const card = currentCard(session);
  if (!card) return { arrived: false, spent: 0, satisfied: true };
  const here = session.exchanges.filter((e) => e.position === card.position);
  const arrival = here.findIndex((e) => e.gate?.has_life_content === true);
  if (arrival === -1) return { arrived: false, spent: 0, satisfied: true };
  const spent = here.slice(arrival + 1).filter((e) => !e.gate?.hedged).length;
  return { arrived: true, spent, satisfied: spent >= DWELL_MIN };
}

/**
 * Whether the card has enough footing under it to bridge to their life yet.
 *
 * The pre-disclosure sibling of the dwell rule, and it exists for the same
 * reason in the opposite direction. A first read of a card is one sentence, and
 * a bridge thrown across it -- "whose offer is that in your world?" after "the
 * sky is offering rain to the pond" -- has nothing to ride on. It reads as an
 * agenda, because it is one: the reader wanted their life and asked for it the
 * moment there was a noun to hang the question on.
 *
 * lantern-be7743 is the failing fixture. Its turn-2 bridge got "couldnt think
 * of any", and the elaboration question that followed the whiff -- what is it
 * about the rain that reads as positive -- got the richest answer of the
 * session. The material the bridge needed was one turn away in the picture.
 *
 * Two ways to earn it. Two exchanges on this card, which is the elaboration
 * path; or one answer that already had something of theirs in it, in which case
 * they crossed on their own and there is nothing left to earn.
 */
export function settleOnCurrentCard(session) {
  const card = currentCard(session);
  if (!card) return { spent: 0, selfReferent: false, settled: false };
  const here = session.exchanges.filter((e) => e.position === card.position);
  const selfReferent = here.some((e) => e.gate?.has_life_content === true);
  return {
    spent: here.length,
    selfReferent,
    settled: selfReferent || here.length >= SETTLE_MIN,
  };
}

/**
 * Which exchange each card turned over after, as index -> card.
 *
 * A card flips at the end of the previous card's run, so the flip belongs to
 * the last exchange of the card before it -- not to the first exchange of its
 * own, which finds nothing when the new card has no exchanges yet. That is the
 * case that matters: a card turning over and the session stopping there.
 */
export function flipsAfterExchange(session) {
  const lastOf = new Map();
  for (const [index, exchange] of session.exchanges.entries()) {
    if (exchange.position === "opening" || exchange.position === "off_frame") continue;
    lastOf.set(exchange.position, index);
  }
  const flips = new Map();
  for (const [ordinal, card] of session.cards.entries()) {
    if (ordinal === 0) continue;                    // dealt, not earned
    const at = lastOf.get(session.cards[ordinal - 1].position);
    if (at !== undefined) flips.set(at, card);
  }
  return flips;
}

/** Exchange indexes where they first said something of their own, per card. */
export function disclosureArrivals(session) {
  const seen = new Set();
  const arrivals = new Set();
  for (const [index, exchange] of session.exchanges.entries()) {
    if (exchange.gate?.has_life_content !== true || seen.has(exchange.position)) continue;
    seen.add(exchange.position);
    arrivals.add(index);
  }
  return arrivals;
}

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

/**
 * Fold new material into a committed anchor.
 *
 * The anchor used to freeze on the first card, which was right when the first
 * card was the only thing it could be built from. Now that a disclosure buys a
 * turn inside itself, the material that matters most usually arrives after the
 * commit -- so the theme and the beat can be rewritten, and phrases append
 * rather than replace. What was said stays said.
 */
export function updateAnchor(session, anchor) {
  if (!session.anchor) return commitAnchor(session, anchor);
  const seen = new Set(session.anchor.user_phrases.map((p) => p.phrase));
  const added = (anchor.user_phrases ?? [])
    .map((p) => (typeof p === "string" ? { phrase: p, source: "card" } : p))
    .filter((p) => p.phrase && !seen.has(p.phrase));
  session.anchor = {
    theme: anchor.theme || session.anchor.theme,
    user_phrases: [...session.anchor.user_phrases, ...added],
    resolution_beat: anchor.resolution_beat || session.anchor.resolution_beat,
    grounded: false,
  };
  session.anchor.grounded = session.anchor.user_phrases.some((p) => p.source === "life");
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
  // Hedged answers do not buy progress toward the early exits; the cap below
  // still counts them, so nothing stalls.
  const earned = countingExchangesOnCurrentCard(session);
  const { target, max } = budgetOnCurrentCard(session);

  // Nothing of theirs has reached this card. The early exits below are rewards
  // for a card that did its job, so they are switched off -- but only the early
  // ones. The counted exits still fire: a gate someone cannot satisfy is a
  // stalled meter, and someone who will not talk about themselves is allowed to
  // have that be the reading. When it happens the reason says so, because a
  // ledger full of ungrounded flips is the diagnosis for a whole session.
  const grounded = groundedOnCurrentCard(session);
  const ungrounded = grounded ? "" : " — ungrounded, nothing of theirs landed on this card";

  // They have just handed you something. Stay in it for a turn.
  //
  // Released the moment they deflect: someone who wishes they had not said it
  // is not held in the subject, and the counted exits below still apply, so the
  // dwell can delay a card by one exchange and never more than that.
  const dwell = dwellOnCurrentCard(session);
  const dwelt = dwell.arrived && dwell.satisfied ? ", dwelt on first" : "";
  if (!dwell.satisfied && gate.disclosure_depth > 1) {
    // One exchange past the cap, and only here. Three transitions now have to
    // fit on one card -- settle before bridging, bridge, then dwell -- and
    // three of them do not fit in three exchanges. Without the grace, every
    // card that grounds by the elaboration path grounds on its last exchange
    // and gets cut short, which puts the flip-on-disclosure shape back on the
    // map that the previous round took off it.
    //
    // It buys nothing for a card nobody disclosed on: no arrival, no dwell, no
    // grace, and a card of pure description still moves on at three.
    if (count < max + DWELL_GRACE) {
      return {
        flip: false,
        reason: "they just told you something of their own; one exchange inside it "
          + "before the reading moves on",
      };
    }
    // They disclosed, and then held the follow-up at arm's length -- a hedged
    // answer does not satisfy a dwell, so the grace above ran out with the
    // dwell still open. The cap wins: a card that cannot be satisfied is worse
    // than a dwell cut short. Recorded as its own reason, because "they opened
    // up just as we ran out of room" is worth being able to count across
    // sessions.
    return {
      flip: true,
      reason: `${count} exchanges on one card; moving on rather than stalling `
        + "— cutting a fresh disclosure short",
    };
  }


  // The last card has nowhere to advance to: flipping it means closing. So its
  // budget is tighter than the others' and depth stops being a condition --
  // the projection exchange, one follow-up at most, then the closing beat.
  // A reading that ends without one is worse than a reading that ends early.
  if (nextPosition(session) === null && earned >= target) {
    return { flip: true, reason: `last card and ${count} exchanges; closing regardless of depth${ungrounded}` };
  }
  // A rich answer used to take the next card immediately, whatever had been
  // spent here -- and that is what left a card two exchanges long in the seeded
  // fixture, the strongest thing anyone said on it being the thing that ended
  // it. It now spends the position's budget like any other. The depth is still
  // in the reason, because how a card was earned is worth being able to read.
  if (grounded && gate.disclosure_depth >= DEPTH_ENOUGH && earned >= target) {
    const rich = gate.disclosure_depth >= DEPTH_RICH ? "rich " : "";
    return { flip: true, reason: `${rich}depth ${gate.disclosure_depth} after ${count} exchanges${dwelt}` };
  }
  if (count >= max) {
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

/**
 * A turn after the reading closed.
 *
 * Under its own position rather than the advice card's, for the same reason the
 * opening turn has one: it must not count toward a card's rhythm. Nothing here
 * can flip anything -- the spread is full and the beat has been given -- but the
 * stakes still land, because a person is still talking and the frame can still
 * need dropping.
 */
export function recordAfterward(session, { question, answer, gate }) {
  session.exchanges.push({
    q: question,
    a: answer,
    disclosure_depth: gate.disclosure_depth ?? 0,
    position: "afterward",
    question_type: questionType(question),
    question_level: questionLevel(question),
    gate: { ...gate },
  });
  session.last_stakes = gate.stakes ?? session.last_stakes;
  if (gate.stakes === "crisis") session.safety_state = "drop_frame";
  return session;
}

/**
 * They said they were done.
 *
 * The reading closes on its own -- that rule is not negotiable and nothing here
 * touches it. What changes is that closing no longer hangs up on them. The beat
 * is given, the ledger is sealed, and if they keep talking the reader keeps
 * answering until they stop. Ending is theirs.
 */
export function end(session) {
  session.ended = true;
  return session;
}
