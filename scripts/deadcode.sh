#!/usr/bin/env bash
#
# deadcode.sh — functions nothing reaches, not even a test.
#
# # What this catches that the existing reachability tests do not
#
# store/reachability_test.go and devices/hubreach_test.go both work by NAME:
# they count textual occurrences of an identifier. That is enough to find an
# exported symbol nobody mentions, and it is blind in two ways this is not:
#
#   - It cannot tell two same-named declarations apart. `Dropped` is declared on
#     both Broadcaster and Depacketizer; `Execute` on seven driver types. One
#     declaration's `func X(` line reads as a USE of the other, so an orphan
#     hides behind its namesake. Four symbols were hidden this way when this was
#     written.
#   - It cannot follow a method through an interface, so it must be conservative
#     about anything that might be dispatched dynamically.
#
# `deadcode` does rapid type analysis from main() and answers the question those
# tests approximate. It found six functions with no reachable caller at all,
# including a documented "the read every disclosure path must go through" that
# no disclosure path went through, and a store method kept alive in the
# name-based check purely by that dead wrapper mentioning it.
#
# # WHAT THIS DOES NOT SEE: a dead METHOD on a type that reaches an interface
#
# Rapid type analysis is conservative about dynamic dispatch. Once a type is
# assigned to an interface anywhere reachable — `any` in a JSON marshal or a log
# field is enough — its whole method set is treated as potentially called, and an
# unreachable method on it is never reported.
#
# Measured, not assumed. Planting two symbols in internal/store on 2026-08-03 —
# `PlantedDeadFunc` and `PlantedDeadMethod` on *StepUpIntent, neither called by
# anything — this sweep reported the func and stayed silent about the method.
# That is how StepUpIntent.Approvable and APITokenPrincipal.ScopeList survived:
# invisible here, and out of scope for store/reachability_test.go, which
# enumerated `func (s *Store)` receivers only.
#
# So "no unreachable functions" below means FUNCTIONS. Dead methods on store
# types are now covered by that test's second regex; dead methods elsewhere in
# the tree are still nobody's job, and this comment is the record of it.
#
# # Why -test, and why the intersection across configurations
#
# -test counts test-only callers as reachable, which makes this STRICTLY about
# code nothing at all runs. Production-reachability — "only tests call it" — is
# the other two tests' job, and they have argued allowlists for it.
#
# The intersection is the load-bearing part, and it is here because getting it
# wrong nearly cost real code. Run against the default build on a Mac, this
# reports controller's LocalName and Session.AbortPartial as unreachable. Both
# are called from start_gatts.go, which is behind `//go:build ble && (linux ||
# windows)` and therefore invisible. A function is dead only if EVERY
# configuration agrees it is dead; anything else is an artifact of what the
# analyser was allowed to see.
#
# So each configuration below mirrors one the cross-build matrix in ci.yml
# actually ships.
set -uo pipefail

cd "$(dirname "$0")/.."

BIN="$(go env GOPATH)/bin/deadcode"
if [ ! -x "$BIN" ]; then
  if command -v deadcode >/dev/null 2>&1; then
    BIN="$(command -v deadcode)"
  else
    echo "deadcode not installed — go install golang.org/x/tools/cmd/deadcode@latest" >&2
    echo "(CI installs it; this is not a pass)" >&2
    exit 2
  fi
fi

# Functions that are unreachable and must stay that way, with the reason.
#
# Only ONE kind of entry belongs here: a method that exists to satisfy an
# interface, where no reachable call site dispatches through that interface.
# Deleting it breaks the build, so "wire it up or delete it" — the answer to
# every other finding — does not apply.
#
# "Nothing calls it yet" is unfinished work and belongs in todo instead.
ALLOWED_REASON_INTERFACE="satisfies channels.Channel, which every webhook rail must implement; only DialChannel.Kind has a reachable caller (httpapi/server.go logs it for dial-out rails)"
ALLOWED=(
  "internal/channels/slack.go:*: unreachable func: Slack.Kind"
  "internal/channels/telegram.go:*: unreachable func: Telegram.Kind"
  "internal/channels/whatsapp.go:*: unreachable func: WhatsApp.Kind"
)

# module|GOOS|tags — each mirrors a configuration ci.yml builds.
CONFIGS=(
  "hub|linux|"
  "hub|darwin|"
  "controller|linux|ble"
  "controller|linux|"
  "controller|windows|ble"
)

# Line numbers move; the function does not. Compare on file+symbol.
strip_line() { sed -E 's/:[0-9]+:[0-9]+:/:*:/'; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

for cfg in "${CONFIGS[@]}"; do
  IFS='|' read -r mod goos tags <<<"$cfg"
  args=(-test)
  [ -n "$tags" ] && args+=(-tags "$tags")
  ( cd "$mod" && GOOS="$goos" "$BIN" "${args[@]}" ./... 2>/dev/null ) \
    | strip_line | sed "s#^#$mod/#" | sort -u > "$tmp/$mod-$goos-${tags:-none}.txt"
done

# Dead in every configuration of its own module. A module contributes only its
# own configurations, so hub's findings are not intersected against controller's
# empty set — that would silently clear everything.
: > "$tmp/dead.txt"
for mod in hub controller; do
  files=("$tmp/$mod-"*.txt)
  [ -e "${files[0]}" ] || continue
  cp "${files[0]}" "$tmp/acc.txt"
  for f in "${files[@]:1}"; do
    comm -12 "$tmp/acc.txt" "$f" > "$tmp/acc2.txt"
    mv "$tmp/acc2.txt" "$tmp/acc.txt"
  done
  cat "$tmp/acc.txt" >> "$tmp/dead.txt"
done

: > "$tmp/unexplained.txt"
while IFS= read -r line; do
  [ -z "$line" ] && continue
  keep=1
  for a in "${ALLOWED[@]}"; do
    case "$line" in
      */"$a") keep=0 ;;
    esac
  done
  [ "$keep" -eq 1 ] && echo "$line" >> "$tmp/unexplained.txt"
done < "$tmp/dead.txt"

# An allowlist entry that no longer matches anything is a stale exemption, and
# the next reader would take it as evidence the symbol was examined.
stale=0
for a in "${ALLOWED[@]}"; do
  if ! grep -qF -- "$a" "$tmp/dead.txt"; then
    echo "stale exemption: '$a' is no longer unreachable — remove it" >&2
    stale=1
  fi
done

n=$(wc -l < "$tmp/unexplained.txt" | tr -d ' ')
if [ "$n" -gt 0 ]; then
  echo "$n function(s) are unreachable in every build configuration:" >&2
  echo >&2
  sed 's/^/  /' "$tmp/unexplained.txt" >&2
  echo >&2
  echo "Nothing calls these — not production, not a test. Ask what WOULD call it." >&2
  echo "Every instance found when this was added was one of three things: a" >&2
  echo "superseded helper whose replacement took over (delete it), a named" >&2
  echo "accessor whose body had been copied inline at the one call site (use it)," >&2
  echo "or a gate that was written, documented as mandatory, and never wired." >&2
  echo >&2
  echo "If it exists only to satisfy an interface, add it to ALLOWED with a" >&2
  echo "reason. That is the only case where leaving it unreachable is correct." >&2
  exit 1
fi
[ "$stale" -eq 1 ] && exit 1

echo "no unreachable functions across ${#CONFIGS[@]} build configurations (${#ALLOWED[@]} explained)"
