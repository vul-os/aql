package httpapi

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Every command sent to a controller is signed for the key that controller
// PINS.
//
// signForDevice says so in prose — "every command to a controller must go
// through here rather than through keys.SignCommand directly" — and prose did
// not stop the `revoke` dispatch from calling the current-key signer for two
// commits.
//
// The failure is invisible outside a rotation and total inside one. While a
// rotation is in flight the hub's CURRENT key is the new one and a controller
// that has not been repaired yet still pins the old, so a command signed with
// the current key is a badsig at that gate. For an open that is a resident
// standing in front of a gate that will not move. For a revoke it is worse: the
// command silently reaches nothing, and a key rotation is exactly when an
// operator is revoking things.
//
// Two exceptions, both named rather than pattern-matched:
//
//   - keyrotation.go dispatches the repair itself, which must be signed for the
//     pin EXPLICITLY (SignCommandForPin with p.PinnedPub) — it cannot use
//     signForDevice, because the pin it needs is the one being replaced.
//   - signForDevice is the wrapper, and calls SignCommandForPin by definition.
func TestEveryControllerCommandIsSignedForItsPin(t *testing.T) {
	allowed := map[string]bool{
		"keyrotation.go": true, // dispatches the repair against the pin being replaced
	}

	fset := token.NewFileSet()
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}
	var offenders []string
	checked := 0
	for _, e := range entries {
		name := e.Name()
		if !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		if allowed[name] {
			continue
		}
		src, err := os.ReadFile(filepath.Join(".", name))
		if err != nil {
			t.Fatal(err)
		}
		f, err := parser.ParseFile(fset, name, src, 0)
		if err != nil {
			t.Fatalf("parse %s: %v", name, err)
		}
		checked++
		ast.Inspect(f, func(n ast.Node) bool {
			call, ok := n.(*ast.CallExpr)
			if !ok {
				return true
			}
			sel, ok := call.Fun.(*ast.SelectorExpr)
			if !ok {
				return true
			}
			// s.keys.SignCommand… — the direct signers, whatever the receiver
			// is spelled as.
			if !strings.HasPrefix(sel.Sel.Name, "SignCommand") {
				return true
			}
			inner, ok := sel.X.(*ast.SelectorExpr)
			if !ok || inner.Sel.Name != "keys" {
				return true
			}
			pos := fset.Position(call.Pos())
			offenders = append(offenders,
				name+":"+itoa(pos.Line)+"  "+sel.Sel.Name+" — use signForDevice")
			return true
		})
	}

	// A walker that parsed nothing would pass forever.
	if checked < 10 {
		t.Fatalf("only %d non-test files parsed — the package moved", checked)
	}
	if len(offenders) > 0 {
		t.Errorf("these sign a controller command with the hub's CURRENT key, which is a "+
			"badsig at any controller not yet repaired during a rotation:\n  %s",
			strings.Join(offenders, "\n  "))
	}
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b []byte
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	return string(b)
}
