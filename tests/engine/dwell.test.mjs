import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createSession, flipCard, flipDecision, recordExchange,
} from "../../web/js/engine/state.js";
import { startReading } from "../../web/js/engine/reading.js";
import { fakeClient, realPack } from "./helpers.mjs";

const POSITIONS = [{ id: "situation" }, { id: "obstacle" }, { id: "advice" }];
const fresh = () => createSession({ packId: "p", seed: "river-89c1fb", positions: POSITIONS });

/** A gate carrying every axis the rules read. */
const at = ({ depth = 2, life = false, level = "name", hedged = false } = {}) =>
  ({ disclosure_depth: depth, has_life_content: life, user_level: level, hedged,
     stakes: "low", reading_of_them: "noted" });

const say = (session, gate) =>
  recordExchange(session, { question: "and?", answer: "an answer", gate });

const river = async () =>
  JSON.parse(await readFile(new URL("../fixtures/river-89c1fb.json", import.meta.url), "utf8")).session;

// -- the rule -------------------------------------------------------------

test("a fresh life disclosure blocks the flip on the turn it arrives", () => {
  const s = fresh();
  flipCard(s, "cups-06-six");
  say(s, at({ depth: 2, life: false }));                              // card description
  const disclosure = at({ depth: 3, life: true, level: "consequences" });
  say(s, disclosure);                                                 // river's turn 3
  const decision = flipDecision(s, disclosure);
  assert.equal(decision.flip, false, "river-89c1fb flipped here, on 'depth 3 after 2 exchanges'");
  assert.match(decision.reason, /just told you something of their own/);
});

test("one exchange spent inside it, and the card is eligible again", () => {
  const s = fresh();
  flipCard(s, "cups-06-six");
  say(s, at({ depth: 2, life: false }));
  say(s, at({ depth: 3, life: true, level: "consequences" }));
  const dwelt = at({ depth: 3, life: true, level: "consequences" });
  say(s, dwelt);
  const decision = flipDecision(s, dwelt);
  assert.equal(decision.flip, true);
  assert.match(decision.reason, /dwelt/, "and the reason says the card was dwelt on");
});

test("a deflection releases the dwell rather than trapping them in it", () => {
  const s = fresh();
  flipCard(s, "cups-06-six");
  say(s, at({ depth: 2, life: false }));
  say(s, at({ depth: 4, life: true, level: "consequences" }));
  // They wish they had not said it. That is allowed, and it ends the dwell.
  const backOut = at({ depth: 1, life: false });
  say(s, backOut);
  const decision = flipDecision(s, backOut);
  assert.equal(decision.flip, true, "nobody is held in a subject they backed out of");
  assert.ok(!/dwelt/.test(decision.reason));
});

test("the dwell never outlasts the hard cap", () => {
  const s = fresh();
  flipCard(s, "cups-06-six");
  say(s, at({ depth: 2, life: false }));
  say(s, at({ depth: 2, life: false }));
  const late = at({ depth: 4, life: true, level: "consequences" });
  say(s, late);
  const decision = flipDecision(s, late);
  assert.equal(decision.flip, true, "three exchanges is three exchanges");
  assert.match(decision.reason, /moving on rather than stalling/);
  // The cap and the dwell want opposite things here and the cap wins. Worth
  // its own reason: they opened up just as the card ran out of room.
  assert.match(decision.reason, /cutting a fresh disclosure short/);
});

// -- the fixture ----------------------------------------------------------

test("replayed, river-89c1fb dwells before The Lovers turns", async () => {
  const pack = await realPack();
  const session = await river();
  const reading = startReading({
    pack, seed: session.seed,
    client: fakeClient({
      opening: { has_topic: false, topic: "", stakes: "low" },
      gates: session.exchanges.filter((e) => e.position !== "opening").map((e) => e.gate),
    }),
  });
  await reading.begin();
  await reading.say("just curious");
  for (const exchange of session.exchanges.filter((e) => e.position !== "opening")) {
    await reading.say(exchange.a);
  }
  assert.equal(reading.session.cards.length, 1,
               "the second card turned over on the disclosure turn; now it waits");
  assert.equal(reading.session.exchanges.filter((e) => e.position === "situation").length, 2);
});

// -- the hedge ------------------------------------------------------------

test("a hedged answer does not buy progress toward the early exits", () => {
  const s = fresh();
  flipCard(s, "cups-06-six");
  say(s, at({ depth: 2, life: false }));
  // river's turn 3, as the judge should now read it: a real disclosure, held at
  // arm's length. Depth 3, life content, hedged.
  const hedged = at({ depth: 3, life: true, level: "consequences", hedged: true });
  say(s, hedged);
  assert.equal(flipDecision(s, hedged).flip, false);

  // And it does not satisfy the dwell either: the follow-up has to land.
  const stillHedged = at({ depth: 3, life: true, level: "consequences", hedged: true });
  say(s, stillHedged);
  const decision = flipDecision(s, stillHedged);
  assert.equal(decision.flip, true, "but the hard cap still counts it, so nothing stalls");
  assert.match(decision.reason, /moving on rather than stalling/);
});

test("an unhedged follow-up to a hedged disclosure does satisfy the dwell", () => {
  const s = fresh();
  flipCard(s, "cups-06-six");
  say(s, at({ depth: 3, life: true, level: "consequences", hedged: true }));
  const settled = at({ depth: 4, life: true, level: "consequences" });
  say(s, settled);
  const decision = flipDecision(s, settled);
  assert.equal(decision.flip, true);
  assert.match(decision.reason, /dwelt on first/);
});

test("the reader is told not to build on something they hedged", async () => {
  const pack = await realPack();
  const client = fakeClient({
    opening: { has_topic: false, topic: "", stakes: "low" },
    gates: [at({ depth: 2, life: false }),
            at({ depth: 3, life: true, level: "consequences", hedged: true })],
  });
  const reading = startReading({ pack, client, seed: "river-89c1fb" });
  await reading.begin();
  await reading.say("just curious");
  await reading.say("each cup is filled with flowers, probably repurposed from something else");
  await reading.say("i guess so?i used to have a different major");

  const system = client.calls.chat.at(-1).system.replace(/\s+/g, " ");
  assert.match(system, /THEY HEDGED THAT/);
  assert.match(system, /Do not repeat it back as settled fact/);
  assert.match(system, /Make walking it back easy/);
});
