/**
 * The bits every live-model script needs before it can spend anything: argument
 * parsing, the key, the pack off disk, and a relay that is actually answering.
 *
 * Extracted because there are three of these now and the preflight is exactly
 * the sort of thing that drifts between copies -- the version that told you to
 * start the relay with a trailing shell comment lived in one of them for a day.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPack } from "../web/js/pack.js";

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** --name=value off argv, with everything after the first = kept. */
export const arg = (name, fallback = null) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=") ?? fallback;

export const flag = (name) => process.argv.includes(`--${name}`);

export function requireKey() {
  const key = process.env.TAROT_API_KEY;
  if (!key) {
    console.error("TAROT_API_KEY is not set. This needs a real key: it is measuring a\n" +
                  "real model, and a stand-in would answer the wrong question.");
    process.exit(1);
  }
  return key;
}

/** fetch, backed by the filesystem, so a script loads the shipped pack. */
const fileFetch = async (url) => {
  try {
    return new Response(await readFile(path.join(ROOT, url), "utf8"), { status: 200 });
  } catch {
    return new Response("not found", { status: 404 });
  }
};

export const loadPackFromDisk = (dir = "data") => loadPack(dir, { fetchImpl: fileFetch });

/**
 * Finding out the relay is down after the first model call is a worse way to
 * learn it than being told before anything is spent.
 */
export async function preflightRelay(relay, provider) {
  try {
    const health = await fetch(`${relay}/v1/health`);
    const body = await health.json();
    if (!body.ok) throw new Error("relay reported not ok");
    if (!body.providers.includes(provider)) {
      console.error(`The relay at ${relay} has no "${provider}" provider.\n` +
                    `It offers: ${body.providers.join(", ")}\n` +
                    `Pass --provider=<one of those>, or set PROVIDERS in .env.`);
      process.exit(1);
    }
  } catch {
    console.error(
      `No relay answering at ${relay}.\n\n` +
      `Start one in another shell, with no trailing comment on the line\n` +
      `(an interactive zsh passes "#" through as an argument):\n\n` +
      `    DEV_LOG=1 python3 server/relay.py\n\n` +
      `Then re-run this. Use --relay=<url> if it is not on port 8787.`);
    process.exit(1);
  }
}

/** Report a failed live call as a message, not a stack trace. */
export function reportError(error, extra = "") {
  console.error(`\n${error.code ?? "error"}: ${error.message}`);
  if (error.hint) console.error(`  ${error.hint}`);
  if (extra) console.error(`  ${extra}`);
}
