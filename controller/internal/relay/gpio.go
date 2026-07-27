//go:build gpio

// Hardware GPIO relay driver, compiled only with `-tags gpio`. Without the
// tag none of these files exist and the agent uses Mock (relay.go) exactly
// as before — the default build is unchanged.
//
// # STATUS: NOT VALIDATED ON HARDWARE
//
// This driver was written and tested with no Raspberry Pi, no relay board
// and no /dev/gpiochip device anywhere in reach. What is tested is
// everything above the kernel boundary: configuration validation, the
// actuation state machine, polarity mapping, pulse timing and abort, every
// error path, and the byte layout of the ioctl arguments (gpio_test.go,
// gpio_abi_test.go). What is untested is the only thing that actually moves
// a gate: the ioctls have never been executed against a running kernel by
// this tree's authors. Treat the first deployment as bring-up — meter the
// line, or fire a spare relay, with the motor disconnected.
//
// # Why the character device
//
// Two kernel interfaces expose GPIO: the legacy sysfs tree at
// /sys/class/gpio (deprecated since 4.8, scheduled for removal, no
// ownership model, and racy — export/direction/value are three separate
// filesystem operations with no atomicity and no way to tell who else has
// the pin) and the character device at /dev/gpiochipN. This driver uses the
// character device, uAPI v2 (kernel ≥ 5.10), for one reason above all
// others: the kernel ties the claim on the line to the lifetime of a file
// descriptor. That is the whole fail-safe story below. It also gives
// exclusive ownership (a second claimant gets EBUSY instead of quietly
// fighting over the pin), a consumer label visible in `gpioinfo`, and
// kernel-side debounce for inputs.
//
// No cgo and no GPIO library: the ioctls are issued with the standard
// library's syscall package, so the controller module keeps exactly one
// third-party dependency (tinygo.org/x/bluetooth, `-tags ble` only).
//
// # Failure model
//
// The relay is normally-open and the gate is safe when the relay is
// DE-ENERGISED. Every rule below exists to make de-energised the state the
// system falls into, not the state it has to be driven to.
//
//  1. Process death (SIGKILL, OOM kill, panic, power loss to the Pi's
//     userspace, `systemctl kill`). No deferred cleanup runs on SIGKILL, so
//     none is relied on. The line is held by a request file descriptor; the
//     kernel closes every fd of a dying process and releases the line as
//     part of that. This is the only cleanup path that cannot be skipped,
//     and it is why the driver never keeps the line claimed "for later"
//     through any other mechanism. The fd is also explicitly marked
//     FD_CLOEXEC so an exec'd child can never inherit the claim and outlive
//     us holding the gate.
//
//     What the kernel guarantees on release is that the line is FREED —
//     not that the relay drops. On the Raspberry Pi (pinctrl-bcm2835) the
//     pin's free callback returns it to GPIO input, i.e. high impedance;
//     other SoCs' pinctrl drivers may leave the pad driving. High impedance
//     is not the same as de-energised: whichever way the pin floats is
//     decided by the external circuit. THE INSTALLATION MUST FIT A PULL
//     RESISTOR THAT HOLDS THE RELAY INPUT AT ITS DE-ENERGISED LEVEL, and
//     the line must be one whose SoC power-on default agrees (on BCM283x,
//     GPIO0–8 default to pull-up and GPIO9–27 to pull-down, so an
//     active-high relay belongs on the pull-down half). No software in this
//     package can substitute for that resistor.
//
//  2. An ioctl on the OUTPUT line fails, at any point including halfway
//     through a pulse. The driver does not retry and does not carry on with
//     a half-trusted line: it closes the request fd — which hands the line
//     back to the kernel, i.e. the same state a crash would leave — records
//     the error, moves to state "fault", and fails every subsequent
//     actuation with that error. There is no in-process recovery; a faulted
//     driver needs the process restarted. A trailing-edge failure is
//     reported to the caller, so command.Processor emits result "error"
//     with an "hw:…" detail and does NOT record an "opened" event.
//
//  3. The line is already claimed by another process. GPIO_V2_GET_LINE
//     returns EBUSY and Open fails; the agent refuses to start rather than
//     coming up with a relay it cannot drive. Open first reads the line's
//     info so the error can name the current consumer.
//
//  4. Nonsense configuration. All of it is rejected by Open — chip path,
//     line offset, polarity, pulse bounds, hold ceiling, consumer label,
//     sensor line — and Open then performs one explicit de-assert so the
//     value ioctl is proven at startup instead of at 2 a.m. on a command
//     that matters. A pulse duration outside the configured bounds is
//     refused at actuation time (the duration arrives per-command from the
//     config store): the gate does not open, which is the correct failure
//     for an access-control device that must never "open on doubt".
//
//  5. Hold left latched. Hold arms a watchdog (MaxHold) that de-energises
//     the relay unconditionally. It is anchored at the FIRST Hold and is
//     not re-armed by repeated Holds, so the maximum continuous energised
//     time is bounded no matter how the caller behaves. This is a second
//     line of defence behind command.Processor's own hold_max timer.
//
//  6. The process hangs (deadlock, SIGSTOP, a stalled disk under the event
//     queue) while the relay is energised. Nothing in this driver — and
//     nothing in the kernel's GPIO subsystem, which has no output watchdog
//     — will drop the line. A hung process holds its fds. If an
//     installation needs a bound on energised time that survives a hung
//     userspace, that bound has to be hardware: a monostable/one-shot on
//     the relay coil, or a hardware watchdog wired to reset the Pi. This
//     driver cannot provide it and does not pretend to.
//
//  7. Sensor reads are treated differently on purpose. A failed read of the
//     position input does NOT fault the driver — a flaky reed switch must
//     not disable the gate output. GateClosed reports (false, true): a
//     sensor is present, and we will not claim the gate is closed when we
//     could not read it. That direction is chosen so a broken sensor
//     produces a spurious "not closed" (an alarm) rather than a suppressed
//     one.
//
// # What this driver does not do
//
// No tamper input, no edge/event watching, no interrupt-driven position
// tracking, no multi-line groups: the Sensors interface exposes one
// position input and that is all that is implemented. Nothing here fakes a
// reading it did not take.
package relay

