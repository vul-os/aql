package httpdev

import (
	"net/http"
	"strings"
	"testing"

	"github.com/vul-os/aql/gateway/internal/devices"
)

// Config validation is a startup gate. Everything it catches would otherwise
// surface as a surprise the first time someone actuates something.
func TestNewRefusesBadConfig(t *testing.T) {
	ok := func() DeviceConfig {
		return DeviceConfig{
			ID: "lamp-1", Kind: devices.KindLighting, Name: "Lamp",
			Capabilities: []devices.CapabilityID{devices.CapDimmable},
			Actions: map[devices.Verb]Action{
				devices.VerbOn: {Method: http.MethodPost, URL: "https://relay.example/on"},
			},
		}
	}
	cases := []struct {
		name string
		want string // substring the error must contain
		make func() Config
	}{
		{
			name: "capability outside the catalogue",
			want: "uncatalogued",
			make: func() Config {
				d := ok()
				d.Capabilities = []devices.CapabilityID{"light.smuggled"}
				return Config{Devices: []DeviceConfig{d}}
			},
		},
		{
			name: "unknown kind",
			want: "unknown kind",
			make: func() Config {
				d := ok()
				d.Kind = devices.Kind("teleporter")
				return Config{Devices: []DeviceConfig{d}}
			},
		},
		{
			name: "no capabilities at all",
			want: "no capabilities",
			make: func() Config {
				d := ok()
				d.Capabilities = nil
				return Config{Devices: []DeviceConfig{d}}
			},
		},
		{
			name: "an action for a verb the device's capabilities do not offer",
			want: "none of its capabilities offer",
			make: func() Config {
				d := ok()
				// open is a real catalogue verb — at TierPhysicalAccess. A lamp
				// must not acquire it by having a URL for it.
				d.Actions[devices.VerbOpen] = Action{Method: http.MethodPost, URL: "https://x.example/open"}
				return Config{Devices: []DeviceConfig{d}}
			},
		},
		{
			name: "an argument-taking verb whose template ignores the argument",
			want: "never uses",
			make: func() Config {
				d := ok()
				d.Actions[devices.VerbSet] = Action{Method: http.MethodPost, URL: "https://x.example/level"}
				return Config{Devices: []DeviceConfig{d}}
			},
		},
		{
			name: "an unknown placeholder",
			want: "unknown placeholder",
			make: func() Config {
				d := ok()
				d.Actions[devices.VerbSet] = Action{Method: http.MethodPost,
					URL: "https://x.example/level", Body: `{"v":{{secret}}}`}
				return Config{Devices: []DeviceConfig{d}}
			},
		},
		{
			name: "credentials embedded in the URL",
			want: "embeds credentials",
			make: func() Config {
				d := ok()
				d.Actions[devices.VerbOn] = Action{Method: http.MethodPost,
					URL: "https://admin:hunter2@relay.example/on"}
				return Config{Devices: []DeviceConfig{d}}
			},
		},
		{
			name: "a scheme that is not http or https",
			want: "only http and https",
			make: func() Config {
				d := ok()
				d.Actions[devices.VerbOn] = Action{Method: http.MethodPost, URL: "file:///etc/passwd"}
				return Config{Devices: []DeviceConfig{d}}
			},
		},
		{
			name: "no host",
			want: "no host",
			make: func() Config {
				d := ok()
				d.Actions[devices.VerbOn] = Action{Method: http.MethodPost, URL: "https:///on"}
				return Config{Devices: []DeviceConfig{d}}
			},
		},
		{
			name: "an exotic method",
			want: "allowed",
			make: func() Config {
				d := ok()
				d.Actions[devices.VerbOn] = Action{Method: "TRACE", URL: "https://relay.example/on"}
				return Config{Devices: []DeviceConfig{d}}
			},
		},
		{
			name: "no method",
			want: "no method",
			make: func() Config {
				d := ok()
				d.Actions[devices.VerbOn] = Action{URL: "https://relay.example/on"}
				return Config{Devices: []DeviceConfig{d}}
			},
		},
		{
			name: "a header value carrying a newline",
			want: "newline",
			make: func() Config {
				d := ok()
				d.Headers = map[string]string{"X-Key": "a\r\nX-Injected: 1"}
				return Config{Devices: []DeviceConfig{d}}
			},
		},
		{
			name: "the same device twice",
			want: "declared twice",
			make: func() Config { return Config{Devices: []DeviceConfig{ok(), ok()}} },
		},
		{
			name: "a metric declared twice",
			want: "twice",
			make: func() Config {
				d := ok()
				d.Reads = []ReadSpec{{URL: "https://relay.example/state", Metrics: []Metric{
					{Metric: "level", Path: "a"}, {Metric: "level", Path: "b"},
				}}}
				return Config{Devices: []DeviceConfig{d}}
			},
		},
		{
			name: "a read with no metrics",
			want: "no metrics",
			make: func() Config {
				d := ok()
				d.Reads = []ReadSpec{{URL: "https://relay.example/state"}}
				return Config{Devices: []DeviceConfig{d}}
			},
		},
		{
			name: "a path with an empty segment",
			want: "empty segment",
			make: func() Config {
				d := ok()
				d.Reads = []ReadSpec{{URL: "https://relay.example/state",
					Metrics: []Metric{{Metric: "level", Path: "state..level"}}}}
				return Config{Devices: []DeviceConfig{d}}
			},
		},
		{
			name: "a driver id containing a colon",
			want: "first colon",
			make: func() Config { return Config{ID: "http:lan"} },
		},
		{
			name: "a device with no name",
			want: "no name",
			make: func() Config {
				d := ok()
				d.Name = ""
				return Config{Devices: []DeviceConfig{d}}
			},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := New(tc.make())
			if err == nil {
				t.Fatalf("config was accepted; it must be refused at startup")
			}
			if !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("error %q does not mention %q", err, tc.want)
			}
		})
	}
}

