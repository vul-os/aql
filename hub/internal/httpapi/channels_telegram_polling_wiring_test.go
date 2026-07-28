package httpapi

import (
	"bytes"
	"log/slog"
	"testing"

	"github.com/vul-os/aql/hub/internal/channels"
	"github.com/vul-os/aql/hub/internal/keys"
	"github.com/vul-os/aql/hub/internal/store"
)

// The Telegram poller has to be REACHABLE, not merely correct.
//
// channels/telegram_polling.go and channels_telegram_polling.go were both
// complete and tested for a long time — the getUpdates loop, the durable
// offset, the shared dispatch, the authenticity notice — and nothing in the
// server ever constructed one. NewTelegramPoller's own doc comment carried the
// two wiring lines as a suggestion, "in the two files this change deliberately
// does not touch". So the zero-ingress path for that rail could not be turned
// on by any operator, however they configured it.
//
// That is this repository's most-repeated defect: a component finished, unit
// tested, and reached by nothing. Its unit tests all passed throughout.
//
// These tests assert the thing those unit tests structurally cannot: that a
// Server built from ordinary config ends up with the poller in its dial set,
// and — just as important — that it does NOT when the operator has not opted
// in.

func pollerFor(t *testing.T, engine, token string) (*Server, channels.DialChannel) {
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
		Channels: channels.Config{
			TelegramBotToken: token,
			TelegramEngine:   engine,
			PublicURL:        "https://gate.example",
		},
	}, st, ks, slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)))

	for _, d := range s.dial {
		if d != nil && d.Kind() == "telegram" {
			return s, d
		}
	}
	return s, nil
}

func TestTelegramPollerIsWiredWhenOptedIn(t *testing.T) {
	s, d := pollerFor(t, "polling", "123:abc")
	if d == nil {
		t.Fatalf("AQL_TELEGRAM_ENGINE=polling with a bot token produced no telegram "+
			"dial channel; the poller is unreachable. dial has %d entries", len(s.dial))
	}
	if !d.Enabled() {
		t.Error("the telegram poller is in the dial set but reports Enabled() == false, " +
			"so StartChannels will skip it")
	}
}

// Fail-closed, in both directions. The webhook is the default and stays
// authenticated; an operator does not lose per-request authenticity because a
// variable was fat-fingered, and a bot token alone does not opt them in.
func TestTelegramPollerStaysOffUnlessExplicitlySelected(t *testing.T) {
	for _, tc := range []struct{ name, engine, token string }{
		{"unset engine", "", "123:abc"},
		{"webhook engine", "webhook", "123:abc"},
		{"misspelled engine", "poling", "123:abc"},
		{"polling but no bot token", "polling", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, d := pollerFor(t, tc.engine, tc.token)
			if d != nil {
				t.Errorf("engine=%q token=%q enabled the poller; the authenticated "+
					"webhook must stay the default", tc.engine, tc.token)
			}
		})
	}
}

// The opt-in is case- and whitespace-tolerant, because ResolveTelegramEngine
// says it is. A test that only ever passed the exact lower-case string would
// let that tolerance rot away unnoticed.
func TestTelegramPollerOptInIsTrimmedAndCaseInsensitive(t *testing.T) {
	for _, raw := range []string{"Polling", " polling ", "POLLING"} {
		if _, d := pollerFor(t, raw, "123:abc"); d == nil {
			t.Errorf("engine=%q did not opt in, but ResolveTelegramEngine accepts it", raw)
		}
	}
}
