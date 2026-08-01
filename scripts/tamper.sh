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
#
# Example:
#   scripts/tamper.sh hub/internal/keys/keys.go \
#     'return nil, ErrSealedNoKey' 'return raw, nil' \
#     -- go test -count=1 ./internal/keys/
#
# CMD runs from the FILE's module root, so the go test path is module-relative.

set -uo pipefail

if [ "$#" -lt 5 ]; then
  sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
fi

file=$1; old=$2; new=$3; shift 3
[ "${1:-}" = "--" ] || { echo "expected -- before the test command" >&2; exit 2; }
shift

[ -f "$file" ] || { echo "INVALID: $file does not exist" >&2; exit 2; }

# The module root, so `go test ./internal/x/` works the way it does by hand.
root=$(cd "$(dirname "$file")" && while [ ! -f go.mod ] && [ "$PWD" != / ]; do cd ..; done; pwd)
[ -f "$root/go.mod" ] || { echo "INVALID: no go.mod above $file" >&2; exit 2; }

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

if ! (cd "$root" && go build ./... >/dev/null 2>&1); then
  echo "INVALID  — the tampered tree does not compile. A tamper that cannot build proves nothing."
  exit 2
fi

if (cd "$root" && "$@" >/dev/null 2>&1); then
  echo "NOT CAUGHT  — applied, compiled, and the tests still pass. The guard is blind to this."
  exit 1
fi

echo "CAUGHT  — applied, compiled, and the tests went red."
exit 0
