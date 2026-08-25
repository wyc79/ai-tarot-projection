import { test } from "node:test";
import assert from "node:assert/strict";
import { startReading } from "../../web/js/engine/reading.js";
import { makeStorage, memoryBackend } from "../../web/js/storage.js";
import { fakeClient, gate, realPack } from "./helpers.mjs";

const SEED = "moon-4f2a91";

async function run({ gates, answers, seed = SEED, storage = null }) {
  const pack = await realPack();
  const client = fakeClient({ gates });
  const events = [];
  const reading = startReading({
    pack, client, storage, seed, onEvent: (e) => events.push(e),
  });
  await reading.begin();
  for (const answer of answers) {
    if (reading.session.closed) break;
    await reading.say(answer);
  }
  return { reading, events, client, pack };
}

const types = (events, type) => events.filter((e) => e.type === type);

test("a full seeded session runs draw -> projection -> flips -> anchor -> close", async () => {
  const { reading, events } = await run({
    // two exchanges per card, judge says ready each second time
    gates: [
      gate(2, false), gate(2, true),   // situation
      gate(2, false), gate(2, true),   // obstacle
      gate(2, false), gate(2, true),   // advice
    ],
    answers: ["it looks like leaving", "the job, I think", "money", "and my father",
              "start over", "somewhere quieter"],
  });

  const s = reading.session;
  assert.equal(s.cards.length, 3, "all three positions were reached");
  assert.deepEqual(s.cards.map((c) => c.position), ["situation", "obstacle", "advice"]);
  assert.ok(s.anchor, "the anchor was committed");
  assert.equal(s.closed, true);
  assert.equal(s.closing_reflection, "[close]", "the closing turn ran, not another follow-up");
  assert.equal(types(events, "flip").length, 3);
  assert.equal(types(events, "closed").length, 1);
});

test("the turns run in the designed order: invite, then bridges, then close", async () => {
  const { client } = await run({
    gates: [gate(2, false), gate(2, true), gate(2, false), gate(2, true), gate(2, false), gate(2, true)],
    answers: ["a", "b", "c", "d", "e", "f"],
  });
  assert.deepEqual(client.calls.chat.map((c) => c.turn),
                   ["invite", "respond", "bridge", "respond", "bridge", "respond", "close"]);
});

test("a bridge turn is credited to the card it answered, not the one it turned", async () => {
  const { reading } = await run({ gates: [gate(3, true), gate(1, false)], answers: ["deep", "hm"] });
  const [first, second] = reading.session.cards;
  assert.equal(first.ai_reading, "[bridge]", "the bridge answered the first card");
  assert.equal(second.ai_reading, "[respond]", "the second card has its own reading");
});

test("the seed is emitted at the start, before anything can go wrong", async () => {
  const { events } = await run({ gates: [gate(0, false)], answers: ["hm"] });
  assert.equal(events[0].type, "session_start");
  assert.equal(events[0].seed, SEED);
});

test("the same seed deals the same cards", async () => {
  const a = await run({ gates: [gate(3, true), gate(3, true)], answers: ["deep", "deeper"] });
  const b = await run({ gates: [gate(3, true), gate(3, true)], answers: ["deep", "deeper"] });
  assert.deepEqual(
    a.reading.session.cards.map((c) => c.card_id),
    b.reading.session.cards.map((c) => c.card_id),
  );
});

test("a different seed deals different cards", async () => {
  const a = await run({ gates: [gate(3, true)], answers: ["deep"] });
  const b = await run({ gates: [gate(3, true)], answers: ["deep"], seed: "tower-000001" });
  assert.notDeepEqual(
    a.reading.session.cards.map((c) => c.card_id),
    b.reading.session.cards.map((c) => c.card_id),
  );
});

test("the reader is asked to invite first and never to interpret first", async () => {
  const { client } = await run({ gates: [gate(1, false)], answers: ["dunno"] });
  const first = client.calls.chat[0].system;
  assert.match(first, /they read it first|have not spoken about it yet/i);
  assert.match(first, /have not earned the right/i);
});

