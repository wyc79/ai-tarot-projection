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

import {
  cardStanding, currentCard, heavyMaterial, tableau,
} from "./state.js";
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
  const shots = pack.fewShots.map((shot) => {
    // Normally one exchange. A few things only exist across turns -- a bridge
    // that misses and the crossing that lands two turns later -- so a shot may
    // carry a run of them, with a stage line for what happened before it.
    const turns = shot.turns ?? [{ user: shot.user, reader: shot.reader }];
    // Their words are quoted and yours are not, which looks inconsistent and is
    // deliberate. Whatever delimits an example of your voice, some proportion of
    // the time you will reproduce it -- a whole turn arrived on screen wrapped
    // in double quotes, and these lines are where it learned that.
    return [`— ${shot.card}, in the ${shot.position}.`,
      shot.setup ? `(${shot.setup})` : "",
      ...turns.flatMap((t) => [`They said: "${t.user}"`, `You said:`, t.reader]),
    ].filter(Boolean).join("\n");
  }).join("\n\n");
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
down. Do not ask again — but do not mistake that for having nothing to look for.

This card's job is to find the ground: one real thing in their life for the
reading to be about. Projection gives them the menu, elaboration gives it edges,
and the ownership move makes the offer — in that order, and never all on one
turn. Until something of theirs lands, you know nothing about this person, and a
turn written as though you do is a turn about the deck.`;
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
function ladderState(pack, session, standing = cardStanding(session)) {
  const position = standing.card && pack.position(standing.position);
  const userLevel = standing.last?.gate?.user_level ?? null;
  const deflected = standing.last?.disclosure_depth === 1;
  const ceiling = position?.ceiling ?? null;
  // Which rail the last question ran on. The reader is about to choose whether
  // to stay on it, and that choice changes how high it may reach -- so it is
  // told both numbers rather than one, since only it knows what it is about to
  // ask.
  const scored = session.exchanges.filter((e) => !e.aside);
  const rail = scored[scored.length - 1]?.question_type ?? null;
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
  const rungs = pack.levels
    .map((level) => (level.id === userLevel ? `  ${level.id}  <- they are here` : `  ${level.id}`))
    .join("\n");
  const aim = pack.level(target);

  return `
## How far to reach

${rungs}

${userLevel
  ? `Their last answer worked at **${userLevel}**${deflected ? ", and it was a deflection — do not climb" : ""}.`
  : "They have not answered on this card yet, so start at the bottom: ask what it is."}
This position tops out at **${ceiling}**.

