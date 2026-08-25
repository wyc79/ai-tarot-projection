import { test } from "node:test";
import assert from "node:assert/strict";
import { startReading } from "../../web/js/engine/reading.js";
import { levelDistance, targetLevel } from "../../web/js/engine/levels.js";
import { questionLevel, questionType } from "../../web/js/engine/questions.js";
import { scanSession } from "../../scripts/scan.mjs";
import { declines, fakeClient, realPack } from "./helpers.mjs";

const SEED = "moon-4f2a91";

/** A gate carrying both axes. */
const at = (depth, level, stakes = "low") =>
  ({ disclosure_depth: depth, user_level: level, has_life_content: depth > 2, stakes,
     reading_of_them: "noted" });

/**
 * Drive a session with reader turns that are real questions rather than
 * placeholders, because what is being tested is what the questions are.
 * `turns` is consumed in order; the closing beat is whatever is left when the
 * engine asks for it.
 */
async function play({ script, close = "This week, catch the one moment you brace." }) {
  const pack = await realPack();
  let asked = 0;
  const client = fakeClient({
    gates: script.map((s) => s.gate),
    opening: declines,
    reply: (turn) => (turn === "close" ? close
      : turn === "opening" ? "Anything particular you want to look at?"
      : script[Math.min(asked++, script.length - 1)].asks),
  });
  const reading = startReading({ pack, client, seed: SEED });
  await reading.begin();
  await reading.say("no, nothing in particular");
  for (const { answer } of script) {
    if (reading.session.closed) break;
    await reading.say(answer);
  }
  return { pack, session: reading.session, client };
}

const systemFor = (client, turn) => client.calls.chat.findLast((c) => c.turn === turn).system;

// -- (a) the seeded climb ------------------------------------------------
//
// The scripts below are written against the turn sequence the engine actually
// produces for the depths given -- invite, respond, respond, bridge, ... -- so
// each `asks` is the question that turn really carries. Getting that wrong is
// how the first draft of this fixture "found" a jump that was its own.

test("a reading that climbs one rung at a time scans clean", async () => {
  // The shape the rules jointly ask for: ask the card, cross to their life at
  // the same height, then climb on whichever rail they are on. The first draft
  // of this fixture went "what do you see" -> "when did that start", which is
  // the natural-sounding pattern and is a rail crossing and a climb in one
  // question. It is what c145c7 did on its third turn.
  const { pack, session } = await play({
    script: [
      { asks: "What does it look like it's pointing at for you?",
        answer: "a woman on her own in a garden", gate: at(2, "name") },
      { asks: "Whose being on their own is that, in your world?",
        answer: "mine, since the move in March", gate: at(3, "consequences") },
      { asks: "The obstacle card is the Five of Wands. What do you see in it?",
        answer: "nobody's actually aiming", gate: at(2, "name") },
      { asks: "What happened in there just before this picture?",
        answer: "I stopped answering his calls", gate: at(4, "consequences") },
      { asks: "The advice card is The Fool. What does he look like he's about to do?",
        answer: "walking off", gate: at(2, "name") },
      { asks: "Whose walking off is that one, in your world?",
        answer: "I hate that it got this far", gate: at(3, "evaluate") },
    ],
  });
  assert.equal(session.closed, true);
  const codes = scanSession(session, pack).map((f) => f.code);
  assert.deepEqual(codes, [], `expected a clean scan, got ${codes.join(", ")}`);
});

test("a question two rungs above where they are standing is flagged", async () => {
  // Run B's advice turn, in shape: they were at name and were asked for a plan.
  const { pack, session } = await play({
    script: [
      { asks: "What does it look like it's pointing at for you?",
        answer: "dunno", gate: at(1, "name") },
      { asks: "What would a first step toward the call look like?",
        answer: "walking off, leaving the full ones behind", gate: at(1, "name") },
    ],
  });
  const jump = scanSession(session, pack).find((f) => f.code === "level_jump");
  assert.ok(jump, "the jump from name to plans went unreported");
  assert.match(jump.message, /asked at plans when they were standing at name/);
});

