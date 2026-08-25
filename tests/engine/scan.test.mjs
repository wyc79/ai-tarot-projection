import { test } from "node:test";
import assert from "node:assert/strict";
import { finalQuestion, scanSession } from "../../scripts/scan.mjs";

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
