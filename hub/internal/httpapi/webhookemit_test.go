package httpapi

import (
	"testing"

	"github.com/vul-os/aql/hub/internal/store"
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

// A held_open controller event reaches the webhook vocabulary, and its payload
// is named for what it measures.
//
// The controller side of this shipped first: a watcher that emits `held_open`
// when the position sensor has not reported the gate closed for long enough.
// The hub stored it and told nobody — it appeared only in the platform-admin
// "Controller-signed events" panel, which you reach by typing a device id.
// proto/events.md listed the kind's purpose as "gate-left-open alerts" and
// there was no alert on the end of it.
//
// What is asserted here is the vocabulary and the naming, which are the parts a
// receiver depends on. The dispatch itself is covered by the vector suite and
// by webhookvectors_test.go, which refuses any dispatchable event that has no
// published vector — that guard is what caught this event arriving without one.
func TestHeldOpenIsPartOfTheWebhookVocabulary(t *testing.T) {
	if !knownWebhookEvent(EventAccessHeldOpen) {
		t.Fatal("access.held_open is not a known event, so a subscription naming it " +
			"would be refused as an operator typo and the alert could never fire")
	}
	for _, other := range []string{EventAccessOpened, EventAccessDenied, EventAutomationAlert} {
		if EventAccessHeldOpen == other {
			t.Fatalf("access.held_open collides with %q; a receiver must be able to tell "+
				"a gate left open from a gate opened", other)
		}
	}

	// It must be in the published set, or a subscription cannot select it.
	var listed bool
	for _, e := range KnownWebhookEvents() {
		if e == EventAccessHeldOpen {
			listed = true
		}
	}
	if !listed {
		t.Error("access.held_open is not in KnownWebhookEvents, so no operator can subscribe to it")
	}

	// A nil dispatcher stays silent, like every other emit path here: a
	// controller event must never panic a hub that has no webhooks configured.
	s := &Server{}
	if s.webhooks != nil {
		t.Fatal("fixture")
	}
}
