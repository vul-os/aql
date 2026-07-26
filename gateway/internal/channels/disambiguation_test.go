package channels

// Regression tests for the three fail-open defects in the free-text/selection
// path (docs/CHAT-COMMANDS.md §2.2a, §2.2c, §2.2d):
//
//   1. first-substring-match silently opened the wrong gate,
//   2. an unprefixed selection id defaulted to "open"  (channels_test.go),
//   3. Slack's picker was uncapped and all three truncated silently.
//
// Every test here fails against the pre-fix code.

import (
	"math/rand"
	"sort"
	"strings"
	"testing"

	"github.com/vul-os/aql/gateway/internal/store"
)

const testPortal = "https://gate.example/"

func ap(id, name, loc string) store.AvailableAP {
	return store.AvailableAP{APID: id, APName: name, LocID: "loc-" + loc, LocName: loc, Type: store.APMember}
}

func apIDs(aps []store.AvailableAP) []string {
	out := make([]string, 0, len(aps))
	for _, a := range aps {
		out = append(out, a.APID)
	}
	sort.Strings(out)
	return out
}

// ---------------------------------------------------------------------------
// Defect 1 — word boundaries, and ambiguity that asks instead of guessing
// ---------------------------------------------------------------------------

// TestGateAmbiguityFallsThroughToPicker is the exact shipped-fleet case: a
// fleet holding both `Gate` and `Front Gate`. "open the front gate" mentions
// both names, so it resolves to NEITHER — pre-fix it opened whichever came
// first in the slice.
func TestGateAmbiguityFallsThroughToPicker(t *testing.T) {
	gates := []store.AvailableAP{ap("ap-gate", "Gate", "Home"), ap("ap-front", "Front Gate", "Home")}
	body := NormalizeText("open the front gate")

	for _, order := range [][]store.AvailableAP{gates, {gates[1], gates[0]}} {
		m := FindMentionedGate(body, order)
		if !m.Ambiguous() {
			t.Fatalf("outcome %s (AP %q) — two gates were named, nothing may resolve", m.Outcome, m.AP.APID)
		}
		if m.Unique() {
			t.Fatal("Unique() must be false when ambiguous")
		}
		if m.AP.APID != "" {
			t.Errorf("ambiguous match leaked a target: %q", m.AP.APID)
		}
		if got := apIDs(m.Candidates); len(got) != 2 || got[0] != "ap-front" || got[1] != "ap-gate" {
			t.Errorf("candidates for the picker: %v", got)
		}
	}
}

// TestGateMatchIsOrderIndependent shuffles the candidate slice: the outcome,
// the resolved target and the candidate set must never depend on the order the
// store returned rows in.
func TestGateMatchIsOrderIndependent(t *testing.T) {
	base := []store.AvailableAP{
		ap("ap-gate", "Gate", "Home"),
		ap("ap-front", "Front Gate", "Home"),
		ap("ap-side", "Side Door", "Home"),
		ap("ap-bin", "Bin Store", "Home"),
	}
	cases := []struct {
		body    string
		want    MatchOutcome
		wantAP  string
		wantIDs []string
	}{
		{"open the front gate", MatchAmbiguous, "", []string{"ap-front", "ap-gate"}},
		{"open the side door", MatchUnique, "ap-side", []string{"ap-side"}},
		{"open the bin store gate", MatchAmbiguous, "", []string{"ap-bin", "ap-gate"}},
		{"open the barn", MatchNone, "", nil},
	}
	rng := rand.New(rand.NewSource(20260726))
	for _, tc := range cases {
		body := NormalizeText(tc.body)
		for i := 0; i < 200; i++ {
			shuffled := append([]store.AvailableAP(nil), base...)
			rng.Shuffle(len(shuffled), func(a, b int) { shuffled[a], shuffled[b] = shuffled[b], shuffled[a] })
			m := FindMentionedGate(body, shuffled)
			if m.Outcome != tc.want {
				t.Fatalf("%q order %v → outcome %s, want %s", tc.body, apIDs(shuffled), m.Outcome, tc.want)
			}
			if m.AP.APID != tc.wantAP {
				t.Fatalf("%q order %v → AP %q, want %q", tc.body, apIDs(shuffled), m.AP.APID, tc.wantAP)
			}
			if got := apIDs(m.Candidates); strings.Join(got, ",") != strings.Join(tc.wantIDs, ",") {
				t.Fatalf("%q → candidates %v, want %v", tc.body, got, tc.wantIDs)
			}
		}
	}
}

