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

import { ANTHROPIC } from "./providers/anthropic.js";

export const PROVIDERS = { anthropic: ANTHROPIC };

export const DEFAULT_CONFIG = {
  mode: "relay",
  relayBase: "",
  provider: "anthropic",
  // One model by default; the split exists for people who want to pay less for
  // the reader's voice than for its judgement.
  chatModel: ANTHROPIC.defaultModel,
  judgeModel: ANTHROPIC.defaultModel,
};

class RelayError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RelayError";
    this.code = code;
  }
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
      : provider.directHeaders(key);

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      // X-Relay-Error is the only thing that distinguishes "the relay refused"
      // from "the provider refused"; everything else passes through untouched.
      const detail = await response.json().catch(() => null);
      if (response.headers.get("X-Relay-Error") === "1") {
        throw new RelayError(detail?.error?.code ?? "relay_error",
                             detail?.error?.message ?? "relay refused the request");
      }
      const message = detail?.error?.message ?? `provider returned ${response.status}`;
      throw new RelayError("provider_error", message);
    }
    return response;
  }

  return {
    /**
     * Streams a reader turn. onDelta fires per token group; resolves with the
     * full text so the ledger gets one string.
     */
    async chat({ system, messages, onDelta = () => {}, maxTokens, signal }) {
      const { config, provider } = resolve();
      const payload = provider.chatPayload({
        model: config.chatModel, system, messages, maxTokens,
      });
      const response = await send(payload, { provider, config, signal });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let full = "";

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunk = provider.readStreamChunk(buffer);
        buffer = chunk.rest;
        if (chunk.error) throw new RelayError(chunk.error.code, chunk.error.message);
        if (chunk.text) {
          full += chunk.text;
          onDelta(chunk.text, full);
        }
        if (chunk.done) break;
      }
      return full;
    },

    /** Returns the parsed object. Schema-constrained, so parsing is safe. */
    async judge({ system, messages, schema, maxTokens, signal }) {
      const { config, provider } = resolve();
      const payload = provider.judgePayload({
        model: config.judgeModel, system, messages, schema, maxTokens,
      });
      const response = await send(payload, { provider, config, signal });
      const text = provider.readText(await response.json());
      try {
        return JSON.parse(text);
      } catch {
        throw new RelayError("bad_judge_output", "judge did not return the agreed shape");
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