**Reach no further than ${target}: ${aim.asks}.** Questions at that height sound
like these — the shape, not the words:
${aim.exemplars.map((e) => `  "${e}"`).join("\n")}
${rail ? `
Your last question was about ${rail === "projection" ? "the card" : "their life"}. **If you cross to ${rail === "projection" ? "their life" : "the card"}, ask at ${targetIfCrossing} and no higher** — crossing is itself the step.` : ""}${
  turn === "close"
    ? `\n\nThe closing step is the one thing exempt from that ceiling. They reached ${highest ?? "nothing much"} this session, so it is ${
  levelIndex(pack, highest) >= levelIndex(pack, "intentions")
    ? "something they could do, because they told you what they were after"
    : "something to notice, not something to carry out"}.`
    : ""}`;
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
    const phrases = session.anchor.user_phrases
      .map((p) => `"${p.phrase}" (${p.source})`).join(", ");
    lines.push(`  their exact words: ${phrases || "(none recorded)"}`);
    lines.push("  (verbatim. Reuse them as they are; a tidier synonym is a different word.)");
    lines.push(`  should land on: ${session.anchor.resolution_beat}`);
    if (!session.anchor.grounded) {
      lines.push("  GROUNDED: no. Every word above came from the picture, not from them.");
      lines.push("    Nothing is known about this person yet, and the theme is a placeholder.");
      lines.push("    Finding the ground is what this card is for, and the ownership offer is");
      lines.push("    how you cross — take a phrase they used and ask whose it is — but not");
      lines.push("    before this card has something under it to cross from; see the bridge line.");
      lines.push("    Do not talk as though the session has a subject. It does not yet.");
    }
  } else {
    lines.push("anchor: not committed yet (it is built from the first card)");
  }

  lines.push("", "cards on the table:");
  const byPosition = new Map(session.cards.map((c) => [c.position, c]));
  const table = tableau(session);
  for (const [index, slot] of table.entries()) {
    const entry = byPosition.get(slot.position);
    if (!entry) {
      // Face down, and it stays that way in this block: the whole spread is on
      // the table from the start and you are looking at the backs of them.
      lines.push(`  ${index + 1}. ${slot.position} — FACE DOWN${
        slot.epilogue ? " (the fourth card, if this reading earns it)" : ""}`);
      continue;
    }
    const card = pack.card(entry.card_id);
    lines.push(`  ${index + 1}. ${slot.position} — ${card.name}`);
    if (entry.user_projection) lines.push(`     they read it as: "${entry.user_projection}"`);
    const said = firstSentence(entry.ai_reading);
    if (said) lines.push(`     you said: ${said}`);
  }
  const down = table.filter((t) => !t.face_up);
  if (down.length) {
    lines.push(`  ${down.length} still face down. They were dealt with the rest and they are`);
    lines.push("    lying there in front of both of you — but you have not seen them and you");
    lines.push("    do not know what they are. Do not guess, do not hint, do not promise.");
  }

  const standing = cardStanding(session);
  const entry = standing.card;
  const position = entry && pack.position(entry.position);
  const depth = standing.depth;
  lines.push("", "now:");
  if (session.closed) {
    lines.push("  THE READING IS FINISHED. The closing beat is given and the spread is spent.");
    lines.push("    They are still here and still talking, which is theirs to do. Nothing below");
    lines.push("    can turn another card, and none of the pacing applies any more.");
  }
  const heavy = heavyMaterial(session);
  if (heavy.length) {
    // It does not stop being true because the subject moved on. The farewell is
    // the last chance anyone has to acknowledge it, and the session that taught
    // us this spent its ending on a side project instead.
    lines.push("  REAL-WORLD STAKES WERE SAID ALOUD IN THIS SESSION, and they still stand:");
    for (const e of heavy) {
      lines.push(`    "${String(e.a).replace(/\s+/g, " ").slice(0, 100)}"`);
    }
    lines.push("    You are not to reopen it, advise on it, or make it the subject again.");
    lines.push("    You are not to act as though it was never said either.");
  }
  lines.push(`  arc position: ${position ? `${position.id} (${position.arc_role} — ${position.prompt_hint})` : "nothing dealt yet"}`);
  if (position) lines.push(`  moves weighted here: ${position.moves.join(", ")}`);
  lines.push(`  disclosure depth on this card: ${depth === null ? "they have not answered yet" : depth}`);
  if (entry) {
    const settle = standing.settle;
    if (settle.settled) {
      lines.push(`  bridge to their life: earned — ${settle.selfReferent
        ? "something of theirs is already on this card"
        : `${settle.spent} answers on this card`}`);
    } else if (settle.spent === 0) {
      lines.push("  bridge to their life: not yet — they have not spoken about this card.");
      lines.push("    This turn asks about the picture and nothing else.");
    } else {
      lines.push("  bridge to their life: NOT YET — one answer on this card, and nothing of");
      lines.push("    theirs in it. A bridge thrown across that has nothing to ride on, and it");
      lines.push("    reads as an agenda: you wanted their life and asked the moment there was");
      lines.push("    a noun to hang it on. Stay in the picture and elaborate — ask what makes");
      lines.push("    their read what it is. Cross next turn, on the strongest phrase in the");
      lines.push("    answer that gets you.");
    }
  }
  const lastAnswer = session.exchanges[session.exchanges.length - 1];
  if (lastAnswer?.aside) {
    lines.push("  THEY ASKED YOU WHAT YOU MEANT rather than answering. Nothing above moved:");
    lines.push("    the depth, the level and the exchange count are all where they were before");
    lines.push("    you asked. Answer them and ask again, smaller.");
  }
  if (lastAnswer?.gate?.hedged) {
    lines.push("  THEY HEDGED THAT: it came with a way to take it back — \"i guess\", a");
    lines.push("    question mark on a statement. Do not repeat it back as settled fact and");
    lines.push("    do not build on it. Make walking it back easy and ask again more gently,");
    lines.push("    at the same height: \"could be nothing — what was the other one?\"");
  }
  if (session.phase === "afterglow") {
    const territory = [
      ...(session.topic ? [session.topic] : []),
      ...(session.anchor?.user_phrases ?? []).map((p) => p.phrase),
    ];
    lines.push("  THEY CHOSE TO STAY. This is not the reading and it is not a new one. The");
    lines.push("    ground is what the reading already found, and these are its edges:");
    lines.push(`    ${territory.length ? territory.map((t) => `"${t}"`).join(", ") : "(nothing was ever found; there is very little here)"}`);
    lines.push("    A question about anything outside that is a new subject, and a new subject");
    lines.push("    now is an interview. Go up, into what they already said — never sideways");
    lines.push("    into what else there is.");
  }
  const ladder = ladderState(pack, session, standing);
  lines.push(`  they are standing at: ${ladder.userLevel ?? "nothing said on this card yet"}`);
  lines.push(`  reach no further than: ${ladder.target}${ladder.ceiling ? ` (this position tops out at ${ladder.ceiling})` : ""}`);
  lines.push(`  highest they have reached all session: ${ladder.highest ?? "nothing yet"}`);
  lines.push(`  safety: ${session.safety_state}`);
  return lines.join("\n");
}

/**
 * The card in front of them, and nothing about how to use it.
 *
 * How to use it is in the persona, which is sent once and cached; this is sent
 * every turn, so it carries only what changes. It used to carry both, which
 * meant a page and a half of standing instructions was re-read on every turn of
 * every session alongside the four lines that were actually new.
 */
function describeCard(pack, session) {
  const entry = currentCard(session);
  if (!entry) return "";
  const card = pack.card(entry.card_id);
  const position = pack.position(entry.position);
  return `