// TestNameMatchRespectsWordBoundaries: a name buried inside a longer word is
// not a mention. Pre-fix these were bare strings.Contains hits.
func TestNameMatchRespectsWordBoundaries(t *testing.T) {
	cases := []struct {
		body, name string
		want       bool
	}{
		{"open the gate", "gate", true},
		{"open the gate.", "gate", true},
		{"open gate", "Gate", true},           // case-folded
		{"open the front gate", "gate", true}, // still a whole word inside a phrase
		{"open the front gate", "front gate", true},
		{"open the gate-a", "gate-a", true},
		{"open gate 3", "gate 3", true},
		{"open gate 3", "gate", true},
		// The fail-opens: name is only a substring of a longer word.
		{"open the gatehouse", "gate", false},
		{"open the floodgate", "gate", false},
		{"open the gate", "ate", false},
		{"open the gate", "at", false},
		{"open the gate3", "gate", false},
		// Nothing at all.
		{"open the barn", "gate", false},
		{"open the gate", "", false},
		{"", "gate", false},
	}
	for _, tc := range cases {
		if got := textIncludesName(tc.body, tc.name); got != tc.want {
			t.Errorf("textIncludesName(%q, %q) = %v, want %v", tc.body, tc.name, got, tc.want)
		}
	}
}

// TestGateMatchUniqueAndNone covers the two outcomes that behave as they did
// before: one name mentioned resolves, no name mentioned resolves nothing.
func TestGateMatchUniqueAndNone(t *testing.T) {
	gates := []store.AvailableAP{ap("ap1", "Main gate", "Home"), ap("ap2", "Side door", "Home")}

	m := FindMentionedGate(NormalizeText("please open the side door"), gates)
	if !m.Unique() || m.AP.APID != "ap2" {
		t.Fatalf("unique mention: %s %q", m.Outcome, m.AP.APID)
	}
	m = FindMentionedGate(NormalizeText("open"), gates)
	if m.Outcome != MatchNone || m.AP.APID != "" || len(m.Candidates) != 0 {
		t.Fatalf("no mention must stay MatchNone: %s %+v", m.Outcome, m)
	}
	if m.Unique() || m.Ambiguous() {
		t.Fatal("MatchNone reports neither unique nor ambiguous")
	}
	// Empty candidate list is not an ambiguity either.
	if m := FindMentionedGate(NormalizeText("open the gate"), nil); m.Outcome != MatchNone {
		t.Fatalf("empty fleet: %s", m.Outcome)
	}
}

// TestGateMatchDedupesSameAccessPoint: one physical gate reachable twice (a
// member grant and a visitor grant) is one target, not an ambiguity.
func TestGateMatchDedupesSameAccessPoint(t *testing.T) {
	dup := ap("ap1", "Main gate", "Home")
	dup.Type = store.APVisitor
	gates := []store.AvailableAP{dup, ap("ap1", "Main gate", "Home")}
	m := FindMentionedGate(NormalizeText("open the main gate"), gates)
	if !m.Unique() || m.AP.APID != "ap1" {
		t.Fatalf("same AP twice must be one target: %s %q", m.Outcome, m.AP.APID)
	}
	if m.AP.Type != store.APVisitor {
		t.Errorf("first row for the AP should win (visitor grants sort first): %v", m.AP.Type)
	}
}

