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
    out=$(cd "$module" && go test -run xxx -fuzz "^${name}\$" -fuzztime "${SECS}s" "$pkg" </dev/null 2>&1)
    rc=$?
    printf '%s\n' "$out"
    if [ "$rc" -ne 0 ]; then
      failed=$((failed + 1))
      # A crash writes a reproducer. Anything else — the fuzzing engine dying
      # under load, a worker terminating, a budget too short to finish baseline
      # coverage — leaves no file, and reporting it as a crash sends someone
      # hunting a parser bug that is not there.
      #
      # This printed an assumed path either way, and twice in one session that
      # message was mistaken for evidence of a real defect. Different targets
      # failed on each sweep with no reproducer anywhere, which is the tell:
      # a genuine crash is reproducible and this was not.
      # Classify on the OUTPUT, not on whether a reproducer file appeared.
      #
      # The first version of this checked for testdata/fuzz/<Target>/ and got it
      # backwards: a panic on a SEED input writes no new crasher, because the
      # input is already in the corpus. A planted panic in the modbus decoder
      # was reported as "NO REPRODUCER", which would send someone away from a
      # real crash — the exact opposite of the mistake this classification was
      # added to prevent.
      dir="$module/$(dirname "${file#"$module"/}")/testdata/fuzz/$name"
      # `--- FAIL` alone is not a crash signature. Running fifteen targets back
      # to back, each with eight workers, the engine intermittently exits with
      # "context deadline exceeded" — its own timeout under load — and prints a
      # FAIL line while no parser did anything wrong. Classifying on FAIL alone
      # reported that as a crash on a clean tree, which is how this classifier
      # got its third rewrite.
      if printf '%s' "$out" | grep -q 'context deadline exceeded'; then
        crash=0
      elif printf '%s' "$out" | grep -qE 'panic:|--- FAIL|failure while testing seed corpus'; then
        crash=1
      else
        crash=0
      fi
      if [ "$crash" = 1 ]; then
        if [ -d "$dir" ]; then
          echo "FAILED (CRASH): $module $name — reproducer in $dir/"
        else
          echo "FAILED (CRASH ON A SEED): $module $name — no new crasher file, because"
          echo "  the failing input is already in the seed corpus. Reproduce with:"
          echo "    (cd $module && go test -run $name $pkg)"
        fi
      else
        echo "FAILED (NO CRASH SIGNATURE): $module $name — the engine exited non-zero"
        echo "  without a panic or a FAIL line. Re-run this target alone before"
        echo "  believing it; sweeps have produced this transiently under load and a"
        echo "  different target each time, which is the tell that it is the runner"
        echo "  and not the parser:"
        echo "    (cd $module && go test -run xxx -fuzz '^${name}\$' -fuzztime 30s $pkg)"
      fi
      echo "  --- last lines of that run ---"
      printf '%s\n' "$out" | tail -6 | sed 's/^/  /' 
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
