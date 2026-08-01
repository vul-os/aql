package channels

// The four fields KOTVA §26.3 requires every legacy-rail adapter to declare.
//
// # Why this is Go and not a table in a markdown file
//
// §26.3 accepts documentation for a node-mode-only adapter, and Aql is
// node-mode: the WhatsApp number, the Telegram bot and the Slack app all belong
// to whoever runs the hub. So prose would satisfy the letter of it.
//
// Prose is what rots. This repo has spent a lot of effort this month finding
// documentation that described a product two renames ago, and the pattern is
// always the same — the code changed and the sentence did not. A disclosure
// table is exactly the kind of sentence nobody revisits, and it is the one an
// operator makes a routing decision on.
//
// So the declaration lives beside the rails it describes, a test asserts that
// every registered rail has one, and the console and the docs render FROM it.
// The claim and the thing it describes cannot drift apart because there is only
// one of them.
//
// # The honest-vs-flattering line, which runs straight through field 4
//
// It is tempting to describe node mode as "nobody sees your messages but you".
// That is false on all four of these rails and §26.5.1 says so directly: node
// mode removes the GATEWAY OPERATOR as a second intermediary; it cannot remove
// the PLATFORM as the first. Meta reads every WhatsApp message on the way
// through. So does Telegram, so does Slack.
//
// Exposure is therefore stated per rail AND per mode, and node mode never says
// "nobody". A user choosing how to open their gate deserves to know that the
// convenient rail is the one with a third party reading it.
//
// # Where the numbers come from
//
// Copied from kotva's own table (crates/kotva-mail/src/adapters/mod.rs), not
// re-derived from the prose. Two implementations reading the same spec and
// agreeing is worth nothing if one of them read it wrong; copying the
// normative source means a disagreement is a diff rather than a subtle
// behavioural difference nobody notices.

import "sort"

// InitiationClass is §26.3 field 1: can this rail contact a stranger cold?
//
// The load-bearing field, because it decides whether the rail can do the one
// thing a legacy bridge exists for.
type InitiationClass string

const (
	// FreelyInitiating — can contact a party who has never interacted with
	// this identity, given only an address. Email and SMS. None of Aql's
	// rails are this.
	FreelyInitiating InitiationClass = "freely-initiating"
	// InboundTriggered — the other party MUST speak first, or this side may
	// send only a constrained class of message. Template windows, bots that
	// cannot DM first, workspace-install requirements: §26.4 is explicit that
	// these are instances of ONE field rather than separate platform quirks.
	InboundTriggered InitiationClass = "inbound-triggered"
)

// InboundTransportClass is §26.3 field 2: how does this rail receive?
//
// This is the field that decides whether a hub behind CGNAT can run the rail at
// all, which is the single most practical fact about it for a self-hoster.
type InboundTransportClass string

const (
	// HardwareLocal — inbound arrives on hardware the adapter owns. Needs no
	// network reachability whatsoever.
	HardwareLocal InboundTransportClass = "hardware-local"
	// OutboundPersistent — the adapter holds a connection open and receives
	// over it. Works behind CGNAT with no public endpoint.
	OutboundPersistent InboundTransportClass = "outbound-persistent"
	// Webhook — the platform calls back over HTTPS. Needs a reachable
	// endpoint, which is the reachability problem, not a detail.
	Webhook InboundTransportClass = "webhook"
	// Listener — the adapter runs a server the world dials. Needs a public
	// address.
	Listener InboundTransportClass = "listener"
)

// PriceShape is §26.3 field 3.
type PriceShape string

const (
	// Metered — real marginal cost per message, passed through.
	Metered PriceShape = "metered"
	// Flat — a fixed fee unrelated to volume.
	Flat PriceShape = "flat"
	// Free — no per-message cost.
	Free PriceShape = "free"
)

