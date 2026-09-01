import { test } from "node:test";
import assert from "node:assert/strict";
import { MEANINGS_REQUEST, startReading } from "../../web/js/engine/reading.js";
import { toMarkdown } from "../../web/js/engine/journal.js";
import { makeStorage, memoryBackend } from "../../web/js/storage.js";
import {
  cardOnly, declines, fakeClient, gate, promptFor, realPack, sessionShowing, wants,
} from "./helpers.mjs";

const SEED = "moon-4f2a91";

async function run({ gates, answers, seed = SEED, storage = null, opening = declines, reply }) {
  const pack = await realPack();
  const client = fakeClient({ gates, opening, ...(reply ? { reply } : {}) });
  const events = [];
  const reading = startReading({
    pack, client, storage, seed, onEvent: (e) => events.push(e),
  });
  await reading.begin();
  // Every reading now starts with the opening question; tests that care about
  // it pass their own `opening`, the rest decline and get on with the cards.
  await reading.say("no, nothing in particular");
  for (const answer of answers) {
    // Runs past the closing beat: a session ends at the farewell now, and the
    // tail between the two is part of what these tests are checking.
    if (reading.session.ended) break;
    await reading.say(answer);
  }
  return { reading, events, client, pack };
}

/**
 * Four cards' worth of ordinary answers, and one for the tail after the beat.
 *
 * The budget rises across the arc -- situation 2, obstacle 3, advice 3 -- and
 * the fourth card is decided before the close now, so a reading where anything
 * real was said turns it and spends its two. A session that goes well is ten
 * answers and a goodbye.
 */
const FULL_ARC = ["it looks like leaving", "the job, I think",
                  "money", "and my father", "since the spring",
                  "start over", "somewhere quieter", "by myself for a bit",
                  "the one at the back", "that I never say it out loud"];
const fullGates = () => Array.from({ length: 10 }, () => gate(3));

const types = (events, type) => events.filter((e) => e.type === type);
/** The system prompt for a given turn kind, since the order is not fixed. */
const systemFor = (client, turn) => client.calls.chat.find((c) => c.turn === turn).prompt;

test("a full seeded session runs draw -> projection -> flips -> anchor -> close", async () => {
  const { reading, events } = await run({ gates: fullGates(), answers: FULL_ARC });

  const s = reading.session;
  assert.equal(s.cards.length, 4, "every position was reached, the fourth included");
  assert.deepEqual(s.cards.map((c) => c.position),
                   ["situation", "obstacle", "advice", "epilogue"]);
  assert.ok(s.anchor, "the anchor was committed");
  assert.equal(s.closed, true);
  assert.equal(s.closing_reflection, "[close]", "the closing turn ran, not another follow-up");
  assert.equal(types(events, "flip").length, 4);
  assert.equal(types(events, "closed").length, 1, "ONE closing beat, whatever else happened");
});

test("the whole spread is face down on the table before a word is said", async () => {
  const pack = await realPack();
  const client = fakeClient({ opening: declines });
  const reading = startReading({ pack, client, seed: SEED });
  await reading.begin();

  const { tableau } = await import("../../web/js/engine/state.js");
  const table = tableau(reading.session);
  assert.equal(table.length, 4, "three positions and the fourth card, all dealt");
  assert.deepEqual(table.map((t) => t.position),
                   ["situation", "obstacle", "advice", "epilogue"]);
  assert.ok(table.every((t) => !t.face_up), "and every one of them face down");
  assert.equal(new Set(table.map((t) => t.card_id)).size, 4, "four different cards");
  assert.equal(reading.session.cards.length, 0, "nothing has turned over yet");
});

test("a card turns over in place: same card the table was holding for it", async () => {
  const { reading } = await run({ gates: [gate(3), gate(3)], answers: ["a", "b"] });
  const { dealtCardFor } = await import("../../web/js/engine/state.js");
  for (const card of reading.session.cards) {
    assert.equal(card.card_id, dealtCardFor(reading.session, card.position),
                 "flipping reveals what was already lying there, it does not draw");
  }
});

test("the turns run in the designed order: invite, bridges, epilogue, close, farewell", async () => {
  const { client } = await run({
    gates: [...fullGates(), gate(1), gate(1)],
    answers: [...FULL_ARC, "what happens after noticing though", "fair enough"],
  });
  assert.deepEqual(client.calls.chat.map((c) => c.turn),
                   ["invite", "respond", "bridge", "respond", "respond",
                    "bridge", "respond", "respond", "epilogue", "respond", "close",
                    "after", "farewell"]);
});

test("the fourth card turns BEFORE the close, so there is only ever one ending", async () => {
  const { reading, events, client } = await run({ gates: fullGates(), answers: FULL_ARC });
  const order = client.calls.chat.map((c) => c.turn);
  assert.ok(order.indexOf("epilogue") < order.indexOf("close"),
            "the earn check is at the advice-to-close boundary, not after it");
  assert.equal(order.filter((t) => t === "close").length, 1);
  assert.equal(types(events, "closed").length, 1);
  // The old sequencing wrote the beat onto the advice card and then wrote a
  // second one over the whole session. The advice card now carries the bridge
  // that turned the fourth, and the one beat is the session's.
  assert.equal(reading.session.closing_reflection, "[close]");
  assert.equal(reading.session.cards.at(-1).ai_reading, "[close]");
});

test("a bridge turn is credited to the card it answered, not the one it turned", async () => {
  const { reading } = await run({
    gates: [gate(4), gate(4), gate(2)], answers: ["deep", "and my brother", "hm"],
  });
  const [first, second] = reading.session.cards;
  assert.equal(first.ai_reading, "[bridge]", "the bridge answered the first card");
  assert.equal(second.ai_reading, "[respond]", "the second card has its own reading");
});

test("the seed is emitted at the start, before anything can go wrong", async () => {
  const { events } = await run({ gates: [gate(1)], answers: ["hm"] });
  assert.equal(events[0].type, "session_start");
  assert.equal(events[0].seed, SEED);
});

