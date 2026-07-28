package lanserver

import (
	"net/http"
	"net/url"
	"strings"
)

// Browser access to the LAN grant endpoints.
//
// # What this is for
//
// The console can hold an offline grant and can build a signed proof, but in an
// ordinary browser tab it could never PRESENT one: this listener answers signed
// JSON and set no CORS headers, so the browser refused to let the page read the
// challenge and the handshake died before reaching the gate. Presenting worked
// only inside the desktop shell, whose native HTTP client is not subject to the
// rule. src/lib/offline/service.ts said exactly that in lanTransportAvailable().
//
// # Why the policy is one origin and not "*"
//
// CORS is NOT the authorization boundary here and must not be mistaken for one.
// Authority comes from the Ed25519-signed, single-use grant and proof, which
// grants.Exchange verifies against the hub key this controller pinned at
// pairing. A request carrying no valid grant is denied whatever its origin.
//
// What CORS decides is who may READ the answer, and that matters for a
// different reason: with "*", any page on the internet could POST to
// 192.168.x.x:8737 and read the reply, turning every controller into a probe
// target for LAN scanning and device fingerprinting from a drive-by tab. The
// gate would stay shut, and the attacker would still learn that a controller
// exists, which device id it carries, and how it answers.
//
// So the allowed origin is exactly one: the console of the hub this controller
// is PAIRED to, derived from the pairing record's WSURL. A browser cannot forge
// its Origin header, so only a page actually served by that hub can read these
// responses. An unpaired controller allows nothing at all.
//
// # What this does not fix
//
// A console served over https talking to a plain-http controller is blocked as
// mixed content before CORS is ever consulted, and no header here changes that.
// This helps the self-hosted case the product is built around — a hub on your
// own network, reached over http — and the desktop shell continues to work
// regardless.

// OriginFromWSURL derives the hub console's browser origin from the WebSocket
// URL stored at pairing.
//
// ws:// → http://, wss:// → https://, port preserved, everything else
// discarded: an Origin header is scheme + host + port and nothing more, so a
// path or query left on would produce a value no browser will ever send and a
// comparison that always fails.
//
// Returns "" when the URL is unusable, which callers must treat as "allow
// nothing" rather than "allow anything".
func OriginFromWSURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return ""
	}
	var scheme string
	switch strings.ToLower(u.Scheme) {
	case "ws", "http":
		scheme = "http"
	case "wss", "https":
		scheme = "https"
	default:
		// Not a scheme a browser page can be served from. Refuse rather than
		// guess: a wrong origin here is a silent, permanent handshake failure.
		return ""
	}
	return scheme + "://" + u.Host
}

// withCORS wraps h so that exactly one origin may read the responses.
//
// allowOrigin == "" disables browser access entirely — no headers, no preflight
// answer — which is the correct state for an unpaired controller and the
// behaviour every deployment had before this existed.
func withCORS(allowOrigin string, h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")

		// Vary is not optional. Without it a shared cache can serve a response
		// carrying one origin's header to a page from another, which turns a
		// correct policy into an incorrect one at the cache layer.
		w.Header().Add("Vary", "Origin")

		allowed := allowOrigin != "" && origin != "" && origin == allowOrigin
		if allowed {
			w.Header().Set("Access-Control-Allow-Origin", allowOrigin)
			// Deliberately NOT Access-Control-Allow-Credentials. Nothing here
			// reads a cookie or an Authorization header — the signed grant is
			// the whole credential — and allowing them would let an
			// authenticated session be replayed at a gate by a page that
			// merely shares the origin.
			w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
			// Preflight results are cached per-origin by the browser; ten
			// minutes keeps a redemption from paying for a second round trip
			// without pinning a stale policy across a re-pairing.
			w.Header().Set("Access-Control-Max-Age", "600")
		}

		if r.Method == http.MethodOptions {
			// A preflight from a disallowed origin gets a bare 204 with no
			// allow headers: the browser then refuses the real request, and
			// the controller has revealed nothing it would not reveal to any
			// TCP connection.
			w.WriteHeader(http.StatusNoContent)
			return
		}
		h.ServeHTTP(w, r)
	})
}
