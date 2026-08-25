import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPack } from "../../web/js/pack.js";
import { turnKindOf } from "../../web/js/engine/prompts.js";

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
    async chat({ system, messages, onDelta = () => {} }) {
      const turn = turnKindOf(system);
      calls.chat.push({ system, messages, turn });
      const text = reply(turn, system, messages);
      onDelta(text, text);
      return text;
    },
    async judge({ system, messages, schema }) {
      calls.judge.push({ system, messages, schema });
      if (schema.properties.has_topic) {
        return opening ?? { has_topic: false, topic: "", stakes: "low" };
      }
      if (schema.properties.theme) {
        return anchor ?? { theme: "t", user_phrases: ["stuck"], resolution_beat: "r" };
      }
      return queue.shift() ?? { disclosure_depth: 2, stakes: "low", reading_of_them: "x" };
    },
  };
}

export const gate = (depth, stakes = "low") =>
  ({ disclosure_depth: depth, stakes, reading_of_them: "noted" });

/** Answer to the opening question. Declining is the default a test wants. */
export const declines = { has_topic: false, topic: "", stakes: "low" };
export const wants = (topic, stakes = "low") => ({ has_topic: true, topic, stakes });
