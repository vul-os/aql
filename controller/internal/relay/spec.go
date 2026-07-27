package relay

// Operator-facing relay configuration, parsed in every build.
//
// # Why this file has no build tag
//
// The GPIO driver is behind `-tags gpio`, and so is GPIOConfig. That is correct
// — the character-device ioctls are Linux-only and there is no second backend.
// But it means that without the tag, nothing about the relay configuration is
// compiled, and therefore nothing about it is TESTED in the build almost
// everyone runs.
//
// Configuration is exactly where operator mistakes happen. "Which line is the
// relay on" is a number someone reads off a wiring diagram at a gate, usually
// once, often wrong. So the parsing and validation live here, tag-free and
// tested everywhere, and only the ioctls sit behind the tag.
//
// # The rule this exists to make possible
//
// A controller told to drive a real relay that it cannot open MUST NOT fall
// back to the mock.
//
// The mock is not a degraded relay — it is a relay that reports SUCCESS. Every
// Pulse returns nil, the command is acked, and the hub records an `opened` row
// in a hash-chained audit trail. The gate does not move. That is the worst
// failure mode available here: not a gate that fails to open, but a record that
// says it did.
//
// So Spec is parsed before anything else, and a spec that cannot be honoured
// stops the controller at startup with an error naming why. See
// cmd/controller/relay.go.

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// Spec is a relay configuration in the form an operator types.
//
//	/dev/gpiochip0:17                       line 17, active high
//	/dev/gpiochip0:17,active-low            inverted drive
//	/dev/gpiochip0:17,bias=pull-up          bias the pin
//	/dev/gpiochip0:17,sensor=27,sensor-debounce=20ms
//
// The chip is a path rather than a number because a number is ambiguous:
// gpiochip numbering is not stable across kernel versions or across boots on
// boards with multiple controllers, and a relay that moves to a different line
// after an update is a gate that opens something else.
type Spec struct {
	Chip string
	Line uint32

	ActiveLow bool
	// BiasName is the operator's word, kept as text so this file need not
	// import the tagged Bias type. Validated here against the same closed set.
	BiasName string

	// Sensor is the optional gate-position input.
	HasSensor       bool
	SensorLine      uint32
	SensorActiveLow bool
	SensorDebounce  time.Duration
}

// ErrNoGPIOSupport is returned when a relay was configured but this binary
// cannot drive one.
//
// It is an ERROR and not a fallback, and that distinction is the whole point of
// this file.
//
// The tempting alternative — log a warning and use the Mock — would be a
// disaster on real hardware. Mock.Pulse returns nil. The command is acked, the
// hub writes an `opened` row into a hash-chained audit trail, the resident is
// told the gate opened, and nothing moves. A gate that fails to open is a
// visible fault someone fixes; a gate that reports opening while standing still
// corrupts the one record anybody would later trust.
//
// So a binary built without `-tags gpio` refuses to start when a relay is
// configured, and says exactly what is missing.
//
// Declared tag-free so a build WITH gpio support can still name the error when
// explaining what a build without it would have done.
var ErrNoGPIOSupport = errors.New(
	"relay: this controller was built without GPIO support; rebuild with `-tags gpio` " +
		"on Linux, or omit -relay to run with the mock relay (which actuates nothing)")

// ErrNoSpec means no relay was configured. Not an error in itself — it is how
// an operator asks for the mock — but callers must handle it explicitly rather
// than treating an empty Spec as a valid one.
var ErrNoSpec = errors.New("relay: no relay configured")

// BiasNames is the closed set, in the spelling an operator types.
var BiasNames = []string{"default", "disabled", "pull-up", "pull-down"}

func validBiasName(s string) bool {
	for _, k := range BiasNames {
		if s == k {
			return true
		}
	}
	return false
}

func specErr(format string, a ...any) error {
	return fmt.Errorf("relay: bad -relay spec: "+format, a...)
}

