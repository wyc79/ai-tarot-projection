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
import { defaultRelayBase } from "../relayBase.js";
import { makeLlmClient, DEFAULT_CONFIG, PROVIDERS } from "../llmClient.js";
import { makeStorage, memoryBackend } from "../storage.js";
import { MEANINGS_REQUEST, startReading } from "../engine/reading.js";
import { describeSession, loadHistory, toArchive, toJson, toMarkdown } from "../engine/journal.js";
import { newSeed } from "../engine/rng.js";

const $ = (id) => document.getElementById(id);
const CONFIG_KEY = "config";
const KEY_KEY = "apikey";
/** Long enough for a cold Worker, short enough that Begin still feels pressed. */
const HEALTH_TIMEOUT_MS = 4000;

/** A message about the session itself. Each page styles the bar its own way. */
export function setStatus(text, cls = "") {
  $("status").textContent = text;
  $("status-bar").className = `status-bar ${cls}`;
}

/**
 * Take the message down. Every complaint this module makes is about something
 * on screen that can be changed, so touching that thing is the answer to it --
 * a red line left standing beside a field that has since been fixed is worse
 * than no line at all.
 */
export function clearStatus() {
  setStatus("");
}

/**
 * Put a settings field where it can be seen and typed into.
 *
 * The two pages fold the same fields up differently -- index.html buries the
 * relay and model boxes in an Advanced <details> inside the settings one, the
 * debug page has them all at the top level -- so walk whatever chain of
 * <details> this page happened to wrap the field in, rather than naming
 * panels that only exist on one of them.
 */
export function revealField(id) {
  const field = $(id);
  if (!field) return;
  for (let box = field.closest("details"); box; box = box.parentElement?.closest("details")) {
    box.open = true;
  }
  field.focus();
}

/** How near the bottom still counts as being at it. About one line. */
const STUCK_PX = 48;

/**
 * Whether the transcript is sitting at its bottom, asked BEFORE the thing that
 * is about to grow it -- afterwards the answer is gone.
 *
 * Not exactly the bottom: nobody parks on the last pixel, and a fractional
 * scrollHeight rounded the wrong way would otherwise strand someone one pixel
 * off it for the rest of the reading.
 */
function stuckToBottom() {
  const t = $("transcript");
  return t.scrollHeight - t.scrollTop - t.clientHeight <= STUCK_PX;
}

/**
 * The pane, not the page. scrollIntoView asks the browser to bring an element
 * into view and lets it choose which ancestor to move, which on a phone is the
 * layout the card table is pinned inside -- and the table holding its place is
 * the one thing this layout exists to do.
 */
function toBottom() {
  const t = $("transcript");
  t.scrollTop = t.scrollHeight;
}

export function addLine(who, text) {
  const stuck = stuckToBottom();
  const line = document.createElement("p");
  line.className = `line ${who}`;
  line.textContent = text;
  $("transcript").append(line);
  // Unless they had scrolled up, in which case they are rereading something and
  // being dragged back down is the rudest thing this page could do to them.
  if (stuck) toBottom();
  return line;
}

/**
 * Three dots where the answer will be.
 *
 * `reader_start` is not the moment the turn was asked for: the gate judge runs
 * first, and on a turn that flips a card the anchor judge runs too, so several
 * seconds pass with nothing on screen and a live input still showing its
 * placeholder. That silence is what makes a person send again. This goes up the
 * instant the UI calls say() -- which needs no engine event, because the UI is
 * the thing that pressed the button.
 *
 * It is the same bubble the reply arrives in, so the first token lands where
 * the dots were rather than under them.
 */
