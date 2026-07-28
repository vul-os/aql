// Command routegen is the Go side of the frontend/gateway route-parity test
// (see src/lib/__tests__/routeParity.test.ts).
//
// It parses hub/internal/httpapi/server.go with go/parser — NOT regex —
// and walks the AST for every mux.HandleFunc(...) / mux.Handle(...) call
// inside Router(), extracting the "METHOD /path" string literal each one
// registers. That is the single source of truth for what the gateway
// actually serves; this tool exists so the frontend test can diff against it
// mechanically instead of a hand-maintained (and driftable) list.
//
// Output: a JSON array of {"method": "...", "path": "..."} on stdout, sorted
// for stable diffs. Bare pattern registrations with no method prefix (e.g.
// the "/" catch-all that serves the embedded portal) are skipped — they are
// not endpoints the frontend api client calls by method+path.
//
// Usage: go run ./cmd/routegen [path/to/server.go]
// Defaults to internal/httpapi/server.go relative to the gateway module root.
package main

import (
	"encoding/json"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

type route struct {
	Method string `json:"method"`
	Path   string `json:"path"`
	// Handler is the method name the pattern is bound to, e.g.
	// "handleTimeWindowsList". Empty when the binding is not a plain method
	// value (a closure, or a middleware chain this cannot see through).
	Handler string `json:"handler,omitempty"`
	// Envelope is the set of TOP-LEVEL keys the handler writes in a
	// writeJSON(..., map[string]any{...}) literal, sorted.
	//
	// This exists because a response-shape check that only asks "does any
	// handler emit this key" cannot catch an endpoint returning the RIGHT key
	// name under the WRONG envelope. That is not hypothetical: the console
	// declared the time-window and geofence lists as {rules: …} while the hub
	// sends {time_windows: …} and {geofences: …}. `rules` is a real key —
	// automations emits it — so the name-only check passed and both lists would
	// have rendered permanently empty.
	//
	// Empty means the handler builds its body some other way (a struct, a
	// helper, a variable) and nothing can be asserted about it from here.
	Envelope []string `json:"envelope,omitempty"`
}

var methodPrefix = regexp.MustCompile(`^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(/.*)$`)

func main() {
	target := "internal/httpapi/server.go"
	if len(os.Args) > 1 {
		target = os.Args[1]
	}
	abs, err := filepath.Abs(target)
	if err != nil {
		fmt.Fprintln(os.Stderr, "routegen:", err)
		os.Exit(1)
	}

	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, abs, nil, 0)
	if err != nil {
		fmt.Fprintln(os.Stderr, "routegen: parse:", err)
		os.Exit(1)
	}

	// The handlers live all over the package, not in server.go — so the
	// envelope scan needs the whole directory. Parsed once here rather than
	// per-handler: there are 100 routes and re-reading the package for each
	// would turn a fast tool into a slow one for no reason.
	pkg, err := parsePackage(filepath.Dir(abs))
	if err != nil {
		fmt.Fprintln(os.Stderr, "routegen: parse package:", err)
		os.Exit(1)
	}

	var routes []route
	seen := map[string]bool{}

	ast.Inspect(file, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}
		sel, ok := call.Fun.(*ast.SelectorExpr)
		if !ok {
			return true
		}
		// mux.HandleFunc(pattern, handler) / mux.Handle(pattern, handler)
		if sel.Sel.Name != "HandleFunc" && sel.Sel.Name != "Handle" {
			return true
		}
		if len(call.Args) == 0 {
			return true
		}
		lit, ok := call.Args[0].(*ast.BasicLit)
		if !ok || lit.Kind != token.STRING {
			return true
		}
		pattern, err := strconv.Unquote(lit.Value)
		if err != nil {
			return true
		}
		m := methodPrefix.FindStringSubmatch(pattern)
		if m == nil {
			// Bare pattern (e.g. "/") — not a method+path endpoint the
			// frontend api client would call. Skip.
			return true
		}
		method, path := m[1], m[2]
		handler := handlerName(call.Args)
		// Go 1.22 mux patterns allow "METHOD /path" or "METHOD host/path" —
		// this codebase never uses a host prefix, but strip defensively.
		if idx := strings.Index(path, "://"); idx >= 0 {
			path = path[idx+3:]
		}
		key := method + " " + path
		if seen[key] {
			return true
		}
		seen[key] = true
		routes = append(routes, route{
			Method: method, Path: path, Handler: handler,
			Envelope: envelopeOf(pkg, handler),
		})
		return true
	})

	sort.Slice(routes, func(i, j int) bool {
		if routes[i].Path != routes[j].Path {
			return routes[i].Path < routes[j].Path
		}
		return routes[i].Method < routes[j].Method
	})

	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	if err := enc.Encode(routes); err != nil {
		fmt.Fprintln(os.Stderr, "routegen: encode:", err)
		os.Exit(1)
	}
}

