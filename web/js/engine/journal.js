/**
 * Turning a finished session into something you can keep. No DOM, no fetch.
 *
 * Two artefacts, for two different readers:
 *
 *   toMarkdown  the human one -- the cards, what you said about them, what the
 *               reader said back, and the step at the end. A keepsake.
 *   toJson      the working one -- the whole session including the seed and
 *               every flip-gate verdict, so a transcript can be re-run on the
 *               same cards after the prompt changes.
 */

import { STATE_VERSION } from "./state.js";

export const JOURNAL_SCHEMA_VERSION = 1;

function isoDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Exchanges belonging to one position, in order. */
function exchangesFor(session, position) {
  return session.exchanges.filter((e) => e.position === position);
}

/**
 * @param {object} pack
 * @param {object} session
 * @param {object} [options]
 * @param {number} [options.depth]  heading level for the reading's own title, so
 *   the same renderer produces a standalone keepsake and a section of the
 *   archive. Demoting the headings afterwards is not an option: the user's own
 *   words go into this file verbatim, and an answer that starts with "## " is
 *   an answer, not a heading.
 */
export function toMarkdown(pack, session, { depth = 1 } = {}) {
  const h1 = "#".repeat(depth);
  const h2 = "#".repeat(depth + 1);
  const lines = [`${h1} Reading — ${isoDate(session.started_at)}`, ""];
  // Where the cards came from, and it is not decoration: a dealt reading can be
  // re-run from its seed and a reading off someone's own deck cannot be re-run
  // at all. Printing a seed on one of those would be an invitation to try.
  lines.push(session.card_source === "physical"
    ? `${pack.name} · your own deck`
    : `${pack.name} · seed \`${session.seed}\``, "");

  if (session.anchor) {
    lines.push(`**What it was about:** ${session.anchor.theme}`, "");
  }

  // The reader's last turn, when nobody answered it. Every other one is printed
  // as the question above the answer it got; this one has no answer to sit
  // above, so it goes at the end of whichever section the conversation had
  // reached -- which is the section the last recorded exchange is in. Nothing
  // recorded at all means the reading got as far as the opening question and no
  // further. Null when there is no such turn, so no section is opened for it.
  const pending = session.pending_question?.trim();
  const pendingIn = pending ? session.exchanges.at(-1)?.position ?? "opening" : null;
  const printPending = (position) => {
    if (position === pendingIn) lines.push(pending, "");
  };

  // The turn before anything was dealt belongs in the record too: what they
  // said they came for is part of the reading, and sometimes the best part.
  const opening = exchangesFor(session, "opening");
  if (opening.length || pendingIn === "opening") {
    lines.push(`${h2} Before the cards`, "");
    for (const exchange of opening) {
      if (exchange.q) lines.push(exchange.q.trim(), "");
      lines.push(`**You:** ${exchange.a.trim()}`, "");
    }
    printPending("opening");
  }

  const renderCard = (entry) => {
    const card = pack.card(entry.card_id);
    const position = pack.position(entry.position);
    lines.push(`${h2} ${position?.label ?? entry.position} — ${card.name}`, "");
    lines.push(`> ${card.imagery_line}`, "");
    for (const exchange of exchangesFor(session, entry.position)) {
      if (exchange.q) lines.push(exchange.q.trim(), "");
      lines.push(`**You:** ${exchange.a.trim()}`, "");
    }
    printPending(entry.position);
  };

  // Every card that turned, in the order it turned, the fourth one included.
  // It used to need its own handling down the page, because it arrived after an
  // ending and the file had to show two of them. There is one ending now.
  for (const entry of session.cards) renderCard(entry);

  const offFrame = exchangesFor(session, "off_frame");
  if (offFrame.length) {
    lines.push(`${h2} After the frame was dropped`, "");
    for (const exchange of offFrame) {
      if (exchange.q) lines.push(exchange.q.trim(), "");
      lines.push(`**You:** ${exchange.a.trim()}`, "");
    }
    printPending("off_frame");
  }

  if (session.closing_reflection) {
    lines.push(`${h2} The step`, "", session.closing_reflection.trim(), "");
  }

  // The card that stayed with the deck. Worth a line in the keepsake for the
  // same reason it gets one in the closing beat: it is the reason to come back,
  // and a spread that quietly shows three cards where four were dealt looks
  // like something went wrong.
  const turned = new Set(session.cards.map((c) => c.position));
  const down = session.deal.filter((d) => !turned.has(d.position));
  if (down.length && session.closed) {
    lines.push(`_${down.length === 1 ? "One card" : `${down.length} cards`} stayed with the deck.`
               + " Still there next time._", "");
  }

  for (const [position, heading] of [["afterward", `${h2} After that`],
                                     ["afterglow", `${h2} A while longer`]]) {
    const after = exchangesFor(session, position);
    if (!after.length) continue;
    lines.push(heading, "");
    for (const exchange of after) {
      if (exchange.q) lines.push(exchange.q.trim(), "");
      lines.push(`**You:** ${exchange.a.trim()}`, "");
    }
    printPending(position);
  }

  if (session.farewell) lines.push(session.farewell.trim(), "");
  if (session.safety_state === "drop_frame") {
    lines.push("---", "", "_This reading stopped being a reading partway through._", "");
  }
  return lines.join("\n");
}

