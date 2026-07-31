package httpapi

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// docs/CHAT-COMMANDS.md §3.6 — "never over a chat rail, at any tier, for any
// role" — enforced rather than asserted.
//
// # Why this is a source test and not a behavioural one
//
// The property is "a chat rail cannot reach these operations". Behavioural tests
// can only show that particular phrasings do not reach them, and the list of
// phrasings is infinite. What is finite is the set of chat entry points and the
// set of operations they may call, so this reads the former and denies the
// latter.
//
// §3.6's own reasoning is why it is worth enforcing at all: "a chat rail is not
// a control plane for the control plane". Every row is an operation that changes
// what authorization MEANS — issuing a grant, rotating the signing key, editing
// the limits, reading the audit log. Reaching any of them from a message would
// let the thing being authorized authorize itself.
//
// # What would go wrong without it
//
// Nothing today; the rails reach the gate path and the read path and nothing
// else. That is exactly when to write this down. The chat surface has grown
// three times in recent memory — a hold verb, a question classifier, a read
// path — and each time the natural next step was "while we are here, let it
// also…". This is the line that step has to stop at, and a line nobody checks
// is a line that moves.

// chatEntryPoints are the files a chat message can reach. Everything a rail
// does begins in one of these.
var chatEntryPoints = []string{
	"channels_whatsapp.go",
	"channels_telegram.go",
	"channels_slack.go",
	"channels_discord.go",
	"channels_dmtap.go",
	"channels_telegram_polling.go",
	"channels_query.go",
	"channels_open.go",
	"channels_http.go",
	"channellink.go",
	"phonelink_chat.go",
}

// forbidden is §3.6's table, expressed as the store operations and route
// handlers that implement each row.
//
// Symbols, not phrases: a rail cannot suspend an account without calling
// something that suspends an account. Each entry names the §3.6 row it comes
// from so a future reader can check the list against the document rather than
// trusting that it was once transcribed correctly.
var forbidden = map[string]string{
	// Grant issuance and revocation — "authorization changes must not be
	// authorizable through the thing they authorize".
	"CreateGrant": "§3.6 grant issuance",
	"RevokeGrant": "§3.6 grant revocation",
	// The OFFLINE grant path, which had no entry here at all. Its own §3.6 row
	// exists ("Offline-grant issuance — mints an offline-verifiable
	// capability") and nothing implemented it, so the strictest capability the
	// product issues was the one row the guard did not cover. The revocation
	// half was added later still, by me, in a category this table already
	// named — which is exactly the drift §3.6's own comment predicts: "a line
	// nobody checks is a line that moves".
	"SignGrant":                "§3.6 offline-grant issuance",
	"RecordOfflineGrant":       "§3.6 offline-grant issuance",
	"handleOfflineGrantIssue":  "§3.6 offline-grant issuance",
	"RevokeOfflineGrant":       "§3.6 grant revocation",
	"handleOfflineGrantRevoke": "§3.6 grant revocation",
	"OfflineGrantsForMember":   "§3.6 grant revocation",

	// `config` — actuation parameters. Changes what "open" physically means,
	// and the row cites proto/commands.md rather than a hub symbol, so the
	// symbol that actually sends one was never denied.
	"handleDeviceConfig": "§3.6 config (actuation parameters)",

	// `repair` — re-roots the entire trust chain. Same shape: the row cited
	// the wire contract and not the handler that starts a rotation.
	"handleKeyRotationStart": "§3.6 repair (gateway key rotation)",
	"handleKeyRotationRetry": "§3.6 repair (gateway key rotation)",

	// Rate-limit / quota changes — disables the abuse controls.
	"handleAdminLimitsPatch":    "§3.6 rate-limit / quota changes",
	"handleLocationLimitsPatch": "§3.6 rate-limit / quota changes",

	// Device pairing / claim-token issuance — enrolls a new actuator.
	"CreateDeviceWithClaim": "§3.6 device pairing / claim tokens",
	"ClaimDevice":           "§3.6 device claim",

	// Account/user suspension or enablement, and credentials.
	"SetAccountStatus": "§3.6 account suspension",
	"SetUserStatus":    "§3.6 user enable/disable",
	"SetUserPassword":  "§3.6 credential entry",

	// Audit-log reads — evidence.
	"AdminAudit":             "§3.6 audit-log reads",
	"AdminAuditActions":      "§3.6 audit-log reads",
	"AdminUsers":             "§3.6 member lists",
	"AdminAccounts":          "§3.6 account roster",
	"AccountActivitySummary": "§3.6 other members' activity",

	// Camera media — §5, and the strictest row: not the clips, not a still,
	// not a link.
	"ClipsByDevice":   "§3.6 camera media",
	"RecordClip":      "§3.6 camera media",
	"CameraAccessLog": "§3.6 camera-access log",

	// Anything that reconfigures the audit path or the abuse controls.
	"VerifyAccessLogHashChain":  "§3.6 audit-path reconfiguration",
	"VerifyAdminAuditHashChain": "§3.6 audit-path reconfiguration",
}

