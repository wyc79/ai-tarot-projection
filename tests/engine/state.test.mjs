import { test } from "node:test";
import assert from "node:assert/strict";
import {
  close, commitAnchor, createSession, currentCard, exchangesOnCurrentCard,
  flipCard, flipDecision, nextPosition, recordExchange, recordReading, spreadComplete,
} from "../../web/js/engine/state.js";

const POSITIONS = [{ id: "situation" }, { id: "obstacle" }, { id: "advice" }];
const gate = (depth, stakes = "low") =>
  ({ disclosure_depth: depth, has_life_content: true, stakes });
/** Everything they said was about the picture. */
const cardOnly = (depth = 2) =>
  ({ disclosure_depth: depth, has_life_content: false, stakes: "low" });

const fresh = () => createSession({ packId: "smith-waite-1909", seed: "moon-4f2a91", positions: POSITIONS });

function answer(session, depth, stakes = "low") {
  return recordExchange(session, {
    question: "what does this feel like it is pointing at?",
    answer: "an answer",
    gate: gate(depth, stakes),
  });
}

test("a new session starts empty, unanchored, and unflagged", () => {
  const s = fresh();
  assert.equal(s.anchor, null);
  assert.deepEqual(s.cards, []);
  assert.equal(s.safety_state, "normal");
  assert.equal(nextPosition(s), "situation");
});

test("cards flip into spread order", () => {
  const s = fresh();
  flipCard(s, "major-00-fool");
  assert.equal(currentCard(s).position, "situation");
  assert.equal(nextPosition(s), "obstacle");
  flipCard(s, "swords-08-eight");
  assert.equal(currentCard(s).position, "obstacle");
});

test("the spread refuses a fourth card", () => {
  const s = fresh();
  ["a", "b", "c"].forEach((id) => flipCard(s, id));
  assert.equal(nextPosition(s), null);
  assert.ok(spreadComplete(s));
  assert.throws(() => flipCard(s, "d"), /spread is full/);
});

test("the first answer on a card is the projection; later ones are not", () => {
  const s = fresh();
  flipCard(s, "major-00-fool");
  recordExchange(s, { question: "q1", answer: "the first thing I saw", gate: gate(3) });
  recordExchange(s, { question: "q2", answer: "a later thought", gate: gate(3) });
  assert.equal(currentCard(s).user_projection, "the first thing I saw");
  assert.equal(exchangesOnCurrentCard(s), 2);
});

test("exchanges are counted per card, not per session", () => {
  const s = fresh();
  flipCard(s, "a");
  answer(s, 1);
  answer(s, 1);
  flipCard(s, "b");
  assert.equal(exchangesOnCurrentCard(s), 0, "the new card starts its own count");
  assert.equal(s.exchanges.length, 2);
});

test("no flip before the user has said anything", () => {
  const s = fresh();
  flipCard(s, "a");
  assert.equal(flipDecision(s, gate(4)).flip, false);
});

test("a rich answer earns the next card after one exchange", () => {
  const s = fresh();
  flipCard(s, "a");
  answer(s, 3);
  const decision = flipDecision(s, gate(4));
  assert.equal(decision.flip, true);
  assert.match(decision.reason, /early/);
});

test("the default rhythm is two exchanges when the judge agrees", () => {
  const s = fresh();
  flipCard(s, "a");
  answer(s, 2);
  assert.equal(flipDecision(s, gate(3)).flip, false, "one exchange is not the rhythm");
  answer(s, 2);
  assert.equal(flipDecision(s, gate(3)).flip, true);
});

test("a thin answer gets one softer follow-up, then moves on rather than stalling", () => {
  const s = fresh();
  flipCard(s, "a");
  answer(s, 0);
  assert.equal(flipDecision(s, gate(1)).flip, false);
  answer(s, 0);
  assert.equal(flipDecision(s, gate(1)).flip, false, "one softer follow-up is allowed");
  answer(s, 0);
  const decision = flipDecision(s, gate(1));
  assert.equal(decision.flip, true, "a gate the user cannot satisfy is a stalled meter");
  assert.match(decision.reason, /stalling/);
});

