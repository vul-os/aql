#!/usr/bin/env bash
#
# tamper.sh — break something on purpose and find out whether a test notices.
#
# A test that has never failed is a claim, not evidence. The way to turn it into
# evidence is to break the thing it guards and watch it go red. That is easy to
# do badly, and this session's log is the argument for a script:
#
#   - a substring that no longer matches (gofmt had realigned a map literal)
#   - an edit that does not compile (`declared and not used`)
#   - a detector grepping "^--- FAIL" while the failure was a BUILD failure
#   - a replacement that changed nothing (assigning a value then discarding it)
#
# All four reported the same thing a working guard reports: nothing happened. A
# tamper that never applied and a guard that is blind are indistinguishable from
# a filtered log, and the difference is the whole point of the exercise.
#
# So this refuses to give a verdict it has not earned. It reports one of:
#
#   CAUGHT      — the tamper applied, compiled, and the tests went red. Evidence.
#   NOT CAUGHT  — the tamper applied, compiled, and the tests stayed green.
#                 The guard is blind to this change.
#   INVALID     — the tamper did not apply, did not change the file, or did not
#                 build. Proves NOTHING; fix the tamper and run it again.
#
# Usage:
#   scripts/tamper.sh FILE OLD NEW -- CMD...
#   EXPECT="assertion text" scripts/tamper.sh FILE OLD NEW -- CMD...
#
# EXPECT is how a verdict earns the word CAUGHT. Without it, any non-zero exit
# from CMD reads as caught, including one from a test you were not testing.
#
# Example:
#   scripts/tamper.sh hub/internal/keys/keys.go \
#     'return nil, ErrSealedNoKey' 'return raw, nil' \
#     -- go test -count=1 ./internal/keys/
#
# Non-Go files work too, and are the reason this exists as a tool rather than a
# habit — a doc claim, a manifest entry, a TypeScript guard:
#
#   scripts/tamper.sh ARCHITECTURE.md 'Status: built end to end' 'Status: unbuilt' \
#     -- npm run check:claims
#
# CMD runs from the FILE's module root when there is one, else from the
# repository root, so `npm run` and `npx vitest` work the way they do by hand.
#
# ON A CROSS-MODULE PROPERTY: CMD's default scope is one module, and `go test
# ./...` from controller/ does not run e2e/. Making Agent.OnDenied actuate the
# relay — a denied emergency grant opening the gate — reads NOT CAUGHT that way,
# and is caught immediately by e2e (TestOfflineGrant_Rejects,
# TestRevoke_StopsAGrantOpeningARealController), which drives the real binaries.
# A false NOT CAUGHT costs less than a false CAUGHT, but it still sends you
# building a guard that already exists. For anything the other side of a seam
# observes, pass the wider command: `-- bash -c 'cd .. && ./scripts/check.sh'`.
#
# ON A FLOOR: to test a coverage floor, RAISE it above real coverage. Lowering
# one changes nothing while the corpus is larger than either number, so it reads
# NOT CAUGHT against a guard that is fine.
#
# ON AN EXEMPTION LIST: allowlists are where guards go quiet, and every one in
# this repository has now been tampered. The rule that came out of it — six
# lists, three of which were blind — is that a list needs a check from OUTSIDE
# itself. Iterating the list to validate the list means deleting an entry
# deletes its own check, so `for (const x of ALLOWED) expect(...)` catches
# nothing when someone removes an x. What differs each time is where the
# independent fact lives:
#
#   NOT_IN_TREE (build output only)   → git check-ignore
#   allowedUnreachable (*Store)       → the set of methods production calls
#   COMMENT_EVIDENCE_OK               → the evidence scan, run with the
#                                       exemption bypassed
#
# Finding that fact is the design problem. If there isn't one, the list is a
# wish rather than a rule.
#
# ON A VERDICT OF "NOT CAUGHT": check the tamper APPLIED before believing it.
# This script does that for you — exactly one match, and the file changed — which
# is why it exists. Twice this session a hand-rolled tamper silently did not
# apply and read as a blind guard, which sends you rewriting working code.

set -uo pipefail

if [ "$#" -lt 5 ]; then
  sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
fi

file=$1; old=$2; new=$3; shift 3
[ "${1:-}" = "--" ] || { echo "expected -- before the test command" >&2; exit 2; }
shift

[ -f "$file" ] || { echo "INVALID: $file does not exist" >&2; exit 2; }

# Where CMD runs. For a Go file that is the module root, so `go test ./internal/x/`
# works the way it does by hand.
#
# For anything else it is the repository root, where npm and vitest live. That
# case used to be refused outright — "no go.mod above $file" — which meant every
# tamper against a doc, a manifest or a TypeScript guard had to be hand-rolled
# with cp and python. Two of those silently failed to APPLY and read as
# "NOT CAUGHT", which is the most expensive way to be wrong about a guard: it
# says the guard is blind when nothing was tested. The checks below — exactly
# one match, the file actually changed — are the ones that catch that, and they
# were unavailable precisely where I kept needing them.
# ...but only when the COMMAND is a Go command. A tamper on a Go file checked by
# a TypeScript guard — `scripts/tamper.sh hub/internal/x.go OLD NEW -- npx vitest
# run src/...` — ran vitest from hub/, where that path does not exist. vitest
# exited non-zero for having found nothing, and this script called that CAUGHT.
#
# A false CAUGHT is worse than a false NOT CAUGHT. The second says a guard is
# blind when nothing was tested, and the next thing anyone does is look. The
# first certifies a guard that never ran, and nobody looks again.
case "${1:-}" in
  go|gofmt|golangci-lint) needs_module_root=1 ;;
  *) needs_module_root=0 ;;