// allowedAudit is the one audit-table WRITE a chat rail must keep making.
//
// §4.4 rule 5 requires a read to be recorded, and the record goes in the same
// hash-chained table as an open. Writing evidence is not reading it, and the
// distinction is the point: a rail may add to the log and may not consult it.
const allowedAudit = "LogGateRead"

func chatSource(t *testing.T) map[string]string {
	t.Helper()
	out := map[string]string{}
	for _, name := range chatEntryPoints {
		b, err := os.ReadFile(filepath.Join(".", name))
		if err != nil {
			// A renamed or deleted entry point must fail loudly. Silently
			// scanning fewer files is how this test would keep passing while
			// covering nothing.
			t.Fatalf("chat entry point %s cannot be read: %v — update chatEntryPoints", name, err)
		}
		out[name] = string(b)
	}
	return out
}

func TestNoChatRailReachesAForbiddenOperation(t *testing.T) {
	src := chatSource(t)
	for name, body := range src {
		for sym, why := range forbidden {
			// Word-boundary: `AdminAudit` must not match `AdminAuditActions`
			// being legitimately absent, and must not fire on a comment
			// mentioning it. Comments are stripped first for the same reason —
			// this file's own prose names every one of these symbols.
			if regexp.MustCompile(`\b` + regexp.QuoteMeta(sym) + `\b`).MatchString(stripComments(body)) {
				t.Errorf("%s reaches %s (%s) — chat is not a control plane for the control plane", name, sym, why)
			}
		}
	}
}

// chatEntryPoints must name every chat file, or coverage narrows silently.
//
// Found by tampering: deleting an entry from the list left every assertion
// above passing while that rail went unscanned. A denylist whose SUBJECT list
// can shrink unnoticed is the same defect as a denial that matches nothing —
// both report a clean scan of something they did not read.
func TestEveryChatFileIsScanned(t *testing.T) {
	listed := map[string]bool{}
	for _, n := range chatEntryPoints {
		listed[n] = true
	}
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}
	seen := 0
	for _, e := range entries {
		n := e.Name()
		if e.IsDir() || !strings.HasSuffix(n, ".go") || strings.HasSuffix(n, "_test.go") {
			continue
		}
		// The chat surface by naming convention, plus the two link files a
		// message reaches before any membership lookup.
		isChat := strings.HasPrefix(n, "channels_") || n == "channellink.go" || n == "phonelink_chat.go"
		if !isChat {
			continue
		}
		seen++
		if !listed[n] {
			t.Errorf("%s is a chat entry point and is not in chatEntryPoints — it is not being scanned", n)
		}
	}
	if seen < 8 {
		t.Errorf("only %d chat files discovered — the naming convention this relies on has changed", seen)
	}
}

