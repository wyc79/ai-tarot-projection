/**
 * Draw the graph from itself, and record what it does with each scenario.
 *
 *   node scripts/draw_graph.mjs           write README.md's graph block and web/graph-scenarios.json
 *   node scripts/draw_graph.mjs --check   regenerate both in memory and diff; exit 1 if either is stale
 *
 * Both outputs are cached renders of the code, not a second definition of
 * anything. The README block is drawMermaid() of the compiled graph; the
 * scenarios file is the real engine, run with a scripted judge, reporting
 * which nodes each turn visited. --check is a leg of scripts/test.sh, so a
 * node added without redrawing, or an engine change that moves a path, fails
 * the suite until this is re-run.
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPack } from "../web/js/pack.js";
import { buildGraph } from "../web/js/engine/graph.js";
import { MEANINGS_REQUEST, startReading } from "../web/js/engine/reading.js";
import { SEED, fileFetch } from "./lib/seeded.mjs";
import { SCENARIOS } from "./lib/scenarios.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const README = path.join(ROOT, "README.md");
const SCENARIOS_OUT = path.join(ROOT, "web", "graph-scenarios.json");
const BEGIN = "<!-- graph:begin -->";
const END_MARK = "<!-- graph:end -->";

// The anchor every scenario gets when the reading commits one. Its content is
// not what the scenarios show, so one will do.
const ANCHOR = {
  theme: "bracing for a fight nobody's having",
  user_phrases: [
    { phrase: "bracing for a fight nobody's having", source: "life" },
    { phrase: "haven't called him since March", source: "life" },
  ],
  resolution_beat: "whether the bracing is still protecting anything, or has outlived whatever it was for",
};

/** A stand-in for the model that answers the judge from the scenario's script. */
function scenarioClient(scenario) {
  const client = {
    gate: null,
    async chat({ kind, onDelta = () => {} }) {
      const text = `[${kind}]`;
      onDelta(text, text);
      return text;
    },
    async judge({ kind }) {
      if (kind === "opening") return scenario.opening;
      if (kind === "anchor") return ANCHOR;
      if (!client.gate) throw new Error(`scenario "${scenario.id}" reached the gate without a scripted verdict`);
      return client.gate;
    },
  };
  return client;
}

async function record(pack, scenario) {
  const client = scenarioClient(scenario);
  let trace = [];
  const events = [];
  const reading = startReading({
    pack, client, seed: SEED,
    onEvent: (e) => { events.push(e); if (e.type === "node") trace.push(e.node); },
  });
  await reading.begin();

  let last = null;
  let result = null;
  for (const turn of scenario.turns) {
    if (turn.action === "stayAWhile") { reading.stayAWhile(); continue; }
    trace = [];
    events.length = 0;
    last = turn;
    if (turn.action === "meanings") {
      result = await reading.meanings();
    } else {
      client.gate = turn.gate ?? null;
      result = await reading.say(turn.answer);
    }
    if (scenario.until && reading.session[scenario.until]) break;
  }
  if (scenario.until && !reading.session[scenario.until]) {
    throw new Error(`scenario "${scenario.id}" ran out of turns before the session was ${scenario.until}`);
  }

  const nodes = ["__start__", ...trace, "__end__"];
  const edges = nodes.slice(1).map((to, i) => [nodes[i], to]);
  // The engine's own reason where it gives one. The two branches that do not
  // -- the opening turn, dealt or dropped -- are described in its words.
  const reason = result?.decision?.reason
    ?? (result?.dealt ? events.find((e) => e.type === "flip").reason
                      : "the frame was dropped: safety outranks the rhythm, and no card is dealt");
  const verdict = "gate" in last ? last.gate : last.action ? null : scenario.opening;
  return {
    id: scenario.id, title: scenario.title, blurb: scenario.blurb,
    answer: last.action === "meanings" ? MEANINGS_REQUEST : last.answer,
    verdict, nodes, edges, reason,
  };
}

async function generate() {
  const { graph } = buildGraph();
  const mermaid = (await graph.getGraphAsync()).drawMermaid().trimEnd();
  const pack = await loadPack("data", { fetchImpl: fileFetch });
  const scenarios = [];
  for (const scenario of SCENARIOS) scenarios.push(await record(pack, scenario));
  const json = `${JSON.stringify({ generated_by: "scripts/draw_graph.mjs", scenarios }, null, 2)}\n`;
  return { mermaid, json };
}

function withBlock(readme, mermaid) {
  const begin = readme.indexOf(BEGIN);
  const end = readme.indexOf(END_MARK);
  if (begin < 0 || end < 0 || end < begin) {
    throw new Error(`README.md needs the markers ${BEGIN} and ${END_MARK}, in that order`);
  }
  const block = `${BEGIN}\n\`\`\`mermaid\n${mermaid}\n\`\`\`\n`;
  return readme.slice(0, begin) + block + readme.slice(end);
}

const check = process.argv.includes("--check");
const { mermaid, json } = await generate();
const readme = withBlock(await readFile(README, "utf8"), mermaid);

if (check) {
  const stale = [];
  if (readme !== await readFile(README, "utf8")) stale.push("README.md graph block");
  if (json !== await readFile(SCENARIOS_OUT, "utf8").catch(() => "")) stale.push("web/graph-scenarios.json");
  if (stale.length) {
    console.error(`stale: ${stale.join(", ")}. Run: node scripts/draw_graph.mjs`);
    process.exit(1);
  }
  console.log("README graph block and web/graph-scenarios.json are current");
} else {
  await writeFile(README, readme);
  await writeFile(SCENARIOS_OUT, json);
  console.log(`wrote README.md graph block (${mermaid.split("\n").length} lines) and `
    + `web/graph-scenarios.json (${SCENARIOS.length} scenarios)`);
}
