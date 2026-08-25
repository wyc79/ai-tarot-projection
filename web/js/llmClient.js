/**
 * The one module that makes network calls. Two operations, three modes.
 *
 *   chat()  streamed reader turns
 *   judge() structured JSON, nothing else
 *
 * Modes are relay (a base URL -- the local Python relay or the hosted Worker,
 * and this module cannot tell which, by design) and direct (browser straight to
 * the provider). Nothing here assumes a particular backend: relay mode knows
 * only a URL and the shape in RELAY.md.
 *
 * The API key is fetched per request from a callback and passed as a local. It
 * is never stored on the client object, so a debug dump of this module's state
 * cannot leak it.
 */

import { DEFAULT_PROVIDER, PROVIDERS } from "./providers/index.js";

export { PROVIDERS };

export const DEFAULT_CONFIG = {
  mode: "relay",
  relayBase: "",
  provider: DEFAULT_PROVIDER,
  // One model by default; the split exists for people who want to pay less for
  // the reader's voice than for its judgement.
  chatModel: PROVIDERS[DEFAULT_PROVIDER].defaultModel,
  judgeModel: PROVIDERS[DEFAULT_PROVIDER].defaultModel,
};

class RelayError extends Error {
  constructor(code, message, { hint = "" } = {}) {
    super(message);
    this.name = "RelayError";
    this.code = code;
    this.hint = hint;
  }
}

/**
 * Turn an upstream failure into something that names what to go and fix. A bad
 * key, an unreachable host and a wrong model id all used to arrive as
 * "provider_error", which is three different afternoons of debugging.
 */
function classifyUpstream(status, message) {
  const said = message || `provider returned ${status}`;
  if (status === 401 || status === 403) {
    return new RelayError("invalid_key", `the provider rejected this key — ${said}`,
      { hint: "check the key itself, and that the relay's banner names the host you meant" });
  }
  if (/model/i.test(said) && (status === 400 || status === 404 || status === 422)) {
    return new RelayError("unknown_model", `the provider does not know that model — ${said}`,
      { hint: "check the model id against the provider's list; ids differ between gateways" });
  }
  if (status === 404) {
    return new RelayError("endpoint_not_found", `no such endpoint upstream — ${said}`,
      { hint: "the provider's url in PROVIDERS is probably wrong" });
  }
  if (status === 429) {
    return new RelayError("provider_rate_limited", `the provider is rate limiting — ${said}`,
      { hint: "wait, or use a different key" });
  }
  if (status >= 500) {
    return new RelayError("provider_unavailable", `the provider is failing — ${said}`,
      { hint: "upstream problem, not yours; retry" });
  }
  if (status === 400) {
    return new RelayError("bad_payload", `the provider rejected the request — ${said}`,
      { hint: "a parameter this provider does not support; check its features flags" });
  }
  return new RelayError("provider_error", said);
}

/**
 * @param {object} options
 * @param {() => string} options.getKey  called per request; the key is never held here
 * @param {() => object} options.getConfig
 * @param {(event: object) => void} [options.onDebug]  every assembled payload, pre-send
 */
