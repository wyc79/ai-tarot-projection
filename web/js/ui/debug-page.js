/**
 * The M2 debug UI: the machinery, on purpose.
 *
 * The flip gate's verdict and reason, the committed anchor, the scaffolding map
 * and the fully assembled prompt before it is sent -- the four things that need
 * to be visible while iterating on the reader. None of them ever reach the
 * styled page.
 *
 * The session plumbing under all of it lives in session.js, shared with the
 * styled page. What is here is only what makes this page the debug one.
 */

import { mountSession, setStatus } from "./session.js";
import { cardStanding, tableau } from "../engine/state.js";
import { staircaseSvg } from "./staircase.js";

const $ = (id) => document.getElementById(id);

let ui = null;

// -- rendering ---------------------------------------------------------------

/**
 * The table: every position, from the first second, with its card face down
 * until the reading turns it.
 *
 * Redrawn whole on every flip rather than appending one slot at a time. The
 * spread does not grow any more -- it is all there from the start and cards
 * turn over in place, which is the point: the face-down ones ahead are what the
 * flip gate is an incentive toward, and they were previously invisible.
 */
function renderTable() {
  const spread = $("spread");
  spread.innerHTML = "";
  if (!ui?.reading) return;
  const { pack } = ui;
  for (const slot of tableau(ui.reading.session)) {
    const figure = document.createElement("figure");
    figure.className = `slot ${slot.face_up ? "up" : "down"}`;
    const position = pack.position(slot.position);
    if (slot.face_up) {
      const card = pack.card(slot.card_id);
      // No caption describing the picture. A printed description is something
      // to agree with, and agreeing is not projecting -- whatever they say
      // about the card should come from looking at it, not from reading a
      // sentence about it. The line survives as alt text, where it belongs.
      figure.innerHTML = `<img src="${pack.imageUrl(card)}" alt="${card.imagery_line}">
        <figcaption><strong>${card.name}</strong><br>
        <span class="label">${position?.label ?? slot.position}</span></figcaption>`;
    } else {
      // The fourth one is deliberately unlabelled: naming it "epilogue" before
      // it turns tells someone there is a bonus card to play for, and a card
      // played for is not a card earned.
      figure.innerHTML = `<img src="${pack.cardBackUrl}" alt="a card, face down">
        <figcaption><span class="label">${
          slot.epilogue ? "·" : position?.label ?? slot.position}</span></figcaption>`;
    }
    spread.append(figure);
  }
}

/**
 * Where the current card is in its budget: spent, target, cap.
 *
 * The reasons say "3 exchanges on one card" and the budget is per position now,
 * so the number on its own does not tell you whether that is nearly done or
 * barely started. Asides are not in it, which is the point of them.
 */
function budgetLine() {
  if (!ui?.reading) return "";
  // One read of the card's standing, rather than three different ways of asking
  // the ledger the same question. The aside count in particular used to be
  // filtered here by hand, which made this the second place the rule lived.
  const { card, position, exchanges: spent, asides, budget } = cardStanding(ui.reading.session);
  if (!card) return "";
  const over = spent >= budget.target ? " ok" : "";
  return `<div><span class="label">${position}</span>
    <b class="${over}">${spent}/${budget.max}</b>
    <span class="label">target</span> ${budget.target}
    ${asides ? `<span class="label">+${asides} aside${asides > 1 ? "s" : ""}</span>` : ""}</div>`;
}

function renderGate(gate, decision) {
  $("gate").innerHTML = `
    ${budgetLine()}
    <div><span class="label">depth</span> ${gate.disclosure_depth} &nbsp;
         <span class="label">level</span> ${gate.user_level ?? "-"} &nbsp;
         ${gate.hedged ? `<b class="bad">hedged</b> &nbsp;` : ""}
         ${gate.asked_back ? `<b class="bad">asked back</b> &nbsp;` : ""}
         <span class="label">stakes</span> <b class="${gate.stakes !== "low" ? "bad" : ""}">${gate.stakes}</b></div>
    <div class="quote">${gate.reading_of_them ?? ""}</div>
    ${decision ? `<div class="${decision.flip ? "ok" : ""}">${decision.flip ? "FLIP" : "hold"} — ${decision.reason}</div>` : ""}`;
}

/**
 * Redrawn on every turn boundary. `pending` is the question just asked and not
 * yet answered -- it has no exchange record, so without it the map would always
 * be one turn behind the conversation on the left.
 */
function renderStaircase(pending = "") {
  if (!ui?.reading) return;
  const svg = staircaseSvg(ui.reading.session, ui.pack, { pending });
  $("staircase").innerHTML = svg
    ? `${svg}<p class="staircase-key">line: what was asked · ○ about the card,
       ● about their life · ◇ where the answer landed, green when it carried
       something of theirs · dashed: a flip, hover for why · red ring: asked
       more than one rung above them, or crossed rails and climbed · ↓ deflection</p>`
    : "nothing asked yet";
}

function renderAnchor(anchor) {
  $("anchor").innerHTML = `
    <div><span class="label">theme</span> ${anchor.theme}</div>
    <div><span class="label">their words</span> ${anchor.user_phrases
      .map((p) => `<span class="${p.source === "life" ? "ok" : ""}">“${p.phrase}”</span>`).join(", ")}
      ${anchor.grounded ? "" : `<b class="bad">ungrounded</b>`}</div>
    <div><span class="label">lands on</span> ${anchor.resolution_beat}</div>`;
}

// -- the reading -------------------------------------------------------------

function onEvent(event) {
  switch (event.type) {
    case "session_start":
      setStatus(`seed ${event.seed}`, "ok");
      $("seed").value = event.seed; // so a bad reading can be reproduced exactly
      break;
    case "flip":
      renderTable();
      break;
    case "reader_done":
      // Before they answer: the question is on the map the moment it is asked,
      // ringed already if it reached too far.
      renderStaircase(event.text);
      break;
    case "gate":
      renderGate(event.gate, null);
      renderStaircase();
      break;
    case "flip_decision":
      renderGate(event.gate, event.decision);
      break;
    case "anchor":
      renderAnchor(event.anchor);
      break;
    case "closed":
      renderStaircase();
      break;
    default:
      break;
  }
}

function onStart() {
  $("spread").innerHTML = "";
  $("gate").textContent = "—";
  $("anchor").textContent = "not committed yet";
  // Every card, face down, before a word is said.
  renderTable();
}

async function main() {
  ui = await mountSession({
    onEvent,
    onStart,
    onDebug: (event) => {
      $("debug-payload").textContent = JSON.stringify(event, null, 2);
    },
  });
  setStatus(`${ui.pack.name}, ${ui.pack.cards.length} cards`);
}

main().catch((error) => setStatus(`pack failed to load: ${error.message}`, "bad"));
