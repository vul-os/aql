package httpapi

import (
	"testing"
)

// GET /v1/admin/audit/verify answers BOTH questions the CLI answers.
//
// # Why this exists
//
// verify-audit prints three lines: each chain, and a cross-check that every
// audit row claiming a controller origin has the signed event behind it. The
// HTTP route ran only the chains, so an operator reading the console got a
// weaker answer than one with shell access — and nothing said so.
//
// That gap has a track record here. The console offered two webhook events
// while the hub sent four, for as long as automation alerts had existed,
// because one of two surfaces was updated and neither side was wrong on its
// own. The same happened to `head`, which the API returned for days while the
// console's type did not mention it, so the anchor the docs tell operators to
// record was not on the screen they read.
//
// # What is asserted
//
// The shape, not a specific count: `cross_check` is present, says whether it
// matched, and carries a number. A clean instance has nothing orphaned, and
// asserting zero here would pass equally if the field were hardcoded — so the
// store-level test (TestAnAuditRowWithNoSignedEventIsFound) owns the positive
// case, and this owns the wiring.
func TestAuditVerifyReportsTheCrossCheckToo(t *testing.T) {
	h := newTestServer(t, "op-token")
	adminAccess := claimAdmin(t, h, "op@x.com")

	rec, out := doJSON(t, h, "GET", "/v1/admin/audit/verify", adminAccess, nil)
	if rec.Code != 200 {
		t.Fatalf("verify: %d %v", rec.Code, out)
	}

	chains, ok := out["chains"].([]any)
	if !ok || len(chains) != 2 {
		t.Fatalf("expected both chains, got %v", out["chains"])
	}
	for _, c := range chains {
		m := c.(map[string]any)
		// The anchor an operator is told to write down. A chain result without
		// it is missing the half that makes truncation noticeable.
		if head, _ := m["head"].(string); head == "" {
			t.Errorf("chain %v carries no head", m["table"])
		}
	}

	cross, ok := out["cross_check"].(map[string]any)
	if !ok {
		t.Fatal("no cross_check in the response: the console cannot ask the question " +
			"the CLI answers, and would report a weaker result than verify-audit")
	}
	if _, ok := cross["ok"].(bool); !ok {
		t.Errorf("cross_check has no verdict: %v", cross)
	}
	if _, ok := cross["orphaned_audit_rows"].(float64); !ok {
		t.Errorf("cross_check has no count: %v", cross)
	}
}
