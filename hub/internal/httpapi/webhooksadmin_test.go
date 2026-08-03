package httpapi

import (
	"net/http"
	"testing"

	"github.com/vul-os/aql/hub/internal/store"
)

// The outbound-webhook admin surface, which had no test at all.
//
// The dispatcher, the delivery path, the signature vectors and the SSRF
// refusals in validateWebhookURL are all covered elsewhere. The three HTTP
// handlers that CREATE, LIST and DELETE the subscriptions were not — a
// coverage sweep across the hub put handleWebhooksList, handleWebhookCreate,
// handleWebhookDelete, webhookJSON and newWebhookSecret all at 0%.
//
// That is a bad set of things to leave unheld, because a webhook is, in the
// route comment's own words, "a standing instruction to POST a signed record of
// every gate opening to an address of the configurer's choosing". The
// authorisation on it is the difference between a feature and an exfiltration
// channel, and all three routes are registered as plain requireAuth — the admin
// check lives inside each handler, where nothing was checking that it stayed.

type webhookFixture struct {
	h       http.Handler
	st      *store.Store
	adminA  string // account A owner
	memberA string // account A plain member
	adminB  string // account B owner
	acctA   string
	acctB   string
}

func setupWebhooks(t *testing.T) *webhookFixture {
	t.Helper()
	h, st := newTestServerWithStore(t, "")
	f := &webhookFixture{h: h, st: st}
	f.adminA, _ = register(t, h, "owner-a@wh.test")
	f.adminB, _ = register(t, h, "owner-b@wh.test")
	f.acctA, _ = tenantIDs(t, h, f.adminA)
	f.acctB, _ = tenantIDs(t, h, f.adminB)
	_, f.memberA = inviteMember(t, h, st, f.adminA, f.acctA, "member-a@wh.test", "+27000000401")
	return f
}

func createBody(url string) map[string]any {
	return map[string]any{
		"name":   "ops",
		"url":    url,
		"events": []string{EventAccessOpened},
	}
}

// A plain member of the account may not create, list or delete a webhook.
//
// The route is requireAuth, so without the isAdminRole check inside each
// handler any member of the account could point a copy of every gate opening at
// a server of their own. That is the whole reason these are admin-only, and it
// is a one-line check in three places with nothing holding it.
func TestAPlainMemberCannotTouchWebhooks(t *testing.T) {
	f := setupWebhooks(t)

	rec, _ := doJSON(t, f.h, "POST", "/v1/accounts/"+f.acctA+"/webhooks", f.memberA,
		createBody("https://example.com/hook"))
	if rec.Code != http.StatusForbidden {
		t.Errorf("member create: %d, want 403 — any member could redirect a record of "+
			"every gate opening to their own server", rec.Code)
	}
	rec, _ = doJSON(t, f.h, "GET", "/v1/accounts/"+f.acctA+"/webhooks", f.memberA, nil)
	if rec.Code != http.StatusForbidden {
		t.Errorf("member list: %d, want 403 — the list discloses where the account's "+
			"access records are being sent", rec.Code)
	}
	rec, _ = doJSON(t, f.h, "DELETE", "/v1/accounts/"+f.acctA+"/webhooks/whatever", f.memberA, nil)
	if rec.Code != http.StatusForbidden {
		t.Errorf("member delete: %d, want 403 — a member could silence an operator's "+
			"alerting", rec.Code)
	}
}

// An admin of one account may not reach another account's webhooks.
//
// Being an owner somewhere is not being an owner everywhere, and the accountID
// comes straight off the path.
func TestAnAdminOfAnotherAccountIsRefused(t *testing.T) {
	f := setupWebhooks(t)

	rec, _ := doJSON(t, f.h, "POST", "/v1/accounts/"+f.acctA+"/webhooks", f.adminB,
		createBody("https://example.com/hook"))
	if rec.Code == http.StatusCreated {
		t.Error("an owner of account B created a webhook on account A")
	}
	rec, _ = doJSON(t, f.h, "GET", "/v1/accounts/"+f.acctA+"/webhooks", f.adminB, nil)
	if rec.Code == http.StatusOK {
		t.Error("an owner of account B listed account A's webhooks")
	}
}

