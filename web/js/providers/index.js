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
  // Whether a judge call may send thinking:{type:"disabled"}. ON by default,
  // which is the opposite of every other flag here, and unlike the others this
  // one has been watched rather than argued for. Five judge calls on frozen
  // input, deepseek-v4-flash, 2026-08-25 (scripts/judge_probe.mjs):
  //
  //   thinking disabled        71 72 71 72 71 output tokens, all valid
  //   thinking not mentioned   490 650 2780 4956 and one truncated at 8192
  //   thinking budget 1024     2116 4153 7028 and two truncated at 8192
  //
  // The middle row is what shipped before this, and its truncation is the bug
  // that started this. The last row is the "cap it low instead" idea: the
  // gateway accepts budget_tokens and does not honour it, so it is strictly
  // worse than saying nothing. Set false for any provider observed to reject
  // the parameter outright.
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
  "opencode-go": {
    id: "opencode-go",
    label: "OpenCode Go",
    wire: ANTHROPIC,
    // Go is a separate subscription from Zen behind the same login, on its own
    // base url, and a key for one has no balance on the other -- which arrives
    // as "Insufficient balance" rather than as anything about the wrong door.
    // Both entries exist so that choosing is done in the dropdown, once, rather
    // than diagnosed from an error message later.
    //
    // Only part of the Go catalogue speaks Messages; the rest is on /responses
    // or /chat/completions, which this app has no adapter for. The eight that
    // do, as of 2026-08-31: minimax-m3, minimax-m2.7, minimax-m2.5,
    // qwen3.8-max, qwen3.8-flash, qwen3.7-max, qwen3.7-plus, qwen3.6-plus.
    //
    // The default is the strongest of them rather than the cheapest, which is
    // the opposite of the deepseek default -- that one was measured, and it was
    // measured against per-token billing where flash-vs-pro is a real bill. Go
    // is a flat subscription, so the tradeoff it was decided under does not
    // apply here. Nothing in this repo has been run against Go yet.
    defaultModel: "minimax-m3",
    directUrl: "https://opencode.ai/zen/go/v1/messages",
    features: NONE,
  },
};

export const DEFAULT_PROVIDER = "deepseek";
