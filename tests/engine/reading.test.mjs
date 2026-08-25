import { test } from "node:test";
import assert from "node:assert/strict";
import { startReading } from "../../web/js/engine/reading.js";
import { makeStorage, memoryBackend } from "../../web/js/storage.js";
import { declines, fakeClient, gate, realPack, wants } from "./helpers.mjs";

const SEED = "moon-4f2a91";

async function run({ gates, answers, seed = SEED, storage = null, opening = declines }) {
  const pack = await realPack();
  const client = fakeClient({ gates, opening });
  const events = [];
  const reading = startReading({
    pack, client, storage, seed, onEvent: (e) => events.push(e),
  });
  await reading.begin();
  // Every reading now starts with the opening question; tests that care about
  // it pass their own `opening`, the rest decline and get on with the cards.
  await reading.say("no, nothing in particular");
  for (const answer of answers) {
    if (reading.session.closed) break;
    await reading.say(answer);
  }
  return { reading, events, client, pack };
}

const types = (events, type) => events.filter((e) => e.type === type);
/** The system prompt for a given turn kind, since index 0 is now the opening. */
const systemFor = (client, turn) => client.calls.chat.find((c) => c.turn === turn).system;

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
                   ["opening", "invite", "respond", "bridge", "respond", "bridge", "respond", "close"]);
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
  const first = systemFor(client, "invite");
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
  const system = systemFor(client, "invite");
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
  assert.equal(saved.exchanges.at(-1).a, "something");
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
  const system = systemFor(client, "invite");
  for (const detail of card.details) {
    assert.ok(system.includes(detail), `missing detail: ${detail}`);
  }
});

test("the detail list is framed for recognition, never for narration", async () => {
  const { client } = await run({ gates: [gate(1, false)], answers: ["hm"] });
  const system = systemFor(client, "invite");
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

test("the reader knows the user was given no words about the picture", async () => {
  const { client, reading, pack } = await run({ gates: [gate(1, false)], answers: ["hm"] });
  const system = systemFor(client, "invite");
  assert.match(system, /They have not been given any words about it/);
  assert.match(system, /Only then, and never as an opening/);
  // Still available to the reader, as the fallback the field is named for.
  const card = pack.card(reading.session.cards[0].card_id);
  assert.ok(system.includes(card.imagery_line));
});

test("the opening turn names the card; it does not just gesture at it", async () => {
  const { client } = await run({ gates: [gate(1, false)], answers: ["hm"] });
  assert.match(systemFor(client, "invite"), /Name the\ncard and the position it landed in/);
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

test("nothing is dealt until they have been asked what they came for", async () => {
  const pack = await realPack();
  const client = fakeClient({ opening: declines });
  const reading = startReading({ pack, client, seed: SEED });
  await reading.begin();
  assert.equal(reading.session.cards.length, 0, "no card turns before the question");
  assert.equal(reading.session.phase, "opening");
  assert.equal(client.calls.chat[0].turn, "opening");
});

test("a named topic becomes the ground the reading is bent toward", async () => {
  const { client, reading } = await run({
    gates: [gate(2, false)], answers: ["it looks stuck"],
    opening: wants("whether to leave my job"),
  });
  assert.equal(reading.session.topic, "whether to leave my job");
  const system = systemFor(client, "invite");
  assert.match(system, /What they said they wanted to look at/);
  assert.match(system, /whether to leave my job/);
  assert.match(system, /bend the card toward this/);
});

test("declining is a real answer, not a subject to be invented for them", async () => {
  const { client, reading } = await run({ gates: [gate(2, false)], answers: ["it looks stuck"] });
  assert.equal(reading.session.topic, null);
  const system = systemFor(client, "invite");
  assert.match(system, /They did not name a topic/);
  assert.match(system, /Do not ask again and do not invent a subject/);
});

test("the anchor is told the topic, so the first card cannot change the subject", async () => {
  const { client } = await run({
    gates: [gate(3, true), gate(1, false)], answers: ["a", "b"],
    opening: wants("my brother"),
  });
  const anchorCall = client.calls.judge.find((c) => c.schema.properties.theme);
  assert.match(anchorCall.messages[0].content, /wanted to look at: "my brother"/);
  assert.match(anchorCall.system, /the theme belongs to that\ntopic/);
});

test("crisis in the opening answer means no card is ever dealt", async () => {
  const { reading, events } = await run({
    gates: [], answers: ["yes"],
    opening: { has_topic: true, topic: "my mother died", stakes: "crisis" },
  });
  assert.equal(reading.session.safety_state, "drop_frame");
  assert.equal(reading.session.cards.length, 0, "the deck never comes out");
  assert.equal(types(events, "flip").length, 0);
});

test("the reader is told it does not turn cards, on every single turn", async () => {
  const { client } = await run({
    gates: [gate(2, false), gate(3, true)], answers: ["a", "b"],
  });
  for (const call of client.calls.chat) {
    assert.match(call.system, /You do not turn the cards/, `missing on the ${call.turn} turn`);
    assert.match(call.system, /Never name a card you have not been given here/);
  }
});

test("a respond turn says outright that nothing flipped", async () => {
  const { client } = await run({ gates: [gate(1, false), gate(1, false)], answers: ["a", "b"] });
  const respond = systemFor(client, "respond");
  assert.match(respond, /\*\*No card turns over on this turn\.\*\*/);
  assert.match(respond, /do not hint that it is coming/);
});

test("the reader is told how many positions remain and that it cannot know them", async () => {
  const { client } = await run({ gates: [gate(3, true), gate(1, false)], answers: ["a", "b"] });
  const system = systemFor(client, "respond");
  assert.match(system, /1 position still to come\. You do not know which cards those are\./);
});

test("every turn instruction still carries the rules it is supposed to", async () => {
  // A guard against edits that silently fail to apply: each turn's instruction
  // is checked for the thing it exists to say. Two prompt fixes were lost this
  // way before this test existed.
  const { readerSystem } = await import("../../web/js/engine/prompts.js");
  const pack = await realPack();
  const base = {
    positions: ["situation", "obstacle", "advice"], exchanges: [], anchor: null,
    safety_state: "normal", last_stakes: "low", phase: "reading", topic: null,
    cards: [{ card_id: "major-00-fool", position: "situation", user_projection: "", ai_reading: "" }],
  };
  const required = {
    opening: [/Nothing has been dealt yet/, /Make declining genuinely easy/],
    invite: [/Name the\ncard and the position/, /Do not interpret it first/],
    respond: [/No card turns over on this turn/, /never a repetition or an emphasis\nyou did not see/,
              /do not spend it again/, /end your\nturn on it/],
    bridge: [/Two things, in one short turn/, /End on the question about it/],
    close: [/one small concrete thing/, /Then stop/],
  };
  for (const [turn, patterns] of Object.entries(required)) {
    const system = readerSystem({ pack, session: base, turn });
    for (const pattern of patterns) {
      assert.match(system, pattern, `the ${turn} turn lost: ${pattern}`);
    }
  }
});

test("a frame dropped before any card lets the conversation continue", async () => {
  const { reading } = await run({
    gates: [], answers: ["yes, last week", "thank you"],
    opening: { has_topic: true, topic: "my mother died", stakes: "crisis" },
  });
  assert.equal(reading.session.cards.length, 0);
  assert.equal(reading.session.exchanges.length, 3, "the conversation kept going without cards");
  assert.equal(reading.session.exchanges.at(-1).position, "off_frame");
});
