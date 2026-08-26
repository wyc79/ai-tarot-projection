/**
 * Why a judge call is burning its whole output budget and returning no JSON.
 *
 *   TAROT_API_KEY=sk-... node scripts/judge_probe.mjs
 *
 * Options: --provider (default deepseek), --judge (model), --relay,
 *          --card, --question, --answer  (default: the Ten of Pentacles turn
 *          that truncated at 8192 on deepseek-v4-flash)
 *
 * response_truncated says the model generated max_tokens worth of something and
 * none of it closed the object. It does not say what the something was, and the
 * three candidates want three different fixes:
 *
 *   thinking     it deliberated. Fix: turn thinking off, or cap its budget.
 *   a loop       greedy decoding got stuck. Fix: stop pinning temperature to 0.
 *   the schema   a big nested schema in the prompt is a big nested thing to
 *                echo. Fix: ask for the fields in prose.
 *
 * So this sends the same frozen input several times, varying one thing at a
 * time, and prints what came back. It is not a test: it spends real tokens and
 * needs a real key, because a stand-in would answer the wrong question.
 */

import { JUDGE_SYSTEM, judgeMessages } from "../web/js/engine/prompts.js";
import { gateSchema } from "../web/js/engine/schemas.js";
import { ANTHROPIC } from "../web/js/providers/anthropic.js";
import { PROVIDERS } from "../web/js/providers/index.js";
import { arg, loadPackFromDisk, preflightRelay, requireKey } from "./harness.mjs";

const KEY = requireKey();
const PROVIDER = arg("provider", "deepseek");
const RELAY = arg("relay", "http://127.0.0.1:8787");
const JUDGE = arg("judge", PROVIDERS[PROVIDER]?.defaultModel ?? "deepseek-v4-flash");

// The turn that failed, so the probe is run against the thing being diagnosed
// rather than against something easier.
const CARD = arg("card", "pentacles-10-ten");
const QUESTION = arg("question",
  "The Ten of Pentacles lands in the situation spot — where things stand right now. "
  + "When you look at it, where does your eye go first?");
const ANSWER = arg("answer",
  "the arrangement of the ten coins seems bit random, somebody discussing in the "
  + "background, seems unrelated the foreground and background");

if (!PROVIDERS[PROVIDER]) {
  console.error(`unknown provider ${PROVIDER}; one of ${Object.keys(PROVIDERS).join(", ")}`);
  process.exit(1);
}

await preflightRelay(RELAY, PROVIDER);
const pack = await loadPackFromDisk();
const schema = gateSchema(pack);
const stub = { cards: [{ card_id: CARD, position: "situation" }] };
const messages = judgeMessages(pack, stub, { question: QUESTION, answer: ANSWER });
const features = PROVIDERS[PROVIDER].features;

/** The shipped payload, then one variant per hypothesis. */
const VARIANTS = [
  ["as shipped", (p) => p],
  ["thinking not mentioned at all", (p) => ({ ...p, thinking: undefined })],
  ["thinking capped rather than disabled",
    (p) => ({ ...p, thinking: { type: "enabled", budget_tokens: 1024 } })],
  ["no temperature pin", (p) => ({ ...p, temperature: undefined })],
  ["ceiling at 1024, to see it fail sooner", (p) => ({ ...p, max_tokens: 1024 })],
  ["the field list in prose, no schema echoed", (p) => ({
    ...p,
    system: `${JUDGE_SYSTEM}\n\n## Output\n\nReturn one JSON object and nothing else. `
      + `Keys: disclosure_depth (1-4), has_life_content (boolean), hedged (boolean), `
      + `user_level (one of name, consequences, evaluate, intentions, plans), `
      + `stakes (one of low, high, crisis), reading_of_them (one sentence).`,
  })],
];

/** Strip undefined so "not mentioned" means not on the wire. */
const clean = (payload) =>
  Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined));

async function send(payload) {
  const response = await fetch(`${RELAY.replace(/\/$/, "")}/v1/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ provider: PROVIDER, payload: clean(payload) }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    return { verdict: `HTTP ${response.status}`, note: body?.error?.message ?? "" };
  }
  const spent = body?.usage?.output_tokens ?? "?";
  try {
    const text = ANTHROPIC.readText(body);
    const parsed = ANTHROPIC.extractJson(text);
    return { verdict: "ok", note: `${spent} tokens, depth ${parsed.disclosure_depth}` };
  } catch (error) {
    // readText's truncation error already carries the diagnosis.
    return { verdict: error.code ?? "unreadable", note: error.message };
  }
}

console.log(`probing ${PROVIDER}/${JUDGE} on one frozen judge call, ${VARIANTS.length} ways\n`);
const base = ANTHROPIC.judgePayload({ model: JUDGE, system: JUDGE_SYSTEM, messages, schema, features });

for (const [label, vary] of VARIANTS) {
  process.stderr.write(`  ${label}...\r`);
  const { verdict, note } = await send(vary({ ...base }));
  console.log(`  ${label.padEnd(38)} ${verdict}`);
  if (note) console.log(`  ${" ".repeat(38)} ${note.replace(/\s+/g, " ").slice(0, 150)}`);
}

console.log(`
The first line that says "ok" names the fix. If every line truncates with
blocks [thinking], nothing on this gateway turns deliberation off and the judge
needs a different model. If the prose-schema line is the only one that works,
the gate schema is what it is choking on and gateSchema wants trimming.`);
