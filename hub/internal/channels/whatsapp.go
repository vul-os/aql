package channels

// WhatsApp (Meta Cloud API) — the primary channel and the full conversational
// contract inherited from the Workers backend's whatsapp.ts: interactive list picker for
// multiple access points, location select, welcome / linked-locations,
// unlinked signup prompt, visitor grants, honest denial replies, message-id
// dedupe and phone_number_id filtering. This file owns the provider-specific
// parts (verify, wire parse, reply rendering); the httpapi handler drives the
// flow through the shared open-path choke point.

import (
	"net/http"
	"net/url"
	"strings"

	"github.com/vul-os/aql/hub/internal/store"
)

// WhatsApp is the channel value (holds only what Verify needs; the rest is
// pure functions/rendering).
type WhatsApp struct {
	AppSecret   string
	VerifyToken string
	PublicURL   string
}

func (WhatsApp) Kind() string { return KindWhatsApp }

func (c WhatsApp) Verify(headers http.Header, body []byte, now int64) VerifyResult {
	return verifyWhatsAppSig(c.AppSecret, headers, body)
}

// VerifyChallenge answers Meta's GET handshake (hub.mode=subscribe): returns
// the challenge to echo + ok, else ok=false → 403. The verify token is
// plaintext and DISTINCT from the app secret used to HMAC POSTs.
func (c WhatsApp) VerifyChallenge(mode, token, challenge string) (string, bool) {
	if mode == "subscribe" && token != "" && c.VerifyToken != "" && constEq(token, c.VerifyToken) {
		return challenge, true
	}
	return "", false
}

// ---------------------------------------------------------------------------
// Inbound wire (backend WhatsAppPayload)
// ---------------------------------------------------------------------------

type WAPayload struct {
	Object string    `json:"object"`
	Entry  []WAEntry `json:"entry"`
}

type WAEntry struct {
	ID      string     `json:"id"`
	Changes []WAChange `json:"changes"`
}

type WAChange struct {
	Field string  `json:"field"`
	Value WAValue `json:"value"`
}

type WAValue struct {
	MessagingProduct string `json:"messaging_product"`
	Metadata         struct {
		DisplayPhoneNumber string `json:"display_phone_number"`
		PhoneNumberID      string `json:"phone_number_id"`
	} `json:"metadata"`
	Contacts []struct {
		WaID    string `json:"wa_id"`
		Profile struct {
			Name string `json:"name"`
		} `json:"profile"`
	} `json:"contacts"`
	Messages []WAMessage `json:"messages"`
	Statuses []struct {
		ID string `json:"id"`
	} `json:"statuses"`
}

type WAMessage struct {
	ID          string         `json:"id"`
	From        string         `json:"from"`
	Timestamp   string         `json:"timestamp"`
	Type        string         `json:"type"`
	Text        *WATextBody    `json:"text"`
	Interactive *WAInteractive `json:"interactive"`
}

type WATextBody struct {
	Body string `json:"body"`
}

type WAInteractive struct {
	Type        string       `json:"type"` // list_reply | button_reply
	ListReply   *WAReplyItem `json:"list_reply"`
	ButtonReply *WAReplyItem `json:"button_reply"`
}

type WAReplyItem struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description"`
}

// SelectedReply returns the tapped list/button item (or nil).
func (m *WAMessage) SelectedReply() *WAReplyItem {
	if m.Interactive == nil {
		return nil
	}
	if m.Interactive.ListReply != nil {
		return m.Interactive.ListReply
	}
	return m.Interactive.ButtonReply
}

// ---------------------------------------------------------------------------
// Outbound reply model (a WhatsApp reply is text OR interactive)
// ---------------------------------------------------------------------------

// WAReply is one queued reply; exactly one field is set.
type WAReply struct {
	Text        string
	Interactive *WhatsAppInteractive
}

func waInteractiveReply(i WhatsAppInteractive) WAReply { return WAReply{Interactive: &i} }

// waTitle truncates to WhatsApp's row/button title limits (default 24), adding
// an ellipsis. Backend waTitle().
func waTitle(v string, max int) string {
	if max <= 0 {
		max = 24
	}
	clean := strings.TrimSpace(v)
	r := []rune(clean)
	if len(r) <= max {
		return clean
	}
	cut := max - 1
	if cut < 1 {
		cut = 1
	}
	return strings.TrimRight(string(r[:cut]), " ") + "…"
}

// SignupLinkForPhone builds the signup deep-link the unlinked nudge sends.
func SignupLinkForPhone(publicURL, phoneE164 string) string {
	base := trimURL(publicURL)
	q := url.Values{"wa_phone": {phoneE164}}
	return base + "/signup?" + q.Encode()
}

