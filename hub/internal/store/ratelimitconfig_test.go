package store

import (
	"strconv"
	"testing"
)

// The rate-limit config parsers, which were at 0% coverage.
//
// These sit under a claim the repo advertises as shipped
// (login-brute-force-rate-limiting), and they are the layer where an operator's
// environment meets the limiter. Everything downstream — the fixed-window
// counters, the kill-switch convention, the Argon2id-before-check ordering — is
// tested. What was not tested was whether the numbers those tests exercise are
// the numbers a running hub actually gets.
//
// The failure modes are asymmetric and both silent. A parser that returned 0 on
// unparseable input would turn a typo in an env var into a total login outage,
// because `limit <= 0` is the kill-switch that blocks everything. One that
// returned a huge value, or ignored the variable, would turn the same typo into
// brute-force protection that is simply switched off. Neither logs anything.

func TestUnparseableRateLimitValuesFallBackToTheDefaultRatherThanToZeroOrInfinity(t *testing.T) {
	// A fallback that collides with no value in the table below. The first
	// draft used 20 and included " 20 " as a supposedly-unparseable case; the
	// parser TrimSpaces before ParseInt, so it parsed to 20, which equalled the
	// fallback and the row passed while asserting the opposite of the truth.
	const fallback int64 = 77
	for _, raw := range []string{
		"",                    // unset
		"   ",                 // whitespace only, e.g. RATE_LOGIN_IP_PER_5MIN= in a unit file
		"abc",                 // typo
		"20x",                 // trailing junk
		"1e3",                 // scientific notation is not accepted
		"2.5",                 // not an integer
		"-1",                  // negative: NOT a kill switch, or `-1` would read as "off"
		"-999999",             //
		"0x10",                // not base 16, and ParseInt is given base 10
		"9223372036854775808", // one past MaxInt64
	} {
		if got := ParseRateLimitValue(raw, fallback); got != fallback {
			t.Errorf("ParseRateLimitValue(%q) = %d, want the default %d.\n"+
				"Anything else turns a mistyped environment variable into either a "+
				"silent login outage (0 blocks everything) or silently absent "+
				"brute-force protection.", raw, got, fallback)
		}
	}
}

// An explicit value IS honoured, including the 0 kill switch and a
// surrounding-whitespace value, which TrimSpace accepts on purpose.
//
// The control for the test above, which a parser that always returned the
// fallback would satisfy completely — and that parser would make every limit
// unconfigurable while looking correct.
//
// Overlaps TestParseRateLimitValue in product_test.go, which covers the same
// function more briefly. Kept because the table above needs its own control
// beside it rather than in another file, where a later edit would not see it.
func TestAnExplicitValueIsHonouredIncludingTheZeroKillSwitch(t *testing.T) {
	if got := ParseRateLimitValue("0", 20); got != 0 {
		t.Errorf("ParseRateLimitValue(\"0\") = %d, want 0. Zero is the kill switch "+
			"(`limit <= 0` blocks everything); collapsing it into the default would "+
			"leave an operator unable to close an endpoint.", got)
	}
	for _, n := range []int64{1, 5, 100, 1_000_000} {
		if got := ParseRateLimitValue(strconv.FormatInt(n, 10), 77); got != n {
			t.Errorf("ParseRateLimitValue(%d) = %d, want %d — the variable is being ignored", n, got, n)
		}
	}
	// Whitespace around a real value is trimmed rather than refused: a unit
	// file with `RATE_OPENS_PER_HOUR = 42` is a configuration that works.
	if got := ParseRateLimitValue(" 42 ", 77); got != 42 {
		t.Errorf("ParseRateLimitValue(\" 42 \") = %d, want 42", got)
	}
}

