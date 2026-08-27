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
import { makePicker } from "./picker.js";

const $ = (id) => document.getElementById(id);

let ui = null;
let table = null;
let picker = null;

function onStart(reading) {
  // The intro is spent the moment a reading exists, and does not come back:
  // "new reading" deals onto the same table rather than returning to the door.
  document.body.dataset.phase = "reading";
  // Their deck needs one instruction, once, and it has to be there before the
  // opening question is answered: laying four cards out is what they do while
  // they think about the answer.
  $("own-deck-note").hidden = reading.session.card_source !== "physical";
  picker.close();
  table.deal(reading.session);
}

function onEvent(event) {
  if (event.type === "flip") table.turn(ui.reading.session);
  // Once they have turned one over they know how this goes, and on a phone the
  // note is a strip of the table's height from then on.
  if (event.type === "identified") $("own-deck-note").hidden = true;
  // A reading that never got a word out is not a reading to sit in front of:
  // back to the door, where the button and the settings are. The error is in
  // the status bar, which is in the header and visible either way.
  if (event.type === "reading_failed" && !event.spoke) {
    picker.close();
    document.body.dataset.phase = "idle";
  }
}

async function main() {
  ui = await mountSession({
    onEvent,
    onStart,
    identifyCard: (request) => picker.ask(request),
  });
  table = makeTable($("spread"), ui.pack);
  picker = makePicker($("picker"), ui.pack);
  setStatus(`${ui.pack.name} · ${ui.pack.cards.length} cards`);
}

main().catch((error) => setStatus(`the pack did not load: ${error.message}`, "bad"));
