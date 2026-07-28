package httpapi

import (
	"context"
	"strings"
	"testing"

	"github.com/vul-os/aql/hub/internal/store"
)

// The ceremony over a real inbound webhook.
//
// These run through waPost, so they exercise the actual thing that was
// missing: a stranger's message reaching the redemption path at all. The
// store tests prove the binding; these prove the wiring, which is the half
// that has historically been absent in this repo — a correct, tested store
// method nothing ever called is exactly how the chat rails ended up inert.

// A number nobody has linked. It must be able to complete the ceremony, which
// means reaching this code path BEFORE the membership check that would
// otherwise answer "you have no access".
const unlinkedRaw = "27009997777"
const unlinkedE164 = "+27009997777"

func TestLinkCodeOverWhatsAppVerifiesTheNumber(t *testing.T) {
	e := setupChannels(t, permissiveRL())
	ctx := context.Background()

	code, err := e.st.MintPhoneLinkCode(ctx, e.ownID, unlinkedE164)
	if err != nil {
		t.Fatal(err)
	}

	rec := waPost(e.h, waTextMsg(unlinkedRaw, "wamid.link1", code.Code, waPhoneID))
	if rec.Code != 200 {
		t.Fatalf("code: %d", rec.Code)
	}
	sent := e.wa.all()
	if len(sent) != 1 || !strings.Contains(sent[0].body, "linked") {
		t.Fatalf("link reply: %+v", sent)
	}

	linked, verified, err := e.st.PhoneVerified(ctx, e.ownID, unlinkedE164)
	if err != nil {
		t.Fatal(err)
	}
	if !linked || !verified {
		t.Fatalf("after the webhook linked=%v verified=%v; the rails need both", linked, verified)
	}
}

// The reachability guard. Before the link code is recognised, an unlinked
// number gets the signup prompt — so if the redemption were wired in AFTER
// the membership check, this is the reply a linking member would receive and
// the ceremony could never complete.
func TestLinkCodeIsReachableBeforeTheMembershipCheck(t *testing.T) {
	e := setupChannels(t, permissiveRL())
	ctx := context.Background()

	// Confirm the branch this has to beat is really there.
	rec := waPost(e.h, waTextMsg(unlinkedRaw, "wamid.pre", "hi", waPhoneID))
	if rec.Code != 200 {
		t.Fatalf("code: %d", rec.Code)
	}
	pre := e.wa.all()
	if len(pre) != 1 || !strings.Contains(pre[0].body, "isn't linked") {
		t.Fatalf("expected the unlinked prompt first: %+v", pre)
	}

	code, err := e.st.MintPhoneLinkCode(ctx, e.ownID, unlinkedE164)
	if err != nil {
		t.Fatal(err)
	}
	rec = waPost(e.h, waTextMsg(unlinkedRaw, "wamid.post", code.Code, waPhoneID))
	if rec.Code != 200 {
		t.Fatalf("code: %d", rec.Code)
	}
	all := e.wa.all()
	last := all[len(all)-1]
	if strings.Contains(last.body, "isn't linked") {
		t.Fatal("the link code was routed as an ordinary message; redemption must run first")
	}
	if !strings.Contains(last.body, "linked") {
		t.Fatalf("link reply: %q", last.body)
	}
}

// A code minted for someone else's number, sent from the attacker's own
// handset, over the real webhook.
func TestLinkCodeForAnotherNumberIsRefusedOverWhatsApp(t *testing.T) {
	e := setupChannels(t, permissiveRL())
	ctx := context.Background()

	// Minted against the OWNER's already-verified number, redeemed from a
	// stranger's handset.
	code, err := e.st.MintPhoneLinkCode(ctx, e.ownID, testPhone)
	if err != nil {
		t.Fatal(err)
	}
	rec := waPost(e.h, waTextMsg(unlinkedRaw, "wamid.steal", code.Code, waPhoneID))
	if rec.Code != 200 {
		t.Fatalf("code: %d", rec.Code)
	}
	sent := e.wa.all()
	if len(sent) != 1 || !strings.Contains(sent[0].body, "not valid") {
		t.Fatalf("expected a uniform refusal: %+v", sent)
	}

	linked, verified, err := e.st.PhoneVerified(ctx, e.ownID, unlinkedE164)
	if err != nil {
		t.Fatal(err)
	}
	if linked || verified {
		t.Fatal("the stranger's number was verified by a code minted for another")
	}
}

// Ordinary chatter must not be treated as a guess. If it were, a chatty
// member could burn the attempts on a code they are actively trying to use.
func TestOrdinaryMessagesAreNotLinkAttempts(t *testing.T) {
	e := setupChannels(t, permissiveRL())
	ctx := context.Background()

	code, err := e.st.MintPhoneLinkCode(ctx, e.ownID, unlinkedE164)
	if err != nil {
		t.Fatal(err)
	}
	for _, body := range []string{"hi", "open", "AB23CD", "what is my code"} {
		waPost(e.h, waTextMsg(unlinkedRaw, "wamid."+body, body, waPhoneID))
	}

	var attempts int
	if err := e.st.DB().QueryRowContext(ctx,
		`SELECT attempts FROM phone_link_codes WHERE id = ?`, code.ID).Scan(&attempts); err != nil {
		t.Fatal(err)
	}
	if attempts != 0 {
		t.Fatalf("ordinary messages burned %d attempts against a live code", attempts)
	}
	// And the code still works afterwards.
	if _, err := e.st.RedeemPhoneLinkCode(ctx, unlinkedE164, code.Code); err != nil {
		t.Fatalf("the code was damaged by unrelated chatter: %v", err)
	}
}

// A gate command must never be swallowed by the link parser. This is the
// failure that would be reported as "the bot stopped opening my gate".
func TestGateCommandsStillWorkForLinkedMembers(t *testing.T) {
	e := setupChannels(t, permissiveRL())

	rec := waPost(e.h, waTextMsg(testPhoneRaw, "wamid.open1", "open", waPhoneID))
	if rec.Code != 200 {
		t.Fatalf("code: %d", rec.Code)
	}
	sent := e.wa.all()
	if len(sent) == 0 {
		t.Fatal("no reply to a gate command")
	}
	for _, m := range sent {
		if strings.Contains(m.body, "link code") {
			t.Fatalf("a gate command was parsed as a link attempt: %q", m.body)
		}
	}
}

var _ = store.CodePrefix