test("the same seed deals the same cards", async () => {
  const a = await run({ gates: [gate(4), gate(4)], answers: ["deep", "deeper"] });
  const b = await run({ gates: [gate(4), gate(4)], answers: ["deep", "deeper"] });
  assert.deepEqual(
    a.reading.session.cards.map((c) => c.card_id),
    b.reading.session.cards.map((c) => c.card_id),
  );
});

test("a different seed deals different cards", async () => {
  const a = await run({ gates: [gate(4)], answers: ["deep"] });
  const b = await run({ gates: [gate(4)], answers: ["deep"], seed: "tower-000001" });
  assert.notDeepEqual(
    a.reading.session.cards.map((c) => c.card_id),
    b.reading.session.cards.map((c) => c.card_id),
  );
});

test("the reader is asked to invite first and never to interpret first", async () => {
  const { client } = await run({ gates: [gate(2)], answers: ["dunno"] });
  const first = systemFor(client, "invite");
  assert.match(first, /they read it first|have not spoken about it yet/i);
  assert.match(first, /have not earned the right/i);
});

test("a thin answer holds the card; a rich one earns the next", async () => {
  const thin = await run({ gates: [gate(1)], answers: ["idk"] });
  assert.equal(thin.reading.session.cards.length, 1, "a shrug must not advance the spread");

  const rich = await run({
    gates: [gate(4), gate(4)],
    answers: ["my brother, and I haven't called him", "since March"],
  });
  assert.equal(rich.reading.session.cards.length, 2,
               "a rich answer earns the card, one dwell exchange later");
});

test("crisis drops the frame on the first answer and no card ever follows", async () => {
  const { reading, events } = await run({
    gates: [gate(3, "crisis"), gate(3, "low")],
    answers: ["my mother died last week", "yes"],
  });
  assert.equal(reading.session.safety_state, "drop_frame");
  assert.equal(reading.session.cards.length, 1, "the reading must not keep dealing");
  assert.equal(types(events, "frame_dropped").length, 2);
  assert.equal(types(events, "flip_decision").length, 0, "the rhythm is not even consulted");
});

test("the drop-frame instruction replaces the reader's voice, not decorates it", async () => {
  const { client, events } = await run({ gates: [gate(3, "crisis")], answers: ["I don't want to be here"] });
  const system = client.calls.chat.at(-1).prompt.replace(/\s+/g, " ");
  assert.match(system, /the frame is dropped/i);
  assert.match(system, /No cards\./);
  // The rule, asked of the plan rather than of the paragraph that expresses it.
  const plan = events.filter((e) => e.type === "reader_start").at(-1).plan;
  assert.deepEqual(plan.rules, ["frame_dropped"], "it replaces the voice, it does not decorate it");
  assert.equal(plan.kind, "respond", "and no card turned over into it");
});

test("high stakes hands agency back without dropping the frame", async () => {
  const { client, reading } = await run({ gates: [gate(3, "high")], answers: ["whether to sue"] });
  assert.equal(reading.session.safety_state, "normal");
  assert.match(client.calls.chat.at(-1).prompt, /hand agency back/i);
});

