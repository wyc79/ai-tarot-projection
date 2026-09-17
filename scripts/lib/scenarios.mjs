/**
 * The scenarios on the graph page: each one a moment in a reading, as inputs.
 *
 * A scenario is a title, a sentence on what it shows, and a short scripted
 * conversation with scripted judge verdicts. Nothing here says which nodes a
 * turn visits. scripts/draw_graph.mjs runs each one through the real engine
 * and records what it did; the test suite requires that between them the
 * recordings cross every edge of the compiled graph.
 *
 * What is scripted is the judge's verdict. The model judges; it does not
 * decide. Every decision -- flip, dwell, settle, earn, close, farewell -- is
 * a deterministic function in state.js of the verdict and the session, so a
 * model returning the same verdict produces the same path.
 *
 * Most scenarios are a slice of the canonical seeded session, ending on the
 * turn they are named for. The rest have scripts of their own, three to six
 * turns long, because the seeded session never goes there.
 */

import { SCRIPT } from "./seeded.mjs";

/** A scripted verdict, in the gate's shape. Depth 1 carries nothing of theirs by definition. */
export const verdict = (depth, {
  life = depth > 1, level = "name", hedged = false, stakes = "low", askedBack = false,
} = {}) => ({
  disclosure_depth: depth, has_life_content: life, user_level: level, hedged,
  asked_back: askedBack, stakes, reading_of_them: "noted",
});

const SEEDED_OPENING = SCRIPT[0].opening;
const declines = { has_topic: false, topic: "", stakes: "low" };
const crisis = { has_topic: true, topic: "my mother died", stakes: "crisis" };

/** The first n turns of the seeded session. SCRIPT[0] is the opening answer and has no gate. */
const seeded = (n) => SCRIPT.slice(0, n).map(({ answer, gate }) => (gate ? { answer, gate } : { answer }));

/**
 * @typedef {object} Turn
 * @property {string} [answer]   what they said; runs say()
 * @property {object|null} [gate] the scripted verdict for it; null when the gate is never consulted
 * @property {"stayAWhile"|"meanings"} [action]  a button press instead of an answer
 */

export const SCENARIOS = [
  {
    id: "opening",
    title: "The opening answer",
    blurb: "They said what they came to look at. The first card is dealt, not earned, and the reader asks them to read it before saying anything about it.",
    opening: SEEDED_OPENING,
    turns: seeded(1),
  },
  {
    id: "opening-crisis",
    title: "A crisis in the opening answer",
    blurb: "Safety before the first card: the stakes are judged as crisis, the frame is dropped, and nothing is dealt.",
    opening: crisis,
    turns: [{ answer: "my mother died last week" }],
  },
  {
    id: "off-frame",
    title: "Talking on, with no card dealt",
    blurb: "After the frame was dropped on the opening answer. There is no reading to continue, only a conversation, and the gate is not even consulted.",
    opening: crisis,
    turns: [{ answer: "my mother died last week" }, { answer: "yes, I think so", gate: null }],
  },
  {
    id: "thin",
    title: "A thin answer",
    blurb: "\"dunno\". Depth 1, nothing of theirs on the card yet. The card holds and the reader asks something softer.",
    opening: SEEDED_OPENING,
    turns: seeded(2),
  },
  {
    id: "dwell",
    title: "A disclosure lands, and the card dwells",
    blurb: "Depth 4, their own life. The same path as a thin answer, for the opposite reason: a fresh disclosure blocks the flip on the turn it arrives, so the reading spends one exchange inside it first.",
    opening: SEEDED_OPENING,
    turns: seeded(4),
  },
  {
    id: "earn",
    title: "The turn that earns the next card",
    blurb: "The first flip of the reading. The anchor is committed off the first card before the second exists, then the card turns and the reader bridges.",
    opening: SEEDED_OPENING,
    turns: seeded(5),
  },
  {
    id: "later-flip",
    title: "A later card flips",
    blurb: "The anchor already exists, so the decision goes straight to the flip.",
    opening: SEEDED_OPENING,
    turns: seeded(8),
  },
  {
    id: "epilogue",
    title: "The fourth card is earned",
    blurb: "The spread is complete and something of their own landed during the reading, so the fourth card turns and the close will cover four.",
    opening: SEEDED_OPENING,
    turns: seeded(12),
  },
  {
    id: "close-unearned",
    title: "The close, fourth card unearned",
    blurb: "A reading of pure card description. The spread completes on budget alone, nothing earned the fourth card, and the closing beat names it in one line as an invitation.",
    opening: declines,
    turns: [
      { answer: "no, nothing in particular" },
      ...Array.from({ length: 20 }, (_, i) => ({ answer: `a picture, ${i}`, gate: verdict(1) })),
    ],
    until: "closed",
  },
  {
    id: "after",
    title: "A turn after the close",
    blurb: "The short tail: a last question gets a real answer.",
    opening: SEEDED_OPENING,
    turns: seeded(16),
  },
  {
    id: "farewell",
    title: "The goodbye",
    blurb: "The tail's budget is spent. The reader echoes the noticing, leaves the door open, asks nothing, and the session ends.",
    opening: SEEDED_OPENING,
    turns: seeded(17),
  },
  {
    id: "afterglow",
    title: "Staying a while",
    blurb: "They took the door back after the farewell. Questions stay inside what the reading found.",
    opening: SEEDED_OPENING,
    turns: [...seeded(17), { action: "stayAWhile" },
            { answer: "I keep thinking about the brother thing", gate: verdict(3, { level: "evaluate" }) }],
  },
  {
    id: "regroup",
    title: "The afterglow drifts",
    blurb: "Two answers in a row with nothing of theirs in them. The reader goes back to what the reading was about, or offers the door again.",
    opening: SEEDED_OPENING,
    turns: [...seeded(17), { action: "stayAWhile" },
            { answer: "anyway I have been messing with a scheduling script", gate: verdict(2, { life: false }) },
            { answer: "python, and a text file", gate: verdict(2, { life: false }) }],
  },
  {
    id: "aside",
    title: "“What do you mean?”",
    blurb: "A question back is not an answer. It is recorded as an aside that spends none of their turns, and the reader asks again, smaller.",
    opening: SEEDED_OPENING,
    turns: [...seeded(1), { answer: "wait, what do you mean by that?", gate: verdict(1, { askedBack: true }) }],
  },
  {
    id: "drop-mid",
    title: "The frame is dropped mid-reading",
    blurb: "Crisis stakes on a card. Safety outranks the rhythm: the answer is recorded, the decision is never consulted, and the reader responds plainly.",
    opening: SEEDED_OPENING,
    turns: [...seeded(1), { answer: "my mother died last week, actually", gate: verdict(3, { stakes: "crisis" }) }],
  },
  {
    id: "drop-after-close",
    title: "The frame is dropped after the close",
    blurb: "Stakes do not stop mattering because a reading finished. The frame can still be dropped in the tail.",
    opening: SEEDED_OPENING,
    turns: [...seeded(15), { answer: "actually something happened this week", gate: verdict(3, { stakes: "crisis" }) }],
  },
  {
    id: "meanings",
    title: "“What do the cards mean?”",
    blurb: "The button, after the close. The traditional meanings, from the pack, on request and never offered.",
    opening: SEEDED_OPENING,
    turns: [...seeded(15), { action: "meanings" }],
  },
];