// TestLocationMatchOutcomes: the location-narrowing stage has the same
// three-state contract; two locations named narrows to neither.
func TestLocationMatchOutcomes(t *testing.T) {
	locs := []store.LinkedLocation{{ID: "l1", Name: "Home"}, {ID: "l2", Name: "Home Office"}, {ID: "l3", Name: "Depot"}}

	if m := FindMentionedLocation(NormalizeText("open the depot gate"), locs); !m.Unique() || m.Location.ID != "l3" {
		t.Fatalf("unique location: %s %q", m.Outcome, m.Location.ID)
	}
	m := FindMentionedLocation(NormalizeText("open the home office gate"), locs)
	if !m.Ambiguous() {
		t.Fatalf("`home` and `home office` both named → %s (%q)", m.Outcome, m.Location.ID)
	}
	if m.Location.ID != "" {
		t.Errorf("ambiguous location leaked a target: %q", m.Location.ID)
	}
	// Order-independent, both ways round.
	rev := []store.LinkedLocation{locs[1], locs[0], locs[2]}
	if m2 := FindMentionedLocation(NormalizeText("open the home office gate"), rev); m2.Outcome != m.Outcome {
		t.Fatalf("location outcome depends on order: %s vs %s", m.Outcome, m2.Outcome)
	}
	if m := FindMentionedLocation(NormalizeText("open"), locs); m.Outcome != MatchNone {
		t.Fatalf("no mention: %s", m.Outcome)
	}
}

// TestPushAmbiguousGateMenuAsksAndActuatesNothing checks the reply the
// ambiguous path renders: it names the ambiguity, lists only the matches, and
// every row is an ordinary open_ap selection (re-authorized when tapped).
func TestPushAmbiguousGateMenuAsksAndActuatesNothing(t *testing.T) {
	cands := []store.AvailableAP{ap("ap-gate", "Gate", "Home"), ap("ap-front", "Front Gate", "Home")}

	r := PushAmbiguousGateMenu(VerbOpen, cands, testPortal)
	if r.Interactive == nil || r.Interactive.Type != "list" {
		t.Fatalf("ambiguity must render a picker: %+v", r)
	}
	if !strings.Contains(r.Interactive.Body.Text, "more than one") || !strings.Contains(r.Interactive.Body.Text, "haven't opened") {
		t.Errorf("body must say plainly that nothing opened: %q", r.Interactive.Body.Text)
	}
	rows := r.Interactive.Action.Sections[0].Rows
	if len(rows) != 2 || rows[0].ID != "open_ap:ap-gate" || rows[1].ID != "open_ap:ap-front" {
		t.Errorf("rows: %+v", rows)
	}

	// An unresolved CLOSE must not come back as a row that opens.
	rc := PushAmbiguousGateMenu(VerbClose, cands, testPortal)
	if !strings.Contains(rc.Interactive.Body.Text, "haven't closed") {
		t.Errorf("close body: %q", rc.Interactive.Body.Text)
	}
	for _, row := range rc.Interactive.Action.Sections[0].Rows {
		if !strings.HasPrefix(row.ID, "close_ap:") {
			t.Errorf("close ambiguity offered a row that opens: %+v", row)
		}
	}
}

// ---------------------------------------------------------------------------
// Defect 3 — caps that hold, and truncation that says so
// ---------------------------------------------------------------------------

func manyGates(n int) []store.AvailableAP {
	out := make([]store.AvailableAP, n)
	for i := range out {
		out[i] = ap("ap"+itoa(int64(i)), "Gate "+itoa(int64(i)), "Home")
	}
	return out
}

// TestSlackAccessBlocksStaysUnderCeiling: pre-fix, 200 gates rendered 201
// blocks and Slack rejected the whole message — the member got nothing.
func TestSlackAccessBlocksStaysUnderCeiling(t *testing.T) {
	for _, n := range []int{1, 9, 10, 11, 50, 200, 1000} {
		blocks := AccessBlocks("Ada", manyGates(n), testPortal)
		if len(blocks) > SlackMaxBlocks {
			t.Fatalf("%d gates → %d blocks, over the %d ceiling", n, len(blocks), SlackMaxBlocks)
		}
		gateBlocks := 0
		for _, b := range blocks {
			if acc, ok := b["accessory"]; ok {
				if m, ok := acc.(map[string]any); ok && strings.HasPrefix(m["action_id"].(string), "open_gate:") {
					gateBlocks++
				}
			}
		}
		want := n
		if want > PickerCapacity {
			want = PickerCapacity
		}
		if gateBlocks != want {
			t.Errorf("%d gates → %d gate blocks, want %d", n, gateBlocks, want)
		}
	}
}

