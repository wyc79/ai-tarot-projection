import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createSession, flipCard, flipDecision, recordExchange,
} from "../../web/js/engine/state.js";
import { startReading } from "../../web/js/engine/reading.js";
import { scanSession } from "../../scripts/scan.mjs";
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
  await reading.say("i guess so?i used to have a different trade");

  const system = client.calls.chat.at(-1).prompt.replace(/\s+/g, " ");
  assert.match(system, /THEY HEDGED THAT/);
  assert.match(system, /Do not repeat it back as settled fact/);
  assert.match(system, /Make walking it back easy/);
});

test("the tempo rule reaches every turn, and one few-shot shows it", async () => {
  const { readerSystem, readerTurnBlock } = await import("../../web/js/engine/prompts.js");
  const pack = await realPack();
  const base = {
    positions: ["situation", "obstacle", "advice"], exchanges: [], anchor: null,
    safety_state: "normal", last_stakes: "low", phase: "reading", topic: null,
    cards: [{ card_id: "cups-06-six", position: "situation", user_projection: "", ai_reading: "" }],
  };
  for (const turn of ["invite", "respond", "bridge", "close"]) {
    const system = `${readerSystem({ pack, session: base })}\n${readerTurnBlock({ pack, session: base, turn })}`.replace(/\s+/g, " ");
    assert.match(system, /Eagerness is not readiness/, `the ${turn} turn lost the tempo rule`);
    assert.match(system, /one more question inside it\*\*, not a scene change/);
  }
  const shot = pack.fewShots.find((f) => f.demonstrates.startsWith("the dwell"));
  assert.ok(shot, "nothing in the pack demonstrates staying put");
  assert.equal(shot.hedged, true, "and it demonstrates the softening at the same time");
});

// -- (b) the eager discloser ---------------------------------------------

/**
 * Drive a session with real reader turns rather than placeholders, so the
 * scanner has something to read. Mirrors the helper in scaffolding.test.mjs.
 */
async function play({ script, close = "This week, notice the one moment you nearly said it." }) {
  const pack = await realPack();
  let asked = 0;
  const client = fakeClient({
    gates: script.map((s) => s.gate),
    opening: { has_topic: false, topic: "", stakes: "low" },
    reply: (turn) => (turn === "close" ? close
      : turn === "opening" ? "Anything particular you want to look at?"
      : script[Math.min(asked++, script.length - 1)].asks),
  });
  const reading = startReading({ pack, client, seed: "river-89c1fb" });
  await reading.begin();
  await reading.say("just curious");
  for (const { answer } of script) {
    if (reading.session.closed) break;
    await reading.say(answer);
  }
  return { pack, session: reading.session, client };
}

test("someone who discloses early and hedges it gets dwelt on, not moved past", async () => {
  const { pack, session } = await play({
    script: [
      { asks: "What does it look like it's pointing at for you?",
        answer: "the cups are all full of flowers", gate: at({ depth: 2, life: false }) },
      { asks: "Whose repurposing is that, in your world?",
        answer: "i guess so? i used to have a different trade",
        gate: at({ depth: 3, life: true, level: "consequences", hedged: true }) },
      { asks: "Could be nothing — how long ago did you switch?",
        answer: "eighteen months, and nobody's asked me about it since",
        gate: at({ depth: 4, life: true, level: "consequences" }) },
      { asks: "The obstacle card is The Lovers. What do you see in it?",
        answer: "two people not looking at each other", gate: at({ depth: 2, life: false }) },
    ],
  });
  const situation = session.exchanges.filter((e) => e.position === "situation");
  assert.equal(situation.length, 3, "the hedge bought a turn and the answer to it bought another");
  const lovers = session.cards[1];
  assert.ok(lovers, "and the card did eventually turn");
  assert.match(lovers.flip_reason, /dwelt on first/);
  assert.ok(!scanSession(session, pack).some((f) => f.code === "flip_on_disclosure"));
  assert.ok(!scanSession(session, pack).some((f) => f.code === "built_on_hedge"),
            "the follow-up softened rather than settling it");
});

// -- (c) the regretful sharer --------------------------------------------

test("someone who wishes they had not said it is let out, and the reading still closes", async () => {
  const { pack, session, client } = await play({
    script: [
      { asks: "What does it look like it's pointing at for you?",
        answer: "kids handing each other flowers", gate: at({ depth: 2, life: false }) },
      { asks: "Whose handing-over is that one?",
        answer: "my sister, in April", gate: at({ depth: 4, life: true, level: "consequences" }) },
      // Immediate regret. The dwell releases rather than holding them there.
      { asks: "What happened in April?", answer: "dunno, it's fine",
        gate: at({ depth: 1, life: false }) },
      { asks: "The obstacle card is The Lovers. What do you see?",
        answer: "two people", gate: at({ depth: 2, life: false }) },
      { asks: "Does one of them look like they're leaving, or arriving?",
        answer: "leaving I think", gate: at({ depth: 2, life: false }) },
      { asks: "What else is in there?", answer: "a tree", gate: at({ depth: 1, life: false }) },
      { asks: "The advice card is The Fool. What's he doing?",
        answer: "walking", gate: at({ depth: 2, life: false }) },
      { asks: "Where does it look like he's going?", answer: "off the edge",
        gate: at({ depth: 2, life: false }) },
    ],
  });
  const situation = session.exchanges.filter((e) => e.position === "situation");
  assert.equal(situation.length, 3, "the deflection released the dwell rather than extending it");
  assert.match(session.cards[1].flip_reason, /moving on rather than stalling/);
  assert.ok(!/dwelt on first/.test(session.cards[1].flip_reason),
            "nobody gets credit for a dwell that was refused");
  assert.equal(session.closed, true, "unconditional closing is untouched by any of this");
  assert.equal(client.calls.chat.at(-1).turn, "close");
  assert.ok(!scanSession(session, pack).some((f) => f.code === "unclosed"));
});

