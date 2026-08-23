import { test } from "node:test";
import assert from "node:assert/strict";
import { RelayError, makeLlmClient } from "../../web/js/llmClient.js";
import { GATE_SCHEMA } from "../../web/js/engine/schemas.js";

const KEY = "sk-canary-do-not-store-me";

function sseResponse(chunks) {
  const stream = new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

const delta = (t) => `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: t } })}\n`;
const STOP = `data: ${JSON.stringify({ type: "message_stop" })}\n`;

function harness({ config = {}, respond }) {
  const calls = [];
  const debug = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : null });
    return respond(calls.length - 1);
  };
  const client = makeLlmClient({
    getKey: () => KEY,
    getConfig: () => ({ relayBase: "http://relay.test", ...config }),
    onDebug: (e) => debug.push(e),
  });
  return { client, calls, debug };
}

test("chat streams deltas and resolves with the whole turn", async () => {
  const { client } = harness({ respond: () => sseResponse([delta("Where does "), delta("your eye go?"), STOP]) });
  const seen = [];
  const full = await client.chat({ system: "s", messages: [], onDelta: (d) => seen.push(d) });
  assert.deepEqual(seen, ["Where does ", "your eye go?"]);
  assert.equal(full, "Where does your eye go?");
});

test("a delta split across chunk boundaries is not lost", async () => {
  const whole = delta("unbroken") + STOP;
  const { client } = harness({
    respond: () => sseResponse([whole.slice(0, 20), whole.slice(20, 45), whole.slice(45)]),
  });
  assert.equal(await client.chat({ system: "s", messages: [] }), "unbroken");
});

test("relay mode posts the RELAY.md shape with a bearer token", async () => {
  const { client, calls } = harness({ respond: () => sseResponse([STOP]) });
  await client.chat({ system: "s", messages: [{ role: "user", content: "hi" }] });
  assert.equal(calls[0].url, "http://relay.test/v1/chat");
  assert.deepEqual(Object.keys(calls[0].body).sort(), ["payload", "provider"]);
  assert.equal(calls[0].init.headers.authorization, `Bearer ${KEY}`);
  assert.equal(calls[0].body.payload.stream, true);
});

test("direct mode goes to the provider with its own auth header", async () => {
  const { client, calls } = harness({ config: { mode: "direct" }, respond: () => sseResponse([STOP]) });
  await client.chat({ system: "s", messages: [] });
  assert.equal(calls[0].url, "https://api.anthropic.com/v1/messages");
  assert.equal(calls[0].init.headers["x-api-key"], KEY);
  assert.equal(calls[0].init.headers["anthropic-dangerous-direct-browser-access"], "true");
  assert.equal(calls[0].init.headers.authorization, undefined, "direct mode must not send a bearer token");
  assert.equal(calls[0].body.provider, undefined, "direct mode sends the payload unwrapped");
});

test("the assembled payload reaches the debug panel before it is sent", async () => {
  const { client, debug } = harness({ respond: () => sseResponse([STOP]) });
  await client.chat({ system: "the persona prompt", messages: [{ role: "user", content: "hi" }] });
  assert.equal(debug.length, 1);
  assert.equal(debug[0].payload.system, "the persona prompt");
  assert.equal(JSON.stringify(debug[0]).includes(KEY), false, "the debug panel must never see the key");
});

test("a relay refusal is distinguished from a provider refusal", async () => {
  const { client } = harness({
    respond: () => new Response(JSON.stringify({ error: { code: "rate_limited", message: "too many" } }),
                               { status: 429, headers: { "X-Relay-Error": "1" } }),
  });
  await assert.rejects(client.chat({ system: "s", messages: [] }),
                       (e) => e instanceof RelayError && e.code === "rate_limited");
});

test("an upstream error is not labelled a relay error", async () => {
  const { client } = harness({
    respond: () => new Response(JSON.stringify({ error: { type: "overloaded_error", message: "busy" } }),
                                { status: 529 }),
  });
  await assert.rejects(client.chat({ system: "s", messages: [] }),
                       (e) => e.code === "provider_error" && /busy/.test(e.message));
});

test("judge returns the parsed object and is not streamed", async () => {
  const gate = { disclosure_depth: 2, flip_ready: true, stakes: "low", reading_of_them: "they said stuck" };
  const { client, calls } = harness({
    respond: () => new Response(JSON.stringify({
      stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(gate) }],
    }), { status: 200 }),
  });
  const result = await client.judge({ system: "s", messages: [], schema: GATE_SCHEMA });
  assert.deepEqual(result, gate);
  assert.equal(calls[0].body.payload.stream, undefined, "judge must not stream");
  assert.equal(calls[0].body.payload.output_config.format.type, "json_schema");
});

test("a refusal is caught even though it arrives as HTTP 200", async () => {
  const { client } = harness({
    respond: () => new Response(JSON.stringify({ stop_reason: "refusal", stop_details: { category: "cyber" }, content: [] }),
                                { status: 200 }),
  });
  await assert.rejects(client.judge({ system: "s", messages: [], schema: GATE_SCHEMA }), /declined/);
});

test("truncated structured output is an error, not a silent half-object", async () => {
  const { client } = harness({
    respond: () => new Response(JSON.stringify({ stop_reason: "max_tokens", content: [{ type: "text", text: '{"disc' }] }),
                                { status: 200 }),
  });
  await assert.rejects(client.judge({ system: "s", messages: [], schema: GATE_SCHEMA }), /max_tokens/);
});

test("a missing key fails before any request is made", async () => {
  globalThis.fetch = async () => { throw new Error("should not be called"); };
  const client = makeLlmClient({ getKey: () => "", getConfig: () => ({}) });
  await assert.rejects(client.chat({ system: "s", messages: [] }),
                       (e) => e.code === "missing_key");
});

test("the client object does not hold the key anywhere", async () => {
  const { client } = harness({ respond: () => sseResponse([STOP]) });
  await client.chat({ system: "s", messages: [] });
  assert.equal(JSON.stringify(Object.values(client).map(String)).includes(KEY), false);
});