test("the anchor is committed from the first card and reaches later prompts", async () => {
  const { client, reading } = await run({
    gates: [gate(4), gate(4)],
    answers: ["treading water", "yeah, since the move"],
  });
  assert.equal(reading.session.anchor.theme, "t");
  const later = client.calls.chat.at(-1).prompt;
  assert.match(later, /## Session record/);
  assert.match(later, /theme: t/);
});

test("the anchor is revised as more of their life arrives, not frozen on card one", async () => {
  // It used to freeze on the first commit, which was right when the first card
  // was all it could be built from. The dwell rule means the material that
  // decides what a session is about now usually lands after that.
  // The anchor commits on the first flip, which the dwell puts one exchange
  // later than it used to be; the revision is the disclosure after that.
  const { client } = await run({
    gates: [gate(4), gate(4), gate(4)],
    answers: ["treading water", "since the move in March", "I stopped calling people back"],
  });
  const anchorCalls = client.calls.judge.filter((c) => c.kind === "anchor");
  assert.equal(anchorCalls.length, 2, "committed on the first card, revised on the next disclosure");
  assert.match(anchorCalls[1].messages[0].content, /revising rather than replacing/);
  assert.match(anchorCalls[1].messages[0].content, /since the move in March/);
});

test("a hedged answer does not move the anchor", async () => {
  const { client } = await run({
    gates: [gate(4), gate(4), { ...gate(3), hedged: true }],
    answers: ["treading water", "since the move", "i guess so? a different trade"],
  });
  const anchorCalls = client.calls.judge.filter((c) => c.kind === "anchor");
  assert.equal(anchorCalls.length, 1, "they have not decided to give it yet");
});

test("the card on the table reaches the prompt with its imagery line and position sense", async () => {
  const { client, pack } = await run({ gates: [gate(2)], answers: ["hm"] });
  const system = systemFor(client, "invite");
  const card = pack.card(
    (await run({ gates: [gate(2)], answers: ["hm"] })).reading.session.cards[0].card_id,
  );
  assert.ok(system.includes(card.imagery_line), "the neutral imagery line is what they project onto");
  assert.ok(system.includes(card.meanings.situation), "position sense, not just the general one");
});

test("the transcript alternates and never ends on an assistant turn", async () => {
  const { client } = await run({ gates: [gate(2), gate(2)], answers: ["a", "b"] });
  for (const call of client.calls.chat) {
    assert.equal(call.messages.at(-1).role, "user",
                 "a trailing assistant message is a prefill, which current models reject");
  }
});

test("the session is persisted as it goes, and survives a reload", async () => {
  const storage = makeStorage(memoryBackend());
  const { reading } = await run({ gates: [gate(3)], answers: ["something"], storage });
  const saved = storage.get("session");
  assert.equal(saved.seed, SEED);
  assert.equal(saved.cards.length, reading.session.cards.length);
  assert.equal(saved.exchanges.at(-1).a, "something");
});

test("after the beat: one real answer, then the reader says goodbye", async () => {
  const { reading, client } = await run({ gates: fullGates(), answers: FULL_ARC });
  const s = reading.session;
  assert.equal(s.closed, true);
  assert.equal(s.ended, false, "closing is not hanging up; there is a tail");
  assert.equal(client.calls.chat.at(-1).turn, "close");

  await reading.say("what happens after the noticing though");
  assert.equal(client.calls.chat.at(-1).turn, "after", "a real question gets a real answer");
  assert.equal(s.ended, false);

  await reading.say("makes sense, thanks");
  assert.equal(client.calls.chat.at(-1).turn, "farewell", "and then it lets them go");
  assert.equal(s.ended, true, "a session ends; it does not trail off");
  assert.equal(s.farewell, "[farewell]", "the goodbye is kept beside the beat, not inside it");
  assert.equal(s.closing_reflection, "[close]", "the beat it ended on is still the beat");
  assert.equal(s.cards.length, 4, "and nothing turned over in the tail");

  const afterward = s.exchanges.filter((e) => e.position === "afterward");
  assert.equal(afterward.length, 2, "under their own position, off every card's rhythm");
  await assert.rejects(reading.say("more"), /ended/);
});

test("a second say() while the first is still running is refused, not queued", async () => {
  const pack = await realPack();
  const client = fakeClient({ gates: [gate(3), gate(3)], opening: declines });
  // A model that has not answered yet. The judge still returns straight away,
  // so the second say() gets past the gate exactly the way the playtester's did
  // -- what stops it is the flag, not the arithmetic.
  const chat = client.chat.bind(client);
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  client.chat = async (call) => {
    await held;
    return chat(call);
  };

  const storage = makeStorage(memoryBackend());
  const reading = startReading({ pack, client, storage, seed: SEED });
  release();
  await reading.begin();
  await reading.say("nothing in particular");

  // From here the model is parked mid-turn, which is the several seconds of
  // silence someone sends into twice.
  const parked = new Promise((resolve) => { release = resolve; });
  client.chat = async (call) => {
    await parked;
    return chat(call);
  };

  const first = reading.say("a");
  const second = reading.say("b");
  // Both calls are made before the model is let go, so an engine with no guard
  // fails this on the count rather than deadlocking on a turn nobody released.
  release();
  await assert.rejects(second, /a turn is already in flight/);
  await first;

  const answered = reading.session.exchanges.filter((e) => e.position !== "opening");
  assert.equal(answered.length, 1, "one answer went in, not two");
  assert.equal(answered[0].a, "a");
  assert.equal(client.calls.chat.filter((c) => c.turn !== "invite").length, 1,
               "and one reader turn ran over it");

  // And the flag is put down again, so the refusal is not the end of the session.
  await reading.say("b");
  assert.equal(reading.session.exchanges.filter((e) => e.position !== "opening").length, 2);
});

test("the meanings are not on offer until the reading has closed", async () => {
  const { reading } = await run({ gates: [gate(2)], answers: ["it looks tired"] });
  assert.equal(reading.session.closed, false);
  await assert.rejects(reading.meanings(), /has not closed yet/,
                       "the traditional sense is the thing this reading exists instead of, "
                       + "right up until the projection work is done");
});

test("asked after the close, the meanings turn names every card that turned and no other", async () => {
  // A reading nobody gave anything to: it closes on three, and the fourth is
  // still lying there face down, which is the case the instruction is about.
  // Twelve answers is the close and not a word past it -- the tail runs out on
  // the thirteenth, and the goodbye takes the offer with it.
  const { reading, client, pack } = await run({
    gates: Array.from({ length: 12 }, () => gate(1)),
    answers: Array.from({ length: 12 }, (_, i) => `thin ${i}`),
  });
  assert.equal(reading.session.ended, false, "the goodbye has not been said yet");
  assert.equal(reading.session.closed, true);
  assert.equal(reading.session.cards.length, 3, "and one stayed with the deck");

  await reading.meanings();

  const calls = client.calls.chat.filter((c) => c.turn === "meanings");
  assert.equal(calls.length, 1, "one turn, not a mode the reading is now in");
  const prompt = calls[0].prompt;
  for (const entry of reading.session.cards) {
    const card = pack.card(entry.card_id);
    assert.ok(prompt.includes(card.name),
              `the record names ${entry.position}, so the turn can`);
    // The whole point of the turn: the answer for every card comes off the
    // pack, not out of whatever the model knows about the deck. Only the card
    // in front of them used to arrive with its curated position sense, so two
    // of the three answers were improvised.
    assert.ok(prompt.includes(pack.meaning(card, entry.position)),
              `${entry.position} reaches the turn with the meaning for its position`);
  }
  // The one that never turned is in the prompt as a position with no card. Its
  // name is the thing the reader has not seen and must not invent, and its
  // meaning would name it just as surely.
  const { tableau } = await import("../../web/js/engine/state.js");
  const down = tableau(reading.session).filter((t) => !t.face_up);
  assert.equal(down.length, 1);
  const unseen = pack.card(down[0].card_id);
  assert.ok(!prompt.includes(unseen.name),
            "a face-down card is not named anywhere the turn could read it");
  assert.ok(!prompt.includes(pack.meaning(unseen, down[0].position)),
            "and it is absent rather than listed as unknown");
  assert.match(prompt.replace(/\s+/g, " "), /Do not name a face-down card/);
});

test("the goodbye is the last thing the reader says; the meanings are not on offer after it", async () => {
  const { reading } = await run({ gates: fullGates(), answers: FULL_ARC });
  await reading.say("what happens after the noticing though");
  await reading.say("makes sense, thanks");
  assert.equal(reading.session.ended, true, "the farewell landed");

  await assert.rejects(reading.meanings(), /ended/,
                       "a turn generated after the goodbye takes the goodbye back");

  // The door the farewell already offered is the way to them: staying a while
  // reopens the reading's own tail, and the offer is standing in it.
  reading.stayAWhile();
  await reading.meanings();
  assert.equal(reading.session.exchanges.at(-1).a, MEANINGS_REQUEST);
});

test("a reading that asked for the meanings after staying does not say goodbye twice", async () => {
  const { reading, pack } = await run({ gates: fullGates(), answers: FULL_ARC });
  await reading.say("what happens after the noticing though");
  await reading.say("makes sense, thanks");
  reading.stayAWhile();
  await reading.meanings();

  // The farewell used to be lastQuestion still, so the meanings exchange was
  // recorded with the goodbye as its question and the keepsake printed it
  // twice: once above the button press, once at the end where it belongs.
  const farewell = reading.session.farewell;
  const markdown = toMarkdown(pack, reading.session);
  assert.equal(markdown.split(farewell).length - 1, 1,
               "the goodbye is said once, and it is the last thing in the file");
});

test("asking what the cards mean does not spend one of the turns before goodbye", async () => {
  const tail = ["what happens after the noticing though", "fair enough"];
  const control = await run({
    gates: [...fullGates(), gate(1), gate(1)], answers: [...FULL_ARC, ...tail],
  });
  assert.equal(control.reading.session.ended, true, "the control reached its goodbye");

  const asked = await run({ gates: fullGates(), answers: FULL_ARC });
  await asked.reading.meanings();
  asked.client.gates.push(gate(1), gate(1));
  for (const answer of tail) {
    if (asked.reading.session.ended) break;
    await asked.reading.say(answer);
  }

  assert.equal(asked.reading.session.ended, true, "and so did the one that asked");
  const spent = (r) => r.session.exchanges.filter((e) => e.position === "afterward" && !e.aside);
  assert.equal(spent(asked.reading).length, spent(control.reading).length,
               "the same number of turns of theirs, either way");
  const turns = (c) => c.calls.chat.map((t) => t.turn).filter((t) => t !== "meanings");
  assert.deepEqual(turns(asked.client), turns(control.client),
                   "and the same turns in the same order around it");
});

test("the tail runs to its cap for someone who keeps saying real things", async () => {
  const { reading, client } = await run({
    gates: [...fullGates(), gate(3), gate(3), gate(3)], answers: FULL_ARC,
  });
  // Every one of them a real thing to say, which is what buys the extra turns.
  for (const answer of ["but what does noticing get me", "I have tried that before",
                        "and it did not stick then either"]) {
    if (!reading.session.ended) await reading.say(answer);
  }
  const afterward = reading.session.exchanges.filter((e) => e.position === "afterward");
  assert.equal(afterward.length, 3, "three is the cap, and it is a cap rather than a target");
  assert.equal(client.calls.chat.at(-1).turn, "farewell");
  assert.equal(reading.session.ended, true);
});

test("the reader is told the spread is spent, and told not to say goodbye twice", async () => {
  const { reading, client } = await run({ gates: fullGates(), answers: FULL_ARC });
  await reading.say("thanks, that was interesting");
  const prompt = client.calls.chat.at(-1).prompt.replace(/\s+/g, " ");
  assert.match(prompt, /THE READING IS FINISHED/);
  assert.match(prompt, /No card turns over/);
  assert.match(prompt, /do not promise a second reading/);
  assert.match(prompt, /two goodbyes is worse than none/);
  assert.match(prompt, /none of the pacing applies any more/);
  // The ladder is still there on purpose. "Do not ask two rungs above where
  // they are standing" is about not making someone invent an answer, and that
  // does not stop being true because the cards are spent.
  assert.match(prompt, /reach no further than/);
});

test("someone can still say the thing after the beat, and the frame still drops", async () => {
  const { reading, events } = await run({
    gates: [...fullGates(), gate(4, "crisis")], answers: FULL_ARC,
  });
  const before = reading.session.cards.length;
  await reading.say("actually my brother died in March");
  assert.equal(reading.session.cards.length, before, "and no card was dealt at it");
  assert.equal(reading.session.safety_state, "drop_frame",
               "a closing beat is not a reason to stop listening");
  assert.equal(reading.session.ended, false, "and it does not say goodbye over that");
  assert.ok(events.some((e) => e.type === "frame_dropped"));
});

test("the reader is told not to invent what the user said", async () => {
  const { client } = await run({ gates: [gate(3)], answers: ["they look like family"] });
  const system = client.calls.chat.at(-1).prompt.replace(/\s+/g, " ");
  assert.match(system, /Never invent what they said/);
  assert.match(system, /One mention is one mention/);
});

test("every turn but the last is told to end on a question", async () => {
  const { client } = await run({
    gates: [gate(3), gate(4), gate(4), gate(4)],
    answers: ["a", "b", "c", "d"],
  });
  for (const call of client.calls.chat) {
    if (call.turn === "close") {
      assert.doesNotMatch(call.prompt, /## This turn[\s\S]*end (?:your turn )?on (?:it|the question)/);
    } else {
      assert.match(call.prompt.replace(/\s+/g, " "),
                   /is one or two sentences, and it is the last thing you write/);
    }
  }
});

test("the anchor's phrases are not presented as things they keep saying", async () => {
  const { client } = await run({
    gates: [gate(4), gate(4)], answers: ["treading water", "since the move"],
  });
  const system = client.calls.chat.at(-1).prompt;
  assert.match(system, /a tidier synonym is a different word/);
  assert.doesNotMatch(system, /- their words:/);
});

test("the reader is given what is actually in the picture, not just the one line", async () => {
  const { client, reading, pack } = await run({ gates: [gate(2)], answers: ["hm"] });
  const card = pack.card(reading.session.cards[0].card_id);
  const system = systemFor(client, "invite");
  for (const detail of card.details) {
    assert.ok(system.includes(detail), `missing detail: ${detail}`);
  }
});

test("the detail list is framed for recognition, never for narration", async () => {
  const { client } = await run({ gates: [gate(2)], answers: ["hm"] });
  const system = systemFor(client, "invite");
  const flat = system.replace(/\s+/g, " ");
  assert.match(flat, /for recognising what they point at/);
  assert.match(flat, /not to recite, not to assert/);
  assert.match(flat, /If they point at something that is not on your list, believe them/);
});

test("agency is handed back once, not every turn the subject comes up", async () => {
  const { client, reading } = await run({
    gates: [gate(3, "high"), gate(3, "high"), gate(3, "high")],
    answers: ["whether to sue", "still about the lawsuit", "and the money"],
  });
  // Match the injected block, not the persona's standing rule, which every
  // system prompt carries.
  const handbacks = client.calls.chat.filter((c) => /This is the only turn in\nwhich you will say it/.test(c.prompt));
  assert.equal(handbacks.length, 1, "a disclaimer repeated every turn stops being heard");
  assert.equal(reading.session.handback_given, true);
  assert.equal(reading.session.safety_state, "normal", "high stakes never drops the frame");
});

test("the reader knows the user was given no words about the picture", async () => {
  const { client, reading, pack } = await run({ gates: [gate(2)], answers: ["hm"] });
  const system = systemFor(client, "invite");
  const flat = system.replace(/\s+/g, " ");
  assert.match(flat, /They have been given no words about the picture/);
  assert.match(flat, /only to someone who has frozen: never as an opening/);
  // Still available to the reader, as the fallback the field is named for.
  const card = pack.card(reading.session.cards[0].card_id);
  assert.ok(system.includes(card.imagery_line));
});

test("the opening turn names the card; it does not just gesture at it", async () => {
  const { client } = await run({ gates: [gate(2)], answers: ["hm"] });
  assert.match(systemFor(client, "invite").replace(/\s+/g, " "),
               /Name the card and the position it landed in/);
});

test("every turn is persisted to a capped history, unfinished ones included", async () => {
  const { makeStorage, memoryBackend } = await import("../../web/js/storage.js");
  const { loadHistory } = await import("../../web/js/engine/journal.js");
  const storage = makeStorage(memoryBackend());
  const { reading } = await run({ gates: [gate(2)], answers: ["abandoned here"], storage });
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
  assert.equal(client.calls.chat.length, 0, "and the question itself costs no call");
  assert.equal(client.calls.judge.length, 0, "nor a judgement: nobody has said anything");
});

test("the opening is spoken from the pack, disclosure first, and recorded as asked", async () => {
  const pack = await realPack();
  const events = [];
  const client = fakeClient({ opening: declines });
  const reading = startReading({ pack, client, seed: SEED, onEvent: (e) => events.push(e) });
  await reading.begin();

  const scripted = events.filter((e) => e.type === "reader_scripted");
  assert.deepEqual(scripted.map((e) => e.role), ["note", "reader"],
                   "what this is, then the question -- in that order");
  assert.equal(scripted[0].text, pack.opening.disclosure);
  assert.equal(scripted[1].text, pack.opening.question);
  // Held on the session, so a reading abandoned here still exports as one that
  // asked something.
  assert.equal(reading.session.pending_question, pack.opening.question);

  await reading.say("no, nothing in particular");
  const [first] = reading.session.exchanges;
  assert.equal(first.position, "opening");
  assert.equal(first.q, pack.opening.question, "the scripted question is the one on the record");
  assert.equal(first.a, "no, nothing in particular");
  assert.notEqual(reading.session.pending_question, pack.opening.question,
                  "and the answer took it off the pending slot, which the invite then had");
});

test("a named topic becomes the ground the reading is bent toward", async () => {
  const { client, reading } = await run({
    gates: [gate(3)], answers: ["it looks stuck"],
    opening: wants("whether to leave my job"),
  });
  assert.equal(reading.session.topic, "whether to leave my job");
  const system = systemFor(client, "invite");
  assert.match(system, /What they said they wanted to look at/);
  assert.match(system, /whether to leave my job/);
  assert.match(system, /bend the card toward this/);
});

test("declining is a real answer, not a subject to be invented for them", async () => {
  const { client, reading } = await run({ gates: [gate(3)], answers: ["it looks stuck"] });
  assert.equal(reading.session.topic, null);
  const system = systemFor(client, "invite");
  assert.match(system, /They did not name a topic/);
  assert.match(system.replace(/\s+/g, " "), /Do not ask again/);
  // What replaced "do not invent a subject for them": not inventing one is
  // still the rule, but the reader is no longer told to sit back and let the
  // cards do the asking. It has something to go and do.
  assert.match(system.replace(/\s+/g, " "), /a turn written as though you do is a turn about the deck/);
});

test("the anchor is told the topic, so the first card cannot change the subject", async () => {
  const { client } = await run({
    gates: [gate(4), gate(4)], answers: ["a", "b"],
    opening: wants("my brother"),
  });
  const anchorCall = client.calls.judge.find((c) => c.kind === "anchor");
  assert.match(anchorCall.messages[0].content, /wanted to look at: "my brother"/);
  assert.match(anchorCall.system.replace(/\s+/g, " "), /the theme belongs to that topic/);
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
    gates: [gate(3), gate(4)], answers: ["a", "b"],
  });
  for (const call of client.calls.chat) {
    assert.match(call.system, /You do not turn the cards/, `missing on the ${call.turn} turn`);
    assert.match(call.system, /Never name a card you have not been given here/);
  }
});

