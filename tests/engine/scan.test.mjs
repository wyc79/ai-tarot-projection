import { test } from "node:test";
import assert from "node:assert/strict";
import { scanSession } from "../../scripts/scan.mjs";
import { finalQuestion, questionType } from "../../web/js/engine/questions.js";

/**
 * The six deal-turns of the 2026-08-25 checkpoint, verbatim. Three are correct
 * and three are not, and they are the whole calibration set for the deal-turn
 * check -- if a change to the patterns moves any of these, the change is wrong
 * until argued for here.
 *
 * checkpoint/ is gitignored (those are real sessions), so the questions live
 * inline rather than as a fixture file.
 */
const ASKS_ABOUT_THE_CARD = [
  "The situation card is the Nine of Pentacles. What does it look like it's pointing at for you?",
  "March is a long time to be holding a phone and not making that call. The obstacle card is the Five of Wands. Who in that picture feels most like you right now?",
  "So the money isn't really the fight — spending it is you admitting you're staying, and not spending keeps that admission un-made. The advice card, The Fool, has turned over in the resolution spot. What does he look like he's about to do?",
];

const ASKS_ABOUT_THEIR_LIFE = [
  "March is a long time to hold a phone and not use it. The obstacle card is the Five of Wands. When you think about calling him, what's the fight you're already bracing to have?",
  "\"If I spend it I have to admit I'm staying\" — so the call isn't really about money, it's about the sentence waiting behind the money.\n\nThe Fool lands in the advice position.\n\nWhat would a first step toward the call look like if it didn't have to carry that sentence yet?",
];

/** A session whose only card has one exchange: the deal turn and its answer. */
const dealTurn = (q) => ({
  cards: [{ card_id: "major-00-fool", position: "advice" }],
  exchanges: [{ q, a: "walking off", position: "advice", disclosure_depth: 2 }],
  closing_reflection: "done.",
  closed: true,
});

const codes = (session) => scanSession(session).map((f) => f.code);

test("the deal-turn check passes the checkpoint's correct projection questions", () => {
  for (const q of ASKS_ABOUT_THE_CARD) {
    assert.ok(!codes(dealTurn(q)).includes("deal_turn_life_question"),
              `flagged a correct projection question: ${finalQuestion(q)}`);
  }
});

test("the deal-turn check catches run B's life questions", () => {
  for (const q of ASKS_ABOUT_THEIR_LIFE) {
    assert.ok(codes(dealTurn(q)).includes("deal_turn_life_question"),
              `missed a life question on a deal turn: ${finalQuestion(q)}`);
  }
});

test("the fallback ways of pointing at a picture are not life questions", () => {
  // These are the stall-handling questions the persona explicitly asks for.
  for (const q of ["Where does your eye go first?", "What do you see in it?",
                   "What is she about to do, do you think?"]) {
    assert.ok(!codes(dealTurn(q)).includes("deal_turn_life_question"), q);
  }
});

test("only the turn that dealt the card is held to the projection rule", () => {
  // The follow-up is supposed to be about their life. That is the whole point
  // of asking for the projection first.
  const session = dealTurn("What does he look like he's about to do?");
  session.exchanges.push({
    q: "So who is it you have been walking away from?", a: "my brother",
    position: "advice", disclosure_depth: 4,
  });
  assert.deepEqual(codes(session), []);
});

test("a session that stopped without a closing beat is a finding", () => {
  const session = dealTurn("What does he look like he's about to do?");
  session.closed = false;
  session.closing_reflection = null;
  assert.deepEqual(codes(session), ["unclosed"]);
});

test("turn shape violations are reported per turn", () => {
  const session = dealTurn("What does it look like?");
  session.exchanges.push({
    q: "One. Two. Three. Four. And a fifth that runs long? And another?",
    a: "ok", position: "advice", disclosure_depth: 2,
  });
  assert.deepEqual(codes(session).sort(), ["over_length", "two_questions"]);
});

