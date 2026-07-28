package keys

import (
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"unicode/utf16"
	"unicode/utf8"
)

// Canonicalize renders v as RFC 8785 (JCS) canonical JSON, for the subset of
// values command envelopes use.
//
// Implemented per RFC 8785: no insignificant whitespace; object keys sorted
// by UTF-16 code units; strings with the shortest-form escapes (\b \t \n \f
// \r \" \\ and \u00XX for other control chars, everything else literal
// UTF-8); literals true/false/null; arrays in order.
//
// DEVIATION (documented, on purpose): full ECMAScript double formatting for
// non-integer numbers is NOT implemented — envelopes only carry integers
// (iat, exp, v) and strings, so Canonicalize accepts integral numbers within
// the IEEE-754 safe range (|n| <= 2^53) and returns an error for anything
// else. If proto/vectors/ later ships vectors requiring general doubles,
// implement the Ryu/ECMAScript algorithm and drop this restriction.
func Canonicalize(v any) ([]byte, error) {
	var b strings.Builder
	if err := writeJCS(&b, v); err != nil {
		return nil, err
	}
	return []byte(b.String()), nil
}

// CanonicalizeJSON canonicalizes a raw JSON document (parse, then re-render
// canonically).
func CanonicalizeJSON(raw []byte) ([]byte, error) {
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	dec.UseNumber()
	var v any
	if err := dec.Decode(&v); err != nil {
		return nil, err
	}
	return Canonicalize(v)
}

func writeJCS(b *strings.Builder, v any) error {
	switch x := v.(type) {
	case nil:
		b.WriteString("null")
	case bool:
		if x {
			b.WriteString("true")
		} else {
			b.WriteString("false")
		}
	case string:
		writeJCSString(b, x)
	case int:
		b.WriteString(strconv.FormatInt(int64(x), 10))
	case int64:
		b.WriteString(strconv.FormatInt(x, 10))
	case uint64:
		b.WriteString(strconv.FormatUint(x, 10))
	case float64:
		return writeJCSFloat(b, x)
	case json.Number:
		// Exact integers FIRST, before float64 can round them.
		//
		// Float64() on json.Number("9007199254740993") returns 9007199254740992
		// — 2^53+1 is not representable — so the range check below then sees a
		// value inside the safe range and emits the rounded number. The
		// document that gets signed differs from the one that arrived, silently,
		// which is exactly what the deviation note promises not to do:
		// "accepts integral numbers within the IEEE-754 safe range (|n| <= 2^53)
		// and returns an error for anything else".
		//
		// ParseInt on the literal keeps the exact value, so the bound is applied
		// to what was actually written. Anything ParseInt rejects — a real, an
		// exponent form like 1e2, something past int64 — falls through to the
		// float path, which expands exponents and refuses non-integers as before.
		//
		// Found by a shared canonicalisation case (proto/jcs-cases.json), which
		// exists because the two implementations of this file cannot import each
		// other and must be held to the same data.
		if n, err := strconv.ParseInt(x.String(), 10, 64); err == nil {
			if n > 1<<53 || n < -(1<<53) {
				return fmt.Errorf("jcs: integer %d outside the IEEE-754 safe range (see Canonicalize deviation note)", n)
			}
			b.WriteString(strconv.FormatInt(n, 10))
			return nil
		}
		f, err := x.Float64()
		if err != nil {
			return err
		}
		return writeJCSFloat(b, f)
	case []any:
		b.WriteByte('[')
		for i, e := range x {
			if i > 0 {
				b.WriteByte(',')
			}
			if err := writeJCS(b, e); err != nil {
				return err
			}
		}
		b.WriteByte(']')
	case map[string]any:
		keys := make([]string, 0, len(x))
		for k := range x {
			keys = append(keys, k)
		}
		sort.Slice(keys, func(i, j int) bool { return lessUTF16(keys[i], keys[j]) })
		b.WriteByte('{')
		for i, k := range keys {
			if i > 0 {
				b.WriteByte(',')
			}
			writeJCSString(b, k)
			b.WriteByte(':')
			if err := writeJCS(b, x[k]); err != nil {
				return err
			}
		}
		b.WriteByte('}')
	default:
		return fmt.Errorf("jcs: unsupported type %T", v)
	}
	return nil
}

func writeJCSFloat(b *strings.Builder, f float64) error {
	if f != math.Trunc(f) || math.Abs(f) > 1<<53 || math.IsNaN(f) || math.IsInf(f, 0) {
		return fmt.Errorf("jcs: non-integer number %v not supported (see Canonicalize deviation note)", f)
	}
	b.WriteString(strconv.FormatInt(int64(f), 10))
	return nil
}

// writeJCSString emits the RFC 8785 §3.2.2.2 shortest-form string encoding.
func writeJCSString(b *strings.Builder, s string) {
	b.WriteByte('"')
	for _, r := range s {
		switch r {
		case '"':
			b.WriteString(`\"`)
		case '\\':
			b.WriteString(`\\`)
		case '\b':
			b.WriteString(`\b`)
		case '\t':
			b.WriteString(`\t`)
		case '\n':
			b.WriteString(`\n`)
		case '\f':
			b.WriteString(`\f`)
		case '\r':
			b.WriteString(`\r`)
		default:
			if r < 0x20 {
				fmt.Fprintf(b, `\u%04x`, r)
			} else {
				b.WriteRune(r)
			}
		}
	}
	b.WriteByte('"')
}

// lessUTF16 compares strings by UTF-16 code units (RFC 8785 key ordering).
// For BMP-only strings this equals byte order; it differs once one side has
// supplementary-plane characters.
func lessUTF16(a, b string) bool {
	if isASCII(a) && isASCII(b) {
		return a < b
	}
	ua, ub := utf16.Encode([]rune(a)), utf16.Encode([]rune(b))
	for i := 0; i < len(ua) && i < len(ub); i++ {
		if ua[i] != ub[i] {
			return ua[i] < ub[i]
		}
	}
	return len(ua) < len(ub)
}

func isASCII(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] >= utf8.RuneSelf {
			return false
		}
	}
	return true
}
