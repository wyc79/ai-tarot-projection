/**
 * The deck is theirs.
 *
 * They lay four cards face down on their own table and the app deals nothing.
 * Every rule about pacing, flipping and endings is the dealt mode's, unchanged;
 * the only difference is that a card's identity arrives when a person turns it
 * over and says what it is.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { startReading } from "../../web/js/engine/reading.js";
import { makeStorage, memoryBackend } from "../../web/js/storage.js";
import { loadHistory, toMarkdown } from "../../web/js/engine/journal.js";
import { STATE_VERSION, namedCards, nameCard, tableau } from "../../web/js/engine/state.js";
import { cardOnly, declines, fakeClient, gate, realPack } from "./helpers.mjs";

/** What a person turning cards over does, scripted: name them in this order. */
function namesInOrder(order) {
  const asked = [];
  return {
    asked,
    identifyCard: async ({ position, taken }) => {
      asked.push({ position, taken: [...taken] });
      return order[asked.length - 1];
    },
  };
}

const DEEP = Array.from({ length: 14 }, (_, i) => gate(i === 0 ? 3 : 4));
const SHALLOW = Array.from({ length: 24 }, () => cardOnly(2));

async function physical({ gates = DEEP, order, answers, storage = null }) {
  const pack = await realPack();
  const hands = namesInOrder(order);
  const events = [];
  const reading = startReading({
    pack, storage, cardSource: "physical", identifyCard: hands.identifyCard,
    client: fakeClient({ gates, opening: declines,
                         reply: (turn) => (turn === "close" ? "notice the bracing" : `[${turn}]`) }),
    onEvent: (e) => events.push(e),
  });
  await reading.begin();
  await reading.say("nothing in particular");
  for (const answer of answers) {
    if (reading.session.ended) break;
    await reading.say(answer);
  }
  return { pack, session: reading.session, asked: hands.asked, events };
}

const DEEP_ANSWERS = ["it looks tired", "nobody is attacking me", "money", "not the money",
                      "the flat", "if I spend it I'm staying", "I'd have to say it out loud",
                      "to my brother", "a hand held out", "nobody taking it",
                      "what happens after noticing", "fair enough"];
const SHALLOW_ANSWERS = Array.from({ length: 22 }, (_, i) => `just a picture (${i})`);

test("a physical session deals nothing and seeds nothing", async () => {
  const { session } = await physical({
    order: ["cups-06-six", "wands-05-five", "major-00-fool", "pentacles-09-nine"],
    answers: DEEP_ANSWERS,
  });
  assert.equal(session.card_source, "physical");
  assert.equal(session.seed, null, "nothing here was seeded, so there is no seed to print");
  assert.equal(session.schema_version, STATE_VERSION);
  assert.match(session.session_id, /^own-deck-\d+$/);
});

test("the whole spread is on the table from the start, with nothing on it yet", async () => {
  const pack = await realPack();
  const reading = startReading({
    pack, cardSource: "physical", identifyCard: async () => "cups-06-six",
    client: fakeClient({ opening: declines }),
  });
  const slots = tableau(reading.session);
  assert.equal(slots.length, pack.positions.length + 1, "three positions and the epilogue");
  assert.deepEqual(slots.map((s) => s.face_up), [false, false, false, false]);
  assert.deepEqual(slots.map((s) => s.card_id), [null, null, null, null],
                   "the app knows the shape of their table and nothing on it");
  assert.equal(namedCards(reading.session).length, 0);
});

test("a card is asked for once, when its position turns, and not before", async () => {
  const { asked, session } = await physical({
    order: ["cups-06-six", "wands-05-five", "major-00-fool", "pentacles-09-nine"],
    answers: DEEP_ANSWERS,
  });
  assert.deepEqual(asked.map((a) => a.position),
                   ["situation", "obstacle", "advice", "epilogue"],
                   "asked in reveal order, one ask per flip");
  assert.deepEqual(session.cards.map((c) => c.card_id),
                   ["cups-06-six", "wands-05-five", "major-00-fool", "pentacles-09-nine"]);
});