export function makeLlmClient({ getKey, getConfig, onDebug = () => {} }) {
  function resolve() {
    const config = { ...DEFAULT_CONFIG, ...getConfig() };
    const provider = PROVIDERS[config.provider];
    if (!provider) throw new Error(`unknown provider: ${config.provider}`);
    return { config, provider };
  }

  async function send(payload, { provider, config, signal }) {
    const key = getKey();
    if (!key) throw new RelayError("missing_key", "no API key set");

    // The debug panel sees exactly what goes on the wire, minus the key.
    onDebug({ mode: config.mode, provider: provider.id, payload });

    const relay = config.mode === "relay";
    const url = relay
      ? `${config.relayBase.replace(/\/$/, "")}/v1/chat`
      : provider.directUrl;
    const body = relay ? { provider: provider.id, payload } : payload;
    const headers = relay
      ? { "content-type": "application/json", authorization: `Bearer ${key}` }
      : provider.wire.directHeaders(key);

    let response;
    try {
      response = await fetch(url, {
        method: "POST", headers, body: JSON.stringify(body), signal,
      });
    } catch (error) {
      // fetch only rejects when the request never completed: nothing listening,
      // DNS, CORS, offline. That is a different failure from any HTTP status.
      if (error.name === "AbortError") throw error;
      throw new RelayError("connection_failed", `could not reach ${url}`, {
        hint: relay
          ? "is the relay running, and is the base URL right?"
          : "direct mode needs the provider to allow browser origins; try relay mode",
      });
    }

    if (!response.ok) {
      // X-Relay-Error is the only thing that distinguishes "the relay refused"
      // from "the provider refused"; everything else passes through untouched.
      const detail = await response.json().catch(() => null);
      if (response.headers.get("X-Relay-Error") === "1") {
        const code = detail?.error?.code ?? "relay_error";
        throw new RelayError(code, detail?.error?.message ?? "relay refused the request", {
          hint: code === "upstream_unreachable"
            ? "the relay is up but cannot reach the provider host"
            : "",
        });
      }
      throw classifyUpstream(response.status, detail?.error?.message);
    }
    return response;
  }

  return {
    /**
     * Streams a reader turn. onDelta fires per token group; resolves with the
     * full text so the ledger gets one string.
     */
    async chat({ system, messages, onDelta = () => {}, maxTokens = 2048, signal }) {
      const { config, provider } = resolve();
      const payload = provider.wire.chatPayload({
        model: config.chatModel, system, messages, maxTokens,
        features: provider.features,
      });
      const response = await send(payload, { provider, config, signal });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let full = "";
      let truncated = false;

      const consume = (chunk) => {
        buffer = chunk.rest;
        if (chunk.error) throw new RelayError(chunk.error.code, chunk.error.message);
        if (chunk.truncated) truncated = true;
        if (chunk.text) {
          full += chunk.text;
          onDelta(chunk.text, full);
        }
        return chunk.done;
      };

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        if (consume(provider.wire.readStreamChunk(buffer))) break;
      }
      // Nothing promises a newline after the final event, and the parser holds
      // back the last unterminated line. Flushing it is the difference between
      // a reader turn that asks its question and one that trails off.
      if (buffer.trim()) consume(provider.wire.readStreamChunk(`${buffer}\n`));

      if (truncated) {
        throw new RelayError("response_truncated",
          `the reply hit the token ceiling after ${full.length} characters`,
          { hint: "raise maxTokens, or the model is spending the budget on thinking" });
      }
      return full;
    },

    /** Returns the parsed object. Schema-constrained, so parsing is safe. */
    async judge({ system, messages, schema, maxTokens, signal }) {
      const { config, provider } = resolve();
      const payload = provider.wire.judgePayload({
        model: config.judgeModel, system, messages, schema, maxTokens,
        features: provider.features,
      });
      const response = await send(payload, { provider, config, signal });

      let body;
      try {
        body = await response.json();
      } catch {
        // A provider that streamed when it was not asked to, or answered with
        // HTML. Worth its own name: it looks nothing like a bad schema.
        throw new RelayError("bad_provider_response",
          `expected a JSON response from ${provider.id}, got ${response.headers.get("content-type") ?? "something else"}`,
          { hint: "the provider ignored a non-streaming request; check its endpoint url" });
      }
      let text;
      try {
        text = provider.wire.readText(body);
      } catch (error) {
        throw new RelayError(error.code ?? "bad_provider_response", error.message, {
          hint: error.code === "response_truncated"
            ? "raise maxTokens for judge calls, or use a model that does not think as hard"
            : "",
        });
      }
      try {
        // Tolerant even where the schema was enforced: a fence costs nothing to
        // strip, and a provider that quietly ignored output_config should fail
        // as a bad object rather than as a parse error.
        return provider.wire.extractJson(text);
      } catch {
        throw new RelayError("bad_judge_output",
                             `judge did not return the agreed shape: ${text.slice(0, 120)}`);
      }
    },

    /** For the debug page's relay indicator. Same shape from either relay. */
    async health() {
      const { config } = resolve();
      const response = await fetch(`${config.relayBase.replace(/\/$/, "")}/v1/health`);
      return response.json();
    },
  };
}

export { RelayError };
