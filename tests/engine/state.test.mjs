import { test } from "node:test";
import assert from "node:assert/strict";
import {
  close, commitAnchor, createSession, currentCard, exchangesOnCurrentCard,
  flipCard, flipDecision, nextPosition, recordExchange, recordReading, spreadComplete,
} from "../../web/js/engine/state.js";

const POSITIONS = [{ id: "situation" }, { id: "obstacle" }, { id: "advice" }];
const gate = (depth, ready, stakes = "low") =>
  ({ disclosure_depth: depth, flip_ready: ready, stakes });

const fresh = () => createSession({ packId: "smith-waite-1909", seed: "moon-4f2a91", positions: POSITIONS });

function answer(session, depth, ready, stakes = "low") {
  return recordExchange(session, {
    question: "what does this feel like it is pointing at?",
    answer: "an answer",
    gate: gate(depth, ready, stakes),
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
  recordExchange(s, { question: "q1", answer: "the first thing I saw", gate: gate(3, false) });
  recordExchange(s, { question: "q2", answer: "a later thought", gate: gate(3, false) });
  assert.equal(currentCard(s).user_projection, "the first thing I saw");
  assert.equal(exchangesOnCurrentCard(s), 2);
});

test("exchanges are counted per card, not per session", () => {
  const s = fresh();
  flipCard(s, "a");
  answer(s, 1, false);
  answer(s, 1, false);
  flipCard(s, "b");
  assert.equal(exchangesOnCurrentCard(s), 0, "the new card starts its own count");
  assert.equal(s.exchanges.length, 2);
});

test("no flip before the user has said anything", () => {
  const s = fresh();
  flipCard(s, "a");
  assert.equal(flipDecision(s, gate(4, true)).flip, false);
});

test("a rich answer earns the next card after one exchange", () => {
  const s = fresh();
  flipCard(s, "a");
  answer(s, 3, false);
  const decision = flipDecision(s, gate(4, false));
  assert.equal(decision.flip, true);
  assert.match(decision.reason, /early/);
});

test("the default rhythm is two exchanges when the judge agrees", () => {
  const s = fresh();
  flipCard(s, "a");
  answer(s, 2, true);
  assert.equal(flipDecision(s, gate(3, true)).flip, false, "one exchange is not the rhythm");
  answer(s, 2, true);
  assert.equal(flipDecision(s, gate(3, true)).flip, true);
});

test("a thin answer gets one softer follow-up, then moves on rather than stalling", () => {
  const s = fresh();
  flipCard(s, "a");
  answer(s, 0, false);
  assert.equal(flipDecision(s, gate(1, false)).flip, false);
  answer(s, 0, false);
  assert.equal(flipDecision(s, gate(1, false)).flip, false, "one softer follow-up is allowed");
  answer(s, 0, false);
  const decision = flipDecision(s, gate(1, false));
  assert.equal(decision.flip, true, "a gate the user cannot satisfy is a stalled meter");
  assert.match(decision.reason, /stalling/);
});

test("crisis drops the frame, and the frame stays dropped", () => {
  const s = fresh();
  flipCard(s, "a");
  answer(s, 2, true, "crisis");
  assert.equal(s.safety_state, "drop_frame");
  assert.equal(flipDecision(s, gate(4, true)).flip, false, "no cards while the frame is dropped");
  answer(s, 2, true, "low");
  assert.equal(s.safety_state, "drop_frame", "the session does not slide back into tarot");
});

test("crisis is reachable on the very first exchange", () => {
  const s = fresh();
  flipCard(s, "a");
  answer(s, 0, false, "crisis");
  assert.equal(s.safety_state, "drop_frame");
});

test("high stakes is recorded without dropping the frame", () => {
  const s = fresh();
  flipCard(s, "a");
  answer(s, 2, true, "high");
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
