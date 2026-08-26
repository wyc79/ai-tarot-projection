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

export const JOURNAL_SCHEMA_VERSION = 1;

function isoDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Exchanges belonging to one position, in order. */
function exchangesFor(session, position) {
  return session.exchanges.filter((e) => e.position === position);
}

export function toMarkdown(pack, session) {
  const lines = [`# Reading — ${isoDate(session.started_at)}`, ""];
  lines.push(`${pack.name} · seed \`${session.seed}\``, "");

  if (session.anchor) {
    lines.push(`**What it was about:** ${session.anchor.theme}`, "");
  }

  // The turn before anything was dealt belongs in the record too: what they
  // said they came for is part of the reading, and sometimes the best part.
  const opening = exchangesFor(session, "opening");
  if (opening.length) {
    lines.push("## Before the cards", "");
    for (const exchange of opening) {
      if (exchange.q) lines.push(exchange.q.trim(), "");
      lines.push(`**You:** ${exchange.a.trim()}`, "");
    }
  }

  const renderCard = (entry) => {
    const card = pack.card(entry.card_id);
    const position = pack.position(entry.position);
    lines.push(`## ${position?.label ?? entry.position} — ${card.name}`, "");
    lines.push(`> ${card.imagery_line}`, "");
    for (const exchange of exchangesFor(session, entry.position)) {
      if (exchange.q) lines.push(exchange.q.trim(), "");
      lines.push(`**You:** ${exchange.a.trim()}`, "");
    }
  };

  const isEpilogue = (c) => c.position === session.epilogue_position;
  const spread = session.cards.filter((c) => !isEpilogue(c));
  const epilogue = session.cards.find(isEpilogue);
  for (const entry of spread) renderCard(entry);

  // The beat the three cards ended on. Normally it is also the last thing in
  // the file and is written once, at the bottom. When the conversation carried
  // on and earned a fourth card it is not the last thing any more, and it
  // belongs here, where it was actually said.
  const firstBeat = spread[spread.length - 1]?.ai_reading?.trim();
  if (epilogue && firstBeat) lines.push("## The step", "", firstBeat, "");

  const afterward = exchangesFor(session, "afterward");
  if (afterward.length) {
    lines.push("## After that", "");
    for (const exchange of afterward) {
      if (exchange.q) lines.push(exchange.q.trim(), "");
      lines.push(`**You:** ${exchange.a.trim()}`, "");
    }
  }

  if (epilogue) renderCard(epilogue);

  const offFrame = exchangesFor(session, "off_frame");
  if (offFrame.length) {
    lines.push("## After the frame was dropped", "");
    for (const exchange of offFrame) {
      if (exchange.q) lines.push(exchange.q.trim(), "");
      lines.push(`**You:** ${exchange.a.trim()}`, "");
    }
  }

  if (session.closing_reflection) {
    lines.push(epilogue ? "## Where it actually ended" : "## The step", "",
               session.closing_reflection.trim(), "");
  }
  if (session.safety_state === "drop_frame") {
    lines.push("---", "", "_This reading stopped being a reading partway through._", "");
  }
  return lines.join("\n");
}

/** Everything, for re-running a transcript against a changed prompt. */
export function toJson(session) {
  return JSON.stringify({ schema_version: JOURNAL_SCHEMA_VERSION, session }, null, 2);
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
  return storage.get(HISTORY_KEY, []) ?? [];
}