// Direction carries the fields that differ by which way a message flows.
//
// §26.3 is normative that these are PER-DIRECTION, not per-platform: WhatsApp
// answers field 3 differently inbound and outbound, and flattening that into
// one number per rail hides the cost that actually lands on a bill.
type Direction struct {
	Initiation InitiationClass
	Price      PriceShape
	// Exposure is field 4 for THIS direction in NODE mode — who sees
	// plaintext. Never "nobody" on any of these rails.
	Exposure string
	// Note carries the qualification a bare enum loses, e.g. WhatsApp's
	// outbound leg being free inside the service window and template-walled
	// outside it. Empty when the fields say everything.
	Note string
}

// RailDisclosure is the full §26.3 declaration for one rail.
type RailDisclosure struct {
	// Rail is the channel Kind's own constant (an untyped string in this
	// package), so a disclosure cannot be attached to a rail that does not
	// exist without the constant being invented too.
	Rail string
	// Platform is the operator-facing name.
	Platform string

	InboundTransport InboundTransportClass
	Inbound          Direction
	Outbound         Direction

	// SelfHostable says whether a user can run this rail on their own account
	// with no third-party operator. All four of Aql's rails are, which is what
	// makes the node-mode claim true rather than aspirational — though
	// obtaining a WhatsApp Business account is a real barrier and the note
	// says so.
	SelfHostable bool
	// SelfHostNote is the honest caveat on that, or empty.
	SelfHostNote string
}

// disclosures is the table. Copied from kotva/crates/kotva-mail/src/adapters/mod.rs.
var disclosures = map[string]RailDisclosure{
	KindWhatsApp: {
		Rail:     KindWhatsApp,
		Platform: "WhatsApp (Meta)",
		// The only rail here needing a reachable HTTPS endpoint — which is why
		// it is the one a hub behind CGNAT cannot run without help.
		InboundTransport: Webhook,
		Inbound: Direction{
			Initiation: InboundTriggered,
			Price:      Free,
			Exposure:   "Meta, always — plus you, on your own WhatsApp Business account",
			Note:       "Free to receive within the 24-hour service window.",
		},
		Outbound: Direction{
			Initiation: InboundTriggered,
			Price:      Metered,
			Exposure:   "Meta, always — plus you",
			Note: "Outside the 24-hour window this leg cannot originate freely at all: " +
				"only pre-approved templates, billed per message.",
		},
		SelfHostable: true,
		SelfHostNote: "Needs your own WhatsApp Business account and a reachable HTTPS " +
			"endpoint. Both are real work; the account approval is the harder one.",
	},
	KindTelegram: {
		Rail:     KindTelegram,
		Platform: "Telegram",
		// WEBHOOK, because that is what an unconfigured install runs.
		//
		// Telegram is the one rail whose inbound transport depends on
		// configuration: AQL_TELEGRAM_ENGINE=polling switches it to getUpdates,
		// which is entirely outbound. This entry said OutboundPersistent
		// unconditionally, so every install was told the rail needs no ingress
		// — and RunsBehindCGNAT, derived from this field, said the same. For
		// the whole period the polling engine was built but unwired, that was
		// false for every install without exception.
		//
		// Declared as the more demanding of the two deliberately: a disclosure
		// that does not know your configuration must not assume the easier
		// answer. DisclosureFor applies the override when polling is really
		// selected.
		InboundTransport: Webhook,
		Inbound: Direction{
			Initiation: InboundTriggered,
			Price:      Free,
			Exposure:   "Telegram, always — plus you",
		},
		Outbound: Direction{
			Initiation: InboundTriggered,
			Price:      Free,
			Exposure:   "Telegram, always — plus you",
			Note:       "A bot cannot message you first; you must start the conversation.",
		},
		SelfHostable: true,
		SelfHostNote: "A bot token from @BotFather, and a reachable HTTPS endpoint for " +
			"the webhook. Set AQL_TELEGRAM_ENGINE=polling and the hub dials out " +
			"instead, needing no endpoint at all.",
	},
	KindDiscord: {
		Rail:             KindDiscord,
		Platform:         "Discord",
		InboundTransport: OutboundPersistent,
		Inbound: Direction{
			Initiation: InboundTriggered,
			Price:      Free,
			Exposure:   "Discord, always — plus you",
		},
		Outbound: Direction{
			Initiation: InboundTriggered,
			Price:      Free,
			Exposure:   "Discord, always — plus you",
			Note:       "Requires a shared guild; the bot cannot reach someone outside it.",
		},
		SelfHostable: true,
		// Not config-derivable: the Interactions Endpoint URL is set in
		// Discord's own app settings, so this hub cannot see it. Stated in the
		// note instead, because it is the one way a Discord operator can
		// accidentally put the rail back into needing ingress.
		SelfHostNote: "Your own bot application. No public endpoint needed — the hub " +
			"holds the Gateway WebSocket open. Leave the Interactions Endpoint URL " +
			"UNSET in your Discord app: setting it turns button taps into webhooks " +
			"and this rail then needs a reachable endpoint after all.",
	},
	KindSlack: {
		Rail:     KindSlack,
		Platform: "Slack",
		// WEBHOOK, because that is what an install without an app token runs.
		//
		// Slack has BOTH paths and the hub serves both: Socket Mode (outbound
		// WSS) when SLACK_APP_TOKEN is set, and the Events API webhook at
		// /webhooks/slack, which is registered unconditionally. This entry
		// declared outbound-persistent regardless, so an operator with a bot
		// token and a signing secret — a complete, working Slack install — was
		// told the rail needs no inbound reachability. It does.
		//
		// Same reasoning as Telegram: declare the more demanding answer and let
		// DisclosureFor relax it when the configuration actually earns it.
		InboundTransport: Webhook,
		Inbound: Direction{
			Initiation: InboundTriggered,
			Price:      Free,
			Exposure:   "Slack, always — plus you",
		},
		Outbound: Direction{
			Initiation: InboundTriggered,
			Price:      Free,
			Exposure:   "Slack, always — plus you",
			Note:       "Requires a workspace install; the app cannot reach someone outside it.",
		},
		SelfHostable: true,
		SelfHostNote: "Your own Slack app. With an app token (Socket Mode) the hub dials " +
			"out and needs no public endpoint; without one, events arrive by webhook " +
			"and you need a reachable HTTPS endpoint.",
	},
}

