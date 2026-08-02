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
SKIPPED=0
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

run_portal() {
  local name="$1" out
  if [ ! -d "$ROOT/hub/internal/portal/dist" ]; then
    printf '  \033[33mSKIP\033[0m  %s (no built bundle; run `make -C hub portal` — CI builds it)\n' "$name"
    SKIPPED=$((SKIPPED + 1))
    return
  fi
  if out=$(cd "$ROOT/hub" && go test -count=1 -tags portal ./internal/portal/ 2>&1); then
    printf '  \033[32mok\033[0m    %s\n' "$name"
    PASS=$((PASS + 1))
  else
    printf '  \033[31mFAIL\033[0m  %s\n' "$name"
    printf '%s\n' "$out" | tail -25 | sed 's/^/          /'
    FAIL=$((FAIL + 1)); FAILED_NAMES+=("$name")
  fi
}

run_deadcode() {
  local name="$1" out rc
  out=$("$ROOT/scripts/deadcode.sh" 2>&1); rc=$?
  case "$rc" in
    0) printf '  \033[32mok\033[0m    %s\n' "$name"; PASS=$((PASS + 1)) ;;
    2) printf '  \033[33mSKIP\033[0m  %s (deadcode not installed; CI runs it)\n' "$name"
       SKIPPED=$((SKIPPED + 1)) ;;
    *) printf '  \033[31mFAIL\033[0m  %s\n' "$name"
       printf '%s\n' "$out" | sed 's/^/          /'
       FAIL=$((FAIL + 1)); FAILED_NAMES+=("$name") ;;
  esac
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
# The portal tag needs the built React bundle at hub/internal/portal/dist, which
# is a build output and not committed — so this can only run after `make portal`.
#
# It is a gate rather than a footnote because the tagged build is the one that
# ships, and its only test went unrun for as long as it existed: nothing anywhere
# executed `go test -tags portal`. What it covers is the SPA fallback, which had
# been answering unregistered /v1/ paths with 200 and index.html.
#
# Listed under hub because run_portal cds to hub/. It used to print after the
# `controller` heading, so the output said the controller module had a portal
# build and the hub had none — and a reader auditing whether the shipped build
# is tested would have read the hub block and concluded it is not.
run_portal "go test -tags portal"

echo "controller"
run_gofmt "gofmt"                     controller
run      "go vet"                     controller go vet ./...
run      "go test"                    controller go test -count=1 ./...
# The optional backends are where this module's platform support lives, and a
# file behind a build tag is invisible to the plain run above.
run      "go test -tags gpio"         controller go test -count=1 -tags gpio ./...
run      "go test -tags ble"          controller go test -count=1 -tags ble ./...
# ...and the two above are PARTLY BLIND on a Mac, which is where they mostly run.
#
# `-tags ble` runs 296 tests on darwin. So does no tag at all: the only file
# behind that tag is `ble && (linux || windows)`, so the gate compiled nothing
# new and printed ok either way. A type error planted in start_gatts.go passed
# all sixteen gates — gofmt parses it, but nothing typechecks a file the build
# constraints exclude. Same for `gpio && linux` (gpio_linux.go and its test).
#
# vet rather than build, because `go build` does not look at _test.go files and
# gpio_linux_test.go is exactly the kind of file nobody compiles here. Both are
# typecheck-only: no Linux binary runs on this machine, and these tests still
# need real hardware.
run      "go vet (linux, -tags gpio)" controller env CGO_ENABLED=0 GOOS=linux go vet -tags gpio ./...
run      "go vet (linux, -tags ble)"  controller env CGO_ENABLED=0 GOOS=linux go vet -tags ble ./...
# ARCHITECTURE.md says the peripheral "cross-compiles for Linux (BlueZ) and
# Windows (WinRT) behind -tags ble". The Linux half is checked above; this is
# the Windows half, which was a claim nothing verified.
run      "go vet (windows, -tags ble)" controller env CGO_ENABLED=0 GOOS=windows go vet -tags ble ./...

echo "e2e (real binaries)"
run      "go test"                    e2e go test -count=1 -timeout 900s ./...

# A gate whose tool may be missing has to distinguish SKIP from ok, or an
# absent binary reads as a pass — this repository's most common defect shape,
# now in the checker itself. deadcode.sh exits 2 when the tool is not installed,
# and CI installs it, so CI never takes this branch.
echo "reachability"
run_deadcode "unreachable functions"

echo "wire contracts"
run      "vector verifier"            proto/vectors node verify.mjs

echo "frontend"
# `npm run typecheck`, which is `tsc -b --noEmit`, and NOT `npx tsc --noEmit`.
#
# The root tsconfig.json is a solution file: "files": [] plus references. A plain
# `tsc --noEmit` therefore type-checks NOTHING and exits 0 on any tree at all.
# ci.yml has said so at its own typecheck step for a long time — "it did exactly
# that until it was caught" — and this line kept the bug the whole time, so the
# local gate reported green over six real type errors in a page that could not
# build. Running what CI runs is the only way the two cannot drift.
run      "tsc"                        . npm run typecheck
run      "vitest"                     . npx vitest run
run      "feature claims"             . npm run check:claims

echo
if [ "$FAIL" -eq 0 ]; then
  # A skipped gate is reported as loudly as a failed one. The whole premise of
  # this script is that a gate which does not run must never look like one that
  # did.
  if [ "$SKIPPED" -gt 0 ]; then
    printf '\033[33m%d gate(s) SKIPPED — not run here, so not evidence.\033[0m\n' "$SKIPPED"
  fi
  printf '\033[32m%d gates passed.\033[0m Not everything CI runs — the race detector, fuzzing,\n' "$PASS"
  echo "cross-platform builds, Playwright and the container image are CI-only."
  echo
  echo "Each of those is runnable here, and two of the five found real defects on"
  echo "2026-08-01 the first time anyone ran them locally — a data race in a live-view"
  echo "test, and a request injection in the SDP parser:"
  echo "  (cd hub && go test -race -count=1 ./...)          # and controller/, e2e/"
  echo "  scripts/fuzz-all.sh 30                          # all 15 targets, not just one"
  echo "  (cd hub && CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build ./...)"
  echo "  npx playwright test"
  echo "  docker build -f hub/Dockerfile -t aql-hub:ci ."
  exit 0
fi
printf '\033[31m%d of %d gates failed:\033[0m\n' "$FAIL" "$((PASS + FAIL))"
for n in "${FAILED_NAMES[@]}"; do echo "  - $n"; done
exit 1
