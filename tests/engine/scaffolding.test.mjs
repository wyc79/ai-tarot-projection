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

const systemFor = (client, turn) => client.calls.chat.findLast((c) => c.turn === turn).prompt;

// -- (a) the seeded climb ------------------------------------------------
//
// The scripts below are written against the turn sequence the engine actually
// produces for the depths given -- invite, respond, respond, bridge, ... -- so
// each `asks` is the question that turn really carries. Getting that wrong is
// how the first draft of this fixture "found" a jump that was its own.

test("a reading that climbs one rung at a time scans clean", async () => {
  // The shape all the rules jointly ask for, and it is four answers a card now
  // rather than three: read the picture, elaborate the read so the crossing has
  // something to ride on, cross at the same height, then spend a turn inside
  // whatever they hand you. Settle, bridge, dwell. The last card is the
  // exception -- it closes at two, because it has nowhere to advance to.
  const { pack, session } = await play({
    script: [
      { asks: "What does it look like it's pointing at for you?",
        answer: "a woman on her own in a garden", gate: at(2, "name") },
      { asks: "What is it about her that reads as on her own to you?",
        answer: "nobody else is there and she isn't looking for anyone", gate: at(2, "name") },
      { asks: "Whose being on their own is that, in your world?",
        answer: "mine, since the move in March", gate: at(3, "consequences") },
      { asks: "What happened after the move?",
        answer: "I stopped calling people back", gate: at(3, "consequences") },

      { asks: "The obstacle card is the Five of Wands. What do you see in it?",
        answer: "nobody's actually aiming", gate: at(2, "name") },
      { asks: "What is it about them that reads as not aiming to you?",
        answer: "they're all going past each other", gate: at(2, "name") },
      { asks: "Whose not-aiming is that one?",
        answer: "my brother and me, we never actually row", gate: at(4, "consequences") },
      { asks: "What happened the last time it nearly did?",
        answer: "I left early and said nothing", gate: at(4, "consequences") },

      { asks: "The advice card is The Fool. What does he look like he's about to do?",
        answer: "walking off", gate: at(2, "name") },
      { asks: "What is it about him that reads as walking off to you?",
        answer: "he isn't looking where his feet are going", gate: at(2, "name") },
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
  assert.match(afterDeflection.replace(/\s+/g, " "), /it was a deflection — do not climb/);
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
  // Three exchanges per card: the card answer, the disclosure, the dwell.
  const { client } = await play({
    script: [
      { asks: "What does it look like it's pointing at for you?", answer: "a man carrying a lot",
        gate: at(2, "name") },
      { asks: "Whose carrying is that, in your world?", answer: "March, my brother",
        gate: at(4, "consequences") },
      { asks: "What happened in March?", answer: "we stopped talking",
        gate: at(4, "consequences") },

      { asks: "The obstacle card is the Five of Wands. What do you see?", answer: "a scrap",
        gate: at(2, "name") },
      { asks: "Whose scrap is that one?", answer: "I hate that it got this far",
        gate: at(3, "evaluate") },
      { asks: "How long has it been like that?", answer: "since the spring",
        gate: at(3, "evaluate") },

      { asks: "The advice card is The Fool. What is he doing?", answer: "leaving",
        gate: at(2, "name") },
      { asks: "Whose leaving is that one?",
        answer: "if I spend it I have to admit I'm staying", gate: at(4, "intentions") },
      { asks: "What happened the last time you nearly admitted it?", answer: "I didn't",
        gate: at(4, "consequences") },
    ],
  });
  const closing = systemFor(client, "close");
  assert.match(closing, /highest they have reached all session: intentions/);
  assert.match(closing, /something they could do, because they told you what they were after/);
});