func gateFooter(g store.AvailableAP) (string, bool) {
	if g.Type != store.APVisitor {
		return "", false
	}
	remaining := "unlimited"
	if g.MaxUses.Valid {
		rem := g.MaxUses.Int64 - g.UsesCount
		if rem < 0 {
			rem = 0
		}
		remaining = itoa(rem)
	}
	return "You have " + remaining + " uses remaining.", true
}

// waGateRows renders at most PickerCapacity gate rows, each carrying verb's
// selection command (open_ap: or close_ap:) as its id.
func waGateRows(verb GateVerb, gates []store.AvailableAP) []WhatsAppRow {
	selCmd := verb.SelectionCommand()
	rows := make([]WhatsAppRow, 0, PickerCapacity)
	for _, g := range gates {
		if len(rows) == PickerCapacity {
			break
		}
		rows = append(rows, WhatsAppRow{
			ID:          selCmd + ":" + g.APID,
			Title:       waTitle(g.APName, 24),
			Description: waTitle(g.LocName, 72),
		})
	}
	return rows
}

// PushGateMenu renders the gate picker for one location (button when a single
// gate, list otherwise) — backend pushGateMenu. Past PickerCapacity the list
// is truncated and SAYS SO in the body (TruncationNotice); a resident is never
// shown a short list that looks complete.
//
// verb is REQUIRED and is the whole point of this signature. This renderer is
// shared between the welcome/greeting menus (where open is genuinely what the
// resident is being offered) and the fallback for an open/close request that
// resolved to no gate — and it used to mint open_ap: rows for both, so "close
// the back gate" against a fleet with no `back gate` came back offering to
// open. Passing VerbOpen here is a decision, not a default: see verb.go.
func PushGateMenu(verb GateVerb, locationName string, gates []store.AvailableAP, publicURL string) WAReply {
	if len(gates) == 1 {
		g := gates[0]
		body := `Welcome to ` + locationName + `. Message "open" any time, or tap below to open ` + g.APName + `.`
		if verb != VerbOpen {
			// Any non-open request: no welcome, and it says plainly that
			// nothing has moved yet — in the verb's own words, because the
			// button below carries that verb and the two must agree.
			body = verb.NothingMovedYet() + ` Tap below to ` + verb.Infinitive() + ` ` + g.APName + `.`
		}
		i := WhatsAppInteractive{
			Type: "button",
			Body: WAText{Text: body},
			Action: WhatsAppAction{
				Buttons: []WhatsAppButton{{
					Type: "reply",
					Reply: WhatsAppButtonReply{
						ID:    verb.SelectionCommand() + ":" + g.APID,
						Title: waTitle(verb.Title()+" "+g.APName, 20),
					},
				}},
			},
		}
		if f, ok := gateFooter(g); ok {
			i.Footer = &WAText{Text: f}
		}
		return waInteractiveReply(i)
	}
	rows := waGateRows(verb, gates)
	prompt := "Welcome to " + locationName + ". Which gate would you like to open?"
	if verb != VerbOpen {
		prompt = verb.NothingMovedYet() + " Which gate would you like to " + verb.Infinitive() + "?"
	}
	i := WhatsAppInteractive{
		Type:   "list",
		Header: &WAText{Type: "text", Text: locationName},
		Body:   WAText{Text: withTruncationNotice(prompt, len(rows), len(gates), publicURL)},
		Action: WhatsAppAction{Button: "Select gate", Sections: []WhatsAppSection{{Title: "Available gates", Rows: rows}}},
	}
	if len(gates) > 0 {
		if f, ok := gateFooter(gates[0]); ok {
			i.Footer = &WAText{Text: f}
		}
	}
	return waInteractiveReply(i)
}

// PushAmbiguousGateMenu is the reply when a message named more than one gate
// ("open the front gate" against both `Gate` and `Front Gate`). It lists ONLY
// the gates that matched, names the ambiguity rather than hiding it, and
// actuates nothing — the tap that follows re-resolves and re-authorizes on the
// normal open_ap/close_ap path. Never call this with fewer than two candidates.
//
// The rows carry the verb the member actually asked for: an unresolved "close"
// must not come back as a row that opens. verb was a "open"/"close" string that
// treated anything else as open; it is now a GateVerb, so the only way to get
// open_ap: rows out of this is to ask for them (verb.go).
func PushAmbiguousGateMenu(verb GateVerb, candidates []store.AvailableAP, publicURL string) WAReply {
	rows := waGateRows(verb, candidates)
	return waInteractiveReply(WhatsAppInteractive{
		Type:   "list",
		Header: &WAText{Type: "text", Text: "Which one?"},
		Body: WAText{Text: withTruncationNotice(
			"That matches more than one gate, so I haven't "+verb.Past()+" anything. Which one did you mean?",
			len(rows), len(candidates), publicURL)},
		Action: WhatsAppAction{Button: "Select gate", Sections: []WhatsAppSection{{Title: "Matching gates", Rows: rows}}},
	})
}

