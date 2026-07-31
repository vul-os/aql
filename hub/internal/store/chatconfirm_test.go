package store

import (
	"context"
	"strings"
	"testing"
)

func confirmStore(t *testing.T) *Store {
	t.Helper()
	st, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	return st
}

func pending(subject, device, verb string) PendingConfirmation {
	return PendingConfirmation{
		Subject: subject, Channel: "whatsapp", ChatID: "chat-1",
		IntentHash: IntentHash(device, verb, nil), DeviceKey: device, Verb: verb,
	}
}

func TestAConfirmationRoundTrips(t *testing.T) {
	st := confirmStore(t)
	ctx := context.Background()
	now := int64(1_000_000)

	tok, err := st.MintConfirmation(ctx, pending("profile:a", "mock:vac-1", "resume"), now)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(tok, ConfirmationPrefix) {
		t.Errorf("token %q is not findable in a message", tok)
	}
	got, err := st.RedeemConfirmation(ctx, tok, "profile:a", "whatsapp", "chat-1", now+5)
	if err != nil {
		t.Fatalf("redeem: %v", err)
	}
	if got.DeviceKey != "mock:vac-1" || got.Verb != "resume" {
		t.Errorf("redeemed the wrong intent: %+v", got)
	}
}

// Single-use. The second message IS the authorization, so a token that spends
// twice authorizes twice.
func TestAConfirmationCannotBeSpentTwice(t *testing.T) {
	st := confirmStore(t)
	ctx := context.Background()
	now := int64(1_000_000)
	tok, _ := st.MintConfirmation(ctx, pending("profile:a", "mock:vac-1", "resume"), now)

	if _, err := st.RedeemConfirmation(ctx, tok, "profile:a", "whatsapp", "chat-1", now+1); err != nil {
		t.Fatal(err)
	}
	if _, err := st.RedeemConfirmation(ctx, tok, "profile:a", "whatsapp", "chat-1", now+2); err != ErrConfirmationNotFound {
		t.Errorf("a spent token was accepted again: %v", err)
	}
}

// §3.4: "in a multi-party conversation, yes cannot be attributed to the person
// the question was asked of". A token minted for one member must not be
// spendable by another who can read it.
func TestAnotherMemberCannotSpendTheToken(t *testing.T) {
	st := confirmStore(t)
	ctx := context.Background()
	now := int64(1_000_000)
	tok, _ := st.MintConfirmation(ctx, pending("profile:a", "mock:vac-1", "resume"), now)

	if _, err := st.RedeemConfirmation(ctx, tok, "profile:b", "whatsapp", "chat-1", now+1); err != ErrConfirmationNotFound {
		t.Errorf("another member spent the token: %v", err)
	}
	// And it is still there for the member it was minted for.
	if _, err := st.RedeemConfirmation(ctx, tok, "profile:a", "whatsapp", "chat-1", now+1); err != nil {
		t.Errorf("the failed attempt consumed the token: %v", err)
	}
}

// "In the same conversation" — a token overheard in one chat is not spendable
// in another, even by the same member.
func TestATokenIsBoundToItsConversation(t *testing.T) {
	st := confirmStore(t)
	ctx := context.Background()
	now := int64(1_000_000)
	tok, _ := st.MintConfirmation(ctx, pending("profile:a", "mock:vac-1", "resume"), now)

	if _, err := st.RedeemConfirmation(ctx, tok, "profile:a", "whatsapp", "chat-2", now+1); err != ErrConfirmationNotFound {
		t.Errorf("spendable in another chat: %v", err)
	}
	if _, err := st.RedeemConfirmation(ctx, tok, "profile:a", "telegram", "chat-1", now+1); err != ErrConfirmationNotFound {
		t.Errorf("spendable on another rail: %v", err)
	}
}

