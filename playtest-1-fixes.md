# Playtest round 1 — evaluation and fix plan

Feedback from the first stranger playtest (2026-09-01, phone, hosted page). Eight
observations. Each one is traced to what the code actually does before a fix is
proposed, because two of them look like prompt problems and are not.

The short version: five are small UI fixes and they are the ones that matter
most, because between them they explain why the playtester resent a message
and got the wrong answer. One is a real prompt change. One is scripting that
removes an LLM call. One is a design tension to resolve on purpose rather than
by adding "suggestions".

## The observations, evaluated

### 1. "Say it" should be "Send" — agree, trivial

`web/index.html:130`. The label was chosen for the app's voice; a stranger read
it as a speech feature. Nothing about the design depends on the word. Change it.

### 2. Show waiting dots while generating — agree, and it is bigger than it looks

What happens after Send today, in `web/js/ui/session.js` and `engine/reading.js`:

1. the user line is appended;
2. `judge.gate(...)` runs — a whole non-streamed LLM round trip;
3. on a flip turn, `judge.anchor(...)` runs too, awaited before the reader speaks;
4. only then `reader_start` fires and an empty streaming bubble appears.

Steps 2–3 are several seconds of nothing on screen — no bubble, no dots, input
still live with its placeholder showing (that is the screenshot). The streaming
bubble covers only the last part of the wait. Same on Begin: the opening turn
has no pending state either.

Fix: a pending indicator shown the instant `say()`/`start()` is entered,
replaced by the streaming bubble at `reader_start`, removed on error. UI-only.

### 3. First message should say what this is and that it is an AI; script it — agree

The intro already says "nothing here predicts anything" and "bring your own
key", but the intro disappears the moment a reading starts
(`body[data-phase="reading"] #intro { display:none }`), and a phone user has
skimmed straight to Begin. The transcript itself never says who is talking.

The playtester's proposal is right on both counts:

- **The disclosure is scripted, not generated.** It is a statement of fact
  about the app (AI, no prediction, where the text goes, not therapy), and the
  model should not be asked to improvise its own honesty line. It belongs in
  pack data, styled as the app speaking rather than the reader in character.