## The card on the table

${card.name}, in the ${position.label} position (${position.arc_role} — ${position.prompt_hint}).

In the picture, for recognising what they point at — not to recite, not to
assert, and only ever to point with:
${card.details.map((d) => `- ${d}`).join("\n")}

The one line you may offer if they freeze: "${card.imagery_line}"

Traditional sense, which you do not volunteer — the two sides of a forced
choice, or a straight answer if they ask what it means:
- in this position: ${pack.meaning(card, entry.position)}
- generally: ${card.meanings.general}`;
}

/**
 * Who the reader is. Identical on every turn of a session, and identical across
 * sessions for a given pack.
 *
 * The split from readerTurnBlock below is the whole point of having two
 * functions. This half is a stable prefix, so a provider can cache it -- either
 * because it was told to with cache_control, or because it does prefix caching
 * on its own. Everything that changes turn to turn is in the other half, after
 * the transcript, where it cannot break the prefix.
 *
 * Before the split this was all one string with the session record in the
 * middle of it, which meant every turn sent a prompt that had never been seen
 * before: 22 KB of unchanging persona re-read from scratch each time.
 */
export function readerSystem({ pack, session }) {
  return [
    pack.persona,
    describeFewShots(pack),
    RULES_ON_TURNING_CARDS,
    `\n## The spread\n\n${describeSpread(pack)}`,
    describeTopic(session),
  ].filter(Boolean).join("\n");
}

/**
 * What is true right now and what this turn is for.
 *
 * Goes last, after the transcript, and that ordering is not only about caching:
 * the session record is declared to outrank the conversation above it, and a
 * thing said after the conversation outranks it more readily than a thing said
 * before. The turn instruction lands last of all, which is where an instruction
 * belongs.
 */
export function readerTurnBlock({ pack, session, turn, handback = false }) {
  const parts = [
    describeRecap(pack, session),
    describeCard(pack, session),
    describeLadder(pack, session, turn),
  ];

  if (session.safety_state === "drop_frame") {
    parts.push(RULES_WHEN_FRAME_DROPPED);
  } else if (handback) {
    parts.push(RULES_WHEN_STAKES_HIGH);
  }

  // Before the instruction, not after it: turnKindOf reads the tail of the
  // assembled prompt to say which turn this was, and anything appended past the
  // instruction makes every turn read as "unknown".
  parts.push(deckKeepsOne(session, turn));
  parts.push(TURN_INSTRUCTIONS[turn] ?? TURN_INSTRUCTIONS.respond);
  return parts.filter(Boolean).join("\n");
}

/**
 * The card that never turned, and how to say so.
 *
 * Only on the closing turn, and only when one is still face down. The fourth
 * card is decided before the close, so by the time this turn runs the question
 * is settled: either it turned and the close covers four, or it did not and the
 * close owes it a line. The line is the return hook and it must not land as a
 * grade -- "you did not earn it" is exactly what a reading is not for.
 */