test("a reading that never moves off one rung is flagged", async () => {
  const { pack, session } = await play({
    script: [
      { asks: "What does it look like it's pointing at for you?", answer: "a garden",
        gate: at(2, "name") },
      { asks: "What else do you see in it?", answer: "a bird", gate: at(2, "name") },
      { asks: "Where does your eye go now?", answer: "the wall", gate: at(2, "name") },
      { asks: "What would you call that thing?", answer: "fencing", gate: at(2, "name") },
    ],
  });
  assert.ok(scanSession(session, pack).some((f) => f.code === "level_flat"));
});

// -- (b) the step-down ---------------------------------------------------

test("a deflection stops the climb rather than being climbed away from", async () => {
  const pack = await realPack();
  assert.equal(targetLevel(pack, { userLevel: "consequences", ceiling: "plans" }), "evaluate",
               "an ordinary answer earns one rung");
  assert.equal(targetLevel(pack, { userLevel: "consequences", ceiling: "plans", deflected: true }),
               "consequences", "a deflection is answered at the same height, not a higher one");
  assert.equal(targetLevel(pack, { userLevel: "name", ceiling: "plans", deflected: true }), "name",
               "at the bottom rung, staying put is the forced choice");
  assert.equal(targetLevel(pack, { userLevel: "evaluate", ceiling: "evaluate" }), "evaluate",
               "the position's ceiling holds even when they could go further");
});

test("mid-session, a deflection steps the next question back down", async () => {
  const { client } = await play({
    script: [
      { asks: "What does it look like it's pointing at for you?",
        answer: "it looks tired", gate: at(3, "name") },
      { asks: "When did the tiredness first turn up?",
        answer: "my brother, since March", gate: at(4, "consequences") },
      // They were climbing. Now they shut down, and the judge reads it as name.
      { asks: "The obstacle card is the Five of Wands. What do you see?",
        answer: "dunno", gate: at(1, "name") },
    ],
  });
  const afterDeflection = systemFor(client, "respond");
  assert.match(afterDeflection, /Their last answer worked at \*\*name\*\*/);
  assert.match(afterDeflection, /That was a deflection, so do not climb/);
  assert.match(afterDeflection, /Reach no further than name/);
  assert.match(afterDeflection, /forced choice/);
});

// -- (c) the low-altitude close ------------------------------------------

test("a reading that never leaves the ground still closes, sized to where it got", async () => {
  const { pack, session, client } = await play({
    script: [
      { asks: "What does it look like it's pointing at for you?", answer: "a garden",
        gate: at(2, "name") },
      { asks: "When did that turn up?", answer: "a while back", gate: at(2, "consequences") },
      { asks: "What else happened around then?", answer: "nothing much", gate: at(2, "name") },
      { asks: "The obstacle card is the Five of Wands. What do you see?", answer: "a scrap",
        gate: at(2, "name") },
      { asks: "What happened after that?", answer: "it blew over", gate: at(2, "consequences") },
      { asks: "What did you do next?", answer: "nothing", gate: at(2, "name") },
      { asks: "The advice card is The Fool. What is he doing?", answer: "leaving",
        gate: at(2, "name") },
      { asks: "What happened the last time you left something?", answer: "dunno",
        gate: at(2, "consequences") },
    ],
    close: "You keep saying nothing much. This week, catch one moment where it is not nothing.",
  });
  assert.equal(session.closed, true, "closing is unconditional at any altitude");
  assert.ok(session.closing_reflection, "and it is a real closing beat, not an empty one");

  const closing = systemFor(client, "close");
  assert.match(closing, /highest they have reached all session: consequences/);
  assert.match(closing, /something to notice, not something to carry out/);
  assert.ok(!/something they could do, because they told you what they were after/.test(closing),
            "a plan was offered to someone who never made one");
  assert.ok(!scanSession(session, pack).some((f) => f.code === "unclosed"));
});