// The guard on the guard. Every denied symbol has to be a real operation that
// exists somewhere, or the denial is a string nobody ever could have matched
// and this test would pass forever having checked nothing.
func TestEveryForbiddenSymbolIsARealOperation(t *testing.T) {
	root := filepath.Join("..", "..")
	found := map[string]bool{}
	err := filepath.Walk(root, func(p string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() || !strings.HasSuffix(p, ".go") {
			return nil
		}
		b, err := os.ReadFile(p)
		if err != nil {
			return nil
		}
		src := string(b)
		for sym := range forbidden {
			// Any receiver, not just *Store. This used to accept only
			// `func (s *Store) X(` and `func X(`, which quietly constrained
			// the map to store methods — and is the likeliest reason four
			// §3.6 rows (config, repair, offline-grant issuance, rate limits)
			// had no entry at all: their operations are HANDLERS and *Keys
			// methods, so adding one would have failed this check and looked
			// like the entry was wrong rather than this test being narrow.
			if defines(src, sym) {
				found[sym] = true
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	for sym, why := range forbidden {
		if !found[sym] {
			t.Errorf("forbidden symbol %q (%s) is not defined anywhere — the denial matches nothing", sym, why)
		}
	}
}

// And the false-positive control: the test must be capable of failing. If
// stripComments or the word-boundary match were broken, every assertion above
// would pass vacuously.
func TestTheForbiddenScanCanActuallyMatch(t *testing.T) {
	src := chatSource(t)
	// `func` rather than something semantic: channels_http.go is 36 lines of
	// shared plumbing and does not name a `ctx` variable, so a cleverer
	// sentinel would fail on a file that is fine. Every Go file declares a
	// function, and if stripComments had eaten the source this would vanish
	// with it.
	sentinel := regexp.MustCompile(`\bfunc\b`)
	for name, body := range src {
		stripped := stripComments(body)
		if !sentinel.MatchString(stripped) {
			t.Errorf("%s: the scanner found no `func` — stripComments has eaten the source", name)
		}
		// This codebase comments heavily, so a low ratio is expected; near-zero
		// means the stripper is removing code. Catches the failure the sentinel
		// alone would not: most of the file gone, one `func` surviving.
		if len(stripped)*4 < len(body) {
			t.Errorf("%s: stripComments left %d of %d bytes — it is eating code, not comments",
				name, len(stripped), len(body))
		}
	}
	// And a symbol that IS present must be detected: LogGateRead is the one
	// audit write a rail is allowed to make, so it is a live positive control.
	if !regexp.MustCompile(`\b` + allowedAudit + `\b`).MatchString(stripComments(src["channels_query.go"])) {
		t.Errorf("%s not detected in channels_query.go — the matcher cannot see real calls", allowedAudit)
	}
}

// stripComments removes // and /* */ so the scan reads code rather than prose.
// Without it this file's own documentation of the forbidden list would make
// every entry point look like a violation of itself.
func stripComments(s string) string {
	s = regexp.MustCompile(`(?s)/\*.*?\*/`).ReplaceAllString(s, "")
	var b strings.Builder
	for _, line := range strings.Split(s, "\n") {
		if i := strings.Index(line, "//"); i >= 0 {
			line = line[:i]
		}
		b.WriteString(line)
		b.WriteString("\n")
	}
	return b.String()
}

// defines reports whether src declares sym as a function or a method on any
// receiver.
func defines(src, sym string) bool {
	if strings.Contains(src, "func "+sym+"(") {
		return true
	}
	// `func (x *T) sym(` — scan each `func (` and check what follows the
	// receiver's closing paren. Cheaper and clearer than a regex, and it
	// cannot be fooled by a receiver type containing a paren, which Go does
	// not permit.
	for i := 0; ; {
		j := strings.Index(src[i:], "func (")
		if j < 0 {
			return false
		}
		i += j + len("func (")
		close := strings.Index(src[i:], ")")
		if close < 0 {
			return false
		}
		rest := src[i+close+1:]
		if strings.HasPrefix(rest, " "+sym+"(") {
			return true
		}
	}
}
