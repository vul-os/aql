package store

import (
	"context"
	"errors"
	"strings"
	"testing"
)

// Channel identity linking (migration 0020).
//
// The phone flow's security comes from a code naming the number that may
// spend it. This flow cannot do that — the sender's platform id is the thing
// being learned — so the code itself has to carry the security. These tests
// hold that line, because "shorten the code, it is annoying to type" is a
// change someone will propose and it would be a real weakening here while
// being harmless in the phone flow.

func newChannelFixture(t *testing.T) *linkFixture { return newLinkFixture(t) }

const tgAlice = "111111111"
const tgBob = "222222222"

func TestChannelCodeBindsWhoeverSendsIt(t *testing.T) {
	f := newChannelFixture(t)
	ctx := context.Background()

	code, err := f.s.MintChannelLinkCode(ctx, f.alice.ID, "telegram")
	if err != nil {
		t.Fatal(err)
	}
	userID, err := f.s.RedeemChannelLinkCode(ctx, "telegram", tgAlice, code.Code)
	if err != nil {
		t.Fatalf("redeem: %v", err)
	}
	if userID != f.alice.ID {
		t.Fatalf("bound to %q, want %q", userID, f.alice.ID)
	}

	// The rails can now resolve her.
	got, err := f.s.ResolveChannelIdentity(ctx, "telegram", tgAlice)
	if err != nil {
		t.Fatal(err)
	}
	if got != f.alice.ID {
		t.Fatalf("ResolveChannelIdentity = %q, want %q", got, f.alice.ID)
	}
}

// The security property that replaces the phone flow's target binding. If
// this ever fails, the fix is NOT to shorten the code.
func TestChannelCodesCarryTheirOwnSecurity(t *testing.T) {
	f := newChannelFixture(t)
	ctx := context.Background()

	code, err := f.s.MintChannelLinkCode(ctx, f.alice.ID, "telegram")
	if err != nil {
		t.Fatal(err)
	}
	body := NormalizeLinkCode(code.Code)
	if len(body) != channelCodeLen {
		t.Fatalf("channel code is %d characters, want %d", len(body), channelCodeLen)
	}
	// Twice the phone flow's length, and for a stated reason: a channel code
	// names no target, so whoever sends it gets bound.
	if channelCodeLen <= codeLen {
		t.Fatalf("channelCodeLen (%d) must exceed the phone code length (%d) — a channel "+
			"code is spendable by ANY sender, so the code is the only barrier",
			channelCodeLen, codeLen)
	}
}

// A code minted for one rail must not be spendable on another. They are
// separate account namespaces, and linking one is not consent to link the
// other.
func TestACodeIsBoundToItsChannel(t *testing.T) {
	f := newChannelFixture(t)
	ctx := context.Background()

	code, err := f.s.MintChannelLinkCode(ctx, f.alice.ID, "telegram")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.s.RedeemChannelLinkCode(ctx, "slack", "U123", code.Code); !errors.Is(err, ErrChannelLinkNotFound) {
		t.Fatalf("a Telegram code was spent on Slack: %v", err)
	}
	// Still good on its own rail, so the refusal above is the channel check
	// and not a code that never worked.
	if _, err := f.s.RedeemChannelLinkCode(ctx, "telegram", tgAlice, code.Code); err != nil {
		t.Fatalf("the code stopped working on its own channel: %v", err)
	}
}

func TestAChannelCodeIsSingleUse(t *testing.T) {
	f := newChannelFixture(t)
	ctx := context.Background()

	code, err := f.s.MintChannelLinkCode(ctx, f.alice.ID, "telegram")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.s.RedeemChannelLinkCode(ctx, "telegram", tgAlice, code.Code); err != nil {
		t.Fatal(err)
	}
	// A second account cannot ride the same code.
	if _, err := f.s.RedeemChannelLinkCode(ctx, "telegram", tgBob, code.Code); !errors.Is(err, ErrChannelLinkNotFound) {
		t.Fatalf("a spent code linked a second account: %v", err)
	}
	got, err := f.s.ResolveChannelIdentity(ctx, "telegram", tgBob)
	if err == nil && got != "" {
		t.Fatal("the second account was bound anyway")
	}
}