// TestEveryPickerDisclosesTruncation: WhatsApp, Telegram, Slack and DMTAP all
// cap their lists; none of them may drop rows silently.
func TestEveryPickerDisclosesTruncation(t *testing.T) {
	gates := manyGates(34)

	wa := PushGateMenu(VerbOpen, "Home", gates, testPortal)
	if got := wa.Interactive.Body.Text; !strings.Contains(got, "Showing 10 of 34") || !strings.Contains(got, "https://gate.example/app") {
		t.Errorf("whatsapp gate menu: %q", got)
	}
	if n := len(wa.Interactive.Action.Sections[0].Rows); n != PickerCapacity {
		t.Errorf("whatsapp rows: %d", n)
	}

	amb := PushAmbiguousGateMenu(VerbOpen, gates, testPortal)
	if got := amb.Interactive.Body.Text; !strings.Contains(got, "Showing 10 of 34") {
		t.Errorf("whatsapp ambiguity menu: %q", got)
	}

	locs := make([]store.LinkedLocation, 12)
	for i := range locs {
		locs[i] = store.LinkedLocation{ID: "l" + itoa(int64(i)), Name: "Site " + itoa(int64(i))}
	}
	lm := PushLocationMenu(VerbOpen, locs, testPortal)
	if got := lm.Interactive.Body.Text; !strings.Contains(got, "Showing 10 of 12") {
		t.Errorf("whatsapp location menu: %q", got)
	}

	body, kb := TelegramGatePicker("Which gate would you like to open?", gates, testPortal)
	if len(kb.Rows) != PickerCapacity {
		t.Errorf("telegram rows: %d", len(kb.Rows))
	}
	if !strings.Contains(body, "Which gate") || !strings.Contains(body, "Showing 10 of 34") {
		t.Errorf("telegram body: %q", body)
	}

	blocks := AccessBlocks("Ada", gates, testPortal)
	last := blocks[len(blocks)-1]
	els, _ := last["elements"].([]any)
	if last["type"] != "context" || len(els) != 1 || !strings.Contains(els[0].(map[string]any)["text"].(string), "Showing 10 of 34") {
		t.Errorf("slack truncation notice: %+v", last)
	}

	if got := DMTAPGateList(gates, testPortal); !strings.Contains(got, "Showing 10 of 34") || strings.Count(got, "\n") != 11 {
		t.Errorf("dmtap list: %q", got)
	}
}

// TestPickersStaySilentWhenComplete: the disclosure appears only when rows
// were actually dropped — a complete list must read exactly as before.
func TestPickersStaySilentWhenComplete(t *testing.T) {
	gates := manyGates(PickerCapacity)

	if got := PushGateMenu(VerbOpen, "Home", gates, testPortal).Interactive.Body.Text; got != "Welcome to Home. Which gate would you like to open?" {
		t.Errorf("whatsapp body changed for a complete list: %q", got)
	}
	body, _ := TelegramGatePicker("Which gate would you like to open?", gates, testPortal)
	if body != "Which gate would you like to open?" {
		t.Errorf("telegram body changed for a complete list: %q", body)
	}
	for _, b := range AccessBlocks("Ada", gates, testPortal) {
		if b["type"] == "context" {
			t.Errorf("slack added a notice for a complete list: %+v", b)
		}
	}
	if strings.Contains(DMTAPGateList(gates, testPortal), "Showing") {
		t.Error("dmtap added a notice for a complete list")
	}
}

// TestTruncationNoticeCopy pins the honest-copy shape, including the
// no-public-URL fallback (a LAN-only gateway still has to say it truncated).
func TestTruncationNoticeCopy(t *testing.T) {
	if got := TruncationNotice(10, 34, testPortal); got != "Showing 10 of 34 — this list is incomplete. See all of them here: https://gate.example/app" {
		t.Errorf("notice: %q", got)
	}
	if got := TruncationNotice(10, 34, ""); got != "Showing 10 of 34 — this list is incomplete. See all of them in the web portal." {
		t.Errorf("notice without a portal URL: %q", got)
	}
	if got := TruncationNotice(10, 10, testPortal); got != "" {
		t.Errorf("complete list must produce no notice: %q", got)
	}
	if got := TruncationNotice(10, 3, testPortal); got != "" {
		t.Errorf("shown > total must produce no notice: %q", got)
	}
}