test("crisis drops the frame, and the frame stays dropped", () => {
  const s = fresh();
  flipCard(s, "a");
  answer(s, 2, "crisis");
  assert.equal(s.safety_state, "drop_frame");
  assert.equal(flipDecision(s, gate(4)).flip, false, "no cards while the frame is dropped");
  answer(s, 2, "low");
  assert.equal(s.safety_state, "drop_frame", "the session does not slide back into tarot");
});

test("crisis is reachable on the very first exchange", () => {
  const s = fresh();
  flipCard(s, "a");
  answer(s, 0, "crisis");
  assert.equal(s.safety_state, "drop_frame");
});

test("high stakes is recorded without dropping the frame", () => {
  const s = fresh();
  flipCard(s, "a");
  answer(s, 2, "high");
  assert.equal(s.last_stakes, "high");
  assert.equal(s.safety_state, "normal");
});

test("the anchor is committed once and then left alone", () => {
  const s = fresh();
  commitAnchor(s, { theme: "leaving a job", user_phrases: ["stuck"], resolution_beat: "name the cost" });
  commitAnchor(s, { theme: "something else entirely", user_phrases: [], resolution_beat: "different" });
  assert.equal(s.anchor.theme, "leaving a job", "a second commit must not contradict the first");
});

test("the anchor copies the phrase list rather than aliasing it", () => {
  const s = fresh();
  const phrases = ["stuck"];
  commitAnchor(s, { theme: "t", user_phrases: phrases, resolution_beat: "r" });
  phrases.push("mutated later");
  assert.deepEqual(s.anchor.user_phrases, ["stuck"]);
});

test("readings land on the ledger, and closing ends the session", () => {
  const s = fresh();
  flipCard(s, "a");
  recordReading(s, "you called it stuck twice");
  assert.equal(currentCard(s).ai_reading, "you called it stuck twice");
  close(s, "this week, notice when you say stuck");
  assert.equal(s.closed, true);
  assert.match(s.closing_reflection, /this week/);
});

// -- grounding (c145c7) ---------------------------------------------------

test("a card nothing of theirs landed on does not earn an early flip", () => {
  const s = fresh();
  flipCard(s, "a");
  recordExchange(s, { question: "what do you see?", answer: "a woman in blue", gate: cardOnly(2) });
  // The judge would have to break its own cap to send a 4 here, but if it did,
  // an answer with nothing of theirs in it still does not buy the next card.
  assert.equal(flipDecision(s, cardOnly(4)).flip, false);
  assert.match(flipDecision(s, cardOnly(4)).reason, /ungrounded/);
});

test("but it flips eventually, and the reason records that it was ungrounded", () => {
  const s = fresh();
  flipCard(s, "a");
  for (let i = 0; i < 2; i += 1) {
    recordExchange(s, { question: "and then?", answer: "the pillars", gate: cardOnly(2) });
  }
  recordExchange(s, { question: "and then?", answer: "the moon at her feet", gate: cardOnly(2) });
  const decision = flipDecision(s, cardOnly(2));
  assert.equal(decision.flip, true, "a resistant user is never stalled");
  assert.match(decision.reason, /moving on rather than stalling/);
  assert.match(decision.reason, /ungrounded, nothing of theirs landed/);
});

test("one grounded answer on the card is enough to restore the early exits", () => {
  const s = fresh();
  flipCard(s, "a");
  recordExchange(s, { question: "what do you see?", answer: "a woman in blue", gate: cardOnly(2) });
  recordExchange(s, { question: "when?", answer: "my sister, last March", gate: gate(4) });
  const decision = flipDecision(s, gate(4));
  assert.equal(decision.flip, true);
  assert.match(decision.reason, /early/);
  assert.ok(!/ungrounded/.test(decision.reason));
});
