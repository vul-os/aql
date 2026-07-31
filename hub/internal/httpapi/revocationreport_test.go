package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"testing"

	"github.com/vul-os/aql/hub/internal/keys"
	"github.com/vul-os/aql/hub/internal/store"
)

// Ingesting a controller's reported deny-list state — docs/GRANT-REVOCATION.md
// §5, migration 0031.
//
// The distinction these hold is the whole feature: "this gate cannot tell us"
// and "this gate confirms it holds nothing" are opposite answers for an
// operator deciding whether to latch lockdown, and one is reached by writing a
// zero row for a report that carried nothing.

// reportFixture builds a Server directly rather than through the router.
//
// These exercise handleControllerConfigReport, which is reached over a
// WEBSOCKET uplink and not by an HTTP route, so there is no request to send.
// Constructed the same way newTestServerWithStore does it, over the same real
// store, so what is tested is the production handler and a real schema.
func reportFixture(t *testing.T) (*Server, context.Context, string) {
	t.Helper()
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	ks, err := keys.Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	srv := New(Config{
		Version:   "test",
		JWTSecret: []byte("0123456789abcdef0123456789abcdef"),
	}, st, ks, slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)))
	ctx := context.Background()
	u, err := st.CreateUser(ctx, "owner-rev@example.test", "x", "Owner", "ZA")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	acct, loc, err := st.CreateAccountWithOwner(ctx, u.ID, "Estate", "ZA")
	if err != nil {
		t.Fatalf("CreateAccountWithOwner: %v", err)
	}
	dev, err := st.CreateDeviceWithClaim(ctx, acct.ID, loc.ID, "Gate", "hash", 0)
	if err != nil {
		t.Fatalf("CreateDeviceWithClaim: %v", err)
	}
	return srv, ctx, dev.ID
}

func report(t *testing.T, revocation string) []byte {
	t.Helper()
	body := `{"v":0,"typ":"ctl.report","device_id":"x","ts":1789000020,"firmware":"0.1.0",` +
		`"config":{"pulse_ms":{"value":700,"source":"default"}}` + revocation + `}`
	if !json.Valid([]byte(body)) {
		t.Fatalf("test built invalid JSON: %s", body)
	}
	return []byte(body)
}

// A firmware predating the field sends no block. Storing a zero row for it
// would tell an operator this gate confirms it holds no deny-list, when the
// truth is that it cannot say.
func TestAReportWithNoRevocationBlockStoresNothing(t *testing.T) {
	s, ctx, dev := reportFixture(t)
	s.handleControllerConfigReport(ctx, dev, report(t, ""))

	if _, ok, err := s.store.RevocationReportFor(ctx, dev); err != nil || ok {
		t.Fatalf("reported=%v err=%v — an absent block was recorded as a report", ok, err)
	}
	// The config half still landed: the two are independent, and a controller
	// that reports one and not the other is a real state.
	if _, err := s.store.ConfigReportFor(ctx, dev); err != nil {
		t.Errorf("the config report was lost alongside the missing revocation block: %v", err)
	}
}

func TestAReportOfSeqZeroIsRecordedAsAReport(t *testing.T) {
	s, ctx, dev := reportFixture(t)
	s.handleControllerConfigReport(ctx, dev, report(t, `,"revocation":{"seq":0,"entries":0}`))

	rep, ok, err := s.store.RevocationReportFor(ctx, dev)
	if err != nil {
		t.Fatalf("RevocationReportFor: %v", err)
	}
	if !ok {
		t.Fatal("a controller that reported seq 0 reads as having reported nothing — " +
			"'never been sent a list' is a confirmation, not an absence")
	}
	if rep.Seq != 0 || rep.Entries != 0 {
		t.Errorf("report = %+v, want seq 0 with no entries", rep)
	}
}

func TestAReportedSequenceIsStoredAndServed(t *testing.T) {
	s, ctx, dev := reportFixture(t)
	s.handleControllerConfigReport(ctx, dev, report(t, `,"revocation":{"seq":12,"entries":3}`))

	rep, ok, err := s.store.RevocationReportFor(ctx, dev)
	if err != nil || !ok {
		t.Fatalf("ok=%v err=%v", ok, err)
	}
	if rep.Seq != 12 || rep.Entries != 3 {
		t.Fatalf("report = %+v, want seq 12 / 3 entries", rep)
	}

	// And the served block compares it against the hub's own counter, which is
	// what turns a bare number into an answer.
	block := s.revocationReportBlock(ctx, dev)
	if block["reported"] != true {
		t.Fatalf("served block says not reported: %v", block)
	}
	if block["up_to_date"] != true {
		t.Errorf("up_to_date = %v — the hub has revoked nothing, so a gate at 12 is ahead, "+
			"and ahead is not behind", block["up_to_date"])
	}
	if _, ok := block["hub_seq"]; !ok {
		t.Error("the block carries no hub_seq, so a reported number cannot be judged")
	}
}

// A controller that has told us nothing must be SAID to have told us nothing,
// with its own wording — not rendered as a gate holding an empty list.
func TestTheServedBlockDistinguishesSilenceFromAnEmptyList(t *testing.T) {
	s, ctx, dev := reportFixture(t)

	silent := s.revocationReportBlock(ctx, dev)
	if silent["reported"] != false {
		t.Fatalf("a controller that reported nothing reads as reported: %v", silent)
	}
	if silent["detail"] == nil || silent["detail"] == "" {
		t.Error("silence is reported with no explanation, so an operator cannot tell it " +
			"from a confirmed-empty list")
	}
	if _, present := silent["seq"]; present {
		t.Error("a block for a silent controller carries a seq — there is no number to show")
	}

	s.handleControllerConfigReport(ctx, dev, report(t, `,"revocation":{"seq":0,"entries":0}`))
	confirmed := s.revocationReportBlock(ctx, dev)
	if confirmed["reported"] != true {
		t.Fatalf("a confirmed-empty list reads as silence: %v", confirmed)
	}
	if confirmed["seq"] != int64(0) {
		t.Errorf("seq = %v, want 0", confirmed["seq"])
	}
}
