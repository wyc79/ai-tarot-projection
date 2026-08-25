/**
 * Model-ceiling checkpoint: run one seeded session twice, varying only the model
 * that writes the reader's turns, and compare the transcripts.
 *
 *   TAROT_API_KEY=sk-... node scripts/model_checkpoint.mjs \
 *     --chat-a=deepseek-v4-flash --chat-b=deepseek-v4-pro --user=bracer
 *
 * Options: --user (scripted | a persona name in scripts/personas/, default
 *            bracer), --provider, --relay, --seed, --judge (held constant
 *            across both arms), --user-model (defaults to the judge model),
 *            --out (default ./checkpoint), --max-turns (default 14)
 *
 * Run the relay with DEV_LOG=1 so the assembled prompts are captured too.
 *
 * On the two user modes:
 *
 *   scripted  a fixed list of answers. Reproducible, free, and honest for one
 *             arm at a time only: the moment two arms ask different questions,
 *             the same canned answer is answering two different things. That is
 *             what left run B of 2026-08-25 hanging with its answers used up.
 *
 *   persona   a second model playing a consistent character, answering live.
 *             The arms become comparable, because each gets a user responding
 *             to what it actually asked. Costs more and is not bit-reproducible;
 *             that is the trade, and it is why scripted mode stays.
 *
 * This decides nothing on its own. It produces transcripts to read, and a
 * protocol scan that is absolute where the depth traces are not.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { makeLlmClient } from "../web/js/llmClient.js";
import { startReading } from "../web/js/engine/reading.js";
import { toJson, toMarkdown } from "../web/js/engine/journal.js";
import { formatFindings, levelTrace, scanSession, staircase } from "./scan.mjs";
import { ROOT, arg, loadPackFromDisk, preflightRelay, reportError, requireKey } from "./harness.mjs";

const KEY = requireKey();
const PROVIDER = arg("provider", "deepseek");
const RELAY = arg("relay", "http://127.0.0.1:8787");
const SEED = arg("seed", "moon-4f2a91");
const JUDGE = arg("judge", "deepseek-v4-flash");
const USER = arg("user", "bracer");
const USER_MODEL = arg("user-model", JUDGE);
const MAX_TURNS = Number(arg("max-turns", "14"));
const OUT = path.resolve(ROOT, arg("out", "checkpoint"));

/** The scripted mode's answers. One arm's worth; see the note above. */
const ANSWERS = [
  "yeah - whether I keep bracing for a fight nobody's having",
  "dunno",
  "it looks tired I guess",
  "my brother, and I haven't called him since March",
  "money, mostly",
  "if I spend it I have to admit I'm staying",
  "walking off, leaving the full ones behind",
  "lighter, maybe",
];

/**
 * A second model playing the same person in both arms.
 *
 * The whole transcript goes in as one user message rather than as alternating
 * roles: the simulated user is answering the reader, so the reader's turns are
 * not its own assistant turns, and swapping the roles round talks smaller models
 * into replying as the reader instead.
 */
