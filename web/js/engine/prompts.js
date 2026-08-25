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
import { questionType } from "./questions.js";

const RULES_ON_TURNING_CARDS = `
## You do not turn the cards

The table turns them. Every turn you are told exactly which card is face up and
whether a new one has just been dealt; that is the whole truth of what has been
revealed, and you have no other source for it.

Never name a card you have not been given here. You do not know what is coming.
Guessing produces a card that is not on the table, and they are looking at the
table.

Never say a card is about to turn, is turning, or has turned, unless this turn's
instruction tells you one has. "The final card lands now" on a turn where
nothing landed is the same mistake as naming the wrong card, and it makes the
next real flip read as a correction.`;

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

/**
 * How the reader sounds, shown rather than described. The labels on each shot
 * are for whoever maintains the pack; the model gets the exchanges only, because
 * telling it which technique it is about to use is how a turn starts sounding
 * like a technique.
 */
function describeFewShots(pack) {
  if (!pack.fewShots?.length) return "";
  const shots = pack.fewShots.map((shot) =>
    [`— ${shot.card}, in the ${shot.position}.`,
     `They said: "${shot.user}"`,
     `You said: "${shot.reader}"`].join("\n")).join("\n\n");
  return `
## How this sounds

Not lines to reuse. The shape to hold: one observation, one question, and
nothing spent on preamble.

${shots}`;
}

function describeSpread(pack) {
  return pack.positions
    .map((p, i) => `${i + 1}. ${p.label} (${p.arc_role}) — ${p.prompt_hint} [${p.moves.join(", ")}]`)
    .join("\n");
}


function describeTopic(session) {
  if (session.phase === "opening") return "";
  if (!session.topic) {
    return `
## They did not name a topic

They were asked and did not have one, which is a perfectly ordinary way to sit
down. Do not ask again and do not invent a subject for them — let the cards do
the asking.`;
  }
  return `
## What they said they wanted to look at

"${session.topic}"

This is the ground for the reading, in their words, and it was theirs before any
card turned over. Steer toward it. When a card seems to point somewhere else,
bend the card toward this — not this toward the card.`;
}

/** First sentence of a reader turn, for the one-line record of each card. */
function firstSentence(text) {
  if (!text) return "";
  const trimmed = text.trim().replace(/\s+/g, " ");
  const end = trimmed.search(/[.?!](\s|$)/);
  const line = end === -1 ? trimmed : trimmed.slice(0, end + 1);
  return line.length > 120 ? `${line.slice(0, 117)}...` : line;
}

/** The depth of the most recent answer on the card currently face up. */
function depthOnCurrentCard(session) {
  const card = currentCard(session);
  if (!card) return null;
  const here = session.exchanges.filter((e) => e.position === card.position);
  return here.length ? here[here.length - 1].disclosure_depth : null;
}

/**
 * The session record: the one part of the prompt that is a constraint rather
 * than context.
 *
 * The conversation history says what was said; this says what is true. They can
 * drift apart -- a model that half-remembers three turns back will contradict a
 * reading it already gave, and that is what makes a session feel like it is
 * being improvised at the user rather than held. So this block is assembled
 * from state on every single turn and declared to outrank the history.
 */
