package httpapi

import (
	"net/http"
	"strings"
	"testing"
)

// PATCH /v1/auth/me/profile — the route the console's profile form has been
// posting to since before it existed.

func TestProfileUpdateRoundTrip(t *testing.T) {
	h := newTestServer(t, "op-token")
	access, _ := register(t, h, "pat@x.com")

	rec, out := doJSON(t, h, "PATCH", "/v1/auth/me/profile", access, map[string]any{
		"display_name": "  Pat Mokoena  ",
		"avatar_url":   "https://example.com/me.png",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("patch: %d %v", rec.Code, out)
	}
	p := out["profile"].(map[string]any)
	// Trimmed, not stored with the operator's stray spaces.
	if p["display_name"] != "Pat Mokoena" {
		t.Errorf("display_name = %v, want trimmed", p["display_name"])
	}
	if p["avatar_url"] != "https://example.com/me.png" {
		t.Errorf("avatar_url = %v", p["avatar_url"])
	}
	// The source is derived, never taken from the client.
	if p["avatar_source"] != "user" {
		t.Errorf("avatar_source = %v, want user", p["avatar_source"])
	}

	// It actually persisted — the point of the endpoint. Reading it back
	// through a DIFFERENT route than the one that wrote it, so a handler that
	// echoed its own input without saving cannot pass this.
	rec, out = doJSON(t, h, "GET", "/v1/auth/me", access, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("me: %d %v", rec.Code, out)
	}
	u := out["user"].(map[string]any)
	if u["display_name"] != "Pat Mokoena" || u["avatar_url"] != "https://example.com/me.png" {
		t.Fatalf("/auth/me did not carry the saved profile: %v", u)
	}
}

// A PATCH that mentions one field must not clear the other. This is the whole
// reason the request struct and the store take pointers rather than strings.
func TestProfileUpdatePartialDoesNotClearTheOtherField(t *testing.T) {
	h := newTestServer(t, "op-token")
	access, _ := register(t, h, "pat2@x.com")

	if rec, out := doJSON(t, h, "PATCH", "/v1/auth/me/profile", access, map[string]any{
		"display_name": "Pat",
		"avatar_url":   "https://example.com/a.png",
	}); rec.Code != http.StatusOK {
		t.Fatalf("seed: %d %v", rec.Code, out)
	}

	rec, out := doJSON(t, h, "PATCH", "/v1/auth/me/profile", access, map[string]any{
		"display_name": "Patricia",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("rename: %d %v", rec.Code, out)
	}
	p := out["profile"].(map[string]any)
	if p["display_name"] != "Patricia" {
		t.Errorf("display_name = %v", p["display_name"])
	}
	if p["avatar_url"] != "https://example.com/a.png" {
		t.Errorf("renaming cleared the avatar: %v", p["avatar_url"])
	}
}

// Explicit empty string clears — and takes avatar_source with it, because an
// avatar that is not there has no source.
func TestProfileUpdateEmptyAvatarClears(t *testing.T) {
	h := newTestServer(t, "op-token")
	access, _ := register(t, h, "pat3@x.com")

	doJSON(t, h, "PATCH", "/v1/auth/me/profile", access, map[string]any{
		"avatar_url": "https://example.com/a.png",
	})
	rec, out := doJSON(t, h, "PATCH", "/v1/auth/me/profile", access, map[string]any{
		"avatar_url": "",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("clear: %d %v", rec.Code, out)
	}
	p := out["profile"].(map[string]any)
	if p["avatar_url"] != nil {
		t.Errorf("avatar_url = %v, want null", p["avatar_url"])
	}
	if p["avatar_source"] != nil {
		t.Errorf("avatar_source = %v, want null once the avatar is gone", p["avatar_source"])
	}
}

// The console clears an avatar by sending an explicit null, not "". A *string
// cannot tell that apart from an omitted key, so with one the Clear avatar
// button would report success and change nothing — which is why the request
// type carries its own three-state decoder.
func TestProfileUpdateNullClearsTheAvatar(t *testing.T) {
	h := newTestServer(t, "op-token")
	access, _ := register(t, h, "pat7@x.com")

	doJSON(t, h, "PATCH", "/v1/auth/me/profile", access, map[string]any{
		"display_name": "Pat",
		"avatar_url":   "https://example.com/a.png",
	})

	rec, out := doJSON(t, h, "PATCH", "/v1/auth/me/profile", access, map[string]any{
		"avatar_url": nil,
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("null clear: %d %v", rec.Code, out)
	}
	p := out["profile"].(map[string]any)
	if p["avatar_url"] != nil {
		t.Errorf("an explicit null did not clear the avatar: %v", p["avatar_url"])
	}
	// ...and left the name alone, because null on one field is not a wipe of
	// the record.
	if p["display_name"] != "Pat" {
		t.Errorf("clearing the avatar changed the name: %v", p["display_name"])
	}
}

// A null display name is refused rather than silently clearing it: the name is
// what other members see in a roster and an audit row.
func TestProfileUpdateNullDisplayNameIsRefused(t *testing.T) {
	h := newTestServer(t, "op-token")
	access, _ := register(t, h, "pat8@x.com")

	rec, out := doJSON(t, h, "PATCH", "/v1/auth/me/profile", access, map[string]any{
		"display_name": nil,
	})
	if rec.Code != http.StatusBadRequest || out["error"] != "invalid_display_name" {
		t.Errorf("null display_name: %d %v", rec.Code, out)
	}
}

// The console's help text says "https only". A rule the server does not keep
// is a suggestion, so every one of these must be refused.
func TestProfileUpdateRejectsNonHTTPSAvatars(t *testing.T) {
	h := newTestServer(t, "op-token")
	access, _ := register(t, h, "pat4@x.com")

	for _, bad := range []string{
		"http://example.com/a.png",          // mixed content on an https console
		"data:image/png;base64,iVBORw0KGgo", // arbitrary payload into every viewer's page
		"javascript:alert(1)",
		"file:///etc/passwd",
		"https://",                        // scheme with no host
		"//example.com/a.png",             // scheme-relative: no scheme at all
		strings.Repeat("https://a/", 200), // over the length bound
	} {
		rec, out := doJSON(t, h, "PATCH", "/v1/auth/me/profile", access, map[string]any{
			"avatar_url": bad,
		})
		if rec.Code != http.StatusBadRequest || out["error"] != "invalid_avatar_url" {
			t.Errorf("avatar %q was accepted: %d %v", bad, rec.Code, out)
		}
	}
}

func TestProfileUpdateRejectsBadDisplayName(t *testing.T) {
	h := newTestServer(t, "op-token")
	access, _ := register(t, h, "pat5@x.com")

	for _, bad := range []string{"", "   ", strings.Repeat("x", maxDisplayNameLen+1)} {
		rec, out := doJSON(t, h, "PATCH", "/v1/auth/me/profile", access, map[string]any{
			"display_name": bad,
		})
		if rec.Code != http.StatusBadRequest || out["error"] != "invalid_display_name" {
			t.Errorf("display_name %q was accepted: %d %v", bad, rec.Code, out)
		}
	}

	// The bound counts characters, not bytes: a name of 80 accented letters is
	// 80 characters and must be accepted, though it is more than 80 bytes.
	long := strings.Repeat("é", maxDisplayNameLen)
	if rec, out := doJSON(t, h, "PATCH", "/v1/auth/me/profile", access, map[string]any{
		"display_name": long,
	}); rec.Code != http.StatusOK {
		t.Errorf("an 80-character accented name was rejected: %d %v", rec.Code, out)
	}
}

func TestProfileUpdateNeedsAuthAndAField(t *testing.T) {
	h := newTestServer(t, "op-token")
	access, _ := register(t, h, "pat6@x.com")

	if rec, _ := doJSON(t, h, "PATCH", "/v1/auth/me/profile", "", map[string]any{
		"display_name": "Anyone",
	}); rec.Code != http.StatusUnauthorized {
		t.Errorf("unauthenticated patch: %d, want 401", rec.Code)
	}

	rec, out := doJSON(t, h, "PATCH", "/v1/auth/me/profile", access, map[string]any{})
	if rec.Code != http.StatusBadRequest || out["error"] != "nothing_to_update" {
		t.Errorf("empty body: %d %v", rec.Code, out)
	}
}

// One user must not be able to change another's profile. There is no user id
// in the path — the subject comes from the token — so this is really a check
// that no future edit adds one.
func TestProfileUpdateOnlyTouchesTheCaller(t *testing.T) {
	h := newTestServer(t, "op-token")
	alice, _ := register(t, h, "alice@x.com")
	bob, _ := register(t, h, "bob@x.com")

	doJSON(t, h, "PATCH", "/v1/auth/me/profile", alice, map[string]any{"display_name": "Alice A"})
	doJSON(t, h, "PATCH", "/v1/auth/me/profile", bob, map[string]any{"display_name": "Bob B"})

	_, out := doJSON(t, h, "GET", "/v1/auth/me", alice, nil)
	if got := out["user"].(map[string]any)["display_name"]; got != "Alice A" {
		t.Errorf("alice's profile = %v after bob wrote his", got)
	}
}
