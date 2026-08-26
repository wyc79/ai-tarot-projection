# AI Tarot - v1.5 Plan

## Concept
Tarot as a doorway, not divination. The cards are projective prompts that get people (especially therapy-avoidant people) to open up and reflect. The AI is a warm reader that guides the conversation; it never predicts. Tarot is one swappable "symbol pack" on top of a generic reflection engine.

## Positioning
- For people who don't believe in tarot but believe in thinking out loud (validated by competitor reviews)
- Differentiators vs. Aluma / TAROGO / Inner Arcana:
  1. Flip-gating: cards are earned by disclosure, not dealt up front (nobody has this)
  2. Coherence by design (anchor + ledger), not cooldown patches
  3. BYOK + open source + stateless (no data at rest anywhere): provably private, auditable
  4. Symbol packs as data: fork it, drop in your own deck

## Core mechanics
- FULL FACE-DOWN DEAL: the whole spread - situation, obstacle, advice AND the fourth card - comes
  off the pile at once and goes face down on the table before a word is said. Reveal order and
  gating are unchanged; cards turn over in place as the reading earns them. Same pile, same order,
  so a seed deals what it always dealt. The point is that face-down cards ahead are the flip
  gate's incentive made physical, for every position rather than just the last one, and until this
  they were invisible. session.deal holds the table; which ones are face up stays derived from
  cards[], so the two cannot disagree. The fourth is unlabelled while it is down - naming it
  "epilogue" before it turns tells someone there is a bonus card to play for
- 3-card spread (situation / obstacle / advice), plus an EARNED 4th card that reads as epilogue.
  Pack data (deck.json `epilogue`), deliberately not a fourth entry in positions[]: the spread is
  three and this one only exists when the reading earned it. THE EARN CHECK RUNS AT THE
  ADVICE-TO-CLOSE BOUNDARY, before anything is closed. Two ways to pass it: something of their own
  and unhedged on the advice card, or an unhedged life answer at DEPTH_ENOUGH anywhere in the
  session. Earned, it turns, spends its own budget, and the reading closes ONCE over four. Not
  earned, it stays face down and the closing beat names it in one line - "one card stays with the
  deck today; it'll be there when you come back" - as an invitation and NEVER as a grade. That
  line is the return hook, and tier-3 memory can open on it later
- THE DOUBLE CLOSE (from tower-6e335b) is what moving that check fixed. Earned after the beat, a
  session that got somewhere closed twice: a reflection over three cards, then a fourth card, then
  a second reflection visibly reusing the first one's "N cards, in your own words" formula, and
  the first stop landing on a 3-card table. Two endings is not a bonus; it is a reading that does
  not know when it finished. Exactly one closing beat per session, scanner code `double_close`, and
  the persona carries two or three closing shapes so the formula is not the only form
- Before anything is dealt, ask whether there is something particular they want to look at.
  A named topic becomes the ground the reading is bent toward and seeds the anchor; declining
  is a normal answer and proceeds as before. Stakes are classified on that answer too, so the
  frame can be dropped before a single card is turned
- First card flips as soon as that is answered; each next card flips after ~2 question-answer exchanges
- Depth-gated, not count-gated: rich answer can flip early, thin answer gets a softer follow-up instead of stalling
- DWELL RULE (from river-89c1fb): a fresh life disclosure blocks the flip on the turn it arrives.
  One exchange spent inside that material before the card is flip-eligible again; the dwell
  follow-up moves horizontally or one step, never more, and stays on the life rail. A deflection
  releases it immediately - never trap someone who regrets sharing. The counted exits still fire,
  so a dwell delays a card by one exchange and never more; when the disclosure lands on the card's
  last available exchange the cap wins and the flip reason records that it cut one short
- SETTLE RULE (from lantern-be7743): the `own` move is not eligible until the card has footing
  under it - two exchanges on this card, or one answer that already carried something of their
  own (has_life_content). Never bridge from first contact. A "whose is that in your world" thrown
  at the first sentence someone says about a picture reads as an agenda rather than an offer, and
  what comes back is "couldnt think of any" - after which the bridge is spent and the card is
  worse off than before. The engine reports settled/not on every turn; the scanner flags a
  crossing that fired without it
