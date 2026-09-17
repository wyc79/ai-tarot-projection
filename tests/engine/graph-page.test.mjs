/**
 * The graph page stands without the relay.
 *
 * The Pages site is reachable from places the Worker is not, and this page is
 * the portfolio piece, so it must work with the relay unreachable or absent.
 * Checked the way the Worker's no-logging rule is checked: statically, on the
 * source, because the suite has no browser.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const PAGE = path.join(ROOT, "web", "graph.html");
const ENTRY = path.join(ROOT, "web", "js", "ui", "graph-page.js");

/** Every file reachable from `entry` through static relative imports, entry included. */
async function importClosure(entry) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(/^\s*(?:import|export)[^;]*?from\s*["']([^"']+)["']/gm)) {
      if (match[1].startsWith(".")) queue.push(path.resolve(path.dirname(file), match[1]));
    }
  }
  return [...seen].map((f) => path.relative(ROOT, f));
}

test("the graph page's imports never reach the relay side", async () => {
  const files = await importClosure(ENTRY);
  assert.ok(files.includes(path.join("web", "js", "engine", "graph.js")), "the page draws the real graph");
  for (const file of files) {
    assert.ok(!/relayBase\.js$|llmClient\.js$|[\\/]providers[\\/]/.test(file), `${file} is on the relay side`);
  }
});

test("the graph page loads nothing from another origin", async () => {
  const html = await readFile(PAGE, "utf8");
  for (const match of html.matchAll(/<(?:script|link|img|iframe|source|video|audio|object|embed)\b[^>]*?\b(?:src|href)="([^"]+)"/g)) {
    assert.ok(!/^[a-z][a-z0-9+.-]*:|^\/\//i.test(match[1]), `${match[1]} is not same-origin`);
  }
  const js = await readFile(ENTRY, "utf8");
  for (const match of js.matchAll(/fetch\(\s*["'`]([^"'`]+)/g)) {
    assert.ok(!/^[a-z][a-z0-9+.-]*:|^\/\//i.test(match[1]), `fetch(${match[1]}) is not same-origin`);
  }
  assert.ok(!/\/v1\/health|\/v1\/chat|HOSTED_RELAY_BASE/.test(js), "the page pings no relay");
});
