/**
 * The three things the engine asks a model to judge, each behind one name.
 *
 * A judgement is three facts that have to agree: a system prompt, a message
 * builder, and a schema. They lived in two modules and were assembled at the
 * call site, so asking for a gate meant knowing that JUDGE_SYSTEM goes with
 * judgeMessages and gateSchema(pack) -- and nothing anywhere said so. Three
 * correct triples, spelled out four times, with no way to be wrong loudly.
 *
 * What that cost was visible at the other end of the seam. client.judge() takes
 * {system, messages, schema} and carries no idea what was asked, so the test
 * double had to work it out by looking at the schema: has_topic means the
 * opening, theme means the anchor, anything else is a gate. The engine knew
 * which judgement it wanted and threw that away crossing its own seam.
 *
 * So each judgement is a method here, `kind` rides along with the call, and the
 * assembly is written once. The retry that makes an anchor an anchor lives here
 * too -- see anchor() -- because a caller asking for a narrative plan should get
 * one that satisfies the contract, not a first draft plus instructions for
 * checking it.
 *
 * No network of its own: it takes a client. No state: it takes what each
 * judgement reads, per call. Everything it knows about tarot comes from the pack.
 */

import { ANCHOR_SCHEMA, OPENING_SCHEMA, gateSchema } from "./schemas.js";
import { questionType } from "./questions.js";
import { BEAT_RETRY_NOTE, beatIsTerritory } from "./anchor.js";

/**
 * The gate call, as a value rather than as a request.
 *
 * Exported for scripts/judge_probe.mjs alone, which varies the payload on the
 * wire -- thinking on or off, schema echoed or not -- and so needs the parts
 * rather than the verdict. Everything else goes through judgements() below.
 *
 * It takes the card, not the session, because the card is all it ever read.
 * Saying so in the signature is what lets a frozen exchange be re-judged
 * without building a fake session around it and leaving a comment to explain
 * which parts of it were load-bearing.
 *
 * @param {object} pack
 * @param {object} options
 * @param {{card_id: string, position: string}|null} [options.card] the card face
 *   up when the answer was given, or null before the reading started
 * @param {string} options.question the reader turn it answered
 * @param {string} options.answer
 */
export function gateCall(pack, { card = null, question, answer }) {
  return {
    kind: "gate",
    system: JUDGE_SYSTEM,
    messages: judgeMessages(pack, { card, question, answer }),
    schema: gateSchema(pack),
  };
}

/**
 * @param {object} deps
 * @param {{judge: (call: object) => Promise<object>}} deps.client
 * @param {object} deps.pack
 * @param {(beat: string) => void} [deps.onBeatRetry] told when a beat came back
 *   as a verdict and is being asked for again. Reporting only; the retry happens
 *   either way.
 */
export function judgements({ client, pack, onBeatRetry = () => {} }) {
  return {
    /**
     * The first thing they said, before anything is dealt: did they name a
     * topic, and is a tarot frame the wrong thing to hand this person.
     */
    opening({ question, answer }) {
      return client.judge({
        kind: "opening",
        system: OPENING_SYSTEM,
        messages: openingMessages({ question, answer }),
        schema: OPENING_SCHEMA,
      });
    },

    /**
     * One answer, read against the pack's rubric. How deep, whose life it was
     * about, what it costs to have said it.
     */
    gate({ card, question, answer }) {
      return client.judge(gateCall(pack, { card, question, answer }));
    },

    /**
     * The narrative plan, and a second ask if the beat came back as a verdict.
     *
     * Once, not until it complies: the cost of a conclusive beat is that the
     * rest of the reading steers toward confirming it, and the cost of re-asking
     * forever is a session that never starts. One retry buys most of the value.
     *
     * Whatever comes back second is what the reading gets. A judge that will not
     * phrase a territory twice running is not going to on the third ask, and the
     * reading is not held up over it.
     */
    async anchor(session, { rolling = false } = {}) {
      const ask = (note) => client.judge({
        kind: "anchor",
        system: ANCHOR_SYSTEM,
        messages: anchorMessages(pack, session, { note, rolling }),
        schema: ANCHOR_SCHEMA,
      });
      const first = await ask("");
      if (beatIsTerritory(first.resolution_beat)) return first;
      onBeatRetry(first.resolution_beat);
      const second = await ask(BEAT_RETRY_NOTE);
      return beatIsTerritory(second.resolution_beat) ? second : first;
    },
  };
}

// -- what each judgement is made of ------------------------------------------
// Private from here down. These are the parts that used to be paired by hand.

const JUDGE_SYSTEM = `You are reading one answer from someone in a tarot
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

const ANCHOR_SYSTEM = `You are committing the narrative plan for a tarot
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

const OPENING_SYSTEM = `You are reading the first thing someone said in a
tarot reflection session, before any card was dealt. They were asked whether
there is something particular they want to look at. You never speak to the user.

Decide two things.

Did they actually name something? "Not really", "just curious", "surprise me",
"you tell me" and any polite deflection are all no. A topic is something with
edges — a person, a decision, a situation. If they named one, give it back in
their own words, compressed, never rewritten into your vocabulary.

And what are the stakes? You are deliberately quick to escalate, because this is
the earliest point at which a reading can be the wrong thing to be doing.`;

function openingMessages({ question, answer }) {
  return [{
    role: "user",
    content: `They were asked: ${question}\nThey answered: ${answer}`,
  }];
}

/** What the judge sees: the card on the table and the answer under examination. */
function judgeMessages(pack, { card: entry, question, answer }) {
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
function anchorMessages(pack, session, { note = "", rolling = false } = {}) {
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