func TestAConfirmationExpires(t *testing.T) {
	st := confirmStore(t)
	ctx := context.Background()
	now := int64(1_000_000)
	tok, _ := st.MintConfirmation(ctx, pending("profile:a", "mock:vac-1", "resume"), now)

	if _, err := st.RedeemConfirmation(ctx, tok, "profile:a", "whatsapp", "chat-1", now+ConfirmationTTL+1); err != ErrConfirmationNotFound {
		t.Errorf("an expired token was accepted: %v", err)
	}
	// The boundary: still good one second before it lapses.
	tok2, _ := st.MintConfirmation(ctx, pending("profile:a", "mock:vac-1", "resume"), now)
	if _, err := st.RedeemConfirmation(ctx, tok2, "profile:a", "whatsapp", "chat-1", now+ConfirmationTTL-1); err != nil {
		t.Errorf("rejected inside the window: %v", err)
	}
}

// The binding §3.4 exists for: a confirmation for one action must not confirm
// another. The hash is what a caller compares, so this pins that two different
// intents cannot produce the same one.
func TestTheIntentHashDistinguishesActions(t *testing.T) {
	mower := IntentHash("mock:mower-1", "resume", nil)
	door := IntentHash("mock:door-1", "unlock", nil)
	if mower == door {
		t.Fatal("a confirmation for the mower would confirm the door")
	}
	// Same device, different verb.
	if IntentHash("mock:vac-1", "resume", nil) == IntentHash("mock:vac-1", "stop", nil) {
		t.Error("verb does not affect the hash")
	}
	// Same action, different phrasing of the args map order — must be equal.
	a := IntentHash("mock:x", "set", map[string]float64{"level": 30, "temp": 21})
	b := IntentHash("mock:x", "set", map[string]float64{"temp": 21, "level": 30})
	if a != b {
		t.Error("argument order changes the hash — the same intent would not confirm itself")
	}
	// And the length-prefixing: no re-split collision.
	if IntentHash("a:b", "c", nil) == IntentHash("a", "b:c", nil) {
		t.Error("field boundaries collide")
	}
}

// A second request replaces the first: a member cannot hold two live tokens for
// two devices, because the tokens are opaque and they could not tell which is
// which.
func TestMintingAgainRetiresTheEarlierToken(t *testing.T) {
	st := confirmStore(t)
	ctx := context.Background()
	now := int64(1_000_000)
	first, _ := st.MintConfirmation(ctx, pending("profile:a", "mock:vac-1", "resume"), now)
	second, _ := st.MintConfirmation(ctx, pending("profile:a", "mock:mower-1", "resume"), now+1)

	if _, err := st.RedeemConfirmation(ctx, first, "profile:a", "whatsapp", "chat-1", now+2); err != ErrConfirmationNotFound {
		t.Errorf("the superseded token still works: %v", err)
	}
	if _, err := st.RedeemConfirmation(ctx, second, "profile:a", "whatsapp", "chat-1", now+2); err != nil {
		t.Errorf("the current token does not work: %v", err)
	}
}

func TestATokenIsFoundInAMessageThatCarriesWords(t *testing.T) {
	st := confirmStore(t)
	tok, _ := st.MintConfirmation(context.Background(), pending("profile:a", "mock:vac-1", "resume"), 1_000_000)
	for _, body := range []string{tok, "yes " + tok, "  " + tok + "  ", "confirm: " + tok + "!"} {
		got, ok := ConfirmationTokenIn(body)
		if !ok || got != tok {
			t.Errorf("%q → (%q, %v)", body, got, ok)
		}
	}
	// The case every rail actually delivers. NormalizeText lowercases an
	// inbound body before anything sees it, so a case-sensitive scan finds
	// nothing a member could send — which is exactly what happened: a T2
	// command answered its own confirmation with a fresh confirmation, forever.
	lowered := strings.ToLower(tok)
	got, ok := ConfirmationTokenIn("resume the cleaning bot " + lowered)
	if !ok {
		t.Fatalf("a lowercased token is not found — no rail could ever redeem one: %q", lowered)
	}
	if got != tok {
		t.Errorf("lowercased token returned %q, want the canonical %q", got, tok)
	}

	// And an ordinary message is not a redemption attempt.
	for _, body := range []string{"ok", "yes", "turn on the lights", "okay then"} {
		if _, ok := ConfirmationTokenIn(body); ok {
			t.Errorf("%q read as a token", body)
		}
	}
}