function addPendingLine() {
  const line = addLine("reader pending", "");
  line.setAttribute("role", "status");
  line.setAttribute("aria-label", "the reader is thinking");
  for (let i = 0; i < 3; i += 1) {
    const dot = document.createElement("span");
    dot.className = "dot";
    line.append(dot);
  }
  // The dots are what gives the bubble its height, and they go in after addLine
  // has already measured and scrolled.
  if (stuckToBottom()) toBottom();
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

function today() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * @param {object} [options]
 * @param {string} [options.packDir]
 * @param {(event: object) => void} [options.onEvent]  page rendering, after the shared handling
 * @param {(reading: object) => void} [options.onStart]  a reading exists; clear and prepare
 * @param {(event: object) => void} [options.onDebug]  every assembled payload, pre-send
 * @param {(request: {position: string, taken: string[]}) => Promise<string>} [options.identifyCard]
 *   Physical mode: how this page asks what they just turned over. A page that
 *   does not supply one cannot offer the mode.
 * @returns {Promise<object>} the pack, the store, and the live reading
 */
export async function mountSession({
  packDir = "data",
  onEvent = () => {},
  onStart = () => {},
  onDebug = () => {},
  identifyCard = null,
} = {}) {
  const store = makeStorage();
  // The key gets its own storage so "remember on this device" is a real switch:
  // unchecked means a Map that dies with the tab, not a flag on a saved value.
  let keyStore = makeStorage(memoryBackend());
  let reading = null;
  let streamingLine = null;
  // The dots. Put up the moment a turn is asked for and taken down by the first
  // token of the answer -- see showPending.
  let pendingLine = null;
  // Whether the traditional meanings have been asked for. Once, per reading.
  let meaningsSpent = false;
  // Whether this reading has ever got a word out. A failure before that is a
  // reading that never began, and a page may want to undo whatever it showed.
  let spoke = false;

  const pack = await loadPack(packDir);

  function config() {
    const saved = { ...DEFAULT_CONFIG, ...store.get(CONFIG_KEY, {}) };
    // Whatever they typed wins. Blank is not a choice, it is the absence of one,
    // and it resolves to wherever this deployment's relay is -- so the hosted
    // page arrives already pointed at the Worker and a stranger never sees a URL
    // they would have had to be told.
    return { ...saved, relayBase: saved.relayBase || defaultRelayBase(location.origin) };
  }

  function saveConfig() {
    store.set(CONFIG_KEY, {
      cardSource: $("card-source").value,
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
    $("save-all").disabled = !has;
    return saved;
  }

  /**
   * Which settings box a failure is actually about, or null for one that is
   * not about a setting at all. A rate limit and a truncated reply are real
   * errors and nothing in this panel fixes either, so they leave it shut.
   *
   * The mapping is read off the codes llmClient already assigns; nothing here
   * re-decides what a failure was.
   */
  function fieldForError(error) {
    switch (error.code) {
      case "invalid_key":
      case "missing_key":
        return "api-key";
      case "unknown_provider":
        return "provider";
      case "unknown_model": {
        // Two boxes, one code. The provider usually quotes the id it did not
        // recognise, which is the only thing that tells them apart -- and when
        // both boxes hold the same id there is nothing to tell apart anyway.
        const judge = $("judge-model").value.trim();
        return judge && judge !== $("chat-model").value.trim() && error.message.includes(judge)
          ? "judge-model"
          : "chat-model";
      }
      case "connection_failed":
        // In direct mode the browser went to the provider; the relay URL is
        // not what failed, and the way out is the mode itself.
        return $("mode").value === "relay" ? "relay-base" : "mode";
      case "origin_denied":
      case "upstream_unreachable":
        return "relay-base";
      default:
        return null;
    }
  }

  function showPending() {
    if (!pendingLine) pendingLine = addPendingLine();
  }

  /** The dots come down, whether or not anything is going to replace them. */
  function clearPending() {
    pendingLine?.remove();
    pendingLine = null;
  }

  /**
   * The pending line, promoted to the streaming one. Same element, emptied and
   * out of its pending class, so the reply appears where the dots were instead
   * of below them and nothing on screen jumps.
   */
  function takePending() {
    const line = pendingLine;
    pendingLine = null;
    if (!line) return null;
    line.className = "line reader";
    line.removeAttribute("role");
    line.removeAttribute("aria-label");
    line.textContent = "";
    return line;
  }

  /**
   * Errors go where the user is looking, not only into the status bar. The
   * first version reported them into the settings panel, which start()
   * collapses -- so a failed request looked exactly like no request at all.
   */
  function reportError(error) {
    // Whatever was on screen standing in for the answer that never came: the
    // dots, or the empty bubble left by a turn that produced no token.
    clearPending();
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
    // Last, so the page has finished putting itself back together before the
    // cursor lands: the styled page returns to its door on the event above,
    // and focus taken before that is focus inside a section on its way out.
    const field = fieldForError(error);
    if (field) revealField(field);
  }

  /**
   * Everything about an event that is true on both pages: the reader's words
   * arriving, and what the end of a reading does to the input. Whatever the
   * page draws for itself happens after, with the event unchanged.
   */
  function handleEvent(event) {
    switch (event.type) {
      // The two lines that open a reading, straight from the pack. No stream to
      // follow and nothing to wait for, so they are appended whole.
      case "reader_scripted":
        if (event.role === "note") {
          // The app speaking, not the reader in character. It says what this is
          // and who is talking, which the transcript never did -- the intro says
          // it, and the intro is gone by the time anyone is reading this.
          addLine("note", event.text);
          break;
        }
        addLine("reader", event.text);
        // As reader_done: there is a session on the record now, and a reading
        // abandoned early is often the one worth keeping.
        $("save-md").disabled = false;
        $("save-json").disabled = false;
        refreshHistory();
        // Deliberately not `spoke`. That flag asks whether the reading ever got
        // a word out of the model, and it is what sends a first-turn failure
        // back to the door where the key is. Scripted lines are the app talking
        // to itself; they must not make a broken key look like a live reading.
        break;
      case "reader_start":
        streamingLine = takePending() ?? addLine("reader", "");
        break;
      // The bubble grows under the fold otherwise: addLine scrolled it into
      // view once, while it was still empty, and streaming did the rest of the
      // work below the bottom of the pane. Every reply ended in a drag.
      case "reader_delta": {
        const stuck = stuckToBottom();
        if (streamingLine) streamingLine.textContent = event.full;
        if (stuck) toBottom();
        break;
      }
      case "reader_done":
        // Once more at the end: the last delta is measured before it wraps.
        if (stuckToBottom()) toBottom();
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
        // From here on, and in whichever row is showing.
        offerMeanings(true);
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

  /**
   * The reply form, while a turn is in flight.
   *
   * The engine refuses a second turn on its own now, so this is not what makes
   * the invariant true -- it is what the person sees. A form that takes a
   * second message and then throws it away is worse than one that visibly is
   * not taking anything, and the throwing-away is what a stranger reads as the
   * reader ignoring them.
   *
   * `inert` alone, the way the picker uses it, is not enough here: that one
   * parks a form behind something else, and this is the thing being looked at
   * straight after Send. So the controls are disabled, which says it to the
   * browser and to a screen reader, and aria-busy says which half of the pair
   * it is.
   *
   * Disabling the box takes the focus with it, so the cursor goes back -- but
   * only if nothing has claimed it in the meantime. A failed turn sends it into
   * the settings field that is actually wrong, and that outranks getting back
   * to a reply which cannot be sent until the setting is fixed.
   */
  function lockReply(busy) {
    const form = $("reply-form");
    if (busy) form.setAttribute("aria-busy", "true");
    else form.removeAttribute("aria-busy");
    $("reply").disabled = busy;
    form.querySelector("button[type=submit]").disabled = busy;
    if (!busy && !form.hidden && document.activeElement === document.body) $("reply").focus();
  }

  /**
   * The identify step, with the reply form switched off around it.
   *
   * The picker is a row in the chat column, not a layer over it, so without
   * this the input underneath stays live while a turn is parked waiting for an
   * answer. A second say() over one session is refused by the engine now, but
   * being refused is not the same as being told not to: the form has to say it
   * is not the thing to answer. The form belongs to this module, the picker
   * belongs to the page, and the engine knows about neither.
   */
  const askForCard = identifyCard && (async (request) => {
    const form = $("reply-form");
    form.inert = true;
    try {
      return await identifyCard(request);
    } finally {
      form.inert = false;
    }
  });

  const client = makeLlmClient({
    getKey: () => $("api-key").value.trim(),
    getConfig: config,
    onDebug,
  });

  /** A refusal that says what is wrong and leaves the cursor in the fix. */
  function refuse(message, fieldId) {
    setStatus(message, "bad");
    revealField(fieldId);
    return false;
  }

  /**
   * Whether the relay in the box answers at all. A GET to /v1/health, which
   * reaches no provider and costs nothing; the point is only to tell "that URL
   * is wrong" apart from every failure that looks like it once a reading is
   * already running on top of it.
   *
   * Raced against a clock because the failure being caught includes a host
   * that accepts the connection and then says nothing, and Begin is a button
   * that must always come back.
   *
   * @returns {Promise<string|null>} what went wrong, or null if it answered
   */
  async function relayUnreachable() {
    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`no answer in ${HEALTH_TIMEOUT_MS / 1000}s`)), HEALTH_TIMEOUT_MS);
    });
    try {
      const body = await Promise.race([client.health(), timeout]);
      return body?.ok ? null : "something answered there, but not a relay";
    } catch (error) {
      return error.message;
    }
  }

  /**
   * Everything wrong with the settings that can be found out for free, in the
   * order someone runs into it. Each answer names the field, opens whatever
   * this page folded it into, and puts the cursor in it.
   *
   * What is deliberately not checked here is whether the key works. The first
   * real turn already says invalid_key through reportError, a second later and
   * with the same words; asking the provider first only pays twice for it.
   */
  async function preflight() {
    if (!$("api-key").value.trim()) {
      return refuse("no API key — paste one in Settings, then Begin", "api-key");
    }
    if (!PROVIDERS[$("provider").value]) {
      return refuse(`no such provider: ${$("provider").value}`, "provider");
    }
    for (const [id, name] of [["chat-model", "Chat model"], ["judge-model", "Judge model"]]) {
      if (!$(id).value.trim()) return refuse(`${name} is blank — every request has to name one`, id);
    }
    // Saved before the relay check rather than after all of them, because the
    // check has to ask the URL that is in the box: health() reads the stored
    // config, and a base typed but never saved would be checked in its old
    // form and then used in its new one.
    saveConfig();
    if ($("mode").value === "relay") {
      const why = await relayUnreachable();
      if (why) {
        return refuse(`the relay at ${config().relayBase || location.origin} could not be reached — ${why}`,
                      "relay-base");
      }
    }
    return true;
  }

  async function start() {
    if (!(await preflight())) return;
    // Whatever the last attempt complained about has been dealt with.
    clearStatus();
    $("transcript").innerHTML = "";
    // The element just went with the transcript; the variable would otherwise
    // still be holding it, and showPending() below would leave it at that.
    pendingLine = null;
    spoke = false;
    meaningsSpent = false;
    offerMeanings(false);

    reading = startReading({
      pack,
      client,
      storage: store,
      seed: $("seed")?.value.trim() || newSeed(),
      cardSource: $("card-source").value,
      identifyCard: askForCard,
      onEvent: handleEvent,
    });

    $("reply-form").hidden = false;
    $("end-reading").hidden = true;
    $("ended-row").hidden = true;
    $("settings").open = false;
    // The page's own table and panels, with a session to draw: every card is
    // face down on the table before a word is said.
    onStart(reading);
    // No dots here. The opening is scripted now, so begin() waits on nothing
    // and the two lines are on screen before anyone could see an indicator --
    // dots put up here would never come down, because no reader_start follows.
    // The lock stays: begin() is a turn entry point like say(), and the engine
    // refuses a second one either way.
    lockReply(true);
    try {
      await reading.begin();
    } catch (error) {
      reportError(error);
    } finally {
      // In a finally on both of these: a turn that failed still has to give the
      // form back, or the one thing a person can do about an error -- say
      // something else -- is the thing the error took away.
      lockReply(false);
    }
  }

  /**
   * The traditional meanings, offered once after the close.
   *
   * The persona allows them when asked and never offers, which leaves the
   * reading most people arrived expecting behind a question they do not know
   * they may ask. The button is the asking, and it lives in the reply form --
   * so it is there through the tail, gone with the form at the farewell, and
   * back with it if they stay a while. The engine refuses the turn after the
   * goodbye for the same reason: the farewell is the last thing the reader
   * says. It goes away for good once used, because a standing offer to explain
   * the deck is the deck asking to be the authority again, which is the one
   * thing this reader is built not to be.
   */
  function offerMeanings(on) {
    for (const button of document.querySelectorAll(".meanings")) {
      button.hidden = meaningsSpent || !on;
    }
  }

  async function askMeanings() {
    meaningsSpent = true;
    offerMeanings(false);
    // On screen as they will read it in the keepsake: the engine records the
    // same string as their side of the exchange, so the two cannot drift.
    addLine("user", MEANINGS_REQUEST);
    showPending();
    lockReply(true);
    try {
      await reading.meanings();
    } catch (error) {
      reportError(error);
    } finally {
      lockReply(false);
    }
  }

  async function say(text) {
    addLine("user", text);
    showPending();
    lockReply(true);
    try {
      await reading.say(text);
    } catch (error) {
      reportError(error);
    } finally {
      lockReply(false);
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
  $("card-source").value = c.cardSource;
  $("card-source").addEventListener("change", saveConfig);
  $("mode").value = c.mode;
  $("relay-base").value = c.relayBase;
  $("chat-model").value = c.chatModel;
  $("judge-model").value = c.judgeModel;
  $("api-key").value = keyStore.get(KEY_KEY, "") || store.get(KEY_KEY, "");
  $("key-persist").checked = Boolean(store.get(KEY_KEY, ""));
  $("key-note").textContent = store.persistent ? "" : "(this browser blocks storage; memory only)";
  // Opened, never closed. The one thing a stranger has to do before anything
  // works is behind this panel, and on a first visit the panel is shut. What
  // decides it is whether a key came back from either store -- the remembered
  // one or the tab's own -- and not a flag of its own, so there is nothing to
  // keep in step with the key. Only ever opening it also leaves the debug page
  // alone, where the markup opens it and the Start button is inside it.
  if (!$("api-key").value) $("settings").open = true;

  // The way back out of a header panel.
  //
  // Open, one of these takes a full row and pushes the table down, and the only
  // way to shut it was tapping the pill again -- which is not a thing a stranger
  // knows. Settings opens itself when there is no key, so it is also the first
  // thing one meets.
  //
  // "Header panel" means a <details> that is a direct child of .top, and that
  // is the whole of the scoping: the Advanced box nested inside Settings is not
  // one, and the debug page has no .top at all, so it keeps its markup-opened
  // panels and none of this behaviour.
  const headerPanels = [...document.querySelectorAll(".top > details")];

  /** Shut one, and leave the keyboard somewhere it can still be. */
  function closePanel(panel) {
    if (!panel.open) return;
    const held = panel.contains(document.activeElement);
    panel.open = false;
    // Whatever had the focus has just gone inside a closed box, so it goes to
    // the pill that box collapsed into. Only when the focus was in there:
    // Escape from the reply field must not move the cursor.
    if (held) panel.querySelector("summary").focus();
  }

  for (const panel of headerPanels) {
    // One at a time. Two open panels are two full rows off the top of the
    // table, and the second is never the one that was asked for.
    panel.addEventListener("toggle", () => {
      if (!panel.open) return;
      // open, not closePanel: they have just pressed the other summary, and
      // taking the focus off it would be answering a tap with a jump.
      for (const other of headerPanels) if (other !== panel) other.open = false;
    });
    // Walked to rather than named, so a third panel with a Done in it needs no
    // wiring of its own -- and so the button cannot be wired to the wrong one.
    for (const done of panel.querySelectorAll(".done")) {
      done.addEventListener("click", () => closePanel(done.closest("details")));
    }
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") headerPanels.forEach(closePanel);
  });

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

  // Editing the thing a message was about answers the message. Typing counts:
  // waiting for a blur to admit that a key has been pasted leaves the word
  // "no API key" beside a field full of dots.
  for (const id of ["api-key", "relay-base", "chat-model", "judge-model"]) {
    $(id).addEventListener("input", clearStatus);
  }
  for (const id of ["provider", "mode"]) {
    $(id).addEventListener("change", clearStatus);
  }

  $("start").addEventListener("click", start);
  $("save-md").addEventListener("click", () => saveSession(reading.session, "md"));
  $("save-json").addEventListener("click", () => saveSession(reading.session, "json"));
  // Everything at once. One file, and it opens on what it is -- see toArchive.
  $("save-all").addEventListener("click", () => {
    download(`ai-tarot-readings-${today()}.md`, toArchive(pack, loadHistory(store)), "text/markdown");
  });
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
  for (const button of document.querySelectorAll(".meanings")) {
    button.addEventListener("click", askMeanings);
  }

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