esac

root=""
if [ "$needs_module_root" = 1 ]; then
  root=$(cd "$(dirname "$file")" && while [ ! -f go.mod ] && [ "$PWD" != / ]; do cd ..; done; pwd)
fi
[ -n "$root" ] || root=/nonexistent
if [ ! -f "$root/go.mod" ]; then
  root=$(cd "$(dirname "$file")" && while [ ! -d .git ] && [ "$PWD" != / ]; do cd ..; done; pwd)
  [ -d "$root/.git" ] || { echo "INVALID: no go.mod and no repository root above $file" >&2; exit 2; }
fi

backup=$(mktemp)
cp "$file" "$backup"
# Restore on ANY exit, including Ctrl-C. A tamper left applied is worse than a
# tamper that proved nothing: the next run measures the broken tree.
trap 'cp "$backup" "$file"; rm -f "$backup"' EXIT INT TERM

if ! OLD="$old" NEW="$new" python3 - "$file" <<'PY'
import os, sys
path = sys.argv[1]
old, new = os.environ["OLD"], os.environ["NEW"]
src = open(path).read()
n = src.count(old)
if n == 0:
    print("INVALID: the text to replace is not in the file (whitespace? gofmt realigned it?)", file=sys.stderr)
    sys.exit(1)
if n > 1:
    print(f"INVALID: the text appears {n} times — narrow it, or the tamper is ambiguous", file=sys.stderr)
    sys.exit(1)
open(path, "w").write(src.replace(old, new, 1))
PY
then
  echo "INVALID  — nothing was changed, so nothing was tested."
  exit 2
fi

if cmp -s "$file" "$backup"; then
  echo "INVALID  — the replacement produced an identical file."
  exit 2
fi

# Only a Go module can be compiled, and only a compile failure invalidates a Go
# tamper. A doc or a manifest has no build step; its equivalent check is that the
# gate itself still runs, which the CMD below reports.
compiled="compiled, and "
if [ -f "$root/go.mod" ]; then
  if ! (cd "$root" && go build ./... >/dev/null 2>&1); then
    echo "INVALID  — the tampered tree does not compile. A tamper that cannot build proves nothing."
    exit 2
  fi
else
  # No build step to speak of, so the verdict must not claim one.
  compiled=""
fi

out=$(cd "$root" && "$@" 2>&1)
rc=$?

if [ "$rc" -eq 0 ]; then
  echo "NOT CAUGHT  — applied, ${compiled}the tests still pass. The guard is blind to this."
  exit 1
fi

# Red is not the same as caught BY THE GUARD UNDER TEST.
#
# Twice this session a tamper reported CAUGHT while the assertion being tested
# passed: the command was broad enough that something else in it went red. Once
# it was vitest run from the wrong directory finding no files; once it was a
# package's unit tests failing on a mutation that left the e2e assertion
# correctly green. Both times the verdict certified a guard that never ran.
#
# Before any verdict: did the command RUN?
#
# A command that could not start fails the same way a red test does — non-zero
# — and every false CAUGHT this script has produced was that, not a guard being
# tested. `-- bash -c 'cd ../e2e && go test ...'` resolves outside the checkout
# (this script only cds to the module root for GO commands), so it died on
# "No such file or directory" and six tampers across four commits were recorded
# as CAUGHT without executing a single test.
#
# The test is NOT "does the output mention a missing file". A real guard
# failure often does — `t.Fatalf("...: %v", err)` on a file it expected to
# exist reads exactly like a broken harness, and an earlier version of this
# check called that INVALID, which is the same lie in the other direction: it
# tells you your evidence proves nothing when the guard actually fired.
#
# The signal is whether a RUNNER EVER STARTED. Go prints ok/FAIL/--- FAIL per
# package; vitest and playwright print their own summaries. None of that
# appears when the shell could not find the directory.
runner_started=0
case "$out" in
  *"--- FAIL"*|*"--- PASS"*|*$'\nok  '*|*"FAIL\t"*|*"PASS\n"*|\
  *"Test Files"*|*"Tests  "*|*"passed"*|*"failed"*|*"✓"*|*"×"*)
    runner_started=1 ;;
esac

if [ "$runner_started" -eq 0 ]; then
  echo "INVALID  — nothing that looks like a test runner produced output, so the"
  echo "           command almost certainly never reached the subject. This is NOT"
  echo "           evidence about the guard. CMD runs from the module root only for"
  echo "           go/gofmt, and from the repository root otherwise."
  printf '%s\n' "$out" | tail -10
  exit 2
fi

# EXPECT=... makes the tamper name what it expects to see in the output. Without
# it the verdict still says CAUGHT, but says which command produced it and warns
# that nothing checked WHICH assertion failed — because a script cannot know
# what you meant, and silence there is how the false verdicts happened.
if [ -n "${EXPECT:-}" ]; then
  if printf '%s' "$out" | grep -qF -- "$EXPECT"; then
    echo "CAUGHT  — applied, ${compiled}the output contains: $EXPECT"
    exit 0
  fi
  echo "RED, BUT NOT BY THE EXPECTED ASSERTION — the command failed and \"$EXPECT\" is"
  echo "not in its output, so something ELSE went red. This is the shape of a false"
  echo "CAUGHT: the guard under test may have passed. Failing output follows."
  printf '%s\n' "$out" | tail -25
  exit 3
fi

echo "CAUGHT  — applied, ${compiled}the tests went red."
echo "         (no EXPECT= given, so nothing checked WHICH assertion failed —"
echo "          set EXPECT='some assertion text' to rule out an unrelated failure)"
exit 0
