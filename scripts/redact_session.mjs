/**
 * Turn a real session into a fixture that can be committed.
 *
 *   node scripts/redact_session.mjs checkpoint/reading-x.json redactions/x.json \
 *     > tests/fixtures/x.json
 *
 * This app is built to get people to say specific things about their lives, so
 * the transcripts worth freezing as fixtures are exactly the ones where that
 * worked. The originals stay in checkpoint/, which is gitignored. What goes in
 * the repo is a derivative with the person substituted out and every structural
 * property kept.
 *
 * What the checks in web/js/engine/scan.js actually read, and therefore what a
 * substitution must not break:
 *
 *   - the gate flags: depth, has_life_content, hedged, user_level. Untouched.
 *   - word overlap between a user answer and the reader turn after it, which is
 *     how the premise check knows a word was theirs first and how the hedge
 *     check knows a turn was built on. So a substitution is applied to BOTH
 *     sides, and the map is word-for-word rather than sentence-for-sentence.
 *   - the shape of the questions, which decides rail and level. Untouched.
 *
 * The redaction map is {from: to} and is itself gitignored: it is the thing
 * that would let someone reverse this.
 *
 * Exits non-zero if any mapped word survives anywhere in the output, because a
 * redaction that half worked is worse than none -- it reads as complete.
 */

import { readFile } from "node:fs/promises";

const [sessionPath, mapPath] = process.argv.slice(2);
if (!sessionPath || !mapPath) {
  console.error("usage: node scripts/redact_session.mjs <session.json> <redactions.json>");
  process.exit(1);
}

const parsed = JSON.parse(await readFile(sessionPath, "utf8"));
const map = JSON.parse(await readFile(mapPath, "utf8"));

/** Case-preserving whole-word substitution. */
function redact(text) {
  if (typeof text !== "string") return text;
  let out = text;
  for (const [from, to] of Object.entries(map)) {
    out = out.replace(new RegExp(`\\b${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"),
      (hit) => (hit[0] === hit[0].toUpperCase() ? to[0].toUpperCase() + to.slice(1) : to));
  }
  return out;
}

/** Everything that carries words. Ids, timestamps, flags and levels are not touched. */
const WORDY = new Set(["q", "a", "ai_reading", "user_projection", "reading_of_them",
                       "theme", "resolution_beat", "closing_reflection", "topic", "phrase"]);

const words = [];

function walk(node) {
  if (Array.isArray(node)) return node.map(walk);
  if (node && typeof node === "object") {
    return Object.fromEntries(Object.entries(node).map(([key, value]) => {
      if (!WORDY.has(key)) return [key, walk(value)];
      const done = redact(value);
      words.push(done);
      return [key, done];
    }));
  }
  return node;
}

const out = walk(parsed);
const rendered = JSON.stringify(out, null, 2);

// Scanned over the fields that carry words, not the whole file. Card ids are
// not prose: "major-06-lovers" is the Major Arcana and would report a surviving
// "major" forever, which is how a completeness check trains you to ignore it.
const prose = words.join("\n");
const survivors = Object.keys(map).filter(
  (from) => new RegExp(`\\b${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(prose));
if (survivors.length) {
  console.error(`redaction incomplete: ${survivors.join(", ")} still present in the output.`);
  console.error("Nothing written. A redaction that half worked reads as one that worked.");
  process.exit(1);
}

console.log(rendered);
