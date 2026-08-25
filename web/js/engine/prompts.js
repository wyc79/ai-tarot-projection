/**
 * Prompt assembly. Runs in the browser, from pack data. No DOM, no fetch.
 *
 * This is the whole reason neither relay knows what tarot is: the persona, the
 * card meanings and the few-shots are static files the frontend fetches, so
 * changing how the reader sounds is a file save locally and a Pages deploy when
 * hosted. Nothing here ever reaches a relay as anything but an opaque payload.
 *
 * Anthropic rejects a trailing assistant message (the old prefill trick), and a
 * turn has to end on a user message, so a card turning over is written into the
 * transcript as a stage direction in the user role.
 */

import { currentCard } from "./state.js";

const RULES_WHEN_FRAME_DROPPED = `
## Right now: the frame is dropped

They have said something that a tarot reading has no business answering. You are
not a reader any more, for the rest of this conversation.

No cards. No imagery. No "the deck says". No closing ritual, and do not offer to
continue the reading. Talk to them like a person who just heard what they said.
Be plain, be brief, and point at real help -- a crisis line, a doctor, someone
who actually knows them. If they ask about the cards, say honestly that this
matters more than the cards do.`;

const RULES_WHEN_STAKES_HIGH = `
## Right now: real-world stakes

What they described has medical, legal or financial consequence. Stay in the
reading -- do not go cold on them -- but hand agency back explicitly in this
turn: the cards are useful for working out what they want, and this particular
question needs a professional or real information. Do not advise on the substance.

Say it once, plainly, and then get back to the reading. This is the only turn in
which you will say it; repeating it every time the subject comes up turns a
piece of honesty into a disclaimer they stop hearing.`;

function describeSpread(pack) {
  return pack.positions
    .map((p, i) => `${i + 1}. ${p.label} (${p.arc_role}) — ${p.prompt_hint}`)
    .join("\n");
}

function describeLedger(pack, session) {
  if (!session.cards.length) return "Nothing has been turned over yet.";
  return session.cards
    .map((entry) => {
      const card = pack.card(entry.card_id);
      const lines = [`- ${card.name} in ${entry.position}`];
      if (entry.user_projection) lines.push(`  they read it as: "${entry.user_projection}"`);
      if (entry.ai_reading) lines.push(`  you said: "${entry.ai_reading}"`);
      return lines.join("\n");
    })
    .join("\n");
}

function describeAnchor(session) {
  if (!session.anchor) return "";
  const { theme, user_phrases, resolution_beat } = session.anchor;
  return `
## What this reading is about

Committed after the first card, from their own words. Elaborate on it. Do not
contradict it, and do not quietly change the subject to something tidier.

- theme: ${theme}
- phrases they used earlier: ${user_phrases.map((p) => `"${p}"`).join(", ") || "(none recorded)"}
- where the last card should land: ${resolution_beat}

These phrases are a record of what they said once, not evidence that they say it
often. Reuse their language; do not tell them they keep saying it.`;
}

function describeCard(pack, session) {
  const entry = currentCard(session);
  if (!entry) return "";
  const card = pack.card(entry.card_id);
  const position = pack.positions.find((p) => p.id === entry.position);
  return `
## The card on the table

${card.name}, in the ${position.label} position (${position.arc_role} — ${position.prompt_hint}).

They can see the picture. They have not been given any words about it — no
caption, no description, nothing to agree with — so whatever they say is theirs.

If they freeze, this is the one line you may offer to get them looking:
"${card.imagery_line}". Only then, and never as an opening.

### What is actually in the picture

${card.details.map((d) => `- ${d}`).join("\n")}

This list is here so you can recognise whatever they point at. They are looking
at the card; you are not. When they mention something you can find above, you
can meet them on it exactly — which is the difference between a reader who is
paying attention and one who is performing.

It is not a script and not a thing to recite. Do not tell them what is in the
picture, do not count objects for them, and do not walk them through it. If they
point at something that is not on this list, believe them and ask about it: they
can see the card and you cannot.

### Traditional sense

Seasoning only — one sentence of it at most, and only after they have spoken:
- in this position: ${card.meanings[entry.position]}
- generally: ${card.meanings.general}

If they go blank, the two contrasting readings to offer as a forced choice come
from this position's sense and the general one. Never recite either.`;
}

/** The reader's system prompt for one turn. */
export function readerSystem({ pack, session, turn, handback = false }) {
  const parts = [
    pack.persona,
    `\n## The spread\n\n${describeSpread(pack)}`,
    `\n## Turned over so far\n\n${describeLedger(pack, session)}`,
    describeAnchor(session),
    describeCard(pack, session),
  ];

  if (session.safety_state === "drop_frame") {
    parts.push(RULES_WHEN_FRAME_DROPPED);
  } else if (handback) {
    parts.push(RULES_WHEN_STAKES_HIGH);
  }

  parts.push(TURN_INSTRUCTIONS[turn] ?? TURN_INSTRUCTIONS.respond);
  return parts.filter(Boolean).join("\n");
}

