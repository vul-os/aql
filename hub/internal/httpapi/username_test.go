package httpapi

import (
	"net/http"
	"strings"
	"testing"
)

// The regression this exists to prevent. Email identity was removed from the
// product — no columns, no sending, no docs — and three handlers went on
// requiring an "@" in every username, so the requirement survived its own
// removal. Nothing failed; a build passes either way.
func TestAUsernameNeedNotLookLikeAnEmailAddress(t *testing.T) {
	h := newTestServer(t, "")
	for _, u := range []string{"pat", "sam.taylor", "gate-keeper", "K9", "ana_m"} {
		code, out := doJSON(t, h, "POST", "/v1/auth/register", "", map[string]any{
			"username": u, "password": "correct-horse-battery",
			"display_name": "T", "location_name": "Test House",
		})
		if code.Code != http.StatusCreated && code.Code != http.StatusOK {
			t.Errorf("username %q refused with %d %v — a hub with no email must not "+
				"require an email-shaped handle", u, code.Code, out["error"])
		}
	}
}

// An email address still works. Widening what is accepted must not break the
// accounts that already exist.
func TestAnEmailAddressIsStillAValidUsername(t *testing.T) {
	if !validUsername("someone@example.com") {
		t.Fatal("an existing email-shaped username stopped being valid")
	}
}

func TestUsernameRuleRefusesWhatItShould(t *testing.T) {
	for _, tc := range []struct {
		name, in string
	}{
		{"empty", ""},
		{"single character", "a"},
		{"interior space breaks chat commands", "gate keeper"},
		{"tab", "gate\tkeeper"},
		{"newline", "pat\nsam"},
		{"control character renders unpredictably in an audit log", "pat\x00"},
		{"DEL", "pat\x7f"},
		{"leading dot reads as truncated", ".pat"},
		{"trailing dot reads as truncated", "pat."},
		{"too long", strings.Repeat("a", usernameMaxLen+1)},
	} {
		if validUsername(tc.in) {
			t.Errorf("%s: %q was accepted", tc.name, tc.in)
		}
	}
}

func TestUsernameRuleAcceptsWhatItShould(t *testing.T) {
	for _, u := range []string{
		"pat", "sam.taylor", "gate-keeper", "K9", "ana_m",
		"someone@example.com", "user+tag@example.co.za",
		"zoë",                               // non-ASCII names are ordinary
		strings.Repeat("a", usernameMaxLen), // exactly at the ceiling
	} {
		if !validUsername(u) {
			t.Errorf("%q was refused", u)
		}
	}
}
