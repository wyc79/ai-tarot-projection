# AI Tarot - v1 Plan

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
- 3-card spread (situation / obstacle / advice), optional 4th "advice earned" card later
- First card flips immediately; each next card flips after ~2 question-answer exchanges
- Depth-gated, not count-gated: rich answer can flip early, thin answer gets a softer follow-up instead of stalling
- Co-interpretation (projection-first reading): card flips, AI speaks second
  1. Flip, show card name + one neutral imagery line
  2. AI asks the user to read it first ("what does this card feel like it's pointing at for you?")
  3. User's projection is the disclosure; AI builds on their words, adds light traditional flavor
  4. Rhythm per card: flip -> user projection -> AI follow-up -> next flip
- Fallbacks: "I don't know tarot" -> point at imagery; one-word answers -> forced choice between two contrasting meanings drawn from the position's meaning space
- Position-aware meanings (from claude-tarot-skill): pack stores per-position meaning hints per card (meanings: { situation, obstacle, advice } + general fallback); same card reads differently by position, and the AI bends the user's projection toward the position's role in the arc
- Closing actionable step: session's last beat converts the resolution into one small concrete real-world reflection or action ("this week, notice when X happens"); makes the session feel complete
- User-provided cards mode: skip the draw, interpret cards the user names (physical-deck users); same engine
- Seeded draws (from magicli_tarot): deterministic card sequence for reproducible playtests and prompt-version comparisons; date-seeded "daily card" is a possible later ritual hook
- Session coherence:
  - Anchor as narrative arc (not a static theme string): 3-card spread maps to setup -> tension -> resolution; anchor stores the theme + where the session should land, follow-up questions steer toward the resolution beat; earned 4th card reads as epilogue
  - Ledger: record of cards drawn + interpretations given; new draws elaborate, never contradict
  - Spam re-draws handled diegetically ("the deck answers the same question the same way")

## Safety
- Reflective framing only, no predictive claims
- Stake-scaled guardrails (from claude-tarot-skill): flip gate classifies stakes (low | high | crisis); high (medical/legal/financial) keeps the tarot frame but explicitly hands agency back ("the cards can help you think, but this needs a professional / real information")
- Explicit "drop the frame" state: if user discloses crisis-level content (grief, self-harm), AI exits tarot voice, responds plainly, points to real resources. Reachable from turn one.

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
- Prompt iteration without redeploy (load-bearing for M3): packs, persona prompt, and few-shots are static data files assembled client-side - editing a prompt is a file save locally, a Pages deploy when hosted; relays are never touched
- Dev-mode logging (Python relay only): since every call passes through the relay with the fully assembled prompt in the body, a DEV_LOG=1 .env flag logs full request/response bodies (auth header redacted) for M3 iteration and consented playtest transcripts. Default off. The Worker has no logging code path at all - hosted users' conversations are unloggable by construction. Frontend debug panel shows the assembled prompt pre-send.
- Open-relay protection on the Worker: origin checks + per-IP rate limits (+ lightweight app token if abused)
- Session state + draw ledger in localStorage: same-device "session 2+" memory for free
- Optional two-model split (BYOK config): cheap/fast model for the reader's conversational turns; stronger model for flip-gate classification and session-end distillation, where judgment quality matters
- Abstractions: one llmClient module (relay mode with configurable base URL / direct mode), one storage module
- Symbol pack = self-contained data dir; data/ is the pack root for smith-waite-1909 (deck.json + Cards-jpg/ images + persona prompt + few-shots). "Fork it, drop in your own deck" = point the loader at another pack dir.
- Card art: existing JPEGs in data/Cards-jpg/ (78 cards + CardBacks.jpg, 300x527, ~52KB each, 3.4MB total) - within budget, keep as-is, no webp pipeline
- GitHub Pages: project site (username.github.io/ai-tarot/), asset paths must be subpath-safe (relative paths, no leading /)

## State schema (sketch)
Per session:
- anchor: { theme, user_phrases[], resolution_beat } (narrative plan, not a static string)
- cards: [{ card_id, position, user_projection, ai_reading, flipped_at }]
- exchanges: [{ q, a, disclosure_depth }]
- flip gate: structured LLM output per turn { reply, disclosure_depth, flip_ready, stakes }
- safety_state: normal | drop_frame

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
  - "Save as journal entry" (from magicli_tarot): per-session Markdown export - cards, the user's own projections, the closing step; a readable keepsake, separate from the JSON data exports
- Retention: localStorage quota ~5MB and transcripts are what grows; keep full transcripts for last N sessions, older ones survive only via their distilled contribution to the profile; offer "export full history" before pruning
- Storage: profile is another keyed object beside session in localStorage; design the storage module for it in v1 even though the feature ships v1.5

## Milestones

### M1 - Pack + scaffold (assets already downloaded)
- Card images: DONE - 78 cards + CardBacks.jpg in data/Cards-jpg/ (300x527 JPEG, ~52KB each, 3.4MB total). Keep JPEGs; skip the webp pipeline.
- OPEN (owner: me, not the agent): record where the images came from -> LICENSE-ART.md with provenance links
- Treat data/ as the self-contained smith-waite-1909 pack root; images stay in data/Cards-jpg/
- Grab ekelen card_data.json; script to distill Waite descriptions into per-card imagery fallback lines + per-position meaning stubs -> data/deck.json (pack schema v1: card_id, name, image, imagery_line, meanings { situation, obstacle, advice, general })
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
- Reader persona system prompt: co-interpretation flow (AI speaks second), position-aware bending, fallbacks (imagery pointing, forced choice), stake-scaled agency handback, drop-frame state, closing actionable step
- 3-5 few-shot exchanges in the pack (poor man's distillation); iterate against seeded sessions
- Playtest with 3-5 real tarot-curious non-dev people; log transcripts (with consent), fix the tells: over-explaining symbolism, clinical questions, hedging, assistant cadence
- Done when: at least half of playtesters say something true about themselves unprompted by card 2, and no one calls it "a chatbot doing tarot"

### M4 - UI + polish (2-3 days)
- Card table UI: draw-in, flip (CSS rotateY + backface-visibility), spread layout, mobile-first; plain CSS/JS, no animation libs unless clearly needed
- Key management: paste key, localStorage vs session-only toggle, provider/model settings
- Session journal export (Markdown), full/profile JSON export with warning line
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
Keyword alignment for Game x AI Native tracks (e.g. miHoYo): agent framework, 记忆系统 / staged cognition accumulation, 叙事调控, roleplay persona design, knowledge-as-data iteration (packs updated without touching the engine).

## References (borrow candidates - prompts, meanings, assets)
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

## Open items (next working session)
- Draft reader persona system prompt (kill the tells: over-explaining symbolism, clinical questions, hedging)
- Finalize state schema + structured output format for the flip gate
- Pick framework + write the llmClient/storage interfaces
