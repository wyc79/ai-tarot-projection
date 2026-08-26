# Working agreements

How code gets written in this repo. These are constraints on the work, not
style preferences, and they outrank habit.

## Build it forward, not sideways

- **Do not preserve backward compatibility.** Remove obsolete paths rather than
  adding compatibility layers, fallbacks, or migrations beside them. If a shape
  changed, the old shape is gone — including the tests and fixtures that pinned
  it.
- **Choose the simplest implementation that fully meets the current
  requirement.** No speculative abstraction, configuration, or indirection for a
  need nobody has yet.
- **Grow the system in layers.** Start from the smallest version that works end
  to end and add each capability on top of something that already works. Never
  trade a working product for unfinished complexity.
- **Make architectural decisions for the long term.** Do not accept a stopgap
  that only works for now and is meant to be replaced later. If the durable
  version is too big for this round, say so and propose the slice — do not
  quietly ship the stopgap.

## Structure

- **Keep components modular and the concerns separated.** The engine does not
  touch the DOM. The UI does not decide pacing. The relays do not know what
  tarot is.
- **Prefer established, well-maintained libraries** where they reduce overall
  complexity or improve reliability. Do not reimplement common functionality
  without a clear reason.
- **Lean on what is already here** before writing your own version or adding a
  package. Do not assume a library lacks a capability without checking its
  documentation and types.

## In this repo specifically

- `.claude/plans/ai-tarot-v1.5-plan.md` is the source of truth. Where anything
  else conflicts with it, follow the plan and flag the conflict rather than
  silently picking one.
- Any commit touching the plan updates its Plan changelog section in the same
  commit.
- Small commits. If a round reveals its own scope was wrong, say so and propose
  a re-slice rather than letting the branch sprawl.
- One branch per milestone; the human merges.

## Key handling (hard requirements)

- The API key comes from the client per request, or from `.env` for self-host.
- It is **never stored server-side** — no session maps, no globals, no files, no
  database — and **never logged**. Auth material is redacted from every logging
  and error path.
- No user data at rest in either relay. Session state lives client-side under
  `tarot:`-prefixed keys.
- The Worker has **no logging code path at all**, not even a disabled one.

## Transcripts

A transcript with real personal content is never committed, redacted or
otherwise. Originals stay in gitignored `checkpoint/`. See
`tests/fixtures/README.md` for what does get committed and how.