// DisclosureFor returns the declaration for one rail as CONFIGURED, applying
// the overrides that depend on how this hub is set up.
//
// Today exactly one rail has any: Telegram's inbound transport is the webhook
// by default and outbound-persistent under AQL_TELEGRAM_ENGINE=polling. That
// is not a detail — it decides whether the rail needs a public HTTPS endpoint,
// which is the question a self-hoster behind CGNAT is actually asking, and
// RunsBehindCGNAT derives its answer from this field.
//
// Kept as an override over the static table rather than folded into it, so the
// table stays readable as the contract and this stays readable as the
// deviation. If a second rail grows a mode, it belongs here too.
func DisclosureFor(k string, cfg Config) (RailDisclosure, bool) {
	d, ok := disclosures[k]
	if !ok {
		return d, false
	}
	if k == KindTelegram && ResolveTelegramEngine(cfg.TelegramEngine) == TelegramEnginePolling {
		d.InboundTransport = OutboundPersistent
		d.SelfHostNote = "A bot token from @BotFather. This hub is configured for long " +
			"polling, so it dials out and needs no public endpoint — the rail works " +
			"behind CGNAT."
	}

	// Slack's mode is decided by whether an app token exists, not by an engine
	// setting: Socket Mode runs only when SLACK_APP_TOKEN is set
	// (httpapi.Server.New), and the Events API webhook is always registered.
	if k == KindSlack && cfg.SlackAppToken != "" {
		d.InboundTransport = OutboundPersistent
		d.SelfHostNote = "Your own Slack app. This hub has an app token, so Socket Mode " +
			"holds an outbound WebSocket and no public endpoint is needed — the rail " +
			"works behind CGNAT."
	}

	// WhatsApp's bridge engine is a different rail wearing the same name, and
	// two of the four §26.3 fields change with it.
	//
	// Field 3 (price): Meta's Cloud API meters outbound and walls it behind
	// pre-approved templates outside the 24-hour service window. An unofficial
	// WhatsApp Web client is a regular account — no per-message billing, no
	// template wall. Declaring "metered, templates only" to a bridge operator
	// describes constraints they do not have and a bill they will not get.
	//
	// Field 1 (initiation): this is the uncomfortable one, and it is why the
	// override exists. A WhatsApp Web client CAN message a number that has
	// never written in — that is the field's definition, and it is also
	// exactly the behaviour Meta bans numbers for. Aql's own code only ever
	// replies to inbound, but field 1 asks what the RAIL can do, and an
	// operator choosing this engine is choosing a rail that can cold-initiate.
	// Saying otherwise would be the comfortable omission this table exists to
	// prevent.
	if k == KindWhatsApp && ResolveWhatsAppEngine(cfg.WhatsAppEngine) == WhatsAppEngineBridge {
		d.Platform = "WhatsApp (via an unofficial Web-client bridge, NOT Meta's Cloud API)"
		d.Inbound.Initiation = FreelyInitiating
		d.Outbound.Initiation = FreelyInitiating
		d.Outbound.Price = Free
		d.Outbound.Note = "No template wall and no per-message billing: this is a regular " +
			"WhatsApp account driven by an unofficial client. Aql itself only ever " +
			"replies to inbound messages."
		d.SelfHostNote = "Your own bridge (e.g. Evolution API) and a WhatsApp account. " +
			"Meta actively detects and bans automated clients — reported number " +
			"survival is commonly weeks. Never let this be the only way to open a gate."
	}
	return d, true
}

