import { test } from "node:test";
import assert from "node:assert/strict";
import { startReading } from "../../web/js/engine/reading.js";
import { makeStorage, memoryBackend } from "../../web/js/storage.js";
import {
  HISTORY_LIMIT, describeSession, loadHistory, saveToHistory, toJson, toMarkdown,
} from "../../web/js/engine/journal.js";
import { declines, fakeClient, gate, realPack } from "./helpers.mjs";

async function finished(seed = "moon-4f2a91") {
  const pack = await realPack();
  const reading = startReading({
    pack,
    client: fakeClient({
      gates: Array.from({ length: 12 }, (_, i) => gate(i === 0 ? 3 : 4)),
      opening: declines,
      reply: (turn) => (turn === "close" ? "this week, notice the bracing" : `[${turn}]`),
    }),
    seed,
  });
  await reading.begin();
  await reading.say("no, nothing in particular");
  for (const answer of ["it looks tired", "nobody is attacking me",
                        "money", "not the money", "the flat, I think",
                        "if I spend it I'm staying", "I'd have to say it out loud",
                        "to my brother, probably",
                        // The fourth card, turned before the close now.
                        "a hand holding something out", "and nobody taking it",
                        // Past the beat: one answer, then the goodbye.
                        "what happens after the noticing", "fair enough"]) {
    if (reading.session.ended) break;
    await reading.say(answer);
  }
  return { pack, session: reading.session };
}

test("the markdown keepsake carries the cards, the user's words and the step", async () => {
  const { pack, session } = await finished();
  const md = toMarkdown(pack, session);

  assert.match(md, /^# Reading — \d{4}-\d{2}-\d{2}/);
  assert.ok(md.includes(session.seed), "the seed is in the file, so the reading can be re-run");
  for (const entry of session.cards) {
    assert.ok(md.includes(pack.card(entry.card_id).name), `missing card: ${entry.card_id}`);
  }
  for (const exchange of session.exchanges) {
    assert.ok(md.includes(exchange.a), `missing the user's own words: ${exchange.a}`);
  }
  assert.match(md, /## The step\n\nthis week, notice the bracing/);
  assert.match(md, /## Before the cards/, "what they came in with is part of the record");
});

test("positions are labelled in the order they were read", async () => {
  const { pack, session } = await finished();
  const md = toMarkdown(pack, session);
  const order = [...md.matchAll(/^## (Situation|Obstacle|Advice) —/gm)].map((m) => m[1]);
  assert.deepEqual(order, ["Situation", "Obstacle", "Advice"]);
});

test("the json export carries the seed and every flip-gate verdict", async () => {
  const { session } = await finished();
  const parsed = JSON.parse(toJson(session));
  assert.equal(parsed.schema_version, 1);
  assert.equal(parsed.session.seed, "moon-4f2a91");
  for (const exchange of parsed.session.exchanges) {
    assert.equal(typeof exchange.gate.stakes, "string",
                 "every turn is stakes-checked, the opening one included");
  }
  for (const exchange of parsed.session.exchanges.filter((e) => e.position !== "opening")) {
    assert.equal(typeof exchange.gate.disclosure_depth, "number",
                 "re-running a transcript needs what the judge thought at the time");
  }
});

test("a dropped-frame reading says so in the file", async () => {
  const { pack, session } = await finished();
  session.safety_state = "drop_frame";
  assert.match(toMarkdown(pack, session), /stopped being a reading partway through/);
});

test("history keeps one entry per session, updated in place", async () => {
  const storage = makeStorage(memoryBackend());
  const { session } = await finished();
  saveToHistory(storage, session);
  session.exchanges.push({ q: "later", a: "more", disclosure_depth: 3, position: "advice", gate: {} });
  saveToHistory(storage, session);
  const history = loadHistory(storage);
  assert.equal(history.length, 1);
  assert.equal(history[0].exchanges.at(-1).a, "more");
});

test("history is capped, oldest dropped first", async () => {
  const storage = makeStorage(memoryBackend());
  for (let i = 0; i < HISTORY_LIMIT + 5; i += 1) {
    saveToHistory(storage, { session_id: `s${i}`, started_at: i, seed: `seed-${i}`, exchanges: [] });
  }
  const history = loadHistory(storage);
  assert.equal(history.length, HISTORY_LIMIT);
  assert.equal(history[0].session_id, `s${HISTORY_LIMIT + 4}`, "newest first");
  assert.ok(!history.some((s) => s.session_id === "s0"), "oldest was dropped");
});

test("a saved session is a copy, not a live reference", async () => {
  const storage = makeStorage(memoryBackend());
  const { session } = await finished();
  saveToHistory(storage, session);
  session.closing_reflection = "changed after saving";
  assert.notEqual(loadHistory(storage)[0].closing_reflection, "changed after saving");
});

test("saved readings are described by what they were about", async () => {
  const { session } = await finished();
  const label = describeSession(session);
  assert.match(label, /^\d{4}-\d{2}-\d{2} · /);
  assert.doesNotMatch(label, /unfinished/, "this one closed");
  assert.match(describeSession({ ...session, closed: false }), /\(unfinished\)$/);
});

test("the keepsake carries no trailing whitespace from the stream", async () => {
  const { pack, session } = await finished();
  session.exchanges[0].q = "a reader turn ending in a space ";
  session.closing_reflection = "the step, with a stray space ";
  for (const line of toMarkdown(pack, session).split("\n")) {
    assert.equal(line, line.trimEnd(), `trailing space on: ${JSON.stringify(line)}`);
  }
});

test("state is persisted before it is announced, so listeners read the new state", async () => {
  const { makeStorage, memoryBackend } = await import("../../web/js/storage.js");
  const { startReading } = await import("../../web/js/engine/reading.js");
  const pack = await realPack();
  const storage = makeStorage(memoryBackend());
  const seenAtEvent = {};
  const reading = startReading({
    pack, storage, seed: "moon-4f2a91",
    client: fakeClient({ gates: Array.from({ length: 10 }, () => gate(4)), opening: declines }),
    onEvent: (e) => {
      if (e.type === "anchor" || e.type === "closed") {
        const saved = loadHistory(storage)[0];
        seenAtEvent[e.type] = { anchor: Boolean(saved?.anchor), closed: saved?.closed };
      }
    },
  });
  await reading.begin();
  await reading.say("nothing in particular");
  for (const a of ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]) {
    if (reading.session.closed) break;
    await reading.say(a);
  }
  assert.equal(seenAtEvent.anchor.anchor, true, "the anchor event fired before the anchor was saved");
  assert.equal(seenAtEvent.closed.closed, true, "the closed event fired before the close was saved");
});

test("both stakes descriptions name advice-to-others, not just decisions", async () => {
  // From a real session: "financial advice" was judged low, and the reader
  // improvised the handback the gate should have asked for.
  const { OPENING_SCHEMA, gateSchema } = await import("../../web/js/engine/schemas.js");
  for (const schema of [gateSchema(await realPack()), OPENING_SCHEMA]) {
    assert.match(schema.properties.stakes.description, /advice of that kind\s*they intend to give someone else|advice they intend to give\s*someone else/);
  }
});
