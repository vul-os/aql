package secretref

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAPlainValueIsReturnedUnchanged(t *testing.T) {
	// The overwhelmingly common case, and the one that must not be clever: a
	// password is whatever the operator typed, including one with braces in it.
	for _, v := range []string{"hunter2", "", "p@ss{word}", "${notaprefix}", "$env:X"} {
		got, err := Resolve("test", v)
		if err != nil {
			t.Fatalf("Resolve(%q): %v", v, err)
		}
		if got != v {
			t.Errorf("Resolve(%q) = %q, want it unchanged", v, got)
		}
	}
}

func TestAnEnvReferenceResolves(t *testing.T) {
	t.Setenv("AQL_TEST_SECRET", "from-the-environment")
	got, err := Resolve("mqtt.password", "${env:AQL_TEST_SECRET}")
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if got != "from-the-environment" {
		t.Errorf("got %q", got)
	}
}

// The failure that matters. An unresolvable reference must STOP the hub, not
// become an empty password: MQTT brokers and ONVIF cameras both accept
// anonymous connections, so a typo would quietly downgrade an authenticated
// connection to an unauthenticated one and look like it worked.
func TestAnUnsetVariableIsAnErrorAndNotAnEmptySecret(t *testing.T) {
	os.Unsetenv("AQL_TEST_MISSING")
	got, err := Resolve("mqtt.password", "${env:AQL_TEST_MISSING}")
	if err == nil {
		t.Fatalf("an unset variable resolved to %q instead of failing — the hub would "+
			"connect anonymously and report success", got)
	}
	if !strings.Contains(err.Error(), "mqtt.password") {
		t.Errorf("error %q does not name the setting, so an operator cannot find it", err)
	}
}

// An empty variable is DIFFERENT from an unset one: only the first is something
// somebody did on purpose, and refusing it would stop a deliberate blank.
func TestAnEmptyVariableIsAllowed(t *testing.T) {
	t.Setenv("AQL_TEST_EMPTY", "")
	got, err := Resolve("test", "${env:AQL_TEST_EMPTY}")
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if got != "" {
		t.Errorf("got %q, want empty", got)
	}
}

func TestAFileReferenceResolvesAndTrimsTheTrailingNewline(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "secret")
	// Every way an operator makes one of these adds a newline — `echo x > f`,
	// a here-doc, an editor. A password with one on the end fails
	// authentication with a message about credentials, not about whitespace.
	if err := os.WriteFile(path, []byte("from-a-file\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	got, err := Resolve("camera.credentials.password", "${file:"+path+"}")
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if got != "from-a-file" {
		t.Errorf("got %q, want the newline trimmed", got)
	}
}

func TestAMissingFileIsAnError(t *testing.T) {
	if _, err := Resolve("camera.password", "${file:/nonexistent/aql-test-secret}"); err == nil {
		t.Fatal("a missing secret file resolved instead of failing")
	}
}

func TestAnEmptyReferenceIsRefused(t *testing.T) {
	for _, v := range []string{"${env:}", "${file:}"} {
		if _, err := Resolve("test", v); err == nil {
			t.Errorf("%s resolved instead of failing", v)
		}
	}
}

func TestResolveMapResolvesValuesAndNotKeys(t *testing.T) {
	t.Setenv("AQL_TEST_TOKEN", "bearer-xyz")
	// A header NAME that looks like a reference stays a header name: only the
	// value is a secret.
	in := map[string]string{"Authorization": "${env:AQL_TEST_TOKEN}", "${env:X}": "literal"}
	out, err := ResolveMap("http.devices[x]", in)
	if err != nil {
		t.Fatalf("ResolveMap: %v", err)
	}
	if out["Authorization"] != "bearer-xyz" {
		t.Errorf("value = %q", out["Authorization"])
	}
	if out["${env:X}"] != "literal" {
		t.Errorf("a key was resolved: %v", out)
	}
}

func TestResolveMapFailsWholeAndNamesTheHeader(t *testing.T) {
	os.Unsetenv("AQL_TEST_MISSING2")
	out, err := ResolveMap("http.devices[cam]", map[string]string{
		"X-Good":        "fine",
		"Authorization": "${env:AQL_TEST_MISSING2}",
	})
	if err == nil {
		t.Fatal("a map with one bad reference resolved")
	}
	if out != nil {
		t.Error("a partially resolved map was returned — half a credential set is how a hub " +
			"authenticates to one device and not another without saying so")
	}
	if !strings.Contains(err.Error(), "Authorization") {
		t.Errorf("error %q does not name the header", err)
	}
}