import (
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"
)

// Additive State() values beyond the "idle" | "pulsing" | "held" trio in the
// Relay interface. Consumers must treat any value other than StateIdle as
// "the relay may be energised".
const (
	StateIdle    = "idle"
	StatePulsing = "pulsing"
	StateHeld    = "held"
	// StateFault means an output ioctl failed; the line has been handed
	// back to the kernel and no further actuation will be attempted.
	StateFault = "fault"
	// StateClosed means Close was called; the driver is shut down.
	StateClosed = "closed"
)

// Defaults and hard limits. The limits are deliberately narrow: this drives
// a gate motor, and a configuration outside these ranges is far more likely
// to be a typo than an intent.
const (
	DefaultChip     = "/dev/gpiochip0"
	DefaultConsumer = "lintel-controller"

	DefaultMinPulse = 50 * time.Millisecond
	DefaultMaxPulse = 5 * time.Second
	DefaultMaxHold  = 30 * time.Minute

	minPulseFloor  = 10 * time.Millisecond // below a relay coil's pull-in time
	maxPulseCeil   = 30 * time.Second      // longer than this is a Hold, not a pulse
	maxHoldCeil    = 24 * time.Hour
	maxLineOffset  = 1023 // GPIO_V2_LINES_MAX per request; chips index far below this
	maxDebounceMs  = 5000
	maxChipDigits  = 3
	chipPathPrefix = "/dev/gpiochip"
)

// ErrUnsupported is returned by Open on non-Linux hosts: the GPIO character
// device is a Linux interface and this package has no other backend.
var ErrUnsupported = errors.New("relay: gpio character device is Linux-only")

// ErrClosed is returned once Close has been called.
var ErrClosed = errors.New("relay: driver closed")

// Bias selects the internal pull applied to a line while it is claimed.
//
// On a push-pull output the bias does nothing while the line is driven; it
// is offered because on some pinctrl drivers the pull register survives the
// line being freed and can help hold a released pin at its de-energised
// level. That is driver-specific behaviour, it is NOT a guarantee, and it is
// never a substitute for the external pull resistor described in the
// failure model above.
type Bias uint8

const (
	BiasDefault  Bias = iota // leave the pin's existing bias alone
	BiasDisabled             // GPIO_V2_LINE_FLAG_BIAS_DISABLED
	BiasPullUp               // GPIO_V2_LINE_FLAG_BIAS_PULL_UP
	BiasPullDown             // GPIO_V2_LINE_FLAG_BIAS_PULL_DOWN
)

func (b Bias) valid() bool { return b <= BiasPullDown }

func (b Bias) flag() uint64 {
	switch b {
	case BiasDisabled:
		return lineFlagBiasDisabled
	case BiasPullUp:
		return lineFlagBiasPullUp
	case BiasPullDown:
		return lineFlagBiasPullDown
	default:
		return 0
	}
}

