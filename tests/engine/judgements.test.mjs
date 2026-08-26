import { test } from "node:test";
import assert from "node:assert/strict";
import { gateCall, judgements } from "../../web/js/engine/judgements.js";
import { realPack } from "./helpers.mjs";

const VERDICT = "where the old trade stands in the new one — still feeding it, or left behind";
const CONCLUSION = "that the change isn't a break, it's a repurposing";

/** Records every call and answers with whatever was queued for that kind. */
function recorder(answers = {}) {
  const calls = [];
  return {
    calls,
    async judge(call) {
      calls.push(call);
      const canned = answers[call.kind];
      return Array.isArray(canned) ? canned[calls.filter((c) => c.kind === call.kind).length - 1]
        : canned ?? {};
    },
  };
}

const SESSION = {
  topic: null,
  cards: [{ card_id: "major-00-fool", position: "situation", user_projection: "a cliff" }],
  exchanges: [{ position: "situation", q: "what do you see?", a: "a cliff", gate: {} }],
  anchor: null,
};

test("every judgement says which one it is, rather than being identified by its schema", async () => {
  const pack = await realPack();
  const client = recorder({ anchor: { resolution_beat: VERDICT } });
  const judge = judgements({ client, pack });

  await judge.opening({ question: "what brings you?", answer: "not sure" });
  await judge.gate({ card: SESSION.cards[0], question: "what do you see?", answer: "a cliff" });
  await judge.anchor(SESSION);

  assert.deepEqual(client.calls.map((c) => c.kind), ["opening", "gate", "anchor"]);
  // The thing the test double used to have to infer. Nothing infers it now.
  for (const call of client.calls) {
    assert.ok(call.system && call.messages && call.schema,
              `${call.kind} is missing one of its three parts`);
  }
});

test("a gate is built from the card, not from a session it mostly ignores", async () => {
  const pack = await realPack();
  // No session anywhere: this is what judge_replay.mjs does with a frozen
  // exchange, and it used to need a stub session and a comment explaining
  // which fields of it were load-bearing.
  const call = gateCall(pack, {
    card: { card_id: "major-06-lovers", position: "obstacle" },
    question: "what does it look like it is pointing at?",
    answer: "two people not looking at each other",
  });
  assert.equal(call.kind, "gate");
  assert.match(call.messages[0].content, /The Lovers in the obstacle position/);
  assert.match(call.messages[0].content, /two people not looking at each other/);
});

test("a gate before anything is dealt names no card and still judges the answer", async () => {
  const pack = await realPack();
  const call = gateCall(pack, { card: null, question: "", answer: "just curious" });
  assert.doesNotMatch(call.messages[0].content, /Card on the table/);
  assert.match(call.messages[0].content, /the reading had not started/);
});

test("a beat that came back as a verdict is asked for once more", async () => {
  const pack = await realPack();
  const client = recorder({
    anchor: [{ resolution_beat: CONCLUSION }, { resolution_beat: VERDICT }],
  });
  const retried = [];
  const judge = judgements({ client, pack, onBeatRetry: (beat) => retried.push(beat) });

  const anchor = await judge.anchor(SESSION);
  assert.equal(client.calls.length, 2, "asked again, once");
  assert.deepEqual(retried, [CONCLUSION], "and said so, so a session can be counted");
  assert.equal(anchor.resolution_beat, VERDICT);
  // The re-ask carries the note; the first ask does not.
  assert.doesNotMatch(client.calls[0].messages[0].content, /reads as a conclusion/);
  assert.match(client.calls[1].messages[0].content, /reads as a conclusion/);
});

test("a beat that is a verdict twice running does not hold the reading up", async () => {
  const pack = await realPack();
  const client = recorder({
    anchor: [{ resolution_beat: CONCLUSION }, { resolution_beat: "the truth is he left" }],
  });
  const judge = judgements({ client, pack });

  const anchor = await judge.anchor(SESSION);
  assert.equal(client.calls.length, 2, "twice, never three times");
  assert.equal(anchor.resolution_beat, CONCLUSION,
               "whatever came back second is not automatically better; the reading takes the first");
});

test("a beat that is already territory is not re-asked", async () => {
  const pack = await realPack();
  const client = recorder({ anchor: { resolution_beat: VERDICT } });
  const retried = [];
  const judge = judgements({ client, pack, onBeatRetry: (beat) => retried.push(beat) });

  await judge.anchor(SESSION);
  assert.equal(client.calls.length, 1);
  assert.deepEqual(retried, []);
});
