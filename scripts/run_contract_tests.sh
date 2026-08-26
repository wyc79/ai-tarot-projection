#!/usr/bin/env bash
# Run the RELAY.md contract suite against both relays.
#
#   scripts/run_contract_tests.sh
#
# Starts a mock provider, then each relay in turn, and points the same suite at
# both. The Worker leg uses wrangler (from PATH, else npx); without either it
# skips loudly rather than passing one relay and calling it two.

set -uo pipefail
cd "$(dirname "$0")/.."

MOCK_PORT=8899
PY_PORT=8788
WORKER_PORT=8789
ORIGIN="http://localhost:1234"
LOGDIR="$(mktemp -d)"

PROVIDERS='{"test":{"url":"http://127.0.0.1:'"$MOCK_PORT"'/echo","auth":"x-api-key","headers":{"x-contract-test":"yes"}},"test-bearer":{"url":"http://127.0.0.1:'"$MOCK_PORT"'/echo","auth":"bearer"},"test-stream":{"url":"http://127.0.0.1:'"$MOCK_PORT"'/stream","auth":"x-api-key"},"test-error":{"url":"http://127.0.0.1:'"$MOCK_PORT"'/boom","auth":"x-api-key"},"test-dead":{"url":"http://127.0.0.1:1/nope","auth":"x-api-key"},"test-hangup":{"url":"http://127.0.0.1:'"$MOCK_PORT"'/hangup","auth":"x-api-key"}}'

pids=()
cleanup() { for p in "${pids[@]:-}"; do kill "$p" 2>/dev/null; done; }
trap cleanup EXIT

wait_for() {  # url, tries
  for _ in $(seq 1 "${2:-40}"); do
    curl -sf "$1" >/dev/null 2>&1 && return 0
    sleep 0.25
  done
  return 1
}

run_suite() {  # base, logfile, extra env assignments...
  local base=$1 log=$2; shift 2
  env RELAY_BASE="$base" RELAY_LOG="$log" RELAY_ORIGIN="$ORIGIN" "$@" \
    python3 -m unittest discover -s tests/contract -t . -v
}

echo "== mock provider on :$MOCK_PORT"
python3 tests/contract/mock_upstream.py "$MOCK_PORT" & pids+=($!)
sleep 0.5

overall=0

echo
echo "== python relay on :$PY_PORT (DEV_LOG=1)"
PROVIDERS="$PROVIDERS" ALLOWED_ORIGINS="$ORIGIN" DEV_LOG=1 PORT="$PY_PORT" \
  python3 server/relay.py > "$LOGDIR/python.log" 2>&1 & py_pid=$!; pids+=($py_pid)
if wait_for "http://127.0.0.1:$PY_PORT/v1/health"; then
  run_suite "http://127.0.0.1:$PY_PORT" "$LOGDIR/python.log" RELAY_DEV_LOG=1 || overall=1
else
  echo "FAIL: python relay never came up; see $LOGDIR/python.log"; overall=1
fi
kill "$py_pid" 2>/dev/null

WRANGLER=""
if command -v wrangler >/dev/null 2>&1; then
  WRANGLER="wrangler"
elif command -v npx >/dev/null 2>&1 && npx --yes wrangler --version >/dev/null 2>&1; then
  WRANGLER="npx --yes wrangler"
fi

echo
if [ -n "$WRANGLER" ]; then
  echo "== worker on :$WORKER_PORT ($WRANGLER dev)"
  ( cd worker && WRANGLER_SEND_METRICS=false CI=1 $WRANGLER dev \
      --port "$WORKER_PORT" --ip 127.0.0.1 \
      --var "PROVIDERS:$PROVIDERS" --var "ALLOWED_ORIGINS:$ORIGIN" --var "RATE_LIMIT:30" \
  ) > "$LOGDIR/worker.log" 2>&1 & wk_pid=$!; pids+=($wk_pid)
  if wait_for "http://127.0.0.1:$WORKER_PORT/v1/health" 160; then
    run_suite "http://127.0.0.1:$WORKER_PORT" "$LOGDIR/worker.log" RELAY_RATE_LIMIT=1 || overall=1
  else
    echo "FAIL: worker never came up; see $LOGDIR/worker.log"; overall=1
  fi
  kill "$wk_pid" 2>/dev/null
else
  echo "== worker leg SKIPPED: no wrangler and no npx"
  echo "   Only one of the two relays was verified."
  overall=$(( overall == 0 ? 2 : overall ))
fi

echo
case $overall in
  0) echo "PASS: both relays conform to RELAY.md" ;;
  2) echo "PARTIAL: python relay conforms; worker unverified" ;;
  *) echo "FAIL: see output above" ;;
esac
echo "logs: $LOGDIR"
exit $(( overall == 2 ? 0 : overall ))
