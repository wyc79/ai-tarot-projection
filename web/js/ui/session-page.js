/**
 * The M2 debug UI. All DOM work lives here; the engine underneath it never
 * touches the document.
 *
 * It shows the machinery on purpose -- the flip gate's verdict and reason, the
 * committed anchor, and the fully assembled prompt before it is sent. Those are
 * the three things that need to be visible while iterating on the reader in M3.
 */

import { loadPack } from "../pack.js";
import { makeLlmClient, DEFAULT_CONFIG } from "../llmClient.js";
import { makeStorage, memoryBackend } from "../storage.js";
import { startReading } from "../engine/reading.js";
import { newSeed } from "../engine/rng.js";

const $ = (id) => document.getElementById(id);
const CONFIG_KEY = "config";
const KEY_KEY = "apikey";

const store = makeStorage();
// The key gets its own storage so "remember on this device" is a real switch:
// unchecked means a Map that dies with the tab, not a flag on a saved value.
let keyStore = makeStorage(memoryBackend());
let pack = null;
let reading = null;

function config() {
  return { ...DEFAULT_CONFIG, ...store.get(CONFIG_KEY, {}) };
}

function saveConfig() {
  store.set(CONFIG_KEY, {
    mode: $("mode").value,
    relayBase: $("relay-base").value,
    chatModel: $("chat-model").value,
    judgeModel: $("judge-model").value,
  });
}

function setStatus(text, cls = "") {
  $("status").textContent = text;
  $("status").className = `label ${cls}`;
  $("status-bar").className = `status-bar ${cls}`;
}

/**
 * Errors go where the user is looking, not only into the status bar. The first
 * version reported them into the settings panel, which start() collapses -- so
 * a failed request looked exactly like no request at all.
 */
function reportError(error) {
  // Drop the empty bubble left by a reader turn that never produced a token.
  if (streamingLine && !streamingLine.textContent) streamingLine.remove();
  streamingLine = null;
  const code = error.code ?? error.name ?? "error";
  setStatus(`${code}: ${error.message}`, "bad");
  addLine("error", `${code}: ${error.message}`);
  console.error(error);
}

// -- rendering ---------------------------------------------------------------

function renderFlip(card, position) {
  const slot = document.createElement("figure");
  slot.className = "slot";
  slot.innerHTML = `<img src="${pack.imageUrl(card)}" alt="${card.name}">
    <figcaption><strong>${card.name}</strong><br>
    <span class="label">${position}</span><br>
    <span class="slot-imagery">${card.imagery_line}</span></figcaption>`;
  $("spread").append(slot);
}

function addLine(who, text) {
  const line = document.createElement("p");
  line.className = `line ${who}`;
  line.textContent = text;
  $("transcript").append(line);
  line.scrollIntoView({ block: "end" });
  return line;
}

function renderGate(gate, decision) {
  $("gate").innerHTML = `
    <div><span class="label">depth</span> ${gate.disclosure_depth} &nbsp;
         <span class="label">flip_ready</span> ${gate.flip_ready} &nbsp;
         <span class="label">stakes</span> <b class="${gate.stakes !== "low" ? "bad" : ""}">${gate.stakes}</b></div>
    <div class="quote">${gate.reading_of_them ?? ""}</div>
    ${decision ? `<div class="${decision.flip ? "ok" : ""}">${decision.flip ? "FLIP" : "hold"} — ${decision.reason}</div>` : ""}`;
}

function renderAnchor(anchor) {
  $("anchor").innerHTML = `
    <div><span class="label">theme</span> ${anchor.theme}</div>
    <div><span class="label">their words</span> ${anchor.user_phrases.map((p) => `“${p}”`).join(", ")}</div>
    <div><span class="label">lands on</span> ${anchor.resolution_beat}</div>`;
}

// -- the reading -------------------------------------------------------------

let streamingLine = null;

function onEvent(event) {
  switch (event.type) {
    case "session_start":
      setStatus(`seed ${event.seed}`, "ok");
      $("seed").value = event.seed; // so a bad reading can be reproduced exactly
      break;
    case "flip":
      renderFlip(event.card, event.position);
      break;
    case "reader_start":
      streamingLine = addLine("reader", "");
      break;
    case "reader_delta":
      if (streamingLine) streamingLine.textContent = event.full;
      break;
    case "reader_done":
      streamingLine = null;
      break;
    case "gate":
      renderGate(event.gate, null);
      break;
    case "flip_decision":
      renderGate(event.gate, event.decision);
      break;
    case "anchor":
      renderAnchor(event.anchor);
      break;
    case "frame_dropped":
      setStatus("frame dropped — this is not a reading any more", "bad");
      break;
    case "closed":
      setStatus("reading closed", "ok");
      $("reply-form").hidden = true;
      break;
    default:
      break;
  }
}

const client = makeLlmClient({
  getKey: () => $("api-key").value.trim(),
  getConfig: config,
  onDebug: (event) => {
    $("debug-payload").textContent = JSON.stringify(event, null, 2);
  },
});

async function start() {
  if (!$("api-key").value.trim()) return setStatus("no API key", "bad");
  saveConfig();
  $("spread").innerHTML = "";
  $("transcript").innerHTML = "";
  $("gate").textContent = "—";
  $("anchor").textContent = "not committed yet";

  reading = startReading({
    pack,
    client,
    storage: store,
    seed: $("seed").value.trim() || newSeed(),
    onEvent,
  });

  $("reply-form").hidden = false;
  $("settings").open = false;
  try {
    await reading.begin();
  } catch (error) {
    reportError(error);
  }
}

async function say(text) {
  addLine("user", text);
  try {
    await reading.say(text);
  } catch (error) {
    reportError(error);
  }
}

// -- wiring ------------------------------------------------------------------

async function main() {
  pack = await loadPack("data");
  const c = config();
  $("mode").value = c.mode;
  $("relay-base").value = c.relayBase;
  $("chat-model").value = c.chatModel;
  $("judge-model").value = c.judgeModel;
  $("api-key").value = keyStore.get(KEY_KEY, "") || store.get(KEY_KEY, "");
  $("key-persist").checked = Boolean(store.get(KEY_KEY, ""));
  $("key-note").textContent = store.persistent ? "" : "(this browser blocks storage; memory only)";

  $("key-persist").addEventListener("change", () => {
    const key = $("api-key").value.trim();
    if ($("key-persist").checked) {
      store.set(KEY_KEY, key);
    } else {
      store.remove(KEY_KEY);
      keyStore = makeStorage(memoryBackend());
      keyStore.set(KEY_KEY, key);
    }
  });
  $("api-key").addEventListener("change", () => {
    const target = $("key-persist").checked ? store : keyStore;
    target.set(KEY_KEY, $("api-key").value.trim());
  });

  $("start").addEventListener("click", start);
  $("reply-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const text = $("reply").value.trim();
    if (!text) return;
    $("reply").value = "";
    say(text);
  });

  setStatus(`${pack.name}, ${pack.cards.length} cards`);
}

main().catch((error) => setStatus(`pack failed to load: ${error.message}`, "bad"));
