/**
 * The styled page: the reading a stranger sees.
 *
 * Everything about running a session lives in session.js, shared with the debug
 * page. What is here is the table and the two states this page has -- before a
 * reading and during one. None of the machinery reaches this file: no gate, no
 * anchor, no scaffolding map, no assembled prompt.
 */

import { mountSession, setStatus } from "./session.js";
import { makeTable } from "./table.js";

const $ = (id) => document.getElementById(id);

let ui = null;
let table = null;

function onStart(reading) {
  // The intro is spent the moment a reading exists, and does not come back:
  // "new reading" deals onto the same table rather than returning to the door.
  document.body.dataset.phase = "reading";
  table.deal(reading.session);
}

function onEvent(event) {
  if (event.type === "flip") table.turn(ui.reading.session);
}

async function main() {
  ui = await mountSession({ onEvent, onStart });
  table = makeTable($("spread"), ui.pack);
  setStatus(`${ui.pack.name} · ${ui.pack.cards.length} cards`);
}

main().catch((error) => setStatus(`the pack did not load: ${error.message}`, "bad"));