// DisclosuresFor returns every declaration as configured, ordered by rail.
func DisclosuresFor(cfg Config) []RailDisclosure {
	out := make([]RailDisclosure, 0, len(disclosures))
	for k := range disclosures {
		d, _ := DisclosureFor(k, cfg)
		out = append(out, d)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Rail < out[j].Rail })
	return out
}

// Disclosure returns the §26.3 declaration for a rail.
//
// The second return is false for a Kind with no disclosure, which a test
// forbids for any registered rail — so a false here in production means a rail
// was added without one.
// NO PRODUCTION CALLER, and production must not acquire one — use DisclosureFor.
//
// This returns the DECLARED table verbatim. DisclosureFor takes the Config and
// corrects it: with AQL_TELEGRAM_ENGINE=polling, Telegram's inbound transport is
// OutboundPersistent rather than a webhook, and this function does not know
// that. Serving it from /v1/rails/disclosure on a polling hub would publish a
// transport claim that is false for that deployment — on the surface whose
// entire purpose is telling people what a rail costs them.
//
// It stays because the tests that assert properties of the DECLARATION — "no
// rail can cold-initiate", the per-direction shape — are asking about the table
// itself and not about one configuration of it. That is the right subject for
// them, and DisclosuresFor(Config{}) would quietly narrow it to a single config.
func Disclosure(k string) (RailDisclosure, bool) {
	d, ok := disclosures[k]
	return d, ok
}

// Disclosures returns every declaration, ordered by rail. Same rule as
// Disclosure above: tests only, because it does not read the Config.
func Disclosures() []RailDisclosure {
	out := make([]RailDisclosure, 0, len(disclosures))
	for _, d := range disclosures {
		out = append(out, d)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Rail < out[j].Rail })
	return out
}

// RunsBehindCGNAT reports whether this rail needs no inbound reachability.
//
// Derived from field 2 rather than stored, so it cannot disagree with it. This
// is the question a self-hoster actually asks, and answering it from the
// declared transport class means the answer is true by construction.
func (d RailDisclosure) RunsBehindCGNAT() bool {
	switch d.InboundTransport {
	case OutboundPersistent, HardwareLocal:
		return true
	default:
		return false
	}
}

// CanInitiate reports whether this rail can contact someone who has not spoken
// first, in either direction.
//
// False for every rail Aql speaks, which is worth being able to state
// positively: none of them can be used to cold-contact anyone, so none of them
// can be turned into a notification channel to a stranger.
func (d RailDisclosure) CanInitiate() bool {
	return d.Inbound.Initiation == FreelyInitiating ||
		d.Outbound.Initiation == FreelyInitiating
}
