import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { startReading } from "../../web/js/engine/reading.js";
import { scanSession } from "../../scripts/scan.mjs";
import { fakeClient, realPack } from "./helpers.mjs";

const fixture = async () =>
  JSON.parse(await readFile(new URL("../fixtures/thread-c145c7.json", import.meta.url), "utf8")).session;

// -- (a) the c145c7 replay ------------------------------------------------

test("the frozen c145c7 session now fails the checks it used to pass", async () => {
  const pack = await realPack();
  const codes = scanSession(await fixture(), pack).map((f) => f.code);

  // Turn 3: "when did that judging first turn up for you?" -- one rung, which
  // the level check allows, while crossing from the card to their life.
  assert.ok(codes.includes("rail_switch_climb"), "turn 3");
  // The obstacle turn: "the ones holding the plans", "building what they want".
  assert.ok(codes.includes("unearned_card_vocabulary"), "the obstacle turn");
  assert.ok(codes.includes("unclosed"), "and it still never closed");
});

test("replayed through the engine, its first card flips ungrounded", async () => {
  const pack = await realPack();
  const session = await fixture();
  const answers = session.exchanges.filter((e) => e.position !== "opening").map((e) => e.a);
  const gates = session.exchanges
    .filter((e) => e.position !== "opening")
    // The recorded gates predate has_life_content. Every one of these answers
    // is a description of the picture, which is the whole point of the fixture.
    .map((e) => ({ ...e.gate, has_life_content: false, disclosure_depth: Math.min(e.gate.disclosure_depth, 2) }));

  const reading = startReading({
    pack, seed: session.seed,
    client: fakeClient({ gates, opening: { has_topic: false, topic: "", stakes: "low" } }),
  });
  await reading.begin();
  await reading.say("nothing, just show me something");
  for (const answer of answers) {
    if (reading.session.closed) break;
    await reading.say(answer);
  }

  const situation = reading.session.cards.find((c) => c.position === "situation");
  assert.ok(reading.session.cards.length > 1, "it still moves on; a resistant user is not stalled");
  assert.match(reading.session.cards[1].flip_reason, /ungrounded/,
               "the flip away from the first card records that nothing of theirs landed");
  assert.ok(!/depth 3 after/.test(reading.session.cards[1].flip_reason),
            "and it is no longer an early flip earned on card description");
  assert.equal(situation.flip_reason, "the opening question was answered; the reading begins");
});

// -- (b) a no-topic session that never grounds ---------------------------

/** Every answer is about the picture, the way c145c7's were. */
const cardOnly = (level = "name") =>
  ({ disclosure_depth: 2, user_level: level, has_life_content: false, stakes: "low",
     reading_of_them: "described the card" });

async function ungroundedSession() {
  const pack = await realPack();
  const client = fakeClient({
    gates: Array.from({ length: 12 }, () => cardOnly()),
    opening: { has_topic: false, topic: "", stakes: "low" },
    anchor: {
      theme: "judging between good and bad",
      user_phrases: [{ phrase: "the black and white pillar", source: "card" },
                     { phrase: "she is going to announce", source: "card" }],
      resolution_beat: "find out what any of this is actually about for them",
    },
    reply: (turn) => (turn === "close"
      ? "You have looked at three pictures and told me about all three. This week, notice the one moment you would rather look at something than say what you think."
      : "What does it look like it's pointing at for you?"),
  });
  const reading = startReading({ pack, client, seed: "thread-c145c7" });
  await reading.begin();
  await reading.say("nothing, just show me something");
  for (let i = 0; i < 12 && !reading.session.closed; i += 1) {
    await reading.say("the pillars behind her");
  }
  return { pack, reading, client };
}

test("a session that never finds the person still closes, and says it is ungrounded", async () => {
  const { pack, reading } = await ungroundedSession();
  const s = reading.session;
  assert.equal(s.topic, null);
  assert.equal(s.closed, true, "closing is unconditional at any depth of nothing");
  assert.equal(s.anchor.grounded, false, "and the anchor does not pretend otherwise");
  assert.ok(!scanSession(s, pack).some((f) => f.code === "unclosed"));
  // Every flip after the first should say so.
  for (const card of s.cards.slice(1)) {
    assert.match(card.flip_reason, /ungrounded/, `${card.position} flipped as though something landed`);
  }
});

test("an ungrounded reading is told not to talk as though it has a subject", async () => {
  const { client } = await ungroundedSession();
  const system = client.calls.chat.at(-1).prompt.replace(/\s+/g, " ");
  assert.match(system, /GROUNDED: no\. Every word above came from the picture/);
  assert.match(system, /the theme is a placeholder/);
  // The bridge is still what this card is for; the settle rule decides when.
  assert.match(system, /the ownership offer is\s+how you cross/);
  assert.match(system, /not\s+before this card has something under it to cross from/);
  assert.match(system, /Do not talk as though the session has a subject/);
});

test("and its closing step is sized to a session that never left the ground", async () => {
  const { client } = await ungroundedSession();
  const closing = client.calls.chat.findLast((c) => c.turn === "close").prompt.replace(/\s+/g, " ");
  assert.match(closing, /highest they have reached all session: name/);
  assert.match(closing, /something to notice, not something to carry out/);
  assert.match(closing, /This turn happens whatever height they reached/);
});
