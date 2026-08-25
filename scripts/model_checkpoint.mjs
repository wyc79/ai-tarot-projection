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
import { formatFindings, scanSession } from "./scan.mjs";

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

/**
 * Write what exists so far. Called after every turn: these runs cost real money
 * and take real minutes, and a run that dies on turn six should not also throw
 * away the five turns that worked -- those are the ones worth reading.
 */
async function save(pack, label, model, session) {
  const stem = path.join(OUT, `${label}-${model}`);
  await writeFile(`${stem}.md`, toMarkdown(pack, session));
  await writeFile(`${stem}.json`, toJson(session));
}

async function runOnce(pack, label, chatModel) {
  const client = makeLlmClient({
    getKey: () => KEY,
    getConfig: () => ({ mode: "relay", relayBase: RELAY, provider: PROVIDER,
                        chatModel, judgeModel: JUDGE }),
  });
  const reading = startReading({ pack, client, seed: SEED });
  try {
    await reading.begin();
    await save(pack, label, chatModel, reading.session);
    for (const [i, answer] of ANSWERS.entries()) {
      if (reading.session.closed) break;
      await reading.say(answer);
      await save(pack, label, chatModel, reading.session);
      process.stdout.write(`  turn ${i + 1}/${ANSWERS.length}\r`);
    }
  } catch (error) {
    await save(pack, label, chatModel, reading.session);
    error.partial = reading.session;
    throw error;
  }
  return reading.session;
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
  let session;
  try {
    session = await runOnce(pack, label, model);
  } catch (error) {
    // A stack trace is the wrong shape for this: the failures worth reporting
    // here are a bad key or a model id the provider does not have.
    console.error(`\n${error.code ?? "error"}: ${error.message}`);
    if (error.hint) console.error(`  ${error.hint}`);
    if (error.code === "unknown_model") console.error(`  model was: ${model}`);
    const turns = error.partial?.exchanges.length ?? 0;
    console.error(`\n${turns} completed turn${turns === 1 ? "" : "s"} saved to ` +
                  `${path.join(OUT, `${label}-${model}.md`)}`);
    process.exit(1);
  }
  await writeFile(path.join(OUT, `${label}-${model}.md`), toMarkdown(pack, session));
  await writeFile(path.join(OUT, `${label}-${model}.json`), toJson(session));
  runs.push({ label, model, session });
}

const lines = [
  `seed ${SEED}, judge ${JUDGE}, provider ${PROVIDER}`,
  "",
  ...runs.flatMap(({ label, model, session }) => [
    `${label.toUpperCase()}  ${model}`,
    `   cards: ${session.cards.map((c) => c.card_id).join(", ")}`,
    `   depths: ${session.exchanges.map((e) => e.disclosure_depth).join(" ")}`,
    `   closed: ${session.closed}`,
    formatFindings("   protocol", scanSession(session)).replace(/\n/g, "\n   "),
    "",
  ]),
  "Same cards is expected: the seed fixes them. The depth traces are NOT",
  "comparable across arms: depth is a verdict on an answer relative to the",
  "question it answered, so once the two conversations diverge the two traces",
  "are scoring different questions. Compare protocol findings, which are",
  "absolute. Use scripts/judge_replay.mjs to measure the judge itself.",
];
const summary = lines.join("\n");
await writeFile(path.join(OUT, "summary.txt"), summary);
console.log(`\n${summary}\n\nwritten to ${OUT}`);