test("the same predicate labels the exchange and checks the deal turn", () => {
  // scan.mjs and the engine share questionType, so a turn the scanner calls a
  // life question cannot be recorded as a projection exchange.
  for (const q of ASKS_ABOUT_THE_CARD) assert.equal(questionType(q), "projection", q);
  for (const q of ASKS_ABOUT_THEIR_LIFE) assert.equal(questionType(q), "life", q);
});

test("the stall fallback is a projection question even on a follow-up turn", () => {
  // Classifying by turn kind would call this one a life question and score the
  // answer as a dodge. It is the reader doing exactly what it was told to do.
  assert.equal(
    questionType("Does she look more like she's enjoying a peace she made, or like she's standing guard over it?"),
    "projection");
});

// -- the forced-choice fallback (checkpoint fix 5) ------------------------

const FALLBACK = "Fair enough, it's not an obvious one. Does she look more like she's enjoying a peace she made, or like she's standing guard over it?";

/** A card, a deal turn, an answer of depth `first`, then `q`. */
const afterAnswer = (first, q) => ({
  cards: [{ card_id: "pentacles-09-nine", position: "situation" }],
  exchanges: [
    { q: "What does it look like it's pointing at for you?", a: "dunno",
      position: "situation", disclosure_depth: first },
    { q, a: "it looks tired I guess", position: "situation", disclosure_depth: 2 },
  ],
  closing_reflection: "done.",
  closed: true,
});

test("a forced choice after a one-word answer is the fallback, not a violation", () => {
  assert.deepEqual(codes(afterAnswer(1, FALLBACK)), [],
                   "both checkpoint runs were flagged here and both were right");
});

test("a forced choice after a real answer is still two questions in a coat", () => {
  assert.ok(codes(afterAnswer(3, FALLBACK)).includes("stacked_or"));
});

test("a forced choice between two things about their life is never the fallback", () => {
  const session = afterAnswer(1, "Is it the money, or is it that calling him means staying?");
  assert.ok(codes(session).includes("stacked_or"));
});

// -- point, don't name (c145c7) ------------------------------------------

test("the reader may point at a region but not name what is in it", async () => {
  const { realPack } = await import("./helpers.mjs");
  const pack = await realPack();
  // c145c7's shape: they answer the deal turn, and the turn under test is the
  // reader's reply to that answer -- so "bench" is already theirs and "plans"
  // is not. Ordering matters here; the words available are the ones said
  // before the question was asked.
  const session = (reply) => ({
    cards: [{ card_id: "pentacles-03-three", position: "obstacle", ai_reading: reply }],
    exchanges: [{ q: "Where does your eye go first in this one?",
                  a: "the men on the left standing on the bench",
                  position: "obstacle", disclosure_depth: 2, gate: { has_life_content: false } }],
    closing_reflection: "done.", closed: true,
  });
  const flagged = (reply) =>
    scanSession(session(reply), pack).some((f) => f.code === "unearned_card_vocabulary");

  // Verbatim. "plans" and "building" are both in the pack for this card and
  // neither was ever said by the person.
  assert.ok(flagged("You went straight to the man up on the bench, not the ones holding the plans below him. Does he look like he's building what they want, or what he wants?"));

  // The clean form: same region, no claim about what is there. "bench" is
  // allowed because they offered it first.
  assert.ok(!flagged("You went to the one up on the bench, not the two below him. Is he up there because they put him there, or because he climbed up?"));
});

test("a word they used first is theirs, and the reader may use it back", async () => {
  const { realPack } = await import("./helpers.mjs");
  const pack = await realPack();
  const session = {
    cards: [{ card_id: "pentacles-03-three", position: "obstacle" }],
    exchanges: [
      { q: "What do you see in it?", a: "someone holding out plans to the other two",
        position: "obstacle", disclosure_depth: 2, gate: { has_life_content: false } },
      { q: "Whose plans are those, in your world?", a: "not mine",
        position: "obstacle", disclosure_depth: 2, gate: { has_life_content: false } },
    ],
    closing_reflection: "done.", closed: true,
  };
  assert.ok(!scanSession(session, pack).some((f) => f.code === "unearned_card_vocabulary"),
            "they said plans first; the reader is allowed to say it back");
});
