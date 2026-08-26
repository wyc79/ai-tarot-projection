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
import { promptFor, realPack, sessionShowing } from "./helpers.mjs";

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

test("a turn kind nothing implements is an error, not a respond", async () => {
  const { pack, session } = await showing();
  // It used to be indexed with `?? TURN_INSTRUCTIONS.respond`, so a typo in the
  // controller was a respond turn that nothing anywhere caught.
  assert.throws(() => turnPlan({ pack, session, turn: "brige" }), /brige/);
});

test("a dropped frame is a rule on the plan, not a paragraph to grep for", async () => {
  const { pack, session } = await showing();
  const dropped = { ...session, safety_state: "drop_frame" };
  assert.deepEqual(turnPlan({ pack, session: dropped, turn: "respond" }).rules, ["frame_dropped"]);
  assert.deepEqual(turnPlan({ pack, session, turn: "respond" }).rules, []);
});

test("the handback is asked for by the controller, which is the only thing that knows", async () => {
  const { pack, session } = await showing();
  assert.deepEqual(
    turnPlan({ pack, session, turn: "respond", handback: true }).rules, ["stakes_high"]);
});

test("safety replaces the handback rather than stacking with it", async () => {
  const { pack, session } = await showing();
  const dropped = { ...session, safety_state: "drop_frame" };
  const plan = turnPlan({ pack, session: dropped, turn: "respond", handback: true });
  // A dropped frame is not a reading with a caveat on it: the reader stops
  // being a reader, so handing agency back inside the reading is incoherent.
  assert.deepEqual(plan.rules, ["frame_dropped"]);
});

test("the cards still face down are counted for the close and nothing else", async () => {
  const { pack, session } = await showing();
  // One card face up, four dealt: three never turned.
  assert.equal(turnPlan({ pack, session, turn: "close" }).face_down, 3);
  for (const turn of ["invite", "respond", "bridge"]) {
    assert.equal(turnPlan({ pack, session, turn }).face_down, 0,
                 `${turn} does not owe the deck a line`);
  }
});

test("there is no ladder before anything is dealt", async () => {
  const pack = await realPack();
  const opening = { phase: "opening", safety_state: "normal", exchanges: [], cards: [], deal: [] };
  assert.equal(turnPlan({ pack, session: opening, turn: "opening" }).ladder, null);
});

test("the ladder starts at the bottom on a card nobody has answered on yet", async () => {
  const { pack, session } = await showing();
  const { ladder } = turnPlan({ pack, session, turn: "invite" });
  assert.equal(ladder.userLevel, null, "nothing said on this card yet");
  assert.ok(ladder.target, "and the turn is still told how far it may reach");
});

// -- and the prose still says what the plan decided ------------------------

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
