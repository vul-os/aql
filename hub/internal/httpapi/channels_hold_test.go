package httpapi

// "Hold the gate open" over a chat rail, end to end.
//
// The verb machinery is unit-tested in internal/channels. This covers the part
// that only shows up once a real message goes through a real handler: that a
// hold actually reaches the open path as `hold`, that it is recorded as one,
// and — the part worth being careful about — that it does NOT quietly become
// an open along the way.

import (
	"context"
	"strings"
	"testing"

	"github.com/vul-os/aql/hub/internal/channels"
)

// successCommands counts audit rows for one command from one source.
func successCommands(t *testing.T, e *chEnv, command, source string) int {
	t.Helper()
	logs, err := e.st.AccessLogsByAccount(context.Background(), e.acct, 100)
	if err != nil {
		t.Fatal(err)
	}
	n := 0
	for _, l := range logs {
		if l.Success && l.Command == command && l.Source == source {
			n++
		}
	}
	return n
}

func TestWhatsAppHoldReachesTheOpenPathAsAHold(t *testing.T) {
	e := setupChannels(t, permissiveRL())
	createAP(t, e.h, e.ownerA, e.loc, "Side door")

	waPost(e.h, waTextMsg(testPhoneRaw, "wamid.hold1", "hold the side door open", waPhoneID))

	if n := successCommands(t, e, "hold", channels.KindWhatsApp); n != 1 {
		t.Fatalf(`"hold the side door open" produced %d hold(s).

The phrase contains the word "open", so a verb matcher that checks open first
resolves it to a pulse — and the gate swings shut in the face of whoever was
told it would stay open.`, n)
	}
	// And it must NOT have been recorded as an open. A hold logged as an open
	// loses the one fact that distinguishes it.
	if n := successCommands(t, e, "open", channels.KindWhatsApp); n != 0 {
		t.Errorf("the hold was also recorded as an open (%d)", n)
	}
}

// The reply has to say what actually happened. "Opening Side door" after a
// hold would be a promise the gate does not keep.
func TestTheHoldReplyDoesNotSayOpening(t *testing.T) {
	e := setupChannels(t, permissiveRL())
	createAP(t, e.h, e.ownerA, e.loc, "Side door")

	waPost(e.h, waTextMsg(testPhoneRaw, "wamid.hold2", "hold the side door open", waPhoneID))
	sent := e.wa.all()
	if len(sent) == 0 {
		t.Fatal("no reply was sent")
	}
	body := sent[0].body
	if strings.Contains(body, "Opening ") {
		t.Errorf(`the hold was answered with %q.

That tells the member the gate will pulse when it will in fact stand open, or
the reverse — either way the reply describes a different action from the one
taken.`, body)
	}
}

// A plain open must still be a plain open. The hold branch sits directly above
// it in the matcher, so this is the regression direction.
func TestAPlainOpenIsUnaffectedByTheHoldVerb(t *testing.T) {
	e := setupChannels(t, permissiveRL())
	createAP(t, e.h, e.ownerA, e.loc, "Side door")

	waPost(e.h, waTextMsg(testPhoneRaw, "wamid.open1", "open the side door", waPhoneID))
	if n := e.successOpens(t, channels.KindWhatsApp); n != 1 {
		t.Fatalf("a plain open produced %d opens", n)
	}
	if n := successCommands(t, e, "hold", channels.KindWhatsApp); n != 0 {
		t.Errorf("a plain open was recorded as a hold (%d)", n)
	}
}

// A close still wins over everything, including a body that also says hold.
func TestCloseStillWinsOverHold(t *testing.T) {
	e := setupChannels(t, permissiveRL())
	createAP(t, e.h, e.ownerA, e.loc, "Side door")

	waPost(e.h, waTextMsg(testPhoneRaw, "wamid.mix",
		"close the side door, don't hold it open", waPhoneID))
	if n := successCommands(t, e, "close", channels.KindWhatsApp); n != 1 {
		t.Fatalf("a body naming both did not close: %d", n)
	}
	if n := successCommands(t, e, "hold", channels.KindWhatsApp); n != 0 {
		t.Errorf("a body naming both was held open (%d) — of the readings available, the "+
			"one that leaves the gate shut is the one to guess", n)
	}
}
