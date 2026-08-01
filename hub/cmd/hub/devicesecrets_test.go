package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The resolver reaches all three places a device credential can appear.
//
// secretref's own tests prove the syntax. This proves the WIRING: a resolver
// nothing calls is the same as no resolver, and the three call sites are
// enumerated by hand in resolveDeviceSecrets rather than reflected over, so a
// fourth credential field would be silently unresolved.
func TestDeviceSecretsResolveAtEveryCredentialSite(t *testing.T) {
	t.Setenv("AQL_TEST_MQTT_PW", "mqtt-secret")
	t.Setenv("AQL_TEST_TOKEN", "Bearer http-secret")

	dir := t.TempDir()
	camPath := filepath.Join(dir, "cam.pw")
	if err := os.WriteFile(camPath, []byte("camera-secret\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	// Minimal but REAL field names. Resolution happens in loadDeviceFile before
	// any driver validates, so these need only decode — building configs that
	// also pass each driver's constructor would test those constructors, not
	// this.
	cfg := `{
	  "mqtt": {"BrokerAddr": "127.0.0.1:1883", "Username": "u", "Password": "${env:AQL_TEST_MQTT_PW}"},
	  "camera": {"Credentials": {"192.168.1.50": {"Username": "admin", "Password": "${file:` + camPath + `}"}}},
	  "http": {"Devices": [{"ID": "meter-1", "Headers": {"Authorization": "${env:AQL_TEST_TOKEN}"}}]}
	}`
	path := filepath.Join(dir, "devices.json")
	if err := os.WriteFile(path, []byte(cfg), 0o600); err != nil {
		t.Fatal(err)
	}

	f, err := loadDeviceFile(path)
	if err != nil {
		t.Fatalf("loadDeviceFile: %v", err)
	}

	if f.MQTT == nil || f.MQTT.Password != "mqtt-secret" {
		t.Errorf("mqtt password = %q, want the resolved secret", f.MQTT.Password)
	}
	if f.Camera == nil || f.Camera.Credentials["192.168.1.50"].Password != "camera-secret" {
		t.Errorf("camera password = %q, want the resolved secret (newline trimmed)",
			f.Camera.Credentials["192.168.1.50"].Password)
	}
	if f.HTTP == nil || len(f.HTTP.Devices) != 1 ||
		f.HTTP.Devices[0].Headers["Authorization"] != "Bearer http-secret" {
		t.Errorf("http header = %q, want the resolved secret", f.HTTP.Devices[0].Headers["Authorization"])
	}
}

// A reference that cannot be resolved stops the load, and nothing
// half-resolved reaches a driver.
func TestAnUnresolvableSecretRefusesTheWholeConfig(t *testing.T) {
	os.Unsetenv("AQL_TEST_ABSENT")
	dir := t.TempDir()
	cfg := `{
	  "mqtt": {"BrokerAddr": "127.0.0.1:1883", "Password": "${env:AQL_TEST_ABSENT}"}
	}`
	path := filepath.Join(dir, "devices.json")
	if err := os.WriteFile(path, []byte(cfg), 0o600); err != nil {
		t.Fatal(err)
	}

	f, err := loadDeviceFile(path)
	if err == nil {
		t.Fatal("an unresolvable secret loaded — the hub would connect anonymously")
	}
	if !strings.Contains(err.Error(), "mqtt.password") {
		t.Errorf("error %q does not name the setting", err)
	}
	// Zero value, so a partially-resolved config cannot reach a driver.
	if f.MQTT != nil {
		t.Error("a partially resolved config was returned alongside the error")
	}
}