function deckKeepsOne(session, turn) {
  if (turn !== "close") return "";
  const down = tableau(session).filter((t) => !t.face_up);
  if (!down.length) return "";
  return `
## One card stays face down

There ${down.length === 1 ? "is a card" : `are ${down.length} cards`} on the table that never turned over, and
they can see ${down.length === 1 ? "it" : "them"}. Say so, once, in one line near the end — something of the
order of "one card stays with the deck today; it'll be there when you come back."

**As an invitation, never as a verdict.** Not withheld, not unearned, not
"maybe next time you'll open up more". The deck keeps one. That is all it is,
and a reading that ends by grading someone is worse than a reading that ends
short.

Do not name it. Do not guess at it. Do not describe what it might have been.
You have not seen it.`;
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

  after: `
## This turn

The reading is finished. You gave the closing beat and they have said one more
thing, which is a normal thing for someone to do and is not a signal to start
again.

**No card turns over.** The spread is spent and every card that was going to
turn has turned. Do not offer one, do not hint that one is coming, and do not
promise a second reading.

**This tail is short and you are near the end of it.** Answer what they actually
said — properly, it was a real thing to say — and keep routing it through the
cards on the table. Do not restate the step and do not summarise the session;
they were there.

Same shape as any other turn: one observation, one question. Do not say goodbye
here and do not wind down — there is a turn for that and it is coming, and two
goodbyes is worse than none.`,

  clarify: `
## This turn

They did not answer, they asked you what you meant. That is not a deflection and
it is not resistance -- your question did not land, and they are telling you so
rather than guessing at it.

**No card turns over, and this turn does not count as one of theirs.** The card
is exactly where it was.

Answer them, plainly, in one sentence, without apologising for the question or
explaining the technique behind it. Then ask the same thing again in plainer
words -- shorter, more concrete, and pointing at whatever they can actually see
or remember. If the question needed their life and they had not offered any yet,
that is the answer: go back to the picture and ask about it instead.

Never repeat the question you just asked. They already told you it did not work.`,

  epilogue: `
## This turn

The reading found somewhere left to go, and the table has answered by turning
the last card — the fourth one, which has been lying face down with the others
since the beginning. This is the last card there is.

**One observation** on what they just said, in their words. **Then the card
turns over:** name it and say it is the last one, in a clause, not a paragraph.
**Then one question about the picture**, and stop.

The same rule as every other card, and it matters more here than anywhere: the
question is about what they see, not about what they just told you. You already
answered that in the observation. Someone who knows nothing about this person
should be able to answer it by looking at the card.

Do not close the reading on this turn. Do not summarise, do not reach for a
step, and do not say anything that sounds like an ending — there is a real
ending coming and this would spend it. Do not explain why this card turned up,
do not call it a gift or a sign, and do not remark on there being four.`,

  close: `
## This turn

Close the reading. Name what moved across the cards that turned over, in their
language, and turn it into one small concrete thing to notice or do in the
coming week. Something they could actually catch themselves doing. Not a
summary, not advice, not a list.

**This happens once.** There is one closing beat in a session and this is it.

**Do not open the same way every time.** "Across these three cards, in your own
words..." is one shape and it is not the only one, and a reading that always
ends on the same sentence pattern ends like a form letter. Start from the thing
itself: the phrase they used most, the one that changed, the moment the reading
turned. Count the cards only if the number is doing work.

**Size the step to how far they actually got**, which the record above names.
If they got as far as saying why something matters to them, the step can be
something to do. If they never got past what happened, it is something to
notice — one moment to catch, nothing to carry out. A plan handed to someone who
never made one is homework, and they will not do it.

This turn happens whatever height they reached. There is no reading too shallow
to close.

Then stop. No question, or one small one at most — what comes after this is a
short conversation and then a goodbye, and neither of them is another reading.`,

  farewell: `
## This turn

This is the last thing you say. The reading closed, they said what they had left
to say, and now you let them go.

**It ends without a question.** This is the only turn in the whole session that
does. Everything else you write reaches for one more thing; this one does not,
because holding someone at the door is how a good hour becomes an awkward one.

Three or four sentences at the outside:

- **Echo the noticing** you left them with, in one line, in their words. Not the
  whole step again — the shape of it, so it is the last thing they hear.
- **Leave the door open**, plainly: the cards will be here, and so will you.
  Not a sales line, not "come back soon", not an invitation to draw again now.
- Say goodbye like a person. Warm, short, finished.

If the record above says real-world stakes were named in this session, **one
gentle line acknowledging it comes first** — before the door. Not advice, not a
referral repeated, not reopening it: just that you heard it and it is still
there. Something of the order of "and the thing about the lease is still the
thing about the lease — that one's worth real advice, not cards." A goodbye that
talks about everything except the heaviest thing they said is a goodbye that
tells them you were not listening.

Do not thank them for sharing. Do not summarise the session. Do not ask
anything.`,

  afterglow: `
## This turn

They said goodbye and then chose to stay a while. That is a different thing from
the reading, and it has its own shape.

**No card turns over, ever again in this session.** The spread is spent and the
closing beat is given.

**Stay inside what the reading found.** The record above names the ground: their
topic and their own phrases. Every question you ask lives in there. "What would
make the work feel like yours" is inside it; "what are you building" is a new
subject, and a new subject now is an interview — you asking after the nouns in
someone's life because the reading ran out of its own material. That is the
failure this whole mode exists to prevent, and it does not feel like a failure
while it is happening: it feels like interest.

**Go up, not sideways.** What they already told you, at a greater height —
whether it sits right with them, what they were hoping for, what it says about
what they care about. Never a new corner of their life at name level.

**You do not have to ask anything.** This is the one place where a turn can be a
statement and stop. Receiving what someone said — setting it down in their words
and leaving it there — is often the whole of what is wanted after an ending.
Reach for a question only when there is a real one.

Short. Shorter than a reading turn. They are winding down, not starting.`,

  regroup: `
## This turn

Two answers running with nothing of their own in them. The conversation has
drifted off what the reading was about, and there is no card left to move it
along — so this turn either goes back or offers the door.

Pick one, and do it in two sentences:

- **Back to the anchor.** Name the thing the reading actually found, in their
  words, and ask about that. Not the subject you have both wandered into.
- **Or offer the ending again**, without making it a verdict on them: "we can
  sit with this, or leave it here for today." Then let them choose.

Do not carry on asking about whatever came up. Do not apologise for the drift or
name it — "I notice we've moved away from" is you narrating the machinery at
someone. Just turn back, or open the door.`,
};

