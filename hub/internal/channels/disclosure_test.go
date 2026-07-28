package channels

import (
	"strings"
	"testing"
)

// KOTVA §26.3 requires four fields per rail, and this repo's whole problem with
// disclosure tables is that they are written once and never revisited. These
// tests are what stop that: a rail added without a declaration fails, and a
// declaration that quietly softens fails too.

// Every rail Aql speaks must declare. A rail without a disclosure is a rail
// whose exposure nobody stated.
func TestEveryLegacyRailDeclaresTheFourFields(t *testing.T) {
	// DMTAP is deliberately absent: it is the NATIVE protocol, not a §26 legacy
	// adapter bridging a platform. §26 governs adapters that terminate
	// encryption to speak someone else's rail; DMTAP is the thing they bridge
	// to. Listing it here would imply a third-party plaintext party that does
	// not exist.
	rails := []string{KindWhatsApp, KindTelegram, KindSlack, KindDiscord}

	for _, r := range rails {
		d, ok := Disclosure(r)
		if !ok {
			t.Errorf("rail %q has no §26.3 disclosure; its exposure is undeclared", r)
			continue
		}
		if d.Rail != r {
			t.Errorf("rail %q's disclosure claims to be %q", r, d.Rail)
		}
		if d.Platform == "" {
			t.Errorf("rail %q has no operator-facing platform name", r)
		}
		if d.InboundTransport == "" {
			t.Errorf("rail %q declares no inbound transport class (field 2)", r)
		}
		for name, dir := range map[string]Direction{"inbound": d.Inbound, "outbound": d.Outbound} {
			if dir.Initiation == "" {
				t.Errorf("rail %q %s: no initiation class (field 1)", r, name)
			}
			if dir.Price == "" {
				t.Errorf("rail %q %s: no price shape (field 3)", r, name)
			}
			if dir.Exposure == "" {
				t.Errorf("rail %q %s: no exposure (field 4)", r, name)
			}
		}
	}
}

// The honest-vs-flattering line, asserted rather than trusted.
//
// §26.5.1: node mode removes the GATEWAY OPERATOR as a second intermediary; it
// cannot remove the PLATFORM as the first. Every one of these rails has a third
// party reading the plaintext, in every mode, and a disclosure that said
// "nobody" or omitted the platform would be the exact misrepresentation §26.3
// field 4 exists to prevent.
func TestNoRailClaimsNobodySeesPlaintext(t *testing.T) {
	for _, d := range Disclosures() {
		for name, dir := range map[string]Direction{"inbound": d.Inbound, "outbound": d.Outbound} {
			low := strings.ToLower(dir.Exposure)
			if strings.Contains(low, "nobody") || strings.Contains(low, "no one") ||
				strings.Contains(low, "end-to-end") || strings.Contains(low, "only you") {
				t.Errorf("%s %s exposure claims privacy it does not have: %q",
					d.Rail, name, dir.Exposure)
			}
			// The platform must be NAMED. "a third party" is not a disclosure
			// a user can act on.
			//
			// Any significant word of the platform name counts, not the first
			// one: WhatsApp's plaintext party is META, and "Meta, always" is
			// MORE precise than saying "WhatsApp" — the company reading the
			// message is the fact, and the brand on the app is not. An earlier
			// version of this check demanded the first word and failed the
			// most accurate entry in the table.
			var named bool
			for _, w := range strings.FieldsFunc(strings.ToLower(d.Platform), func(r rune) bool {
				return r == ' ' || r == '(' || r == ')'
			}) {
				if len(w) > 2 && strings.Contains(low, w) {
					named = true
				}
			}
			if !named {
				t.Errorf("%s %s exposure names no concrete party from %q: %q",
					d.Rail, name, d.Platform, dir.Exposure)
			}
		}
	}
}

// None of these rails can cold-contact a stranger, and that is worth being able
// to state positively: it means none of them can be turned into a notification
// channel to someone who never opted in.
func TestNoRailCanInitiateColdContact(t *testing.T) {
	for _, d := range Disclosures() {
		if d.CanInitiate() {
			t.Errorf("%s declares it can freely initiate. If that is genuinely true "+
				"the abuse surface changed and the product needs to say so; if it is "+
				"a typo it is the most consequential field in the table", d.Rail)
		}
	}
}

// Field 2 answers the question a self-hoster actually asks, so the derived
// answer must follow from the declared class rather than being stored
// separately where it could disagree.
func TestCGNATAnswerFollowsFromTheDeclaredTransport(t *testing.T) {
	wa, _ := Disclosure(KindWhatsApp)
	if wa.InboundTransport != Webhook {
		t.Fatalf("WhatsApp transport = %q, want webhook", wa.InboundTransport)
	}
	if wa.RunsBehindCGNAT() {
		t.Error("WhatsApp is declared as webhook but claims to run behind CGNAT; " +
			"a webhook needs a reachable endpoint by definition")
	}

	// Only Discord is unconditional. Telegram (engine setting) and Slack
	// (app token present or not) both depend on configuration, so their answer
	// belongs to DisclosureFor — see the per-rail tests below.
	//
	// This test used to assert all three were outbound-persistent, which is
	// how both false claims survived: the guard agreed with them.
	for _, k := range []string{KindDiscord} {
		d, _ := Disclosure(k)
		if d.InboundTransport != OutboundPersistent {
			t.Errorf("%s transport = %q, want outbound-persistent", k, d.InboundTransport)
		}
		if !d.RunsBehindCGNAT() {
			t.Errorf("%s holds an outbound connection but claims it needs inbound "+
				"reachability", k)
		}
	}
}

