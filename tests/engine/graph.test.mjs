/**
 * The reading as a LangGraph graph.
 *
 * The first test is a smoke test on the vendored bundle: it must load from a
 * relative path with no package on the import path, and it must never reach
 * for the network. Everything after it is about the graph the engine builds.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Annotation, END, START, StateGraph } from "../../web/vendor/langgraph.js";

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