/**
 * Which turn instruction a system prompt ends with.
 *
 * readerTurnBlock appends one of TURN_INSTRUCTIONS verbatim, so this is exact.
 * It exists because the test helpers and the fixture script each kept their own
 * table of marker regexes against these strings, and both drifted: the fixture's
 * bridge marker had not matched anything for some time, so --prompt=bridge
 * printed "no bridge turn in this session" for a session with two of them.
 */
export function turnKindOf(system) {
  return Object.keys(TURN_INSTRUCTIONS).find((kind) => system.endsWith(TURN_INSTRUCTIONS[kind]))
    ?? "unknown";
}

/**
 * How many exchanges go into the prompt verbatim.
 *
 * The transcript is texture; the session record is the record. Everything a
 * later turn is required to be consistent with -- the anchor and their exact
 * phrases, every card with what they read into it and what was said back, the
 * topic, the safety state -- is assembled from state on every turn and declared
 * to outrank the history. So the oldest turns can fall off the front without
 * anything structural falling off with them.
 *
 * Ten is chosen against the longest reading the pacing allows, which is twelve
 * exchanges plus the opening: a reading that runs to its caps drops its first
 * two or three turns near the end, and those are the ones about the first card,
 * which the record carries in full. Where this really earns itself is after the
 * closing beat, when the conversation can run as long as the person wants it
 * to and there is no card left to bound it.
 *
 * The cost is that the message list stops being a stable prefix once it starts
 * sliding, so a provider doing incremental caching over messages loses it. The
 * 22 KB that actually matters is the system prompt, which does not move.
 */
export const TRANSCRIPT_WINDOW = 10;

/**
 * The transcript so far, then what is true now and what this turn is for.
 *
 * The turn block is folded into the final user message rather than sent as its
 * own, because two user messages in a row is a shape some providers refuse and
 * none of them need.
 */
