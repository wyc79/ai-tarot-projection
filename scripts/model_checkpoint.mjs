/**
 * Model-ceiling checkpoint: run one seeded session twice, varying only the model
 * that writes the reader's turns, and diff the transcripts.
 *
 *   TAROT_API_KEY=sk-... node scripts/model_checkpoint.mjs \
 *     --chat-a=deepseek-v4-flash --chat-b=deepseek-v4-pro
 *
 * Options: --provider (default deepseek), --relay (default http://127.0.0.1:8787),
 *          --seed, --judge (the judge model, held constant across both runs),
 *          --out (directory, default ./checkpoint)
 *
 * Run the relay with DEV_LOG=1 so the full assembled prompts are captured too.
 *
 * The user's answers are fixed, so the only variable is the model. This does not
 * decide anything on its own: it produces two transcripts to read side by side.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPack } from "../web/js/pack.js";
import { makeLlmClient } from "../web/js/llmClient.js";
import { startReading } from "../web/js/engine/reading.js";
import { toJson, toMarkdown } from "../web/js/engine/journal.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const arg = (name, fallback) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=") ?? fallback;

const KEY = process.env.TAROT_API_KEY;
if (!KEY) {
  console.error("TAROT_API_KEY is not set. This experiment needs a real key: it is\n" +
                "measuring a real model, and a stand-in would answer the wrong question.");
  process.exit(1);
}

const PROVIDER = arg("provider", "deepseek");
const RELAY = arg("relay", "http://127.0.0.1:8787");
const SEED = arg("seed", "moon-4f2a91");
const JUDGE = arg("judge", "deepseek-v4-flash");
const OUT = path.resolve(ROOT, arg("out", "checkpoint"));

// Fixed on purpose: identical input, so any difference is the model.
const ANSWERS = [
  "yeah - whether I keep bracing for a fight nobody's having",
  "dunno",
  "it looks tired I guess",
  "my brother, and I haven't called him since March",
  "money, mostly",
  "if I spend it I have to admit I'm staying",
  "walking off, leaving the full ones behind",
];

const fileFetch = async (url) => {
  try {
    return new Response(await readFile(path.join(ROOT, url), "utf8"), { status: 200 });
  } catch {
    return new Response("not found", { status: 404 });
  }
};

async function runOnce(pack, chatModel) {
  const client = makeLlmClient({
    getKey: () => KEY,
    getConfig: () => ({ mode: "relay", relayBase: RELAY, provider: PROVIDER,
                        chatModel, judgeModel: JUDGE }),
  });
  const reading = startReading({ pack, client, seed: SEED });
  await reading.begin();
  for (const answer of ANSWERS) {
    if (reading.session.closed) break;
    await reading.say(answer);
  }
  return reading.session;
}

/** The comparison worth making by eye: what the reader said, turn by turn. */
function readerTurns(session) {
  return [...session.exchanges.map((e) => e.q), session.closing_reflection]
    .filter(Boolean).map((t) => t.trim());
}

function shapeReport(session) {
  return readerTurns(session).map((turn, i) => {
    const questions = (turn.match(/\?/g) ?? []).length;
    const sentences = turn.split(/(?<=[.?!])\s+/).filter(Boolean).length;
    const ors = /\bor\b[^.?!]*\?/i.test(turn);
    return `  turn ${i + 1}: ${sentences} sentences, ${questions} question${questions === 1 ? "" : "s"}` +
           `${ors ? ", STACKED OR" : ""}${sentences > 4 ? ", OVER LENGTH" : ""}`;
  }).join("\n");
}

// Preflight. Finding out the relay is down after the first model call is a
// worse way to learn it than being told before anything is spent.
try {
  const health = await fetch(`${RELAY}/v1/health`);
  const body = await health.json();
  if (!body.ok) throw new Error("relay reported not ok");
  if (!body.providers.includes(PROVIDER)) {
    console.error(`The relay at ${RELAY} has no "${PROVIDER}" provider.\n` +
                  `It offers: ${body.providers.join(", ")}\n` +
                  `Pass --provider=<one of those>, or set PROVIDERS in .env.`);
    process.exit(1);
  }
} catch {
  console.error(
    `No relay answering at ${RELAY}.\n\n` +
    `Start one in another shell, with no trailing comment on the line\n` +
    `(an interactive zsh passes "#" through as an argument):\n\n` +
    `    DEV_LOG=1 python3 server/relay.py\n\n` +
    `Then re-run this. Use --relay=<url> if it is not on port 8787.`);
  process.exit(1);
}

const pack = await loadPack("data", { fetchImpl: fileFetch });
await mkdir(OUT, { recursive: true });

const runs = [];
for (const label of ["a", "b"]) {
  const model = arg(`chat-${label}`, null);
  if (!model) {
    console.error(`--chat-${label}= is required`);
    process.exit(1);
  }
  process.stdout.write(`running ${label}: chat=${model} judge=${JUDGE} seed=${SEED}\n`);
  const session = await runOnce(pack, model);
  await writeFile(path.join(OUT, `${label}-${model}.md`), toMarkdown(pack, session));
  await writeFile(path.join(OUT, `${label}-${model}.json`), toJson(session));
  runs.push({ label, model, session });
}

const [a, b] = runs;
const lines = [
  `seed ${SEED}, judge ${JUDGE}, provider ${PROVIDER}`,
  "",
  `A  ${a.model}`,
  `   cards: ${a.session.cards.map((c) => c.card_id).join(", ")}`,
  `   depths: ${a.session.exchanges.map((e) => e.disclosure_depth).join(" ")}`,
  `   turn shape:`,
  shapeReport(a.session),
  "",
  `B  ${b.model}`,
  `   cards: ${b.session.cards.map((c) => c.card_id).join(", ")}`,
  `   depths: ${b.session.exchanges.map((e) => e.disclosure_depth).join(" ")}`,
  `   turn shape:`,
  shapeReport(b.session),
  "",
  "Same cards is expected: the seed fixes them. Different depths mean the judge",
  "moved, which it should not have -- it was the same model both runs.",
];
const summary = lines.join("\n");
await writeFile(path.join(OUT, "summary.txt"), summary);
console.log(`\n${summary}\n\nwritten to ${OUT}`);