// Every field reads its OWN environment variable.
//
// This is the error that cannot be seen by reading: two fields whose lookups
// were copy-pasted read the same key, so setting one silently moves the other,
// and the value applied is plausible rather than absurd. Nothing downstream can
// notice — the limiter is handed a number and honours it.
//
// Asserted by giving every key a distinct value and checking the struct came
// back with all of them, which fails on a duplicated key AND on a field wired to
// the wrong variable, rather than only on a missing one.
func TestEveryRateLimitFieldReadsItsOwnVariable(t *testing.T) {
	t.Run("auth", func(t *testing.T) {
		env := map[string]string{
			"RATE_LOGIN_IP_PER_5MIN":       "101",
			"RATE_LOGIN_ACCOUNT_PER_5MIN":  "102",
			"RATE_REGISTER_IP_PER_5MIN":    "103",
			"RATE_REFRESH_IP_PER_5MIN":     "104",
			"RATE_ADMIN_CLAIM_IP_PER_5MIN": "105",
		}
		asked := map[string]int{}
		got := ParseAuthRateLimitConfig(func(k string) string {
			asked[k]++
			return env[k]
		})
		want := AuthRateLimitConfig{
			LoginIPPerWindow: 101, LoginAccountPerWindow: 102,
			RegisterIPPerWindow: 103, RefreshIPPerWindow: 104, ClaimIPPerWindow: 105,
		}
		if got != want {
			t.Errorf("ParseAuthRateLimitConfig = %+v, want %+v — a field is reading the "+
				"wrong variable, so setting one limit moves another", got, want)
		}
		assertEachAskedOnce(t, asked, env)
	})

	t.Run("access", func(t *testing.T) {
		env := map[string]string{
			"RATE_OPEN_COOLDOWN_S":        "201",
			"RATE_OPENS_PER_HOUR":         "202",
			"RATE_CHAT_MSGS_PER_MIN":      "203",
			"RATE_ACCOUNT_OPENS_PER_HOUR": "204",
		}
		asked := map[string]int{}
		got := ParseRateLimitConfig(func(k string) string {
			asked[k]++
			return env[k]
		})
		want := RateLimitConfig{
			OpenCooldownS: 201, OpensPerHour: 202,
			ChatMsgsPerMin: 203, AccountOpensPerHour: 204,
		}
		if got != want {
			t.Errorf("ParseRateLimitConfig = %+v, want %+v", got, want)
		}
		assertEachAskedOnce(t, asked, env)
	})
}

// Each expected key was looked up exactly once, and no others were.
//
// The struct comparison above already catches a duplicated key by its value;
// this catches the case where a key is read twice but the values happen to
// coincide, and it names any variable the parser consults that this test does
// not know about — a new limit added without a test is exactly the thing that
// then ships unconfigured.
func assertEachAskedOnce(t *testing.T, asked map[string]int, env map[string]string) {
	t.Helper()
	for k := range env {
		switch asked[k] {
		case 1:
		case 0:
			t.Errorf("%s was never looked up; the field it configures is stuck at its default", k)
		default:
			t.Errorf("%s was looked up %d times; two fields share a variable", k, asked[k])
		}
	}
	for k := range asked {
		if _, known := env[k]; !known {
			t.Errorf("the parser reads %s, which this test does not cover — add it here "+
				"so it cannot ship unconfigured", k)
		}
	}
}

// The defaults are actually limits.
//
// A default of 0 would block the endpoint outright on a hub with no
// configuration, which is every fresh install; a default left at some
// accidental huge value would advertise brute-force protection that never
// trips. Both are one edit away and neither would fail anything else here.
func TestTheShippedDefaultsAreBoundedAndNonZero(t *testing.T) {
	d := AuthRateLimitDefaults
	for name, v := range map[string]int64{
		"LoginIPPerWindow":      d.LoginIPPerWindow,
		"LoginAccountPerWindow": d.LoginAccountPerWindow,
		"RegisterIPPerWindow":   d.RegisterIPPerWindow,
		"RefreshIPPerWindow":    d.RefreshIPPerWindow,
		"ClaimIPPerWindow":      d.ClaimIPPerWindow,
	} {
		if v <= 0 {
			t.Errorf("default %s is %d; a fresh install with no configuration would "+
				"refuse every request to that endpoint", name, v)
		}
		if v > 10_000 {
			t.Errorf("default %s is %d, which bounds an automated script to nothing "+
				"useful — the claim that these limit brute force would not hold", name, v)
		}
	}
}
