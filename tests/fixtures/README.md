# Session fixtures

Sessions kept because they failed in a way worth not repeating. Frozen, unlike
`checkpoint/`: a test asserts what the scanner says about each one, so editing
it means the defect it records has changed.

**These are derivatives, not the originals.** This app is built to get people to
say specific things about their lives, so the transcripts worth freezing are
exactly the ones where that worked -- and this repo is public. The original of
each stays in gitignored `checkpoint/`; what is committed here has been through
`scripts/redact_session.mjs`, which substitutes the person out and leaves every
structural property the checks read: the gate flags, the word overlap between an
answer and the turn after it, the shape of each question. The substitution maps
live in gitignored `redactions/`, since they are the thing that would reverse
this.

Both fixtures produce byte-identical scanner findings before and after, which is
the test that the redaction did not quietly change what they are fixtures for.

- `thread-c145c7.json` — 2026-08-25. Needed no substitutions: there is no life
  content in it at all, which is the defect it exists to document. No topic named, and the reader never found
  one: every user answer is pure card description, and the reader answered card
  lore with more card lore. Four separate defects in five turns, and it closed
  on none of them. It is the fixture for the grounding round: point-don't-name,
  the rail-crossing rule, depth honesty for card-only answers, and anchor
  hygiene each cite one of its turns.

- `river-89c1fb.json` — 2026-08-25. The opposite failure to c145c7's, and caused
  by its fix. The ownership move worked: an offer at the same level got a real
  life referent back on the second exchange ("i used to have a different trade
  and now doing something completely different"). Grounding then unlocked the
  early flip, and The Lovers turned over on that very turn. The reward for
  opening up was the subject changing. It is the fixture for the dwell rule,
  the hedge flag ("i guess so?"), and territory-phrased resolution beats.
