package httpapi

// Controller discovery on the LAN.
//
// Admin-only, and a POST rather than a GET. Both are deliberate.
//
// A browse sends multicast traffic on the operator's network and takes seconds
// to answer. A GET that a browser might prefetch, retry or cache is the wrong
// shape for something with a side effect on the wire and a two-second floor on
// its latency.
//
// Admin-only because the RESULT is a map of what is on the network — instance
// names, addresses, device ids. That is reconnaissance, and there is no reason
// an ordinary member needs it.
//
// What this does NOT do is pair anything. mDNS is unauthenticated by
// construction: anything on the LAN can answer a browse, so a discovered
// controller is a suggestion with an address attached, and pairing still needs a
// claim token typed by a human. A discovery route that paired what it found
// would let a device on the guest wifi volunteer to be a gate controller.

import (
	"context"
	"net/http"
	"time"

	"github.com/vul-os/aql/hub/internal/discovery"
)

// discoveryMaxWindow bounds how long a caller can hold the request open.
const discoveryMaxWindow = 10 * time.Second

func (s *Server) handleDiscoverControllers(w http.ResponseWriter, r *http.Request) {
	accountID := r.PathValue("id")
	role, ok := s.memberRole(w, r, accountID)
	if !ok {
		return
	}
	if !isAdminRole(role) {
		writeErr(w, http.StatusForbidden, "forbidden")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), discoveryMaxWindow)
	defer cancel()

	found, err := discovery.Browse(ctx, discovery.DefaultBrowseWindow)
	if err != nil {
		// A send failure usually means multicast is unavailable — a container
		// with no multicast route, a network that filters it. That is a
		// different answer from "no controllers are here", and an operator
		// staring at an empty list needs to know which they got.
		writeErrDetail(w, http.StatusServiceUnavailable, "discovery_unavailable",
			map[string]any{"detail": err.Error()})
		return
	}

	out := make([]map[string]any, 0, len(found))
	for _, c := range found {
		m := map[string]any{
			"instance":  c.Instance,
			"device_id": c.DeviceID,
			"addr":      c.Addr,
			"proto":     c.Proto,
		}
		if len(c.Extra) > 0 {
			m["extra"] = c.Extra
		}
		out = append(out, m)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"controllers": out,
		// Said on every response, including a full one. A console rendering a
		// list of found devices is exactly where someone would reach for a
		// one-click "add", and this is the sentence that explains why there
		// isn't one.
		"note": "Anything on this network can answer a discovery browse, so these are " +
			"addresses to check, not devices to trust. Pairing still needs the claim " +
			"token from the controller itself.",
	})
}