// GPIOSensorConfig describes the optional position input read by GateClosed.
type GPIOSensorConfig struct {
	// Line is the input's offset on the same chip as the relay output.
	Line uint32
	// ActiveLow is true when the gate-closed contact pulls the line LOW.
	// The kernel applies the inversion, so the driver always reads logical
	// 1 == "gate closed".
	ActiveLow bool
	// Bias is the internal pull for the input — a mechanical contact to
	// ground needs BiasPullUp with ActiveLow, a contact to 3V3 needs
	// BiasPullDown. A floating input reads noise, so leaving this at
	// BiasDefault is only correct if the pull is external.
	Bias Bias
	// DebounceMs is kernel-side debounce (GPIO_V2_LINE_ATTR_ID_DEBOUNCE).
	// 0 disables it. Not all chips implement it; those that do not make
	// Open fail with EOPNOTSUPP rather than silently ignoring it.
	DebounceMs uint32
}

// GPIOConfig configures the hardware relay. The zero value is usable: it
// means "line 0 of /dev/gpiochip0, active high, no sensor", with the default
// pulse bounds and hold ceiling.
type GPIOConfig struct {
	// Chip is "/dev/gpiochip0", "gpiochip0" or "0"; empty means DefaultChip.
	Chip string
	// Line is the relay output's offset ON THE CHIP. On a Pi's main
	// gpiochip this equals the BCM number, but that is a property of that
	// chip, not a rule — check `gpioinfo`.
	Line uint32
	// ActiveLow is true when the relay board energises on a LOW level (most
	// opto-isolated boards do). The kernel applies the inversion, so the
	// driver always writes logical 1 to energise.
	ActiveLow bool
	// Bias for the output line; see Bias.
	Bias Bias
	// Consumer is the label `gpioinfo` shows for the claimed line.
	Consumer string
	// MinPulse / MaxPulse bound the duration accepted by Pulse. A pulse
	// outside the range is refused, not clamped.
	MinPulse, MaxPulse time.Duration
	// MaxHold is the watchdog ceiling on a latched Hold.
	MaxHold time.Duration
	// Sensor, when non-nil, claims a second line as the position input.
	Sensor *GPIOSensorConfig
	// Log receives the transition log; nil uses slog.Default().
	Log *slog.Logger
}

// lineHandle is the seam between the state machine and the kernel: the
// Linux implementation is one gpio_v2 line request fd, and tests substitute
// a fake so every error path — including a failure on the trailing edge of
// a pulse — is exercised on hosts with no GPIO at all.
type lineHandle interface {
	// set drives the line to a logical level (true = asserted = relay
	// energised, polarity already handled by the kernel).
	set(asserted bool) error
	// get reads the logical level.
	get() (bool, error)
	// close releases the line back to the kernel.
	close() error
}

// GPIO is the hardware Relay + Sensors implementation. See the package doc
// for the failure model, and note that it has NOT been validated against
// real hardware.
type GPIO struct {
	cfg GPIOConfig
	log *slog.Logger

	mu    sync.Mutex
	out   lineHandle
	in    lineHandle // nil when no sensor is configured
	state string
	err   error // first unrecoverable output error; non-nil ⇒ state fault
	// gen invalidates an in-flight pulse whose trailing edge has been
	// overtaken by a Release, a fault or a later actuation.
	gen   uint64
	abort chan struct{}
	hold  *time.Timer
}

var (
	_ Relay   = (*GPIO)(nil)
	_ Sensors = (*GPIO)(nil)
)

// NewGPIO opens the relay on chip/line with default polarity (active high),
// default pulse bounds and no sensor.
//
// It returns an error where the old build-tag stub returned a value that
// panicked on use: a relay that cannot be claimed must stop the agent at
// startup, not at the first command.
func NewGPIO(chip string, line int) (*GPIO, error) {
	if line < 0 || line > maxLineOffset {
		return nil, fmt.Errorf("relay: line %d out of range 0..%d", line, maxLineOffset)
	}
	return Open(GPIOConfig{Chip: chip, Line: uint32(line)})
}

// Open validates cfg, claims the line(s) and leaves the relay de-energised.
// Every configuration error is reported here rather than at actuation time.
func Open(cfg GPIOConfig) (*GPIO, error) {
	c, err := cfg.normalized()
	if err != nil {
		return nil, err
	}
	out, in, err := openLines(c)
	if err != nil {
		return nil, err
	}
	return newGPIO(c, out, in)
}

