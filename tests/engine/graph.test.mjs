/**
 * The reading as a LangGraph graph.
 *
 * The first test is a smoke test on the vendored bundle: it must load from a
 * relative path with no package on the import path, and it must never reach
 * for the network. Everything after it is about the graph the engine builds.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Annotation, END, START, StateGraph } from "../../web/vendor/langgraph.js";
import { buildGraph } from "../../web/js/engine/graph.js";
import { TURN_KINDS } from "../../web/js/engine/prompts.js";
import { startReading } from "../../web/js/engine/reading.js";
import { declines, fakeClient, gate, realPack, wants } from "./helpers.mjs";

test("the vendored LangGraph runs a two-node graph without touching fetch", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("the graph runtime reached for the network"); };
  try {
    const S = Annotation.Root({ x: Annotation() });
    const g = new StateGraph(S)
      .addNode("a", async () => ({ x: 1 }))
      .addNode("b", async (s) => ({ x: s.x + 1 }))
      .addEdge(START, "a").addEdge("a", "b").addEdge("b", END)
      .compile();
    assert.deepEqual(await g.invoke({}), { x: 2 });
  } finally {
    globalThis.fetch = realFetch;
  }
});

const EXPECTED_MMD = new URL("../../.claude/plans/2026-09-16-langgraph-engine-expected.mmd", import.meta.url);
const sortedLines = (text) => text.split("\n").map((l) => l.trimEnd()).filter(Boolean).sort();
const REAL = (name) => name !== "__start__" && name !== "__end__";

test("the compiled graph draws exactly the picture the design expected", async () => {
  const { graph } = buildGraph();
  const drawn = (await graph.getGraphAsync()).drawMermaid();
  assert.deepEqual(sortedLines(drawn), sortedLines(await readFile(EXPECTED_MMD, "utf8")));
});

test("every reader turn kind is a node of that name, and no node pretends to be one it is not", async () => {
  const { graph } = buildGraph();
  const names = Object.keys((await graph.getGraphAsync()).nodes).filter(REAL);
  for (const kind of TURN_KINDS) assert.ok(names.includes(kind), `no node for the ${kind} turn`);
  // The nodes that are not turns are the judgements, the ledger writes, the
  // flips and the anchor: a closed list, so a stray one is caught.
  const machinery = ["judge_opening", "judge_gate", "off_frame", "aside", "exchange", "tail",
                     "decide", "commit_anchor", "flip", "flip_epilogue", "revise_anchor"];
  assert.deepEqual(names.filter((n) => !TURN_KINDS.includes(n)).sort(), machinery.sort());
});

test("every node and every edge label carries a note, and nothing else does", async () => {
  const { graph, notes } = buildGraph();
  const shape = (await graph.getGraphAsync()).toJSON();
  const nodeNames = shape.nodes.map((n) => n.id).filter(REAL).sort();
  assert.deepEqual(Object.keys(notes.nodes).sort(), nodeNames);
  const labels = [...new Set(shape.edges.filter((e) => e.conditional).map((e) => e.data))].sort();
  assert.deepEqual(Object.keys(notes.keys).sort(), labels);
  for (const [name, note] of [...Object.entries(notes.nodes), ...Object.entries(notes.keys)]) {
    assert.ok(typeof note === "string" && note.length > 20, `the note on ${name} is not a sentence`);
  }
});

const SEED = "moon-4f2a91";
const nodesVisited = (events) => events.filter((e) => e.type === "node").map((e) => e.node);

async function reading({ gates, opening = declines, reply } = {}) {
  const pack = await realPack();
  const client = fakeClient({ gates, opening, ...(reply ? { reply } : {}) });
  const events = [];
  const r = startReading({ pack, client, seed: SEED, onEvent: (e) => events.push(e) });
  await r.begin();
  return { r, events, client };
}

test("a turn reports the nodes it visited, in order, as node events", async () => {
  const { r, events } = await reading({ gates: [gate(1)] });
  await r.say("no, nothing in particular");
  assert.deepEqual(nodesVisited(events), ["judge_opening", "flip", "invite"]);
  events.length = 0;
  await r.say("dunno");
  assert.deepEqual(nodesVisited(events), ["judge_gate", "exchange", "decide", "respond", "revise_anchor"]);
});

test("the node event for a node comes after the events that node emitted", async () => {
  const { r, events } = await reading({ gates: [gate(1)] });
  await r.say("no, nothing in particular");
  await r.say("dunno");
  const types = events.map((e) => (e.type === "node" ? `node:${e.node}` : e.type));
  assert.ok(types.indexOf("gate") < types.indexOf("node:exchange"), "exchange's gate event precedes its node event");
  assert.ok(types.indexOf("flip_decision") < types.indexOf("node:decide"));
});

test("a reader that throws rejects say() with that same error, unwrapped", async () => {
  const { r } = await reading({
    gates: [gate(1)],
    reply: () => { throw new Error("upstream said no"); },
  });
  await assert.rejects(r.say("no, nothing in particular"), (error) => {
    assert.equal(error.message, "upstream said no");
    assert.equal(error.constructor, Error);
    return true;
  });
});

test("a whole seeded reading runs with the network unreachable", async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = () => { calls += 1; throw new Error("the graph runtime reached for the network"); };
  try {
    const { r } = await reading({
      gates: Array.from({ length: 16 }, () => gate(3)),
      opening: wants("whether I keep bracing for a fight nobody's having"),
    });
    await r.say("yeah, that");
    for (let i = 0; i < 16 && !r.session.ended; i += 1) await r.say(`answer ${i}`);
    assert.equal(r.session.closed, true);
    assert.equal(r.session.ended, true);
    assert.equal(calls, 0, "something in the graph runtime called fetch");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("and it stays unreachable when a shell has LangSmith switched on", async () => {
  // The tracer inside the vendored bundle reads process.env in Node. The
  // bundle is built with process.env defined away, so these do nothing; if
  // a re-vendor ever loses that flag, this is the test that says so.
  const saved = { ...process.env };
  Object.assign(process.env, {
    LANGSMITH_TRACING: "true", LANGCHAIN_TRACING_V2: "true",
    LANGSMITH_API_KEY: "lsv2_canary_not_a_real_key", LANGCHAIN_API_KEY: "lsv2_canary_not_a_real_key",
  });
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = () => { calls += 1; throw new Error("the graph runtime reached for the network"); };
  try {
    const { r } = await reading({ gates: Array.from({ length: 16 }, () => gate(3)),
                                  opening: wants("whether I keep bracing for a fight nobody's having") });
    await r.say("yeah, that");
    for (let i = 0; i < 16 && !r.session.ended; i += 1) await r.say(`answer ${i}`);
    assert.equal(r.session.ended, true);
    assert.equal(calls, 0, "the tracer switched itself on from the environment");
  } finally {
    globalThis.fetch = realFetch;
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});

const SCENARIOS_FILE = new URL("../../web/graph-scenarios.json", import.meta.url);
const edgeKey = ([from, to]) => `${from} -> ${to}`;

test("the recorded scenarios cross every edge of the compiled graph, and no other", async () => {
  const { graph } = buildGraph();
  const drawn = (await graph.getGraphAsync()).toJSON().edges.map((e) => edgeKey([e.source, e.target]));
  const { scenarios } = JSON.parse(await readFile(SCENARIOS_FILE, "utf8"));
  const crossed = new Set(scenarios.flatMap((s) => s.edges.map(edgeKey)));
  assert.deepEqual([...crossed].sort(), [...new Set(drawn)].sort());
  for (const s of scenarios) {
    assert.equal(s.nodes[0], "__start__", `${s.id} does not start at START`);
    assert.equal(s.nodes.at(-1), "__end__", `${s.id} does not reach END`);
    assert.ok(typeof s.reason === "string" && s.reason.length > 0, `${s.id} has no reason`);
    assert.ok(typeof s.answer === "string" && s.answer.length > 0, `${s.id} has no answer`);
  }
});