export function readerMessages(pack, session, { stageDirection = null, turnBlock = "" } = {}) {
  const messages = [];
  const shown = session.exchanges.slice(-TRANSCRIPT_WINDOW);
  const elided = session.exchanges.length - shown.length;
  if (elided) {
    messages.push({ role: "user", content:
      `(${elided} earlier exchange${elided === 1 ? "" : "s"} in this session are not `
      + "repeated here. They happened, and the session record below is the record of "
      + "them — it is assembled from the table and it is complete. Do not say or imply "
      + "that the conversation began where this transcript begins.)" });
  }
  for (const exchange of shown) {
    if (exchange.q) messages.push({ role: "assistant", content: exchange.q });
    messages.push({ role: "user", content: exchange.a });
  }

  const tail = [
    stageDirection ? `(${stageDirection})` : "",
    messages.length ? "" : "(the reading begins)",
    turnBlock,
  ].filter(Boolean).join("\n\n");
  if (tail) messages.push({ role: "user", content: tail });
  else if (!messages.length) messages.push({ role: "user", content: "(the reading begins)" });
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

**hedged** is separate from depth and does not lower it. "I guess so? I used to
have a different trade" is a real disclosure -- a 3, with life content -- offered
with a way to take it back. Both things are true at once and the reader needs to
know both: what they said, and that they are watching to see what you do with it.

---

**asked_back** is not a depth at all. It is true when what they sent is a
question to you rather than an answer to yours -- "what do you mean whose
heading out is that?", "sorry, whose?", "are you asking about the card or about
me?". They are still here and still engaged; they just did not follow you.

It is the one verdict that stops a turn counting. The reading answers them,
asks again in plainer words, and the card is left exactly where it was -- so a
question that was badly phrased costs the reader a turn rather than costing them
one of theirs.

Be strict with it. An answer that happens to end in a question mark is not this:
"my brother, I suppose?" is a hedged answer. Nor is a rhetorical question they
are answering with. It is true only when there is nothing in what they sent that
could be scored, because they were asking rather than telling. When it is true,
disclosure_depth is 1 and user_level is name, because nothing was said.

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

**Tag every phrase honestly.** A phrase is "life" only if it is about them or
their world — a person, a place, a thing that happened, a feeling they own.
Describing the picture is "card", however vivid and however much it sounds like
a metaphor for something. "The black and white pillar behind her" is card.
"Judging between good and bad" is card, if all they were doing was reading the
image.

**The theme is built from the life phrases.** If there are any, it is about what
those phrases are about, and the card phrases are the language it is said in.

**If there are none, say so and plan accordingly.** A session where everything
said so far was about the picture has no theme yet, and inventing one out of the
card's plot is the failure this instruction exists to prevent — a "narrative
plan" about what a figure in a drawing is about to do is a plan about nobody.
In that case the resolution beat is not about the cards at all: it is about
finding out what actually matters to this person, so that the rest of the
reading goes looking for them instead of further into the deck.

**The resolution beat is a territory, not a thesis.** It names the question this
reading is walking toward and leaves at least two live possibilities open, either
of which could turn out to be true.

  no:  "the change isn't a break, it's a repurposing, and something from the
       before is still alive in it"
  yes: "where the old trade stands in the new one — still feeding it, or
       genuinely left behind"

The first one decided the finding from a single sentence they said once, and
every question after it would go looking for agreement. They would end the
reading having confirmed something you wrote. Say where to look, never what is
there.

It is a plan, not a prediction, and the reader steers toward it rather than
announcing it.`;

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

/**
 * @param {object} pack
 * @param {object} session
 * @param {object} [options]
 * @param {string} [options.note] appended when the first answer needs re-asking
 * @param {boolean} [options.rolling] this is an update, not the first commit
 */
export function anchorMessages(pack, session, { note = "", rolling = false } = {}) {
  const entry = session.cards[0];
  const card = pack.card(entry.card_id);
  const lines = [
    session.topic
      ? `Before any card was dealt they said they wanted to look at: "${session.topic}"`
      : "They did not name a topic before the cards were dealt.",
    `First card: ${card.name} in the ${entry.position} position.`,
    `They read it as: "${entry.user_projection}"`,
  ];

  if (rolling && session.anchor) {
    // An update, not a fresh read: the anchor exists and has been steering. It
    // may be rewritten, but it may not be quietly replaced by something that
    // contradicts what the reading has already been about.
    lines.push("", "The anchor so far, which you are revising rather than replacing:",
      `  theme: ${session.anchor.theme}`,
      `  should land on: ${session.anchor.resolution_beat}`,
      "",
      "Everything they have said since:");
    lines.push(...session.exchanges
      .filter((e) => e.gate?.has_life_content)
      .map((e) => `  "${e.a}"${e.gate?.hedged ? " (hedged — they left themselves a way out)" : ""}`));
  } else {
    lines.push(session.exchanges
      .filter((e) => e.position === entry.position)
      .map((e) => `Q: ${e.q}\nA: ${e.a}`)
      .join("\n"));
  }

  if (note) lines.push("", note);
  return [{ role: "user", content: lines.join("\n") }];
}
