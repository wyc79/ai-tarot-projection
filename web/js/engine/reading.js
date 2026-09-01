/**
 * The session controller: one reading, start to close.
 *
 * Takes a pack, an llmClient and a storage as arguments and calls nothing
 * global, so a test can drive a whole session with a fake client and no
 * network. All DOM work happens in the UI layer, which listens to onEvent.
 *
 * The shape of a turn:
 *   judge the answer -> record it -> decide whether the next card is earned
 *   -> the reader either stays on this card, bridges to the next one, or closes.
 *
 * The judge decides how deep the answer was. This file decides what that means.
 * Keeping those apart is what makes the flip rhythm testable without a model.
 */

import { saveToHistory } from "./journal.js";
import { judgements } from "./judgements.js";
import { flipDirection, readerCall } from "./prompts.js";
import {
  afterglowDrift, close, commitAnchor, createSession, currentCard, dealtCardFor, end,
  epilogueEarned, farewellDue, flipCard, flipDecision, flipEpilogue, nameCard, namedCards,
  nextPosition, recordAfterward, recordExchange, recordOffFrame, recordAside,
  recordOpening, recordReading, spreadComplete, stayAWhile, updateAnchor,
} from "./state.js";
import { makeDeal } from "./draw.js";
import { newSeed } from "./rng.js";

export const SESSION_KEY = "session";

/**
 * What goes on the record when they press the button rather than type.
 * Parenthesised because it is an action, not something they said in words.
 */
export const MEANINGS_REQUEST = "(what do these cards traditionally mean)";

/**
 * A reader turn with the quotation marks the model wrapped around it removed.
 *
 * The few-shots no longer teach this, which is the actual fix, but "do not put
 * quotes around your turn" is the kind of instruction a model follows most of
 * the time. The failure is visible to the person and looks like the reader
 * reading from a script, so it is worth catching on the way out as well.
 *
 * Quoting is legitimate INSIDE a turn -- the persona requires their words back
 * exactly, and a turn often opens on one. So a pair is only stripped when it
 * wraps the entire thing: the quotes are balanced, and what is left still ends
 * the way a turn ends. "Pretending king" — strong words. What makes this one
 * real? keeps its quotes, because the last character is a question mark.
 */