// ParseSpec turns an operator's string into a validated Spec.
//
// Every failure is a refusal, never a default. A misparsed line number that
// silently became 0 would drive whatever is wired to line 0 — on a Pi that is
// a real pin — so there is no forgiving path here at all.
func ParseSpec(raw string) (Spec, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return Spec{}, ErrNoSpec
	}

	parts := strings.Split(raw, ",")
	head := strings.TrimSpace(parts[0])

	// The chip path itself may contain no colon, so split on the LAST one.
	i := strings.LastIndex(head, ":")
	if i < 0 {
		return Spec{}, specErr("%q has no line number; expected <chip>:<line>", head)
	}
	chip := strings.TrimSpace(head[:i])
	lineText := strings.TrimSpace(head[i+1:])
	if chip == "" {
		return Spec{}, specErr("no chip path before the line number")
	}
	if !strings.HasPrefix(chip, "/") {
		// A bare "gpiochip0" would be resolved relative to the working
		// directory, which for a service unit is not where the device node is.
		return Spec{}, specErr("chip %q must be an absolute path, e.g. /dev/gpiochip0", chip)
	}
	line, err := parseLine(lineText)
	if err != nil {
		return Spec{}, err
	}

	s := Spec{Chip: chip, Line: line, BiasName: "default"}

	seen := map[string]bool{}
	for _, opt := range parts[1:] {
		opt = strings.TrimSpace(opt)
		if opt == "" {
			continue
		}
		key, value, hasValue := strings.Cut(opt, "=")
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		if seen[key] {
			return Spec{}, specErr("option %q given twice", key)
		}
		seen[key] = true

		switch key {
		case "active-low":
			if hasValue {
				return Spec{}, specErr("active-low takes no value")
			}
			s.ActiveLow = true
		case "bias":
			if !validBiasName(value) {
				return Spec{}, specErr("bias %q is not one of %s", value, strings.Join(BiasNames, ", "))
			}
			s.BiasName = value
		case "sensor":
			l, err := parseLine(value)
			if err != nil {
				return Spec{}, err
			}
			s.HasSensor = true
			s.SensorLine = l
		case "sensor-active-low":
			if hasValue {
				return Spec{}, specErr("sensor-active-low takes no value")
			}
			s.SensorActiveLow = true
		case "sensor-debounce":
			d, err := time.ParseDuration(value)
			if err != nil || d < 0 {
				return Spec{}, specErr("sensor-debounce %q is not a duration", value)
			}
			s.SensorDebounce = d
		default:
			// A closed vocabulary. A typo'd option that was ignored would mean
			// an operator believing they set active-low when they did not,
			// which inverts the drive on a gate.
			return Spec{}, specErr("unknown option %q", key)
		}
	}

	if s.HasSensor && s.SensorLine == s.Line {
		return Spec{}, specErr("sensor line %d is the relay line; one line cannot be both", s.SensorLine)
	}
	if !s.HasSensor && (s.SensorActiveLow || s.SensorDebounce != 0) {
		return Spec{}, specErr("sensor options given without sensor=<line>")
	}
	return s, nil
}

func parseLine(text string) (uint32, error) {
	if text == "" {
		return 0, specErr("empty line number")
	}
	n, err := strconv.ParseUint(text, 10, 32)
	if err != nil {
		return 0, specErr("line %q is not a number", text)
	}
	// The uAPI carries offsets as uint32 but no real chip has anywhere near
	// this many lines; the bound is here so an absurd value is refused at
	// startup rather than by an ioctl at the gate.
	if n > 1023 {
		return 0, specErr("line %d is implausible (max 1023)", n)
	}
	return uint32(n), nil
}

// String renders a Spec back to its input form, for logging. The chip path and
// line numbers are not secrets — they are exactly what an operator needs to see
// confirmed at startup.
func (s Spec) String() string {
	var b strings.Builder
	fmt.Fprintf(&b, "%s:%d", s.Chip, s.Line)
	if s.ActiveLow {
		b.WriteString(",active-low")
	}
	if s.BiasName != "" && s.BiasName != "default" {
		fmt.Fprintf(&b, ",bias=%s", s.BiasName)
	}
	if s.HasSensor {
		fmt.Fprintf(&b, ",sensor=%d", s.SensorLine)
		if s.SensorActiveLow {
			b.WriteString(",sensor-active-low")
		}
		if s.SensorDebounce > 0 {
			fmt.Fprintf(&b, ",sensor-debounce=%s", s.SensorDebounce)
		}
	}
	return b.String()
}
