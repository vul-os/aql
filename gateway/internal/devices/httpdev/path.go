package httpdev

import (
	"encoding/json"
	"errors"
	"strconv"
	"strings"
)

// The path grammar, in full. It is deliberately tiny — a JSONPath dependency
// would be a parser, an expression evaluator and a supply-chain surface, to
// address a response shape that a config author controls anyway.
//
//	path    := "" | segment ("." segment)*
//	segment := any run of characters other than "."
//
// Resolution walks the decoded document one segment at a time:
//
//   - The empty path selects the whole document.
//   - When the current value is a JSON object, the segment is used as a KEY,
//     verbatim. No unescaping, no quoting.
//   - When the current value is a JSON array, the segment must be a decimal
//     index (no sign, no spaces) within bounds; anything else fails.
//   - When the current value is a scalar and segments remain, resolution fails.
//
// The shape of the segment never decides the meaning — the type of the value
// does. So an object with the key "0" is addressed as "0" and there is no
// ambiguity with an array index.
//
// Known limitation, stated rather than worked around: a key CONTAINING a dot is
// not addressable. Wildcards, filters, recursive descent and negative indices
// are all absent. If a device needs them, that is a reviewed change here, not a
// dependency.
//
// Extraction from the resolved value:
//
//	number  -> Reading.Value
//	string  -> Reading.Text
//	bool    -> Reading.Value 1 or 0
//	null, object, array -> not a reading; the metric is skipped
func lookupPath(doc any, path string) (any, bool) {
	if path == "" {
		return doc, doc != nil
	}
	cur := doc
	for _, seg := range strings.Split(path, ".") {
		switch v := cur.(type) {
		case map[string]any:
			next, ok := v[seg]
			if !ok {
				return nil, false
			}
			cur = next
		case []any:
			i, err := strconv.Atoi(seg)
			if err != nil || i < 0 || i >= len(v) {
				return nil, false
			}
			cur = v[i]
		default:
			return nil, false
		}
	}
	return cur, cur != nil
}

// checkPath rejects a path that can never resolve, at config time. Only one
// such shape exists in this grammar: an empty segment, which would ask for the
// key "" and is far more likely a typo ("a..b", ".a", "a.").
func checkPath(path string) error {
	if path == "" {
		return nil
	}
	for _, seg := range strings.Split(path, ".") {
		if seg == "" {
			return errors.New("path has an empty segment")
		}
	}
	return nil
}

// scalar converts a resolved JSON value into a Reading's numeric or text part.
// The document is decoded with UseNumber, so numbers arrive as json.Number and
// keep their precision until this point.
func scalar(v any) (value float64, text string, ok bool) {
	switch t := v.(type) {
	case json.Number:
		f, err := t.Float64()
		if err != nil {
			return 0, "", false
		}
		return f, "", true
	case float64:
		return t, "", true
	case string:
		// An empty string is not a state. Reporting Text:"" would render as a
		// blank state row in the console, which reads as "known and empty"
		// rather than "not reported".
		if t == "" {
			return 0, "", false
		}
		return 0, t, true
	case bool:
		if t {
			return 1, "", true
		}
		return 0, "", true
	}
	return 0, "", false
}