// newGPIO wires an already-claimed pair of lines to the state machine. Open
// uses it with real line requests; the tests use it with fakes.
func newGPIO(cfg GPIOConfig, out, in lineHandle) (*GPIO, error) {
	g := &GPIO{cfg: cfg, log: cfg.Log, out: out, in: in, state: StateIdle}
	if g.log == nil {
		g.log = slog.Default()
	}
	// Prove the value ioctl now, not at the first command. The line was
	// already requested de-asserted; this is the round-trip check.
	if err := out.set(false); err != nil {
		_ = out.close()
		if in != nil {
			_ = in.close()
		}
		return nil, fmt.Errorf("relay: initial de-assert failed on %s line %d: %w", cfg.Chip, cfg.Line, err)
	}
	g.log.Info("relay: gpio ready (NOT hardware-validated)",
		"chip", cfg.Chip, "line", cfg.Line, "active_low", cfg.ActiveLow,
		"min_pulse", cfg.MinPulse, "max_pulse", cfg.MaxPulse, "max_hold", cfg.MaxHold,
		"sensor", cfg.Sensor != nil)
	return g, nil
}

// normalized applies defaults and rejects anything nonsensical.
func (c GPIOConfig) normalized() (GPIOConfig, error) {
	out := c
	chip, err := normalizeChipPath(c.Chip)
	if err != nil {
		return out, err
	}
	out.Chip = chip

	if c.Line > maxLineOffset {
		return out, fmt.Errorf("relay: line %d out of range 0..%d", c.Line, maxLineOffset)
	}
	if !c.Bias.valid() {
		return out, fmt.Errorf("relay: invalid bias %d", c.Bias)
	}

	if out.Consumer == "" {
		out.Consumer = DefaultConsumer
	}
	if err := validConsumer(out.Consumer); err != nil {
		return out, err
	}

	if out.MinPulse == 0 {
		out.MinPulse = DefaultMinPulse
	}
	if out.MaxPulse == 0 {
		out.MaxPulse = DefaultMaxPulse
	}
	if out.MinPulse < minPulseFloor {
		return out, fmt.Errorf("relay: min pulse %v below the %v floor", out.MinPulse, minPulseFloor)
	}
	if out.MaxPulse > maxPulseCeil {
		return out, fmt.Errorf("relay: max pulse %v above the %v ceiling (use Hold)", out.MaxPulse, maxPulseCeil)
	}
	if out.MinPulse > out.MaxPulse {
		return out, fmt.Errorf("relay: min pulse %v exceeds max pulse %v", out.MinPulse, out.MaxPulse)
	}

	if out.MaxHold == 0 {
		out.MaxHold = DefaultMaxHold
	}
	if out.MaxHold < out.MaxPulse {
		return out, fmt.Errorf("relay: max hold %v below max pulse %v", out.MaxHold, out.MaxPulse)
	}
	if out.MaxHold > maxHoldCeil {
		return out, fmt.Errorf("relay: max hold %v above the %v ceiling", out.MaxHold, maxHoldCeil)
	}

	if s := c.Sensor; s != nil {
		if s.Line > maxLineOffset {
			return out, fmt.Errorf("relay: sensor line %d out of range 0..%d", s.Line, maxLineOffset)
		}
		if s.Line == out.Line {
			return out, fmt.Errorf("relay: sensor line %d is the relay output line", s.Line)
		}
		if !s.Bias.valid() {
			return out, fmt.Errorf("relay: invalid sensor bias %d", s.Bias)
		}
		if s.DebounceMs > maxDebounceMs {
			return out, fmt.Errorf("relay: sensor debounce %dms above the %dms ceiling", s.DebounceMs, maxDebounceMs)
		}
		if s.DebounceMs != 0 && !hostIsLittleEndian() {
			return out, fmt.Errorf("relay: kernel debounce is unsupported on big-endian hosts")
		}
		cp := *s
		out.Sensor = &cp
	}
	return out, nil
}

// normalizeChipPath accepts "", "0", "gpiochip0" or "/dev/gpiochip0" and
// returns a canonical device path. Anything else is refused: the chip name
// can come from a config file, and this is not a general path parameter.
func normalizeChipPath(s string) (string, error) {
	if s == "" {
		return DefaultChip, nil
	}
	digits := s
	switch {
	case strings.HasPrefix(s, chipPathPrefix):
		digits = s[len(chipPathPrefix):]
	case strings.HasPrefix(s, "gpiochip"):
		digits = s[len("gpiochip"):]
	}
	if digits == "" || len(digits) > maxChipDigits {
		return "", fmt.Errorf("relay: invalid gpio chip %q (want /dev/gpiochipN)", s)
	}
	for _, r := range digits {
		if r < '0' || r > '9' {
			return "", fmt.Errorf("relay: invalid gpio chip %q (want /dev/gpiochipN)", s)
		}
	}
	return chipPathPrefix + digits, nil
}

