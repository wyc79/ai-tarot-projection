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

import { ANCHOR_SCHEMA, GATE_SCHEMA } from "./schemas.js";
import { saveToHistory } from "./journal.js";
import {
  ANCHOR_SYSTEM, JUDGE_SYSTEM, anchorMessages, flipDirection, judgeMessages,
  readerMessages, readerSystem,
} from "./prompts.js";
import {
  close, commitAnchor, createSession, currentCard, flipCard, flipDecision,
  recordExchange, recordReading, spreadComplete,
} from "./state.js";
import { makeDeal } from "./draw.js";
import { newSeed } from "./rng.js";

export const SESSION_KEY = "session";

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

  async function readerTurn(turn, { stageDirection = null, readingOffset = 0 } = {}) {
    // Hand agency back on the first high-stakes turn only. Saying it again every
    // time the subject resurfaces turns honesty into a disclaimer.
    const handback = session.last_stakes === "high" && !session.handback_given;
    const system = readerSystem({ pack, session, turn, handback });
    const messages = readerMessages(pack, session, { stageDirection });
    onEvent({ type: "reader_start", turn });

    const text = await client.chat({
      system,
      messages,
      onDelta: (delta, full) => onEvent({ type: "reader_delta", delta, full }),
    });

    if (handback) session.handback_given = true;
    recordReading(session, text, { offset: readingOffset });
    lastQuestion = text;
    onEvent({ type: "reader_done", text, turn });
    persist();
    return text;
  }

  function flipNext() {
    const [cardId] = deal.take(1);
    flipCard(session, cardId);
    const entry = currentCard(session);
    onEvent({ type: "flip", card: pack.card(entry.card_id), position: entry.position });
    return entry;
  }

  return {
    session,

    /** Turn the first card immediately and hand it over. */
    async begin() {
      flipNext();
      await readerTurn("invite", { stageDirection: flipDirection(pack, session) });
      return session;
    },

    /** One user turn. Everything that follows from it happens here. */
    async say(answer) {
      if (session.closed) throw new Error("this reading is closed");

      const gate = await client.judge({
        system: JUDGE_SYSTEM,
        messages: judgeMessages(pack, session, { question: lastQuestion, answer }),
        schema: GATE_SCHEMA,
      });
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

      const decision = flipDecision(session, gate);
      onEvent({ type: "flip_decision", decision, gate });

      if (!decision.flip) {
        await readerTurn("respond");
        return { gate, decision };
      }

      // The anchor is committed off the first card, before any second card
      // exists to be reconciled with it.
      if (!session.anchor) {
        const anchor = await client.judge({
          system: ANCHOR_SYSTEM,
          messages: anchorMessages(pack, session),
          schema: ANCHOR_SCHEMA,
        });
        commitAnchor(session, anchor);
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

      flipNext();
      // A bridge answers the card behind it while the new one is already up.
      await readerTurn("bridge", {
        stageDirection: flipDirection(pack, session),
        readingOffset: 1,
      });
      return { gate, decision, flipped: true };
    },
  };
}
