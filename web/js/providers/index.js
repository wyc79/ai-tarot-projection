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

const NONE = { thinking: false, effort: false, structuredOutput: false, temperature: false };

export const PROVIDERS = {
  deepseek: {
    id: "deepseek",
    label: "DeepSeek (Anthropic-format endpoint)",
    wire: ANTHROPIC,
    defaultModel: "deepseek-v4-flash",
    directUrl: "https://api.deepseek.com/anthropic/v1/messages",
    // Sampling params still exist here, so judge calls can be pinned to 0.
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
    features: { thinking: true, effort: true, structuredOutput: true, temperature: false },
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
