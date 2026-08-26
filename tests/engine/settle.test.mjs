import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createSession, flipCard, recordExchange, settleOnCurrentCard,
} from "../../web/js/engine/state.js";
import { startReading } from "../../web/js/engine/reading.js";
import { ANTHROPIC } from "../../web/js/providers/anthropic.js";
import { PROVIDERS } from "../../web/js/providers/index.js";
import { scanSession } from "../../scripts/scan.mjs";
import { declines, fakeClient, realPack } from "./helpers.mjs";

const POSITIONS = [{ id: "situation" }, { id: "obstacle" }, { id: "advice" }];
const fresh = () => createSession({ packId: "p", seed: "lantern-be7743", positions: POSITIONS });

const at = ({ depth = 2, life = false, level = "name", hedged = false } = {}) =>
  ({ disclosure_depth: depth, has_life_content: life, user_level: level, hedged,
     stakes: "low", reading_of_them: "noted" });

const say = (session, gate) =>
  recordExchange(session, { question: "and?", answer: "an answer", gate });

const lantern = async () =>
  JSON.parse(await readFile(new URL("../fixtures/lantern-be7743.json", import.meta.url), "utf8")).session;

// -- the rule -------------------------------------------------------------

test("a card with one answer on it has nothing to bridge from", () => {
  const s = fresh();
  flipCard(s, "cups-01-ace");
  say(s, at({ depth: 2, life: false }));
  const settle = settleOnCurrentCard(s);
  assert.equal(settle.settled, false, "lantern-be7743 crossed here");
  assert.equal(settle.spent, 1);
  assert.equal(settle.selfReferent, false);
});

test("a second answer earns it, whatever is in the answer", () => {
  const s = fresh();
  flipCard(s, "cups-01-ace");
  say(s, at({ depth: 2, life: false }));
  say(s, at({ depth: 2, life: false }));
  assert.equal(settleOnCurrentCard(s).settled, true);
});

test("an answer that already had something of theirs in it earns it at once", () => {
  // Nothing left to settle: they crossed on their own, and asking them to
  // elaborate the picture now would walk it back.
  const s = fresh();
  flipCard(s, "cups-01-ace");
  say(s, at({ depth: 3, life: true, level: "consequences" }));
  const settle = settleOnCurrentCard(s);
  assert.equal(settle.settled, true);
  assert.equal(settle.selfReferent, true);
  assert.equal(settle.spent, 1);
});

test("it resets with each card; the previous card's footing is not this one's", () => {
  const s = fresh();
  flipCard(s, "cups-01-ace");
  say(s, at({ depth: 3, life: true, level: "consequences" }));
  say(s, at({ depth: 3, life: true, level: "consequences" }));
  flipCard(s, "major-06-lovers");
  assert.equal(settleOnCurrentCard(s).settled, false, "a new card is first contact again");
});

// -- what the reader is told ---------------------------------------------

async function afterOneAnswer(answer, gate) {
  const pack = await realPack();
  const client = fakeClient({ opening: declines, gates: [gate] });
  const reading = startReading({ pack, client, seed: "lantern-be7743" });
  await reading.begin();
  await reading.say("nothing");
  await reading.say(answer);
  return client.calls.chat.at(-1).prompt.replace(/\s+/g, " ");
}

test("after one card-only answer the reader is told to elaborate, not to bridge", async () => {
  const prompt = await afterOneAnswer(
    "something in the sky is offering rain to the pond, positively though",
    at({ depth: 2, life: false }));
  assert.match(prompt, /bridge to their life: NOT YET/);
  assert.match(prompt, /reads as an agenda/);
  assert.match(prompt, /Stay in the picture and elaborate/);
});

test("after one answer with something of theirs in it, the bridge is already earned", async () => {
  const prompt = await afterOneAnswer(
    "rain, and it reminds me of the week I moved",
    at({ depth: 3, life: true, level: "consequences" }));
  assert.match(prompt, /bridge to their life: earned — something of theirs is already on this card/);
});