// PushLocationMenu renders the "which location" list — backend pushLocationMenu.
//
// verb is REQUIRED for the same reason PushGateMenu's is, one hop earlier: the
// row ids are what the resident's tap comes back as, so the verb they asked for
// has to be minted into them or it is gone by the time the gate picker renders.
func PushLocationMenu(verb GateVerb, locations []store.LinkedLocation, publicURL string) WAReply {
	selCmd := verb.LocationCommand()
	rows := make([]WhatsAppRow, 0, PickerCapacity)
	for _, l := range locations {
		if len(rows) == PickerCapacity {
			break
		}
		rows = append(rows, WhatsAppRow{ID: selCmd + ":" + l.ID, Title: waTitle(l.Name, 24)})
	}
	prompt := "Welcome back. Which location do you want to use?"
	if verb != VerbOpen {
		prompt = verb.NothingMovedYet() + " Which location is the gate at?"
	}
	return waInteractiveReply(WhatsAppInteractive{
		Type:   "list",
		Header: &WAText{Type: "text", Text: "Locations"},
		Body:   WAText{Text: withTruncationNotice(prompt, len(rows), len(locations), publicURL)},
		Action: WhatsAppAction{Button: "Choose location", Sections: []WhatsAppSection{{Title: "Your locations", Rows: rows}}},
	})
}

// PushCloseButton renders the "Would you like to close X?" follow-up after a
// successful open — backend's post-open close button.
func PushCloseButton(accessPointID, gateName string) WAReply {
	return waInteractiveReply(WhatsAppInteractive{
		Type: "button",
		Body: WAText{Text: "Would you like to close " + gateName + "?"},
		Action: WhatsAppAction{Buttons: []WhatsAppButton{{
			Type: "reply",
			Reply: WhatsAppButtonReply{
				ID:    VerbClose.SelectionCommand() + ":" + accessPointID,
				Title: waTitle(VerbClose.Title()+" "+gateName, 20),
			},
		}}},
	})
}

// UniqueLocations collapses available APs to their distinct locations, order
// preserved — backend uniqueLocations.
func UniqueLocations(gates []store.AvailableAP) []store.LinkedLocation {
	seen := map[string]bool{}
	out := make([]store.LinkedLocation, 0, len(gates))
	for _, g := range gates {
		if seen[g.LocID] {
			continue
		}
		seen[g.LocID] = true
		out = append(out, store.LinkedLocation{ID: g.LocID, Name: g.LocName})
	}
	return out
}

// ---------------------------------------------------------------------------
// Free-text target resolution — ambiguity is an outcome, not a coin flip
// ---------------------------------------------------------------------------

// MatchOutcome is how a free-text mention resolved. It is deliberately a
// three-state outcome rather than a bool: with a bool, "several targets
// matched" is indistinguishable from "one target matched", and the caller
// silently actuates whichever one happened to come first in the slice. A
// caller must handle MatchAmbiguous explicitly — by asking — and cannot get
// there by ignoring a return value.
type MatchOutcome int

const (
	// MatchNone — no target's name was mentioned. Caller falls back to its
	// existing behaviour (a picker, or the single-candidate collapse).
	MatchNone MatchOutcome = iota
	// MatchUnique — exactly one target was mentioned. Safe to act on.
	MatchUnique
	// MatchAmbiguous — two or more distinct targets were mentioned. NOTHING
	// actuates: the caller must render the disambiguation picker. There is no
	// tie-break, by order or by anything else — see docs/CHAT-COMMANDS.md §3.5.
	MatchAmbiguous
)

func (o MatchOutcome) String() string {
	switch o {
	case MatchUnique:
		return "unique"
	case MatchAmbiguous:
		return "ambiguous"
	default:
		return "none"
	}
}

// GateMatch is the outcome of resolving a mention against the caller's
// authorized access points. AP is meaningful ONLY when Unique() is true.
type GateMatch struct {
	Outcome    MatchOutcome
	AP         store.AvailableAP   // valid iff Outcome == MatchUnique
	Candidates []store.AvailableAP // every distinct AP mentioned (>= 2 when ambiguous)
}

// Unique reports the one case in which a caller may act without asking.
func (m GateMatch) Unique() bool { return m.Outcome == MatchUnique }

// Ambiguous reports that the caller must render a picker instead of acting.
func (m GateMatch) Ambiguous() bool { return m.Outcome == MatchAmbiguous }

// LocationMatch is the same outcome shape for the location-narrowing stage.
type LocationMatch struct {
	Outcome    MatchOutcome
	Location   store.LinkedLocation   // valid iff Outcome == MatchUnique
	Candidates []store.LinkedLocation // every distinct location mentioned
}

