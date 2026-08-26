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
import { cardStanding, tableau } from "../engine/state.js";
import { describeSession, loadHistory, toJson, toMarkdown } from "../engine/journal.js";
import { newSeed } from "../engine/rng.js";
import { staircaseSvg } from "./staircase.js";

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
  if (!reading || !pack) return;
  for (const slot of tableau(reading.session)) {
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

function addLine(who, text) {
  const line = document.createElement("p");
  line.className = `line ${who}`;
  line.textContent = text;
  $("transcript").append(line);
  line.scrollIntoView({ block: "end" });
  return line;
}

/**
 * Where the current card is in its budget: spent, target, cap.
 *
 * The reasons say "3 exchanges on one card" and the budget is per position now,
 * so the number on its own does not tell you whether that is nearly done or
 * barely started. Asides are not in it, which is the point of them.
 */
function budgetLine() {
  if (!reading || !pack) return "";
  // One read of the card's standing, rather than three different ways of asking
  // the ledger the same question. The aside count in particular used to be
  // filtered here by hand, which made this the second place the rule lived.
  const { card, position, exchanges: spent, asides, budget } = cardStanding(reading.session);
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
  if (!reading || !pack) return;
  const svg = staircaseSvg(reading.session, pack, { pending });
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

let streamingLine = null;

function onEvent(event) {
  switch (event.type) {
    case "session_start":
      setStatus(`seed ${event.seed}`, "ok");
      $("seed").value = event.seed; // so a bad reading can be reproduced exactly
      break;
    case "flip":
      renderTable();
      break;
    case "reader_start":
      streamingLine = addLine("reader", "");
      break;
    case "reader_delta":
      if (streamingLine) streamingLine.textContent = event.full;
      break;
    case "reader_done":
      streamingLine = null;
      // Before they answer: the question is on the map the moment it is asked,
      // ringed already if it reached too far.
      renderStaircase(event.text);
      // Downloadable from the first turn: an abandoned reading is often the
      // one worth keeping.
      $("save-md").disabled = false;
      $("save-json").disabled = false;
      refreshHistory();
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
    case "frame_dropped":
      setStatus("frame dropped — this is not a reading any more", "bad");
      break;
    case "closed":
      renderStaircase();
      // The reading is finished. What is left is a short tail and a goodbye,
      // and the reader gets there on its own now.
      setStatus("reading closed — a little more, then goodbye", "ok");
      $("end-reading").hidden = false;
      // The label is written before close() runs, so it would otherwise keep
      // calling a finished reading unfinished until the next reload.
      refreshHistory();
      break;
    case "ended":
      setStatus(event.farewell ? "the reading ended" : "ended", "ok");
      $("reply-form").hidden = true;
      $("end-reading").hidden = true;
      // Only after a real farewell: staying a while is taking back a door that
      // was offered, and nobody offered one to someone who walked out.
      $("ended-row").hidden = !event.farewell;
      refreshHistory();
      break;
    case "afterglow":
      setStatus("still here — the reading is over, the conversation is not", "ok");
      $("ended-row").hidden = true;
      $("reply-form").hidden = false;
      $("end-reading").hidden = false;
      $("reply").focus();
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
  $("end-reading").hidden = true;
  $("ended-row").hidden = true;
  $("settings").open = false;
  // Every card, face down, before a word is said.
  renderTable();
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
  // Walking out. Available from the closing beat on, and different from the
  // farewell: this one does not say goodbye, it stops.
  $("end-reading").addEventListener("click", () => reading?.end());
  $("stay-a-while").addEventListener("click", () => reading?.stayAWhile());
  $("new-reading").addEventListener("click", start);

  setStatus(`${pack.name}, ${pack.cards.length} cards`);
}

main().catch((error) => setStatus(`pack failed to load: ${error.message}`, "bad"));
