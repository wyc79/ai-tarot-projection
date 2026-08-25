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
import { levelIndex, targetLevel } from "./levels.js";

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

/**
 * Where the conversation is standing on the ladder, and how far the next
 * question may reach.
 *
 * Read off the card currently face up, not the whole session: a card that has
 * just been dealt has no answers yet, so the target falls to the bottom rung --
 * which is the projection question the deal turn owes them anyway. The ladder
 * then climbs again from whatever they say, and because the ceiling rises
 * across the spread, each card can go further than the one before it.
 */
function ladderState(pack, session) {
  const card = currentCard(session);
  const position = card && pack.positions.find((p) => p.id === card.position);
  const here = card ? session.exchanges.filter((e) => e.position === card.position) : [];
  const last = here[here.length - 1] ?? null;
  const userLevel = last?.gate?.user_level ?? null;
  const deflected = last?.disclosure_depth === 1;
  const ceiling = position?.ceiling ?? null;
  // Which rail the last question ran on. The reader is about to choose whether
  // to stay on it, and that choice changes how high it may reach -- so it is
  // told both numbers rather than one, since only it knows what it is about to
  // ask.
  const rail = session.exchanges[session.exchanges.length - 1]?.question_type ?? null;
  return {
    userLevel,
    deflected,
    rail,
    ceiling,
    target: targetLevel(pack, { userLevel, ceiling, deflected }),
    targetIfCrossing: targetLevel(pack, { userLevel, ceiling, deflected, crossingRails: true }),
    // Across the whole session, not just this card: the closing step is sized
    // to how far the reading actually got, and a reading that never left the
    // ground closes on something small rather than on a plan nobody made.
    highest: session.exchanges
      .map((e) => e.gate?.user_level)
      .filter(Boolean)
      .reduce((best, id) => (levelIndex(pack, id) > levelIndex(pack, best) ? id : best), null),
  };
}

/**
 * The ladder itself, from pack data, with a mark where they are standing.
 *
 * The exemplars shown are the target level's only. All five levels' worth is a
 * page of questions to choose from, and a reader with a page of questions in
 * front of it writes questions that sound chosen.
 */
