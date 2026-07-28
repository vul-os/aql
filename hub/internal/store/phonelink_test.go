package store

import (
	"context"
	"errors"
	"strings"
	"testing"
)

// Phone linking (docs/PHONE-LINKING.md).
//
// The property everything else rests on: a code is spendable only by the
// number it was minted for. Minting deliberately requires no proof of
// ownership, so if that binding were missing, anyone could claim any number.

type linkFixture struct {
	s     *Store
	alice *User
	bob   *User
}

func newLinkFixture(t *testing.T) *linkFixture {
	t.Helper()
	s := openTest(t)
	ctx := context.Background()
	a, err := s.CreateUser(ctx, "alice@link.com", "h", "Alice", "")
	if err != nil {
		t.Fatal(err)
	}
	b, err := s.CreateUser(ctx, "bob@link.com", "h", "Bob", "")
	if err != nil {
		t.Fatal(err)
	}
	return &linkFixture{s: s, alice: a, bob: b}
}

const (
	alicePhone = "+27820000001"
	bobPhone   = "+27820000002"
)

func TestLinkCodeVerifiesTheNumberThatSendsIt(t *testing.T) {
	f := newLinkFixture(t)
	ctx := context.Background()

	code, err := f.s.MintPhoneLinkCode(ctx, f.alice.ID, alicePhone)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(code.Code, CodePrefix) {
		t.Errorf("code %q lacks the %q namespace; the chat parser needs it to "+
			"tell a code from a gate command", code.Code, CodePrefix)
	}

	userID, err := f.s.RedeemPhoneLinkCode(ctx, alicePhone, code.Code)
	if err != nil {
		t.Fatalf("a code sent from its own number was refused: %v", err)
	}
	if userID != f.alice.ID {
		t.Fatalf("redeemed onto %q, want %q", userID, f.alice.ID)
	}

	// The whole point: the chat rails can now see her.
	linked, verified, err := f.s.PhoneVerified(ctx, f.alice.ID, alicePhone)
	if err != nil {
		t.Fatal(err)
	}
	if !linked || !verified {
		t.Fatalf("after redemption linked=%v verified=%v; the rails require both", linked, verified)
	}
}

// THE security test. Mallory mints a code against a number she does not
// control and sends it from her own handset. If this succeeded she would have
// verified someone else's number onto her profile — the squatting attack that
// made invite-accept stop auto-verifying in the first place.
func TestACodeCannotBeSpentByADifferentNumber(t *testing.T) {
	f := newLinkFixture(t)
	ctx := context.Background()

	code, err := f.s.MintPhoneLinkCode(ctx, f.bob.ID, alicePhone) // Bob targets Alice's number
	if err != nil {
		t.Fatal(err)
	}

	if _, err := f.s.RedeemPhoneLinkCode(ctx, bobPhone, code.Code); !errors.Is(err, ErrPhoneLinkNotFound) {
		t.Fatalf("a code minted for %s was spendable from %s (err=%v) — anyone could claim any number",
			alicePhone, bobPhone, err)
	}

	linked, verified, err := f.s.PhoneVerified(ctx, f.bob.ID, alicePhone)
	if err != nil {
		t.Fatal(err)
	}
	if linked || verified {
		t.Fatal("the attacker ended up holding the victim's number")
	}
}

// The same code, sent by the number it names, still works — so the test above
// is proving the binding rather than a code that never worked at all.
func TestTheTargetedNumberCanStillRedeemACodeMintedByAnother(t *testing.T) {
	f := newLinkFixture(t)
	ctx := context.Background()

	code, err := f.s.MintPhoneLinkCode(ctx, f.bob.ID, alicePhone)
	if err != nil {
		t.Fatal(err)
	}
	// Alice's handset sends it. It links to BOB's profile, because that is who
	// minted it — which is why the console must never show a code for a number
	// the user does not intend to link.
	userID, err := f.s.RedeemPhoneLinkCode(ctx, alicePhone, code.Code)
	if err != nil {
		t.Fatalf("the targeted number could not redeem: %v", err)
	}
	if userID != f.bob.ID {
		t.Fatalf("linked onto %q, want the minter %q", userID, f.bob.ID)
	}
}

