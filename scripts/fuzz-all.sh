#!/usr/bin/env bash
#
# fuzz-all.sh — run every fuzz target in the repo, not the one somebody
# remembered to name.
#
# check.sh's closing message used to suggest exactly one command:
#
#   (cd hub && go test -run xxx -fuzz FuzzParseSDP -fuzztime 30s ./internal/devices/camera/)
#
# There are fifteen targets. Someone who ran that line had fuzzed the SDP parser
# and could reasonably believe they had "run the fuzzing", leaving the modbus
# ADU decoder, the mDNS name decoder, the H.264 depacketiser and both grant
# handlers untouched — every one of them a parser fed by bytes from the network.
#
# So this enumerates rather than lists: targets are found by grepping for
# `func Fuzz`, which means a new one is picked up the day it is written and
# cannot be forgotten here.
#
# Usage:
#   scripts/fuzz-all.sh [seconds-per-target]   # default 30
#
# `go test -fuzz` takes ONE target per invocation and its regex is per-package,
# so this loops. Budget accordingly: 15 targets x 30s is about eight minutes plus
# build time.
#
# A crash leaves a reproducer in testdata/fuzz/<Target>/ inside the module —
# that file is the bug, and it is committable as a regression seed.

set -uo pipefail
cd "$(dirname "$0")/.."

SECS="${1:-30}"
failed=0
count=0

for module in hub controller; do
  [ -d "$module" ] || continue
  # `<file>:func FuzzName(` → package dir + target name.
  while IFS= read -r hit; do
    file="${hit%%:*}"
    name="${hit##*func }"
    name="${name%%(*}"
    pkg="./$(dirname "${file#"$module"/}")"
    count=$((count + 1))
    printf '\n=== %s %s (%ss) ===\n' "$module" "$name" "$SECS"
    # </dev/null matters. The loop reads targets from a process substitution,
    # and `go test` inherits that as its stdin and consumes from it — which
    # silently ate loop input and made unrelated targets report failure, a
    # different pair on each run. The tool was wrong, not the parsers.
    if ! (cd "$module" && go test -run xxx -fuzz "^${name}\$" -fuzztime "${SECS}s" "$pkg" </dev/null); then
      failed=$((failed + 1))
      echo "FAILED: $module $name — reproducer in $module/$(dirname "${file#"$module"/}")/testdata/fuzz/$name/"
    fi
  done < <(grep -rn '^func Fuzz' --include='*_test.go' "$module" | sed 's/:[0-9]*:/:/')
done

echo
if [ "$count" -eq 0 ]; then
  echo "no fuzz targets found — the grep has drifted, since there were fifteen"
  exit 1
fi
# A floor rather than a bare count: "0 targets, 0 failures" would otherwise
# print the same reassuring line as a full run.
if [ "$count" -lt 15 ]; then
  echo "only $count fuzz targets ran; fifteen existed when this was written"
  exit 1
fi
if [ "$failed" -gt 0 ]; then
  echo "$failed of $count fuzz targets FAILED"
  exit 1
fi
echo "$count fuzz targets ran ${SECS}s each with no crashes."
echo "Passing means no input FOUND in that budget crashed or broke an invariant."
echo "It is not proof the parsers are correct, and a longer budget is a"
echo "different experiment — these targets keep no corpus in the repo."
