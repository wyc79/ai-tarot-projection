/**
 * The command line over the protocol scanner.
 *
 *   node scripts/scan.mjs checkpoint/b-deepseek-v4-pro.json
 *   node scripts/scan.mjs checkpoint/*.json
 *
 * Everything that decides what a violation is lives in web/js/engine/scan.js,
 * which is pure and browser-safe. This half reads files, prints, and sets an
 * exit code -- the three things a browser cannot do and the only three reasons
 * this file exists.
 */

import { readFile } from "node:fs/promises";
import {
  formatFindings, scanSession, sessionIn, staircase,
} from "../web/js/engine/scan.js";
import { loadPackFromDisk } from "./harness.mjs";

const files = process.argv.slice(2);
if (!files.length) {
  console.error("usage: node scripts/scan.mjs <session.json> [...]");
  process.exit(1);
}

const pack = await loadPackFromDisk();
let total = 0;
for (const file of files) {
  const session = sessionIn(JSON.parse(await readFile(file, "utf8")));
  if (!session) {
    console.error(`${file}: not a session (no exchanges array)`);
    total += 1;
    continue;
  }
  const findings = scanSession(session, pack);
  total += findings.length;
  console.log(formatFindings(file, findings));
  const drawn = staircase(session, pack);
  if (drawn) console.log(`\n${drawn}\n`);
}
process.exit(total ? 1 : 0);