func TestAnExpiredChannelCodeIsRefused(t *testing.T) {
	f := newChannelFixture(t)
	ctx := context.Background()

	code, err := f.s.MintChannelLinkCode(ctx, f.alice.ID, "telegram")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.s.db.ExecContext(ctx,
		`UPDATE channel_link_codes SET expires_at = ? WHERE id = ?`, now()-1, code.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.s.RedeemChannelLinkCode(ctx, "telegram", tgAlice, code.Code); !errors.Is(err, ErrChannelLinkNotFound) {
		t.Fatalf("an expired code was accepted: %v", err)
	}
}

// An identity belongs to one profile. Silently rebinding would move a
// member's gate access to whoever redeemed most recently.
func TestAnIdentityCannotBeStolenByAnotherProfile(t *testing.T) {
	f := newChannelFixture(t)
	ctx := context.Background()

	aliceCode, err := f.s.MintChannelLinkCode(ctx, f.alice.ID, "telegram")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.s.RedeemChannelLinkCode(ctx, "telegram", tgAlice, aliceCode.Code); err != nil {
		t.Fatal(err)
	}

	bobCode, err := f.s.MintChannelLinkCode(ctx, f.bob.ID, "telegram")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.s.RedeemChannelLinkCode(ctx, "telegram", tgAlice, bobCode.Code); !errors.Is(err, ErrChannelIdentityTaken) {
		t.Fatalf("Alice's Telegram account was rebound to Bob: %v", err)
	}
	owner, err := f.s.ResolveChannelIdentity(ctx, "telegram", tgAlice)
	if err != nil {
		t.Fatal(err)
	}
	if owner != f.alice.ID {
		t.Fatalf("identity now resolves to %q, want %q", owner, f.alice.ID)
	}
}

func TestChannelGuessingIsBounded(t *testing.T) {
	f := newChannelFixture(t)
	ctx := context.Background()

	code, err := f.s.MintChannelLinkCode(ctx, f.alice.ID, "telegram")
	if err != nil {
		t.Fatal(err)
	}
	// Burn the budget. Each attempt is a real redemption call that fails for
	// a reason other than the sender — here, an identity already taken.
	if _, err := f.s.db.ExecContext(ctx,
		`INSERT INTO channel_identities (channel, external_id, profile_id, created_at, updated_at)
		 VALUES ('telegram', ?, ?, ?, ?)`, tgBob, f.bob.ID, now(), now()); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < ChannelLinkMaxAttempts; i++ {
		if _, err := f.s.RedeemChannelLinkCode(ctx, "telegram", tgBob, code.Code); !errors.Is(err, ErrChannelIdentityTaken) {
			t.Fatalf("attempt %d: %v", i, err)
		}
	}
	if _, err := f.s.RedeemChannelLinkCode(ctx, "telegram", tgAlice, code.Code); !errors.Is(err, ErrChannelLinkNotFound) {
		t.Fatalf("the attempt cap did not hold: %v", err)
	}
}

func TestChannelCodeRecognitionIsNarrow(t *testing.T) {
	cases := []struct {
		in   string
		want bool
	}{
		{"LINK-AB23-CD45-EF67", true},
		{"link-ab23-cd45-ef67", true},
		{" LINK-AB23CD45EF67 ", true},
		{"AB23-CD45-EF67", false}, // no prefix
		{"LINK-AB23CD", false},    // phone-length, not a channel code
		{"open", false},
		{"", false},
	}
	for _, c := range cases {
		if got := LooksLikeChannelLinkCode(c.in); got != c.want {
			t.Errorf("LooksLikeChannelLinkCode(%q) = %v, want %v", c.in, got, c.want)
		}
	}
	// The two flows must not accept each other's codes: a phone code is short
	// BECAUSE possession of the number backs it, and honouring one on a
	// channel rail would import the weaker code into the stronger-code path.
	shortCode := CodePrefix + strings.Repeat("A", codeLen)
	if LooksLikeChannelLinkCode(shortCode) {
		t.Error("a phone-length code was accepted as a channel code")
	}
	longCode := CodePrefix + strings.Repeat("A", channelCodeLen)
	if LooksLikeLinkCode(longCode) {
		t.Error("a channel-length code was accepted as a phone code")
	}
}

func TestUnlinkChannelIdentityIsScopedToTheOwner(t *testing.T) {
	f := newChannelFixture(t)
	ctx := context.Background()

	code, err := f.s.MintChannelLinkCode(ctx, f.alice.ID, "telegram")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.s.RedeemChannelLinkCode(ctx, "telegram", tgAlice, code.Code); err != nil {
		t.Fatal(err)
	}

	if err := f.s.UnlinkChannelIdentity(ctx, f.bob.ID, "telegram", tgAlice); !errors.Is(err, ErrNotFound) {
		t.Fatalf("another member unlinked her identity: %v", err)
	}
	if err := f.s.UnlinkChannelIdentity(ctx, f.alice.ID, "telegram", tgAlice); err != nil {
		t.Fatalf("she could not remove her own: %v", err)
	}
	ids, err := f.s.ChannelIdentitiesForUser(ctx, f.alice.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(ids) != 0 {
		t.Fatalf("identities = %+v after unlink", ids)
	}
}
