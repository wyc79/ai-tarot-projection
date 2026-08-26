/**
 * The provider registry: which backends can be selected, and what each one can
 * actually do.
 *
 * Two things that are easy to conflate and are kept apart here:
 *
 *   id       the name sent to the relay, matching a key in its PROVIDERS config.
 *            It picks the upstream URL and auth style.
 *   wire     how the request body is built. Several providers share one wire
 *            format -- DeepSeek and OpenCode Zen both serve Anthropic-shaped
 *            endpoints, so all three entries below use the same adapter.
 *
 * `features` is what stops the newest Anthropic parameters from being sent to a
 * gateway that has never heard of them. Off by default: a compatible endpoint
 * is required to accept the plain Messages shape and nothing more.
 */

import { ANTHROPIC } from "./anthropic.js";

const NONE = {
  thinking: false, effort: false, structuredOutput: false, temperature: false,
  // Explicit cache markers. Off here does not mean "no caching": the reader's
  // prompt is deliberately built as a stable 22 KB prefix followed by a small
  // per-turn block, and a provider that caches prefixes on its own gets the
  // benefit either way. This flag is only about whether to send cache_control,
  // which a gateway that has never heard of it may reject outright.
  promptCaching: false,
  // Whether a judge call may send thinking:{type:"disabled"}. Deliberately ON
  // by default, which is the opposite of every other flag here, because the
  // usual argument runs the other way for this one parameter: an unrecognised
  // instruction to turn something OFF is the safe kind to send, a gateway that
  // rejects it says so in one legible 400 on the next turn, and the failure it
  // prevents is silent -- 8192 tokens of deliberation and no JSON, which is
  // what happens to deepseek-v4-flash on the gate schema. Set false for any
  // provider observed to reject it.
  thinkingOff: true,
};

export const PROVIDERS = {
  deepseek: {
    id: "deepseek",
    label: "DeepSeek (Anthropic-format endpoint)",
    wire: ANTHROPIC,
    defaultModel: "deepseek-v4-flash",
    directUrl: "https://api.deepseek.com/anthropic/v1/messages",
    // Sampling params still exist here, so judge calls can be pinned to 0.
    // promptCaching stays off until someone has actually watched a cache hit
    // come back from this endpoint; assuming it works is how you find out it
    // does not, one 400 per turn.
    features: { ...NONE, temperature: true },
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    wire: ANTHROPIC,
    defaultModel: "claude-opus-5",
    directUrl: "https://api.anthropic.com/v1/messages",
    // Implements all of its own newest parameters, and none of the old ones:
    // temperature/top_p/top_k were removed on the current models and now return
    // 400, so judge determinism here comes from the schema and the rubric.
    features: {
      thinking: true, effort: true, structuredOutput: true, temperature: false,
      promptCaching: true, thinkingOff: true,
    },
  },
  opencode: {
    id: "opencode",
    label: "OpenCode Zen",
    wire: ANTHROPIC,
    defaultModel: "claude-opus-4-8",
    directUrl: "https://opencode.ai/zen/v1/messages",
    features: NONE,
  },
};

export const DEFAULT_PROVIDER = "deepseek";