func TestDefaultsAndEmptyConfig(t *testing.T) {
	d, err := New(Config{})
	if err != nil {
		t.Fatalf("an empty config is legal: %v", err)
	}
	if d.ID() != DefaultDriverID {
		t.Fatalf("driver id = %q, want %q", d.ID(), DefaultDriverID)
	}
	if d.timeout != DefaultTimeout || d.maxBytes != DefaultMaxResponseBytes {
		t.Fatalf("defaults not applied: %v / %d", d.timeout, d.maxBytes)
	}
	found, err := d.Discover(t.Context())
	if err != nil || len(found) != 0 {
		t.Fatalf("Discover on an empty driver = %+v, %v", found, err)
	}
	if _, err := New(Config{Timeout: -1}); err == nil {
		t.Fatal("a negative timeout must be refused")
	}
	if _, err := New(Config{MaxResponseBytes: -1}); err == nil {
		t.Fatal("a negative response bound must be refused")
	}
}

// A caller's client is copied, not mutated, and the redirect policy is imposed
// on the copy regardless of what the caller set.
func TestSuppliedClientIsCopiedAndRedirectPolicyImposed(t *testing.T) {
	caller := &http.Client{
		CheckRedirect: func(*http.Request, []*http.Request) error { return nil },
	}
	d, err := New(Config{Client: caller})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if d.client == caller {
		t.Fatal("the caller's client was used directly; it must be copied")
	}
	if caller.CheckRedirect == nil {
		t.Fatal("the caller's client was mutated")
	}
	if d.client.CheckRedirect == nil {
		t.Fatal("the driver's redirect policy was not imposed")
	}
	if d.ownClient {
		t.Fatal("a supplied client must not be treated as owned")
	}
}

func TestPlaceholders(t *testing.T) {
	cases := []struct {
		in   string
		want []string
	}{
		{"", nil},
		{"https://x/on", nil},
		{"https://x/{{level}}", []string{"level"}},
		{`{"a":{{level}},"b":{{level}}}`, []string{"level", "level"}},
		{"https://x/{{unterminated", nil},
		{"https://x/{{a}}/{{b}}", []string{"a", "b"}},
	}
	for _, tc := range cases {
		got := placeholders(tc.in)
		if len(got) != len(tc.want) {
			t.Fatalf("placeholders(%q) = %v, want %v", tc.in, got, tc.want)
		}
		for i := range got {
			if got[i] != tc.want[i] {
				t.Fatalf("placeholders(%q) = %v, want %v", tc.in, got, tc.want)
			}
		}
	}
}

func TestRedactKeepsOnlySchemeAndHost(t *testing.T) {
	got := redact("https://relay.example:8443/api/SECRET/on?key=SECRET#frag")
	if got != "https://relay.example:8443" {
		t.Fatalf("redact = %q; path, query and fragment must all be dropped", got)
	}
	if redact("::not a url::") != "(url)" {
		t.Fatalf("an unparseable URL must not be echoed back")
	}
}
