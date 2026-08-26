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
const RUNS = Number(arg("runs", "1"));

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
  // What shipped before 2026-08-25: the schema with all its descriptions, which
  // is 2.8 KB of rubric the system prompt has already given at greater length.
  ["the full schema echoed, descriptions and all", (p) => ({
    ...p,
    system: `${JUDGE_SYSTEM}\n\n## Output\n\nReturn one JSON object and nothing else -- no `
      + `prose before it, no code fence around it. It must match this schema exactly:\n\n`
      + `${JSON.stringify(schema, null, 2)}`,
  })],
  ["the field list in prose, no schema at all", (p) => ({
    ...p,
    system: `${JUDGE_SYSTEM}\n\n## Output\n\nReturn one JSON object and nothing else. `
      + `Keys: disclosure_depth (1-4), has_life_content (boolean), hedged (boolean), `
      + `user_level (one of ${pack.levels.map((l) => l.id).join(", ")}), `
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
    // Parsing is not complying. A model that echoed the schema back rather than
    // filling it in returns an object with none of these keys in it, and
    // reporting that as "ok" is how this went unnoticed the first time.
    const missing = schema.required.filter((key) => parsed?.[key] === undefined);
    if (missing.length) {
      return { verdict: "NOT A GATE", note: `${spent} tokens, no ${missing.join(", ")}` };
    }
    return {
      verdict: "ok",
      note: `${spent} tokens, depth ${parsed.disclosure_depth} level ${parsed.user_level}`,
    };
  } catch (error) {
    // readText's truncation error already carries the diagnosis.
    return { verdict: error.code ?? "unreadable", note: error.message };
  }
}

const WIDTH = Math.max(...VARIANTS.map(([label]) => label.length));
console.log(`probing ${PROVIDER}/${JUDGE} on one frozen judge call, ${VARIANTS.length} ways`
            + `${RUNS > 1 ? `, ${RUNS} runs each` : ""}\n`);
const base = ANTHROPIC.judgePayload({ model: JUDGE, system: JUDGE_SYSTEM, messages, schema, features });

for (const [label, vary] of VARIANTS) {
  for (let run = 0; run < RUNS; run += 1) {
    process.stderr.write(`  ${label} ${run + 1}/${RUNS}...\r`);
    const { verdict, note } = await send(vary({ ...base }));
    console.log(`  ${(run ? "" : label).padEnd(WIDTH)}  ${verdict}`);
    if (note) console.log(`  ${" ".repeat(WIDTH)}  ${note.replace(/\s+/g, " ").slice(0, 150)}`);
  }
}

console.log(`
Read the token counts, not just the verdicts. A variant that answers in 70
tokens and one that answers in 5600 are both "ok" and only one of them is the
judge doing rubric classification.

NOT A GATE is the quiet failure: it parsed as JSON and has none of the fields,
which is what a model does when it echoes the schema instead of filling it in.

--runs=5 is worth it before concluding anything. One sample per variant is what
a coincidence looks like.`);
