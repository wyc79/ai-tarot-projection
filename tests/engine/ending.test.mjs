/**
 * How a session ends.
 *
 * From tower-6e335b, a local session that is not in this repo and will not be:
 * it closed over three cards, then earned a fourth, then closed again reusing
 * the first close's own formula -- and the open tail after that ran nine
 * exchanges asking after the nouns in a side project, at name level, while the
 * heaviest thing said all session sat unmentioned. The judge saw the drift as
 * it happened and nothing was listening for it.
 *
 * tests/fixtures/harbor-4c81de.json is that shape with fictional content, and
 * the first half of this file is what the scanner has to say about it. The
 * second half is the same shape run through the engine as it is now.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { startReading } from "../../web/js/engine/reading.js";
import {
  createSession, epilogueEarned, heavyMaterial, tableau,
} from "../../web/js/engine/state.js";
import { inTerritory } from "../../web/js/engine/questions.js";
import { anchorTerritory, scanSession } from "../../scripts/scan.mjs";
import { declines, fakeClient, realPack } from "./helpers.mjs";

const SEED = "moon-4f2a91";

const at = ({ depth = 2, life = false, level = "name", hedged = false, stakes = "low" } = {}) =>
  ({ disclosure_depth: depth, has_life_content: life, user_level: level, hedged,
     asked_back: false, stakes, reading_of_them: "noted" });

const harbor = async () =>
  JSON.parse(await readFile(new URL("../fixtures/harbor-4c81de.json", import.meta.url), "utf8")).session;

const codes = (findings) => findings.map((f) => f.code);

// -- (a) what harbor is a fixture for -------------------------------------

test("harbor closed twice, and the scanner says which one was the second", async () => {
  const pack = await realPack();
  const session = await harbor();
  const findings = scanSession(session, pack).filter((f) => f.code === "double_close");
  assert.equal(findings.length, 1, "one finding, on the second beat and not on the first");
  assert.equal(findings[0].position, "close");
  assert.match(findings[0].text, /^Across these four cards/);
  // The first beat is not reported as a turn that forgot to ask a question. It
  // is a closing beat that landed in the middle of the session, which is a
  // different defect and the one worth reading.
  assert.ok(!codes(scanSession(session, pack)).includes("no_question"));
});

test("both of harbor's endings open the same way, which is why it reads as a repeat", async () => {
  const session = await harbor();
  const first = session.exchanges.find((e) => e.position === "afterward").q;
  assert.match(first, /^Across these three cards, in your own words/);
  assert.match(session.closing_reflection, /^Across these four cards, in your own words/);
});

test("the tail after harbor's first close is an interview about a side project", async () => {
  const pack = await realPack();
  const session = await harbor();
  const drift = scanSession(session, pack).filter((f) => f.code === "off_territory");
  assert.equal(drift.length, 4, "four questions, none of them about what the reading found");
  for (const finding of drift) {
    assert.equal(finding.position, "afterward");
    assert.match(finding.text, /scheduler|text file|port/);
  }
});

test("the territory rule is about the anchor, not about being on topic generally", async () => {
  const session = await harbor();
  const ground = anchorTerritory(session);
  assert.ok(inTerritory("What would make the flat feel like yours again?", ground));
  assert.ok(inTerritory("What are you actually protecting by waiting?", ground));
  assert.ok(!inTerritory("What did you write the scheduler in?", ground));
  // Nothing found means nothing to drift off. A session that never got anywhere
  // is not one to start flagging questions in.
  assert.ok(inTerritory("What did you write the scheduler in?", []));
});

test("harbor's heaviest material is never mentioned again after the beat", async () => {
  const pack = await realPack();
  const session = await harbor();
  const heavy = heavyMaterial(session);
  assert.equal(heavy.length, 1);
  assert.match(heavy[0].a, /the lease is up in March/);
  const dropped = scanSession(session, pack).filter((f) => f.code === "heavy_material_dropped");
  assert.equal(dropped.length, 1, "the ending is about everything except the thing that mattered");
});

test("harbor flags what it is a fixture for, and nothing else", async () => {
  const pack = await realPack();
  const session = await harbor();
  assert.deepEqual([...new Set(codes(scanSession(session, pack)))].sort(),
                   ["double_close", "heavy_material_dropped", "off_territory"]);
});

// -- (a) the same shape, run through the engine as it is now --------------

/**
 * harbor's session, replayed. The answers are the fixture's; what changed is
 * everything around them.
 *
 * The reader's farewell is written here rather than canned, because the thing
 * being checked is that a reader following the instruction produces an ending
 * that scans clean -- the instruction itself is checked separately, below.
 */