/** Everything, for re-running a transcript against a changed prompt. */
export function toJson(session) {
  return JSON.stringify({ schema_version: JOURNAL_SCHEMA_VERSION, session }, null, 2);
}

/**
 * Everything this browser is holding, in one file, newest first.
 *
 * Named for what it is rather than for what is in it today. There is no stored
 * profile yet -- tier-3 user memory is M6 -- and when there is, it becomes
 * another section of this same document rather than a second export beside it.
 *
 * It opens on a warning because of what it is: twenty readings is twenty
 * sessions of someone saying true things about their life, in their own words,
 * with the questions that got them there. The per-session keepsake is something
 * a person chose to keep at the end of one conversation. This is the whole
 * drawer, and it should say so before the first line of it.
 *
 * @param {object} pack
 * @param {object[]} sessions  as loadHistory returns them: newest first
 * @param {object} [options]
 * @param {number} [options.now]  the export's own timestamp, injectable so a
 *   test can pin it
 */
export function toArchive(pack, sessions, { now = Date.now() } = {}) {
  const lines = [
    "# AI Tarot Projection — every reading saved in this browser",
    "",
    "> **Handle this the way you would handle a diary, because that is what it is.**",
    "> Every reading below is a record of things you said about your own life, in your",
    "> own words, with the questions that got you there. Nothing in it left your browser",
    "> except to the model you brought the key for. Where you put this file, it stays.",
    "",
  ];

  if (!sessions.length) {
    lines.push(`_Nothing saved yet. Exported ${isoDate(now)}._`, "");
    return lines.join("\n");
  }

  const oldest = isoDate(Math.min(...sessions.map((s) => s.started_at)));
  const newest = isoDate(Math.max(...sessions.map((s) => s.started_at)));
  lines.push(`_${sessions.length} reading${sessions.length === 1 ? "" : "s"}, `
             + `${oldest === newest ? oldest : `${oldest} to ${newest}`}. `
             + `Exported ${isoDate(now)}._`, "");

  // What is in here, before the twenty of them start. The same label the
  // readings picker uses, so the file and the page name a session alike.
  lines.push("## Contents", "");
  for (const session of sessions) lines.push(`- ${describeSession(session)}`);
  lines.push("");

  for (const session of sessions) {
    lines.push("---", "");
    // Demoted one level: the readings are sections of this document, and their
    // own headings have to sit under its title rather than beside it.
    lines.push(toMarkdown(pack, session, { depth: 2 }));
  }
  return lines.join("\n");
}

/** A short label for a saved reading, built from what it was about. */
export function describeSession(session) {
  const when = isoDate(session.started_at);
  const what = session.anchor?.theme ?? session.exchanges[0]?.a ?? "no answers yet";
  const short = what.length > 44 ? `${what.slice(0, 44)}…` : what;
  return `${when} · ${short}${session.closed ? "" : " (unfinished)"}`;
}

export const HISTORY_KEY = "sessions";
export const HISTORY_LIMIT = 20;

/**
 * Keep the session in a capped history, newest first, replacing any earlier
 * save of the same one. Called on every turn rather than at the end, because
 * the readings worth keeping are exactly the ones that go somewhere unexpected
 * and get abandoned there.
 */
export function saveToHistory(storage, session, limit = HISTORY_LIMIT) {
  const previous = storage.get(HISTORY_KEY, []) ?? [];
  const rest = previous.filter((s) => s.session_id !== session.session_id);
  const next = [structuredClone(session), ...rest].slice(0, limit);
  storage.set(HISTORY_KEY, next);
  return next;
}

export function loadHistory(storage) {
  // Sessions from an older shape are dropped rather than upgraded. They cannot
  // be rendered -- the table, the ending, the tail all moved -- and a reader
  // that half-renders one is worse than a list that is one reading shorter.
  return (storage.get(HISTORY_KEY, []) ?? [])
    .filter((s) => s.schema_version === STATE_VERSION);
}