export function unwrapQuotes(text) {
  const trimmed = String(text ?? "").trim();
  if (trimmed.length < 2) return trimmed;
  const wrapped = (trimmed.startsWith('"') && trimmed.endsWith('"')
                   && trimmed.match(/"/g).length % 2 === 0)
    || (trimmed.startsWith("\u201c") && trimmed.endsWith("\u201d"));
  if (!wrapped) return trimmed;
  const inner = trimmed.slice(1, -1).trim();
  // A turn ends on its question, or on the closing step. Anything else and the
  // two quotes were doing work of their own.
  return /[.?!]$/.test(inner) ? inner : trimmed;
}

/**
 * @param {object} options
 * @param {object} options.pack
 * @param {object} options.client
 * @param {object} [options.storage]
 * @param {string} [options.seed]
 * @param {(event: object) => void} [options.onEvent]
 * @param {"dealt"|"physical"} [options.cardSource]  whose deck this is
 * @param {(request: {position: string, taken: string[]}) => Promise<string>} [options.identifyCard]
 *   Physical mode only: they have just been told to turn a card over, and this
 *   resolves with what they say it is. The one seam the mode needs -- the engine
 *   still does not know what a picker is.
 */
export function startReading({
  pack, client, storage = null, seed = newSeed(), onEvent = () => {},
  cardSource = "dealt", identifyCard = null,
}) {
  const physical = cardSource === "physical";
  if (physical && !identifyCard) {
    throw new Error("physical mode needs identifyCard: nothing else can know what they drew");
  }

  // The whole spread comes off the pile at once, epilogue included, and goes
  // face down on the table before anything is said. Nothing about the pacing
  // changes -- cards still turn over only when the reading earns them -- but
  // the topology is visible from the first second rather than assembling itself
  // a card at a time, and the incentive the flip gate runs on is a thing they
  // can see rather than a thing they are told about.
  //
  // Same pile, same order, so a seed deals what it always dealt.
  //
  // When the deck is theirs, none of that changes except who holds the pile.
  // They lay four down face down; the app deals nothing and knows nothing until
  // a position turns over and they say what came up.
  const deal = physical ? null : makeDeal(pack.cards.map((c) => c.card_id), seed);
  const session = createSession({
    packId: pack.id, seed: physical ? null : seed, cardSource,
    positions: pack.positions, epilogue: pack.epilogue,
    deal: physical ? [] : deal.take(pack.positions.length + (pack.epilogue ? 1 : 0)),
  });

  // The seed is logged the moment the session exists: a reading nobody can
  // reproduce is a reading nobody can debug.
  onEvent({ type: "session_start", seed: session.seed, pack: pack.id, cardSource });

  // The three judgements, bound to this reading's client and pack. Everything
  // about how one is assembled -- which system prompt, which messages, which
  // schema, and the anchor's re-ask -- is behind these three names.
  const judge = judgements({
    client,
    pack,
    onBeatRetry: (beat) => onEvent({ type: "anchor_retry", beat }),
  });

  let lastQuestion = "";

  /**
   * Which card is lying on this position.
   *
   * The whole of the physical mode, in one function. Dealt, it is a lookup that
   * was settled by the seed before the reading started. Theirs, it is a pause
   * while somebody turns a real card over and says what it is -- and the only
   * asynchronous thing between the flip decision and the flip.
   *
   * It is called from inside the earned branch and nowhere else, which is what
   * keeps the mode's best moment intact: a fourth card that is not earned is
   * never asked about, so it stays face down on their table and unnamed here.
   */
  async function cardFor(position) {
    if (!physical) return dealtCardFor(session, position);
    const cardId = await identifyCard({ position, taken: namedCards(session) });
    // The engine keeps the deck's arithmetic, not the picker: 78 cards, once
    // each. nameCard throws if this one is already on the table.
    nameCard(session, position, cardId);
    persist();
    onEvent({ type: "identified", position, card: pack.card(cardId) });
    return cardId;
  }

  function persist() {
    if (!storage) return;
    storage.set(SESSION_KEY, session);
    // Into the history on every turn, not at the end: the readings worth
    // keeping are often the ones that go somewhere unexpected and stop there.
    saveToHistory(storage, session);
  }

  async function readerTurn(turn, { stageDirection = null, readingOffset = 0, onCard = true } = {}) {
    // Hand agency back on the first high-stakes turn only. Saying it again every
    // time the subject resurfaces turns honesty into a disclaimer.
    const handback = session.last_stakes === "high" && !session.handback_given;
    const { kind, plan, system, messages } =
      readerCall({ pack, session, turn, handback, stageDirection });
    onEvent({ type: "reader_start", turn: kind, plan });

    const raw = await client.chat({
      kind,
      system,
      messages,
      onDelta: (delta, full) => onEvent({ type: "reader_delta", delta, full }),
    });
    // Deltas go out as they arrive, so a leading quote is on screen for as long
    // as the turn takes to finish. It is the price of streaming, and it is a
    // flicker rather than a transcript with quotes in it.
    const text = unwrapQuotes(raw);

    if (handback) session.handback_given = true;
    // A turn after the reading closed belongs to no card: the advice card's
    // ai_reading is the closing beat, and overwriting it with whatever was said
    // afterwards rewrites how the reading ended.
    if (onCard) recordReading(session, text, { offset: readingOffset });
    lastQuestion = text;
    // And on the session, which is the half that survives the tab closing.
    // lastQuestion steers the next turn; this is the record of the turn, held
    // until an answer, the closing step or the goodbye takes it.
    session.pending_question = text;
    onEvent({ type: "reader_done", text, turn });
    persist();
    return text;
  }

  /**
   * Start revising the anchor, without waiting for it.
   *
   * The anchor is a narrative plan: its job is to steer the questions that come
   * next. This turn's reply does not need it -- the reply has the whole session
   * record and their actual words in front of it -- so making it wait was
   * putting a second round trip in front of the thing the person is watching
   * for, on exactly the turns where they had just said something real and were
   * most aware of the pause.
   *
   * It runs alongside the reader turn instead and is settled before say()
   * resolves, so the next turn sees it. Nothing reads session state until then,
   * and chat() does not touch the session until it is done, so there is nothing
   * here for the two of them to race over.
   */
  function beginAnchorRevision(gate) {
    if (!session.anchor || !gate.has_life_content || gate.hedged) return null;
    return judge.anchor(session, { rolling: true }).catch((error) => {
      // A failed revision is not a failed turn. The reading carries on with the
      // plan it already had, and says so rather than swallowing it.
      onEvent({ type: "anchor_failed", error: error.message });
      return null;
    });
  }

  async function settleAnchorRevision(pending) {
    if (!pending) return;
    const revised = await pending;
    if (!revised) return;
    updateAnchor(session, revised);
    persist();
    onEvent({ type: "anchor", anchor: session.anchor, rolling: true });
  }

  /** Everything the gate implies, once it is in: hold, bridge, or close. */
  async function advance(gate) {
    const decision = flipDecision(session, gate);
    onEvent({ type: "flip_decision", decision, gate });

    if (!decision.flip) {
      await readerTurn("respond");
      return { gate, decision };
    }

    // The anchor is committed off the first card, before any second card
    // exists to be reconciled with it.
    if (!session.anchor) {
      commitAnchor(session, await judge.anchor(session));
      // Persist before announcing: a listener that reads storage on the event
      // would otherwise see the state as it was a moment ago.
      persist();
      onEvent({ type: "anchor", anchor: session.anchor });
    }

    if (spreadComplete(session)) {
      // The fourth card is decided HERE, before anything is closed, and that is
      // the whole of this round's ending fix. Asked afterwards it produced two
      // endings -- a reflection over three cards, then a card, then a second
      // reflection reusing the first one's formula. Asked here it produces one:
      // either the epilogue turns and the close covers four, or it stays face
      // down and the close names it in a line.
      if (epilogueEarned(session)) {
        flipEpilogue(session, await cardFor(session.epilogue_position), {
          reason: "earned before the close: the reading had somewhere left to go",
        });
        const entry = currentCard(session);
        onEvent({ type: "flip", card: pack.card(entry.card_id), position: entry.position,
                  reason: entry.flip_reason });
        await readerTurn("epilogue", {
          stageDirection: flipDirection(pack, session),
          readingOffset: 1,
        });
        return { gate, decision, flipped: true };
      }
      const text = await readerTurn("close");
      close(session, text);
      // The spread is spent. What is left is a short tail and a goodbye.
      session.phase = "afterward";
      persist();
      onEvent({ type: "closed", reflection: text });
      return { gate, decision, closed: true };
    }

    await flipNext(decision.reason);
    // A bridge answers the card behind it while the new one is already up.
    await readerTurn("bridge", {
      stageDirection: flipDirection(pack, session),
      readingOffset: 1,
    });
    return { gate, decision, flipped: true };
  }

  async function flipNext(reason) {
    // Off the table, not off the pile: the card has been lying on this position
    // face down since the reading began.
    flipCard(session, await cardFor(nextPosition(session)), { reason });
    const entry = currentCard(session);
    onEvent({ type: "flip", card: pack.card(entry.card_id), position: entry.position, reason });
    return entry;
  }


  // One turn at a time, over one session.
  //
  // Two say() calls running at once is not a slower version of one. The second
  // answer is gated against the question the first turn has not replaced yet,
  // two reader turns interleave into one transcript, and the first turn's reply
  // lands underneath the second answer -- which is what the first playtester
  // saw, after sending twice into several seconds of silence. The UI locks its
  // form too, but the rule belongs here: the debug page and the tests drive this
  // object directly, and the picker already has a comment saying out loud that
  // nothing may start a second turn over one session.
  let busy = false;

  /** An entry point that runs a turn, made the only one running. */
  function oneAtATime(turn) {
    return async (...args) => {
      if (busy) throw new Error("a turn is already in flight");
      busy = true;
      try {
        return await turn(...args);
      } finally {
        busy = false;
      }
    };
  }

  /**
   * Say what this is, and ask what they came for. Both scripted, from the pack.
   *
   * The transcript never said who was talking. The intro does, but it is hidden
   * the moment a reading starts and a phone user has skimmed past it to the
   * button -- so the first thing on screen was a question from nobody.
   *
   * Neither line is generated. The disclosure is a statement of fact about the
   * app, and asking a model to improvise its own honesty line is the wrong
   * shape of request. The question was already fixed content: its instruction
   * pinned it to two sentences that ask one thing and make declining easy, so
   * the call bought a paraphrase and a per-session round trip before the first
   * card. Scripting it makes the opening instant and removes a failure point
   * from in front of the whole reading.
   *
   * What it costs is persona-voice variation on a two-sentence question. What
   * the session record keeps is unchanged: openWith still judges the answer,
   * and recordOpening still writes this question above it.
   */
  async function begin() {
    lastQuestion = pack.opening.question;
    // The half that survives the tab closing, so a reading abandoned here still
    // exports as a reading that asked something.
    session.pending_question = pack.opening.question;
    onEvent({ type: "reader_scripted", role: "note", text: pack.opening.disclosure });
    onEvent({ type: "reader_scripted", role: "reader", text: pack.opening.question });
    persist();
    return session;
  }

  /** One user turn. Everything that follows from it happens here. */
  async function say(answer) {
    if (session.ended) throw new Error("this reading has ended");

    if (session.phase === "opening") return openWith(answer);

    // The frame was dropped before a card was ever dealt. There is no reading
    // to continue, only a conversation -- and it must not crash looking for a
    // card that was deliberately never turned.
    if (session.safety_state === "drop_frame" && !currentCard(session)) {
      recordOffFrame(session, { question: lastQuestion, answer });
      await readerTurn("respond");
      persist();
      return { dealt: false, offFrame: true };
    }

    const gate = await judge.gate({
      card: currentCard(session), question: lastQuestion, answer,
    });

    // They asked what the question meant instead of answering it. Nothing
    // moves: not the card, not the count, not the ladder. A question that did
    // not land costs the reader a turn, not them one of theirs -- charging
    // them for it is charging someone for the reader's own bad phrasing, and
    // it lands as a depth-1 deflection on a card they were engaged with.
    //
    // Before the closed branch, because it is just as true afterwards: an
    // epilogue card has a budget of its own, and this must not spend it.
    if (gate.asked_back && currentCard(session)) {
      recordAside(session, { question: lastQuestion, answer, gate });
      onEvent({ type: "gate", gate });
      if (session.safety_state === "drop_frame") onEvent({ type: "frame_dropped" });
      await readerTurn("clarify", { onCard: false });
      persist();
      return { gate, decision: { flip: false, reason: "they asked what the question meant" } };
    }

    // The reading is over and they are still talking. That is allowed, and it
    // is not a reason to hang up on them or to start a second reading: the
    // beat has been given, the ledger is sealed, and the three cards are
    // still on the table to route through. They end it, not the spread.
    //
    // The gate still runs, because stakes still do. Someone can say the thing
    // they came in not planning to say after the closing beat as easily as
    // before it, and the frame has to be droppable here too.
    if (session.closed) return afterward(answer, gate);

    recordExchange(session, { question: lastQuestion, answer, gate });
    onEvent({ type: "gate", gate });

    // Safety outranks the rhythm. Once the frame is dropped there are no more
    // cards, so the decision below is never even consulted.
    if (session.safety_state === "drop_frame") {
      onEvent({ type: "frame_dropped" });
      await readerTurn("respond");
      persist();
      return { gate, decision: { flip: false, reason: "frame dropped" } };
    }

    // A committed anchor is revised while the reading is still collecting:
    // the material that decides what a session is about now usually arrives
    // after the first card, because a disclosure buys a turn inside itself.
    // Started here, settled after the reader has spoken -- see above.
    const revision = beginAnchorRevision(gate);
    const turn = await advance(gate);
    await settleAnchorRevision(revision);
    return turn;
  }

  /**
   * A turn after the closing beat.
   *
   * Two shapes and the phase says which. The default tail is short by
   * construction: it exists so a last question gets a real answer, and then
   * the reader says goodbye. The afterglow is the other one -- entered only
   * by someone choosing it, and it stays until they leave or until it stops
   * going anywhere.
   *
   * No card turns over in either. The fourth card was decided before the
   * close, which is what stopped this being the place a second reading grew.
   */
  async function afterward(answer, gate) {
    const afterglow = session.phase === "afterglow";
    recordAfterward(session, {
      question: lastQuestion, answer, gate,
      position: afterglow ? "afterglow" : "afterward",
    });
    onEvent({ type: "gate", gate });

    if (session.safety_state === "drop_frame") {
      onEvent({ type: "frame_dropped" });
      await readerTurn("respond", { onCard: false });
      persist();
      return { gate, decision: { flip: false, reason: "frame dropped" } };
    }

    if (afterglow) {
      // Two answers running with nothing of theirs in them. There is no card
      // left to move on to, so the reader goes back to what the reading was
      // about or offers the door again -- rather than carrying on asking
      // after whatever it wandered into.
      const drifted = afterglowDrift(session);
      await readerTurn(drifted ? "regroup" : "afterglow", { onCard: false });
      persist();
      return { gate, decision: { flip: false, reason: drifted
        ? "the afterglow drifted off the anchor; back to it, or out"
        : "afterglow" } };
    }

    if (farewellDue(session, gate)) {
      const text = await readerTurn("farewell", { onCard: false });
      end(session, text);
      persist();
      onEvent({ type: "ended", farewell: text });
      return { gate, decision: { flip: false, reason: "the reading is over; that was goodbye" } };
    }

    await readerTurn("after", { onCard: false });
    persist();
    return { gate, decision: { flip: false, reason: "the reading is closed; this is after it" } };
  }

  /**
   * What the cards traditionally mean, because they asked.
   *
   * The persona allows the traditional sense when asked and never offers it,
   * which leaves it behind a question most people do not know they are allowed
   * to ask. Offered once, after the close, it is the reading people arrived
   * expecting -- delivered after the projection work is done rather than
   * instead of it, and only on request.
   *
   * It is not a turn of the tail. Recorded as an aside for the same reason a
   * "what did you mean?" is: it keeps its place in the transcript and it buys
   * nothing, so farewellDue counts exactly what it counted before. Someone who
   * asks what the deck means has not spent one of their last few turns on it.
   */
  async function meanings() {
    if (!session.closed) throw new Error("the reading has not closed yet");
    recordAfterward(session, {
      // q is the reader's standing turn and a is theirs, the way every exchange
      // is built. The button press is the thing they said.
      question: lastQuestion,
      answer: MEANINGS_REQUEST,
      gate: {},
      aside: true,
    });
    const text = await readerTurn("meanings", { onCard: false });
    persist();
    return { text, decision: { flip: false, reason: "they asked what the cards mean" } };
  }

  /** The answer to the opening question. Deals the first card, or does not. */
  async function openWith(answer) {
    const opening = await judge.opening({ question: lastQuestion, answer });
    recordOpening(session, { question: lastQuestion, answer, opening });
    onEvent({ type: "opening", opening, topic: session.topic });

    // Safety before the first card, not after it: if a tarot frame is the
    // wrong thing here, nothing should be dealt at all.
    if (session.safety_state === "drop_frame") {
      onEvent({ type: "frame_dropped" });
      await readerTurn("respond");
      persist();
      return { opening, dealt: false };
    }

    // The first card is not earned, it is dealt: the gate has nothing to
    // judge yet. Saying so is better than leaving the one blank flip reason
    // in the ledger to be read as a missing value.
    await flipNext("the opening question was answered; the reading begins");
    await readerTurn("invite", { stageDirection: flipDirection(pack, session) });
    return { opening, dealt: true };
  }

  return {
    session,

    // The turns, each of them the only one that can be running. say() reaches
    // openWith() and afterward() through the plain functions above rather than
    // through these, so delegating to one is not re-entering it.
    begin: oneAtATime(begin),
    say: oneAtATime(say),
    afterward: oneAtATime(afterward),
    openWith: oneAtATime(openWith),
    meanings: oneAtATime(meanings),

    /**
     * They walked out. Not the farewell -- that is the reading ending properly,
     * and it says goodbye first. This is the button, available the whole way
     * through, and it stops wherever they were.
     *
     * Unguarded on purpose: a way out that is unavailable for as long as the
     * thing you are trying to leave is still talking is not a way out.
     */
    end() {
      end(session);
      persist();
      onEvent({ type: "ended", farewell: null });
      return session;
    },

    /**
     * They took the door back after the farewell offered it.
     *
     * The reader does not speak here. They chose to keep talking, so they talk;
     * a turn generated by a button press would be the reader holding them, and
     * the whole point of the farewell is that it lets go first.
     */
    stayAWhile() {
      stayAWhile(session);
      persist();
      onEvent({ type: "afterglow" });
      return session;
    },
  };
}