func TestACodeIsSingleUse(t *testing.T) {
	f := newLinkFixture(t)
	ctx := context.Background()

	code, err := f.s.MintPhoneLinkCode(ctx, f.alice.ID, alicePhone)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.s.RedeemPhoneLinkCode(ctx, alicePhone, code.Code); err != nil {
		t.Fatal(err)
	}
	if _, err := f.s.RedeemPhoneLinkCode(ctx, alicePhone, code.Code); !errors.Is(err, ErrPhoneLinkNotFound) {
		t.Fatalf("a spent code was accepted again: %v", err)
	}
}

func TestAnExpiredCodeIsRefused(t *testing.T) {
	f := newLinkFixture(t)
	ctx := context.Background()

	code, err := f.s.MintPhoneLinkCode(ctx, f.alice.ID, alicePhone)
	if err != nil {
		t.Fatal(err)
	}
	// Age it past the TTL rather than sleeping for ten minutes.
	if _, err := f.s.db.ExecContext(ctx,
		`UPDATE phone_link_codes SET expires_at = ? WHERE id = ?`, now()-1, code.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.s.RedeemPhoneLinkCode(ctx, alicePhone, code.Code); !errors.Is(err, ErrPhoneLinkNotFound) {
		t.Fatalf("an expired code was accepted: %v", err)
	}
}

// Attempts are counted even on failures, and the count survives the failing
// transaction — otherwise the cap would be advisory.
func TestGuessingIsBounded(t *testing.T) {
	f := newLinkFixture(t)
	ctx := context.Background()

	code, err := f.s.MintPhoneLinkCode(ctx, f.alice.ID, alicePhone)
	if err != nil {
		t.Fatal(err)
	}
	// Burn the budget with wrong-number attempts against the real code.
	for i := 0; i < PhoneLinkMaxAttempts; i++ {
		if _, err := f.s.RedeemPhoneLinkCode(ctx, bobPhone, code.Code); !errors.Is(err, ErrPhoneLinkNotFound) {
			t.Fatalf("attempt %d: %v", i, err)
		}
	}
	// Now the rightful number tries — too late, the code is burnt.
	if _, err := f.s.RedeemPhoneLinkCode(ctx, alicePhone, code.Code); !errors.Is(err, ErrPhoneLinkNotFound) {
		t.Fatalf("the attempt cap did not hold: %v", err)
	}

	var attempts int
	if err := f.s.db.QueryRowContext(ctx,
		`SELECT attempts FROM phone_link_codes WHERE id = ?`, code.ID).Scan(&attempts); err != nil {
		t.Fatal(err)
	}
	if attempts <= PhoneLinkMaxAttempts {
		t.Errorf("attempts = %d; the counter is not being committed on failures", attempts)
	}
}

// One verified owner per number, enforced at mint time so the user is told
// before they go and message a bot, and again at redemption because the state
// can change in between.
func TestANumberVerifiedElsewhereFailsLoudly(t *testing.T) {
	f := newLinkFixture(t)
	ctx := context.Background()

	code, err := f.s.MintPhoneLinkCode(ctx, f.alice.ID, alicePhone)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.s.RedeemPhoneLinkCode(ctx, alicePhone, code.Code); err != nil {
		t.Fatal(err)
	}

	// Bob now tries to take the same number.
	if _, err := f.s.MintPhoneLinkCode(ctx, f.bob.ID, alicePhone); !errors.Is(err, ErrPhoneTakenByAnother) {
		t.Fatalf("minting against a taken number: %v, want ErrPhoneTakenByAnother", err)
	}
}

// The quota is per USER, not per phone — a per-phone limit would let an
// attacker exhaust a victim's budget by minting against their number.
func TestMintQuotaIsPerUserSoAVictimCannotBeLockedOut(t *testing.T) {
	f := newLinkFixture(t)
	ctx := context.Background()

	for i := 0; i < PhoneLinkMaxLivePerUser; i++ {
		if _, err := f.s.MintPhoneLinkCode(ctx, f.bob.ID, alicePhone); err != nil {
			t.Fatalf("mint %d: %v", i, err)
		}
	}
	// Bob is now out of budget.
	if _, err := f.s.MintPhoneLinkCode(ctx, f.bob.ID, alicePhone); !errors.Is(err, ErrPhoneLinkTooMany) {
		t.Fatalf("the per-user quota did not hold: %v", err)
	}
	// Alice, whose number he was targeting, is unaffected.
	if _, err := f.s.MintPhoneLinkCode(ctx, f.alice.ID, alicePhone); err != nil {
		t.Fatalf("the victim was locked out of linking her own number: %v", err)
	}
}

func TestLinkCodeRecognitionIsNarrow(t *testing.T) {
	cases := []struct {
		in   string
		want bool
		why  string
	}{
		{"LINK-AB23CD", true, "the canonical form"},
		{"link-ab23cd", true, "people retype these in whatever case"},
		{" LINK-AB23CD ", true, "chat clients add whitespace"},
		{"AB23CD", false, "bare six characters could be any word"},
		{"open", false, "a gate command must never be read as a code"},
		{"LINK-AB23C", false, "too short"},
		{"LINK-AB23CDE", false, "too long"},
		{"LINK-AB01CD", false, "0 and 1 are not in the alphabet"},
		{"", false, "empty"},
	}
	for _, c := range cases {
		if got := LooksLikeLinkCode(c.in); got != c.want {
			t.Errorf("LooksLikeLinkCode(%q) = %v, want %v — %s", c.in, got, c.want, c.why)
		}
	}
}

func TestUnlinkRemovesOnlyYourOwnNumber(t *testing.T) {
	f := newLinkFixture(t)
	ctx := context.Background()

	code, err := f.s.MintPhoneLinkCode(ctx, f.alice.ID, alicePhone)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.s.RedeemPhoneLinkCode(ctx, alicePhone, code.Code); err != nil {
		t.Fatal(err)
	}
	phones, err := f.s.PhonesForUser(ctx, f.alice.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(phones) != 1 || !phones[0].Verified {
		t.Fatalf("phones = %+v, want one verified row", phones)
	}

	// Bob cannot delete Alice's row, and cannot tell it from a missing one.
	if err := f.s.UnlinkPhone(ctx, f.bob.ID, phones[0].ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("another user unlinked her number: %v", err)
	}
	if err := f.s.UnlinkPhone(ctx, f.alice.ID, phones[0].ID); err != nil {
		t.Fatalf("she could not remove her own: %v", err)
	}
	phones, err = f.s.PhonesForUser(ctx, f.alice.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(phones) != 0 {
		t.Fatalf("phones = %+v after unlink", phones)
	}
}

// The commonest real journey, and the one the ceremony exists to serve: a
// member is invited with their number (which links it UNVERIFIED, because
// accepting an invite proves nothing about who holds the handset), and then
// verifies it themselves. The row must be FLIPPED, not duplicated — the
// unique index is on (profile_id, phone_e164), so a second insert would fail
// and a member who had been invited could never link.
func TestAnInviteLinkedNumberIsUpgradedInPlace(t *testing.T) {
	f := newLinkFixture(t)
	ctx := context.Background()

	// What AcceptInvite writes: linked, non-primary, verified_at NULL.
	if _, err := f.s.db.ExecContext(ctx,
		`INSERT INTO profile_phone_numbers (id, profile_id, phone_e164, is_primary, verified_at, created_at, updated_at)
		 VALUES (?, ?, ?, 0, NULL, ?, ?)`,
		NewID(), f.alice.ID, alicePhone, now(), now()); err != nil {
		t.Fatal(err)
	}
	linked, verified, err := f.s.PhoneVerified(ctx, f.alice.ID, alicePhone)
	if err != nil {
		t.Fatal(err)
	}
	if !linked || verified {
		t.Fatalf("fixture: linked=%v verified=%v, want linked-and-unverified", linked, verified)
	}

	code, err := f.s.MintPhoneLinkCode(ctx, f.alice.ID, alicePhone)
	if err != nil {
		t.Fatalf("minting for an already-linked unverified number: %v", err)
	}
	if _, err := f.s.RedeemPhoneLinkCode(ctx, alicePhone, code.Code); err != nil {
		t.Fatalf("redeeming for an invite-linked number: %v", err)
	}

	linked, verified, err = f.s.PhoneVerified(ctx, f.alice.ID, alicePhone)
	if err != nil {
		t.Fatal(err)
	}
	if !linked || !verified {
		t.Fatalf("after redemption linked=%v verified=%v", linked, verified)
	}
	phones, err := f.s.PhonesForUser(ctx, f.alice.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(phones) != 1 {
		t.Fatalf("the number was duplicated rather than upgraded: %+v", phones)
	}
}
