package httpapi

import "testing"

// A webhook URL is a request-forgery primitive pointed at the network the hub
// lives on. These are the addresses that make it one.
func TestWebhookRefusesTheAddressesThatMakeItSSRF(t *testing.T) {
	for _, tc := range []struct {
		name string
		url  string
		why  string
	}{
		{"loopback", "https://127.0.0.1/hook", "the hub's own admin surface"},
		{"loopback name", "https://localhost/hook", "same, by name"},
		{"cloud metadata", "https://169.254.169.254/latest/meta-data/", "hands out credentials to any local caller"},
		{"private class C", "https://192.168.1.1/hook", "the router's admin page"},
		{"private class A", "https://10.0.0.5/hook", "anything else on the LAN"},
		{"private class B", "https://172.16.4.4/hook", "same"},
		{"carrier-grade NAT", "https://100.64.0.1/hook", "shared with other subscribers on a CGNAT link"},
		{"unspecified", "https://0.0.0.0/hook", "not a destination"},
		{"ipv6 loopback", "https://[::1]/hook", "loopback again"},
	} {
		if _, err := validateWebhookURL(tc.url, false); err == nil {
			t.Errorf("%s (%s) was accepted without allow_private: %s", tc.name, tc.url, tc.why)
		}
		// The opt-out is the whole point: an operator wiring their own Home
		// Assistant is legitimate and says so explicitly.
		if _, err := validateWebhookURL(tc.url, true); err != nil {
			t.Errorf("%s should be permitted WITH allow_private, got %v", tc.name, err)
		}
	}
}

func TestWebhookRefusesNonHTTPSchemes(t *testing.T) {
	for _, raw := range []string{
		"file:///etc/passwd",
		"gopher://example.com/",
		"ftp://example.com/",
		"javascript:alert(1)",
	} {
		if _, err := validateWebhookURL(raw, true); err == nil {
			t.Errorf("%q was accepted; only http and https are targets", raw)
		}
	}
}

// http:// to the public internet would put a signed record of every gate
// opening on the wire in clear. The only defensible plaintext target is one on
// a network the operator controls, which is exactly what allow_private asserts.
func TestPlaintextRequiresAllowPrivate(t *testing.T) {
	if _, err := validateWebhookURL("http://example.com/hook", false); err == nil {
		t.Fatal("http:// to a public host was accepted without allow_private")
	}
	if _, err := validateWebhookURL("https://example.com/hook", false); err != nil {
		t.Fatalf("https:// to a public host should be fine: %v", err)
	}
}

func TestWebhookRefusesCredentialsInURL(t *testing.T) {
	if _, err := validateWebhookURL("https://user:pass@example.com/hook", true); err == nil {
		t.Fatal("credentials in the URL were accepted; anything that logs a URL " +
			"would log them, and the HMAC already authenticates the sender")
	}
}

// A hostname that does not resolve cannot be shown to be safe, and refusing at
// configuration time costs an operator a clear error rather than a silent
// never-fires.
func TestUnresolvableHostIsRefused(t *testing.T) {
	if _, err := validateWebhookURL("https://this-name-should-not-resolve.invalid/hook", false); err == nil {
		t.Fatal("an unresolvable host was accepted")
	}
}
