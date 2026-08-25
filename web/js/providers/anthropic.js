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
 * Anthropic-compatible gateways (DeepSeek, OpenCode Zen) speak this same wire
 * format but do not necessarily implement Anthropic's newest parameters, so the
 * payload builders take a `features` object. With everything off they emit the
 * plain Messages shape that any compatible endpoint has to accept.
 *
 *  - Thinking is sent explicitly as adaptive rather than left off. On Opus 5,
 *    omitting it means adaptive anyway; on Opus 4.8 and 4.7, omitting it means
 *    no thinking, and a model with thinking off may write its reasoning into
 *    the visible reply -- which in a four-sentence reader voice is not subtle.
 *    Latency and cost are managed with effort instead. (Pre-4.6 models want
 *    {type: "enabled", budget_tokens: N} instead and will reject this.)
 *  - stop_reason "refusal" comes back as HTTP 200, so the status code alone
 *    does not tell you the call succeeded.
 *  - max_tokens is a ceiling on everything the model generates, thinking
 *    included, so it is sized for the reasoning and not for the answer -- a
 *    four-sentence reader turn and a small judge object both sit behind however
 *    much the model wants to think first. This is the only place that number is
 *    set: a caller-side default silently shadows it. Unused budget is not
 *    billed; a truncated answer costs the whole call.
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
  chatPayload({ model, system, messages, maxTokens = 8192, effort = "low", features = {} }) {
    const payload = { model, max_tokens: maxTokens, stream: true, system, messages };
    // The system prompt is the persona and the pack, identical on every turn of
    // a session; everything that changes rides in the last user message. Marking
    // it caches roughly 22 KB that would otherwise be re-read from scratch each
    // turn. Sent as a block array, which is the only shape cache_control fits.
    if (features.promptCaching && system) {
      payload.system = [{ type: "text", text: system, cache_control: { type: "ephemeral" } }];
    }
    if (features.thinking) payload.thinking = { type: "adaptive" };
    if (features.effort) payload.output_config = { effort };
    return payload;
  },

  /**
   * A judge call: not streamed, nothing but the object.
   *
   * With native structured output the schema is enforced by the API. Without it
   * -- every Anthropic-compatible gateway so far -- the schema goes in the
   * prompt and readText() has to cope with a model that wrapped its JSON in a
   * code fence.
   */
  judgePayload({ model, system, messages, schema, maxTokens = 8192, effort = "medium", features = {} }) {
    const payload = { model, max_tokens: maxTokens, system, messages };
    if (features.thinking) payload.thinking = { type: "adaptive" };
    // A judge call is a classification, not a voice: pin it where the provider
    // still allows pinning. Current Anthropic models removed sampling params
    // entirely and answer 400, so this is off for them by configuration.
    if (features.temperature) payload.temperature = 0;

    if (features.structuredOutput) {
      payload.output_config = { format: { type: "json_schema", schema } };
      if (features.effort) payload.output_config.effort = effort;
    } else {
      payload.system = `${system}\n\n## Output\n\nReturn one JSON object and nothing else -- no prose before it, no code fence around it. It must match this schema exactly:\n\n${JSON.stringify(schema, null, 2)}`;
      if (features.effort) payload.output_config = { effort };
    }
    return payload;
  },

  /**
   * Pull text deltas out of one SSE chunk. Returns the leftover partial line,
   * because a chunk boundary lands mid-line often enough to matter.
   *
   * @returns {{text: string, rest: string, done: boolean, truncated: boolean, error: object|null}}
   */
  readStreamChunk(buffer) {
    const lines = buffer.split("\n");
    const rest = lines.pop() ?? "";
    let text = "";
    let done = false;
    let truncated = false;
    let spent = 0;
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
      // message_delta is the only event that says what the turn cost, and the
      // count includes thinking. "It stopped early" and "it stopped early
      // having generated 2048 tokens and no words" are different bug reports.
      if (event.usage?.output_tokens) spent = event.usage.output_tokens;

      if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
        text += event.delta.text;
      } else if (event.type === "message_delta" && event.delta?.stop_reason === "refusal") {
        error = { code: "refusal", message: "the model declined this turn" };
      } else if (event.type === "message_delta" && event.delta?.stop_reason === "max_tokens") {
        truncated = true;
      } else if (event.type === "error") {
        error = { code: event.error?.type ?? "stream_error", message: event.error?.message ?? "stream error" };
      } else if (event.type === "message_stop") {
        done = true;
      }
    }
    return { text, rest, done, truncated, spent, error };
  },

  /** The concatenated text of a non-streamed response. */
  readText(body) {
    if (body.stop_reason === "refusal") {
      throw new Error(`model declined: ${body.stop_details?.category ?? "unspecified"}`);
    }
    if (body.stop_reason === "max_tokens") {
      // Models that think before answering spend that budget here too, so a
      // ceiling sized for the visible answer runs out before the JSON starts.
      const error = new Error(
        "the reply hit the token ceiling before it finished; on a model that " +
        "thinks before answering, the thinking is spending the same budget");
      error.code = "response_truncated";
      throw error;
    }
    return (body.content ?? [])
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
  },

  /**
   * Find the JSON object in a reply that was only asked nicely for one. Handles
   * a code fence and any preamble the model could not resist.
   */
  extractJson(text) {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
    const candidate = (fenced ? fenced[1] : text).trim();
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("no JSON object in the reply");
    return JSON.parse(candidate.slice(start, end + 1));
  },
};
