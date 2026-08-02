#!/usr/bin/env bash
# scripts/release.sh — cut a lintel release.
#
# Usage: scripts/release.sh vX.Y.Z [--dry-run]
#
# Verifies the working tree is clean, runs every local suite (backend unit,
# frontend typecheck+build, gateway vet+test, controller if present, proto
# vectors), then creates and pushes an annotated tag. The tag push triggers
# .github/workflows/release.yml (binaries + desktop app + GitHub Release) and
# .github/workflows/docker.yml (ghcr.io image).
#
# --dry-run runs all checks but does not tag or push.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VERSION="${1:-}"
DRY_RUN="${2:-}"

usage() {
  echo "usage: scripts/release.sh vX.Y.Z [--dry-run]" >&2
  exit 2
}

[ -n "$VERSION" ] || usage
if ! [[ "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
  echo "error: version must look like vX.Y.Z (got: $VERSION)" >&2
  exit 2
fi
if [ -n "$DRY_RUN" ] && [ "$DRY_RUN" != "--dry-run" ]; then
  usage
fi

step() { printf '\n==> %s\n' "$*"; }

# --- preflight ---------------------------------------------------------------

step "preflight: clean working tree"
if [ -n "$(git status --porcelain)" ]; then
  echo "error: working tree is not clean — commit or stash first" >&2
  git status --short >&2
  exit 1
fi

if git rev-parse -q --verify "refs/tags/$VERSION" >/dev/null; then
  echo "error: tag $VERSION already exists" >&2
  exit 1
fi

# --- suites ------------------------------------------------------------------

step "frontend: typecheck + build"
npm run typecheck
npm run build

step "backend: typecheck + unit tests"
(
  cd backend
  export JWT_SECRET="${JWT_SECRET:-release-dummy-jwt-secret}"
  export APP_ENV=test
  npm run check
  npm run test:unit
)

# The hub module. NOT optional, and not called gateway.
#
# This read `if [ -f gateway/go.mod ]` — the pre-rename directory — so it took
# the else branch on every run and printed "gateway: skipped". The main module
# went unbuilt and untested at release time, announced by a line that read like
# a deliberate omission rather than a mistake. A skip is only honest when the
# thing skipped is genuinely optional; this one never was, so a missing hub is
# now a failure.
if [ ! -f hub/go.mod ]; then
  echo "release: hub/go.mod is missing — this is not an aql checkout" >&2
  exit 1
fi
step "hub: go vet + go build + go test"
(cd hub && go vet ./... && CGO_ENABLED=0 go build ./... && go test ./...)

if [ -f controller/go.mod ]; then
  step "controller: go vet + go test"
  (cd controller && go vet ./... && CGO_ENABLED=0 go build ./... && go test ./...)
else
  step "controller: skipped (controller/go.mod not found)"
fi

step "proto: conformance vectors"
node proto/vectors/verify.mjs

# --- tag + push --------------------------------------------------------------

if [ "$DRY_RUN" = "--dry-run" ]; then
  step "dry run: all suites green — would tag and push $VERSION"
  exit 0
fi

step "tagging $VERSION"
git tag -a "$VERSION" -m "lintel $VERSION"

step "pushing tag (triggers release.yml + docker.yml)"
git push origin "refs/tags/$VERSION"

step "done: $VERSION pushed — watch the Release and Docker workflows"
