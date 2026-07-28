package httpapi

// The §26.3 rail disclosures, served so the console renders them rather than
// restating them.
//
// This route is UNAUTHENTICATED, and that is the point rather than an
// oversight. The four fields exist so a person can compare adapters at a
// glance BEFORE committing to one — §26.3's own words — and a disclosure you
// must first create an account to read is not a disclosure that helps anyone
// decide. There is nothing account-specific in it: it describes what the
// platforms do, which is the same for everybody.
//
// It is also the reason the table lives in Go (internal/channels/disclosure.go)
// instead of in a markdown file. Prose is what rots; this repo has spent real
// effort this month on documentation that described a product two renames ago.
// One source, rendered everywhere.

import (
	"net/http"

	"github.com/vul-os/aql/hub/internal/channels"
)

func railDisclosureJSON(d channels.RailDisclosure) map[string]any {
	dir := func(x channels.Direction) map[string]any {
		m := map[string]any{
			"initiation": string(x.Initiation),
			"price":      string(x.Price),
			"exposure":   x.Exposure,
		}
		if x.Note != "" {
			m["note"] = x.Note
		}
		return m
	}
	return map[string]any{
		"rail":              d.Rail,
		"platform":          d.Platform,
		"inbound_transport": string(d.InboundTransport),
		"inbound":           dir(d.Inbound),
		"outbound":          dir(d.Outbound),
		"self_hostable":     d.SelfHostable,
		"self_host_note":    d.SelfHostNote,

		// Derived from the declared transport rather than stored, so it cannot
		// disagree with it. This is the question a self-hoster actually asks.
		"runs_behind_cgnat": d.RunsBehindCGNAT(),
		"can_initiate":      d.CanInitiate(),
	}
}

func (s *Server) handleRailDisclosures(w http.ResponseWriter, _ *http.Request) {
	all := channels.DisclosuresFor(s.cfg.Channels)
	out := make([]map[string]any, 0, len(all))
	for _, d := range all {
		out = append(out, railDisclosureJSON(d))
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"rails": out,
		// The sentence the four fields cannot carry on their own, and the one
		// most likely to be left out of a UI that renders only the table.
		//
		// §26.5.1: node mode removes the gateway OPERATOR as a second
		// intermediary; it cannot remove the PLATFORM as the first. Shipping
		// the fields without this note would let a console present "you host
		// it yourself" as though it meant nobody else reads the messages.
		"note": "Every rail here is self-hosted: the WhatsApp number, the bot token and " +
			"the app all belong to whoever runs this hub. That removes any middleman " +
			"operator — it does not remove the platform. Meta reads every WhatsApp " +
			"message, Telegram reads every Telegram message, and so on. None of these " +
			"rails is end-to-end encrypted to your hub.",
		"spec": "KOTVA §26.3",
	})
}
