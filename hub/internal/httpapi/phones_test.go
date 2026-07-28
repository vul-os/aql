package httpapi

import (
	"net/http"
	"testing"
)

// The three phone routes. The tenancy shape here is the usual one for this
// repo: another member's row must be unreachable AND indistinguishable from a
// row that does not exist.

func TestPhoneLinkMintRejectsMalformedNumbers(t *testing.T) {
	ts, _, _ := newLiveServer(t)
	access, _, _, _, _ := pairDevice(t, ts)

	for _, bad := range []string{"", "0821234567", "+0821234567", "not-a-number", "+2782123456789012345"} {
		code, out := liveJSON(t, ts, "POST", "/v1/phones/me/link", access, map[string]any{"phone_e164": bad})
		if code != http.StatusBadRequest {
			t.Errorf("phone %q: %d %v, want 400", bad, code, out)
		}
	}
}

func TestPhoneLinkMintReturnsACodeAndListsTheNumber(t *testing.T) {
	ts, _, _ := newLiveServer(t)
	access, _, _, _, _ := pairDevice(t, ts)

	code, out := liveJSON(t, ts, "POST", "/v1/phones/me/link", access,
		map[string]any{"phone_e164": "+27821110000"})
	if code != http.StatusCreated {
		t.Fatalf("mint: %d %v", code, out)
	}
	got, _ := out["code"].(string)
	if len(got) < 7 {
		t.Fatalf("code %q looks wrong", got)
	}
	if out["instruction"] == "" || out["expires_at"] == nil {
		t.Errorf("mint response missing instruction/expiry: %v", out)
	}

	// Nothing is written to the phone list until the code is redeemed — a
	// pending link must not look like a linked number.
	code, out = liveJSON(t, ts, "GET", "/v1/phones/me/phones", access, nil)
	if code != 200 {
		t.Fatalf("list: %d %v", code, out)
	}
	phones, _ := out["phones"].([]any)
	if len(phones) != 0 {
		t.Fatalf("minting a code created a phone row: %v", phones)
	}
}

func TestPhoneRoutesRequireASession(t *testing.T) {
	ts, _, _ := newLiveServer(t)

	for _, c := range []struct{ method, path string }{
		{"POST", "/v1/phones/me/link"},
		{"GET", "/v1/phones/me/phones"},
		{"DELETE", "/v1/phones/me/phones/anything"},
	} {
		code, _ := liveJSON(t, ts, c.method, c.path, "", map[string]any{"phone_e164": "+27821110000"})
		if code != http.StatusUnauthorized {
			t.Errorf("%s %s unauthenticated: %d, want 401", c.method, c.path, code)
		}
	}
}

func TestUnlinkingAnotherMembersPhoneIs404(t *testing.T) {
	ts, _, st := newLiveServer(t)
	accessA, _, _, _, _ := pairDevice(t, ts)

	// A second user with a verified number of their own.
	other, err := st.CreateUser(t.Context(), "other@phones.com", "h", "Other", "")
	if err != nil {
		t.Fatal(err)
	}
	if err := st.AddVerifiedPhone(t.Context(), other.ID, "+27829990000"); err != nil {
		t.Fatal(err)
	}
	phones, err := st.PhonesForUser(t.Context(), other.ID)
	if err != nil || len(phones) != 1 {
		t.Fatalf("fixture: %v %+v", err, phones)
	}

	code, _ := liveJSON(t, ts, "DELETE", "/v1/phones/me/phones/"+phones[0].ID, accessA, nil)
	if code != http.StatusNotFound {
		t.Fatalf("cross-user unlink: %d, want 404", code)
	}
	// And it is still there.
	still, err := st.PhonesForUser(t.Context(), other.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(still) != 1 {
		t.Fatal("another member's number was deleted")
	}
}

func TestMintingForANumberVerifiedElsewhereIs409(t *testing.T) {
	ts, _, st := newLiveServer(t)
	access, _, _, _, _ := pairDevice(t, ts)

	other, err := st.CreateUser(t.Context(), "taken@phones.com", "h", "Taken", "")
	if err != nil {
		t.Fatal(err)
	}
	if err := st.AddVerifiedPhone(t.Context(), other.ID, "+27828880000"); err != nil {
		t.Fatal(err)
	}

	code, out := liveJSON(t, ts, "POST", "/v1/phones/me/link", access,
		map[string]any{"phone_e164": "+27828880000"})
	if code != http.StatusConflict {
		t.Fatalf("mint against a taken number: %d %v, want 409", code, out)
	}
	if out["error"] != "phone_verified_elsewhere" {
		t.Errorf("error = %v, want phone_verified_elsewhere", out["error"])
	}
}
