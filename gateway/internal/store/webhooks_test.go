package store

import (
	"context"
	"fmt"
	"strings"
	"testing"
)

// The invariant webhooks.go exists to hold: no read path returns the signing
// secret. Not "handlers remember to strip it" — there is no field to strip,
// because the projection has no column for it.
//
// This matters more than it looks. The secret is stored in plaintext (an HMAC
// key must be recoverable to sign with), so the projection IS the containment.
// A future column added to webhookCols without thinking is exactly how a
// signing key ends up in a list response.

func webhookTestStore(t *testing.T) (*Store, string) {
	t.Helper()
	st := openTest(t)
	return st, seedAccountForWebhooks(t, st)
}

var webhookSeedN int

func seedAccountForWebhooks(t *testing.T, st *Store) string {
	t.Helper()
	ctx := context.Background()
	webhookSeedN++
	u, err := st.CreateUser(ctx, fmt.Sprintf("wh-owner-%d", webhookSeedN), "h", "O", "")
	if err != nil {
		t.Fatal(err)
	}
	acct, _, err := st.CreateAccountWithOwner(ctx, u.ID, fmt.Sprintf("WH House %d", webhookSeedN), "ZA")
	if err != nil {
		t.Fatal(err)
	}
	return acct.ID
}

// sprintAll renders a value with every field, so a secret hiding in one is
// caught rather than depending on which fields a test remembers to check.
func sprintAll(v any) string { return fmt.Sprintf("%#v", v) }

func TestWebhookSecretIsUnreachableThroughEveryReadPath(t *testing.T) {
	ctx := context.Background()
	st, acct := webhookTestStore(t)
	const secret = "SUPERSECRET-hmac-key-do-not-leak"

	w, err := st.CreateWebhook(ctx, CreateWebhookArgs{
		AccountID: acct, Name: "home assistant", URL: "https://ha.example/hook",
		Secret: secret, Events: []string{"access.opened"},
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	// The returned struct has no Secret field at all — that is a compile-time
	// guarantee, so assert the runtime one: nothing it renders contains it.
	if strings.Contains(sprintAll(w), secret) {
		t.Fatal("the created webhook rendered its own secret")
	}

	list, err := st.WebhooksForAccount(ctx, acct)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("expected 1 webhook, got %d", len(list))
	}
	if strings.Contains(sprintAll(list), secret) {
		t.Fatal("the listing leaked the signing secret")
	}

	got, err := st.WebhookByID(ctx, acct, w.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if strings.Contains(sprintAll(got), secret) {
		t.Fatal("the single-webhook read leaked the signing secret")
	}

	// And the one accessor that IS allowed to see it still works, because a
	// secret nobody can retrieve cannot sign anything.
	back, err := st.SigningSecret(ctx, w.ID)
	if err != nil {
		t.Fatalf("signing secret: %v", err)
	}
	if back != secret {
		t.Fatalf("SigningSecret returned %q, want the stored key", back)
	}
}

// A webhook belongs to one account. The dispatcher looks endpoints up by
// account, so a leak here would send another tenant's gate events to a
// stranger's URL.
func TestWebhookReadsAreAccountScoped(t *testing.T) {
	ctx := context.Background()
	st, acctA := webhookTestStore(t)
	acctB := seedAccountForWebhooks(t, st)

	w, err := st.CreateWebhook(ctx, CreateWebhookArgs{
		AccountID: acctA, Name: "a", URL: "https://a.example/hook",
		Secret: "s", Events: []string{"access.opened"},
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := st.WebhookByID(ctx, acctB, w.ID); err == nil {
		t.Fatal("account B read account A's webhook by id")
	}
	listB, err := st.WebhooksForAccount(ctx, acctB)
	if err != nil {
		t.Fatalf("list B: %v", err)
	}
	if len(listB) != 0 {
		t.Fatalf("account B sees %d of account A's webhooks", len(listB))
	}
	if err := st.DeleteWebhook(ctx, acctB, w.ID); err == nil {
		t.Fatal("account B deleted account A's webhook")
	}
}

// A dead endpoint must stop costing an attempt on every open. Once the
// dispatcher disables it, it drops out of the event query until an operator
// intervenes — it does not quietly resurrect on the next event.
func TestDisabledWebhookStopsBeingDispatchedTo(t *testing.T) {
	ctx := context.Background()
	st, acct := webhookTestStore(t)
	w, err := st.CreateWebhook(ctx, CreateWebhookArgs{
		AccountID: acct, Name: "dead", URL: "https://dead.example/hook",
		Secret: "s", Events: []string{"access.opened"},
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	live, err := st.EnabledWebhooksForEvent(ctx, acct, "access.opened")
	if err != nil || len(live) != 1 {
		t.Fatalf("expected the webhook to be dispatched to: %d %v", len(live), err)
	}
	if err := st.DisableWebhook(ctx, w.ID, "5 consecutive failures"); err != nil {
		t.Fatalf("disable: %v", err)
	}
	live, err = st.EnabledWebhooksForEvent(ctx, acct, "access.opened")
	if err != nil {
		t.Fatalf("re-query: %v", err)
	}
	if len(live) != 0 {
		t.Fatal("a disabled webhook was still dispatched to; a dead URL would " +
			"cost an attempt on every open forever")
	}
	// The reason survives, because an operator needs it to fix the thing.
	got, err := st.WebhookByID(ctx, acct, w.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.DisabledReason == "" {
		t.Error("a webhook disabled without a reason gives the operator nothing to act on")
	}
}

// Subscriptions are per-event: an endpoint that asked for one thing must not
// receive another.
func TestOnlySubscribedEventsAreDispatched(t *testing.T) {
	ctx := context.Background()
	st, acct := webhookTestStore(t)
	if _, err := st.CreateWebhook(ctx, CreateWebhookArgs{
		AccountID: acct, Name: "opens only", URL: "https://x.example/hook",
		Secret: "s", Events: []string{"access.opened"},
	}); err != nil {
		t.Fatalf("create: %v", err)
	}
	other, err := st.EnabledWebhooksForEvent(ctx, acct, "access.denied")
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	if len(other) != 0 {
		t.Fatal("an endpoint subscribed to access.opened received access.denied")
	}
}