test("a thin answer holds the card; a rich one earns the next", async () => {
  const thin = await run({ gates: [gate(0, false)], answers: ["idk"] });
  assert.equal(thin.reading.session.cards.length, 1, "a shrug must not advance the spread");

  const rich = await run({ gates: [gate(3, false)], answers: ["my brother, and I haven't called him"] });
  assert.equal(rich.reading.session.cards.length, 2, "a rich answer earns the card early");
});

test("crisis drops the frame on the first answer and no card ever follows", async () => {
  const { reading, events } = await run({
    gates: [gate(2, true, "crisis"), gate(2, true, "low")],
    answers: ["my mother died last week", "yes"],
  });
  assert.equal(reading.session.safety_state, "drop_frame");
  assert.equal(reading.session.cards.length, 1, "the reading must not keep dealing");
  assert.equal(types(events, "frame_dropped").length, 2);
  assert.equal(types(events, "flip_decision").length, 0, "the rhythm is not even consulted");
});

test("the drop-frame instruction replaces the reader's voice, not decorates it", async () => {
  const { client } = await run({ gates: [gate(2, true, "crisis")], answers: ["I don't want to be here"] });
  const system = client.calls.chat.at(-1).system;
  assert.match(system, /the frame is dropped/i);
  assert.match(system, /No cards\./);
  assert.doesNotMatch(system, /## This turn\n\nThe card has just turned over/);
});

test("high stakes hands agency back without dropping the frame", async () => {
  const { client, reading } = await run({ gates: [gate(2, false, "high")], answers: ["whether to sue"] });
  assert.equal(reading.session.safety_state, "normal");
  assert.match(client.calls.chat.at(-1).system, /hand agency back/i);
});

test("the anchor is committed from the first card and reaches later prompts", async () => {
  const { client, reading } = await run({
    gates: [gate(3, true), gate(1, false)],
    answers: ["treading water", "yeah"],
  });
  assert.equal(reading.session.anchor.theme, "t");
  const later = client.calls.chat.at(-1).system;
  assert.match(later, /What this reading is about/);
  assert.match(later, /Do not\ncontradict it/);
});

test("the anchor is not re-judged once committed", async () => {
  const { client } = await run({
    gates: [gate(3, true), gate(3, true)],
    answers: ["a", "b"],
  });
  const anchorCalls = client.calls.judge.filter((c) => c.schema.properties.theme);
  assert.equal(anchorCalls.length, 1);
});

test("the card on the table reaches the prompt with its imagery line and position sense", async () => {
  const { client, pack } = await run({ gates: [gate(1, false)], answers: ["hm"] });
  const system = client.calls.chat[0].system;
  const card = pack.card(
    (await run({ gates: [gate(1, false)], answers: ["hm"] })).reading.session.cards[0].card_id,
  );
  assert.ok(system.includes(card.imagery_line), "the neutral imagery line is what they project onto");
  assert.ok(system.includes(card.meanings.situation), "position sense, not just the general one");
});

test("the transcript alternates and never ends on an assistant turn", async () => {
  const { client } = await run({ gates: [gate(1, false), gate(1, false)], answers: ["a", "b"] });
  for (const call of client.calls.chat) {
    assert.equal(call.messages.at(-1).role, "user",
                 "a trailing assistant message is a prefill, which current models reject");
  }
});

test("the session is persisted as it goes, and survives a reload", async () => {
  const storage = makeStorage(memoryBackend());
  const { reading } = await run({ gates: [gate(2, false)], answers: ["something"], storage });
  const saved = storage.get("session");
  assert.equal(saved.seed, SEED);
  assert.equal(saved.cards.length, reading.session.cards.length);
  assert.equal(saved.exchanges[0].a, "something");
});

test("a closed reading refuses further turns", async () => {
  const { reading } = await run({
    gates: [gate(3, true), gate(3, true), gate(3, true)],
    answers: ["a", "b", "c"],
  });
  assert.equal(reading.session.closed, true);
  await assert.rejects(reading.say("more"), /closed/);
});

test("the reader is told not to invent what the user said", async () => {
  const { client } = await run({ gates: [gate(2, false)], answers: ["they look like family"] });
  const system = client.calls.chat.at(-1).system;
  assert.match(system, /Never invent what they said/);
  assert.match(system, /One\nmention is one mention/);
});

test("every turn but the last is told to end on a question", async () => {
  const { client } = await run({
    gates: [gate(2, false), gate(3, true), gate(3, true), gate(3, true)],
    answers: ["a", "b", "c", "d"],
  });
  for (const call of client.calls.chat) {
    if (call.turn === "close") {
      assert.doesNotMatch(call.system, /## This turn[\s\S]*end (?:your turn )?on (?:it|the question)/);
    } else {
      assert.match(call.system, /Every turn ends with a question/);
    }
  }
});

test("the anchor's phrases are not presented as things they keep saying", async () => {
  const { client } = await run({ gates: [gate(3, true), gate(1, false)], answers: ["treading water", "hm"] });
  const system = client.calls.chat.at(-1).system;
  assert.match(system, /not evidence that they say it\noften/);
  assert.doesNotMatch(system, /- their words:/);
});

test("the reader is given what is actually in the picture, not just the one line", async () => {
  const { client, reading, pack } = await run({ gates: [gate(1, false)], answers: ["hm"] });
  const card = pack.card(reading.session.cards[0].card_id);
  const system = client.calls.chat[0].system;
  for (const detail of card.details) {
    assert.ok(system.includes(detail), `missing detail: ${detail}`);
  }
});

test("the detail list is framed for recognition, never for narration", async () => {
  const { client } = await run({ gates: [gate(1, false)], answers: ["hm"] });
  const system = client.calls.chat[0].system;
  assert.match(system, /so you can recognise whatever they point at/);
  assert.match(system, /Do not tell them what is in the\npicture/);
  assert.match(system, /believe them and ask about it/);
});

test("agency is handed back once, not every turn the subject comes up", async () => {
  const { client, reading } = await run({
    gates: [gate(2, false, "high"), gate(2, false, "high"), gate(2, false, "high")],
    answers: ["whether to sue", "still about the lawsuit", "and the money"],
  });
  // Match the injected block, not the persona's standing rule, which every
  // system prompt carries.
  const handbacks = client.calls.chat.filter((c) => /This is the only turn in\nwhich you will say it/.test(c.system));
  assert.equal(handbacks.length, 1, "a disclaimer repeated every turn stops being heard");
  assert.equal(reading.session.handback_given, true);
  assert.equal(reading.session.safety_state, "normal", "high stakes never drops the frame");
});

test("the reader is told not to read the printed line back", async () => {
  const { client } = await run({ gates: [gate(1, false)], answers: ["hm"] });
  assert.match(client.calls.chat[0].system, /Do not say it back to them/);
});

test("the opening turn names the card; it does not just gesture at it", async () => {
  const { client } = await run({ gates: [gate(1, false)], answers: ["hm"] });
  assert.match(client.calls.chat[0].system, /Name the\ncard and the position it landed in/);
});

test("every turn is persisted to a capped history, unfinished ones included", async () => {
  const { makeStorage, memoryBackend } = await import("../../web/js/storage.js");
  const { loadHistory } = await import("../../web/js/engine/journal.js");
  const storage = makeStorage(memoryBackend());
  const { reading } = await run({ gates: [gate(1, false)], answers: ["abandoned here"], storage });
  const history = loadHistory(storage);
  assert.equal(history.length, 1, "one session, saved in place rather than appended per turn");
  assert.equal(history[0].session_id, reading.session.session_id);
  assert.equal(history[0].closed, false, "an unfinished reading is still worth keeping");
});