test("the elaborate move and the settle rule are both in the persona", async () => {
  const pack = await realPack();
  assert.match(pack.persona, /\*\*elaborate\*\*/, "pack weights it; persona must define it");
  assert.match(pack.persona.replace(/\s+/g, " "),
               /never cross from first contact with a card/i);
  assert.match(pack.persona, /## When a bridge misses/);
  assert.match(pack.persona.replace(/\s+/g, " "), /it can just be a picture/);
});

test("elaborate is weighted ahead of own on the card whose job is to find the ground", async () => {
  const pack = await realPack();
  const situation = pack.positions.find((p) => p.id === "situation");
  assert.ok(situation.moves.indexOf("elaborate") < situation.moves.indexOf("own"));
});

// -- (a) the lantern replay ----------------------------------------------

test("the frozen lantern session fails the check it was written for", async () => {
  const pack = await realPack();
  const codes = scanSession(await lantern(), pack).map((f) => f.code);
  assert.ok(codes.includes("rail_switch_unsettled"), "turn 2's bridge");
  // It clears the height checks, which is the whole point: the crossing was
  // level, and level was never what was wrong with it.
  assert.ok(!codes.includes("level_jump"));
  assert.ok(!codes.includes("rail_switch_climb"));
});

test("replayed through the engine, lantern's second turn no longer offers to bridge", async () => {
  const pack = await realPack();
  const session = await lantern();
  const answers = session.exchanges.filter((e) => e.position !== "opening").map((e) => e.a);
  const client = fakeClient({
    opening: { has_topic: false, topic: "", stakes: "low" },
    gates: session.exchanges.filter((e) => e.position !== "opening").map((e) => e.gate),
  });
  const reading = startReading({ pack, client, seed: session.seed });
  await reading.begin();
  await reading.say("nothing");
  await reading.say(answers[0]);

  const prompt = client.calls.chat.at(-1).prompt.replace(/\s+/g, " ");
  assert.match(prompt, /bridge to their life: NOT YET/);
  // And the ungrounded block no longer contradicts it by ordering the bridge.
  assert.ok(!/The first follow-up on this card is an ownership offer/.test(prompt));
});

// -- (b) a no-topic session that elaborates before it crosses -------------

async function play({ script }) {
  const pack = await realPack();
  let asked = 0;
  const client = fakeClient({
    gates: script.map((s) => s.gate),
    opening: declines,
    reply: (turn) => (turn === "close" ? "This week, notice the one thing that turns up needing just enough."
      : turn === "opening" ? "Anything particular you want to look at?"
      : script[Math.min(asked++, script.length - 1)].asks),
  });
  const reading = startReading({ pack, client, seed: "lantern-be7743" });
  await reading.begin();
  await reading.say("nothing");
  for (const { answer } of script) {
    if (reading.session.closed) break;
    await reading.say(answer);
  }
  return { pack, session: reading.session, client };
}

test("the session lantern should have had: elaborate, then cross on what that got", async () => {
  const { pack, session } = await play({
    script: [
      { asks: "What does it look like it's pointing at for you?",
        answer: "something in the sky is offering rain to the pond, positively though",
        gate: at({ depth: 2, life: false }) },
      // The turn lantern spent on a bridge that missed.
      { asks: "What is it about the rain that reads as positive to you?",
        answer: "it's needed, and it's gentle. not a downpour, just enough",
        gate: at({ depth: 2, life: false }) },
      // Which is what this one is built out of: needed, gentle, just enough.
      { asks: "Whose needing just enough is that, in your world?",
        answer: "mine I suppose, since I stopped taking the extra shifts",
        gate: at({ depth: 3, life: true, level: "consequences" }) },
      { asks: "What happened after you stopped?",
        answer: "less money and I sleep now", gate: at({ depth: 3, life: true, level: "consequences" }) },

      { asks: "The obstacle card is The Lovers. What do you see in it?",
        answer: "two people not looking at each other", gate: at({ depth: 2, life: false }) },
      { asks: "What is it about them that reads as not looking to you?",
        answer: "they're both facing somewhere else", gate: at({ depth: 2, life: false }) },
      { asks: "Whose facing somewhere else is that one?",
        answer: "me and my flatmate, since the shifts changed",
        gate: at({ depth: 4, life: true, level: "consequences" }) },
      { asks: "What happened the last time you were both in?",
        answer: "nothing much, we watched something",
        gate: at({ depth: 4, life: true, level: "consequences" }) },

      { asks: "The advice card is the Ace of Pentacles. What does it look like?",
        answer: "a hand holding out a coin", gate: at({ depth: 2, life: false }) },
      { asks: "What is it about the hand that reads as holding out to you?",
        answer: "it's waiting for someone to take it", gate: at({ depth: 2, life: false }) },
    ],
  });

  const findings = scanSession(session, pack);
  assert.deepEqual(findings.map((f) => f.code), [],
                   `expected a clean scan, got ${findings.map((f) => f.code).join(", ")}`);
  assert.equal(session.closed, true);

  // The bridge rides on the elaborated answer, not on the first read: "needed"
  // and "enough" are words the person only produced once asked to elaborate.
  const situation = session.exchanges.filter((e) => e.position === "situation");
  assert.equal(situation.length, 4, "settle, cross, dwell");
  const elaborated = situation[1].a.toLowerCase();
  const bridge = situation[2].q.toLowerCase();
  const shared = [...new Set(bridge.match(/[a-z']{4,}/g) ?? [])]
    .filter((w) => elaborated.includes(w));
  assert.ok(shared.length >= 2, `the bridge quotes nothing they elaborated: ${bridge}`);
  assert.ok(!scanSession(session, pack).some((f) => f.code === "rail_switch_unsettled"));
});

// -- (c) the judge no longer spends its ceiling thinking -----------------

test("a judge call turns thinking off where the provider implements it", () => {
  const payload = ANTHROPIC.judgePayload({
    model: "m", system: "s", messages: [], schema: {},
    features: PROVIDERS.anthropic.features,
  });
  assert.deepEqual(payload.thinking, { type: "disabled" });
  assert.equal(payload.max_tokens, 4096, "the object is a few hundred tokens; this is headroom");
  assert.equal(payload.output_config.effort, "low");
});

test("it still asks a gateway that never declared thinking to turn it off", () => {
  // lantern-be7743's judge call came back response_truncated on this provider,
  // having generated nothing, and a Ten of Pentacles turn did it again at 8192.
  // The 1M is context. This is output, and something is spending it.
  //
  // Asking it to stop is the one instruction that is safe to send blind: if the
  // gateway rejects it that is one legible 400 next turn, and if it ignores it
  // we are exactly where we already were -- which is why the ceiling stays at
  // 8k here rather than dropping to the 4k that only a heard instruction earns.
  const payload = ANTHROPIC.judgePayload({
    model: "m", system: "s", messages: [], schema: {},
    features: PROVIDERS.deepseek.features,
  });
  assert.deepEqual(payload.thinking, { type: "disabled" });
  assert.equal(payload.max_tokens, 8192, "not lowered on an assumption");
});

test("a provider observed to reject it opts out with one word", () => {
  const payload = ANTHROPIC.judgePayload({
    model: "m", system: "s", messages: [], schema: {},
    features: { ...PROVIDERS.deepseek.features, thinkingOff: false },
  });
  assert.equal(payload.thinking, undefined);
  assert.equal(payload.max_tokens, 8192);
});

test("a truncated judge reply says what it spent the budget on", () => {
  const thrown = (body) => {
    try { ANTHROPIC.readText(body); return null; } catch (e) { return e; }
  };
  const deliberated = thrown({
    stop_reason: "max_tokens", usage: { output_tokens: 8192 },
    content: [{ type: "thinking", thinking: "..." }],
  });
  assert.equal(deliberated.code, "response_truncated");
  assert.match(deliberated.message, /8192 output tokens/);
  assert.match(deliberated.message, /blocks \[thinking\]/);

  const looped = thrown({
    stop_reason: "max_tokens", usage: { output_tokens: 8192 },
    content: [{ type: "text", text: "{ \"disclosure_depth\": 2, ".repeat(4) }],
  });
  assert.match(looped.message, /characters of text starting "\{ "disclosure_depth/);

  const nothing = thrown({ stop_reason: "max_tokens", content: [] });
  assert.match(nothing.message, /blocks \[none\], 0 characters/);
});

test("a reader turn still thinks; only the judge does not", () => {
  const payload = ANTHROPIC.chatPayload({
    model: "m", system: "s", messages: [], features: PROVIDERS.anthropic.features,
  });
  assert.deepEqual(payload.thinking, { type: "adaptive" });
  assert.equal(payload.max_tokens, 8192, "chat ceiling unchanged");
});
