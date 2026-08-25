/**
 * The shapes judge() is contractually required to return.
 *
 * Structured outputs reject numeric constraints (no minimum/maximum), so the
 * depth scale is an enum rather than an integer with bounds. Every object needs
 * additionalProperties: false and a complete required list.
 */

/**
 * Per-turn flip gate. Runs on every user turn, including the first.
 *
 * A function of the pack rather than a constant, because user_level's enum is
 * the pack's scaffolding ladder. The engine does not know what levels exist --
 * it knows they are ordered and that a question may stand one rung above the
 * answer before it.
 */
export function gateSchema(pack) {
  return {
    type: "object",
    properties: {
      disclosure_depth: {
        type: "integer",
        enum: [1, 2, 3, 4],
        description:
          "How much they disclosed, judged against the kind of question they were " +
          "answering -- the system prompt carries both scales and the message says " +
          "which one applies. On a projection question, reading something into the " +
          "picture is the disclosure; on a life question, describing the picture " +
          "instead of answering is a 1. Judge what was disclosed, not how many " +
          "words were used: a short answer can be a 4 and a long one a 2.",
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
      has_life_content: {
        type: "boolean",
        description:
          "Did this answer contain anything about their life at all? True needs " +
          "one of: a person, a place, a time, an event, a feeling they own, or a " +
          "sentence that refers back to themselves -- 'like me', 'reminds me of', " +
          "'I hate that'. Describing the picture, however vividly and however " +
          "long, is false. This is the difference between someone reading a card " +
          "and someone using one.",
      },
      user_level: {
        type: "string",
        enum: pack.levels.map((l) => l.id),
        description:
          "The cognitive level their ANSWER operated at, not the question's. A " +
          "separate axis from disclosure_depth: depth is how much they revealed, " +
          "this is what kind of operation they performed. " +
          pack.levels.map((l) => `${l.id} = ${l.asks}`).join("; ") + ". " +
          "People jump levels on their own; report where they actually landed, " +
          "not where they were invited to land.",
      },
    },
    required: ["disclosure_depth", "has_life_content", "user_level", "stakes", "reading_of_them"],
    additionalProperties: false,
  };
}

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
      items: {
        type: "object",
        properties: {
          phrase: {
            type: "string",
            description: "Exact words the user used. The reader reuses these rather than paraphrasing.",
          },
          source: {
            type: "string",
            enum: ["card", "life"],
            description:
              "card: they were describing the picture -- 'the black and white pillar', " +
              "'a woman in a garden'. life: the phrase is about them or their world -- " +
              "a person, a place, an event, a feeling they own. The difference decides " +
              "what the theme can be built out of, so do not guess it generously.",
          },
        },
        required: ["phrase", "source"],
        additionalProperties: false,
      },
      description: "Their exact words, each tagged by what it was about.",
    },
    resolution_beat: {
      type: "string",
      description: "Where the third card should land this session. The follow-ups steer toward it.",
    },
  },
  required: ["theme", "user_phrases", "resolution_beat"],
  additionalProperties: false,
};
