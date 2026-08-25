/**
 * Judge determinism: replay judge() N times on frozen, identical inputs.
 *
 *   TAROT_API_KEY=sk-... node scripts/judge_replay.mjs checkpoint/*.json
 *
 * Options: --runs (default 5), --judge (model, default deepseek-v4-flash),
 *          --provider, --relay
 *
 * The A/B checkpoint could not answer "is the judge stable?" because the two
 * arms' conversations diverged: by turn five they were scoring different
 * questions, so a depth of 4 in one and 1 in the other was two correct verdicts,
 * not one wrong one. This asks the narrower question the A/B run cannot.
 *
 * Every call for a given turn is byte-identical -- same system prompt, same
 * message, same schema -- rebuilt from the saved transcript rather than from a
 * live session. Anything that moves between runs moved on its own.
 */

import { readFile } from "node:fs/promises";
import { makeLlmClient } from "../web/js/llmClient.js";
import { JUDGE_SYSTEM, judgeMessages } from "../web/js/engine/prompts.js";
import { gateSchema } from "../web/js/engine/schemas.js";
import { questionType } from "../web/js/engine/questions.js";
import { arg, loadPackFromDisk, preflightRelay, reportError, requireKey } from "./harness.mjs";

const KEY = requireKey();
const RUNS = Number(arg("runs", "5"));
const JUDGE = arg("judge", "deepseek-v4-flash");
const PROVIDER = arg("provider", "deepseek");
const RELAY = arg("relay", "http://127.0.0.1:8787");

const files = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!files.length) {
  console.error("usage: TAROT_API_KEY=sk-... node scripts/judge_replay.mjs <session.json> [...]");
  process.exit(1);
}

await preflightRelay(RELAY, PROVIDER);
const pack = await loadPackFromDisk();
const GATE_SCHEMA = gateSchema(pack);
const client = makeLlmClient({
  getKey: () => KEY,
  getConfig: () => ({ mode: "relay", relayBase: RELAY, provider: PROVIDER, judgeModel: JUDGE }),
});

/**
 * The judge input for one recorded exchange, rebuilt exactly.
 *
 * judgeMessages reads only the card currently face up, so a stub session
 * carrying that one card reproduces the original message verbatim -- no need to
 * replay the whole session forward to get there.
 */
function frozenInput(session, exchange) {
  const card = session.cards.find((c) => c.position === exchange.position);
  const stub = { cards: card ? [{ card_id: card.card_id, position: card.position }] : [] };
  return judgeMessages(pack, stub, { question: exchange.q, answer: exchange.a });
}

/** How much a set of verdicts disagreed with itself. */
function spread(values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return {
    unanimous: sorted.length === 1,
    mode: sorted[0][0],
    detail: sorted.map(([v, n]) => `${v}×${n}`).join(" "),
  };
}

for (const file of files) {
  const parsed = JSON.parse(await readFile(file, "utf8"));
  const session = parsed.session ?? parsed;
  const scored = session.exchanges.filter((e) => e.position !== "opening" && e.position !== "off_frame");

  console.log(`\n${file}`);
  console.log(`  ${scored.length} turns × ${RUNS} runs = ${scored.length * RUNS} judge calls, model ${JUDGE}\n`);

  let unstable = 0;
  for (const [index, exchange] of scored.entries()) {
    const messages = frozenInput(session, exchange);
    const verdicts = [];
    for (let run = 0; run < RUNS; run += 1) {
      // Progress on stderr: the report on stdout is meant to be piped somewhere.
      process.stderr.write(`  turn ${index + 1}/${scored.length} run ${run + 1}/${RUNS}\r`);
      try {
        verdicts.push(await client.judge({ system: JUDGE_SYSTEM, messages, schema: GATE_SCHEMA }));
      } catch (error) {
        reportError(error, `turn ${index + 1}, run ${run + 1}`);
        process.exit(1);
      }
    }

    const depth = spread(verdicts.map((v) => v.disclosure_depth));
    const stakes = spread(verdicts.map((v) => v.stakes));
    const kind = questionType(exchange.q);
    const recorded = exchange.disclosure_depth;
    const drifted = !depth.unanimous || !stakes.unanimous;
    if (drifted) unstable += 1;

    console.log(`  turn ${index + 1}  ${exchange.position}/${kind}  ` +
                `depth ${depth.detail}${depth.unanimous ? "" : "  <-- moved"}` +
                `${stakes.unanimous ? "" : `  stakes ${stakes.detail}  <-- moved`}`);
    console.log(`    recorded ${recorded}${recorded === depth.mode ? "" : `, replays say ${depth.mode}`}`
                + `   "${String(exchange.a).replace(/\s+/g, " ").slice(0, 60)}"`);
  }

  console.log(`\n  ${scored.length - unstable}/${scored.length} turns unanimous across ${RUNS} runs`);
  if (unstable) {
    console.log("  A turn that moves on identical input is the judge itself. A turn that");
    console.log("  is unanimous but disagrees with what was recorded is a prompt change");
    console.log("  since that session ran, which is the expected reading of this line.");
  }
}
