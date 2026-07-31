package devices

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Device.Summary is presentational and must never be parsed.
//
// model.go says so in a comment: "Summary is a short human-readable state for
// the console's list row ('62% · warm', 'charging · 81%'). Presentational;
// never parsed." This is the test that makes it a rule rather than a wish.
//
// # Why it needs a test
//
// docs/CHAT-COMMANDS.md §4.2 wants "which lights are on" answered, and §4.4
// rule 2's own example is "3 of 12 lights are on". Summary is the only place a
// light's state appears today, so the shortest path to that feature is to look
// for "on" in a string a driver wrote for a human. That would be a guess
// presented as a fact about someone's home: one driver writes "62% · warm",
// another "on", another "warm white", and the reply would be confidently wrong
// for every driver whose vocabulary nobody checked.
//
// The honest path is a machine-readable state on the model, which does not
// exist yet. Until it does, this keeps the tempting shortcut closed.
//
// It is a source test because the property is "nobody reads this field for its
// content", and no runtime assertion can express that.

// summaryReaders are the packages allowed to touch Summary at all, and why.
// Everything here PASSES IT ALONG unchanged — none of them inspects it.
var summaryReaders = map[string]string{
	"model.go":    "declares the field",
	"mock.go":     "sets it on fixtures",
	"registry.go": "carries it through the index",
	"driver.go":   "documents the seam",
}

func TestNothingParsesADeviceSummary(t *testing.T) {
	root := ".."
	var offenders []string
	checked := 0

	err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() || !strings.HasSuffix(path, ".go") ||
			strings.HasSuffix(path, "_test.go") {
			return nil
		}
		src, err := os.ReadFile(path)
		if err != nil {
			return nil
		}
		text := string(src)
		if !strings.Contains(text, "Summary") {
			return nil
		}
		checked++

		fset := token.NewFileSet()
		f, err := parser.ParseFile(fset, path, src, 0)
		if err != nil {
			return nil
		}
		// A call whose arguments mention .Summary and whose callee is a string
		// INSPECTION is the shape being denied — strings.Contains(d.Summary,
		// "on"), strconv.ParseFloat(d.Summary, …), a regexp match, and so on.
		// Assignment and formatting are fine: those pass it along.
		ast.Inspect(f, func(n ast.Node) bool {
			call, ok := n.(*ast.CallExpr)
			if !ok {
				return true
			}
			sel, ok := call.Fun.(*ast.SelectorExpr)
			if !ok {
				return true
			}
			pkg, isIdent := sel.X.(*ast.Ident)
			if !isIdent {
				return true
			}
			switch pkg.Name {
			case "strings", "strconv", "regexp", "fmt":
			default:
				return true
			}
			// fmt is allowed to FORMAT it; only its scanning half inspects.
			if pkg.Name == "fmt" && !strings.HasPrefix(sel.Sel.Name, "Sscan") {
				return true
			}
			for _, arg := range call.Args {
				if argMentionsSummary(arg) {
					offenders = append(offenders, filepath.Base(path)+": "+
						pkg.Name+"."+sel.Sel.Name+" on a device Summary")
				}
			}
			return true
		})
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	// The guard on the guard: if the walk stopped finding files that mention
	// Summary at all, it would pass forever having read nothing.
	if checked < len(summaryReaders) {
		t.Fatalf("only %d files mentioning Summary were scanned, expected at least %d — "+
			"the walk has drifted", checked, len(summaryReaders))
	}
	if len(offenders) > 0 {
		t.Errorf("Summary is presentational and must not be parsed (model.go says so):\n  %s\n\n"+
			"Answering \"which lights are on\" needs a machine-readable state on the device "+
			"model, not a guess at what a driver wrote for a human.",
			strings.Join(offenders, "\n  "))
	}
}

func argMentionsSummary(e ast.Expr) bool {
	found := false
	ast.Inspect(e, func(n ast.Node) bool {
		if sel, ok := n.(*ast.SelectorExpr); ok && sel.Sel.Name == "Summary" {
			found = true
		}
		return !found
	})
	return found
}