// validConsumer keeps the label printable ASCII and short enough for the
// kernel's fixed-size field (including its NUL).
func validConsumer(s string) error {
	if len(s) > gpioMaxNameSize-1 {
		return fmt.Errorf("relay: consumer %q longer than %d bytes", s, gpioMaxNameSize-1)
	}
	for i := 0; i < len(s); i++ {
		if s[i] < 0x20 || s[i] > 0x7e {
			return fmt.Errorf("relay: consumer %q contains a non-printable byte", s)
		}
	}
	return nil
}

// outputFlags is the gpio_v2 line flag set for the relay output.
func outputFlags(c GPIOConfig) uint64 {
	f := lineFlagOutput | c.Bias.flag()
	if c.ActiveLow {
		f |= lineFlagActiveLow
	}
	return f
}

// inputFlags is the gpio_v2 line flag set for the position sensor.
func inputFlags(s GPIOSensorConfig) uint64 {
	f := lineFlagInput | s.Bias.flag()
	if s.ActiveLow {
		f |= lineFlagActiveLow
	}
	return f
}

// Pulse energizes the relay for d and blocks until the trailing edge.
//
// It blocks on purpose. The caller's error return then covers BOTH edges: a
// failure to drop the line is reported as an error rather than disappearing
// into a background timer, so command.Processor records "error" instead of
// "opened" when the gate was left energised. d is refused, not clamped, if
// it falls outside [MinPulse, MaxPulse].
func (g *GPIO) Pulse(d time.Duration) error {
	g.mu.Lock()
	if err := g.readyLocked(); err != nil {
		g.mu.Unlock()
		return err
	}
	if d < g.cfg.MinPulse || d > g.cfg.MaxPulse {
		g.mu.Unlock()
		return fmt.Errorf("relay: pulse %v outside the configured %v..%v", d, g.cfg.MinPulse, g.cfg.MaxPulse)
	}
	if g.state != StateIdle {
		s := g.state
		g.mu.Unlock()
		return fmt.Errorf("relay: cannot pulse while %s", s)
	}
	if err := g.out.set(true); err != nil {
		err = g.faultLocked("pulse leading edge", err)
		g.mu.Unlock()
		return err
	}
	g.gen++
	mine := g.gen
	abort := make(chan struct{})
	g.abort = abort
	g.setStateLocked(StatePulsing)
	g.mu.Unlock()

	t := time.NewTimer(d)
	select {
	case <-t.C:
	case <-abort: // Release cut the pulse short; it owns the trailing edge.
		t.Stop()
	}

	g.mu.Lock()
	defer g.mu.Unlock()
	if g.gen != mine {
		// Release, a fault or Close already took the line somewhere else.
		if g.err != nil {
			return fmt.Errorf("relay: faulted during pulse: %w", g.err)
		}
		return nil
	}
	g.abort = nil
	if err := g.out.set(false); err != nil {
		return g.faultLocked("pulse trailing edge", err)
	}
	g.setStateLocked(StateIdle)
	return nil
}

// Hold latches the relay energised until Release, or until the MaxHold
// watchdog fires. Repeated Holds are idempotent and do NOT re-arm the
// watchdog: the bound is on continuous energised time, not on time since
// the last command.
func (g *GPIO) Hold() error {
	g.mu.Lock()
	defer g.mu.Unlock()
	if err := g.readyLocked(); err != nil {
		return err
	}
	if g.state == StateHeld {
		return nil
	}
	if g.state != StateIdle {
		return fmt.Errorf("relay: cannot hold while %s", g.state)
	}
	if err := g.out.set(true); err != nil {
		return g.faultLocked("hold", err)
	}
	g.gen++
	g.setStateLocked(StateHeld)
	g.hold = time.AfterFunc(g.cfg.MaxHold, g.holdExpired)
	return nil
}

func (g *GPIO) holdExpired() {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.state != StateHeld {
		return
	}
	g.log.Warn("relay: hold watchdog expired, de-energising", "max_hold", g.cfg.MaxHold)
	g.gen++
	if err := g.out.set(false); err != nil {
		_ = g.faultLocked("hold watchdog", err)
		return
	}
	g.setStateLocked(StateIdle)
}