function personaUser(persona, client) {
  const system = `${persona}

## Right now

Below is the conversation so far. Reply with your next message and nothing else
-- no quotation marks around it, no name in front of it, no explanation after
it. Keep it short, the way you talk.`;

  return async (transcript) => {
    const lines = transcript.map(({ who, text }) =>
      `${who === "reader" ? "The reader" : "You"}: ${text}`).join("\n\n");
    const answer = await client.chat({
      system,
      messages: [{ role: "user", content: `${lines}\n\nYou:` }],
    });
    return answer.trim().replace(/^["']|["']$/g, "");
  };
}

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

async function runOnce(pack, label, chatModel, nextAnswer) {
  const client = makeLlmClient({
    getKey: () => KEY,
    getConfig: () => ({ mode: "relay", relayBase: RELAY, provider: PROVIDER,
                        chatModel, judgeModel: JUDGE }),
  });
  const transcript = [];
  const reading = startReading({
    pack, client, seed: SEED,
    onEvent: (e) => { if (e.type === "reader_done") transcript.push({ who: "reader", text: e.text }); },
  });

  try {
    await reading.begin();
    await save(pack, label, chatModel, reading.session);
    for (let turn = 0; turn < MAX_TURNS; turn += 1) {
      if (reading.session.closed) break;
      const answer = await nextAnswer(transcript, turn);
      if (answer === null) break;    // scripted mode ran out of answers
      transcript.push({ who: "user", text: answer });
      process.stdout.write(`  ${turn + 1}. ${answer.replace(/\s+/g, " ").slice(0, 60)}\n`);
      await reading.say(answer);
      await save(pack, label, chatModel, reading.session);
    }
  } catch (error) {
    await save(pack, label, chatModel, reading.session);
    error.partial = reading.session;
    throw error;
  }
  return reading.session;
}

await preflightRelay(RELAY, PROVIDER);
const pack = await loadPackFromDisk();
await mkdir(OUT, { recursive: true });

let nextAnswer;
if (USER === "scripted") {
  nextAnswer = (_transcript, turn) => ANSWERS[turn] ?? null;
} else {
  const file = path.join(ROOT, "scripts", "personas", `${USER}.md`);
  let persona;
  try {
    persona = await readFile(file, "utf8");
  } catch {
    console.error(`No persona at ${file}. Pass --user=scripted, or add the file.`);
    process.exit(1);
  }
  const userClient = makeLlmClient({
    getKey: () => KEY,
    getConfig: () => ({ mode: "relay", relayBase: RELAY, provider: PROVIDER,
                        chatModel: USER_MODEL, judgeModel: USER_MODEL }),
  });
  nextAnswer = personaUser(persona, userClient);
}

const runs = [];
for (const label of ["a", "b"]) {
  const model = arg(`chat-${label}`, null);
  if (!model) {
    console.error(`--chat-${label}= is required`);
    process.exit(1);
  }
  console.log(`running ${label}: chat=${model} judge=${JUDGE} user=${USER}` +
              `${USER === "scripted" ? "" : ` (${USER_MODEL})`} seed=${SEED}`);
  let session;
  try {
    session = await runOnce(pack, label, model, nextAnswer);
  } catch (error) {
    reportError(error, error.code === "unknown_model" ? `model was: ${model}` : "");
    const turns = error.partial?.exchanges.length ?? 0;
    console.error(`\n${turns} completed turn${turns === 1 ? "" : "s"} saved to ` +
                  `${path.join(OUT, `${label}-${model}.md`)}`);
    process.exit(1);
  }
  runs.push({ label, model, session });
}

const lines = [
  `seed ${SEED}, judge ${JUDGE}, provider ${PROVIDER}, user ${USER}`,
  "",
  ...runs.flatMap(({ label, model, session }) => [
    `${label.toUpperCase()}  ${model}`,
    `   cards: ${session.cards.map((c) => c.card_id).join(", ")}`,
    `   depths: ${session.exchanges.map((e) => e.disclosure_depth).join(" ")}`,
    // question level / answer level per turn, by first letter. This is the
    // comparison that survives the arms diverging: how high the reader reached
    // and how high they were standing are both absolute readings of one turn.
    `   levels: ${levelTrace(session)}`,
    `   closed: ${session.closed}`,
    formatFindings("   protocol", scanSession(session, pack)).replace(/\n/g, "\n   "),
    "",
    staircase(session, pack).replace(/^/gm, "   "),
    "",
  ]),
  "Same cards is expected: the seed fixes them. The depth traces are NOT",
  "comparable across arms: depth is a verdict on an answer relative to the",
  "question it answered, so once the two conversations diverge the two traces",
  "are scoring different questions. Compare protocol findings, which are",
  "absolute, and so is the level trace: qa per turn, first letters of the",
  "question's level and the answer's. n<c<e<i<p. Use scripts/judge_replay.mjs",
  "to measure the judge itself.",
];
const summary = lines.join("\n");
await writeFile(path.join(OUT, "summary.txt"), summary);
console.log(`\n${summary}\n\nwritten to ${OUT}`);