- ELABORATE MOVE: image rail, name level - ask what makes their read what it is ("what is it
  about the rain that reads as positive to you?"). Not a stall: it is the material the bridge
  rides on, and the crossing that follows quotes the strongest phrase in the answer. lantern's
  elaboration got the richest answer of the session where the premature bridge had got nothing.
  Weighted ahead of `own` on the situation position
- TEMPO, as a trio: settle before bridging, bridge rather than staying in the picture, dwell once
  a disclosure lands. Every transition earns its footing before it moves. Eagerness is not
  readiness; the reader sets the pace and the reading has time. An eager answer is met with one
  more question inside it, not a scene change - the flip is the reward mechanic, so flipping on a
  disclosure teaches that opening up ends the subject
- Consequence of the trio: three transitions do not fit in three exchanges. A card may run ONE
  exchange past MAX_EXCHANGES, and only to dwell inside something they just said. A card nobody
  disclosed on gets no grace and still moves on at three, so pure card-description sessions keep
  their old tempo exactly
- Co-interpretation (projection-first reading): card flips, AI speaks second
  1. Flip, show card name only. No caption describing the picture: a printed
     description is something to agree with, and agreeing is not projecting.
     The imagery line stays as alt text and as the reader's fallback (below)
  2. AI asks the user to read it first ("what does this card feel like it's pointing at for you?")
  3. User's projection is the disclosure; AI builds on their words
  4. Rhythm per card: flip -> user projection -> AI follow-up -> next flip
  - HARD RULE (from the A/B run): the turn that deals a card MUST ask the projection question.
    Life questions wait until the projection is in. Pro-tier models drift on this; it is a
    protocol violation, not cleverness, and the scanner checks for it
  - POINT, DON'T NAME (from c145c7): details[] is deictic vocabulary. The reader may use it to
    recognise what the user pointed at and to reference regions spatially ("the ones below him"),
    never to assert what a thing is or what a figure is doing ("holding the plans", "building
    what they want"). Premise test, per turn: every fact a turn asserts about the picture must
    trace to the user's words or to literal pointing. Once they name a thing it is theirs and the
    reader may use it back. The scanner flags pack vocabulary that reached a turn without passing
    through the person
  - REVEAL ON REQUEST: if the user asks what a card traditionally means, answer plainly and
    briefly, then hand it back to their read - correction-wins honesty extends to card tradition.
    Otherwise traditional meaning enters only as the two sides of a forced choice, phrased from
    what the user noticed. There is no "light traditional flavor" allowance any more; it read as
    permission and was used as one
  - The ownership move (`own` in the question policy) is the bridge from projection to life:
    offer the connection at the user's current level, never assume it. "<their phrase> - whose is
    that, in your world: yours about something, or someone's about you?", or Clinton's "when have
    you felt this way?". Weighted first on the situation position
- PER-POSITION BUDGET: positions[] carries target and max beside ceiling, and both rise across
  the arc the way the ceiling does - situation 2/4, obstacle 3/5, advice 3/5. The card whose job
  is to find the ground does not need long to find out that it has not; the cards after it are
  working with material that took a while to arrive. The session denormalises the budget off the
  pack the way it does positions, so the rules stay pack-agnostic and a replayed session paces as
  it actually paced
- A RICH ANSWER NO LONGER BUYS AN EXEMPTION. depth 4 used to take the next card the moment it
  landed, whatever had been spent on the position, which left the obstacle card two exchanges long
  in the seeded fixture with the best thing anyone said on it being the thing that ended it. It
  now spends the budget like any other answer. This finishes the argument the dwell rule started:
  a disclosure never ends its own card. Cost, and it is real: someone who gives nothing on every
  card runs 12 exchanges rather than 8
- Closing is unconditional: after the advice card's budget is spent, the closing beat fires
  regardless of depth. A session can never hang unclosed (B run proved it can)
- CLOSING IS NOT HANGING UP, AND A SESSION STILL ENDS. Amended from the version above it, which
  said the beat was the last thing about the spread and then the conversation stayed open until a
  person shut it. What an open tail with no shape actually produced (tower-6e335b) was an
  interview: nine exchanges asking after the nouns in a side project, at name level, while the
  session's heaviest disclosure went unmentioned. A conversation with no ending does not end, it
  degrades. So the tail is two contracted things:
  - DEFAULT AFTERWARD, budget { target: 1, max: 3 }. The first answers get real replies - that is
    what the budget is for, and "what happens after noticing?" deserves one. Past the target the
    farewell fires unless they are still saying something real; past the cap it fires regardless
  - THE FAREWELL, and it is a turn shape of its own: echo the noticing in one line, leave the door
    open, and NO QUESTION - the one turn in the product that deliberately ends without one, because
    holding someone at the door is how a good hour becomes an awkward one. The engine sets
    session.ended on it. The button that ends a reading early is still there and still a person's,
    and it stops without a goodbye, which is what walking out looks like
  - HEAVY-MATERIAL RIGHT OF WAY: any stakes:high recorded this session gets one gentle line before
    the door. Not advice, not the referral again, not reopening it. A goodbye that talks about
    everything except the heaviest thing someone said tells them you were not listening to the
    important part. Scanner code `heavy_material_dropped`, on the closing beat onward
  - AFTERGLOW, by explicit choice ("stay a while", offered by the farewell and taken by a person).
    Four rules: questions stay inside the anchor's noun space (topic + user_phrases, frozen at the
    close - if it included what was said since, drift would bootstrap itself); movement is UP the
    staircase into what was already found, never sideways into new content; a turn MAY be a
    reflective statement with no question, and this is the only place that is true; and two
    consecutive answers with no life content in them send the reader back to the anchor or make it
    offer the door again. Scanner code `off_territory`, and questions.inTerritory is shared by the
    engine and the scanner so the two cannot disagree about what drift is
  - RE-DRAW is the sanctioned "keep going": after ended, a new reading starts a fresh arc and the
    ledger/anchor carryover rules govern coherence. Never extend a finished arc by wandering
  Turns after the beat live under their own positions - `afterward` and `afterglow` - so they touch
  no card's rhythm, and the gate still runs on them: stakes do not stop mattering because a reading
  finished, and the frame can still need dropping
- A QUESTION BACK IS NOT AN ANSWER (`asked_back` on the gate). "what do you mean whose heading
  out is that?" was being scored as a depth-1 deflection and charged to the card, so a question
  that did not land cost the user one of their exchanges instead of costing the reader a turn.
  It is now an aside: recorded at the card's position so the transcript and keepsake read in
  order, flagged so nothing counts it - not the budget, not the dwell, not the settle, not the
  ladder, not either map. The reader answers plainly and asks again smaller, and is told never to
  repeat the question that just failed. state.turnsOn() is the single place that filter lives
- Fallbacks: "I don't know tarot" -> point at imagery; one-word answers -> forced choice between two contrasting meanings drawn from the position's meaning space
- Position-aware meanings (from claude-tarot-skill): pack stores per-position meaning hints per card (meanings: { situation, obstacle, advice } + general fallback); same card reads differently by position, and the AI bends the user's projection toward the position's role in the arc
- Closing actionable step: session's last beat converts the resolution into one small concrete real-world reflection or action ("this week, notice when X happens"); makes the session feel complete. It should tie to something the user said they value, and quietly reinforce that whatever was found came from them, not the cards
- User-provided cards mode: skip the draw, interpret cards the user names (physical-deck users); same engine
- Seeded draws (from magicli_tarot): deterministic card sequence for reproducible playtests and prompt-version comparisons; date-seeded "daily card" is a possible later ritual hook
- Session coherence:
  - Anchor as narrative arc (not a static theme string): 3-card spread maps to setup -> tension -> resolution; anchor stores the theme + where the session should land, follow-up questions steer toward the resolution beat; the earned 4th card reads as epilogue (see Core mechanics - built, not deferred)
  - Ledger: record of cards drawn + interpretations given; new draws elaborate, never contradict
  - Spam re-draws handled diegetically ("the deck answers the same question the same way")

## Safety
- Reflective framing only, no predictive claims
- Correction wins, always: when the user disputes an observation, the correction is accepted and
  the anchor updates with their words. Disagreement is NEVER treated as confirmation or resistance
  (the unfalsifiable cold-reading move demonstrated in Semetsky 2006's own case study is the
  anti-pattern this rule exists to prevent)
- Stake-scaled guardrails (from claude-tarot-skill): flip gate classifies stakes (low | high | crisis); high (medical/legal/financial) keeps the tarot frame but explicitly hands agency back ("the cards can help you think, but this needs a professional / real information")
- Explicit "drop the frame" state: if user discloses crisis-level content (grief, self-harm), AI exits tarot voice, responds plainly, points to real resources. Reachable from turn one.
- Onboarding carries one quiet line that this is reflection, not therapy or crisis support, with a pointer to real help (Clinton 2024)

## Working agreements
AGENTS.md at the repo root, and CLAUDE.md points at it. The short form: build forward rather
than sideways (no compatibility layers, fallbacks or migrations beside a shape that changed -
delete the old path, and the tests that pinned it), the simplest implementation that fully meets
the current requirement, grow in layers from something that already works end to end, decide for
the long term rather than accepting a stopgap, keep concerns separated, and lean on what is
already here before adding to it. The key-handling rules and the transcript policy live there
too, since they were only ever written in commit messages.

## Architecture (v1: plain web frontend + dumb relays)
DECIDED: frontend is plain HTML/CSS/JS (no framework, no build step). Prompt assembly lives in frontend JS - packs are static files the frontend fetches, so assembly works identically everywhere. Two deployment targets share one llmClient:
- Local / self-host: Python serves the page + relays LLM calls (browser -> local Python -> provider)
- Deployed: GitHub Pages hosts the static frontend; a Cloudflare Worker is the hosted relay (browser -> Worker -> provider), auto-deployed via Cloudflare's Git integration (root /worker, build-watch paths so /web and /data pushes don't rebuild it)
- Relay contract (RELAY.md in repo): both relays implement the SAME interface - endpoint path, key in Authorization header, provider/model params, streaming, error shape. llmClient's relay mode takes a base URL and cannot tell them apart. Both are dumb pure pass-throughs (~100 lines each): read key, validate origin, rate-limit, forward, stream back. Neither knows anything about tarot; packs/prompts never require a relay redeploy.
- Frontend: plain HTML/CSS/JS. State schema documented as JSDoc-typed plain objects. Debug page first, styled UI in M4.
- BYOK: user pastes API key
  - Key in localStorage (prefixed keys, e.g. tarot:apikey) + session-only mode (memory, gone on refresh)
  - Relay key rules (hard requirements, both relays): NEVER stored server-side (no session maps, no globals, no files, no db), NEVER logged (redact auth material from all logging/error paths - test this), no user data at rest; all session state lives client-side
  - Direct mode kept as a third llmClient option (browser -> provider; anthropic-dangerous-direct-browser-access header for Anthropic; OpenAI-compatible base URL config covers Ollama/DeepSeek/etc.) - the maximally-paranoid path and CORS-permitting providers only
