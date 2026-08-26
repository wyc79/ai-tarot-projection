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

import { ANCHOR_SCHEMA, OPENING_SCHEMA, gateSchema } from "./schemas.js";
import { BEAT_RETRY_NOTE, beatIsTerritory } from "./anchor.js";
import { saveToHistory } from "./journal.js";
import {
  ANCHOR_SYSTEM, JUDGE_SYSTEM, OPENING_SYSTEM, anchorMessages, flipDirection,
  judgeMessages, openingMessages, readerMessages, readerSystem, readerTurnBlock,
} from "./prompts.js";
import {
  close, commitAnchor, createSession, currentCard, end, flipCard, flipDecision,
  recordAfterward, recordExchange, recordOffFrame, recordOpening, recordReading,
  spreadComplete, updateAnchor,
} from "./state.js";
import { makeDeal } from "./draw.js";
import { newSeed } from "./rng.js";

export const SESSION_KEY = "session";

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

export function startReading({ pack, client, storage = null, seed = newSeed(), onEvent = () => {} }) {
  const session = createSession({ packId: pack.id, seed, positions: pack.positions });
  const deal = makeDeal(pack.cards.map((c) => c.card_id), seed);

  // The seed is logged the moment the session exists: a reading nobody can
  // reproduce is a reading nobody can debug.
  onEvent({ type: "session_start", seed: session.seed, pack: pack.id });

  let lastQuestion = "";

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
    const system = readerSystem({ pack, session });
    const messages = readerMessages(pack, session, {
      stageDirection,
      turnBlock: readerTurnBlock({ pack, session, turn, handback }),
    });
    onEvent({ type: "reader_start", turn });

    const raw = await client.chat({
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
    onEvent({ type: "reader_done", text, turn });
    persist();
    return text;
  }

  /**
   * Ask for the narrative plan, and ask again once if the beat came back as a
   * verdict rather than a question.
   *
   * Once, not until it complies: the cost of a conclusive beat is that the rest
   * of the reading steers toward confirming it, and the cost of re-asking
   * forever is a session that never starts. One retry buys most of the value.
   */
  async function judgeAnchor({ rolling = false } = {}) {
    const ask = (note) => client.judge({
      system: ANCHOR_SYSTEM,
      messages: anchorMessages(pack, session, { note, rolling }),
      schema: ANCHOR_SCHEMA,
    });
    const first = await ask("");
    if (beatIsTerritory(first.resolution_beat)) return first;
    onEvent({ type: "anchor_retry", beat: first.resolution_beat });
    const second = await ask(BEAT_RETRY_NOTE);
    // Whatever comes back second is what the reading gets. A judge that will
    // not phrase a territory twice running is not going to on the third ask,
    // and the reading is not held up over it.
    return beatIsTerritory(second.resolution_beat) ? second : first;
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
    return judgeAnchor({ rolling: true }).catch((error) => {
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
      commitAnchor(session, await judgeAnchor());
      // Persist before announcing: a listener that reads storage on the event
      // would otherwise see the state as it was a moment ago.
      persist();
      onEvent({ type: "anchor", anchor: session.anchor });
    }

    if (spreadComplete(session)) {
      const text = await readerTurn("close");
      close(session, text);
      persist();
      onEvent({ type: "closed", reflection: text });
      return { gate, decision, closed: true };
    }

    flipNext(decision.reason);
    // A bridge answers the card behind it while the new one is already up.
    await readerTurn("bridge", {
      stageDirection: flipDirection(pack, session),
      readingOffset: 1,
    });
    return { gate, decision, flipped: true };
  }

  function flipNext(reason) {
    const [cardId] = deal.take(1);
    flipCard(session, cardId, { reason });
    const entry = currentCard(session);
    onEvent({ type: "flip", card: pack.card(entry.card_id), position: entry.position, reason });
    return entry;
  }

  return {
    session,

    /**
     * Ask what they came for before anything is dealt. A named topic becomes
     * the ground the whole reading is bent toward; declining is a normal answer
     * and costs them nothing.
     */
    async begin() {
      await readerTurn("opening");
      return session;
    },

    /**
     * They are done. The only thing that sets it, and only a person calls it.
     */
    end() {
      end(session);
      persist();
      onEvent({ type: "ended" });
      return session;
    },

    /** One user turn. Everything that follows from it happens here. */
    async say(answer) {
      if (session.ended) throw new Error("this reading has ended");

      if (session.phase === "opening") return this.openWith(answer);

      // The frame was dropped before a card was ever dealt. There is no reading
      // to continue, only a conversation -- and it must not crash looking for a
      // card that was deliberately never turned.
      if (session.safety_state === "drop_frame" && !currentCard(session)) {
        recordOffFrame(session, { question: lastQuestion, answer });
        await readerTurn("respond");
        persist();
        return { dealt: false, offFrame: true };
      }

      const gate = await client.judge({
        system: JUDGE_SYSTEM,
        messages: judgeMessages(pack, session, { question: lastQuestion, answer }),
        schema: gateSchema(pack),
      });

      // The reading is over and they are still talking. That is allowed, and it
      // is not a reason to hang up on them or to start a second reading: the
      // beat has been given, the ledger is sealed, and the three cards are
      // still on the table to route through. They end it, not the spread.
      //
      // The gate still runs, because stakes still do. Someone can say the thing
      // they came in not planning to say after the closing beat as easily as
      // before it, and the frame has to be droppable here too.
      if (session.closed) {
        recordAfterward(session, { question: lastQuestion, answer, gate });
        onEvent({ type: "gate", gate });
        if (session.safety_state === "drop_frame") onEvent({ type: "frame_dropped" });
        await readerTurn("after", { onCard: false });
        persist();
        return { gate, decision: { flip: false, reason: "the reading is closed; this is after it" } };
      }

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
    },

    /** The answer to the opening question. Deals the first card, or does not. */
    async openWith(answer) {
      const opening = await client.judge({
        system: OPENING_SYSTEM,
        messages: openingMessages({ question: lastQuestion, answer }),
        schema: OPENING_SCHEMA,
      });
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
      flipNext("the opening question was answered; the reading begins");
      await readerTurn("invite", { stageDirection: flipDirection(pack, session) });
      return { opening, dealt: true };
    },
  };
}
