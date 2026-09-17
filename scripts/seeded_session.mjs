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

import { loadPack } from "../web/js/pack.js";
import { startReading } from "../web/js/engine/reading.js";
import { SCRIPT, SEED, fileFetch, scriptedClient } from "./lib/seeded.mjs";

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