async function replayHarbor() {
  const pack = await realPack();
  const session = await harbor();
  const answers = session.exchanges.filter((e) => e.position !== "opening").map((e) => e.a);
  const gates = session.exchanges.filter((e) => e.position !== "opening").map((e) => e.gate);

  // The reader's turns are harbor's own, in order, so what the scanner reads is
  // real questions rather than placeholders. The two that this round changed
  // are written here: the one closing beat, and the goodbye.
  // The reader's turns are stand-ins, but well-formed ones -- real questions of
  // the right kind for each turn -- because the scanner reads reader text and
  // a placeholder reads as a turn that forgot to ask anything. Harbor's own
  // wording cannot be reused: the turn order is different now, which is the
  // whole point, so its questions would land against the wrong cards.
  const client = fakeClient({
    gates,
    opening: { has_topic: true, topic: session.topic, stakes: "low" },
    anchor: { ...session.anchor },
    reply: (turn) => ({
      opening: "Before I turn anything over — is there something particular "
        + "you would like to look at?",
      respond: "What is it about that which stands out to you?",
      after: "What would make the flat feel like yours either way?",
      close: "The desk has not moved in four years and neither has the decision. "
        + "This week, catch the moment you wait for someone to say it is fine either way.",
      farewell: "The lease is still the lease, and that one wants a spreadsheet and "
        + "someone who knows the market, not a card. Whenever you want to look at "
        + "something again, the deck is here. Take care.",
    }[turn] ?? "A card turns over. What do you see in it?"),
  });
  const reading = startReading({ pack, client, seed: SEED });
  await reading.begin();
  await reading.say(session.exchanges[0].a);
  for (const answer of answers) {
    if (reading.session.ended) break;
    await reading.say(answer);
  }
  return { pack, reading, client };
}

test("replayed, harbor closes once — over four cards, before the beat", async () => {
  const { reading, client } = await replayHarbor();
  const s = reading.session;
  assert.equal(s.cards.length, 4);
  assert.equal(s.cards.at(-1).position, "epilogue");
  const turns = client.calls.chat.map((c) => c.turn);
  assert.equal(turns.filter((t) => t === "close").length, 1, "one ending, not two");
  assert.ok(turns.indexOf("epilogue") < turns.indexOf("close"),
            "and the fourth card turned before it rather than after");
  assert.match(s.cards.at(-1).flip_reason, /earned before the close/);
});

test("replayed, it reaches a farewell and the session ends", async () => {
  const { reading, client } = await replayHarbor();
  assert.equal(reading.session.ended, true, "the session ends rather than trailing off");
  assert.ok(reading.session.farewell, "and the goodbye is kept");
  assert.equal(client.calls.chat.at(-1).turn, "farewell");
  const tail = reading.session.exchanges.filter((e) => e.position === "afterward");
  assert.ok(tail.length <= 3, `the tail ran to ${tail.length}; the cap is three`);
});

test("replayed, the farewell is told about the lease and the scan comes back clean", async () => {
  const { pack, reading, client } = await replayHarbor();
  const prompt = client.calls.chat.at(-1).prompt;
  assert.match(prompt, /REAL-WORLD STAKES WERE SAID ALOUD IN THIS SESSION/);
  assert.match(prompt, /the lease is up in March/);
  assert.match(prompt.replace(/\s+/g, " "), /one gentle line acknowledging it comes first/);
  assert.match(prompt.replace(/\s+/g, " "), /It ends without a question/);

  const found = codes(scanSession(reading.session, pack));
  for (const code of ["double_close", "off_territory", "heavy_material_dropped", "no_question"]) {
    assert.ok(!found.includes(code), `${code} survived the fix: ${found.join(", ")}`);
  }
});

