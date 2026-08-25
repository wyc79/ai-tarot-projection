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
import { turnKindOf } from "../web/js/engine/prompts.js";

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
  // last card buys its turn like any other, so the advice card runs to three.
  { answer: "not carrying the phone around, mostly",
    gate: { disclosure_depth: 3, user_level: "evaluate", has_life_content: true, stakes: "low" } },
];

function scriptedClient(prompts) {
  let turn = 0;
  let step = 0;
  return {
    async chat({ system, messages, onDelta = () => {} }) {
      prompts.push({ system, messages });
      const text = `[reader turn ${(turn += 1)}]`;
      onDelta(text, text);
      return text;
    },
    async judge({ schema }) {
      if (schema.properties.has_topic) return SCRIPT[0].opening;
      if (schema.properties.theme) {
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
  if (reading.session.closed) break;
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
};

if (wantPrompt) {
  const found = prompts.find((p) => turnKindOf(p.system) === wantPrompt);
  if (!found) {
    const seen = [...new Set(prompts.map((p) => turnKindOf(p.system)))];
    console.error(`no ${wantPrompt} turn in this session. It ran: ${seen.join(", ")}`);
    process.exit(1);
  }
  console.log(found.system);
} else if (wantJson) {
  console.log(JSON.stringify(record, null, 2));
} else {
  console.log(`seed        ${record.seed}`);
  console.log(`topic       ${record.topic ?? "(declined)"}`);
  console.log(`anchor      ${record.anchor_theme ?? "(none)"}`);
  console.log(`cards       ${record.cards.join("  ")}`);
  console.log(`closed      ${record.closed}`);
  console.log("pacing:");
  for (const line of record.decisions) console.log(`  ${line}`);
  console.log("flips:");
  for (const line of record.flips) console.log(`  ${line}`);
}
