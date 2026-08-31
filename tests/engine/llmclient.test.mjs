import { test } from "node:test";
import assert from "node:assert/strict";
import { RelayError, makeLlmClient } from "../../web/js/llmClient.js";

/**
 * A stand-in for a judge schema. This file tests the client, not the engine:
 * the engine's gate schema is now built from pack data, and loading a pack here
 * would couple the transport tests to the deck.
 */
const GATE_SCHEMA = {
  type: "object",
  properties: {
    disclosure_depth: { type: "integer", enum: [1, 2, 3, 4] },
    stakes: { type: "string", enum: ["low", "high", "crisis"] },
    reading_of_them: { type: "string" },
  },
  required: ["disclosure_depth", "stakes", "reading_of_them"],
  additionalProperties: false,
};

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
  const { client, calls } = harness({
    config: { mode: "direct", provider: "anthropic" }, respond: () => sseResponse([STOP]),
  });
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
                       (e) => e.code === "provider_unavailable" && /busy/.test(e.message));
});

test("failures are told apart, because they need different fixes", async () => {
  const cases = [
    [401, "Invalid API key.", "invalid_key"],
    [403, "forbidden", "invalid_key"],
    // An empty account is not a wrong key, whichever status it arrives under.
    [401, "Insufficient balance. Manage your billing here: https://x.test/billing",
     "insufficient_balance"],
    [402, "Insufficient Balance", "insufficient_balance"],
    [429, "quota exceeded for this minute", "provider_rate_limited"],
    [400, "Model Not Exist", "unknown_model"],
    [404, "no route", "endpoint_not_found"],
    [429, "slow down", "provider_rate_limited"],
    [503, "overloaded", "provider_unavailable"],
    [400, "unexpected parameter: output_config", "bad_payload"],
  ];
  for (const [status, message, expected] of cases) {
    const { client } = harness({
      respond: () => new Response(JSON.stringify({ error: { message } }), { status }),
    });
    await assert.rejects(client.chat({ system: "s", messages: [] }), (e) => {
      assert.equal(e.code, expected, `${status} "${message}" should be ${expected}, got ${e.code}`);
      assert.ok(e.message.includes(message), "the provider's own words are kept");
      return true;
    });
  }
});

test("an empty balance does not send them back to the key field", async () => {
  const { client } = harness({
    respond: () => new Response(
      JSON.stringify({ error: { message: "Insufficient balance. Manage your billing here: https://x.test" } }),
      { status: 401 }),
  });
  await assert.rejects(client.chat({ system: "s", messages: [] }), (e) => {
    assert.equal(e.code, "insufficient_balance");
    assert.doesNotMatch(e.hint, /check the key/,
                        "the hint pointed at the one thing that was not wrong");
    return true;
  });
});

test("a request that never completed is a connection failure, not a bad key", async () => {
  globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };
  const client = makeLlmClient({ getKey: () => KEY, getConfig: () => ({ relayBase: "http://relay.test" }) });
  await assert.rejects(client.chat({ system: "s", messages: [] }), (e) => {
    assert.equal(e.code, "connection_failed");
    assert.match(e.hint, /relay running/);
    return true;
  });
});

test("an abort is not disguised as a connection failure", async () => {
  globalThis.fetch = async () => { const e = new Error("aborted"); e.name = "AbortError"; throw e; };
  const client = makeLlmClient({ getKey: () => KEY, getConfig: () => ({ relayBase: "http://relay.test" }) });
  await assert.rejects(client.chat({ system: "s", messages: [] }), (e) => e.name === "AbortError");
});

const GATE = { disclosure_depth: 3, stakes: "low", reading_of_them: "they said stuck" };
const judgeReply = (text) => new Response(JSON.stringify({
  stop_reason: "end_turn", content: [{ type: "text", text }],
}), { status: 200 });