// WhatsApp's two directions genuinely differ on price, and §26.3 is normative
// that these fields are per-direction. Flattening them would hide the cost that
// lands on a bill.
func TestPerDirectionFieldsAreNotFlattened(t *testing.T) {
	wa, _ := Disclosure(KindWhatsApp)
	if wa.Inbound.Price == wa.Outbound.Price {
		t.Errorf("WhatsApp declares the same price shape both ways (%q); receiving is "+
			"free in the service window and sending outside it is metered per "+
			"template", wa.Inbound.Price)
	}
	if wa.Outbound.Note == "" {
		t.Error("WhatsApp's outbound leg is template-walled outside the 24-hour window " +
			"and the disclosure does not say so")
	}
}

// Every rail here is self-hostable, which is what makes Aql's node-mode claim
// true rather than aspirational. Where that is hard, the note must say so —
// "you can self-host this" with no mention of the WhatsApp Business approval is
// technically true and practically misleading.
func TestSelfHostClaimsCarryTheirCaveats(t *testing.T) {
	for _, d := range Disclosures() {
		if !d.SelfHostable {
			t.Errorf("%s is not self-hostable, which breaks the node-mode claim; if "+
				"that is real it belongs in the docs prominently", d.Rail)
		}
		if d.SelfHostNote == "" {
			t.Errorf("%s claims self-hostability with no note on what it actually takes", d.Rail)
		}
	}
	wa, _ := Disclosure(KindWhatsApp)
	if !strings.Contains(strings.ToLower(wa.SelfHostNote), "business") {
		t.Error("WhatsApp's self-host note does not mention the Business account, " +
			"which is the barrier that makes it hard")
	}
}

// Telegram is the one rail whose inbound transport depends on configuration,
// and getting that wrong is not cosmetic: RunsBehindCGNAT derives its answer
// from the same field, so a hub that needs a public HTTPS endpoint would tell a
// self-hoster it does not.
//
// The static table declared OutboundPersistent unconditionally. For the whole
// period the polling engine was built but unwired, that was false for every
// install without exception — the webhook was the only path that ran.
func TestTelegramDisclosureFollowsTheConfiguredEngine(t *testing.T) {
	// Default: webhook, ingress required. Declared as the MORE demanding of
	// the two on purpose — a disclosure that does not know your configuration
	// must not assume the easier answer.
	for _, raw := range []string{"", "webhook", "poling", "  "} {
		d, ok := DisclosureFor(KindTelegram, Config{TelegramEngine: raw})
		if !ok {
			t.Fatalf("engine %q: no disclosure for telegram", raw)
		}
		if d.InboundTransport != Webhook {
			t.Errorf("engine %q: inbound transport %q, want %q", raw, d.InboundTransport, Webhook)
		}
		if d.RunsBehindCGNAT() {
			t.Errorf("engine %q: claims it runs behind CGNAT, but the webhook needs a "+
				"reachable HTTPS endpoint", raw)
		}
	}

	// Opted in: outbound, no ingress. Case- and whitespace-tolerant, because
	// ResolveTelegramEngine is.
	for _, raw := range []string{"polling", "Polling", " POLLING "} {
		d, _ := DisclosureFor(KindTelegram, Config{TelegramEngine: raw})
		if d.InboundTransport != OutboundPersistent {
			t.Errorf("engine %q: inbound transport %q, want %q", raw, d.InboundTransport, OutboundPersistent)
		}
		if !d.RunsBehindCGNAT() {
			t.Errorf("engine %q: long polling is entirely outbound and must run behind CGNAT", raw)
		}
		if strings.Contains(d.SelfHostNote, "HTTPS endpoint") {
			t.Errorf("engine %q: self-host note still demands an endpoint: %q", raw, d.SelfHostNote)
		}
	}
}

// Every other rail is mode-free, and must not acquire a mode by accident: an
// override keyed on the wrong rail would silently change what a self-hoster is
// told about Slack or Discord.
func TestOneRailsSettingDoesNotMoveAnother(t *testing.T) {
	// Three rails now vary with configuration — Telegram's engine, Slack's app
	// token, WhatsApp's engine — so the interesting property is no longer
	// "only Telegram varies". It is that a knob belongs to exactly one rail:
	// an override keyed on the wrong Kind would silently change what a
	// self-hoster is told about a rail they did not touch.
	knobs := []struct {
		name string
		cfg  Config
		rail string
	}{
		{"telegram engine", Config{TelegramEngine: "polling"}, KindTelegram},
		{"slack app token", Config{SlackAppToken: "xapp-1"}, KindSlack},
		{"whatsapp engine", Config{WhatsAppEngine: "bridge"}, KindWhatsApp},
	}
	base := DisclosuresFor(Config{})
	for _, k := range knobs {
		got := DisclosuresFor(k.cfg)
		if len(base) != len(got) {
			t.Fatalf("%s: rail count changed, %d vs %d", k.name, len(base), len(got))
		}
		for i := range base {
			if base[i].Rail == k.rail {
				continue
			}
			if base[i] != got[i] {
				t.Errorf("%s moved %s, which it has nothing to do with", k.name, base[i].Rail)
			}
		}
	}
}

