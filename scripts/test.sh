#!/usr/bin/env bash
# Everything that can be checked without a key or a network.
#
#   scripts/test.sh           all four suites
#   scripts/test.sh --fast    skip the relay contract leg, which is the slow one
#
# Runs all of them rather than stopping at the first failure: when a change to
# the pack breaks the engine tests it has usually broken the validator too, and
# seeing both is what tells you which one is the cause.
#
# Not run here, because they need a real key and a running relay:
#   scripts/model_checkpoint.mjs   two arms of a live session, side by side
#   scripts/judge_replay.mjs       judge determinism on frozen inputs
# And not here because it reads real transcripts rather than fixtures:
#   scripts/scan.mjs checkpoint/*.json

set -uo pipefail
cd "$(dirname "$0")/.."

FAST=0
[ "${1:-}" = "--fast" ] && FAST=1

failed=()
skipped=()

run() {  # name, command...
  local name=$1; shift
  local start=$SECONDS out
  printf '== %s\n' "$name"
  if out=$("$@" 2>&1); then
    printf '   ok (%ss)\n\n' "$((SECONDS - start))"
  else
    printf '%s\n' "$out"
    printf '   FAILED (%ss)\n\n' "$((SECONDS - start))"
    failed+=("$name")
  fi
}

run "engine tests" node --test tests/engine/*.test.mjs
run "pack schema" python3 scripts/validate_deck.py

# The fixture prints rather than asserts -- it is there to be read. The one
# thing worth failing on is a session that stops without closing, which is the
# defect it sat on unnoticed for a milestone.
run "seeded fixture closes" bash -c \
  'node scripts/seeded_session.mjs --json | grep -q "\"closed\": true"'

if [ "$FAST" = "1" ]; then
  skipped+=("relay contract (--fast)")
else
  run "relay contract" bash scripts/run_contract_tests.sh
fi

printf -- '----\n'
for s in "${skipped[@]:-}"; do [ -n "$s" ] && printf 'skipped: %s\n' "$s"; done
if [ ${#failed[@]} -eq 0 ]; then
  printf 'PASS\n'
  exit 0
fi
printf 'FAIL: %s\n' "${failed[*]}"
exit 1