- Self-host path: clone repo, fill .env, run the Python server; README instructions
- Transcripts are never committed raw. The repo is public and the whole design exists to get
  people to say specific things about their lives, so the sessions worth freezing as fixtures are
  exactly the ones where that worked. Originals stay in gitignored checkpoint/; what is committed
  is a derivative from scripts/redact_session.mjs, which substitutes word-for-word across both
  sides of every exchange (the word overlap between an answer and the turn after it is what the
  premise and hedge checks read) and refuses to write if any mapped word survives. Substitution
  maps live in gitignored redactions/. A fixture is only redacted if its scanner findings are
  byte-identical before and after.
  AND SWEEP WIDER THAN THE FILE: the one sentence redacted on 2026-08-25 had already reached 24
  other places, including data/few-shots.json, where it was a teaching example shipped inside
  every prompt. Anything used as an example travels
- FIXTURES POLICY: a transcript with real personal content in it is never committed, redacted or
  otherwise. Where a session cannot be substituted safely the fixture is written from scratch with
  invented content in the same structural shape - the lantern and harbor precedent - and its
  README entry says which it is. The redaction pipeline above still applies to everything that
  goes through it
- Prompt iteration without redeploy (load-bearing for M3): packs, persona prompt, and few-shots are static data files assembled client-side - editing a prompt is a file save locally, a Pages deploy when hosted; relays are never touched
- The transcript sent to the model is the last 10 exchanges, with a line saying how many are
  missing. Affordable precisely because of the recap block below: everything a later turn must be
  consistent with is assembled from state every turn and outranks the history, so the oldest turns
  are texture rather than record. It is what makes an open-ended conversation after the closing
  beat bounded. Cost: the message list stops being a stable prefix once it slides, so incremental
  caching over messages is lost - the 22 KB that matters is the system prompt, which does not move
- Prompt is assembled in two halves, and the split is load-bearing: readerSystem is the stable
  prefix (persona, few-shots, standing rules, spread, topic - ~22 KB, identical every turn) and
  the turn block is what changes (session record, card, ladder, turn instruction - ~3 KB), sent
  in the last user message after the transcript. Both are assembled by readerCall(), which is the
  only entry point the controller uses: it takes the turn and returns {kind, plan, system,
  messages}. The halves are internal to it, so the split cannot be got wrong at a call site. Anything that does not change belongs in the
  prefix: it is what a provider can cache, whether it was told to with cache_control (the
  promptCaching feature flag, on for Anthropic) or does prefix caching by itself. Putting a
  per-turn value in readerSystem breaks caching silently, so it is worth checking
- The reader turn is decided before it is written. turnPlan() returns the turn's decisions as
  data - kind, rules (frame_dropped | stakes_high), face_down, ladder, the session record, the
  resolved card - and the prose renders from that plan and nothing else. Rules are asserted
  against the plan; prose has its own tests and is allowed to be about prose. Before this the
  assembled English was the only test surface: 108 of 645 assertions matched sentences and seven
  matched their line breaks, so re-wrapping a paragraph failed tests about the pacing. The turn
  kind is checked rather than defaulted - it was `TURN_INSTRUCTIONS[turn] ?? .respond`, which made
  a typo in the controller a silent respond turn - and it now rides on the call as `kind`, which
  is what retired turnKindOf() and its rule that nothing may be appended after the instruction
- A judgement is one name, not three facts that have to agree. judgements({client, pack}) has
  opening/gate/anchor; each pairs its own system prompt, messages and schema, and `kind` rides on
  the call. Four callers used to spell the triples out by hand and the test double identified
  them by sniffing schema.properties.theme. gate() takes the card rather than the session,
  because the card is all it ever read, so a frozen exchange re-judges without a stub session.
  anchor() owns the beat re-ask, so a caller asking for a narrative plan gets a valid one.
  gateCall() stays exported for judge_probe.mjs, which varies the payload on the wire
- cardStanding(session) is the one interface onto the card currently face up: position,
  exchanges, counting, asides, depth, grounded, dwell, settle, budget. It replaced six exported
  functions plus a seventh private copy in prompts.js, each of which re-found the card and
  re-walked the ledger. The rules are unchanged and still separate functions behind it. The debug
  page had been filtering session.exchanges by hand for its aside count, which made it a second
  implementation of the rule turnsOn() exists to hold
- The protocol scanner is engine code and lives in web/js/engine/scan.js - pure, browser-safe,
  imported by the engine tests, the seeded fixture, the A/B harness and available to the debug
  page. scripts/scan.mjs is the command line over it: read files, print, exit code
- Dev-mode logging (Python relay only): since every call passes through the relay with the fully assembled prompt in the body, a DEV_LOG=1 .env flag logs full request/response bodies (auth header redacted) for M3 iteration and consented playtest transcripts. Default off. The Worker has no logging code path at all - hosted users' conversations are unloggable by construction. Frontend debug panel shows the assembled prompt pre-send.
- Open-relay protection on the Worker: origin checks + per-IP rate limits (+ lightweight app token if abused)
- Session state + draw ledger in localStorage: same-device "session 2+" memory for free.
  STATE_VERSION is bumped when the session shape changes and saved readings at an older version
  are DROPPED rather than upgraded. There is no migration path and there is not going to be one:
  twenty sessions in one browser is not something to carry compatibility code for. Frozen
  fixtures are the exception and are not rewritten to match - they are transcripts the scanner
  reads, not sessions anything loads back as live state
- Two-model split (BYOK config): remains a config option, not a quality requirement - the
  2026-08-25 checkpoint showed flash-tier is past the quality bar for chat turns
- Abstractions: one llmClient module (relay mode with configurable base URL / direct mode), one storage module
- Provider registry separates which relay entry to name from which wire format to build, so several
  providers share one adapter. DeepSeek and OpenCode Zen both serve Anthropic-shaped endpoints and
  reuse it; default is deepseek / deepseek-v4-flash (confirmed by the model checkpoint - see M3).
  Each declares features (thinking, effort, structuredOutput, temperature, promptCaching) so the
  newest Anthropic parameters are not sent to gateways that have never heard of them, and judge()
  falls back to schema-in-the-prompt where needed
- Judge calls run with thinking OFF and effort at the minimum, wherever the feature flags say the
  provider implements the parameter. A judge call is rubric classification; deliberation buys
  variance in a call we want deterministic and latency in front of the person waiting. Chat turns
  are unchanged - they still send thinking adaptive, for the reason in the adapter
- OUTPUT BUDGET IS NOT THE CONTEXT WINDOW. max_tokens caps output, thinking spends from that same
  output budget, and DeepSeek's 1M is context. lantern-be7743's judge call came back
  response_truncated having generated nothing, on a 1M-context gateway. Judge ceiling is 4k where
  thinking could be turned off and 8k where it could not - lowering it flat would have halved the
  only headroom the provider that actually truncated has
- The schema pasted into the prompt (the fallback wherever structuredOutput is off) is the
  CONTRACT ONLY: keys, types, enums, required. Not the descriptions - those are the rubric the
  system prompt has already given at greater length, and 2.8 KB of it is a document a model may
  decide to reproduce rather than fill in. Measured on deepseek-v4-flash, five frozen calls each:
  the full schema returned itself instead of a gate on 2 of 5; the contract alone did it 0 of 5
