/**
 * Run a canonical seeded session and print what the engine did.
 *
 *   node scripts/seeded_session.mjs                 # summary
 *   node scripts/seeded_session.mjs --prompt=respond  # dump one turn's system prompt
 *   node scripts/seeded_session.mjs --json          # machine-readable, for diffing runs
 *
 * Uses a scripted stand-in for the model, so the cards, the flip decisions and
 * the assembled prompts are all reproducible. That is the point: this is the
 * fixture that tells you whether a prompt change moved the pacing.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPack } from "../web/js/pack.js";
import { startReading } from "../web/js/engine/reading.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SEED = "moon-4f2a91";

const fileFetch = async (url) => {
  try {
    return new Response(await readFile(path.join(ROOT, url), "utf8"), { status: 200 });
  } catch {
    return new Response("not found", { status: 404 });
  }
};

// A session that exercises every turn kind and both ends of the depth ladder.
const SCRIPT = [
  { answer: "yeah - whether I keep bracing for a fight nobody's having",
    opening: { has_topic: true, topic: "bracing for a fight nobody's having", stakes: "low" } },
  { answer: "dunno", gate: { disclosure_depth: 1, user_level: "name", has_life_content: false, stakes: "low" } },
  { answer: "it looks tired I guess", gate: { disclosure_depth: 2, user_level: "name", has_life_content: false, hedged: true, stakes: "low" } },
  { answer: "my brother, and I haven't called him since March",
    gate: { disclosure_depth: 4, user_level: "consequences", has_life_content: true, stakes: "low" } },
  // The dwell exchange: they have just said something of their own, so the card
  // stays put for one turn before the reading moves on.
  { answer: "there wasn't a row, it just got later and later",
    gate: { disclosure_depth: 4, user_level: "consequences", has_life_content: true, stakes: "low" } },
  { answer: "money, mostly", gate: { disclosure_depth: 2, user_level: "name", has_life_content: true, stakes: "low" } },
  { answer: "if I spend it I have to admit I'm staying",
    gate: { disclosure_depth: 4, user_level: "intentions", has_life_content: true, stakes: "low" } },
  { answer: "walking off, leaving the full ones", gate: { disclosure_depth: 3, user_level: "name", has_life_content: false, stakes: "low" } },
  // The eighth answer exists so the fixture reaches the closing beat. Without
  // it the canonical session ended unclosed and --prompt=close had no turn to
  // print, which is how run B's failure mode sat in our own fixture unnoticed.
  { answer: "lighter, maybe", gate: { disclosure_depth: 2, user_level: "evaluate", has_life_content: true, hedged: true, stakes: "low" } },
  // And the dwell on that one, before the closing beat. A disclosure on the
  // last card buys its turn like any other.
  { answer: "not carrying the phone around, mostly",
    gate: { disclosure_depth: 3, user_level: "evaluate", has_life_content: true, stakes: "low" } },
  // The advice position targets three exchanges now, the way the obstacle does:
  // the budget rises across the arc alongside the level ceiling. Without this
  // one the fixture ends unclosed again, which is the failure it was written
  // for in the first place.
  { answer: "I'd have to say out loud that I'm not waiting for him to start",
    gate: { disclosure_depth: 4, user_level: "intentions", has_life_content: true, stakes: "low" } },
  // Eleven answers for three cards, and one of them is the hedge above: a
  // hedged answer never counted toward the budget, so the advice card pays for
  // "lighter, maybe" with an extra turn. That is the rule working, and it is
  // the reason this script is a turn longer than the arithmetic suggests.
  { answer: "before Sunday, probably. he never starts these",
    gate: { disclosure_depth: 4, user_level: "plans", has_life_content: true, stakes: "low" } },
  // The fourth card. It is decided at the advice-to-close boundary now rather
  // than after the beat, so a session that got somewhere turns it and closes
  // once, over four. Its budget is two, which is these:
  { answer: "the one at the front, walking off with nothing",
    gate: { disclosure_depth: 2, user_level: "name", has_life_content: false, stakes: "low" } },
  { answer: "that I keep waiting to be asked, and then resenting it",
    gate: { disclosure_depth: 4, user_level: "evaluate", has_life_content: true, stakes: "low" } },
  // The dwell on that one. Even the last card of all does not end on the turn
  // someone says the strongest thing they said.
  { answer: "since about the same time, more or less",
    gate: { disclosure_depth: 3, user_level: "consequences", has_life_content: true, stakes: "low" } },
  // Past the closing beat. The first one gets a real answer -- that is what the
  // tail is for -- and then the reader says goodbye rather than waiting to be
  // dismissed. Two beats, not one, and not nine.
  { answer: "what happens after the noticing though",
    gate: { disclosure_depth: 2, user_level: "name", has_life_content: false, stakes: "low" } },
  { answer: "fair enough. thanks",
    gate: { disclosure_depth: 1, user_level: "name", has_life_content: false, stakes: "low" } },
];

function scriptedClient(prompts) {
  let turn = 0;
  let step = 0;
  return {
    async chat({ kind, system, messages, onDelta = () => {} }) {
      // The prompt as the model receives it: the cached-prefix half, then the
      // turn block folded into the last user message. `kind` is what the engine
      // asked for, so --prompt=bridge finds a bridge turn rather than matching a
      // marker against the prose and quietly finding nothing.
      prompts.push({ kind, system, messages,
                     full: `${system}\n${messages[messages.length - 1]?.content ?? ""}` });
      const text = `[reader turn ${(turn += 1)}]`;
      onDelta(text, text);
      return text;
    },
    async judge({ kind }) {
      if (kind === "opening") return SCRIPT[0].opening;
      if (kind === "anchor") {
        return {
          theme: "bracing for a fight nobody's having",
          user_phrases: [
            { phrase: "bracing for a fight nobody's having", source: "life" },
            { phrase: "haven't called him since March", source: "life" },
          ],
          // Territory, not thesis: it names what the reading is walking toward
          // and leaves both answers live.
          resolution_beat: "whether the bracing is still protecting anything, or has outlived whatever it was for",
        };
      }
      // SCRIPT[0] is the opening answer, which has no flip gate.
      const entry = SCRIPT[Math.min(step + 1, SCRIPT.length - 1)];
      step += 1;
      return { ...entry.gate, reading_of_them: entry.answer.slice(0, 60) };
    },
  };
}

const args = process.argv.slice(2);
const wantJson = args.includes("--json");
const wantPrompt = args.find((a) => a.startsWith("--prompt="))?.split("=")[1];

const pack = await loadPack("data", { fetchImpl: fileFetch });
const prompts = [];
const events = [];
const reading = startReading({
  pack, client: scriptedClient(prompts), seed: SEED, onEvent: (e) => events.push(e),
});

await reading.begin();
for (const { answer } of SCRIPT) {
  // Runs past the closing beat now, because the ending is three beats rather
  // than one: the close, a short tail, and the farewell that ends the session.
  if (reading.session.ended) break;
  await reading.say(answer);
}

const session = reading.session;
const record = {
  seed: session.seed,
  topic: session.topic,
  cards: session.cards.map((c) => `${c.position}:${c.card_id}`),
  anchor_theme: session.anchor?.theme ?? null,
  flips: events.filter((e) => e.type === "flip")
    .map((e) => `${e.position}: ${e.reason}`),
  decisions: events.filter((e) => e.type === "flip_decision")
    .map((e) => `depth ${e.gate.disclosure_depth} level ${e.gate.user_level} -> ${e.decision.flip ? "FLIP" : "hold"} (${e.decision.reason})`),
  closed: session.closed,
  ended: session.ended,
  face_down: (session.deal ?? [])
    .filter((d) => !session.cards.some((c) => c.position === d.position))
    .map((d) => d.position),
};

if (wantPrompt) {
  const found = prompts.find((p) => p.kind === wantPrompt);
  if (!found) {
    const seen = [...new Set(prompts.map((p) => p.kind))];
    console.error(`no ${wantPrompt} turn in this session. It ran: ${seen.join(", ")}`);
    process.exit(1);
  }
  console.log(found.full);
  console.error(`\n(${(found.system.length / 1024).toFixed(1)} KB cacheable prefix + `
    + `${((found.full.length - found.system.length) / 1024).toFixed(1)} KB per turn)`);
} else if (wantJson) {
  console.log(JSON.stringify(record, null, 2));
} else {
  console.log(`seed        ${record.seed}`);
  console.log(`topic       ${record.topic ?? "(declined)"}`);
  console.log(`anchor      ${record.anchor_theme ?? "(none)"}`);
  console.log(`cards       ${record.cards.join("  ")}`);
  console.log(`closed      ${record.closed}`);
  console.log(`ended       ${record.ended}${record.face_down.length
    ? `  (face down: ${record.face_down.join(", ")})` : ""}`);
  console.log("pacing:");
  for (const line of record.decisions) console.log(`  ${line}`);
  console.log("flips:");
  for (const line of record.flips) console.log(`  ${line}`);
}
