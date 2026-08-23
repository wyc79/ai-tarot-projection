/**
 * Pack browser: every card with its imagery line and the three position
 * meanings side by side, so the pack content is reviewable by eye. Also pings
 * the relay, since this page needs no key and is the cheapest health check.
 */

import { loadPack } from "../pack.js";

const $ = (id) => document.getElementById(id);
const RELAY_KEY = "tarot:relay_base";

function renderCard(pack, card) {
  $("card-image").src = pack.imageUrl(card);
  $("card-image").alt = card.name;
  $("card-name").textContent = card.name;
  $("card-id").textContent = card.card_id;
  $("imagery-line").textContent = card.imagery_line;
  $("general").textContent = card.meanings.general;

  $("positions").innerHTML = "";
  for (const position of pack.positions) {
    const cell = document.createElement("div");
    cell.className = "position";
    cell.innerHTML = `<h3>${position.label}<span>${position.arc_role}</span></h3>
                      <p>${pack.meaning(card, position.id)}</p>`;
    $("positions").append(cell);
  }
}

async function checkRelay(base) {
  const target = `${base.replace(/\/$/, "")}/v1/health`;
  try {
    const response = await fetch(target);
    const body = await response.json();
    if (!body.ok) throw new Error("relay reported not ok");
    $("relay-status").textContent = `ok — providers: ${body.providers.join(", ")}`;
    $("relay-status").className = "ok";
  } catch (error) {
    $("relay-status").textContent = `unreachable (${error.message})`;
    $("relay-status").className = "bad";
  }
}

async function main() {
  const pack = await loadPack("data");
  $("pack-name").textContent = `${pack.name} — ${pack.cards.length} cards`;

  const picker = $("card-picker");
  for (const card of pack.cards) {
    picker.append(new Option(`${card.name}  ·  ${card.card_id}`, card.card_id));
  }
  picker.addEventListener("change", () => renderCard(pack, pack.card(picker.value)));
  renderCard(pack, pack.cards[0]);

  const relayInput = $("relay-base");
  relayInput.value = localStorage.getItem(RELAY_KEY) ?? "";
  $("relay-check").addEventListener("click", () => {
    localStorage.setItem(RELAY_KEY, relayInput.value);
    checkRelay(relayInput.value);
  });
  checkRelay(relayInput.value);
}

main().catch((error) => {
  $("pack-name").textContent = `pack failed to load: ${error.message}`;
  $("pack-name").className = "bad";
});
