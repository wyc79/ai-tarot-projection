# Session fixtures

Real sessions, kept because they failed in a way worth not repeating. Unlike
`checkpoint/` (gitignored, regenerated on every run) these are frozen: a test
asserts what the scanner says about them, so editing one means the defect it
records has changed.

- `thread-c145c7.json` — 2026-08-25. No topic named, and the reader never found
  one: every user answer is pure card description, and the reader answered card
  lore with more card lore. Four separate defects in five turns, and it closed
  on none of them. It is the fixture for the grounding round: point-don't-name,
  the rail-crossing rule, depth honesty for card-only answers, and anchor
  hygiene each cite one of its turns.

- `river-89c1fb.json` — 2026-08-25. The opposite failure to c145c7's, and caused
  by its fix. The ownership move worked: an offer at the same level got a real
  life referent back on the second exchange ("i used to have a different major
  and now doing something completely different"). Grounding then unlocked the
  early flip, and The Lovers turned over on that very turn. The reward for
  opening up was the subject changing. It is the fixture for the dwell rule,
  the hedge flag ("i guess so?"), and territory-phrased resolution beats.