- **The opening question can be scripted too.** `TURN_INSTRUCTIONS.opening`
  already pins the turn to fixed content in two sentences ("ask if there is
  something particular… make declining easy… do not offer a menu"). The model
  adds latency and a per-session call, and nothing else. Scripting it makes the
  first thing on screen instant and removes one failure point before the first
  card. Cost: the opening loses persona-voice variation, which nobody will
  notice in a two-sentence question.

Per the working agreements this removes the `opening` reader turn rather than
keeping it beside the script. The opening *judge* (`judge.opening`) stays — it
still classifies the answer for topic and safety.

### 4. Questions are hard to understand on first read — agree; it is a prompt problem

Addendum after Prompt A shipped, from a live turn: "Whose wand is that in your
world — who's about to do the trick?" The bridge from picture to person is
carried by an idiom, so the reader never learns the frame has shifted. The
`own` move needs an explicit, declinable signpost on the first bridge (see
Prompt D, item 4), and "the trick" is the reader's noun, not theirs.

The persona's voice is literary by design, and the exemplars the reader is shown
teach it that register: "Whose tiredness is that, in your world — yours about
something, or someone's about you?", "Was there a week it wasn't running the
show?". Good sentences; slow ones, especially on a phone or in a second
language. The engine already has a `clarify` turn for "what do you mean?",
which is evidence the problem was anticipated downstream. Fix it upstream.

Two-part fix: a **Plain words** section in `data/persona.md` (draft below) and a
rewrite of the `levels[].exemplars` in `data/deck.json` in the same register.
The observation may keep their images; the question carries none but theirs.

### 5. No way back after opening Settings or Readings — agree

Both are `<details>` in the header. They close by tapping the pill again, which
is not a thing a stranger knows; open, the panel takes a full row and on a
phone pushes the table and chat down. Settings also opens itself when there is
no key, so a first-time user meets this immediately.

Fix: a **Done** button at the foot of each panel, Escape closes, and opening one
closes the other. Worth checking on iOS separately: a blob download via
`a.download` there can open the file in the same tab, which would also read as
"no way back after download" — verify on a real iPhone before assuming it is
only the panel.

### 6. Resent a message and the reply was about the previous one — agree it is a bug; disagree on the cause

This is not the model weighting the wrong message. `mountSession.say()` has no
in-flight guard: the input and button stay live while `reading.say()` is
running, so a second Send starts a **second `reading.say()` racing the first
over one session**. The second message is gated against the old
`lastQuestion`, two `readerTurn`s interleave, and the first turn's answer lands
on screen after the second user line — exactly what was seen. The engine's own
comment around the picker names this failure ("a second say() on top of the
first one is two turns running at once over one session"); it is only guarded
there.

Item 2 is what triggers it: several seconds of silence after Send is what makes
a person send again.

Fix, two layers: the form locks while a turn is in flight (UI), and
`reading.say()` refuses re-entry while a turn is running (engine), so the debug
page and tests are protected too. Add a test.

Do **not** add a "bias the latest message when two are similar" rule to the
prompt. It treats the symptom, and it would make the model second-guess a
person who legitimately gives the same short answer twice.

### 7. More suggestions / readings at the end; feels general — partially agree; resolve deliberately

This one is a design tension, not a defect. The whole persona forbids advice and
prediction on purpose: the close is "one small concrete thing to notice or do",
**sized to how far they got**. Someone who gave the reading little gets a step
that is "something to notice", and that is designed to be small — which reads
as general. Adding suggestions would be building the thing the project exists
instead of.

Three things that do help without breaking it:

- **Make the close specific or not at all.** The close instruction already says
  to start from the phrase they used most or the place the reading turned; the
  generic version happens when the model has thin material and pads. Tighten:
  every sentence of the close must quote or point at something they said, and
  a thin reading closes shorter, not vaguer.
- **Offer the traditional meanings at the end, opt-in.** The persona already
  allows meanings when asked; it just never offers. After the close, one button
  — *"What do these cards traditionally mean?"* — runs a `meanings` turn: one
  plain sentence of tradition per turned card, beside what *they* saw in it.
  This is the "tarot reading" people arrive expecting, delivered after the
  projection work is done and only on request. It is the single change most
  likely to move "feels general".
- **Measure first.** Three real transcripts are in `checkpoint/`. Read the
  closes before rewriting the instruction; if they are specific and the
  playtester still wanted more, the meanings offer is the answer, not the close.

### 8. Page should scroll to show the whole reply — agree; one-line cause

`addLine()` calls `scrollIntoView` once, when the bubble is created **empty**.
Streaming then grows the bubble and nothing scrolls, so the bottom of every
reply is below the fold unless the user drags. Fix: scroll the transcript to
its bottom on each `reader_delta` and on `reader_done`, unless the user has
scrolled up (stick-to-bottom check). Scroll the `.transcript` element itself
(`scrollTop = scrollHeight`) rather than `scrollIntoView`, which on a phone can
scroll the page instead of the pane.

## The plan

One branch, `playtest-1`. Slices in this order — the first is the one that
matters, and it is the smallest.

| # | Slice | Files | Size |
|---|-------|-------|------|
| A | Send label; pending indicator; in-flight lock (UI + engine); scroll-on-stream | `index.html`, `main.css`, `ui/session.js`, `engine/reading.js`, `tests/engine/reading.test.mjs` | small |
| B | Done buttons, Escape, one panel at a time | `index.html`, `ui/session.js`, `main.css` | small |
| C | Scripted disclosure + scripted opening question; remove the `opening` reader turn | `data/deck.json`, `engine/reading.js`, `engine/prompts.js`, `ui/session.js`, tests, `journal.js` | medium |
| D | Plain-words rule in persona; exemplar rewrite | `data/persona.md`, `data/deck.json`, golden prompt test | small, prompt-only |
| E | Meanings offer after the close; close tightened | `engine/reading.js`, `engine/prompts.js`, `index.html`, `ui/session.js`, tests | medium |

Each slice is a commit (or two). Every commit that changes behaviour the plan
describes updates the plan changelog in the same commit, per AGENTS.md. Run
`node --test tests/engine/*.test.mjs` (with the glob) before each.

Done-when for the round: the same playtester, or a new one, completes a reading
on a phone and (a) never resends, (b) never asks what a question meant more
than once, (c) reads the whole of every reply without dragging.

## Prompts

Each one is meant to be pasted into Claude Code as-is at the repo root. They
assume the working agreements in AGENTS.md and the v1.5 plan are loaded.

### Prompt A — the round trip: label, dots, lock, scroll

```
Read AGENTS.md and web/js/ui/session.js, web/js/engine/reading.js, web/index.html,
web/css/main.css before changing anything. We are on branch playtest-1.

Four fixes from the first stranger playtest, all about the moment after Send.
Keep the engine free of DOM and the UI free of pacing decisions.

1. web/index.html: the reply button label "Say it" becomes "Send". Nothing else
   about the form changes.

2. Pending indicator. Today nothing appears on screen between Send and
   reader_start, and reader_start only fires after the gate judge (and on flip
   turns the anchor judge) has completed — several seconds of silence. In
   session.js, show a pending line (three dots, class "line reader pending",
   animated with CSS, respecting prefers-reduced-motion) the moment say() or
   start() is entered. At reader_start, the pending line becomes the streaming
   line (reuse the element; drop the pending class) so nothing jumps. On
   reportError, remove it. Do not add an engine event for this: the UI already
   knows when it called say().

3. In-flight lock, two layers.
   - UI (session.js): while a turn is in flight, the reply input and Send are
     disabled and the form has aria-busy="true"; re-enabled in a finally block
     so an error never leaves the form dead. Reuse the existing pattern the
     picker uses (form.inert) if it reads cleaner, but the input must be
     visibly unavailable, not just ignored.
   - Engine (reading.js): startReading's say() must refuse re-entry. Keep a
     private `busy` flag set for the whole of say()/openWith()/afterward() and
     begin(); a second call while it is set throws Error("a turn is already in
     flight"). This is the guard the picker comment already describes as
     necessary ("two turns running at once over one session") and it belongs
     in the engine so the debug page and tests get it too.
   - Test, tests/engine/reading.test.mjs: with a fake client whose chat() does
     not resolve until told, call say("a") then say("b") without awaiting the
     first; assert the second rejects with the in-flight error and that the
     session records exactly one exchange after the first resolves.

4. Scroll on stream. addLine() scrolls once, when the bubble is created empty,
   so a streaming reply grows below the fold. In session.js, on reader_delta
   and reader_done, scroll the #transcript element to its bottom
   (transcript.scrollTop = transcript.scrollHeight) — not scrollIntoView, which
   on a phone can scroll the page instead of the pane. Only do it when the user
   was already within ~48px of the bottom before the delta, so someone who
   scrolled up to reread is not yanked down. Apply the same to the pending line
   and to user lines.

Run node --test tests/engine/*.test.mjs (the glob matters on Node 22). Small
commits, one per numbered item or two if they touch the same lines. Update the
Plan changelog in .claude/plans/ai-tarot-v1.5-plan.md in the commit that adds
the engine guard, since the plan describes say() as the one entry point.
```

### Prompt B — a way back out of the panels

```
Read web/index.html, web/css/main.css and web/js/ui/session.js. Branch playtest-1.

Settings and Readings are <details> in the header. A playtester on a phone
opened Settings, and again after downloading a reading, and could not find the
way back: the only close is tapping the pill again, and an open panel takes a
full row and pushes the table down. Settings also opens itself on first visit
when there is no key, so this is the first thing a stranger meets.

Make the way out obvious, without adding a framework:
- A "Done" button at the foot of each panel's content (index.html), styled
  like the existing secondary buttons, that closes its <details>. Wire it in
  session.js by walking to the closest details and setting open = false — no
  ids per panel.
- Escape closes whichever header panel is open.
- Opening one header panel closes the other (a "toggle" listener on each
  details in .top). The nested Advanced <details> inside Settings is not a
  header panel and is not affected.
- revealField() still opens the chain it needs; nothing there changes.
- The debug page shares session.js. Confirm it still loads and that its
  panels (which are markup-opened) are unaffected — scope the behaviour to
  details that are direct children of .top.

Also add a note to the commit message, not the code: on iOS Safari a blob
download via a.download can open the file in-tab, which would read as the same
complaint; to be verified on a device before deciding it is only the panel.

Run the tests, commit.
```

### Prompt C — the first two lines are scripted

```
Read AGENTS.md ("do not preserve backward compatibility"), data/deck.json,
web/js/engine/reading.js (begin, openWith), web/js/engine/prompts.js
(TURN_INSTRUCTIONS.opening, readerMessages), web/js/engine/state.js
(createSession, recordOpening), web/js/engine/journal.js, web/js/ui/session.js,
and tests/engine/reading.test.mjs. Branch playtest-1.

Playtest finding: the transcript never says who is talking or what this is —
the intro says it, but the intro is hidden the moment a reading starts, and a
phone user skips it. And the opening question, which the model currently
generates, is fixed content in two sentences by its own instruction.

Change: the first two things in the transcript are scripted from pack data and
cost no LLM call.

1. Pack data. In data/deck.json add
     "opening": {
       "disclosure": "...",
       "question": "..."
     }
   Disclosure, first draft (edit for voice, keep it this short):
     "You're talking to an AI playing a tarot reader. It doesn't predict
      anything and it doesn't know you — the cards are something to think
      out loud at. What you type goes to the model you chose, with your key,
      and nowhere else. This isn't therapy or crisis support; if things are
      heavy right now, findahelpline.com lists people who can help."
   Question, first draft:
     "Before I turn anything over — is there something particular you'd like
      to look at today? 'Not really, just curious' is a perfectly good answer."
   Expose both through pack.js like persona and few_shots are.

2. Engine. begin() no longer calls readerTurn("opening"). It sets
   lastQuestion and session.pending_question to pack.opening.question, emits
   { type: "reader_scripted", role: "note", text: pack.opening.disclosure }
   then { type: "reader_scripted", role: "reader", text: pack.opening.question },
   persists, and returns. openWith() is unchanged: judge.opening still runs on
   the answer, recordOpening still records question + answer, so the journal
   and the session record carry the opening exactly as before.
   Remove TURN_INSTRUCTIONS.opening and every branch that exists only for the
   opening turn kind (describeTopic's phase==="opening" early return stays only
   if something else still needs it; check ladderPlan.shown). Delete, do not
   deprecate.

3. UI (session.js). Handle reader_scripted: role "note" renders as a quiet
   line (class "line note", smaller, no gold rule — it is the app speaking, not
   the reader in character); role "reader" renders as a normal reader line and
   enables the download buttons the way reader_done does. The debug page gets
   the same through the shared module; check debug-page.js does not assume
   chat call index 0 is the opening.

4. Journal. toMarkdown should print the disclosure once at the top of the
   transcript section so an exported reading says what it was. Add
   pack.opening.disclosure there; do not store it in the session.

5. Tests. Every test that asserts client.calls.chat[0].turn === "opening" or
   that indexes reader calls assuming the opening is index 0 is now wrong —
   fix them to the new shape rather than shimming. Add: begin() makes no chat
   call; the first exchange's q equals pack.opening.question; the journal
   markdown contains the disclosure once. Fixtures under tests/fixtures/ that
   pin the old opening turn are updated, not preserved.

Update the Plan changelog: the opening turn is scripted, and why (fixed
content, one fewer call before the first card, honesty line not improvised).
Small commits: data + engine + tests first, then UI, then journal.
```

### Prompt D — plain words

```
Read data/persona.md, the levels[].exemplars and few_shots in data/deck.json,
and tests/engine/turn-plan.test.mjs (for how golden prompt assertions are
written). Branch playtest-1. This slice changes prompts and pack data only.

Playtest finding: the reader's questions need a second read. The persona voice
is literary and the exemplars teach that register ("Whose tiredness is that, in
your world — yours about something, or someone's about you?"). Fix upstream so
the clarify turn is rarely needed.

1. Add this section to data/persona.md, immediately after "## Voice":

   ## Plain words

   Write so that someone reading fast, on a phone, in their second language,
   gets the question the first time. Short common words. One idea per sentence.
   The question names something concrete they can look at or remember — a
   figure, a thing, a day — never an idea they first have to unpack. A
   ten-year-old should be able to read your question aloud and know what is
   being asked.

   Warmth is not ornament. No metaphors of your own, no clever turns, no
   question folded around a dash, no "in your world". If a question would need
   a second read, it is too clever: write the plain version and send that. The
   observation may carry their images. The question carries none but theirs.

   This outranks sounding good. A beautiful question nobody can answer is a
   turn spent on you.

2. Rewrite levels[].exemplars in deck.json in that register — same height, same
   move, plainer words. For example
     "Was there a week it wasn't running the show, and what was different
      about it?"
   becomes
     "Was there a week when it wasn't so bad? What was different that week?"
   and
     "What does it say about what matters to you, that this is the one you
      can't put down?"
   becomes
     "Why does this one stay with you, do you think?"
   Do the same pass over the reader lines in few_shots: keep every technique
   and every rule they demonstrate, shorten the words. Do not touch the user
   lines.

3. The three moves in "## What kind of move" quote exemplar questions inline
   ("Whose tiredness is that, in your world…"). Rewrite those to the plain
   register too, so the section does not contradict the new rule three
   paragraphs later.

4. The crossing is said out loud. A real turn from the playtest:
     "You went from the ring above him to the wand in his hand — the part
      where he does something. Whose wand is that in your world — who's
      about to do the trick?"
   This follows the own-move exemplar exactly and it still fails, because the
   whole shift from the picture to the person rides on three words ("in your
   world") that a first-timer or a second-language reader does not hear as an
   instruction. The question lands as "whose wand is it?", which nobody can
   answer. Rewrite the **own** move in "## What kind of move" so that:
   - The first bridge on a card, not only the retry after a miss, is an
     explicit, declinable invitation. The shape is two parts: a plain signpost
     that says we are moving from the picture to them, then the question with
     a way out. Signposts in plain words, never naming the technique:
       "Put yourself in the picture for a second —"
       "If this card were about your own life —"
       "Does that happen anywhere in your life —"
       "Say the one with the wand was you for a moment —"
     followed by, e.g., "is there something you're about to do, or something
     you're waiting for somebody else to do? Maybe not — it can just be a
     picture."
   - Replace the two "in your world" exemplars (persona.md ~lines 350 and 366)
     with that shape. The retry exemplar in "When a bridge misses" already has
     it; make the first bridge match.
   - Add one sentence to "Point, don't name": the crossing question carries
     only their nouns. "Who's about to do the trick" imports the Magician's
     traditional reading unless they said "trick"; and it makes the question
     two-headed. One question, their words.
   - The persona rule "if they can name the move, the move has failed" stays.
     Signposting the frame shift is a courtesy, not a technique reveal; saying
     "if we map this image onto your life" would be the reveal, so do not use
     that wording.

5. Golden test: assert the assembled reader system prompt contains "Plain
   words", "second read", and "Put yourself in the picture". Nothing else
   needs a test.

Then sanity-check, not by feel: run one reading on the debug page against the
cheapest provider and paste the six questions it asked into the commit message
so the before/after is on record. Update the Plan changelog. One commit.
```

### Prompt E — the ending: specific close, and the meanings on request

```
Read data/persona.md ("What the card means", "The end"), web/js/engine/prompts.js
(TURN_INSTRUCTIONS.close, afterglow), web/js/engine/reading.js (afterward,
readerTurn's onCard flag), web/js/engine/state.js (recordAfterward), web/index.html
(#ended-row), web/js/ui/session.js, and the three transcripts in checkpoint/.
Branch playtest-1.

Playtest finding: the ending "feels a bit general; more suggestions would be
good". The persona forbids advice on purpose and the close is sized to how far
they got, so we do not add suggestions. Two changes that answer the feeling
without breaking the design:

1. Read the closes in checkpoint/ first. Write one line per transcript in the
   commit message: was the close specific to that person's words or not. If
   they were specific, skip step 2 and say so.

2. Tighten TURN_INSTRUCTIONS.close only if step 1 shows padding. Add:
   "Every sentence of this turn quotes or points at something they said this
   session. A sentence that would be true of anyone is cut. A reading with thin
   material closes shorter, not vaguer: two sentences and the step is fine."

3. Meanings on request. The persona allows the traditional meaning when asked
   and never offers it. After the close, offer once:
   - Engine: a new turn kind "meanings" in TURN_INSTRUCTIONS:
       "They asked what the cards traditionally mean. Answer, plainly, one
        short sentence of the traditional sense per card that turned over, in
        its position — the record above has them — and beside each, one clause
        of what THEY saw in it, in their words. No new question, no step, no
        closing. Do not name a face-down card."
     A method reading.meanings() on the object returned by startReading, only
     valid once session.closed is true and not ended; it records as an
     afterward exchange with question "(what do these cards traditionally mean)"
     and runs readerTurn("meanings", { onCard: false }). It does not count
     toward farewellDue. Throws if called before the close.
   - UI: a third button in #ended-row and beside the reply once the reading is
     closed: "What do these cards traditionally mean?" — shown once and removed
     after use. Wire to reading.meanings() with the same in-flight lock as say().
   - Tests: meanings() before close throws; after close it produces one
     "meanings" chat call whose turn block names every turned card and no
     face-down one; farewellDue is unchanged by it.

The playtester also wanted the ending to feel less thin: the meanings turn is
the answer to that, not a longer close. Say so in the Plan changelog entry.
Two commits: close (if any), then meanings.
```

## What not to do

- No prompt rule about weighting the newest of two similar messages (item 6):
  the cause is a race, and the rule would punish honest repetition.
- No suggestions or advice in the close (item 7): it is the one thing the
  persona is built to refuse, and the traditional-meanings offer gives people
  the "reading" they expect without it.
- No engine event for the pending indicator (item 2): the UI already knows
  when it pressed Send.

## Review of the branch (2026-09-01, after Prompts A–E)

`playtest-1` at 0fff7ab: 12 commits, 292/292 tests pass, deck validates
(schema v6), plan changelog updated. Slices A, B, C shipped as specified and
read cleanly. Three gaps, found by running the engine with the fake client:

1. **The meanings turn only has one card's curated meaning.** `describeCard`
   puts `meaning_here` in the prompt for the *current* card only, so after the
   close the prompt carries the advice card's traditional sense and nothing for
   the situation and obstacle cards (probe: `situation … in prompt: false`,
   `obstacle … false`, `advice … true`). The model fills the other two from its
   own tarot knowledge — the exact thing the pack's per-position `meanings`
   exist to prevent. The test passes because it checks card *names*, which the
   record table already has.

2. **Meanings can be asked after the farewell, and the export then says
   goodbye twice.** `meanings()` checks `closed` but not `ended`; the button is
   in `#ended-row`, so pressing it after the goodbye runs a reader turn after
   "the last thing you say", and `toMarkdown` prints `[farewell]`, the meanings
   exchange, then `[farewell]` again.

3. **Prompt D item 4 was not done.** "in your world" was removed from the
   exemplars, but the explicit, declinable crossing signpost ("Put yourself in
   the picture for a second —") is not in the persona, the `own` exemplar is
   still the bare "Whose tiredness is that: …", and "Point, don't name" did not
   get its sentence about the crossing question carrying only their nouns. The
   golden test asserts "Plain words" and "second read" only.

Minor, no action needed unless it bothers you: in physical mode the three dots
stay up while the picker is open (openWith awaits identifyCard before any
reader turn), so the reader looks like it is "thinking" while the person is
choosing a card.

### Prompt F — the three gaps

```
Read web/js/engine/prompts.js (cardPlan, describeCard, readerTurnBlock,
TURN_INSTRUCTIONS.meanings), web/js/engine/reading.js (meanings), web/index.html
(#ended-row), web/js/ui/session.js (offerMeanings, handleEvent "ended"),
web/js/engine/journal.js (toMarkdown), data/persona.md ("## What kind of move",
"## Point, don't name"), tests/engine/reading.test.mjs (the meanings tests and
the Plain-words golden test). Branch playtest-1.

Three gaps from review of the branch.

1. The meanings turn is missing two of the three meanings. describeCard puts
   meaning_here in the prompt for the current card only, so after the close the
   reader has the advice card's curated position sense and improvises the other
   two from its own knowledge — which is what the pack's per-position meanings
   exist to prevent. Fix in prompts.js: turnPlan gets a field `meanings` that
   is null on every turn except kind === "meanings", where it is one entry per
   FACE-UP card in table order: { position, label, name, meaning_here,
   projection }. readerTurnBlock renders it as its own section ("## What they
   traditionally mean") between describeRecap and the turn instruction, one
   line per card, and describeCard is skipped on this turn (the current-card
   block would duplicate one of them). Face-down cards are absent from the
   section, not listed as unknown. Tighten the existing test: for every
   face-up card, assert the prompt includes pack.meaning(card, position); for
   the face-down one, assert its meaning string is absent as well as its name.

2. No reader turn after the goodbye. meanings() throws if session.ended
   ("the reading has ended"), same as say(). Remove the .meanings button from
   #ended-row in index.html; the way to the meanings after a farewell is
   "Stay a while", where the reply form and its button come back — this costs
   nothing and keeps the farewell as the last thing the reader says. In
   session.js, offerMeanings needs no change once the second button is gone;
   check that the "ended" branch of handleEvent hides nothing it now cannot
   find. Test: meanings() after the farewell rejects with /ended/, and
   toMarkdown never prints the farewell twice (assert the farewell text
   appears exactly once in the export of a session that asked for meanings in
   the afterglow).

3. The crossing is said out loud (Prompt D item 4, not done). In persona.md:
   - Rewrite the **own** move so the FIRST bridge on a card is a two-part
     sentence: a plain signpost that says we are moving from the picture to
     them, then the question with a way out. Signposts, in plain words and
     never naming the technique:
       "Put yourself in the picture for a second —"
       "If this card were about your own life —"
       "Say the one with the wand was you for a moment —"
     Replace the exemplar with, e.g.:
       "Put yourself in the picture for a second — whose tiredness is that:
        yours about someone, or someone's about you? Maybe not; it can just be
        a picture."
     Update the matching few-shot (the tired-figure bridge in few-shots.json)
     to the same shape so the persona and the shots agree.
   - "## Point, don't name" gets one sentence: the crossing question carries
     only their nouns — "who's about to do the trick" imports the Magician's
     traditional reading unless they said "trick", and it makes the question
     two-headed. One question, their words.
   - Keep "if they can name the move, the move has failed". Signposting the
     shift is a courtesy; "if we map this image onto your life" would be the
     reveal, so do not use that wording anywhere.
   - Golden test: the reader system prompt contains "Put yourself in the
     picture".

Run node --test tests/engine/*.test.mjs. Three commits, one per item. Update
the Plan changelog for items 1 and 2 (they change what the meanings turn is
and when it is available); item 3 is pack data and needs no entry.
```