// -- (b) the reading that never found anyone ------------------------------

/** A session of pure card description, driven to wherever it gets to. */
async function lowEngagement() {
  const pack = await realPack();
  const client = fakeClient({
    gates: Array.from({ length: 20 }, () => at({ depth: 1, life: false })),
    opening: declines,
  });
  const reading = startReading({ pack, client, seed: SEED });
  await reading.begin();
  await reading.say("nothing in particular");
  for (let i = 0; i < 20 && !reading.session.ended; i += 1) await reading.say(`a picture, ${i}`);
  return { pack, reading, client };
}

test("a reading nothing landed on closes over three, and the fourth stays face down", async () => {
  const { reading, client } = await lowEngagement();
  const s = reading.session;
  assert.equal(s.closed, true, "closing is unconditional; that has not changed");
  assert.equal(s.cards.length, 3);
  const table = tableau(s);
  assert.equal(table.length, 4, "four were dealt");
  assert.equal(table.filter((t) => !t.face_up).length, 1);
  assert.ok(table.at(-1).epilogue && !table.at(-1).face_up,
            "and the one still face down is the fourth");
  assert.ok(!client.calls.chat.some((c) => c.turn === "epilogue"));
  assert.equal(client.calls.chat.map((c) => c.turn).filter((t) => t === "close").length, 1);
});

