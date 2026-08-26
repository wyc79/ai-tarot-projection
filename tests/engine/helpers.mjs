import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPack } from "../../web/js/pack.js";
import { createSession, flipCard } from "../../web/js/engine/state.js";
import { readerCall } from "../../web/js/engine/prompts.js";

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

/** fetch, backed by the filesystem, so tests load the real shipped pack. */
const fileFetch = async (url) => {
  try {
    const body = await readFile(path.join(ROOT, url), "utf8");
    return new Response(body, { status: 200 });
  } catch {
    return new Response("not found", { status: 404 });
  }
};

export const realPack = () => loadPack("data", { fetchImpl: fileFetch });

/**
 * A stand-in for the model. Scripted judge verdicts and canned reader turns, so
 * a whole session runs deterministically with no network and no key.
 */
export function fakeClient({
  gates = [], anchor = null, opening = null, reply = (turn) => `[${turn}]`,
}) {
  const queue = [...gates];
  const calls = { chat: [], judge: [] };
  return {
    calls,
    /** The pending verdicts, so a test that cannot know how many a session will
     *  spend can push more once it has got where it was going. */
    gates: queue,
    async chat({ kind, system, messages, onDelta = () => {} }) {
      // What the model actually sees: the stable prefix, then the turn block
      // folded into the last user message. Tests assert against this rather
      // than against either half, because the split between them is an
      // arrangement for caching, not a change to the reader's instructions.
      const prompt = `${system}\n${messages[messages.length - 1]?.content ?? ""}`;
      // The turn is what the engine asked for, not what the prose looks like.
      const turn = kind;
      calls.chat.push({ kind, system, messages, prompt, turn });
      const text = reply(turn, system, messages);
      onDelta(text, text);
      return text;
    },
    /**
     * Answers by kind, which the judgement says outright.
     *
     * It used to sniff the schema -- has_topic meant the opening, theme meant
     * the anchor, anything else was a gate -- so adding a field called `theme`
     * to the gate would have quietly routed every gate in the suite to the
     * anchor's canned reply.
     */
    async judge({ kind, system, messages, schema }) {
      calls.judge.push({ kind, system, messages, schema });
      switch (kind) {
        case "opening":
          return opening ?? { has_topic: false, topic: "", stakes: "low" };
        case "anchor":
          // The default beat is territory-phrased, or every anchor call in every
          // test would trip the re-ask and land twice.
          return anchor ?? {
            theme: "t",
            resolution_beat: "whether it is still holding, or has outlived itself",
            user_phrases: [{ phrase: "stuck", source: "life" }],
          };
        case "gate":
          return queue.shift()
            ?? { disclosure_depth: 2, has_life_content: true, stakes: "low", reading_of_them: "x" };
        default:
          throw new Error(`the fake was asked for a judgement it has no answer for: ${kind}`);
      }
    },
  };
}

/**
 * The whole prompt one turn would send: the stable prefix, then the turn block
 * folded into the last user message.
 *
 * Tests assert against this rather than against either half, because the split
 * between them is an arrangement for caching, not a change to the reader's
 * instructions. Same assembly fakeClient sees, from the same front door.
 */
export function promptFor(pack, session, turn, options = {}) {
  const { system, messages } = readerCall({ pack, session, turn, ...options });
  return `${system}\n${messages[messages.length - 1]?.content ?? ""}`;
}

/**
 * An ordinary answer. A shrug carries nothing of their life by definition, so
 * depth 1 is ungrounded here the way the judge's own rule says it must be.
 */
export const gate = (depth, stakes = "low") =>
  ({ disclosure_depth: depth, has_life_content: depth > 1, stakes, reading_of_them: "noted" });

/**
 * An answer entirely about the picture. Depth caps at 2 by the judge's own
 * rule, and the card it lands on does not earn an early flip.
 */
export const cardOnly = (depth = 2, stakes = "low") =>
  ({ disclosure_depth: depth, has_life_content: false, stakes, reading_of_them: "described the card" });

/** Answer to the opening question. Declining is the default a test wants. */
export const declines = { has_topic: false, topic: "", stakes: "low" };
export const wants = (topic, stakes = "low") => ({ has_topic: true, topic, stakes });

/**
 * A session part-way through a reading, with one named card face up in the
 * situation and the rest of the spread face down behind it.
 *
 * Built by the engine rather than by hand, so a prompt test cannot end up
 * asserting against a session shape the engine never produces -- which is what
 * happened when the spread started being dealt all at once and three tests went
 * on describing a table with nothing on it.
 */
export function sessionShowing(pack, cardId) {
  const rest = pack.cards.map((c) => c.card_id).filter((id) => id !== cardId);
  const session = createSession({
    packId: pack.id, seed: "moon-4f2a91",
    positions: pack.positions, epilogue: pack.epilogue,
    deal: [cardId, ...rest.slice(0, pack.positions.length)],
  });
  session.phase = "reading";
  flipCard(session, cardId, { reason: "the opening question was answered; the reading begins" });
  return session;
}