test("the frozen river session fails the tempo check it was written for", async () => {
  const pack = await realPack();
  const session = await river();
  const codes = scanSession(session, pack).map((f) => f.code);
  assert.ok(codes.includes("flip_on_disclosure"),
            "the card turned over on the turn they first said something of their own");

  // The hedge flag postdates the transcript, so the judge's reading of "i guess
  // so?" has to be supplied. With it, the trailing turn fails too.
  session.exchanges[2].gate.hedged = true;
  assert.ok(scanSession(session, pack).some((f) => f.code === "built_on_hedge"),
            '"You weren\'t sure at first, but repurposed turned out to be you"');
});

test("river's resolution beat is the shape the anchor judge now rejects", async () => {
  const { beatIsTerritory } = await import("../../web/js/engine/anchor.js");
  const session = await river();
  assert.equal(beatIsTerritory(session.anchor.resolution_beat), false,
               "it decided the finding from one sentence they said once");
  assert.equal(beatIsTerritory(
    "where the old trade stands in the new one — still feeding it, or genuinely left behind"),
               true);
});

// -- the revision is not on the critical path ----------------------------

test("the reader turn starts before the anchor revision comes back", async () => {
  // Deterministic rather than timed: the revision is held open until the chat
  // call it runs alongside has actually started. If the turn awaited the
  // revision first the two would deadlock, and the race below reports that as
  // a failure rather than hanging the suite.
  const pack = await realPack();
  let armed = false;
  let chatStarted;
  const chatHasStarted = new Promise((resolve) => { chatStarted = resolve; });
  let releaseRevision;
  const revisionHeld = new Promise((resolve) => { releaseRevision = resolve; });

  let anchorCalls = 0;
  const client = {
    async chat({ onDelta = () => {} }) {
      if (armed) chatStarted();
      const t = "What happened after that?";
      onDelta(t, t);
      return t;
    },
    async judge({ schema }) {
      if (schema.properties.has_topic) return { has_topic: false, topic: "", stakes: "low" };
      if (schema.properties.theme) {
        anchorCalls += 1;
        // Only the revision is held. The first commit still blocks, on purpose:
        // the bridge turn names the next card and wants the plan in hand.
        if (anchorCalls > 1) await revisionHeld;
        return { theme: "t", resolution_beat: "whether it holds, or has outlived itself",
                 user_phrases: [{ phrase: `p${anchorCalls}`, source: "life" }] };
      }
      return at({ depth: 4, life: true, level: "consequences" });
    },
  };

  const reading = startReading({ pack, client, seed: "river-89c1fb" });
  await reading.begin();
  await reading.say("just curious");
  await reading.say("a different trade");          // dwell holds the card
  await reading.say("eighteen months ago");        // flips it, commits the anchor
  assert.equal(anchorCalls, 1, "committed, blocking, on the flip");

  armed = true;
  const turn = reading.say("nobody's asked me about it since");   // revises it

  const raced = await Promise.race([
    chatHasStarted.then(() => "chat started"),
    new Promise((r) => { setTimeout(() => r("deadlocked on the revision"), 500); }),
  ]);
  assert.equal(raced, "chat started");
  releaseRevision();
  await turn;
  assert.equal(anchorCalls, 2, "and revised once");
  assert.equal(reading.session.anchor.user_phrases.at(-1).phrase, "p2",
               "the revision still lands before the turn resolves");
});

test("a revision that fails leaves the reading with the plan it had", async () => {
  const pack = await realPack();
  let asked = 0;
  const events = [];
  const client = {
    async chat({ onDelta = () => {} }) { const t = "and then?"; onDelta(t, t); return t; },
    async judge({ schema }) {
      if (schema.properties.has_topic) return { has_topic: false, topic: "", stakes: "low" };
      if (schema.properties.theme) {
        asked += 1;
        if (asked > 1) throw new Error("provider_unavailable");
        return { theme: "the first plan", resolution_beat: "whether it holds, or has outlived itself",
                 user_phrases: [{ phrase: "first", source: "life" }] };
      }
      return at({ depth: 4, life: true, level: "consequences" });
    },
  };
  const reading = startReading({ pack, client, seed: "river-89c1fb", onEvent: (e) => events.push(e) });
  await reading.begin();
  await reading.say("just curious");
  await reading.say("a different trade");
  await reading.say("eighteen months ago");
  await reading.say("nobody's asked me about it since");

  assert.equal(reading.session.anchor.theme, "the first plan", "not wiped by a failed revision");
  assert.ok(events.some((e) => e.type === "anchor_failed"), "and not swallowed either");
});