// Release de-energises the relay: it ends a Hold, cuts a Pulse short, and is
// a no-op-but-still-a-write when already idle. The safe direction is always
// attempted.
//
// After a fault the line has already been handed back to the kernel, but
// Release still reports the fault: the driver cannot prove the relay
// dropped (that depends on the external pull — see the failure model), and
// reporting success would be a claim it cannot make.
func (g *GPIO) Release() error {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.gen++
	if g.abort != nil {
		close(g.abort)
		g.abort = nil
	}
	g.stopHoldLocked()
	if g.state == StateClosed {
		return ErrClosed
	}
	if g.err != nil {
		return fmt.Errorf("relay: faulted, line released to the kernel: %w", g.err)
	}
	if err := g.out.set(false); err != nil {
		return g.faultLocked("release", err)
	}
	g.setStateLocked(StateIdle)
	return nil
}

// State implements Relay. In addition to "idle"/"pulsing"/"held" it can
// return StateFault or StateClosed; treat anything other than "idle" as
// "the relay may be energised".
func (g *GPIO) State() string {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.state
}

// Err returns the error that faulted the driver, or nil.
func (g *GPIO) Err() error {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.err
}

// Close de-energises the relay and releases the lines. It is the orderly
// path; the kernel performs the same release if the process dies instead.
func (g *GPIO) Close() error {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.state == StateClosed {
		return nil
	}
	g.gen++
	if g.abort != nil {
		close(g.abort)
		g.abort = nil
	}
	g.stopHoldLocked()
	var errs []error
	if g.err == nil {
		if err := g.out.set(false); err != nil {
			errs = append(errs, fmt.Errorf("de-assert: %w", err))
		}
	}
	errs = append(errs, g.releaseLinesLocked()...)
	g.state = StateClosed
	g.log.Info("relay", "state", StateClosed)
	return errors.Join(errs...)
}

// GateClosed implements Sensors.
//
// With no sensor configured it reports (true, false) — "no sensor present",
// matching Mock. With one configured it reports the real line level; if the
// read fails it reports (false, true), because a sensor we cannot read must
// not be allowed to assert that the gate is shut. A read failure does not
// fault the output driver.
func (g *GPIO) GateClosed() (bool, bool) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.cfg.Sensor == nil {
		return true, false
	}
	// A sensor IS configured; if its line has been released (fault/close)
	// we still report "present" and refuse to claim the gate is shut.
	if g.in == nil || g.state == StateClosed {
		return false, true
	}
	closed, err := g.in.get()
	if err != nil {
		g.log.Error("relay: sensor read failed", "line", g.cfg.Sensor.Line, "err", err)
		return false, true
	}
	return closed, true
}

func (g *GPIO) readyLocked() error {
	switch {
	case g.state == StateClosed:
		return ErrClosed
	case g.err != nil:
		return fmt.Errorf("relay: faulted: %w", g.err)
	}
	return nil
}

// faultLocked is the one-way door: an output ioctl failed, so the line is
// handed back to the kernel and the driver refuses to actuate again.
func (g *GPIO) faultLocked(where string, cause error) error {
	if g.err == nil {
		g.err = cause
	}
	g.gen++
	g.stopHoldLocked()
	relErrs := g.releaseLinesLocked()
	g.state = StateFault
	g.log.Error("relay: FAULT, line released to the kernel",
		"where", where, "err", cause, "release_errs", errors.Join(relErrs...))
	return fmt.Errorf("relay: %s failed, line released to the kernel: %w", where, cause)
}

// releaseLinesLocked closes the line requests. Closing the fd is what makes
// the kernel drop the claim, so this is deliberately unconditional and
// idempotent.
func (g *GPIO) releaseLinesLocked() []error {
	var errs []error
	if g.out != nil {
		if err := g.out.close(); err != nil {
			errs = append(errs, fmt.Errorf("close output line: %w", err))
		}
		g.out = nil
	}
	if g.in != nil {
		if err := g.in.close(); err != nil {
			errs = append(errs, fmt.Errorf("close sensor line: %w", err))
		}
		g.in = nil
	}
	return errs
}

func (g *GPIO) stopHoldLocked() {
	if g.hold != nil {
		g.hold.Stop()
		g.hold = nil
	}
}

func (g *GPIO) setStateLocked(s string) {
	g.state = s
	g.log.Info("relay", "state", s)
}
