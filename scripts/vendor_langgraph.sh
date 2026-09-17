#!/usr/bin/env bash
# Vendors the two third-party bundles this repo serves from web/vendor/.
#
#   scripts/vendor_langgraph.sh          rebuild web/vendor/ from the lockfile
#   scripts/vendor_langgraph.sh --check  rebuild into a temp dir and cmp; exit 1 on drift
#
# LangGraph is bundled from its web entry: one ES module, minified, no
# platform code. Mermaid is copied as the package ships it. Both are pinned
# exact in package.json, so a rebuild from the lockfile is byte-identical and
# --check is the audit path for a file nobody reads.
#
# Needs Node and the network (npm ci). Nothing that runs the app does.
set -euo pipefail
cd "$(dirname "$0")/.."

CHECK=0
[ "${1:-}" = "--check" ] && CHECK=1

npm ci --no-audit --no-fund --silent

LG=$(node -p "require('./node_modules/@langchain/langgraph/package.json').version")
MM=$(node -p "require('./node_modules/mermaid/package.json').version")

out=web/vendor
if [ "$CHECK" = "1" ]; then
  out=$(mktemp -d)
  trap 'rm -rf "$out"' EXIT
fi
mkdir -p "$out"

npx esbuild scripts/langgraph_entry.js \
  --bundle --format=esm --platform=browser --minify \
  --banner:js="/* @langchain/langgraph@${LG}, web entry, bundled by scripts/vendor_langgraph.sh. Generated: rebuild, do not edit. */" \
  --outfile="$out/langgraph.js" --log-level=warning

{
  printf '/* mermaid@%s, dist/mermaid.min.js as published, copied by scripts/vendor_langgraph.sh. Generated: rebuild, do not edit. */\n' "$MM"
  cat node_modules/mermaid/dist/mermaid.min.js
} > "$out/mermaid.min.js"

if [ "$CHECK" = "1" ]; then
  for f in langgraph.js mermaid.min.js; do
    if ! cmp -s "$out/$f" "web/vendor/$f"; then
      echo "web/vendor/$f differs from a rebuild of the lockfile" >&2
      exit 1
    fi
  done
  echo "web/vendor/ matches the lockfile"
else
  ls -la "$out"
fi
