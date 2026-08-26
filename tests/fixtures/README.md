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

Each fixture produces byte-identical scanner findings before and after, which is
the test that the redaction did not quietly change what it is a fixture for.

`lantern-be7743.json` and `harbor-4c81de.json` are the exceptions to that
pipeline, and each says so in its own entry below. The rule they follow instead
is the stronger one: **a transcript with real personal content in it is not
committed at all**, redacted or otherwise. Where the session that taught us
something cannot be substituted safely, the fixture is written from scratch with
invented content in the same structural shape.

Commits predating this policy still carry the earlier wording in files that
quoted it -- the pack's few-shots, the judge rubric, a couple of tests. Left
alone deliberately. The rule applies from here; it is not a claim about the
whole history.

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

- `lantern-be7743.json` — 2026-08-25. The overcorrection landing: the ownership
  bridge fired on the very first sentence the person said about the card, which
  reads as an agenda rather than an offer, and got "couldnt think of any" back.
  Structurally the same turn as river's, one card earlier in the person's
  willingness. It is the fixture for the settle rule, the elaborate move, and
  the scanner's `rail_switch_unsettled`.

  **Reconstructed, not exported.** The session JSON was never saved — what
  survives is the markdown transcript in `checkpoint/`, taken mid-session — so
  this file was rebuilt from it rather than run through `redact_session.mjs`.
  The questions, the answers and the card are verbatim from that transcript;
  `question_type` and `question_level` are computed by the shipped classifiers
  rather than written by hand, and the gate objects are reconstructed, since the
  judge's verdicts were not in the export. Nothing in it needed substituting:
  every answer is about the picture, which is the point.

  The transcript also stops one turn early, at the whiff. What the session did
  next — the permission step back, the elaboration, and the answer that was the
  richest of the session — is in `data/few-shots.json` instead, written from the
  account of it rather than from a record, and marked as such there.

- `harbor-4c81de.json` — 2026-08-26. How a session ends, and how it used to
  fail to. Four cards including a fourth earned *after* a closing beat, so the
  reading closes twice and both endings open on the same "across these N cards,
  in your own words" formula. Then the open tail: five exchanges asking after
  the nouns in a side project, at name level, while the heaviest thing said all
  session — a lease running out — is never mentioned again. It is the fixture
  for `double_close`, `off_territory` and `heavy_material_dropped`, and those
  three are the only codes it produces.

  **Invented, not redacted.** The session behind it is local to one machine and
  is not in this repo in any form, because it contains real personal
  disclosures and no substitution map makes that safe to publish. What is here
  is the same structural shape — the same turn counts, the same double close,
  high stakes in the same position, drift in the same place — written with
  fictional content: a lease coming up and a flatmate, and a scheduling script.
  Nobody said any of it. `question_type` and `question_level` are computed by
  the shipped classifiers rather than written by hand, as lantern's are.

  It is frozen at the old sequencing on purpose. `tests/engine/ending.test.mjs`
  runs the same answers through the engine as it is now, where the fourth card
  turns before the beat, the reading closes once, the farewell acknowledges the
  lease, and the session ends.
