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
 * That shape is a graph, and it lives in graph.js as one: every reader turn
 * kind is a node, every branch a labelled edge, and one user turn is one run
 * of it. What is here is what the graph's nodes need from outside -- the
 * deal, the reader call, the card identifier, persistence, the judge -- and
 * the public methods. The judge decides how deep the answer was; the graph
 * decides what that means. Keeping those apart is what makes the flip rhythm
 * testable without a model.
 */

import { saveToHistory } from "./journal.js";
import { judgements } from "./judgements.js";
import { readerCall } from "./prompts.js";
import {
  createSession, dealtCardFor, end, nameCard, namedCards, recordReading, stayAWhile,
} from "./state.js";
import { makeDeal } from "./draw.js";
import { newSeed } from "./rng.js";
import { buildGraph } from "./graph.js";

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
   * It is called from graph.js's flip and flip_epilogue nodes and nowhere else,
   * which is what keeps the mode's best moment intact: a fourth card that is
   * not earned is never asked about, so it stays face down on their table and
   * unnamed here.
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

  // The turn, as a graph. Built once per reading, over this reading's session
  // and helpers; run once per turn.
  const { graph } = buildGraph({
    session, pack, judge, readerTurn, cardFor, persist, onEvent,
    question: () => lastQuestion,
  });

  /**
   * One run of the graph. Each node's update arrives as it finishes, which is
   * what the node event is: the trace of the turn, for anything that wants to
   * draw it. The result is whatever the last node to write one wrote, in the
   * shapes say() and meanings() have always returned.
   */
  async function run(input) {
    let result;
    for await (const chunk of await graph.stream(input, { streamMode: "updates" })) {
      for (const [node, update] of Object.entries(chunk)) {
        onEvent({ type: "node", node });
        if (update && "result" in update) result = update.result;
      }
    }
    return result;
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
   * the session record keeps is unchanged: the graph's judge_opening still
   * judges the answer, and recordOpening still writes this question above it.
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

  /** One user turn. Everything that follows from it happens in the graph. */
  async function say(answer) {
    if (session.ended) throw new Error("this reading has ended");
    return run({ kind: "say", answer });
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
   * Refused after the goodbye, like say(). The farewell is the last thing the
   * reader says in a session, and a turn generated after it takes that back.
   * The way to the meanings from there is the door the farewell already
   * offered: staying a while reopens the reading's own tail, and the offer is
   * standing in it.
   */
  async function meanings() {
    if (session.ended) throw new Error("this reading has ended");
    if (!session.closed) throw new Error("the reading has not closed yet");
    return run({ kind: "meanings", answer: MEANINGS_REQUEST });
  }

  return {
    session,

    // The turns, each of them the only one that can be running.
    begin: oneAtATime(begin),
    say: oneAtATime(say),
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