function describeLadder(pack, session, turn) {
  if (session.phase === "opening") return "";
  const { userLevel, target, targetIfCrossing, rail, ceiling, deflected, highest } =
    ladderState(pack, session);
  const rungs = pack.levels.map((level) => {
    const mark = level.id === userLevel ? " <- they are here" : "";
    return `  ${level.id} — ${level.asks}${mark}`;
  }).join("\n");
  const aim = pack.level(target);

  return `
## How far to reach

${rungs}

${userLevel
  ? `Their last answer worked at **${userLevel}**.`
  : "They have not answered on this card yet, so start at the bottom: ask what it is."}
${deflected
  ? "That was a deflection, so do not climb. Ask at the same height, more concretely — at the bottom rung that is the forced choice between two readings of the card."
  : ""}
This position tops out at **${ceiling}**.

**Reach no further than ${target}: ${aim.asks}.** ${aim.gloss}

Questions at that height sound like these — the shape, not the words:
${aim.exemplars.map((e) => `  "${e}"`).join("\n")}
${rail ? `
### The other rail

Your last question was about ${rail === "projection" ? "the card" : "their life"}. A question about ${rail === "projection" ? "their life" : "the card"} crosses to the other rail, and
crossing is itself a step: it asks them to change what they are talking about.
**If you cross, ask at ${targetIfCrossing} and no higher** — climbing and crossing in the
same question is two steps, and two steps is a question they have to invent an
answer to.

The crossing question worth knowing is the one that offers the connection
instead of assuming it. Not "when did that first turn up for you?", which
assumes the thing is theirs and gets a description of the card back. Offer it
and let them take it or not.` : ""}

This is a ceiling, not a quota. A question lower than it is fine whenever the
lower one is the better question, and if they leap two rungs on their own in
their next answer, go with them — you follow them up, you never march them up.${
  turn === "close"
    ? `\n\nThe closing step is the one thing exempt from that ceiling — a reading always
gets its ending. But it is sized by the same reading of where they got to: they
reached ${highest ?? "nothing much"} this session, so the step is ${
  levelIndex(pack, highest) >= levelIndex(pack, "intentions")
    ? "something they could do, because they told you what they were after"
    : "something to notice, not something to carry out"}.`
    : ""}`;
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
  const ladder = ladderState(pack, session);
  lines.push(`  they are standing at: ${ladder.userLevel ?? "nothing said on this card yet"}`);
  lines.push(`  reach no further than: ${ladder.target}${ladder.ceiling ? ` (this position tops out at ${ladder.ceiling})` : ""}`);
  lines.push(`  highest they have reached all session: ${ladder.highest ?? "nothing yet"}`);
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

**Deictic only.** Use it to point — "the one up on the bench", "the two below
him" — never to name what a thing is or what someone is doing with it. "The ones
holding the plans" and "he's building what they want" are both facts off this
list, asserted about a picture only they can see. Once they say a word for
something, it is theirs and you can use it back.

### Traditional sense

You do not volunteer this. Ever. It has two ways into a turn and no others: as
the two sides of a forced choice when they have gone quiet, phrased out of what
they noticed rather than recited; or as a straight answer when they ask what the
card means, which you give plainly and briefly and then hand back.

- in this position: ${card.meanings[entry.position]}
- generally: ${card.meanings.general}

Those two are also the two sides of the forced choice, when one is needed.`;
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
    describeLadder(pack, session, turn),
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

No traditional meaning unless they asked for it. If they did, answer it in one
plain sentence inside the observation and hand it back to their read.

Whatever you have already said this card points to, you have spent — do not
spend it again in different words on this turn. Work with what they have given
you since.

The question goes further in rather than sideways, and it is the last thing you
write.`,

  bridge: `
## This turn

The same shape, with the card named in the middle of it.

**One observation** on what they just said, in their words. **Then the new card
turns over:** name it and the position it landed in, in a clause, not a
paragraph. **Then one question** about it, and stop.

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
no invitation to draw again.

**Size the step to how far they actually got**, which the record above names.
If they got as far as saying why something matters to them, the step can be
something to do. If they never got past what happened, it is something to
notice — one moment to catch, nothing to carry out. A plan handed to someone who
never made one is homework, and they will not do it.

This turn happens whatever height they reached. There is no reading too shallow
to close.`,
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

**A pure card answer caps at 2.** If everything they said is about the picture --
what is in it, what the figures are doing, what it looks like -- it is a 2 at
most, however long and however vivid, and a 1 if it is a shrug. It goes above 2
only when something of theirs is in it: a person, a place, a time, an event, a
feeling they own, or a sentence that turns back on them ("like me", "reminds me
of", "I hate that"). This is the one rule that stops a reading of a picture
being scored as a reading of a person, and getting it wrong is how a session
spends three turns on the deck and calls it disclosure.

That is the same judgement as **has_life_content**, and the two must agree: if
has_life_content is false the depth is 1 or 2, always.

---

**user_level** is the second axis, and it is not a finer version of the first.
disclosure_depth is how much they revealed; this is what kind of operation they
performed. A one-word answer and a paragraph can sit at the same level, and a
depth-4 disclosure can sit at the bottom of this ladder.

Report where they actually landed, not where they were invited to land. People
jump levels unprompted all the time -- someone asked when a thing started will
hand you why it matters in the same breath -- and the reader needs to know that
happened.

  name           they said what it is. A description, a word for it, what the
                 picture looks like. Nothing about them yet.
                 "a woman in a garden" · "it looks tired" · "dunno" · "treading
                 water, I suppose"

  consequences   the thing in time: when it turned up, what it did, what they
                 did, who was there. Events, not appraisals.
                 "my brother, and I haven't called him since March" · "it
                 started after the move" · "I just stopped answering"

  evaluate       their position on it. Whether it sits right, whether they are
                 alright with it going on. Note this is not the same as naming
                 an emotion -- "it makes me sad" is naming, "I'm tired of being
                 the one who calls" is evaluating.
                 "I hate that it's got this far" · "honestly it's fine, it's
                 just not what I wanted" · "I don't think that's alright"

  intentions     why it matters to them: what they were hoping for, what it says
                 about what they value, what they were trying to protect.
                 "if I spend it I have to admit I'm staying" · "I wanted him to
                 ask me first" · "I've always thought you don't leave people"

  plans          what they will do. Commitments and next steps, however small.
                 "I'll call him Sunday" · "I'm going to stop pretending it's
                 about money"

Two things that catch people out. A deflection is name level, whatever it is
deflecting from -- "dunno" after an intentions question is name, not intentions.
And someone can evaluate without a single feeling word in the sentence; look at
what the sentence does, not at its vocabulary.

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