// The bridge engine is a different rail wearing the same name. Two §26.3
// fields change with it, and the disclosure declared only the Cloud API's
// answers.
func TestWhatsAppDisclosureFollowsTheConfiguredEngine(t *testing.T) {
	// Default (Cloud API): metered outbound, template-walled, cannot cold-call.
	for _, raw := range []string{"", "cloud", "bridg", "  "} {
		d, ok := DisclosureFor(KindWhatsApp, Config{WhatsAppEngine: raw})
		if !ok {
			t.Fatalf("engine %q: no disclosure for whatsapp", raw)
		}
		if d.Outbound.Price != Metered {
			t.Errorf("engine %q: outbound price %q, want %q", raw, d.Outbound.Price, Metered)
		}
		if d.CanInitiate() {
			t.Errorf("engine %q: Cloud API cannot message a stranger first", raw)
		}
	}

	// Bridge: no template wall, no billing — and it CAN cold-initiate, which
	// is both the field's definition and the behaviour Meta bans numbers for.
	// Declaring otherwise would hide the risk an operator is taking on.
	for _, raw := range []string{"bridge", "Bridge", " BRIDGE "} {
		d, _ := DisclosureFor(KindWhatsApp, Config{WhatsAppEngine: raw})
		if d.Outbound.Price != Free {
			t.Errorf("engine %q: outbound price %q, want %q — an unofficial Web client "+
				"is a regular account with no per-message billing", raw, d.Outbound.Price, Free)
		}
		if !d.CanInitiate() {
			t.Errorf("engine %q: a WhatsApp Web client can message a number that never "+
				"wrote in; saying otherwise hides why Meta bans them", raw)
		}
		if !strings.Contains(d.SelfHostNote, "bans") {
			t.Errorf("engine %q: self-host note does not mention the ban risk: %q", raw, d.SelfHostNote)
		}
		if !strings.Contains(d.Platform, "unofficial") {
			t.Errorf("engine %q: platform still reads as Meta's official API: %q", raw, d.Platform)
		}
	}
}

// Selecting one rail's engine must not move another's fields.
func TestEngineOverridesStayOnTheirOwnRail(t *testing.T) {
	base := DisclosuresFor(Config{})
	both := DisclosuresFor(Config{TelegramEngine: "polling", WhatsAppEngine: "bridge"})
	if len(base) != len(both) {
		t.Fatalf("rail count changed: %d vs %d", len(base), len(both))
	}
	for i := range base {
		if base[i].Rail == KindTelegram || base[i].Rail == KindWhatsApp {
			continue
		}
		if base[i] != both[i] {
			t.Errorf("%s changed when another rail's engine was set", base[i].Rail)
		}
	}
}

// Slack's mode is decided by whether an app token exists, not by an engine
// setting: Socket Mode runs only when SLACK_APP_TOKEN is set, and the Events
// API webhook is registered unconditionally. A bot token plus a signing secret
// is a complete, working Slack install — and it needs ingress.
func TestSlackDisclosureFollowsTheAppToken(t *testing.T) {
	d, ok := DisclosureFor(KindSlack, Config{SlackBotToken: "xoxb-1", SlackSigningSecret: "s"})
	if !ok {
		t.Fatal("no disclosure for slack")
	}
	if d.InboundTransport != Webhook {
		t.Errorf("without an app token: transport %q, want %q", d.InboundTransport, Webhook)
	}
	if d.RunsBehindCGNAT() {
		t.Error("without an app token Slack arrives by webhook, which needs a reachable " +
			"endpoint; claiming CGNAT is safe here sends someone to set up a rail that " +
			"cannot receive")
	}

	withToken, _ := DisclosureFor(KindSlack, Config{SlackAppToken: "xapp-1"})
	if withToken.InboundTransport != OutboundPersistent {
		t.Errorf("with an app token: transport %q, want %q", withToken.InboundTransport, OutboundPersistent)
	}
	if !withToken.RunsBehindCGNAT() {
		t.Error("Socket Mode holds an outbound WebSocket and must report it runs behind CGNAT")
	}
}

// Discord's equivalent hazard cannot be read from this hub's config — the
// Interactions Endpoint URL lives in Discord's app settings — so it has to be
// said in words instead of derived.
func TestDiscordDisclosureNamesTheInteractionsEndpointFootgun(t *testing.T) {
	d, _ := DisclosureFor(KindDiscord, Config{})
	if !strings.Contains(d.SelfHostNote, "Interactions Endpoint") {
		t.Errorf("Discord's note does not warn that setting the Interactions Endpoint URL "+
			"puts the rail back into needing ingress: %q", d.SelfHostNote)
	}
}
