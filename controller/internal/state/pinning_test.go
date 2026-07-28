package state

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// The pinned gateway key, and the two doors to it.
//
// This is the highest-stakes structural claim in the controller. package
// pairing opens with it:
//
//	"The redeem response is the ONLY moment a gateway key is accepted;
//	 thereafter only a `repair` command signed by the currently pinned key (or
//	 a physical factory reset) can change it — state.Store enforces that."
//
// Whoever holds the pinned key can sign a command that opens the gate. So the
// set of code paths that can WRITE that key is the whole trust model, and it is
// currently three things: one assignment, inside ApplyRepair; one SavePairing
// caller, in package pairing, which refuses any change once paired; and one
// ApplyRepair caller, in package command, on the far side of a signature check.
//
// ApplyRepair's own doc says "the caller MUST have already verified the
// `repair` command envelope against the CURRENTLY pinned key — this method only
// performs the swap." That is a contract in a comment. It is honoured today by
// exactly one caller, and a second caller anywhere else — a config reload, a
// recovery command, an admin hook — would take the gate over without touching
// this file or failing any existing test.
//
// TestRepairIsRefusedUnlessSignedByTheCurrentlyPinnedKey covers the behaviour
// of the one caller that exists. This covers the set.

func controllerRoot(t *testing.T) string {
	t.Helper()
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	root := filepath.Clean(filepath.Join(wd, "..", ".."))
	if _, err := os.Stat(filepath.Join(root, "go.mod")); err != nil {
		t.Fatalf("expected the controller module root at %s: %v", root, err)
	}
	return root
}

// nonTestGoFiles returns every buildable source in the module, INCLUDING
// build-tagged ones: a gpio- or ble-only file that wrote the pinned key would
// be just as much of a takeover, and excluding it because the default build
// skips it is how a tagged file becomes the place to hide things.
func nonTestGoFiles(t *testing.T, root string) map[string]string {
	t.Helper()
	out := map[string]string{}
	err := filepath.Walk(root, func(p string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			if n := info.Name(); n == "testdata" || n == ".git" {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(p, ".go") || strings.HasSuffix(p, "_test.go") {
			return nil
		}
		b, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(root, p)
		out[filepath.ToSlash(rel)] = string(b)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(out) < 20 {
		t.Fatalf("walked only %d sources; the scan is broken, not the code", len(out))
	}
	return out
}

var assignPinnedRe = regexp.MustCompile(`GatewayPubkey\s*=`)

func callers(files map[string]string, fn string) []string {
	re := regexp.MustCompile(`\.` + fn + `\(`)
	var out []string
	for name, src := range files {
		// Skip the declaration site itself.
		if strings.Contains(src, "func (s *Store) "+fn+"(") {
			continue
		}
		if re.MatchString(src) {
			out = append(out, name)
		}
	}
	sort.Strings(out)
	return out
}

func TestOnlyTwoDoorsWriteThePinnedGatewayKey(t *testing.T) {
	root := controllerRoot(t)
	files := nonTestGoFiles(t, root)

	// 1. One assignment, and it lives in state.go.
	var assigns []string
	for name, src := range files {
		for i, line := range strings.Split(src, "\n") {
			if assignPinnedRe.MatchString(line) {
				assigns = append(assigns, name+":"+itoa(i+1)+strings.TrimRight(" "+strings.TrimSpace(line), " "))
			}
		}
	}
	sort.Strings(assigns)
	if len(assigns) != 1 {
		t.Errorf(`%d assignments to the pinned gateway key; expected exactly one, inside ApplyRepair:

  %s

Whoever holds this key can sign a command that opens the gate. A second place
that writes it is a second trust root, and nothing else in the build would
notice.`, len(assigns), strings.Join(assigns, "\n  "))
	} else if !strings.HasPrefix(assigns[0], "internal/state/state.go:") {
		t.Errorf("the pinned key is assigned outside internal/state: %s", assigns[0])
	}

	// 2. ApplyRepair: exactly one caller, on the far side of the signature
	//    check in package command.
	repair := callers(files, "ApplyRepair")
	if len(repair) != 1 || !strings.HasPrefix(repair[0], "internal/command/") {
		t.Errorf(`ApplyRepair callers = %v; expected exactly one, in internal/command.

ApplyRepair does not verify anything — its doc is explicit that the CALLER must
already have checked the repair envelope against the currently pinned key. That
contract is honoured by one call site. A second caller elsewhere rotates the
trust root without a signature, and every existing test still passes.`, repair)
	}

	// 3. SavePairing: exactly one caller, the redeem response in package
	//    pairing. It refuses a key change once paired, so a second caller is
	//    less immediately fatal than a second ApplyRepair — but it is still the
	//    door the claim says is the ONLY moment a key is accepted.
	save := callers(files, "SavePairing")
	if len(save) != 1 || !strings.HasPrefix(save[0], "internal/pairing/") {
		t.Errorf("SavePairing callers = %v; expected exactly one, in internal/pairing", save)
	}
}

// The refusal itself, since the door above is only safe because of it: pairing
// again with a DIFFERENT key must be refused, not silently accepted as a
// re-pair.
func TestRePairingWithADifferentKeyIsRefused(t *testing.T) {
	dir := t.TempDir()
	st, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}

	pubA, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	pubB, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	enc := base64.RawURLEncoding.EncodeToString

	first := Pairing{DeviceID: "de71ce00-0000-4000-8000-000000000001", GatewayPubkey: enc(pubA)}
	if err := st.SavePairing(first); err != nil {
		t.Fatalf("first pairing: %v", err)
	}
	pinned := st.GatewayKey()
	if pinned == nil {
		t.Fatal("no key pinned after pairing")
	}

	// A different, well-formed key must be refused outright — not treated as a
	// re-pair, which is how a second redeem would otherwise rotate the trust
	// root of a controller somebody already owns.
	second := Pairing{DeviceID: first.DeviceID, GatewayPubkey: enc(pubB)}
	if err := st.SavePairing(second); err == nil {
		t.Fatal("re-pairing with a different gateway key was accepted; the pin is not a pin")
	}
	if got := st.GatewayKey(); got == nil || string(got) != string(pinned) {
		t.Fatal("the pinned key changed despite the refusal")
	}

	// The same key again is allowed, so a controller can refresh ws_url or the
	// poll interval without a factory reset.
	again := Pairing{DeviceID: first.DeviceID, GatewayPubkey: enc(pubA), WSURL: "wss://new/ws"}
	if err := st.SavePairing(again); err != nil {
		t.Fatalf("a byte-equal re-pair was refused: %v", err)
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
