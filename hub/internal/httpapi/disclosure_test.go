package httpapi

import (
	"bytes"
	"log/slog"
	"net/http"
	"testing"

	"github.com/vul-os/aql/hub/internal/channels"
	"github.com/vul-os/aql/hub/internal/keys"
	"github.com/vul-os/aql/hub/internal/store"
)

// GET /v1/rails/disclosure — the machine-readable §26.3 declaration.
//
// It had no test at all, which is a poor state for the one surface whose entire
// purpose is saying true things about what each rail costs and requires. This
// covers the property that motivated the endpoint: it must describe THIS hub,
// not a hub in general.

func disclosureWith(t *testing.T, ch channels.Config) []map[string]any {
	t.Helper()
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	ks, err := keys.Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	s := New(Config{
		Version:    "test",
		PublicURL:  "https://gate.example",
		JWTSecret:  []byte("0123456789abcdef0123456789abcdef"),
		RateLimits: permissiveRL(),
		Channels:   ch,
	}, st, ks, slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)))

	rec, out := doJSON(t, s.Router(), "GET", "/v1/rails/disclosure", "", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("disclosure: %d %v", rec.Code, out)
	}
	rails, _ := out["rails"].([]any)
	if len(rails) < 4 {
		t.Fatalf("got %d rails, want the four this hub ships", len(rails))
	}
	list := make([]map[string]any, 0, len(rails))
	for _, r := range rails {
		list = append(list, r.(map[string]any))
	}
	return list
}

// disclosureFor is the common case: only the Telegram engine varies.
func disclosureFor(t *testing.T, engine string) []map[string]any {
	t.Helper()
	return disclosureWith(t, channels.Config{TelegramEngine: engine, PublicURL: "https://gate.example"})
}

func railNamed(t *testing.T, rails []map[string]any, name string) map[string]any {
	t.Helper()
	for _, r := range rails {
		if r["rail"] == name {
			return r
		}
	}
	t.Fatalf("no %s rail in the disclosure", name)
	return nil
}

// Unauthenticated on purpose — someone deciding whether they can run this
// behind CGNAT has not signed up yet. Worth pinning, because quietly putting it
// behind auth would make it useless for the question it exists to answer.
func TestRailDisclosureNeedsNoAuth(t *testing.T) {
	if rails := disclosureFor(t, ""); len(rails) < 4 {
		t.Fatalf("got %d rails", len(rails))
	}
}

// The answer must describe THIS hub. Telegram's inbound transport — and
// therefore whether it needs a public HTTPS endpoint — depends on
// AQL_TELEGRAM_ENGINE, and the table declared "outbound, no ingress needed"
// unconditionally until this test existed.
func TestRailDisclosureReflectsTheConfiguredTelegramEngine(t *testing.T) {
	def := railNamed(t, disclosureFor(t, ""), "telegram")
	if def["inbound_transport"] != "webhook" {
		t.Errorf("default telegram inbound_transport = %v, want webhook", def["inbound_transport"])
	}
	if def["runs_behind_cgnat"] != false {
		t.Error("a hub on the default webhook engine told a self-hoster the rail needs " +
			"no inbound reachability")
	}

	pol := railNamed(t, disclosureFor(t, "polling"), "telegram")
	if pol["inbound_transport"] != "outbound-persistent" {
		t.Errorf("polling telegram inbound_transport = %v, want outbound-persistent", pol["inbound_transport"])
	}
	if pol["runs_behind_cgnat"] != true {
		t.Error("long polling is entirely outbound and must report it runs behind CGNAT")
	}
}

// WhatsApp is the rail that genuinely cannot avoid ingress, and no
// configuration changes that. If it ever reports otherwise, someone behind
// CGNAT will set it up and find out at a gate.
func TestRailDisclosureKeepsWhatsAppHonestInEveryConfiguration(t *testing.T) {
	for _, engine := range []string{"", "polling", "webhook"} {
		wa := railNamed(t, disclosureFor(t, engine), "whatsapp")
		if wa["inbound_transport"] != "webhook" || wa["runs_behind_cgnat"] != false {
			t.Errorf("engine=%q: whatsapp reported %v / cgnat=%v; Meta's Cloud API only "+
				"speaks webhooks", engine, wa["inbound_transport"], wa["runs_behind_cgnat"])
		}
	}
}

// No rail may claim it can message a stranger first. That is a property of the
// platforms rather than of this code, and it is the single most load-bearing
// sentence in the disclosure: it is why these rails cannot be turned into a
// notification channel to someone who never wrote in.
func TestRailDisclosureNeverClaimsColdInitiation(t *testing.T) {
	for _, r := range disclosureFor(t, "") {
		if r["can_initiate"] != false {
			t.Errorf("%v claims it can initiate cold", r["rail"])
		}
	}
}

// Slack's mode is decided by whether an app token exists. A bot token plus a
// signing secret is a complete, working install — over the webhook, needing
// ingress — and the endpoint said otherwise.
func TestRailDisclosureReflectsSlackSocketMode(t *testing.T) {
	noToken := railNamed(t, disclosureWith(t, channels.Config{
		SlackBotToken: "xoxb-1", SlackSigningSecret: "s",
	}), "slack")
	if noToken["runs_behind_cgnat"] != false {
		t.Error("without SLACK_APP_TOKEN, Slack arrives by webhook and needs a reachable " +
			"endpoint; the endpoint claimed it runs behind CGNAT")
	}

	withToken := railNamed(t, disclosureWith(t, channels.Config{SlackAppToken: "xapp-1"}), "slack")
	if withToken["runs_behind_cgnat"] != true {
		t.Error("with an app token Socket Mode dials out and must report it runs behind CGNAT")
	}
}

// The endpoint must actually consult the configuration for EVERY rail that has
// a mode, not just the one that was fixed first. This is the generic version of
// the three per-rail tests: it fails if a rail grows a configuration-dependent
// answer that the handler does not pass through.
func TestRailDisclosureIsConfigDependentForEveryModedRail(t *testing.T) {
	base := disclosureWith(t, channels.Config{})
	for _, tc := range []struct {
		rail string
		cfg  channels.Config
	}{
		{"telegram", channels.Config{TelegramEngine: "polling"}},
		{"slack", channels.Config{SlackAppToken: "xapp-1"}},
		{"whatsapp", channels.Config{WhatsAppEngine: "bridge"}},
	} {
		before := railNamed(t, base, tc.rail)
		after := railNamed(t, disclosureWith(t, tc.cfg), tc.rail)
		same := before["inbound_transport"] == after["inbound_transport"] &&
			before["runs_behind_cgnat"] == after["runs_behind_cgnat"] &&
			before["can_initiate"] == after["can_initiate"] &&
			before["self_host_note"] == after["self_host_note"]
		if same {
			t.Errorf("%s answers identically with and without its configuration, so the "+
				"endpoint is not passing config through for it", tc.rail)
		}
	}
}