// The happy path, and the secret discipline that goes with it.
//
// The secret is returned exactly once, at creation, and never again. This is
// the control for the refusal tests above — all of which a handler that refused
// everything would satisfy — and it is also the assertion that webhookJSON
// never grows a secret field, which would put the HMAC key of every
// subscription into a routine list response.
func TestCreateReturnsTheSecretOnceAndTheListNeverDoes(t *testing.T) {
	f := setupWebhooks(t)

	rec, body := doJSON(t, f.h, "POST", "/v1/accounts/"+f.acctA+"/webhooks", f.adminA,
		createBody("https://example.com/hook"))
	if rec.Code != http.StatusCreated {
		t.Fatalf("admin create: %d, want 201 (body %v)", rec.Code, body)
	}
	secret, _ := body["secret"].(string)
	if len(secret) != 64 {
		t.Fatalf("secret is %d hex chars, want 64 (256 bits) — an HMAC key must not be "+
			"the weak link", len(secret))
	}
	if body["secret_note"] == nil {
		t.Error("no secret_note; an operator who does not know it is shown once will lose it")
	}
	id, _ := body["id"].(string)
	if id == "" {
		t.Fatal("create returned no id")
	}

	rec, listBody := doJSON(t, f.h, "GET", "/v1/accounts/"+f.acctA+"/webhooks", f.adminA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("admin list: %d, want 200", rec.Code)
	}
	hooks, _ := listBody["webhooks"].([]any)
	if len(hooks) != 1 {
		t.Fatalf("listed %d webhooks, want 1", len(hooks))
	}
	got, _ := hooks[0].(map[string]any)
	if _, present := got["secret"]; present {
		t.Error("the list response carries the signing secret. Every admin read would " +
			"hand out the HMAC key of every subscription.")
	}
	if got["url"] != "https://example.com/hook" {
		t.Errorf("listed url %v, want the one created", got["url"])
	}
}

// Two webhooks never share a secret.
//
// newWebhookSecret was at 0%: nothing established that it returns anything
// varying at all. A constant would pass every other test in this file and make
// one forged signature valid against every subscription on the hub.
func TestEveryWebhookGetsItsOwnSecret(t *testing.T) {
	f := setupWebhooks(t)
	seen := map[string]bool{}
	for i := 0; i < 5; i++ {
		_, body := doJSON(t, f.h, "POST", "/v1/accounts/"+f.acctA+"/webhooks", f.adminA,
			createBody("https://example.com/hook"))
		secret, _ := body["secret"].(string)
		if seen[secret] {
			t.Fatalf("two webhooks were issued the same secret (%q). One forged signature "+
				"would then be valid against every subscription.", secret)
		}
		seen[secret] = true
	}
}

// Delete is scoped by account in SQL, not only by the handler's role check.
//
// The webhook id is a path parameter, so an admin of B who learns an id
// belonging to A must still be refused by the DELETE itself. That is why the
// store's statement carries `AND account_id = ?`, and this is what would notice
// if it were ever simplified to `WHERE id = ?`.
func TestDeletingAcrossAccountsFindsNothing(t *testing.T) {
	f := setupWebhooks(t)

	_, body := doJSON(t, f.h, "POST", "/v1/accounts/"+f.acctA+"/webhooks", f.adminA,
		createBody("https://example.com/hook"))
	id, _ := body["id"].(string)
	if id == "" {
		t.Fatal("create returned no id")
	}

	// B is an owner of its OWN account, so the role check passes on B's path;
	// only the account-scoped statement can refuse this.
	rec, _ := doJSON(t, f.h, "DELETE", "/v1/accounts/"+f.acctB+"/webhooks/"+id, f.adminB, nil)
	if rec.Code == http.StatusNoContent {
		t.Fatal("an owner of account B deleted account A's webhook by naming its id " +
			"under their own account")
	}

	// And A's own delete still works — the control, without which the test
	// above is satisfied by a delete that never deletes anything.
	rec, _ = doJSON(t, f.h, "DELETE", "/v1/accounts/"+f.acctA+"/webhooks/"+id, f.adminA, nil)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("owner delete: %d, want 204", rec.Code)
	}
	_, listBody := doJSON(t, f.h, "GET", "/v1/accounts/"+f.acctA+"/webhooks", f.adminA, nil)
	if hooks, _ := listBody["webhooks"].([]any); len(hooks) != 0 {
		t.Errorf("%d webhooks remain after a 204 delete", len(hooks))
	}
}

// A refused URL leaves nothing behind.
//
// The handler validates before writing, and says so. Without a test, a
// reordering that wrote first and validated after would leave half-made
// subscriptions that the list then reports as real.
func TestARefusedURLCreatesNothing(t *testing.T) {
	f := setupWebhooks(t)

	for _, bad := range []string{
		"http://example.com/hook",     // plaintext to the internet, no allow_private
		"ftp://example.com/hook",      // not http(s)
		"https://user:pw@example.com", // credentials in the URL
		"https://",                    // no host
	} {
		rec, _ := doJSON(t, f.h, "POST", "/v1/accounts/"+f.acctA+"/webhooks", f.adminA, createBody(bad))
		if rec.Code != http.StatusBadRequest {
			t.Errorf("create with %q: %d, want 400", bad, rec.Code)
		}
	}
	// An unknown event name is refused for its own reason rather than
	// subscribing to something that can never fire.
	rec, _ := doJSON(t, f.h, "POST", "/v1/accounts/"+f.acctA+"/webhooks", f.adminA, map[string]any{
		"name": "ops", "url": "https://example.com/hook", "events": []string{"access.opemed"},
	})
	if rec.Code != http.StatusBadRequest {
		t.Errorf("create with a misspelled event: %d, want 400", rec.Code)
	}

	_, listBody := doJSON(t, f.h, "GET", "/v1/accounts/"+f.acctA+"/webhooks", f.adminA, nil)
	if hooks, _ := listBody["webhooks"].([]any); len(hooks) != 0 {
		t.Fatalf("%d webhooks exist after only refused creations", len(hooks))
	}
}