// handlerName digs the handler method's name out of the second argument.
//
// Three shapes appear in server.go and all three resolve to the same name:
//
//	mux.HandleFunc("GET /x", s.handleX)                  → handleX
//	mux.Handle("GET /x", s.requireAuth(s.handleX))       → handleX
//	mux.Handle("GET /x", s.requireAuth(s.scoped(s.handleX))) → handleX
//
// The innermost selector wins, because middleware wraps the handler rather
// than replacing it.
func handlerName(args []ast.Expr) string {
	if len(args) < 2 {
		return ""
	}
	var last string
	ast.Inspect(args[1], func(n ast.Node) bool {
		if sel, ok := n.(*ast.SelectorExpr); ok {
			if strings.HasPrefix(sel.Sel.Name, "handle") {
				last = sel.Sel.Name
			}
		}
		return true
	})
	return last
}

// envelopeOf returns the top-level keys the named handler writes via
// writeJSON with a composite map literal.
//
// Deliberately conservative: only a literal map passed directly to writeJSON is
// read. A body built into a variable first, or returned from a helper, yields no
// envelope rather than a guessed one — an inventory that guesses is worse than
// one that admits it does not know.
func envelopeOf(pkg []*ast.File, handler string) []string {
	if handler == "" {
		return nil
	}
	var fn *ast.FuncDecl
	for _, f := range pkg {
		ast.Inspect(f, func(n ast.Node) bool {
			d, ok := n.(*ast.FuncDecl)
			if ok && d.Name.Name == handler {
				fn = d
				return false
			}
			return true
		})
		if fn != nil {
			break
		}
	}
	if fn == nil {
		return nil
	}

	set := map[string]bool{}
	ast.Inspect(fn, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}
		id, ok := call.Fun.(*ast.Ident)
		// writeJSON ONLY. A writeErrDetail map is the shape of a REFUSAL, not
		// of the response a client reads on success, and conflating them made
		// a handler that validates its input before delegating look as though
		// its envelope were its error detail. The doc comment above always
		// said writeJSON; the code did not.
		if !ok || id.Name != "writeJSON" {
			return true
		}
		for _, arg := range call.Args {
			cl, ok := arg.(*ast.CompositeLit)
			if !ok {
				continue
			}
			for _, elt := range cl.Elts {
				kv, ok := elt.(*ast.KeyValueExpr)
				if !ok {
					continue
				}
				k, ok := kv.Key.(*ast.BasicLit)
				if !ok || k.Kind != token.STRING {
					continue
				}
				if key, err := strconv.Unquote(k.Value); err == nil {
					set[key] = true
				}
			}
		}
		return true
	})

	out := make([]string, 0, len(set))
	for k := range set {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// parsePackage parses every non-test .go file in a directory.
func parsePackage(dir string) ([]*ast.File, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	fset := token.NewFileSet()
	var out []*ast.File
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		f, err := parser.ParseFile(fset, filepath.Join(dir, name), nil, 0)
		if err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, nil
}
