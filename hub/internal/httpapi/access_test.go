package httpapi

import (
	"testing"

	"github.com/vul-os/aql/hub/internal/store"
)

// movement_m is null, because nothing measures distance.
//
// It was a literal 0 for a long time, defended in accessPointJSON's own comment
// as "what the hub actually knows". The hub does not know a gate moved zero
// metres — it knows nothing about how far anything moved, and zero is a
// measurement. Ten lines below it in the same function, the maintenance block
// sends null for the same quantity and explains exactly why.
//
// The console showed the consequence: "Movement 0 m" on the devices page, a
// fabricated reading rendered as a measured one.
//
// The KEY must stay present. Dropping it would be the silent shape change the
// old comment feared, and a client reading `meter.movement_m` should still find
// the field — carrying null, which is the answer.
func TestMovementIsNullRatherThanAFabricatedZero(t *testing.T) {
	d := store.AccessPointDetail{
		ID: "ap-1", LocationID: "loc-1", Name: "Gate", Kind: "gate",
		TotalOpens: 3, TotalCloses: 2,
	}
	out := accessPointJSON(d, store.MaintenanceSummary{})

	meter, ok := out["meter"].(map[string]any)
	if !ok {
		t.Fatalf("no meter block: %#v", out["meter"])
	}
	v, present := meter["movement_m"]
	if !present {
		t.Fatal("movement_m is missing entirely — clients parse this field; it must be " +
			"present and null, not absent")
	}
	if v != nil {
		t.Errorf("movement_m = %#v, want nil: nothing measures distance, and a number "+
			"here is a measurement the hub cannot make", v)
	}

	// The counts beside it ARE derived from access_logs, so they are real and
	// must not be nulled by a careless sweep of this block.
	if meter["total_opens"] != 3 || meter["total_closes"] != 2 {
		t.Errorf("the real counters were changed too: opens=%#v closes=%#v",
			meter["total_opens"], meter["total_closes"])
	}
}
