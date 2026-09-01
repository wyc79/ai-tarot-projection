/**
 * The turn plan: the decisions a reader turn makes before it writes itself.
 *
 * These used to be assertable only through the prose they produced, which meant
 * a rule test broke when a paragraph was rewrapped and passed when a rule was
 * quietly dropped from a turn that still mentioned it elsewhere. The rules are
 * read here; the prose is checked separately, and only where the wording is the
 * thing that matters.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { turnPlan } from "../../web/js/engine/prompts.js";
import { createSession, recordExchange } from "../../web/js/engine/state.js";
import { promptFor, realPack, sessionShowing } from "./helpers.mjs";

const answer = (session, gate) =>
  recordExchange(session, { question: "what do you see in it?", answer: "a cliff", gate });
const GATE = {
  disclosure_depth: 3, has_life_content: true, hedged: false,
  stakes: "low", user_level: "consequences", reading_of_them: "x",
};

const showing = async () => {
  const pack = await realPack();
  return { pack, session: sessionShowing(pack, "major-00-fool") };
};

test("the kind is what was asked for, not what the prose happens to end with", async () => {
  const { pack, session } = await showing();
  for (const turn of ["invite", "respond", "bridge", "close", "farewell"]) {
    assert.equal(turnPlan({ pack, session, turn }).kind, turn);
  }
});

test("a plan that drops the frame produces a turn told to stop being a reader", async () => {
  const { pack, session } = await showing();
  const dropped = { ...session, safety_state: "drop_frame" };
  const prompt = promptFor(pack, dropped, "respond").replace(/\s+/g, " ");
  assert.match(prompt, /the frame is dropped/i);
  assert.doesNotMatch(promptFor(pack, session, "respond").replace(/\s+/g, " "),
                      /the frame is dropped/i);
});

test("a close with cards still down is told to say so, as an invitation", async () => {
  const { pack, session } = await showing();
  const prompt = promptFor(pack, session, "close").replace(/\s+/g, " ");
  assert.match(prompt, /One card stays face down/);
  assert.match(prompt, /As an invitation, never as a verdict/);
  // Never on an ordinary turn, however many are face down.
  assert.doesNotMatch(promptFor(pack, session, "respond").replace(/\s+/g, " "),
                      /One card stays face down/);
});

test("a turn kind nobody defined is an error, not a respond turn", async () => {
  const pack = await realPack();
  const session = sessionShowing(pack, "major-00-fool");
  // It used to be `TURN_INSTRUCTIONS[turn] ?? TURN_INSTRUCTIONS.respond`, so a
  // mistyped turn in the controller produced a correct-looking respond turn and
  // nothing anywhere said so.
  assert.throws(() => turnPlan({ pack, session, turn: "brige" }), /no instruction for turn kind/);
  assert.doesNotThrow(() => turnPlan({ pack, session, turn: "bridge" }));
});

test("a dropped frame displaces the handback rather than stacking with it", async () => {
  const pack = await realPack();
  const session = sessionShowing(pack, "major-00-fool");
  session.safety_state = "drop_frame";
  // Both would be true of the session; only one may reach the turn. A dropped
  // frame is not a reading with a caveat on it.
  const plan = turnPlan({ pack, session, turn: "respond", handback: true });
  assert.deepEqual(plan.rules, ["frame_dropped"]);
});

test("agency is handed back only when the controller says so", async () => {
  const pack = await realPack();
  const session = sessionShowing(pack, "major-00-fool");
  assert.deepEqual(turnPlan({ pack, session, turn: "respond" }).rules, []);
  assert.deepEqual(turnPlan({ pack, session, turn: "respond", handback: true }).rules,
                   ["stakes_high"]);
});

test("only the closing turn counts the cards that never turned", async () => {
  const pack = await realPack();
  const session = sessionShowing(pack, "major-00-fool");
  // Three face down behind the one that is up, and the close is the only turn
  // that owes them a line.
  assert.equal(turnPlan({ pack, session, turn: "close" }).face_down, 3);
  for (const turn of ["respond", "bridge", "invite", "farewell"]) {
    assert.equal(turnPlan({ pack, session, turn }).face_down, 0, `${turn} does not owe that line`);
  }
});

test("the ladder is quoted on every turn, and written out on every turn there is", async () => {
  const pack = await realPack();
  // There is no undealt reader turn any more -- the opening is scripted, so the
  // first turn the model writes already has a card in front of it. The section
  // that used to be suppressed before the deal is now simply always written.
  const dealt = sessionShowing(pack, "major-00-fool");
  assert.ok(turnPlan({ pack, session: dealt, turn: "invite" }).ladder.target,
            "the record quotes a target");
  assert.match(promptFor(pack, dealt, "invite"), /reach no further than: \w+/);
  assert.match(promptFor(pack, dealt, "invite"), /\n## How far to reach/);
});

test("the card is resolved out of the pack, or absent before the deal", async () => {
  const pack = await realPack();
  const fresh = createSession({ packId: pack.id, seed: "s", positions: pack.positions });
  // The one turn that still runs with nothing on the table: the reply to an
  // opening answer that dropped the frame, before anything is dealt.
  assert.equal(turnPlan({ pack, session: fresh, turn: "respond" }).card, null);

  const { card } = turnPlan({ pack, session: sessionShowing(pack, "major-06-lovers"), turn: "invite" });
  assert.equal(card.name, "The Lovers");
  assert.ok(card.details.length, "what is in the picture, for pointing at");
  assert.ok(card.meaning_here, "and the sense it is never to volunteer");
});

test("an aside is reported as one, and it moves nothing", async () => {
  const pack = await realPack();
  const session = sessionShowing(pack, "major-00-fool");
  answer(session, GATE);
  const before = turnPlan({ pack, session, turn: "respond" });
  assert.equal(before.record.asked_back, false);

  session.exchanges.at(-1).aside = true;
  const after = turnPlan({ pack, session, turn: "clarify" });
  assert.equal(after.record.asked_back, true);
  assert.equal(after.record.depth, null, "an aside is not an answer on the card");
});

test("a hedge is reported so the turn can be told not to build on it", async () => {
  const pack = await realPack();
  const session = sessionShowing(pack, "major-00-fool");
  answer(session, { ...GATE, hedged: true });
  assert.equal(turnPlan({ pack, session, turn: "respond" }).record.hedged, true);
});

test("real-world stakes stay on the record after the subject has moved on", async () => {
  const pack = await realPack();
  const session = sessionShowing(pack, "major-00-fool");
  answer(session, { ...GATE, stakes: "high" });
  answer(session, GATE);
  answer(session, GATE);
  const { record } = turnPlan({ pack, session, turn: "farewell" });
  assert.equal(record.heavy.length, 1, "it does not stop being true because they moved on");
  assert.equal(record.heavy[0], "a cliff");
});

test("the afterglow gets edges; the reading proper does not", async () => {
  const pack = await realPack();
  const session = sessionShowing(pack, "major-00-fool");
  session.topic = "the move";
  session.anchor = {
    theme: "t", user_phrases: [{ phrase: "treading water", source: "life" }],
    resolution_beat: "whether it holds", grounded: true,
  };
  assert.equal(turnPlan({ pack, session, turn: "respond" }).record.territory, null);

  session.phase = "afterglow";
  const { record } = turnPlan({ pack, session, turn: "afterglow" });
  assert.deepEqual(record.territory, ["the move", "treading water"],
                   "what the reading found is the only ground left");
});

test("the table carries every position, face down included", async () => {
  const pack = await realPack();
  const { record } = turnPlan({
    pack, session: sessionShowing(pack, "major-00-fool"), turn: "invite",
  });
  assert.equal(record.table.length, 4, "three positions and the epilogue");
  assert.equal(record.table[0].face_up, true);
  assert.equal(record.table[0].name, "The Fool");
  assert.deepEqual(record.table.slice(1).map((s) => s.face_up), [false, false, false]);
  assert.equal(record.table.at(-1).epilogue, true, "and the fourth is marked as the earned one");
  assert.equal(record.face_down, 3);
});

test("an ungrounded anchor says so, so the turn is not written as though it knows them", async () => {
  const pack = await realPack();
  const session = sessionShowing(pack, "major-00-fool");
  session.anchor = {
    theme: "placeholder", user_phrases: [{ phrase: "a cliff edge", source: "card" }],
    resolution_beat: "whether it holds", grounded: false,
  };
  const { record } = turnPlan({ pack, session, turn: "respond" });
  assert.equal(record.anchor.grounded, false);
  assert.deepEqual(record.anchor.phrases, [{ phrase: "a cliff edge", source: "card" }]);
});