test("a reading that reached intentions gets a step it can act on", async () => {
  const { client } = await play({
    script: [
      { asks: "What does it look like it's pointing at for you?", answer: "tired",
        gate: at(3, "name") },
      { asks: "When did that turn up?", answer: "March, my brother", gate: at(4, "consequences") },
      { asks: "The obstacle card is the Five of Wands. What do you see?", answer: "a scrap",
        gate: at(2, "name") },
      { asks: "What's it like for you, seeing that?", answer: "I hate it", gate: at(3, "evaluate") },
      { asks: "The advice card is The Fool. What is he doing?", answer: "leaving",
        gate: at(2, "name") },
      { asks: "Do you know why this one gets to you?",
        answer: "if I spend it I have to admit I'm staying", gate: at(4, "intentions") },
    ],
  });
  const closing = systemFor(client, "close");
  assert.match(closing, /highest they have reached all session: intentions/);
  assert.match(closing, /something they could do, because they told you what they were after/);
});

// -- (d) the two rails (c145c7) ------------------------------------------

test("crossing rails and climbing in the same question is two steps", async () => {
  const pack = await realPack();
  assert.equal(targetLevel(pack, { userLevel: "name", ceiling: "evaluate" }), "consequences",
               "staying on the rail earns a rung");
  assert.equal(targetLevel(pack, { userLevel: "name", ceiling: "evaluate", crossingRails: true }),
               "name", "crossing spends the step");
  assert.equal(targetLevel(pack, { userLevel: "evaluate", ceiling: "plans", crossingRails: true }),
               "evaluate", "and it spends it wherever they are standing");
});

test("the prompt names both targets, since only the reader knows what it will ask", async () => {
  const { client } = await play({
    script: [
      { asks: "What does she look like she's pointing at for you?",
        answer: "judging between good and bad", gate: at(2, "name") },
    ],
  });
  const system = systemFor(client, "respond");
  assert.match(system, /Your last question was about the card/);
  assert.match(system, /A question about their life crosses to the other rail/);
  assert.match(system, /If you cross, ask at name and no higher/);
});

// -- the few-shots are held to the rules they teach -----------------------

test("no few-shot demonstrates a move the scanner would flag", async () => {
  // Two of the six shipped shots were teaching the violations: one crossed
  // rails and climbed in the same question, the other jumped two rungs. They
  // are the highest-leverage text in the pack and nothing was checking them.
  const pack = await realPack();
  for (const shot of pack.fewShots) {
    assert.ok(shot.user_level, `${shot.demonstrates}: no user_level declared`);
    assert.ok(typeof shot.has_life_content === "boolean",
              `${shot.demonstrates}: no has_life_content declared`);

    const level = questionLevel(shot.reader);
    const jump = levelDistance(pack, shot.user_level, level);
    assert.ok(jump <= 1,
              `${shot.demonstrates}: asks at ${level} from ${shot.user_level}, ${jump} rungs`);

    // An answer with nothing of their life in it came off the card rail. A
    // reader question that goes to their life from there is a crossing, and a
    // crossing may not also climb.
    if (!shot.has_life_content && questionType(shot.reader) === "life") {
      assert.equal(jump, 0,
                   `${shot.demonstrates}: crosses to their life and climbs to ${level}`);
    }
  }
});

test("the ownership offer is a permitted forced choice, a plain one is not", async () => {
  const pack = await realPack();
  const session = {
    cards: [{ card_id: "wands-09-nine", position: "situation" }],
    exchanges: [
      { q: "What does it look like it's pointing at for you?", a: "it just looks tired",
        position: "situation", disclosure_depth: 2, gate: { has_life_content: false } },
      { q: "Whose tiredness is that, in your world — yours about something, or someone's about you?",
        a: "mine", position: "situation", disclosure_depth: 3, gate: { has_life_content: true } },
      { q: "Is it the money, or is it that calling him means staying?", a: "the money",
        position: "situation", disclosure_depth: 3, gate: { has_life_content: true } },
    ],
    closing_reflection: "done.", closed: true,
  };
  const stacked = scanSession(session, pack).filter((f) => f.code === "stacked_or");
  assert.equal(stacked.length, 1, "exactly one of the two forced choices is a violation");
  assert.match(stacked[0].text, /Is it the money/);
});
