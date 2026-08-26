/**
 * The wiring both reading pages need, and none of what makes them different.
 *
 * index.html is the styled table and debug.html is the machinery, and what they
 * have in common turns out to be the whole of the session plumbing: where the
 * key is kept and whether it survives a refresh, which provider and model, the
 * journal exports, the reply form, and the ended/afterglow flow that decides
 * whether the input is live. All of that lives here once, keyed on element ids
 * the two pages share, rather than in two copies drifting apart.
 *
 * What stays with the page is what the page IS -- the debug panels on one side,
 * the card table and its animation on the other. Those arrive as hooks.
 *
 * The engine is untouched by any of it: this module listens to startReading's
 * event stream exactly as the one page used to, and nothing below the UI layer
 * knows there are two pages now.
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

/** A message about the session itself. Each page styles the bar its own way. */
export function setStatus(text, cls = "") {
  $("status").textContent = text;
  $("status-bar").className = `status-bar ${cls}`;
}

export function addLine(who, text) {
  const line = document.createElement("p");
  line.className = `line ${who}`;
  line.textContent = text;
  $("transcript").append(line);
  line.scrollIntoView({ block: "end" });
  return line;
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

/**
 * @param {object} [options]
 * @param {string} [options.packDir]
 * @param {(event: object) => void} [options.onEvent]  page rendering, after the shared handling
 * @param {(reading: object) => void} [options.onStart]  a reading exists; clear and prepare
 * @param {(event: object) => void} [options.onDebug]  every assembled payload, pre-send
 * @returns {Promise<object>} the pack, the store, and the live reading
 */
export async function mountSession({
  packDir = "data",
  onEvent = () => {},
  onStart = () => {},
  onDebug = () => {},
} = {}) {
  const store = makeStorage();
  // The key gets its own storage so "remember on this device" is a real switch:
  // unchecked means a Map that dies with the tab, not a flag on a saved value.
  let keyStore = makeStorage(memoryBackend());
  let reading = null;
  let streamingLine = null;
  // Whether this reading has ever got a word out. A failure before that is a
  // reading that never began, and a page may want to undo whatever it showed.
  let spoke = false;

  const pack = await loadPack(packDir);

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

  /**
   * Errors go where the user is looking, not only into the status bar. The
   * first version reported them into the settings panel, which start()
   * collapses -- so a failed request looked exactly like no request at all.
   */
  function reportError(error) {
    // Drop the empty bubble left by a reader turn that never produced a token.
    if (streamingLine && !streamingLine.textContent) streamingLine.remove();
    streamingLine = null;
    const code = error.code ?? error.name ?? "error";
    // The hint goes in the bar as well as the transcript. It is the half that
    // says what to go and do, and the transcript is not always the thing still
    // on screen once a failed reading has been taken back off it.
    setStatus(error.hint ? `${code}: ${error.message} — ${error.hint}` : `${code}: ${error.message}`, "bad");
    addLine("error", error.hint ? `${code}: ${error.message}\n↳ ${error.hint}` : `${code}: ${error.message}`);
    console.error(error);
    // A first turn that failed leaves a page showing a reading that does not
    // exist, with no way back to the button that starts one. The styled page
    // returns to its door on this; the debug page, whose start button never
    // goes anywhere, ignores it.
    onEvent({ type: "reading_failed", error, spoke });
  }

  /**
   * Everything about an event that is true on both pages: the reader's words
   * arriving, and what the end of a reading does to the input. Whatever the
   * page draws for itself happens after, with the event unchanged.
   */
  function handleEvent(event) {
    switch (event.type) {
      case "reader_start":
        streamingLine = addLine("reader", "");
        break;
      case "reader_delta":
        if (streamingLine) streamingLine.textContent = event.full;
        break;
      case "reader_done":
        streamingLine = null;
        spoke = true;
        // Downloadable from the first turn: an abandoned reading is often the
        // one worth keeping.
        $("save-md").disabled = false;
        $("save-json").disabled = false;
        refreshHistory();
        break;
      case "frame_dropped":
        setStatus("frame dropped — this is not a reading any more", "bad");
        break;
      case "closed":
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
        // Only after a real farewell: staying a while is taking back a door
        // that was offered, and nobody offered one to someone who walked out.
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
    onEvent(event);
  }

  const client = makeLlmClient({
    getKey: () => $("api-key").value.trim(),
    getConfig: config,
    onDebug,
  });

  async function start() {
    if (!$("api-key").value.trim()) return setStatus("no API key", "bad");
    saveConfig();
    $("transcript").innerHTML = "";
    spoke = false;

    reading = startReading({
      pack,
      client,
      storage: store,
      seed: $("seed")?.value.trim() || newSeed(),
      onEvent: handleEvent,
    });

    $("reply-form").hidden = false;
    $("end-reading").hidden = true;
    $("ended-row").hidden = true;
    $("settings").open = false;
    // The page's own table and panels, with a session to draw: every card is
    // face down on the table before a word is said.
    onStart(reading);
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

  for (const [id, entry] of Object.entries(PROVIDERS)) {
    $("provider").append(new Option(entry.label, id));
  }
  const c = config();
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

  return {
    pack,
    store,
    /** The live reading, or null before the first one is started. */
    get reading() {
      return reading;
    },
    start,
    refreshHistory,
  };
}
