package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"

	"github.com/vul-os/aql/hub/internal/store"
)

// The user's own display profile: PATCH /v1/auth/me/profile.
//
// The profiles table has existed since the baseline schema and the row is
// written when a user registers, but nothing ever read it back or updated it.
// The console shipped a profile form regardless, pointed at a route that did
// not exist — so "Save profile" failed for every user, every time, and the
// route-parity test recorded that as an acknowledged gap rather than a bug.
// This closes it.
//
// # Why https is enforced here and not only in the browser
//
// The console's own help text says "https only", and a promise made in UI copy
// that the server does not keep is not a rule — it is a suggestion to anyone
// who does not use the console. The avatar URL is rendered as an <img src> in
// every member's browser, so the value is a small piece of content that one
// member chooses and others load:
//
//   - http:// would be mixed content on an https console: blocked in some
//     browsers, a silent downgrade in others.
//   - data: can carry a payload of arbitrary size into every viewer's page.
//   - anything else (javascript:, file:, custom schemes) has no business in an
//     image source and exists here only as a way to probe a renderer.
//
// The hub does not fetch this URL itself, so this is not an SSRF boundary and
// is not presented as one. It bounds what one member can push into another
// member's page.
const maxAvatarURLLen = 1024

// maxDisplayNameLen matches the console's own maxLength, so the form and the
// hub cannot disagree about what is too long.
const maxDisplayNameLen = 80

// optionalString distinguishes THREE states a PATCH field can be in: absent,
// present-and-null, and present-with-a-value.
//
// A plain *string collapses the first two — encoding/json leaves the pointer
// nil for both an omitted key and an explicit null — and that is exactly wrong
// here. The console clears an avatar by sending {"avatar_url": null}, so with a
// *string the Clear avatar button would report success and change nothing: the
// handler would read "not mentioned" and leave the row alone.
//
// UnmarshalJSON is called for a JSON null as well as for a value (encoding/json
// documents this), which is what makes Set a reliable "the client mentioned
// this field" signal.
type optionalString struct {
	Set   bool
	Value string // "" when the client sent null
}

func (o *optionalString) UnmarshalJSON(b []byte) error {
	o.Set = true
	if string(b) == "null" {
		o.Value = ""
		return nil
	}
	return json.Unmarshal(b, &o.Value)
}

type updateProfileReq struct {
	DisplayName optionalString `json:"display_name"`
	AvatarURL   optionalString `json:"avatar_url"`
}

func (s *Server) handleProfileUpdate(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	u, err := s.store.UserByID(r.Context(), c.Sub)
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var req updateProfileReq
	if !readJSON(w, r, &req) {
		return
	}
	if !req.DisplayName.Set && !req.AvatarURL.Set {
		// Not an error worth inventing a code for, but not a silent success
		// either: a body with no recognised field almost always means the
		// caller misspelled one.
		writeErr(w, http.StatusBadRequest, "nothing_to_update")
		return
	}

	// A display name may be changed but not erased: it is what other members
	// see in a member list and an audit row, and a blank one leaves them
	// looking at nothing. An avatar has no such duty and may be cleared.
	var displayName *string
	if req.DisplayName.Set {
		name := strings.TrimSpace(req.DisplayName.Value)
		if name == "" || len([]rune(name)) > maxDisplayNameLen {
			writeErr(w, http.StatusBadRequest, "invalid_display_name")
			return
		}
		displayName = &name
	}

	var avatarURL *string
	if req.AvatarURL.Set {
		raw := strings.TrimSpace(req.AvatarURL.Value)
		if raw != "" {
			if len(raw) > maxAvatarURLLen {
				writeErr(w, http.StatusBadRequest, "invalid_avatar_url")
				return
			}
			parsed, err := url.Parse(raw)
			if err != nil || !strings.EqualFold(parsed.Scheme, "https") || parsed.Host == "" {
				writeErr(w, http.StatusBadRequest, "invalid_avatar_url")
				return
			}
		}
		avatarURL = &raw
	}

	p, perr := s.store.ProfileUpdate(r.Context(), u.ID, displayName, avatarURL)
	if perr != nil {
		if errors.Is(perr, store.ErrProfileMissing) {
			writeErr(w, http.StatusNotFound, "profile_not_found")
			return
		}
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"profile": profileJSON(p)})
}

// profileJSON is the one place a profile becomes wire shape, so /auth/me and
// the PATCH response cannot drift into describing the same row differently.
func profileJSON(p *store.Profile) map[string]any {
	var name, avatar, source any
	if p.DisplayName != "" {
		name = p.DisplayName
	}
	if p.AvatarURL != "" {
		avatar = p.AvatarURL
	}
	if p.AvatarSource != "" {
		source = p.AvatarSource
	}
	return map[string]any{
		"id":            p.UserID,
		"display_name":  name,
		"avatar_url":    avatar,
		"avatar_source": source,
	}
}
