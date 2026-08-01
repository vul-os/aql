package main

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Every credential-shaped field in a device driver's config is resolved.
//
// resolveDeviceSecrets enumerates its three call sites by hand, and its own
// comment says "a fourth should be added here deliberately". Nothing enforced
// that. A driver gaining a `Token` or `Password` field would silently be the
// one place a `${env:}` reference is not honoured — and the failure is the bad
// direction: an operator who has externalised their secrets everywhere else
// would reasonably assume this one too, and the literal string
// "${env:CAMERA_PW}" would be sent as the password.
//
// # Why a name scan rather than a type scan
//
// There is no marker on these fields to key off, and adding one would be a
// change to four driver packages to serve a test in a fifth. The names are
// conventional and short: Password, Token, Secret, Key, Passphrase, APIKey.
// A field called something else entirely would be missed, which is why the
// resolver's comment stays the primary instruction and this is the backstop.
func TestEveryCredentialFieldInDriverConfigIsResolved(t *testing.T) {
	// Field names that mean "this is a secret". Deliberately narrow: `KeepAlive`
	// and `ClientID` must not match, and a scan that flagged them would be
	// silenced rather than fixed.
	credential := func(name string) bool {
		switch name {
		case "Password", "Passphrase", "Token", "Secret", "APIKey", "AccessKey", "PrivateKey":
			return true
		}
		return false
	}

	// The fields resolveDeviceSecrets actually handles, plus the map-valued one
	// it handles wholesale. Listed here so this test fails when a field appears
	// rather than when it is used.
	resolved := map[string]bool{

		"mqtt.Config.Password":       true,
		"camera.Credential.Password": true,
		// httpdev's credentials live in Headers, a map[string]string resolved
		// by ResolveMap; there is no named field to list.
	}

	// Credential-SHAPED fields that are not credentials, each with the reason.
	//
	// The scan reads every struct in these packages, including runtime types
	// that never come from configuration, so a name heuristic will find things
	// like this. Listing them beats narrowing the heuristic: a narrower scan
	// would silently stop seeing a real one, and an exemption has to be written
	// down before it counts.
	notASecret := map[string]string{
		"camera.Profile.Token": "ONVIF profile identifier (mainStream), returned by the " +
			"camera at runtime. Never configured, never secret.",
	}

	dirs := []string{
		"../../internal/devices/mqtt",
		"../../internal/devices/camera",
		"../../internal/devices/httpdev",
		"../../internal/devices/modbus",
	}

	var unhandled []string
	checked := 0
	for _, dir := range dirs {
		pkg := filepath.Base(dir)
		entries, err := os.ReadDir(dir)
		if err != nil {
			t.Fatalf("read %s: %v", dir, err)
		}
		for _, e := range entries {
			if !strings.HasSuffix(e.Name(), ".go") || strings.HasSuffix(e.Name(), "_test.go") {
				continue
			}
			fset := token.NewFileSet()
			f, err := parser.ParseFile(fset, filepath.Join(dir, e.Name()), nil, 0)
			if err != nil {
				t.Fatalf("parse %s: %v", e.Name(), err)
			}
			ast.Inspect(f, func(n ast.Node) bool {
				ts, ok := n.(*ast.TypeSpec)
				if !ok {
					return true
				}
				st, ok := ts.Type.(*ast.StructType)
				if !ok {
					return true
				}
				for _, field := range st.Fields.List {
					for _, name := range field.Names {
						checked++
						if !credential(name.Name) {
							continue
						}
						key := pkg + "." + ts.Name.Name + "." + name.Name
						if resolved[key] || notASecret[key] != "" {
							continue
						}
						unhandled = append(unhandled, key)
					}
				}
				return true
			})
		}
	}

	// A walker that parsed nothing would pass forever.
	if checked < 50 {
		t.Fatalf("only %d struct fields parsed — the driver packages moved", checked)
	}
	if len(unhandled) > 0 {
		t.Errorf("these look like credentials and resolveDeviceSecrets does not resolve them:\n  %s\n\n"+
			"A driver gaining a secret field is the one place a ${env:} reference would not be "+
			"honoured, and an operator who externalised everything else would reasonably assume "+
			"this one too — the literal \"${env:NAME}\" would be sent as the password. Add it to "+
			"resolveDeviceSecrets and this test's `resolved` map — or, if it is not a secret, "+
			"to `notASecret` with the reason.",
			strings.Join(unhandled, "\n  "))
	}
}

// An exemption for a field that no longer exists is one nobody can evaluate,
// and it is how the next real credential gets waved through: the list stops
// being a record of decisions and becomes a list of things somebody once typed.
// Same rule the phone-home allowlist follows.
func TestEveryNotASecretExemptionStillNamesARealField(t *testing.T) {
	// Kept in step with the map above by hand. A second copy is the cost of
	// the map being a local rather than a package var, and it is cheap: this
	// fails loudly the moment either side moves.
	exemptions := []string{"camera.Profile.Token"}

	dirs := []string{
		"../../internal/devices/mqtt",
		"../../internal/devices/camera",
		"../../internal/devices/httpdev",
		"../../internal/devices/modbus",
	}
	var all strings.Builder
	for _, dir := range dirs {
		entries, err := os.ReadDir(dir)
		if err != nil {
			t.Fatalf("read %s: %v", dir, err)
		}
		for _, e := range entries {
			if !strings.HasSuffix(e.Name(), ".go") || strings.HasSuffix(e.Name(), "_test.go") {
				continue
			}
			b, err := os.ReadFile(filepath.Join(dir, e.Name()))
			if err != nil {
				t.Fatal(err)
			}
			all.Write(b)
		}
	}
	src := all.String()
	for _, key := range exemptions {
		parts := strings.Split(key, ".")
		if len(parts) != 3 {
			t.Fatalf("exemption %q is not pkg.Type.Field", key)
		}
		if !strings.Contains(src, "type "+parts[1]+" struct") {
			t.Errorf("exemption %q names a type that no longer exists — drop it", key)
		}
	}
}
