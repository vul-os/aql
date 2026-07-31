#!/usr/bin/env bash
# =============================================================================
# scripts/check.sh — every gate this repository has, in one command.
#
# WHY THIS EXISTS
# ───────────────
# There are four modules and nine gates: gofmt and go vet and go test across
# hub/, controller/ and e2e/, plus vitest, tsc, the feature-claims check and the
# wire-vector verifier. Running them meant assembling that list by hand every
# time, and a list assembled by hand is a list with something missing.
#
# That is not hypothetical. A commit renamed a function on the controller's
# command-verification path, which invalidated a feature claim's evidence
# pattern — and shipped, because check:claims was left out of that run. The
# gate existed, CI would have caught it, and the local run said green.
#
# WHAT IT IS NOT
# ──────────────
# Not a replacement for CI. CI is the authority and runs more: the race detector
# across all three modules (~45 minutes), fuzz seeds, cross-builds for every
# released platform, the Playwright suite, and the container image. This is the
# fast subset you can run before every commit — if it is green, CI usually is.
#
# EVERY GATE REPORTS
# ──────────────────
# Each one prints a line whether it passes or fails, and the summary counts what
# ran. A gate that silently does not execute is the failure this file exists to
# prevent, so "no output" is never a pass here.
set -uo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"

PASS=0
FAIL=0
FAILED_NAMES=()

run() {
  local name="$1"; shift
  local dir="$1"; shift
  local out
  if out=$(cd "$ROOT/$dir" && "$@" 2>&1); then
    printf '  \033[32mok\033[0m    %s\n' "$name"
    PASS=$((PASS + 1))
  else
    printf '  \033[31mFAIL\033[0m  %s\n' "$name"
    printf '%s\n' "$out" | tail -25 | sed 's/^/          /'
    FAIL=$((FAIL + 1))
    FAILED_NAMES+=("$name")
  fi
}

# gofmt exits 0 with a LIST of unformatted files rather than failing, so it needs
# its own check — `gofmt -l` succeeding tells you nothing.
run_gofmt() {
  local name="$1" dir="$2" out
  out=$(cd "$ROOT/$dir" && gofmt -l . 2>&1)
  if [ -z "$out" ]; then
    printf '  \033[32mok\033[0m    %s\n' "$name"
    PASS=$((PASS + 1))
  else
    printf '  \033[31mFAIL\033[0m  %s\n' "$name"
    printf '%s\n' "$out" | sed 's/^/          /'
    FAIL=$((FAIL + 1))
    FAILED_NAMES+=("$name")
  fi
}

echo "aql: running every local gate"
echo

# -count=1 on every go test gate, not just e2e.
#
# These modules read the shared conformance corpus in proto/vectors/ from OUTSIDE
# their own module tree, and Go's test cache did not invalidate on it: a vector
# added to grants.json left hub/internal/keys serving a cached PASS, and this
# script reported 14 of 14 green across two commits while the hub's independent
# grant verifier was accepting a grant the controller refuses.
#
# A gate that can report a stale PASS is worse than no gate, because it is
# believed. The cost is a full re-run each time, which for these suites is
# seconds.
echo "hub"
run_gofmt "gofmt"                     hub
run      "go vet"                     hub go vet ./...
run      "go build"                   hub go build ./...
run      "go test"                    hub go test -count=1 ./...

echo "controller"
run_gofmt "gofmt"                     controller
run      "go vet"                     controller go vet ./...
run      "go test"                    controller go test -count=1 ./...
# The optional backends are where this module's platform support lives, and a
# file behind a build tag is invisible to the plain run above.
run      "go test -tags gpio"         controller go test -count=1 -tags gpio ./...
run      "go test -tags ble"          controller go test -count=1 -tags ble ./...

echo "e2e (real binaries)"
run      "go test"                    e2e go test -count=1 -timeout 900s ./...

echo "wire contracts"
run      "vector verifier"            proto/vectors node verify.mjs

echo "frontend"
run      "tsc"                        . npx tsc --noEmit
run      "vitest"                     . npx vitest run
run      "feature claims"             . npm run check:claims

echo
if [ "$FAIL" -eq 0 ]; then
  printf '\033[32m%d gates passed.\033[0m Not everything CI runs — the race detector, fuzzing,\n' "$PASS"
  echo "cross-platform builds, Playwright and the container image are CI-only."
  exit 0
fi
printf '\033[31m%d of %d gates failed:\033[0m\n' "$FAIL" "$((PASS + FAIL))"
for n in "${FAILED_NAMES[@]}"; do echo "  - $n"; done
exit 1