const TURN_INSTRUCTIONS = {
  invite: `
## This turn

The card has just turned over and they have not spoken about it yet. Name the
card and the position it landed in, then hand it straight to them: ask what it
looks like it is pointing at for them.

Do not interpret it first, and do not mention its traditional meaning at all
yet — you have not earned the right to, because they have not told you anything.`,

  respond: `
## This turn

They have just answered. Build on what they actually said — their words, their
image, the thing they repeated — and add at most one sentence of traditional
sense bent toward this card's position. Then ask one question that goes further
in, not sideways. Four sentences at the outside.`,

  bridge: `
## This turn

Two things, in one short turn, without a seam. First answer what they just said
— their words, one sentence of traditional sense at most. Then the next card
turns over: name it, and hand it to them the same way you handed them the first.
Do not interpret the new card. End on the question about it. Five sentences at
the outside.`,

  close: `
## This turn

This is the last thing you say. Close the reading: name what moved across the
three cards in their language, and turn it into one small concrete thing to
notice or do in the coming week. Something they could actually catch themselves
doing. Not a summary, not advice, not a list. Then stop — no offer to continue,
no invitation to draw again.`,
};

/** The transcript so far, as provider-neutral messages. */
export function readerMessages(pack, session, { stageDirection = null } = {}) {
  const messages = [];
  for (const exchange of session.exchanges) {
    if (exchange.q) messages.push({ role: "assistant", content: exchange.q });
    messages.push({ role: "user", content: exchange.a });
  }
  if (stageDirection) messages.push({ role: "user", content: `(${stageDirection})` });
  if (!messages.length) messages.push({ role: "user", content: "(the reading begins)" });
  return messages;
}

/** Stage direction for a card turning over, so the transcript stays coherent. */
export function flipDirection(pack, session) {
  const entry = currentCard(session);
  const card = pack.card(entry.card_id);
  return `the ${entry.position} card turns over: ${card.name}`;
}

export const JUDGE_SYSTEM = `You are reading one answer from someone in a tarot
reflection session and classifying it. You are not the reader and you never
speak to the user; you return the object and nothing else.

Judge what they actually disclosed, not how many words they used. A short answer
can be deep ("my brother, and I haven't called him") and a long one can be empty.

disclosure_depth is about self-revelation:
  0  deflecting, joking, one word, or asking you to tell them instead
  1  generic and true of anyone — "change is hard", "work is stressful"
  2  specific to their life — a person, a decision, a situation with edges
  3  something true that cost them something to say

flip_ready asks whether this card has been read for what it is worth. If there is
an obvious unpulled thread in what they just said, it is not ready.

stakes is about consequence, and you are deliberately quick to escalate:
  high    medical, legal, or financial decisions with real outcomes
  crisis  grief, self-harm, abuse, or anything where a tarot frame would be an
          insult to what they just said

When you are unsure between two levels of stakes, choose the higher one.`;

export const ANCHOR_SYSTEM = `You are committing the narrative plan for a tarot
reflection session, from the first card only. You never speak to the user.

Build it out of their vocabulary, not yours. If they said "treading water", the
theme says treading water; it does not say "career stagnation". A theme they
would not recognise as their own words is a failed anchor.

The resolution beat is where the third card should land — a plausible place for
this to come to rest, given what they have said so far. It is a plan, not a
prediction, and the reader steers toward it rather than announcing it.`;

/** What the judge sees: the transcript plus the answer under examination. */
export function judgeMessages(pack, session, { question, answer }) {
  const entry = currentCard(session);
  const card = entry ? pack.card(entry.card_id) : null;
  const context = [
    card ? `Card on the table: ${card.name} in the ${entry.position} position.` : "",
    `The reader asked: ${question || "(the reading had not started)"}`,
    `They answered: ${answer}`,
  ].filter(Boolean).join("\n");
  return [{ role: "user", content: context }];
}

export function anchorMessages(pack, session) {
  const entry = session.cards[0];
  const card = pack.card(entry.card_id);
  return [{
    role: "user",
    content: [
      `First card: ${card.name} in the ${entry.position} position.`,
      `They read it as: "${entry.user_projection}"`,
      session.exchanges
        .filter((e) => e.position === entry.position)
        .map((e) => `Q: ${e.q}\nA: ${e.a}`)
        .join("\n"),
    ].join("\n"),
  }];
}