test("and the closing beat is told to say so as an invitation, never as a grade", async () => {
  const { client } = await lowEngagement();
  const close = client.calls.chat.find((c) => c.turn === "close").prompt.replace(/\s+/g, " ");
  assert.match(close, /## One card stays face down/);
  assert.match(close, /one card stays with the deck today; it'll be there when you come back/);
  assert.match(close, /As an invitation, never as a verdict/);
  assert.match(close, /Not withheld, not unearned/);
  assert.match(close, /Do not name it\. Do not guess at it\./);
});

test("the keepsake says the deck kept one, so three cards does not read as a fault", async () => {
  const { pack, reading } = await lowEngagement();
  const { toMarkdown } = await import("../../web/js/engine/journal.js");
  const md = toMarkdown(pack, reading.session);
  assert.match(md, /_One card stayed with the deck\. Still there next time\._/);
  assert.equal((md.match(/^## The step$/gm) ?? []).length, 1, "and one ending in the file");
});

test("the fourth card is pack data; a pack without one can never deal it", async () => {
  const pack = await realPack();
  assert.equal(pack.epilogue.id, "epilogue");
  assert.equal(pack.position("epilogue").ceiling, "plans");
  assert.ok(!pack.positions.some((p) => p.id === "epilogue"),
            "the spread is three; this is not a fourth position in it");

  const plainPack = createSession({ packId: "p", seed: "s", positions: pack.positions });
  assert.equal(plainPack.epilogue_position, null);
  assert.equal(epilogueEarned(plainPack), false);
});

// -- (c) they chose to stay -----------------------------------------------

/** A finished session, ended on its farewell, with the door taken back. */
async function stayed(afterGates = []) {
  const pack = await realPack();
  const client = fakeClient({
    gates: Array.from({ length: 14 },
                      () => at({ depth: 3, life: true, level: "consequences" })),
    anchor: {
      theme: "the flat, and a decision coming up on it",
      user_phrases: [{ phrase: "the flat, four years of it", source: "life" },
                     { phrase: "waiting to be told it is fine either way", source: "life" }],
      resolution_beat: "whether staying is the thing being protected, or the thing it is protected from",
    },
    opening: declines,
  });
  const reading = startReading({ pack, client, seed: SEED });
  await reading.begin();
  await reading.say("nothing in particular");
  for (let i = 0; i < 14 && !reading.session.ended; i += 1) await reading.say(`answer ${i}`);
  assert.equal(reading.session.ended, true, "the session did not reach its farewell");
  // Queued only now: how many verdicts a session spends on the way to its
  // farewell is the pacing's business, not this helper's.
  client.gates.length = 0;
  client.gates.push(...afterGates);
  reading.stayAWhile();
  return { pack, reading, client };
}

test("staying a while reopens the session under a different contract", async () => {
  const { reading } = await stayed();
  assert.equal(reading.session.ended, false);
  assert.equal(reading.session.phase, "afterglow");
  // No reader turn on the way in. They chose to keep talking, so they talk --
  // a turn generated by a button press is the reader holding them at the door
  // it just opened.
  const { client } = await stayed();
  assert.equal(client.calls.chat.at(-1).turn, "farewell");
});

test("an afterglow turn is told to stay inside the anchor and may ask nothing", async () => {
  const { reading, client } = await stayed([at({ depth: 3, life: true, level: "evaluate" })]);
  await reading.say("I keep thinking about the four years thing");
  assert.equal(client.calls.chat.at(-1).turn, "afterglow");
  const prompt = client.calls.chat.at(-1).prompt.replace(/\s+/g, " ");
  assert.match(prompt, /THEY CHOSE TO STAY/);
  assert.match(prompt, /"the flat, four years of it"/);
  assert.match(prompt, /You do not have to ask anything/);
  assert.match(prompt, /Go up, not sideways/);
  assert.match(prompt, /a new subject now is an interview/);
  assert.equal(reading.session.exchanges.at(-1).position, "afterglow",
               "its own position, so nothing counts it as a card's turn");
});

test("a reflective afterglow turn with no question is legal, and only there", async () => {
  const { pack, reading } = await stayed([at({ depth: 3, life: true, level: "evaluate" })]);
  await reading.say("I keep thinking about the four years thing");
  // What a reader receiving something rather than reaching for more sounds
  // like. Everywhere else in the product this is a finding.
  reading.session.exchanges.at(-1).q = "Four years of knowing where everything is, and now "
    + "a decision about it. That is a lot to be holding.";
  reading.session.exchanges.push({
    q: "Four years of it, and you are the one who has to say it is fine.",
    a: "yeah", position: "afterglow", disclosure_depth: 2,
    gate: at({ depth: 2, life: true }),
  });
  // Scoped to the afterglow: the rest of this session's turns are placeholders
  // from the stand-in reader and have no questions in them by construction.
  const flagged = scanSession(reading.session, pack)
    .filter((f) => f.code === "no_question" && f.position === "afterglow");
  assert.deepEqual(flagged, [], "a statement in the afterglow was flagged");
});

test("two answers with nothing of theirs in them and the reader offers the door", async () => {
  const off = () => at({ depth: 2, life: false, level: "name" });
  const { reading, client } = await stayed([off(), off()]);
  await reading.say("anyway I have been messing with a scheduling script");
  assert.equal(client.calls.chat.at(-1).turn, "afterglow", "one is a quiet answer, not a drift");
  await reading.say("python, and a text file");
  assert.equal(client.calls.chat.at(-1).turn, "regroup", "two is the reader having found a subject");

  const prompt = client.calls.chat.at(-1).prompt.replace(/\s+/g, " ");
  assert.match(prompt, /this turn either goes back or offers the door/i);
  assert.match(prompt, /we can sit with this, or leave it here for today/);
  assert.match(prompt, /Do not carry on asking about whatever came up/);
});

test("offering the door is not a forced choice the scanner should be flagging", async () => {
  const pack = await realPack();
  const session = await harbor();
  session.exchanges.push({
    q: "We can sit with this, or leave it here for today?",
    a: "leave it, I think", position: "afterglow", disclosure_depth: 2,
    question_type: "life", question_level: "name", gate: at({ depth: 2, life: true }),
  });
  const found = scanSession(session, pack).filter((f) => f.code === "stacked_or");
  assert.deepEqual(found, [], "the second option is the door, not a second question");
});
