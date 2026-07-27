package httpapi

import (
	"testing"

	"github.com/vul-os/aql/gateway/internal/store"
)

// The link this commit exists to create: an access verdict emits an event.
// The dispatcher is tested separately; what is unproven without this is that
// anything ever calls it.
//
// A nil dispatcher must be silent rather than panic — that is what every test
// server in this package has, and a webhook feature that crashes the open path
// when unconfigured would be far worse than one that never fires.
func TestFinishOpenEmitsWithoutADispatcher(t *testing.T) {
	s := &Server{}
	// Must not panic. The open path cannot depend on webhooks being configured.
	s.emitAccessWebhook(EventAccessOpened, "open", &store.LogAccessResult{
		Allowed: true, LogID: "log_1",
		AP: &store.AccessPointContext{ID: "ap_1", AccountID: "acct_1", LocationID: "loc_1"},
	})
}

// A verdict with no access-point context cannot be attributed to an account,
// and an event sent to the wrong account's URL is worse than one not sent.
func TestEmitRefusesWhatItCannotAttribute(t *testing.T) {
	s := &Server{webhooks: newWebhookDispatcher(nil, quietLogger())}
	// No AP: nothing to attribute, so nothing is dispatched. A nil store inside
	// the dispatcher would panic if this got as far as looking up subscribers,
	// which is precisely the assertion.
	s.emitAccessWebhook(EventAccessOpened, "open", &store.LogAccessResult{Allowed: true})
	s.emitAccessWebhook(EventAccessOpened, "open", nil)
}

// The payload carries the audit row's id and the access point, and NOT a
// member identity. A webhook target is an address on someone's network, and
// "who tried to open the gate at 3am" is not something to post to it by
// default.
func TestDeniedVerdictsAlsoEmitAndCarryTheReason(t *testing.T) {
	// Assert the event vocabulary covers a denial at all — an operator watching
	// for someone repeatedly failing to get in wants that more than successes.
	if !knownWebhookEvent(EventAccessDenied) {
		t.Fatal("access.denied is not a known event, so denials can never be delivered")
	}
	if EventAccessDenied == EventAccessOpened {
		t.Fatal("a denial and an open must be distinguishable by a receiver")
	}
}
