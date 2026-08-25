/**
 * The shapes judge() is contractually required to return.
 *
 * Structured outputs reject numeric constraints (no minimum/maximum), so the
 * depth scale is an enum rather than an integer with bounds. Every object needs
 * additionalProperties: false and a complete required list.
 */

/** Per-turn flip gate. Runs on every user turn, including the first. */
export const GATE_SCHEMA = {
  type: "object",
  properties: {
    disclosure_depth: {
      type: "integer",
      enum: [0, 1, 2, 3],
      description:
        "0 deflecting or one word; 1 generic, could be anyone; 2 specific to their life; " +
        "3 something true and costly to say.",
    },
    flip_ready: {
      type: "boolean",
      description: "Has this card been read for what it is worth, or is there more here?",
    },
    stakes: {
      type: "string",
      enum: ["low", "high", "crisis"],
      description:
        "low: ordinary reflection. high: medical, legal or financial consequence -- " +
        "money decisions with real outcomes count, and so does advice of that kind " +
        "they intend to give someone else. crisis: grief, self-harm, or anything " +
        "where a tarot frame would be an insult.",
    },
    reading_of_them: {
      type: "string",
      description: "One sentence: what they actually disclosed, in their own words where possible.",
    },
  },
  required: ["disclosure_depth", "flip_ready", "stakes", "reading_of_them"],
  additionalProperties: false,
};

/**
 * The opening turn, before anything is dealt. Runs the stakes check too, so the
 * frame can be dropped before a single card is turned.
 */
export const OPENING_SCHEMA = {
  type: "object",
  properties: {
    has_topic: {
      type: "boolean",
      description:
        "Did they actually name something to look at? 'not really', 'just curious', " +
        "'surprise me' and silence are all false. Do not count politeness as a topic.",
    },
    topic: {
      type: "string",
      description:
        "What they want to look at, in their own words, compressed to a phrase. " +
        "Empty string when has_topic is false. Never your paraphrase of their situation.",
    },
    stakes: {
      type: "string",
      enum: ["low", "high", "crisis"],
      description:
        "low: ordinary reflection. high: medical, legal or financial consequence -- " +
        "money decisions with real outcomes count, including advice they intend to give " +
        "someone else. crisis: grief, self-harm, abuse, or anything where a tarot frame " +
        "would be an insult. When unsure between two, choose the higher.",
    },
  },
  required: ["has_topic", "topic", "stakes"],
  additionalProperties: false,
};

/** Committed once, after the first card. The session's narrative plan. */
export const ANCHOR_SCHEMA = {
  type: "object",
  properties: {
    theme: {
      type: "string",
      description: "What this reading is actually about, in the user's register, not a diagnosis.",
    },
    user_phrases: {
      type: "array",
      items: { type: "string" },
      description: "Exact words and images the user used. The reader reuses these rather than paraphrasing.",
    },
    resolution_beat: {
      type: "string",
      description: "Where the third card should land this session. The follow-ups steer toward it.",
    },
  },
  required: ["theme", "user_phrases", "resolution_beat"],
  additionalProperties: false,
};