test("a respond turn says outright that nothing flipped", async () => {
  const { client } = await run({ gates: [gate(2), gate(2)], answers: ["a", "b"] });
  const respond = systemFor(client, "respond");
  assert.match(respond, /\*\*No card turns over on this turn\.\*\*/);
  assert.match(respond, /do not hint that it is coming/);
  assert.match(respond, /One observation, then one question/);
});

test("the reader is told how many positions remain and that it cannot know them", async () => {
  const { client } = await run({ gates: [gate(4), gate(4), gate(2)], answers: ["a", "b", "c"] });
  const system = client.calls.chat.at(-1).prompt;
  assert.match(system, /2 still face down/);
  assert.match(system.replace(/\s+/g, " "), /you have not seen them and you do not know what they are/);
});

test("every turn instruction still carries the rules it is supposed to", async () => {
  // A guard against edits that silently fail to apply: each turn's instruction
  // is checked for the thing it exists to say. Two prompt fixes were lost this
  // way before this test existed.
  const pack = await realPack();
  const base = sessionShowing(pack, "major-00-fool");
  // Patterns are matched against the prompt with its whitespace collapsed, so
  // re-wrapping a paragraph does not read as losing the rule inside it. What is
  // being guarded is that the rule is still there, not how it is set.
  const required = {
    invite: [/Name the card and the position/, /Do not interpret it first/,
             /the second one is the question/],
    respond: [/No card turns over on this turn/, /One observation, then one question/,
              /never a repetition or an emphasis you did not see/,
              /do not spend it again in different words/,
              /No traditional meaning unless they asked/,
              /it is the last thing you write/],
    bridge: [/The same shape, with the card named in the middle/,
             /in a clause, not a paragraph/, /Then one question/],
    close: [/one small concrete thing/, /Then stop/],
  };
  const flat = (turn) => promptFor(pack, base, turn).replace(/\s+/g, " ");
  // The shape itself is a standing rule, so it must reach every turn.
  for (const turn of Object.keys(required)) {
    assert.match(flat(turn), /## The shape of every turn/,
                 `the ${turn} turn lost the turn-shape rule`);
  }
  for (const [turn, patterns] of Object.entries(required)) {
    const system = flat(turn);
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

test("the recap block is assembled from state, on every turn, and says it outranks history", async () => {
  const { client } = await run({
    gates: [gate(4), gate(3), gate(4)],
    answers: ["treading water", "the same job", "yes"],
    opening: wants("my job"),
  });
  for (const call of client.calls.chat) {
    assert.match(call.prompt, /## Session record/, `missing on the ${call.turn} turn`);
    assert.match(call.prompt, /the history is what was said, this is what is true/);
    assert.match(call.prompt, /Never contradict a reading you have already given/);
  }
});

test("the recap carries the anchor's phrases verbatim, marked as verbatim", async () => {
  const pack = await realPack();
  const client = fakeClient({
    gates: [gate(4), gate(4)], opening: declines,
    anchor: { theme: "treading water", resolution_beat: "r",
              user_phrases: [{ phrase: "treading water", source: "life" },
                             { phrase: "can't stop kicking", source: "life" }] },
  });
  const reading = startReading({ pack, client, seed: SEED });
  await reading.begin();
  await reading.say("nothing in particular");
  await reading.say("treading water");
  await reading.say("still kicking");
  const system = client.calls.chat.at(-1).prompt;
  assert.match(system, /their exact words: "treading water" \(life\), "can't stop kicking" \(life\)/);
  assert.match(system, /verbatim\. Reuse them as they are/);
});

test("the recap names the arc position, the depth so far, and the safety state", async () => {
  const { client } = await run({
    gates: [gate(2), gate(2)], answers: ["a general thing", "another"],
  });
  const system = client.calls.chat.at(-1).prompt;
  assert.match(system, /arc position: situation \(setup —/);
  assert.match(system, /disclosure depth on this card: 2/);
  assert.match(system, /safety: normal/);
});

test("each card's reading is recorded as one line, not the whole turn", async () => {
  const pack = await realPack();
  const long = "First sentence lands here. Then a second one that should not appear. And a third.";
  const client = fakeClient({ gates: [gate(4), gate(2)], opening: declines, reply: () => long });
  const reading = startReading({ pack, client, seed: SEED });
  await reading.begin();
  await reading.say("nothing in particular");
  await reading.say("deep answer");
  const system = client.calls.chat.at(-1).prompt;
  assert.match(system, /you said: First sentence lands here\./);
  assert.doesNotMatch(system, /should not appear/);
});

test("before anything is dealt the recap says so rather than inventing state", async () => {
  const pack = await realPack();
  const client = fakeClient({ opening: declines });
  const reading = startReading({ pack, client, seed: SEED });
  await reading.begin();
  // Read off the assembly rather than off a call: the opening is scripted now,
  // so the only turn that runs with nothing dealt is the reply to an opening
  // answer that dropped the frame. The state it describes is the same one.
  const system = promptFor(pack, reading.session, "respond");
  assert.match(system, /anchor: not committed yet/);
  // The whole spread is on the table from the first turn, and every one of them
  // is face down: the reader is shown the topology and none of the cards.
  assert.match(system, /cards on the table:\n  1\. situation — FACE DOWN/);
  assert.match(system, /4\. epilogue — FACE DOWN \(the fourth card, if this reading earns it\)/);
  assert.match(system, /4 still face down/);
  assert.match(system, /arc position: nothing dealt yet/);
});

test("the arc position's weighted moves reach the prompt from pack data", async () => {
  const { client } = await run({
    gates: [gate(4), gate(3)], answers: ["something real", "and more"],
  });
  assert.match(systemFor(client, "invite"),
               /moves weighted here: elaborate, own, externalize, their-words/);
  assert.match(client.calls.chat.at(-1).prompt, /moves weighted here: exception, externalize/);
});

test("the question policy is present and marked as never-to-be-named", async () => {
  const { client } = await run({ gates: [gate(3)], answers: ["hm"] });
  const system = systemFor(client, "invite");
  assert.match(system, /## Choosing the question/);
  assert.match(system, /Never say any of these words to them/);
  assert.match(system, /If they can name the move, the move has failed/);
  assert.match(system, /A menu, not a protocol/);
});

test("the plain-words rule reaches the reader, since it outranks the voice above it", async () => {
  const { client } = await run({ gates: [gate(3)], answers: ["hm"] });
  // Collapsed, like the other golden assertions: "a second read" falls across a
  // line break in the source, and a rewrap is not a lost rule.
  const system = systemFor(client, "invite").replace(/\s+/g, " ");
  assert.match(system, /## Plain words/);
  assert.match(system, /second read/);
});

test("the crossing is signposted, so the shift from the picture is said rather than implied", async () => {
  const { client } = await run({ gates: [gate(3)], answers: ["hm"] });
  const system = systemFor(client, "invite");
  assert.match(system, /Put yourself in the picture/,
               "the own move teaches the signpost, not just the question after it");
});

test("every move the pack weights is a move the persona defines", async () => {
  // The staircase refactor left "explore" weighted on the obstacle position
  // with nothing defining it any more, and the prompt cheerfully told the
  // reader to weight a move it had never heard of.
  const { client, pack } = await run({ gates: [gate(3)], answers: ["hm"] });
  const system = systemFor(client, "invite");
  const weighted = [...pack.positions, ...(pack.epilogue ? [pack.epilogue] : [])];
  for (const move of new Set(weighted.flatMap((p) => p.moves))) {
    assert.ok(system.includes(`**${move}**`), `pack weights ${move}, persona does not define it`);
  }
});

test("the staircase reaches the prompt, as a ceiling rather than a schedule", async () => {
  const { client, pack } = await run({ gates: [gate(3)], answers: ["hm"] });
  const system = systemFor(client, "invite");
  const flat = system.replace(/\s+/g, " ");
  for (const level of pack.levels) {
    assert.ok(system.includes(`**${level.id}**`), `the persona does not name ${level.id}`);
  }
  assert.match(system, /stands exactly one step above where they are standing/);
  assert.match(system, /ceiling on distance, never a quota/);
  assert.match(flat, /You follow them up the staircase\. You never march them up it\./);
  assert.match(system, /when they drop .* you drop with them/);
});

/** A shot is one exchange, or a run of them for the ones that need turns. */
const readerTurnsOf = (shot) => (shot.turns ?? [shot]).map((t) => t.reader);

test("few-shots reach the prompt as exchanges, without their maintainer labels", async () => {
  const { client, pack } = await run({ gates: [gate(3)], answers: ["hm"] });
  const system = systemFor(client, "invite");
  assert.match(system, /## How this sounds/);
  assert.ok(pack.fewShots.length >= 3 && pack.fewShots.length <= 9);
  for (const shot of pack.fewShots) {
    for (const turn of readerTurnsOf(shot)) {
      assert.ok(system.includes(turn), `few-shot missing: ${shot.demonstrates}`);
    }
    assert.ok(!system.includes(shot.demonstrates), "the technique label must not reach the model");
  }
});

test("every few-shot obeys the turn shape: one observation, one question, and short", async () => {
  const pack = await realPack();
  for (const shot of pack.fewShots) {
    for (const reader of readerTurnsOf(shot)) {
      const questions = (reader.match(/\?/g) ?? []).length;
      const sentences = reader.split(/(?<=[.?!])\s+/).filter(Boolean);
      const isClosing = shot.position === "advice" && questions === 0;
      assert.ok(questions <= 1, `${shot.demonstrates}: ${questions} questions`);
      assert.ok(sentences.length <= 3, `${shot.demonstrates}: ${sentences.length} sentences`);
      if (!isClosing) {
        assert.match(reader.trim(), /\?$/, `${shot.demonstrates}: does not end on its question`);
      }
    }
  }
});

// -- unconditional closing (checkpoint fix 1) -----------------------------
//
// Run B of the 2026-08-25 checkpoint ended unclosed. The chain: its advice
// deal-turn asked a life question, the user answered by describing the card,
// the judge scored that a 1 -- correctly, for the question it was asked -- and
// a depth-1 answer bought another follow-up on a card that had nowhere left to
// go. The reading simply stopped. Whatever else is wrong upstream, the last
// card must be able to close on its own.

test("the last card spends its budget and then closes, whatever the depth", async () => {
  const { reading, client } = await run({
    gates: [gate(4), gate(4),
            cardOnly(2), cardOnly(2), cardOnly(2), cardOnly(2), cardOnly(1),
            cardOnly(2), cardOnly(1), cardOnly(1),
            cardOnly(1), cardOnly(1)],
    answers: ["it looks tired", "since March",
              "a road", "uphill", "nobody on it", "and a wall", "dunno",
              "walking off, leaving the full ones", "no idea", "not really",
              "a garden", "nothing much"],
  });
  const s = reading.session;
  assert.equal(s.closed, true, "run B stopped here instead");
  assert.equal(s.closing_reflection, "[close]");
  assert.equal(s.exchanges.filter((e) => e.position === "advice").length, 3,
               "the advice position's target, and not one exchange more");
  assert.match(s.cards.at(-1).flip_reason ?? "", /situation|obstacle|advice|exchanges|earned/);
  const turns = client.calls.chat.map((c) => c.turn);
  assert.ok(turns.includes("close"), "the reading ends on the closing beat");
  assert.equal(turns.filter((t) => t === "close").length, 1);
});

test("a reading of nothing but thin answers still closes", async () => {
  // The invariant, stated as a number so that a change to the pacing shows up
  // here rather than in a stalled session. This is the worst case in the whole
  // design -- somebody who gives nothing, on every card -- and it is what the
  // per-position caps cost: each card runs to its own max, and the last one
  // closes on its target instead.
  const { reading } = await run({
    gates: Array.from({ length: 16 }, () => gate(1)),
    answers: Array.from({ length: 16 }, (_, i) => `thin ${i}`),
  });
  assert.equal(reading.session.closed, true);
  const onCards = reading.session.exchanges.filter(
    (e) => !["opening", "afterward", "afterglow"].includes(e.position));
  assert.equal(onCards.length, 12, "4 + 5 + 3: each card to its cap, and the last to its target");
  assert.equal(reading.session.cards.length, 3,
               "and the fourth card never turned: nothing of theirs ever landed");
});

// -- flip ownership (checkpoint fix 3) ------------------------------------

test("every flip records why it happened", async () => {
  const { reading } = await run({
    gates: [gate(4), gate(4), gate(2), gate(2), gate(2), gate(2), gate(2), gate(2), gate(2), gate(2)],
    answers: ["my brother, since March", "we stopped talking",
              "money", "dunno", "lighter maybe", "hard to say", "the same",
              "a road", "uphill", "nobody on it"],
  });
  const reasons = reading.session.cards.map((c) => c.flip_reason);
  assert.ok(reasons.every(Boolean), "a card with no recorded reason turned over by nobody");
  assert.match(reasons[0], /opening question was answered/, "the first card is dealt, not earned");
  assert.match(reasons[1], /rich depth 4 after 2 exchanges/);
  assert.match(reasons[2], /5 exchanges on one card/, "the obstacle position's cap");
  if (reasons[3]) assert.match(reasons[3], /earned before the close/);
});

test("a gate carrying an old flip_ready flag cannot move the decision", async () => {
  // The judge used to get a vote and stopped: a stale field on the object must
  // not quietly become an owner again.
  const { reading } = await run({
    gates: [{ ...gate(1), flip_ready: true }, { ...gate(1), flip_ready: true }],
    answers: ["dunno", "still dunno"],
  });
  assert.equal(reading.session.cards.length, 1, "depth 1 twice does not earn a card");
});

// -- question_type (checkpoint fix 4) -------------------------------------

test("each exchange records which kind of question it answered", async () => {
  const { reading } = await run({
    gates: [gate(4), gate(4), gate(2), gate(2)],
    answers: ["my brother, since March", "we stopped talking", "money", "dunno"],
    // The reader's turns are canned, so script the two kinds explicitly.
    reply: (turn) => (turn === "respond"
      ? "So that is where it started. What happened next?"
      : "The card turns over. What does it look like it is pointing at for you?"),
  });
  const kinds = reading.session.exchanges.map((e) => e.question_type);
  // invite, then the dwell follow-up, then the bridge that deals the next card,
  // then its own follow-up. The dwell turn is why two life questions no longer
  // sit next to each other.
  assert.deepEqual(kinds, [undefined, "projection", "life", "projection", "life"],
                   "the opening exchange has no card and no kind");
});

test("the judge is told which scale to use before it is shown the question", async () => {
  const { client } = await run({
    gates: [gate(2)], answers: ["dunno"],
    reply: () => "What does it look like it is pointing at for you?",
  });
  const judged = client.calls.judge.find((c) => c.kind === "gate");
  const content = judged.messages[0].content;
  assert.match(content, /Kind of question: PROJECTION/);
  assert.ok(content.indexOf("Kind of question") < content.indexOf("The reader asked"),
            "the rubric is selected before the question is read");
});

test("card meaning is reveal-on-request, not seasoning", async () => {
  const { client } = await run({ gates: [gate(3)], answers: ["hm"] });
  const system = systemFor(client, "invite");
  const flat = system.replace(/\s+/g, " ");
  assert.match(flat, /If they ask, tell them/);
  assert.match(flat, /volunteering it is not one of them/);
  assert.match(flat, /Traditional sense, which you do not volunteer/);
  // The allowance this replaces. It read as permission and was taken as one.
  assert.ok(!/one sentence of traditional sense/i.test(system),
            "the seasoning allowance is still in the prompt somewhere");
  assert.ok(!/At most one sentence of traditional sense/i.test(
    client.calls.chat.map((c) => c.prompt).join("\n")));
});

test("a session with no topic is told the first card has a job", async () => {
  const { client } = await run({ gates: [gate(2)], answers: ["a woman in a garden"] });
  const system = systemFor(client, "invite").replace(/\s+/g, " ");
  assert.match(system, /This card's job is to find the ground/);
  assert.match(system, /Never talk as though the session has a subject when it does not/);
});

test("a session with a topic is not told to go looking for one", async () => {
  const { client } = await run({
    gates: [gate(2)], answers: ["a woman in a garden"], opening: wants("my brother"),
  });
  const system = systemFor(client, "invite").replace(/\s+/g, " ");
  assert.ok(!/This card's job is to find the ground/.test(system));
  assert.match(system, /What they said they wanted to look at/);
});

test("a beat that reads as a verdict is asked for again, once", async () => {
  // river-89c1fb's beat, verbatim: it decided the finding off one sentence.
  const verdict = {
    theme: "a different trade",
    resolution_beat: "that the change isn't a break, it's a repurposing, and something "
      + "from the before is still alive in it",
    user_phrases: [{ phrase: "a different trade", source: "life" }],
  };
  const pack = await realPack();
  let asked = 0;
  const client = fakeClient({ gates: [gate(4), gate(4)], opening: declines });
  const judge = client.judge;
  client.judge = async (call) => {
    if (call.kind !== "anchor") return judge(call);
    asked += 1;
    return asked === 1 ? verdict
      : { ...verdict, resolution_beat: "where the old trade stands in the new one — still feeding it, or genuinely left behind" };
  };
  const reading = startReading({ pack, client, seed: SEED });
  await reading.begin();
  await reading.say("nothing in particular");
  await reading.say("a different trade");
  await reading.say("since the move");

  assert.equal(asked, 2, "asked once, told why, asked again");
  assert.match(reading.session.anchor.resolution_beat, /still feeding it, or genuinely left behind/);
});
