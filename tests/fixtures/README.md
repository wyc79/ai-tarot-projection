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