test("the picker is told what is already on the table", async () => {
  const { asked } = await physical({
    order: ["cups-06-six", "wands-05-five", "major-00-fool", "pentacles-09-nine"],
    answers: DEEP_ANSWERS,
  });
  assert.deepEqual(asked.map((a) => a.taken), [
    [],
    ["cups-06-six"],
    ["cups-06-six", "wands-05-five"],
    ["cups-06-six", "wands-05-five", "major-00-fool"],
  ]);
});

test("a deck has 78 cards and each of them once, and the engine is the one keeping count", async () => {
  await assert.rejects(
    physical({ order: ["cups-06-six", "cups-06-six"], answers: DEEP_ANSWERS }),
    /already on the table/,
    "a card named twice is a mistake the engine catches, not only the picker");
});

test("an unearned fourth card is never asked about, so the app never learns it", async () => {
  const { session, asked, pack } = await physical({
    gates: SHALLOW, order: ["cups-06-six", "wands-05-five", "major-00-fool"],
    answers: SHALLOW_ANSWERS,
  });
  assert.ok(session.closed && session.ended, "the reading still ends properly");
  assert.deepEqual(asked.map((a) => a.position), ["situation", "obstacle", "advice"],
                   "nobody was asked to turn the fourth one over");

  const epilogue = session.deal.find((d) => d.position === "epilogue");
  assert.equal(epilogue.card_id, null, "it is still face down on their table, and unnamed here");
  assert.equal(namedCards(session).length, 3);

  // And nothing anywhere names it, because there is nothing to name.
  const md = toMarkdown(pack, session);
  assert.doesNotMatch(md, /Epilogue —/);
  assert.match(md, /One card stayed with the deck/);
});

test("the fourth card is earnable off a physical deck at all", async () => {
  const { session } = await physical({
    order: ["cups-06-six", "wands-05-five", "major-00-fool", "pentacles-09-nine"],
    answers: DEEP_ANSWERS,
  });
  assert.equal(session.cards.length, 4, "the epilogue check must not read card_id to decide");
  assert.equal(session.cards.at(-1).position, "epilogue");
});

test("the journal says whose deck it was instead of printing a seed", async () => {
  const { pack, session } = await physical({
    order: ["cups-06-six", "wands-05-five", "major-00-fool", "pentacles-09-nine"],
    answers: DEEP_ANSWERS,
  });
  const md = toMarkdown(pack, session);
  assert.match(md, /· your own deck/);
  assert.doesNotMatch(md, /seed/, "there is no seed, and offering one invites re-running it");
  assert.match(md, /## Situation — Six of Cups/, "the cards they named are the record");
});

test("a named card is saved the moment it is named, not at the end of the turn", async () => {
  const storage = makeStorage(memoryBackend());
  const pack = await realPack();
  let savedWhenAsked = null;
  const reading = startReading({
    pack, storage, cardSource: "physical",
    identifyCard: async ({ position }) => {
      // What the previous ask persisted, read back from storage mid-turn.
      savedWhenAsked = loadHistory(storage)[0]?.deal.map((d) => d.card_id) ?? null;
      return position === "situation" ? "cups-06-six" : "wands-05-five";
    },
    client: fakeClient({ gates: DEEP, opening: declines }),
  });
  await reading.begin();
  await reading.say("nothing in particular");
  await reading.say("it looks tired");
  await reading.say("nobody is attacking me");
  assert.deepEqual(savedWhenAsked?.slice(0, 1), ["cups-06-six"],
                   "the first card was in storage before the second was asked for");
});

test("physical mode without a way to ask is refused, not silently dealt", async () => {
  const pack = await realPack();
  assert.throws(
    () => startReading({ pack, client: fakeClient({}), cardSource: "physical" }),
    /needs identifyCard/);
});

test("nameCard refuses a slot that is already named, and one that does not exist", async () => {
  const pack = await realPack();
  const reading = startReading({
    pack, cardSource: "physical", identifyCard: async () => "cups-06-six",
    client: fakeClient({ opening: declines }),
  });
  nameCard(reading.session, "situation", "cups-06-six");
  assert.throws(() => nameCard(reading.session, "situation", "wands-05-five"), /already/);
  assert.throws(() => nameCard(reading.session, "nowhere", "wands-05-five"), /no slot/);
});