function describeRecap(pack, session) {
  const lines = ["\n## Session record", "",
    "Assembled from the table, not from memory. Your reply must be consistent",
    "with everything here. Where this and the conversation above disagree, this",
    "wins: the history is what was said, this is what is true.",
    "",
    "Never contradict a reading you have already given. New material elaborates",
    "what is below; it does not replace it or quietly move on from it.",
    ""];

  if (session.anchor) {
    lines.push("anchor:");
    lines.push(`  theme: ${session.anchor.theme}`);
    const phrases = session.anchor.user_phrases.map((phrase) => `"${phrase}"`).join(", ");
    lines.push(`  their exact words: ${phrases || "(none recorded)"}`);
    lines.push("  (verbatim. Reuse them as they are; a tidier synonym is a different word.)");
    lines.push(`  should land on: ${session.anchor.resolution_beat}`);
  } else {
    lines.push("anchor: not committed yet (it is built from the first card)");
  }

  lines.push("", "cards on the table:");
  if (!session.cards.length) {
    lines.push("  none yet");
  } else {
    for (const [index, entry] of session.cards.entries()) {
      const card = pack.card(entry.card_id);
      lines.push(`  ${index + 1}. ${entry.position} — ${card.name}`);
      if (entry.user_projection) lines.push(`     they read it as: "${entry.user_projection}"`);
      const said = firstSentence(entry.ai_reading);
      if (said) lines.push(`     you said: ${said}`);
    }
  }

  const remaining = session.positions.length - session.cards.length;
  lines.push(`  ${remaining > 0
    ? `${remaining} position${remaining > 1 ? "s" : ""} still to come, cards unknown to you`
    : "every position dealt; there is no further card"}`);

  const entry = currentCard(session);
  const position = entry && pack.positions.find((p) => p.id === entry.position);
  const depth = depthOnCurrentCard(session);
  lines.push("", "now:");
  lines.push(`  arc position: ${position ? `${position.id} (${position.arc_role} — ${position.prompt_hint})` : "nothing dealt yet"}`);
  if (position) lines.push(`  moves weighted here: ${position.moves.join(", ")}`);
  lines.push(`  disclosure depth on this card: ${depth === null ? "they have not answered yet" : depth}`);
  lines.push(`  safety: ${session.safety_state}`);
  return lines.join("\n");
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
    describeFewShots(pack),
    RULES_ON_TURNING_CARDS,
    `\n## The spread\n\n${describeSpread(pack)}`,
    describeTopic(session),
    describeRecap(pack, session),
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
  opening: `
## This turn

Nothing has been dealt yet, and nothing will be dealt this turn.

Ask whether there is something particular they want to look at before you turn
anything over. Make declining genuinely easy — "not really, just curious" is a
good answer and a lot of people arrive that way. Do not push, and do not offer
a menu of topics.

Two sentences at the outside. Do not explain the spread, do not describe the
deck, and do not promise what the cards will do.`,

  invite: `
## This turn

The card has just turned over and they have not spoken about it yet. Name the
card and the position it landed in, then hand it straight to them: ask what it
looks like it is pointing at for them. Two sentences, and the second one is the
question.

Do not interpret it first, and do not mention its traditional meaning at all
yet — you have not earned the right to, because they have not told you anything.

The question is about the picture, not about them. Someone who knows nothing
about this person should be able to answer it by looking at the card.`,

  respond: `
## This turn

**No card turns over on this turn.** The card in front of them is the one named
above, and it is still the one in front of them when you finish. Do not reach
for the next one and do not hint that it is coming.

**One observation, then one question.** The observation builds on what they
actually said, using their words and their image — and only what is actually
there, never a repetition or an emphasis you did not see.

At most one sentence of traditional sense, bent toward this card's position, and
only inside the observation — if you already spent that sentence on this card,
do not spend it again in different words.

The question goes further in rather than sideways, and it is the last thing you
write.`,

  bridge: `
## This turn

The same shape, with the card named in the middle of it.

**One observation** on what they just said — their words, one sentence of
traditional sense at most. **Then the new card turns over:** name it and the
position it landed in, in a clause, not a paragraph. **Then one question** about
it, and stop.

Do not interpret the new card. The naming is not a third thing to say about;
it is a fact you drop in on the way to the question.

**The question is about the new card**, and only about it: what it looks like,
who in it they recognise, what the figure seems about to do. Not about what
they just told you — you already answered that in the observation — and not
about what they should do next. Someone who knows nothing about this person
should be able to answer it by looking at the card.

This is the turn most often got wrong, and it is got wrong by being clever:
the observation opens something up, and the question chases that instead of
the card that just landed. The chase costs them the projection.`,

  close: `
## This turn

This is the last thing you say. Close the reading: name what moved across the
three cards in their language, and turn it into one small concrete thing to
notice or do in the coming week. Something they could actually catch themselves
doing. Not a summary, not advice, not a list. Then stop — no offer to continue,
no invitation to draw again.`,
};

/**
 * Which turn instruction a system prompt ends with.
 *
 * readerSystem appends one of TURN_INSTRUCTIONS verbatim, so this is exact.
 * It exists because the test helpers and the fixture script each kept their own
 * table of marker regexes against these strings, and both drifted: the fixture's
 * bridge marker had not matched anything for some time, so --prompt=bridge
 * printed "no bridge turn in this session" for a session with two of them.
 */
export function turnKindOf(system) {
  return Object.keys(TURN_INSTRUCTIONS).find((kind) => system.endsWith(TURN_INSTRUCTIONS[kind]))
    ?? "unknown";
}

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

disclosure_depth is a verdict on the answer **relative to the question it was
answering**, and there are two kinds of question. You are told which one this
was. The same sentence can be a 3 after one kind and a 1 after the other, and
getting that backwards is the single most expensive mistake you can make here:
it is what stalls a reading on a card that was already read.