- MEASURED, not assumed (deepseek-v4-flash, 2026-08-25, judge_probe.mjs --runs=5, one frozen
  judge call): thinking disabled + temperature 0 + contract-only schema costs 71-72 output tokens
  and returns the same verdict five times out of five. Thinking left unmentioned costs 490-4956
  and truncates 1 in 5. thinking:{enabled, budget_tokens: 1024} is accepted and NOT honoured -
  2116-7028 tokens and 2 truncations in 5 - so "cap it low instead" is worse than saying nothing,
  and that idea is recorded as refuted rather than deferred. Dropping the temperature pin also
  works but costs the determinism: 74-83 tokens and the verdict moves
- PARSING IS NOT COMPLYING. judge() checks the reply against the schema's required list before
  returning it. extractJson takes the first {...} in the reply, which is an object and not
  necessarily the right one: a model that echoes the schema back parses cleanly and has none of
  the fields, and that reached the session as disclosure_depth: undefined, where every threshold
  comparison is quietly false. A wrong reading that says so beats a wrong reading that does not
- scripts/judge_probe.mjs sends one frozen judge call several ways - thinking off, absent, capped;
  temperature pinned or not; schema echoed, compact, or described - and reports tokens and
  verdict per variant. It is how the above was found rather than guessed at
- A provider can hang up mid-response: chunked transfer with no terminating chunk, which arrives
  as IncompleteRead. By then the status and headers are already sent, so there is no error shape
  left - the relay ends the stream where it stopped and the client's own truncation handling
  takes it. What is NOT acceptable is the default traceback, which prints the request being
  served into the log of a relay whose whole promise is that it keeps nothing. Contract-tested
- Failures are classified, because they need different fixes: invalid_key, unknown_model,
  endpoint_not_found, provider_rate_limited, provider_unavailable, bad_payload, connection_failed,
  bad_provider_response, response_truncated
- Symbol pack = self-contained data dir; data/ is the pack root for smith-waite-1909 (deck.json + Cards-jpg/ images + persona prompt + few-shots). "Fork it, drop in your own deck" = point the loader at another pack dir.
- Card art: existing JPEGs in data/Cards-jpg/ (78 cards + CardBacks.jpg, 300x527, ~52KB each, 3.4MB total) - within budget, keep as-is, no webp pipeline
- GitHub Pages: project site (username.github.io/ai-tarot/), asset paths must be subpath-safe (relative paths, no leading /)

## State schema (as built)
Per session:
- session_id, seed, pack_id, started_at
- phase: opening | reading (nothing is dealt until the opening question is answered)
- topic: what they said they wanted to look at, in their words, or null if they declined
- anchor: { theme, user_phrases[{ phrase, source: card|life }], resolution_beat, grounded }
  (narrative plan, not a static string). The judge tags each phrase as it writes it; grounded is
  derived in commitAnchor from the tags, so it cannot disagree with them. theme and
  resolution_beat build from the life phrases when any exist. When none do, grounded is false,
  the resolution beat is about finding what matters to this person rather than about the
  picture's plot, and the recap tells the reader the theme is a placeholder.
  ROLLING (from river-89c1fb): the anchor is revised as life material accumulates rather than
  freezing on first commit - phrases append, theme and beat may be rewritten, hedged answers move
  nothing. The resolution_beat must be phrased as a territory, naming the question the session is
  walking toward with at least two live possibilities; a beat that reads as a conclusion is
  re-asked once with the reason, because a beat phrased as a finding makes every later question
  steer toward confirming it
- cards: [{ card_id, position, user_projection, ai_reading, flipped_at }]
- deal: [{ position, card_id }] - the whole spread, dealt face down before the first turn. Which
  ones are face up is NOT stored: tableau() derives it from cards[], so there is no second copy to
  disagree with the first. A session recorded before this exists has no deal and still reads
- phase: opening | reading | afterward | afterglow. There is no epilogue phase: the fourth card is
  decided before the close and is just the last card of the reading
- ended: the session is over and the goodbye has been said. Set by the engine on the farewell, or
  by a person walking out early, in which case `farewell` stays null. `farewell` sits beside
  closing_reflection rather than inside it - two different things said at two different moments,
  and the keepsake reads wrong if the goodbye is folded into the step
- exchanges: [{ q, a, disclosure_depth, position, question_type, question_level, gate }] - position
  is a card's position, or "opening" (before the deal) or "off_frame" (after the frame is dropped)
  or "afterward" / "afterglow" (after the closing beat).
  question_type: projection | life - from the A/B run: depth is answer-relative-to-question,
  and the judge rubric branches on it (a card-description answer to a projection question is rich;
  the same words answering a life question are a deflection)
  question_level: which scaffolding level the question stood at (see M3.5). A parallel axis to
  question_type, not a finer one - a projection ask can target any level
- flip gate: structured judge() output per turn { disclosure_depth, has_life_content, hedged,
  user_level, stakes, reading_of_them }. hedged is a tentative marker on the answer ("i guess",
  "maybe", a question mark on a statement); it does not lower depth. Hedged answers get a
  same-level softening follow-up, are never built on as settled fact, and do not advance flip
  eligibility - though the hard cap still counts them, so nothing stalls. has_life_content is whether the answer contained anything of their
  life at all; a pure card answer caps at disclosure_depth 2, and the two must agree. Early flips
  need one grounded exchange on the card; the counted flips still fire (never stall a resistant
  user) and record "ungrounded" in the flip reason when they do. No `reply` field: the reader's words come from chat(), streamed;
  judge() returns JSON and nothing else. The two use separately configurable models.
  user_level is the scaffolding level the ANSWER operated at (see M3.5) - a separate axis
  from disclosure_depth: depth is how much they revealed, level is what kind of operation
  they performed. The gate schema is built from pack data, since the level enum is the pack's
- FLIP OWNERSHIP (resolved on m3-fixes): flip_ready was false on every gate row of both
  runs yet all cards flipped - the engine's depth/count rule and the judge's flag
  disagreed on who decides. ONE owner: the engine decides from disclosure_depth +
  exchange count, flip_ready is gone from the gate, and every card records the flip reason
- disclosure_depth is 1-4, rubric in the judge prompt: 1 deflection, 2 general statement,
  3 specific situation, 4 specific event with feeling or stakes - branched by question_type
- safety_state: normal | drop_frame; handback_given so the high-stakes handback fires once
- opening judge() output: { has_topic, topic, stakes } - stakes is classified before the
  first card, so the frame can be dropped without dealing at all

