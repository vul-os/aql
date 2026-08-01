package channels_test

import (
	"testing"

	"github.com/vul-os/aql/hub/internal/channels"
)

// The three phrasings the old comment named as the reason not to do this. All
// contain exactly one number, and a parser insisting on exactly one reads them
// identically — which is what makes the objection solvable rather than
// permanent.
func TestTheThreePhrasingsAllParseTheSame(t *testing.T) {
	for _, body := range []string{
		"dim the lounge to 30",
		"dim the lounge to 30%",
		"dim lounge 30 percent",
		"set lounge lights 30",
	} {
		got, ok := channels.Quantity(body)
		if !ok || got != 30 {
			t.Errorf("Quantity(%q) = %v, %v — want 30, true", body, got, ok)
		}
	}
}

// Ambiguity refuses. "lounge 2" is a device name and 30 is a level, and nothing
// here can tell which number is which — §3.5 says that is a refusal, not a
// guess.
func TestTwoNumbersIsAmbiguousAndRefuses(t *testing.T) {
	if _, ok := channels.Quantity("dim lounge 2 to 30"); ok {
		t.Error("a body with two numbers produced a quantity")
	}
	if n := channels.QuantityCount("dim lounge 2 to 30"); n != 2 {
		t.Errorf("QuantityCount = %d, want 2 — the refusal needs to say which problem it is", n)
	}
}

func TestNoNumberIsItsOwnAnswer(t *testing.T) {
	if _, ok := channels.Quantity("dim the lounge"); ok {
		t.Error("a body with no number produced a quantity")
	}
	if n := channels.QuantityCount("dim the lounge"); n != 0 {
		t.Errorf("QuantityCount = %d, want 0", n)
	}
}

func TestDecimalsSurvive(t *testing.T) {
	got, ok := channels.Quantity("set it to 21.5")
	if !ok || got != 21.5 {
		t.Errorf("got %v, %v", got, ok)
	}
}

// The range is the catalogue's business, not this parser's. Out-of-range values
// PARSE, and Registry.Resolve refuses them with the bounds — one authority on
// what a verb accepts.
func TestOutOfRangeValuesStillParse(t *testing.T) {
	for _, body := range []string{"dim to 0", "dim to 100", "dim to 5000"} {
		if _, ok := channels.Quantity(body); !ok {
			t.Errorf("Quantity(%q) refused — range belongs to the catalogue", body)
		}
	}
}
