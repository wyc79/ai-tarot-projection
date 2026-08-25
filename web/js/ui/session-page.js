/**
 * The M2 debug UI. All DOM work lives here; the engine underneath it never
 * touches the document.
 *
 * It shows the machinery on purpose -- the flip gate's verdict and reason, the
 * committed anchor, and the fully assembled prompt before it is sent. Those are
 * the three things that need to be visible while iterating on the reader in M3.
 */

import { loadPack } from "../pack.js";
import { makeLlmClient, DEFAULT_CONFIG, PROVIDERS } from "../llmClient.js";
import { makeStorage, memoryBackend } from "../storage.js";
import { startReading } from "../engine/reading.js";
import { describeSession, loadHistory, toJson, toMarkdown } from "../engine/journal.js";
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
    provider: $("provider").value,
    mode: $("mode").value,
    relayBase: $("relay-base").value,
    chatModel: $("chat-model").value,
    judgeModel: $("judge-model").value,
  });
}

/** Hand the file to the browser. Served locally, so a blob link is enough. */
function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function filenameFor(session, extension) {
  return `reading-${new Date(session.started_at).toISOString().slice(0, 10)}-${session.seed}.${extension}`;
}

function saveSession(session, kind) {
  if (kind === "md") {
    download(filenameFor(session, "md"), toMarkdown(pack, session), "text/markdown");
  } else {
    download(filenameFor(session, "json"), toJson(session), "application/json");
  }
}

function refreshHistory() {
  const saved = loadHistory(store);
  const picker = $("history");
  picker.innerHTML = "";
  for (const session of saved) {
    picker.append(new Option(describeSession(session), session.session_id));
  }
  const has = saved.length > 0;
  $("history-md").disabled = !has;
  $("history-json").disabled = !has;
  return saved;
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
  addLine("error", error.hint ? `${code}: ${error.message}\n↳ ${error.hint}` : `${code}: ${error.message}`);
  console.error(error);
}

// -- rendering ---------------------------------------------------------------

function renderFlip(card, position) {
  const slot = document.createElement("figure");
  slot.className = "slot";
  // No caption describing the picture. A printed description is something to
  // agree with, and agreeing is not projecting -- whatever they say about the
  // card should come from looking at it, not from reading a sentence about it.
  // The line survives as alt text, where it belongs.
  slot.innerHTML = `<img src="${pack.imageUrl(card)}" alt="${card.imagery_line}">
    <figcaption><strong>${card.name}</strong><br>
    <span class="label">${position}</span></figcaption>`;
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
      // Downloadable from the first turn: an abandoned reading is often the
      // one worth keeping.
      $("save-md").disabled = false;
      $("save-json").disabled = false;
      refreshHistory();
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
      // The label is written before close() runs, so it would otherwise keep
      // calling a finished reading unfinished until the next reload.
      refreshHistory();
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
  for (const [id, entry] of Object.entries(PROVIDERS)) {
    $("provider").append(new Option(entry.label, id));
  }
  $("provider").value = c.provider;
  // Switching provider swaps the model ids too: they are never portable between
  // providers, and a stale one reads as "wrong key" until you look closely.
  $("provider").addEventListener("change", () => {
    const entry = PROVIDERS[$("provider").value];
    $("chat-model").value = entry.defaultModel;
    $("judge-model").value = entry.defaultModel;
    saveConfig();
  });
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
  $("save-md").addEventListener("click", () => saveSession(reading.session, "md"));
  $("save-json").addEventListener("click", () => saveSession(reading.session, "json"));
  for (const [id, kind] of [["history-md", "md"], ["history-json", "json"]]) {
    $(id).addEventListener("click", () => {
      const chosen = loadHistory(store).find((s) => s.session_id === $("history").value);
      if (chosen) saveSession(chosen, kind);
    });
  }
  refreshHistory();
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