func (m LocationMatch) Unique() bool    { return m.Outcome == MatchUnique }
func (m LocationMatch) Ambiguous() bool { return m.Outcome == MatchAmbiguous }

func outcomeFor(n int) MatchOutcome {
	switch {
	case n == 1:
		return MatchUnique
	case n > 1:
		return MatchAmbiguous
	default:
		return MatchNone
	}
}

// FindMentionedLocation / FindMentionedGate resolve a free-text mention ("open
// the side gate") to a target — backend findMentionedLocation/findMentionedGate.
//
// Both scan the WHOLE candidate list and report every distinct target whose
// name the body mentions on word boundaries (textIncludesName). They never
// return early on the first hit, so the answer does not depend on the order
// the store happened to return rows in: shuffle the slice and the outcome, and
// the resolved target, are identical. Candidates are de-duplicated by id — the
// same physical gate reachable twice (a member grant and a visitor grant) is
// one target, not an ambiguity.
func FindMentionedLocation(body string, locations []store.LinkedLocation) LocationMatch {
	var hits []store.LinkedLocation
	seen := map[string]bool{}
	for _, l := range locations {
		if seen[l.ID] || !textIncludesName(body, l.Name) {
			continue
		}
		seen[l.ID] = true
		hits = append(hits, l)
	}
	m := LocationMatch{Outcome: outcomeFor(len(hits)), Candidates: hits}
	if m.Unique() {
		m.Location = hits[0]
	}
	return m
}

func FindMentionedGate(body string, gates []store.AvailableAP) GateMatch {
	var hits []store.AvailableAP
	seen := map[string]bool{}
	for _, g := range gates {
		if seen[g.APID] || !textIncludesName(body, g.APName) {
			continue
		}
		seen[g.APID] = true
		hits = append(hits, g)
	}
	m := GateMatch{Outcome: outcomeFor(len(hits)), Candidates: hits}
	if m.Unique() {
		m.AP = hits[0]
	}
	return m
}

// ---------------------------------------------------------------------------
// Interactive selection ids
// ---------------------------------------------------------------------------

// The complete set of selection commands this gateway mints. Every id that
// travels over a chat rail is written by one of the renderers in this package
// ("open_ap:", "close_ap:", "select_loc:", "select_loc_close:" here;
// "open_ap:" on Telegram), and a provider echoes back the id verbatim — so
// nothing legitimate is unprefixed, and nothing legitimate carries a command
// outside this list.
//
// The two select_loc commands are the same narrowing step carrying the two
// verbs; see GateVerb.LocationCommand (verb.go) for why the verb has to ride
// on the id rather than be re-guessed after the tap. SelSelectLoc keeps its
// original wire value, so a location menu sent before this existed still
// resolves, and resolves to the verb it was rendered with.
const (
	SelOpenAP         = "open_ap"
	SelCloseAP        = "close_ap"
	SelSelectLoc      = "select_loc"
	SelSelectLocClose = "select_loc_close"
	// Hold ids are NEW, so no button already sitting in somebody's chat
	// history can resolve to one. The existing four keep their exact wire
	// values for the same reason.
	SelHoldAP        = "hold_ap"
	SelSelectLocHold = "select_loc_hold"
)

// selectionCommands is the allowlist ParseSelection validates against.
var selectionCommands = map[string]bool{
	SelOpenAP:         true,
	SelCloseAP:        true,
	SelSelectLoc:      true,
	SelSelectLocClose: true,
	SelHoldAP:         true,
	SelSelectLocHold:  true,
}

// ParseSelection splits an interactive reply id "cmd:arg" (backend split(':')).
//
// ok is false — and cmd/arg are empty — for an id with no ':' prefix, an empty
// command or argument, or a command outside selectionCommands. It previously
// returned ("open", id) for an unprefixed id, which made a malformed or
// unrecognised interactive reply resolve to the single most dangerous verb the
// gateway has. Fail closed instead: an id we did not mint actuates nothing.
// Callers MUST check ok before touching cmd.
func ParseSelection(id string) (cmd, arg string, ok bool) {
	i := strings.IndexByte(id, ':')
	if i < 0 {
		return "", "", false
	}
	cmd, arg = id[:i], id[i+1:]
	if arg == "" || !selectionCommands[cmd] {
		return "", "", false
	}
	return cmd, arg, true
}

// SelectionCommandVerb maps a selection command to the open-path verb it
// carries. The verb comes from this table, never from the id's text: ok is
// false for select_loc (a narrowing step, not an actuation) and for anything
// else. store/openpath.go still independently rejects any command outside
// open/close — this is the layer above that boundary, not a replacement for it.
func SelectionCommandVerb(cmd string) (verb string, ok bool) {
	switch cmd {
	case SelOpenAP:
		return "open", true
	case SelCloseAP:
		return "close", true
	case SelHoldAP:
		return "hold", true
	default:
		return "", false
	}
}
