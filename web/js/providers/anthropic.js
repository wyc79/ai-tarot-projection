/**
 * Anthropic Messages API adapter: builds provider-native request bodies and
 * reads provider-native responses.
 *
 * This is the only file that knows Anthropic's wire format. The relay forwards
 * whatever is built here without reading it, so adding a provider means adding
 * a sibling file -- no relay redeploy, no engine change.
 *
 * Three details worth not relearning the hard way:
 *  - Assistant prefill (the old trick for forcing JSON) is rejected on current
 *    models. Structured output goes through output_config.format instead.
 *  - Thinking is sent explicitly as adaptive rather than left off. On Opus 5,
 *    omitting it means adaptive anyway; on Opus 4.8 and 4.7, omitting it means
 *    no thinking, and a model with thinking off may write its reasoning into
 *    the visible reply -- which in a four-sentence reader voice is not subtle.
 *    Latency and cost are managed with effort instead. (Pre-4.6 models want
 *    {type: "enabled", budget_tokens: N} instead and will reject this.)
 *  - stop_reason "refusal" comes back as HTTP 200, so the status code alone
 *    does not tell you the call succeeded.
 */

export const ANTHROPIC = {
  id: "anthropic",
  label: "Anthropic",
  defaultModel: "claude-opus-5",
  directUrl: "https://api.anthropic.com/v1/messages",

  /** Direct mode only. In relay mode the relay attaches provider auth itself. */
  directHeaders(key) {
    return {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    };
  },

  /** A reader turn: streamed, short, low effort -- this is voice, not analysis. */
  chatPayload({ model, system, messages, maxTokens = 1024, effort = "low" }) {
    return {
      model,
      max_tokens: maxTokens,
      stream: true,
      system,
      messages,
      thinking: { type: "adaptive" },
      output_config: { effort },
    };
  },

  /** A judge call: not streamed, schema-constrained, nothing but the object. */
  judgePayload({ model, system, messages, schema, maxTokens = 1024, effort = "medium" }) {
    return {
      model,
      max_tokens: maxTokens,
      system,
      messages,
      thinking: { type: "adaptive" },
      output_config: {
        effort,
        format: { type: "json_schema", schema },
      },
    };
  },

  /**
   * Pull text deltas out of one SSE chunk. Returns the leftover partial line,
   * because a chunk boundary lands mid-line often enough to matter.
   *
   * @returns {{text: string, rest: string, done: boolean, error: object|null}}
   */
  readStreamChunk(buffer) {
    const lines = buffer.split("\n");
    const rest = lines.pop() ?? "";
    let text = "";
    let done = false;
    let error = null;

    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const raw = line.slice(5).trim();
      if (!raw) continue;
      let event;
      try {
        event = JSON.parse(raw);
      } catch {
        continue; // a keepalive or a line we do not need to understand
      }
      if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
        text += event.delta.text;
      } else if (event.type === "message_delta" && event.delta?.stop_reason === "refusal") {
        error = { code: "refusal", message: "the model declined this turn" };
      } else if (event.type === "error") {
        error = { code: event.error?.type ?? "stream_error", message: event.error?.message ?? "stream error" };
      } else if (event.type === "message_stop") {
        done = true;
      }
    }
    return { text, rest, done, error };
  },

  /** The concatenated text of a non-streamed response. */
  readText(body) {
    if (body.stop_reason === "refusal") {
      throw new Error(`model declined: ${body.stop_details?.category ?? "unspecified"}`);
    }
    if (body.stop_reason === "max_tokens") {
      throw new Error("response hit max_tokens; structured output may be truncated");
    }
    return (body.content ?? [])
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
  },
};