test("judge returns the parsed object and is not streamed", async () => {
  const { client, calls } = harness({
    config: { provider: "anthropic" }, respond: () => judgeReply(JSON.stringify(GATE)),
  });
  const result = await client.judge({ system: "s", messages: [], schema: GATE_SCHEMA });
  assert.deepEqual(result, GATE);
  assert.equal(calls[0].body.payload.stream, undefined, "judge must not stream");
  assert.equal(calls[0].body.payload.output_config.format.type, "json_schema");
});

test("a gateway gets the plain Messages shape and nothing newer", async () => {
  const { client, calls } = harness({
    config: { provider: "deepseek" }, respond: () => sseResponse([STOP]),
  });
  await client.chat({ system: "s", messages: [] });
  const payload = calls[0].body.payload;
  assert.equal(calls[0].body.provider, "deepseek", "the relay is told which entry to use");
  assert.equal(payload.thinking, undefined, "gateways have not heard of adaptive thinking");
  assert.equal(payload.output_config, undefined, "nor of effort");
  assert.deepEqual(Object.keys(payload).sort(), ["max_tokens", "messages", "model", "stream", "system"]);
});

test("without native structured output the schema goes in the prompt instead", async () => {
  const { client, calls } = harness({
    config: { provider: "deepseek" }, respond: () => judgeReply(JSON.stringify(GATE)),
  });
  assert.deepEqual(await client.judge({ system: "s", messages: [], schema: GATE_SCHEMA }), GATE);
  const payload = calls[0].body.payload;
  assert.equal(payload.output_config, undefined);
  assert.match(payload.system, /Return one JSON object and nothing else/);
  assert.ok(payload.system.includes("disclosure_depth"), "the schema itself is in the prompt");
});

test("a model that fences its JSON, or chats first, is still understood", async () => {
  for (const text of [
    "```json\n" + JSON.stringify(GATE) + "\n```",
    "Sure, here you go:\n\n" + JSON.stringify(GATE),
    "```\n" + JSON.stringify(GATE) + "\n```",
  ]) {
    const { client } = harness({ config: { provider: "deepseek" }, respond: () => judgeReply(text) });
    assert.deepEqual(await client.judge({ system: "s", messages: [], schema: GATE_SCHEMA }), GATE);
  }
});

test("a judge reply with no object at all names what came back instead", async () => {
  const { client } = harness({
    config: { provider: "deepseek" }, respond: () => judgeReply("I'd rather just talk about the card."),
  });
  await assert.rejects(client.judge({ system: "s", messages: [], schema: GATE_SCHEMA }), (e) => {
    assert.equal(e.code, "bad_judge_output");
    assert.match(e.message, /rather just talk/, "the actual reply is quoted, not swallowed");
    return true;
  });
});