## User memory (tier 3, v1.5)
Three memory tiers: turn state (flip gate, exchanges) -> session state (anchor + ledger) -> user memory (persistent profile across sessions).
- Distill, don't accumulate: one extra LLM call at session end updates a compact structured profile from transcript + existing profile
- Profile schema (sketch):
  - threads: [{ topic, status, last_touched, user_phrases[] }] (ongoing life threads, user's own words)
  - vocabulary: metaphors/terms the user responds to
  - style: { depth_pace, prefers_direct_vs_gentle }
  - cards_history: [{ card_id, what_it_meant_to_them }] (same card drawn again must rhyme with its previous meaning)
  - boundaries: topics user deflected; don't push
- Inject profile into system prompt at session start; open with continuity when a thread is alive
- Caps + decay: hard-cap threads (~5); distillation merges/evicts; stale threads go dormant, not deleted
- Familiarity stages gate continuity boldness (recognize -> understand -> anticipate):
  - early: reader only asks, never assumes
  - established: reader reflects patterns back ("third reading circling your career")
  - mature: reader may gently anticipate, always falsifiably ("am I wrong?")
  - Stage advances with accumulated sessions/threads; this is the mechanism that keeps memory consistent without turning creepy
- Anchor is still built primarily from user projections (user's own vocabulary)
- Informs questions, not conclusions: recall that a thread existed, ask if it's still alive; store observations and user's words, never diagnoses
- User-visible + editable: "what the reader remembers about you" screen, delete-per-item, delete-all
- Export/import:
  - Two export types: profile-only (small, the migration/sync artifact) and full export (profile + session transcripts, the data-ownership artifact; the transcripts are the user's journal)
  - Full export shows a one-line warning at export time (plain-text conversations); optional passphrase encryption (WebCrypto AES-GCM) in v1.5
  - Single versioned JSON file either way ("schema_version": 1), profile and sessions[] as separate top-level keys; import accepts both shapes, file structure tells which
  - Import semantics: profile changes reader behavior; transcripts restore browsable history only
  - "Save as journal entry" (from magicli_tarot): per-session Markdown export - cards, the user's own projections, the closing step; a readable keepsake, separate from the JSON data exports. In narrative-therapy terms this is the therapeutic document of the session (White & Epston) - worth a line in the writeup
- Retention: localStorage quota ~5MB and transcripts are what grows; keep full transcripts for last N sessions, older ones survive only via their distilled contribution to the profile; offer "export full history" before pruning
- Storage: profile is another keyed object beside session in localStorage; design the storage module for it in v1 even though the feature ships v1.5

## Milestones

### M1 - Pack + scaffold (assets already downloaded)
- Card images: DONE - 78 cards + CardBacks.jpg in data/Cards-jpg/ (300x527 JPEG, ~52KB each, 3.4MB total). Keep JPEGs; skip the webp pipeline.
- OPEN (owner: me, not the agent): record where the images came from -> LICENSE-ART.md with provenance links
- Treat data/ as the self-contained smith-waite-1909 pack root; images stay in data/Cards-jpg/
- Grab ekelen card_data.json; script to distill Waite descriptions into per-card imagery fallback lines + per-position meaning stubs -> data/deck.json
- Pack schema has since grown to v4, all of it data rather than code:
  - per card: card_id, name, image, imagery_line, details[], meanings { situation, obstacle, advice, general }
  - details[] is what is visibly in the picture, authored by looking at all 78 images. Reader-only,
    for recognising what the user points at - never narrated back at them
  - top level: persona (persona.md), few_shots (few-shots.json), card_back
  - positions[] carry moves[], the question-policy weighting for that arc position
- Repo scaffold: frontend (plain HTML/CSS/JS, subpath-safe asset paths) + Python relay skeleton + /worker skeleton with wrangler.toml + RELAY.md contract stub; remove the .claude ignore line from .gitignore so the plan is versioned
- Done when: deck.json validates (78 cards, all fields), backend serves the debug page showing one card image from the pack

### M2 - Engine core (2-3 days)
- State schema as JSDoc-typed plain JS objects: session { anchor { theme, user_phrases[], resolution_beat }, cards[], exchanges[], safety_state }, storage module (localStorage, prefixed keys, versioned)
- llmClient interface: chat() / judge() calling the Python relay (direct mode as config option); provider + model config (chat model / judge model, single-model toggle)
- Draw logic with seed support (seeded RNG, seed logged per session for reproducible playtests)
- Flip gate: judge() call returning { disclosure_depth, flip_ready, stakes }; wire depth-gated flip with 2-QA default rhythm
- Anchor commit after card 1 (judge() builds narrative plan from user's projection); ledger appends per card
- Done when: a scripted session runs end-to-end in a bare debug UI with seeded cards. Note: the full slice DoD (projection-first exchanges + closing reflection) additionally needs a stub reader prompt - that stub is M2's, the real reader is M3's.

### M3 - Reader quality (the make-or-break week)
STATUS after the 2026-08-25 A/B checkpoint (seed moon-4f2a91, flash vs pro chat, flash judge):
the voice/consistency bar is substantially met on seeded fixtures. Evidence: externalization
landed verbatim in both arms ("you handed it to the woman in the picture rather than to
yourself" -> produced the depth-4 disclosure both times), turn shape held on every turn,
and the flash arm closed with a genuine mirror-synthesis of the user's own phrases plus a
concrete step tied to what they value. MODEL DECISION: deepseek-v4-flash stays the default
chat model - pro wrote marginally subtler questions but violated projection-first at the
advice card and its session never closed; flash held protocol and finished. Two-model split
stays config-only.

Fix queue from the checkpoint (do these before playtests):
1. Unconditional closing (see Core mechanics) - a session must never hang unclosed
2. Projection-first compliance check in the scanner: the turn that deals a card must ask a
   card-read question; flag deal-turns that ask life questions
3. Flip ownership reconciliation (see State schema) - one owner, log the flip reason
4. question_type (projection | life) on exchanges + branched depth rubric - cross-arm depth
   traces are NOT comparable once conversations diverge; stop treating them as an invariant
5. Scanner whitelist: the designed forced-choice fallback is a permitted "stacked or" on
   low-depth fallback turns (both runs flagged a correct fallback as a violation)
6. scripts/judge_replay.mjs - NEW: replay the judge N times on frozen identical transcript
   inputs and diff, to separate true judge nondeterminism from context divergence (the A/B
   summary's "judge moved" conclusion conflated the two; turn 7's 4-vs-1 was the judge being
   right about two different questions)
7. A/B harness: scripted user answers break when arms diverge (B's hang was this). Replace
   with an LLM-simulated user persona (consistent character, answers generated live per arm),
   or restrict cross-arm comparison to protocol-compliance and voice metrics
### M3.5 - Scaffolded question targeting
Michael White's scaffolding map (via Vygotsky's ZPD) as the axis the question policy runs on.
Internal machinery: the levels are never named to the user.
- Five ordered levels, low to high: name (what it is) - consequences (what happened, what
  happens next) - evaluate (what it is like for them) - intentions (why it matters to them) -
  plans (what they will do)
- This UNIFIES three mechanisms rather than adding a fourth: action-landscape questions are
  levels 1-2, identity-landscape questions are 3-4, the closing actionable step is 5. The
  persona's old `explore` move was that ladder discovered by hand with two of its five rungs;
  it is gone as a move
- target_level = min(user_level + 1, position ceiling). One rung above is answerable; two is a
  question they must invent an answer to. Written into the recap block every turn
- A CEILING ON DISTANCE, NOT A QUOTA: people jump levels unprompted, and when they do the
  reader meets them there. Follow them up, never march them up
- DWELL AS A HORIZONTAL MOVE: arrival on the life rail is followed by at least one same-level
  (or one-step) life-rail move before any flip. On the map, a flip line cutting through the same
  column as a first life arrival is the violation shape
- RAIL-CROSSING RULE (from c145c7): the staircase has two rails, the card medium and the life
  medium. A question that switches rails targets the user's CURRENT level, not +1 - crossing is
  itself the step, and climbing while crossing is two. The engine cannot know which rail the next
  question will run on, so the recap names both targets and the reader chooses. Scanner flags a
  crossing question that also climbed
- RAIL SWITCHES LAUNCH FROM ESTABLISHED POSITIONS (from lantern-be7743): height is not the only
  thing a crossing can get wrong. A switch to the life rail needs a launch point - two same-rail
  exchanges on this card, or one self-referent answer - and before that there is nothing under
  the question but one sentence about a picture. Symmetric with the level rule above and
  independent of it: lantern's turn 2 crossed at the same height and still had nothing to ride
  on. Scanner code rail_switch_unsettled, and it can fire alongside rail_switch_climb because
  premature and too-high are different repairs
- Step-down rule: a deflection drops user_level and the next question does not climb - it asks
  at the same height, more concretely. At the bottom rung that is the existing forced-choice
  fallback, wired as the step-down rather than duplicated
- Position ceilings in pack data (positions[].ceiling): situation caps at evaluate, obstacle at
  intentions, advice opens plans. The staircase and the setup -> tension -> resolution arc are
  the same shape, and the validator enforces that ceilings never descend across the spread
- All new knowledge is pack data: levels[] with what each asks, a gloss, and 2-3 question
  exemplars per level. The engine knows the ordering rule and the +1 arithmetic, nothing else
- A card just dealt has no answers, so the target falls to the bottom rung by construction:
  projection-first and the ladder agree without either knowing about the other
- The closing step is the one question exempt from the ceiling, and is sized to the highest
  level reached: something to do if they reached intentions, something to notice if they never
  got past consequences. Closing stays unconditional and is never skipped
- Scanner: level_jump (a question more than one rung above their last level) and level_flat (a
  reading whose questions never left one rung). The level trace becomes a primary A/B metric,
  since depth traces are not comparable across arms
- Regression fixtures: a clean climb, a mid-session deflection stepping down, and a
  low-altitude reading that still closes on a small noticing
- FIRST MEASUREMENT (2026-08-25 transcripts): neither arm ever asked above consequences. Both
  oscillated name -> consequences -> name; B jumped name -> plans in one step on the advice
  card. evaluate and intentions were never touched by either model

- Reader persona system prompt: co-interpretation flow (AI speaks second), position-aware bending, fallbacks (imagery pointing, forced choice), stake-scaled agency handback, drop-frame state, closing actionable step
- Persona additions (from Semetsky 2006 / Clinton 2024 / White & Epston):
  - Correction wins (see Safety) - never treat disagreement as confirmation
  - Observe before interpreting: interpretation boldness gated by depth, same logic as the
    familiarity stages ("the psyche naked may need to be only observed at first, never
    interpreted irrevocably")
  - The card stays the third object in the room even at high depth: route through the layout
    rather than drifting into plain Q&A once disclosure flows (mediated communication is what
    reduces resistance)
  - At high depth the observation half of the turn is a mirror: assemble the user's own stored
    phrases into one narrative sentence rather than adding a new interpretation (the flash
    arm's closing demonstrates the form)
  - Externalizing language template (canonical example, use as a pattern): ask "how does this
    problem affect X" - never "you're not X"
- 3-9 few-shots in the pack (poor man's distillation); iterate against seeded sessions
- Recap block: every chat() turn carries a session record assembled from state - anchor with the
  user's phrases verbatim, each card with a one-line record, arc position, depth, safety_state.
  Declared to outrank the conversation history, which is suggestion where this is constraint
- Fixed turn shape: one observation then one question, 1-2 sentences each. Three exceptions - the
  turn that deals a card names it in a clause, the closing turn ends on a step, and the farewell
  ends on nothing. A fourth relaxation is a permission rather than a shape: in the afterglow ONLY,
  a turn may be a reflective statement and stop. The scanner's no-question exemption is scoped to
  exactly those - close, farewell, afterglow - and the short tail after the beat is not one of
  them, because a reading that trails off is not a reading that ended
- Question policy in the persona, never named to the user: externalize, name, explore, exception,
  re-author, action. Identity-landscape questions are gated behind disclosure depth; the per-position
  weighting lives in pack data. A menu, not a protocol - running the moves on a schedule is the
  clinical cadence this reader does not have
- Judge determinism: labelled depth rubric with worked examples, and temperature 0 where the provider
  still accepts sampling params (removed on current Anthropic models, which answer 400). The pin is
  load-bearing and now measured: with thinking off and the contract-only schema it holds the same
  verdict across five frozen replays; without it the verdict moves between runs
- No-topic playbook: when topic is null, card 1's job is to find the ground - projection gives
  the menu, the ownership move makes the offer, and a hand-back to the picture is an answer
  rather than a cue to ask harder. Situation does not end (within pacing bounds) until a life
  referent lands or the attempts run out; then grounded:false is carried forward and card 2 tries
  a different bridge. Never pretend an ungrounded session has a theme
- scripts/seeded_session.mjs is the canonical fixture: same seed, scripted model, diffable pacing
- tests/fixtures/*.json are redacted derivatives of real sessions (see Architecture); the
  originals live in checkpoint/ and are not committed
- tests/fixtures/thread-c145c7.json is a named failing fixture beside it: a no-topic session
  where the reader answered card lore with card lore for five turns and never met the person.
  It is frozen, and tests assert what the scanner says about it
- tests/fixtures/river-89c1fb.json is the other one, and the inverse failure: the ownership move
  worked, a real life referent came back, and the card flipped on that same turn because grounding
  had just unlocked the early flip. The fixture for the dwell rule, the hedge flag and
  territory-phrased beats
- tests/fixtures/harbor-4c81de.json is the fourth, and the only one nobody said: how a session
  used to fail to end. A fourth card earned AFTER a closing beat, so the reading closes twice on
  the same formula, and then a tail that drifts into the nouns of a side project while a
  stakes:high disclosure goes unmentioned. Written from scratch with fictional content because the
  session behind it (tower-6e335b, local, uncommitted) could not be substituted safely. The
  fixture for double_close, off_territory and heavy_material_dropped; tests/engine/ending.test.mjs
  replays the same answers through the fixed engine. Two simulated personas sit beside it: a
  reading nothing landed on, where the fourth card stays face down and the beat says so as an
  invitation, and someone who took the door back into the afterglow
- tests/fixtures/lantern-be7743.json is the third: the c145c7 fix overcorrecting. The ownership
  bridge fired on the very first sentence about the card, read as agenda, and got "couldnt think
  of any". The fixture for the settle rule, the elaborate move and rail_switch_unsettled. It is
  RECONSTRUCTED from the markdown export rather than redacted from a session JSON, which was
  never saved - the only fixture not produced by redact_session.mjs, and its README entry says so
- Few-shots 3-9. A shot is normally one exchange; a shot may carry a run of turns (turns[], plus
  an optional setup line) for the things that only exist across turns - a bridge that misses, the
  step back with the permission said out loud, and the crossing that lands two turns later
- Simulated user personas in scripts/personas/, for --user= runs of the A/B harness: bracer (has a
  topic, responsive to question quality), browser (no topic, would rather describe pictures),
  eager (discloses early and hedges it - what happens next is the whole test), regretful
  (discloses once by accident then closes, and stays closed however good the next question is)
- scripts/model_checkpoint.mjs runs one seeded session twice varying only the chat model
- Playtest with 3-5 real tarot-curious non-dev people; log transcripts (with consent), fix the tells: over-explaining symbolism, clinical questions, hedging, assistant cadence
- Done when: fix queue items 1-5 land and hold on seeded fixtures, then at least half of playtesters say something true about themselves unprompted by card 2, and no one calls it "a chatbot doing tarot"

### M4 - UI + polish (2-3 days)
- Card table UI: draw-in, flip (CSS rotateY + backface-visibility), spread layout, mobile-first; plain CSS/JS, no animation libs unless clearly needed
- The face-down deal is already on the debug page and is the table's real shape: all four dealt
  at the start with their position labels showing, the fourth subtly marked rather than named,
  flipping in place. M4 is the treatment, not the topology
- Two pages, decided before the branch: index.html is the styled UI for real users; the current
  debug page moves to debug.html functionally unchanged, its right-hand panel collapsible and
  collapsed by default. The gate / anchor / staircase / prompt-dump panels stay there and never
  reach the styled UI
- Styled layout: settings collapsed across the top; the spread always visible on the left; the
  chat beside it scrolling internally, so the table never scrolls away - the bounded-container
  thesis below made literal
- On phones the spread becomes a compact card strip pinned at the top with the chat scrolling
  under it. Cards stay always-visible on every viewport, which is what "always on the table"
  means on a screen that cannot hold two columns
- ended: true disables the input and offers "new reading" / "stay a while". An unearned fourth
  card stays face down through the farewell and is never flipped for display
- The table reads as a bounded, stable container the conversation keeps returning to - the chat
  serves the table, not the reverse (Semetsky: the layout's boundedness is itself grounding;
  the material is visibly "out of the head and on the table")
- Scaffolding map panel on the debug page: plain SVG, x = exchange, y = the five levels, one
  trace for what was asked and one for where the answer landed, rail encoded by mark, flips as
  dashed rules carrying flip_reason, ZPD violations ringed. Dev tooling - it stays on the debug
  page and never reaches the styled UI. The ASCII form of the same thing goes in scanner and A/B
  output
- Key management: paste key, localStorage vs session-only toggle, provider/model settings
- Session journal export (Markdown) and per-session JSON: DONE early in M3, because playtesting
  without transcripts loses the sessions worth reading. Every turn is saved to a capped history in
  localStorage, unfinished readings included. Still M4: the profile/full export with warning line
- User-provided cards mode
- Done when: a stranger can complete a session on a phone without instructions

### M5 - Ship
- Pages deploy live (Actions workflow); Worker relay deployed via Cloudflare Git integration (root /worker, build-watch paths); frontend relay URL config points deployed page at the Worker
- Conformance check: Python relay and Worker both pass the same RELAY.md contract tests (including the key-redaction test)
- Self-host release: clean clone -> .env -> run works per README
- README: positioning ("for people who don't believe in tarot but believe in thinking out loud"), BYOK trust story (three modes: local Python relay, hosted Worker relay, direct; key never stored/logged anywhere, both relay sources short enough to read), fork-your-own-deck pack docs, MIT attribution notes, LICENSE-ART.md provenance
- Resume/portfolio writeup; link from personal site
- Done when: repo is public, hosted demo works end-to-end on Pages + Worker, demo also runs from a clean clone, README answers "why should I trust this with my key"

### M6 - Only if M3 validated
- Tier-3 user memory (see section above) with familiarity stages, memory screen, export/import
- PWA install, date-seeded daily card, zh-CN pack variant, additional symbol packs (Marseille as swappability proof)

## Explicitly deferred
- Stateful backend features: hosted tier, cross-device memory, server-side logging, any data at rest. The v1 Python backend stays a stateless relay; adding state reopens the custody question deliberately
- App stores (fortune-telling category risk; web-first avoids gatekeepers)
- Monetization / daily draw limits

## Reusability (personal website later)
The tarot app is one shell around a generic reflection engine. Structure the repo so the engine can be lifted into the personal website chat later:
- Package as a framework-agnostic core (plain JS with JSDoc types, no DOM): engine/ (state machine: anchor, ledger, flip gate, familiarity stages, distillation) + llmClient + storage interfaces; UI imports the core, never the reverse
- Symbol pack loader takes any pack dir: the website version could ship a secular "reflection cards" pack, same engine
- storage interface has a localStorage impl now; website can supply its own impl later without engine changes
- Reader persona prompt is pack data, not code: website persona swaps in cleanly
- Keep UI components (card flip, chat pane) in a separate ui/ dir so the chat pane can be embedded standalone

## Resume framing
"Designed an LLM agent with structured disclosure-gating, projection-first co-interpretation, familiarity-staged user memory (认识->了解->预判), and narrative-coherence state (anchor/ledger with real-time narrative steering), shipped as a BYOK web app with a stateless Python relay (no data at rest) on a reusable reflection engine."
Keyword alignment for Game x AI Native tracks (e.g. miHoYo): agent framework, 记忆系统 / staged cognition accumulation, 叙事调控, roleplay persona design, knowledge-as-data iteration (packs updated without touching the engine), scaffolded question targeting with a ZPD movement rule (White/Vygotsky) - it speaks the 分级能力框架 dialect.
Writeup notes: journal export framed as the session's therapeutic document (White & Epston tradition); question policy "informed by narrative therapy techniques (externalization, landscape questions, unique outcomes)" - inspiration for a reflection tool, never a therapeutic claim, and never named in-product.

## References (borrow candidates - prompts, meanings, assets)
Design validation + prompt language:
- Clinton, E. (2024). "Divining the self: Applying tarot as a projective technique in counseling" (JMU, open access: commons.lib.jmu.edu/edspec202029/97) - academic version of this exact concept: secular projective use, client's interpretation over card tradition, no tarot expertise required, narrative-therapy connection. Borrow: its manual's projection prompts ("what do you think is happening here / what are they feeling / when have you felt this way") for few-shots and fallbacks; its introduction-script framing for onboarding copy; one post-session debrief question before the closing action step; the four-card temporal spread (past/present/future/lesson - lesson = our earned epilogue card) as a second spread in the pack. Citation chain for the writeup: Clark 1995, Pepinsky 1947, Wood & Pignatelli 2019, Semetsky 2005 (13/15 found single-session projective readings meaningful).
- Semetsky, I. (2006). "Tarot as a projective technique" (Spirituality and Health International 7) - cited for technique, not metaphysics: the spread as bounded container (M4 UI thesis), mediated communication via the layout as resistance reduction (keep the card the third object), story weaving corrected (the client weaves; the reader communicates the client's not-yet-verbal story back - the mirror observation). ALSO the source of the correction-wins anti-pattern: her own case study treats client disagreement as confirmation; our Safety rule exists to prevent exactly that. Her Figure 2 needed US Games' permission for the 1971 deck - reinforces our 1909 PD scans decision.
- White, M. (2007). "Maps of Narrative Practice" (Norton) - the scaffolding conversations map, which
  is the source of M3.5's five distancing levels and the one-step movement rule. Borrowed: the level
  ordering, the phrasings the pack's exemplars adapt ("what happened after this...", "what's it like
  for you to see this...", "do you know why this makes you feel..."), and the principle that a
  question two steps out is one the person must invent an answer to.
- Ramey, H. L., Young, K., & Tarulli, D. (2010). "Scaffolding and concept formation in narrative
  therapy" (Journal of Marital and Family Therapy) - Vygotsky's ZPD as the mechanism under White's
  map; the empirical account of how the distancing levels move in real sessions. Cited for the
  claim that the levels are ordered and that movement, not altitude, is what does the work.
- Narrative therapy primer (EBSCO Research Starters; White & Epston, Norton 1990/2007) - externalizing conversations with the canonical language template ("how does this problem affect your motivation?" vs "you're not motivated"); therapist "decentered, yet significant" as the reader's posture; therapeutic documents as the frame for the journal export.
Repos studied; may borrow prompt language and card-meaning text (keep MIT attribution if lifting text):
- https://github.com/benbenzhangai/claude-tarot-skill - MIT. Reflective philosophy overlaps ours; borrowed: position-aware interpretation, stake-scaled guardrails, closing actionable steps, user-provided cards mode. Its SKILL.md + references/card_meanings.md are prompt-borrowing candidates.
- https://github.com/venom0666/magicli_tarot - CLI one-shot reader (Gemini); borrowed: seeded draws, reading export, multilingual output as pack variants.
Card assets and meanings data (all PD 1909 RWS unless noted):
- https://github.com/mixvlad/TarotCards - multiple PD decks (RWS, Marseille, Sola Busca) with metadata.json + scripts that download from Wikimedia Commons and verify license per file; best bulk source
- https://github.com/ekelen/tarot-api - static/card_data.json has all 78 cards with Waite's Pictorial Key descriptions (good raw material for imagery fallback lines)
- https://github.com/metabismuth/tarot-json - JSON dataset + 350x600px card images (~7.4MB full deck)
- https://luciellaes.itch.io/rider-waite-smith-tarot-cards-cc0 - CC0 digital restoration of RWS (cleaner look, explicitly CC0 incl. card backs)
- Wikimedia Commons "Rider-Waite tarot deck" categories - canonical 1909 scans (Pam-A, Roses & Lilies, Holly Voley sets)
Naming: use "Smith-Waite (1909)" in-app; US Games holds trademarks around "Rider-Waite" branding. Document art provenance in LICENSE-ART.md.

## Plan changelog
- v1.5 (2026-08-26): M4 layout decided before the branch - two pages (styled index.html for
  real users; the debug page moves to debug.html, its panel collapsible), the spread fixed on
  the left with the chat scrolling internally beside it, and a pinned card strip on phones.
  M3's playtest half moves to after M4: "a stranger on a phone" needs the styled UI to exist
  first, so the milestone gate re-orders rather than blocks.
- v1.5 (2026-08-26): seams round on branch m3-seams - four deepenings, no behaviour change. The
  reader turn gets a plan (turnPlan) with the prose rendering from it and readerCall as the single
  front door; the three judgements get one module each with `kind` on the call; the card face up
  gets cardStanding() instead of seven names; the scanner moves into the engine. Verified by
  diffing the assembled system prompt and message list against 3b3a389 across nine session shapes
  x eleven turn kinds x handback x stage direction - 396 combinations, byte-identical. Retires
  turnKindOf and the constraint it imposed (nothing may be appended after the turn instruction).
  Removes the silent `?? TURN_INSTRUCTIONS.respond` fallback and the fake's schema-sniffing. One
  real bug found on the way: the ladder section is omitted before the deal, but the session record
  quotes the target on every turn including the opening one - collapsing those two into one flag
  dropped a line from the opening prompt.
- v1.5 (2026-08-26): endings round on branch m3-ending, from tower-6e335b - the whole spread dealt
  face down at the start, the fourth card's earn check moved before the closing beat so there is
  exactly one ending, "the deck keeps one" as the return hook when it is not earned, the farewell
  turn with heavy-material right of way, and the open tail replaced by a budgeted afterward plus
  an afterglow with a territory contract. Amends two things the plan said outright: that the
  fourth card is earned after the beat, and that only a person sets session.ended. Scanner gains
  double_close, off_territory and heavy_material_dropped; harbor-4c81de frozen as a fixture,
  invented rather than redacted, and the fixtures policy written down as its own line. Same
  branch: AGENTS.md, and the compatibility paths this round had added removed under it -
  STATE_VERSION to 2, saved readings at an older version dropped rather than upgraded.
- v1.5 (2026-08-25): settle round on branch m3-settle, from the lantern-be7743 session - the
  settle rule and the elaborate move (the tempo trio: settle, bridge, dwell), rail switches
  launching from established positions with rail_switch_unsettled in the scanner, whiff recovery
  in the persona and a multi-turn few-shot, and judge calls running thinking-off at a 4k ceiling.
  lantern-be7743 frozen as a fixture, reconstructed rather than redacted. One consequence the
  brief did not name: the dwell may run one exchange past the cap, or every card that grounds by
  the elaboration path grounds on its last exchange. Judge work continued from a live failure
  mid-round: judge_probe.mjs, the contract-only schema in the prompt, and required-key validation
  on judge replies, after deepseek-v4-flash was found echoing the schema back and being believed.
- v1.5 (2026-08-26): pacing and continuation on the same branch - per-position target/max in pack
  data rising across the arc, the rich-answer exit losing its exemption, the reading staying open
  after its closing beat until the person ends it, and a 10-exchange transcript window. Plus the
  reader no longer emitting its own turn wrapped in quotation marks, which the few-shots taught it.
- v1.5 (2026-08-26): the earned 4th card built rather than deferred, since the conversation
  staying open after the beat is what makes it reachable. Pack data, earned once by a real
  disclosure after the beat, and it closes the reading a second time with the step re-sized.
- v1.5 (2026-08-26): from the first live session on this branch - asked_back and the aside turn,
  the relay surviving a provider that hangs up mid-response, and the card's budget on the debug
  panel now that "3 exchanges on one card" no longer says whether that is nearly done.
- v1.5 (2026-08-25): session transcripts committed as fixtures are redacted derivatives now,
  with the originals in gitignored checkpoint/ and the maps in gitignored redactions/.
- v1.5 (2026-08-25): latency work on the same branch - the anchor revision moved off the
  critical path, the prompt split into a cacheable prefix and a per-turn block, and an
  editing pass moving standing instructions out of the per-turn half (5.5 -> 3.1 KB a turn).
- v1.5 (2026-08-25): tempo round on branch m3-dwell, from the river-89c1fb session - the dwell
  rule (a fresh disclosure blocks the flip that turn), the hedged flag, territory-phrased and
  rolling resolution beats, the persona tempo section, flip_on_disclosure and built_on_hedge in
  the scanner, arrivals and violating flips on both maps, and the eager/regretful personas.
  river-89c1fb frozen as a fixture. Few-shots 3-8 with the dwell demonstrated. Sixteen existing
  pacing fixtures moved by one exchange, which is the tempo change rather than a regression.
- v1.5 (2026-08-25): grounding round on branch m3-grounding, from the c145c7 session -
  point-don't-name with a premise test and a scanner check, reveal-on-request (which removes the
  one-sentence traditional-flavour allowance), the ownership move, the rail-crossing rule,
  has_life_content and depth honesty for card-only answers, anchor phrase tagging with a grounded
  flag, the no-topic playbook, and the scaffolding map in SVG and ASCII. c145c7 frozen as a
  fixture. Few-shots 3-6 -> 3-8; two of the shipped six were teaching the violations.
- v1.5 (2026-08-25): M3.5 scaffolded question targeting on branch m3-scaffolding - level enum,
  target_level rule, ceilings and exemplars in pack data (schema v4 -> v5), step-down rule,
  scanner metric, three regression fixtures. State schema updated for user_level and
  question_level, and the flip-ownership entry marked resolved since the gate shape changed
  with it. References gain White 2007 and Ramey/Young/Tarulli 2010.
- v1.5 (2026-08-25): fix queue 1-5 landed on branch m3-fixes, plus judge_replay.mjs (6)
  and the simulated-user harness (7). Both of those need a live key to say anything;
  the scripted mode stays as the free single-arm regression fixture.
- v1.5 (2026-08-25): few-shots raised from 3-5 to 3-6 so the mirror observation
  has a demonstration of its own; the other five each show a different move.
- v1.5 (2026-08-25): renamed from ai-tarot-v1-plan.md, which is deleted -- exactly one plan
  file lives in .claude/plans/, and any commit touching it updates this section.
- v1.5 (2026-08-25): A/B checkpoint results + fix queue, model decision (flash default), persona additions from Semetsky/Clinton/White-Epston, question_type in schema, unconditional closing, flip-ownership defect logged
- v1: initial plan through the architecture decisions (dual dumb relays, client-side assembly)

## Open items (next working session)
- Build M4 on branch m4-ui: the two-page split, the styled desktop + phone layout, the
  draw-in/flip treatment. The rest of M4 (profile/full export with warning line,
  user-provided cards mode) is later commits on the same branch
- Then: playtests with real tarot-curious non-dev people (the second half of M3's done-when)