---

**PROJECTION QUESTION** — they were asked what they see in the card.

What they choose to see is the disclosure. Describing the picture is the answer
working, not the answer dodging.

  1  they did not engage with the picture at all
     "dunno" · "no idea" · "you tell me" · "what does it mean?"

  2  a flat inventory of what is objectively there, with no angle on it
     "a woman in a garden" · "five guys with sticks" · "a man walking"

  3  a reading with an angle: they give the picture a state, a motive, or a
     story that is not printed on it. This is projection, and it is what the
     question was for
     "it looks tired" · "he's walking away from something" · "nobody's actually
     aiming at anyone"

  4  they close the gap to themselves without being asked -- the picture and
     their own life in the same breath
     "that's me in March" · "she's guarding a garden nobody's trying to get into,
     which, yeah"

---

**LIFE QUESTION** — they were asked about themselves.

Here the card is not the subject. An answer that describes the picture is a
retreat back into it: the same words that earned a 3 a turn ago earn a 1 now,
because this time they were asked something else.

  1  a deflection, a shrug, a joke, a question back -- or a description of the
     card instead of an answer
     "dunno" · "haha maybe" · "walking off, leaving the full ones behind" (when
     what was asked was what their first step would be)

  2  a general statement that would be true of almost anyone: no person, no
     place, no date, nothing you could ask a follow-up about
     "change is hard" · "work has been stressful lately" · "I overthink things"

  3  a specific situation in their life, with edges
     "my job, four years in and I'm bored" · "my flatmate and I aren't speaking"

  4  a specific event with feeling or stakes attached -- something it cost them
     something to type
     "my brother, and I haven't called him since March" · "I said yes and I knew
     while I was saying it that I meant no"

---

stakes is about consequence, and you are deliberately quick to escalate:
  high    medical, legal, or financial decisions with real outcomes
  crisis  grief, self-harm, abuse, or anything where a tarot frame would be an
          insult to what they just said

When you are unsure between two levels of stakes, choose the higher one.`;

export const ANCHOR_SYSTEM = `You are committing the narrative plan for a tarot
reflection session, from the first card only. You never speak to the user.

If they named a topic before the cards were dealt, the theme belongs to that
topic. The first card elaborates what they already said they came for; it does
not replace it with something the card found more interesting.

Build it out of their vocabulary, not yours. If they said "treading water", the
theme says treading water; it does not say "career stagnation". A theme they
would not recognise as their own words is a failed anchor.

The resolution beat is where the third card should land — a plausible place for
this to come to rest, given what they have said so far. It is a plan, not a
prediction, and the reader steers toward it rather than announcing it.`;

export const OPENING_SYSTEM = `You are reading the first thing someone said in a
tarot reflection session, before any card was dealt. They were asked whether
there is something particular they want to look at. You never speak to the user.

Decide two things.

Did they actually name something? "Not really", "just curious", "surprise me",
"you tell me" and any polite deflection are all no. A topic is something with
edges — a person, a decision, a situation. If they named one, give it back in
their own words, compressed, never rewritten into your vocabulary.

And what are the stakes? You are deliberately quick to escalate, because this is
the earliest point at which a reading can be the wrong thing to be doing.`;

export function openingMessages({ question, answer }) {
  return [{
    role: "user",
    content: `They were asked: ${question}\nThey answered: ${answer}`,
  }];
}

/** What the judge sees: the transcript plus the answer under examination. */
export function judgeMessages(pack, session, { question, answer }) {
  const entry = currentCard(session);
  const card = entry ? pack.card(entry.card_id) : null;
  const kind = questionType(question);
  const context = [
    card ? `Card on the table: ${card.name} in the ${entry.position} position.` : "",
    // Named before the question is quoted, because it selects the rubric and a
    // judge that reads the question first will have already started scoring.
    `Kind of question: ${kind.toUpperCase()} — use the ${kind} scale.`,
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
      session.topic
        ? `Before any card was dealt they said they wanted to look at: "${session.topic}"`
        : "They did not name a topic before the cards were dealt.",
      `First card: ${card.name} in the ${entry.position} position.`,
      `They read it as: "${entry.user_projection}"`,
      session.exchanges
        .filter((e) => e.position === entry.position)
        .map((e) => `Q: ${e.q}\nA: ${e.a}`)
        .join("\n"),
    ].join("\n"),
  }];
}