test("each provider carries its own default model, since ids are not portable", async () => {
  const { PROVIDERS } = await import("../../web/js/llmClient.js");
  assert.equal(PROVIDERS.deepseek.defaultModel, "deepseek-v4-flash");
  assert.equal(PROVIDERS.anthropic.defaultModel, "claude-opus-5");
  assert.equal(PROVIDERS.opencode.defaultModel, "claude-opus-4-8");
  assert.equal(PROVIDERS.anthropic.features.structuredOutput, true);
  assert.equal(PROVIDERS.deepseek.features.structuredOutput, false);
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
  await assert.rejects(client.judge({ system: "s", messages: [], schema: GATE_SCHEMA }), (e) => {
    assert.equal(e.code, "response_truncated");
    assert.match(e.hint, /raise maxTokens/);
    return true;
  });
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

test("the last line of a stream is not dropped when it lacks a trailing newline", async () => {
  // Providers do not promise a newline after the final SSE event. Losing that
  // line silently truncates the reader mid-sentence -- and a reader turn that
  // ends without its question reads as the model trailing off.
  const { client } = harness({
    respond: () => sseResponse([delta("who is missing"), 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":" from the coffins?"}}'],
    ),
  });
  assert.equal(await client.chat({ system: "s", messages: [] }),
               "who is missing from the coffins?");
});

test("a stream that ends without message_stop still yields what it sent", async () => {
  const { client } = harness({ respond: () => sseResponse([delta("cut short")]) });
  assert.equal(await client.chat({ system: "s", messages: [] }), "cut short");
});

test("hitting the token ceiling is reported, not silently returned as a short turn", async () => {
  const truncated = `data: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "max_tokens" }, usage: { output_tokens: 2048 } })}\n`;
  const { client } = harness({ respond: () => sseResponse([delta("this trails off"), truncated]) });
  await assert.rejects(client.chat({ system: "s", messages: [] }), (e) => {
    assert.equal(e.code, "response_truncated");
    // A model that generated 2048 tokens and 15 characters was thinking, not
    // writing. Without the count that diagnosis is a guess.
    assert.match(e.message, /2048 generated tokens/);
    return true;
  });
});

test("the token ceiling has exactly one owner", async () => {
  // A default in chat() shadowed the adapter's and pinned reader turns to a
  // ceiling a thinking model spends before it writes a word. Raising the
  // adapter's did nothing, which is the sort of fix that looks applied.
  const { client, calls } = harness({
    config: { provider: "deepseek" },
    respond: (i) => (i === 0 ? sseResponse([STOP]) : judgeReply(JSON.stringify(GATE))),
  });
  await client.chat({ system: "s", messages: [] });
  await client.judge({ system: "s", messages: [], schema: GATE_SCHEMA });
  assert.equal(calls[0].body.payload.max_tokens, 8192, "a reader turn is sized for the thinking");
  assert.equal(calls[1].body.payload.max_tokens, calls[0].body.payload.max_tokens,
               "a judge call reasons its way to a small object too");
});

test("judge calls are pinned to temperature 0 where the provider still allows it", async () => {
  const { client, calls } = harness({
    config: { provider: "deepseek" }, respond: () => judgeReply(JSON.stringify(GATE)),
  });
  await client.judge({ system: "s", messages: [], schema: GATE_SCHEMA });
  assert.equal(calls[0].body.payload.temperature, 0);
});

test("temperature is not sent to models that answer 400 for it", async () => {
  const { client, calls } = harness({
    config: { provider: "anthropic" }, respond: () => judgeReply(JSON.stringify(GATE)),
  });
  await client.judge({ system: "s", messages: [], schema: GATE_SCHEMA });
  assert.equal(calls[0].body.payload.temperature, undefined,
               "current Anthropic models removed sampling params; sending one is a 400");
});

test("the reader's voice is never pinned, only the judge", async () => {
  const { client, calls } = harness({
    config: { provider: "deepseek" }, respond: () => sseResponse([STOP]),
  });
  await client.chat({ system: "s", messages: [] });
  assert.equal(calls[0].body.payload.temperature, undefined);
});

test("the persona is marked cacheable where the provider understands the marker", async () => {
  const { client, calls } = harness({
    config: { provider: "anthropic" }, respond: () => sseResponse([STOP]),
  });
  await client.chat({ system: "the persona prompt", messages: [{ role: "user", content: "hi" }] });
  assert.deepEqual(calls[0].body.payload.system,
                   [{ type: "text", text: "the persona prompt",
                      cache_control: { type: "ephemeral" } }]);
});

test("and left as a plain string for a gateway that may not know it", async () => {
  // Off is not "no caching" -- the prompt is built as a stable prefix either
  // way, and a provider that caches prefixes on its own still benefits. It is
  // only about not sending a parameter that might come back as a 400.
  const { client, calls } = harness({
    config: { provider: "deepseek" }, respond: () => sseResponse([STOP]),
  });
  await client.chat({ system: "the persona prompt", messages: [] });
  assert.equal(calls[0].body.payload.system, "the persona prompt");
});
