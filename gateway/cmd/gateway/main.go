// Command gateway is the lintel server: one Go binary — channels, rules,
// portal, API, device hub, audit — backed by one SQLite file.
//
// Configuration is flags-over-env:
//
//	-data / LINTEL_DATA_DIR             data directory (SQLite db, signing keys)   default ./data
//	-listen / LINTEL_LISTEN             listen address                             default :8080
//	-public-url / LINTEL_PUBLIC_URL     external base URL (webhooks, links)        default ""
//	-admin-claim-token / ADMIN_CLAIM_TOKEN
//	                                    one-shot instance-admin claim token; empty = claim disabled (fail-closed)
//	-behind-proxy / LINTEL_BEHIND_PROXY  permit binding a non-loopback -listen address; default false
//
// Everything below this line is OFF unless it is configured. A hub that sets
// none of it starts, serves and opens gates exactly as it did before these
// flags existed — that is a requirement, not an accident, and
// TestHubWithNoSubsystemConfig holds the line on it. None of these can fail
// the process either: a driver that will not build, a config file that will
// not parse, an account that does not exist — each is logged and the
// subsystem it belongs to stays off. The access path never depends on any of
// them.
//
//	-device-drivers / LINTEL_DEVICE_DRIVERS
//	                                    comma-separated device drivers to construct.
//	                                    Exact names only, "http" and "camera"; anything
//	                                    else is refused by name (see resolveDeviceDrivers).
//	                                    Empty (the default) = no device engine at all.
//	-device-config / LINTEL_DEVICE_CONFIG
//	                                    path to the JSON file holding those drivers'
//	                                    configuration (see deviceFile). Required as soon
//	                                    as -device-drivers names anything.
//	-energy-account / LINTEL_ENERGY_ACCOUNT_ID
//	                                    account the energy poller writes meter readings
//	                                    under. Empty (the default) = no polling. Needs a
//	                                    device driver: it reads meters through the registry.
//	-automations / LINTEL_AUTOMATIONS   run the automation rule scheduler; default false.
//	                                    Needs a device driver, for the same reason.
//
// Interval/tuning knobs are env-only, like the chat-channel credentials
// (defaults are the engines' own documented ones, which are the right answer
// for nearly every hub):
//
//	LINTEL_DEVICE_REFRESH_INTERVAL       how often every driver is re-discovered (default 5m)
//	LINTEL_ENERGY_INTERVAL               meter polling interval (default 60s)
//	LINTEL_ENERGY_TZ                     IANA timezone rollup buckets are anchored to
//	                                     (default UTC — a bill is a local-time document)
//	LINTEL_AUTOMATIONS_INTERVAL          rule scheduler tick (default 30s)
//
// There is deliberately NO knob for the automation engine's action-tier
// ceiling. It is a compile-time constant in internal/automations for the same
// reason the verb catalogue is closed: an automation fires with nobody
// watching, and a config file must not be able to talk it into opening a gate.
//
// This binary serves plain HTTP — there is no built-in TLS/ACME (if you were
// looking for that, see README.md: TLS is the operator's responsibility, via
// a reverse proxy that terminates it and forwards to this process on
// loopback). Because of that, -listen REFUSES to start on anything but a
// loopback address (127.0.0.1/::1/localhost) unless -behind-proxy is passed:
// binding a public interface in plain HTTP would otherwise silently serve
// the admin portal, login, and signing API in cleartext. -behind-proxy is
// the operator's explicit statement "yes, TLS is terminated upstream of
// this" — it does not, and cannot, turn this binary into a TLS server
// itself. See checkListenAddr below for exactly what is and is not
// considered loopback.
//
// Chat-channel credentials (WHATSAPP_*/SLACK_*/TELEGRAM_*, no LINTEL_ prefix —
// see channels.FromEnv) are read directly from the environment, as is the
// WhatsApp engine selection:
//
//	LINTEL_WHATSAPP_ENGINE               "cloud" (default; also anything unset/
//	                                      misspelled) or the opt-in "bridge" —
//	                                      see channels.ResolveWhatsAppEngine.
//	                                      Selecting "bridge" logs a startup
//	                                      warning naming its account-ban risk.
//	LINTEL_WHATSAPP_BRIDGE_URL           opt-in self-hosted bridge (target:
//	LINTEL_WHATSAPP_BRIDGE_API_KEY       Evolution API) base URL / api key /
//	LINTEL_WHATSAPP_BRIDGE_INSTANCE      instance name — only consulted when
//	                                      LINTEL_WHATSAPP_ENGINE=bridge.
package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/vul-os/aql/gateway/internal/automations"
	"github.com/vul-os/aql/gateway/internal/channels"
	"github.com/vul-os/aql/gateway/internal/devices"
	"github.com/vul-os/aql/gateway/internal/devices/camera"
	"github.com/vul-os/aql/gateway/internal/devices/httpdev"
	"github.com/vul-os/aql/gateway/internal/energy"
	"github.com/vul-os/aql/gateway/internal/httpapi"
	"github.com/vul-os/aql/gateway/internal/keys"
	"github.com/vul-os/aql/gateway/internal/store"
)

// Version is stamped via -ldflags "-X main.Version=..." at release time.
var Version = "0.1.0-dev"

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// envBoolOr parses key as a bool (strconv.ParseBool: "1"/"t"/"true"/"TRUE"/
// "True" and their "0"/"f"/"false" counterparts), falling back to def when
// the variable is unset or does not parse.
func envBoolOr(key string, def bool) bool {
	if v := os.Getenv(key); v != "" {
		if b, err := strconv.ParseBool(v); err == nil {
			return b
		}
	}
	return def
}

// envDurationOr parses key as a Go duration ("60s", "5m", "1h30m"), falling
// back to def when it is unset, unparseable or non-positive. Same discipline
// as envBoolOr: a typo takes the documented default rather than something
// surprising, and never zero — a zero interval would busy-loop a poller.
func envDurationOr(key string, def time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil && d > 0 {
			return d
		}
	}
	return def
}

// config is everything main() resolves from flags and the environment. The
// zero value of every optional-subsystem field is OFF — see the top-of-file
// doc comment.
type config struct {
	dataDir     string
	listen      string
	publicURL   string
	claimToken  string
	behindProxy bool

	// Device engine (internal/devices + its drivers).
	deviceDrivers string
	deviceConfig  string
	deviceRefresh time.Duration

	// Energy metering (internal/energy).
	energyAccount  string
	energyInterval time.Duration
	energyTZ       string

	// Automations (internal/automations).
	automations         bool
	automationsInterval time.Duration
}

func main() {
	// `gateway verify-audit [-data DIR]` — a CLI subcommand form of
	// GET /v1/admin/audit/verify (see httpapi/adminops.go +
	// store/audithash.go) that works against a cold backup WITHOUT booting
	// the server or its HTTP surface at all: walks both tamper-evident
	// hash chains (access_logs, admin_audit_log) and reports the first
	// broken link, if any, with a non-zero exit code on failure.
	if len(os.Args) > 1 && os.Args[1] == "verify-audit" {
		os.Exit(runVerifyAudit(os.Args[2:]))
	}

	var (
		dataDir     = flag.String("data", envOr("LINTEL_DATA_DIR", "./data"), "data directory")
		listen      = flag.String("listen", envOr("LINTEL_LISTEN", ":8080"), "listen address")
		publicURL   = flag.String("public-url", envOr("LINTEL_PUBLIC_URL", ""), "external base URL")
		claimToken  = flag.String("admin-claim-token", envOr("ADMIN_CLAIM_TOKEN", ""), "one-shot admin claim token (empty disables claiming)")
		behindProxy = flag.Bool("behind-proxy", envBoolOr("LINTEL_BEHIND_PROXY", false), "permit binding a non-loopback -listen address (this binary serves plain HTTP; only set this when TLS is terminated upstream by a reverse proxy)")

		deviceDrivers = flag.String("device-drivers", envOr("LINTEL_DEVICE_DRIVERS", ""), "comma-separated device drivers to construct ("+strings.Join(knownDeviceDrivers(), ", ")+"); empty disables the device engine")
		deviceConfig  = flag.String("device-config", envOr("LINTEL_DEVICE_CONFIG", ""), "path to the JSON device-driver configuration file (required when -device-drivers names anything)")
		energyAccount = flag.String("energy-account", envOr("LINTEL_ENERGY_ACCOUNT_ID", ""), "account id the energy poller writes meter readings under; empty disables polling")
		runAutomation = flag.Bool("automations", envBoolOr("LINTEL_AUTOMATIONS", false), "run the automation rule scheduler")
	)
	flag.Parse()

	log := slog.New(slog.NewTextHandler(os.Stderr, nil))

	cfg := config{
		dataDir:     *dataDir,
		listen:      *listen,
		publicURL:   *publicURL,
		claimToken:  *claimToken,
		behindProxy: *behindProxy,

		deviceDrivers: *deviceDrivers,
		deviceConfig:  *deviceConfig,
		deviceRefresh: envDurationOr("LINTEL_DEVICE_REFRESH_INTERVAL", defaultDeviceRefresh),

		energyAccount:  *energyAccount,
		energyInterval: envDurationOr("LINTEL_ENERGY_INTERVAL", energy.DefaultInterval),
		energyTZ:       envOr("LINTEL_ENERGY_TZ", ""),

		automations:         *runAutomation,
		automationsInterval: envDurationOr("LINTEL_AUTOMATIONS_INTERVAL", automations.DefaultInterval),
	}

	if err := run(cfg, log); err != nil {
		log.Error("fatal", "err", err)
		os.Exit(1)
	}
}

// runVerifyAudit implements `gateway verify-audit`. It opens the SQLite
// database exactly the way the server does (store.Open), which means it
// applies any pending migration + hash-chain backfill to the file it is
// pointed at — a real, if small, mutation. For forensic use against a
// backup, run this against a COPY, never the original evidence file.
// (Operator-facing docs for this subcommand are not part of this change —
// see gateway/README.md, owned separately.)
func runVerifyAudit(args []string) int {
	fs := flag.NewFlagSet("verify-audit", flag.ExitOnError)
	dataDir := fs.String("data", envOr("LINTEL_DATA_DIR", "./data"), "data directory")
	fs.Parse(args)

	st, err := store.Open(*dataDir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "open store: %v\n", err)
		return 1
	}
	defer st.Close()

	results, err := st.VerifyHashChains(context.Background())
	if err != nil {
		fmt.Fprintf(os.Stderr, "verify: %v\n", err)
		return 1
	}
	ok := true
	for _, res := range results {
		if res.OK {
			fmt.Printf("%-16s OK   (%d rows)\n", res.Table, res.RowsChecked)
			continue
		}
		ok = false
		fmt.Printf("%-16s TAMPERED at index %d (row id %s): %s\n",
			res.Table, res.Break.Index, res.Break.RowID, res.Break.Reason)
	}
	if !ok {
		return 1
	}
	return 0
}

// checkListenAddr enforces the "no accidental public cleartext bind" rule
// described in this file's top-of-file doc comment. It resolves addr the
// same way net/http's Server would (host/port split, then IP-vs-hostname),
// and refuses anything that is not loopback-only unless behindProxy is set.
//
// This is deliberately about the RESOLVED address, not the literal flag
// text: "0.0.0.0:8080", "[::]:8080", ":8080" (empty host — Go's own
// "listen on all interfaces" shorthand) and a hostname whose DNS resolves
// off-box must all be caught, not just literal non-loopback IPs.
func checkListenAddr(addr string, behindProxy bool) error {
	if behindProxy {
		return nil
	}
	loopback, err := resolveListenLoopback(addr, net.LookupIP)
	if err != nil {
		return fmt.Errorf("-listen %q: %w", addr, err)
	}
	if loopback {
		return nil
	}
	return fmt.Errorf(
		"refusing to start: -listen %q is not a loopback address. "+
			"This binary serves plain HTTP with no built-in TLS — binding a "+
			"non-loopback address here would serve the admin portal, login, "+
			"and signing API in cleartext. Put a reverse proxy (that "+
			"terminates TLS) in front of this process and bind it to "+
			"loopback (e.g. -listen 127.0.0.1:8080), or, if you have already "+
			"done that and this process just needs to accept the proxy's "+
			"forwarded connections, pass -behind-proxy (or set "+
			"LINTEL_BEHIND_PROXY=1) to declare that intent explicitly. See "+
			"README.md's deployment/TLS section for the reverse-proxy setup.",
		addr)
}

// resolveListenLoopback reports whether every address addr's host part
// could resolve to is a loopback address. lookupIP resolves hostnames (it is
// injected so tests can cover hostname resolution deterministically, without
// depending on real DNS or /etc/hosts); production always passes
// net.LookupIP.
//
// Recognized forms:
//   - ""            (empty host, e.g. ":8080")            -> false (wildcard bind)
//   - "0.0.0.0"                                            -> false
//   - "::" / "[::]"                                        -> false (unspecified)
//   - "127.0.0.1", "127.x.x.x"                              -> true
//   - "::1", "[::1]"                                        -> true
//   - "localhost"                                           -> true (resolves loopback-only)
//   - any other hostname                                    -> true only if EVERY
//     address it resolves to is loopback; false (or an error) otherwise.
func resolveListenLoopback(addr string, lookupIP func(host string) ([]net.IP, error)) (bool, error) {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return false, fmt.Errorf("invalid listen address: %w", err)
	}
	if host == "" {
		// ":8080" — net/http binds this to all available unicast addresses,
		// i.e. the wildcard bind, exactly like "0.0.0.0"/"::". Not loopback.
		return false, nil
	}
	if ip := net.ParseIP(host); ip != nil {
		return ip.IsLoopback(), nil
	}
	// Not an IP literal: a hostname. Resolve it and require every address it
	// could resolve to be loopback — a hostname that resolves to a mix of
	// loopback and non-loopback addresses is, in practice, not a safe
	// loopback bind (whichever address the OS picks first at bind time may
	// not be the loopback one).
	ips, err := lookupIP(host)
	if err != nil {
		return false, fmt.Errorf("resolve listen host %q: %w", host, err)
	}
	if len(ips) == 0 {
		return false, fmt.Errorf("listen host %q resolved to no addresses", host)
	}
	for _, ip := range ips {
		if !ip.IsLoopback() {
			return false, nil
		}
	}
	return true, nil
}

// Shutdown budgets. Both are ceilings, not waits: whichever comes first, the
// process gets to exit. A hub that will not die is worse than one that drops
// a poll cycle.
const (
	// drainGrace is how long in-flight HTTP requests get to finish after the
	// listener stops accepting. An open in flight is the request that matters.
	drainGrace = 10 * time.Second
	// workerGrace is how long the background loops get to notice the cancelled
	// context. They check it every iteration, so this is generous.
	workerGrace = 5 * time.Second
)

func run(cfg config, log *slog.Logger) error {
	if err := checkListenAddr(cfg.listen, cfg.behindProxy); err != nil {
		return err
	}

	h, err := buildHub(cfg, log)
	if err != nil {
		return err
	}
	defer h.close()

	// SIGINT/SIGTERM stop the listener rather than the process, so an open
	// already in flight completes and the background loops unwind on their own
	// context instead of being cut mid-write.
	sigCtx, stopSignals := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stopSignals()

	workerCtx, cancelWorkers := context.WithCancel(context.Background())
	defer cancelWorkers()
	h.start(workerCtx)

	log.Info("lintel gateway", "version", Version, "listen", cfg.listen,
		"data", cfg.dataDir, "gateway_key", h.keys.PublicKeyB64(),
		"workers", h.workerNames())

	httpSrv := &http.Server{
		Addr:              cfg.listen,
		Handler:           h.srv.Router(),
		ReadHeaderTimeout: 10 * time.Second,
	}
	serveErr := make(chan error, 1)
	go func() { serveErr <- httpSrv.ListenAndServe() }()

	// SHUTDOWN ORDER, and it is this way round on purpose:
	//   1. the listener stops and in-flight requests drain — the access path
	//      is the last thing to go, never the first;
	//   2. the background workers' context is cancelled;
	//   3. we wait for them, bounded;
	//   4. h.close() (deferred) closes the drivers, then the database.
	select {
	case err = <-serveErr:
		// ListenAndServe failed (a bound port, a closed socket). Nothing to
		// drain — go straight to stopping the workers and report the error.
	case <-sigCtx.Done():
		log.Info("shutting down")
		drainCtx, cancelDrain := context.WithTimeout(context.Background(), drainGrace)
		if serr := httpSrv.Shutdown(drainCtx); serr != nil {
			log.Warn("http shutdown did not drain cleanly", "err", serr)
		}
		cancelDrain()
		// Shutdown makes ListenAndServe return http.ErrServerClosed, which is
		// the expected end of a clean stop and not an error to report.
		if serr := <-serveErr; serr != nil && !errors.Is(serr, http.ErrServerClosed) {
			err = serr
		}
	}

	cancelWorkers()
	if !h.wait(workerGrace) {
		log.Warn("background workers did not stop within the shutdown grace; exiting anyway",
			"grace", workerGrace, "workers", h.workerNames())
	}
	return err
}

// ---------------------------------------------------------------------------
// hub assembly
// ---------------------------------------------------------------------------

// hub is one assembled process: the HTTP server, plus whichever background
// workers the configuration turned on.
//
// Assembly is separate from serving so that "what did this configuration
// actually start?" is answerable without binding a port — which is how the
// everything-off default is held to account in the tests.
type hub struct {
	log   *slog.Logger
	store *store.Store
	keys  *keys.Keys
	srv   *httpapi.Server
	// reg is the device engine. nil unless -device-drivers named a driver
	// this binary could build: no device config, no registry, no behaviour.
	reg *devices.Registry
	// workers are the process-lifetime background loops. Empty by default.
	workers []worker

	wg sync.WaitGroup
}

// worker is one background loop. It runs until its context is cancelled and
// must not return early on a recoverable error — degrading is the loops' own
// job, not this file's.
type worker struct {
	name string
	run  func(ctx context.Context)
}

// buildHub opens the store and keys, builds the HTTP server, and then wires
// whatever optional subsystems the config asks for.
//
// It returns an error ONLY for the things that already fatal a boot today —
// the data directory, the database, the signing keys, the JWT secret. Every
// optional subsystem degrades instead: it logs why it is off and the hub comes
// up without it. That asymmetry is the safety property. This process opens
// gates; a typo in a camera's URL must not be able to stop it doing that.
func buildHub(cfg config, log *slog.Logger) (*hub, error) {
	if log == nil {
		log = slog.Default()
	}
	if err := os.MkdirAll(cfg.dataDir, 0o700); err != nil {
		return nil, fmt.Errorf("data dir: %w", err)
	}

	st, err := store.Open(cfg.dataDir)
	if err != nil {
		return nil, fmt.Errorf("store: %w", err)
	}

	ks, err := keys.Load(cfg.dataDir)
	if err != nil {
		st.Close()
		return nil, fmt.Errorf("keys: %w", err)
	}

	secret, err := loadOrCreateSecret(filepath.Join(cfg.dataDir, "jwt_secret"))
	if err != nil {
		st.Close()
		return nil, fmt.Errorf("jwt secret: %w", err)
	}

	srv := httpapi.New(httpapi.Config{
		Version:         Version,
		Env:             envOr("LINTEL_ENV", "self-hosted"),
		PublicURL:       cfg.publicURL,
		AdminClaimToken: cfg.claimToken,
		JWTSecret:       secret,
		// Rate-limit env layer (db overrides via PATCH /v1/admin/limits sit on
		// top; see store.ResolveRateLimitConfig).
		RateLimits: store.ParseRateLimitConfig(os.Getenv),
		// Credential-endpoint brute-force throttles (login/register/refresh/
		// admin-claim) — env-only, deliberately NOT admin-overridable at
		// runtime; see store.AuthRateLimitConfig's doc comment.
		AuthRateLimits: store.ParseAuthRateLimitConfig(os.Getenv),
		// Chat channels (WhatsApp/Slack/Telegram): env-named per the backend.
		Channels: channels.FromEnv(os.Getenv, cfg.publicURL),
	}, st, ks, log)

	h := &hub{log: log, store: st, keys: ks, srv: srv}
	h.wireDevices(cfg)
	h.wireEnergy(cfg)
	h.wireAutomations(cfg)
	return h, nil
}

// start launches the channel workers (unchanged) and every wired background
// loop, all bound to ctx. It returns immediately.
//
// Each loop is wrapped in a panic barrier. A driver panicking on a malformed
// device reply must cost that loop and nothing else: the process keeps
// serving, and the operator gets a log line naming the loop that died.
func (h *hub) start(ctx context.Context) {
	// Always-on channel workers (Slack Socket Mode, when SLACK_APP_TOKEN set)
	// live for the process lifetime.
	h.srv.StartChannels(ctx)

	for _, w := range h.workers {
		h.wg.Add(1)
		go func(w worker) {
			defer h.wg.Done()
			defer func() {
				if r := recover(); r != nil {
					h.log.Error("background worker panicked and is stopped for the life of this process; "+
						"the hub keeps serving without it", "worker", w.name, "panic", r)
				}
			}()
			w.run(ctx)
		}(w)
	}
}

// wait blocks until every worker has returned or until timeout elapses,
// reporting whether they all stopped. It never blocks past the timeout: a
// wedged driver must not be able to hold the process open.
func (h *hub) wait(timeout time.Duration) bool {
	done := make(chan struct{})
	go func() {
		h.wg.Wait()
		close(done)
	}()
	select {
	case <-done:
		return true
	case <-time.After(timeout):
		return false
	}
}

// workerNames lists the started loops, for the boot and shutdown log lines.
func (h *hub) workerNames() []string {
	out := make([]string, 0, len(h.workers))
	for _, w := range h.workers {
		out = append(out, w.name)
	}
	return out
}

// close releases what buildHub acquired, drivers before the database: a driver
// closing may still want to log, and none of them writes to the store.
func (h *hub) close() {
	if h.reg != nil {
		if err := h.reg.Close(); err != nil {
			h.log.Warn("device driver close", "err", err)
		}
	}
	if err := h.store.Close(); err != nil {
		h.log.Warn("store close", "err", err)
	}
}

// ---------------------------------------------------------------------------
// device engine
// ---------------------------------------------------------------------------

// Device drivers this binary knows how to construct. These exact strings, and
// no others, are what -device-drivers accepts.
const (
	deviceDriverHTTP   = "http"
	deviceDriverCamera = "camera"
)

// defaultDeviceRefresh is how often every driver is re-discovered. Five
// minutes: discovery is how a camera that came back on the network reappears
// and how a device that went away stops being asserted as live, and neither
// is urgent enough to be worth probing a segment over every few seconds.
const defaultDeviceRefresh = 5 * time.Minute

func knownDeviceDrivers() []string {
	return []string{deviceDriverCamera, deviceDriverHTTP}
}

// resolveDeviceDrivers turns the raw -device-drivers value into the set of
// drivers to construct, with the same discipline as
// channels.ResolveWhatsAppEngine: fail closed toward the safe default and
// switch only on an exact opt-in string.
//
// The safe default here is NO driver. Unset, empty, or all-whitespace turns
// nothing on. A name this binary has no driver for is returned separately
// rather than ignored, because a hub that silently drops half an operator's
// device config is a hub whose config nobody can trust; the caller says it out
// loud and starts the rest.
//
// Names are trimmed and lower-cased before matching, and duplicates collapse:
// "http, HTTP" is one driver, not a duplicate-registration error.
func resolveDeviceDrivers(raw string) (enabled, unknown []string) {
	seen := map[string]bool{}
	for _, field := range strings.Split(raw, ",") {
		name := strings.ToLower(strings.TrimSpace(field))
		if name == "" {
			continue
		}
		switch name {
		case deviceDriverHTTP, deviceDriverCamera:
			if !seen[name] {
				seen[name] = true
				enabled = append(enabled, name)
			}
		default:
			unknown = append(unknown, name)
		}
	}
	sort.Strings(enabled)
	return enabled, unknown
}

// deviceFile is the on-disk shape of -device-config: one object per driver,
// keyed by the same name -device-drivers selects it with.
//
// The driver packages deliberately never touch the filesystem — "this package
// never touches the filesystem; the hub's config wiring owns file formats"
// (httpdev/config.go, camera/config.go). This is that format, and it is
// nothing more than the plain JSON encoding of each driver's own Config
// struct, so the field documentation in those packages IS the documentation
// for this file. Unknown keys are refused, so a misspelt field is a startup
// error naming it rather than a setting that silently did nothing.
//
// One wart worth stating plainly: the duration fields (Timeout, StreamTTL,
// Discovery.Timeout/Interval) are time.Duration, which encoding/json renders
// as an integer count of NANOSECONDS. Omit them and each package applies its
// own documented default, which is the right answer for nearly every hub.
type deviceFile struct {
	HTTP   *httpdev.Config `json:"http"`
	Camera *camera.Config  `json:"camera"`
}

func loadDeviceFile(path string) (deviceFile, error) {
	var out deviceFile
	f, err := os.Open(path)
	if err != nil {
		return out, err
	}
	defer f.Close()
	dec := json.NewDecoder(f)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&out); err != nil {
		return out, fmt.Errorf("parse %s: %w", path, err)
	}
	return out, nil
}

// buildDeviceDriver constructs one named driver from the config file. The
// driver packages validate everything themselves, at construction, which is
// why this is as thin as it is.
func buildDeviceDriver(name string, file deviceFile) (devices.Driver, error) {
	switch name {
	case deviceDriverHTTP:
		if file.HTTP == nil {
			return nil, errors.New(`the device config has no "http" object`)
		}
		d, err := httpdev.New(*file.HTTP)
		if err != nil {
			return nil, err
		}
		return d, nil
	case deviceDriverCamera:
		if file.Camera == nil {
			return nil, errors.New(`the device config has no "camera" object`)
		}
		d, err := camera.New(*file.Camera)
		if err != nil {
			return nil, err
		}
		return d, nil
	}
	return nil, fmt.Errorf("no driver named %q", name)
}

// wireDevices builds the registry and registers the configured drivers. It is
// a no-op — no registry, no goroutine, no network — unless -device-drivers
// names something, which is the shipped default.
//
// Nothing here can fail the boot. A driver that will not build is logged and
// skipped, and the drivers that did build still run.
func (h *hub) wireDevices(cfg config) {
	enabled, unknown := resolveDeviceDrivers(cfg.deviceDrivers)
	for _, name := range unknown {
		h.log.Error("unknown device driver requested; ignored",
			"driver", name, "known", knownDeviceDrivers())
	}
	if len(enabled) == 0 {
		return
	}
	if cfg.deviceConfig == "" {
		h.log.Error("device drivers were selected but -device-config is empty; "+
			"the device engine stays off", "drivers", enabled)
		return
	}
	file, err := loadDeviceFile(cfg.deviceConfig)
	if err != nil {
		h.log.Error("device config could not be read; the device engine stays off",
			"path", cfg.deviceConfig, "err", err)
		return
	}

	reg := devices.NewRegistry()
	var registered []string
	for _, name := range enabled {
		drv, err := buildDeviceDriver(name, file)
		if err != nil {
			h.log.Error("device driver not started", "driver", name, "err", err)
			continue
		}
		if err := reg.Register(drv); err != nil {
			h.log.Error("device driver not registered", "driver", name, "err", err)
			if c, ok := drv.(devices.Closer); ok {
				_ = c.Close()
			}
			continue
		}
		registered = append(registered, name)
	}
	if len(registered) == 0 {
		_ = reg.Close()
		return
	}
	h.reg = reg
	h.log.Info("device engine enabled", "drivers", registered, "refresh", cfg.deviceRefresh)
	h.workers = append(h.workers, worker{
		name: "device-discovery",
		run:  func(ctx context.Context) { h.runDiscovery(ctx, cfg.deviceRefresh) },
	})
}

// runDiscovery refreshes the registry immediately and then on the interval.
//
// A refresh error is logged and the loop continues. Registry.Refresh already
// keeps a failing driver's previously-indexed devices — marked unknown rather
// than deleted — so a broker blipping costs an operator a stale-state warning,
// not a fleet that vanishes from the console.
func (h *hub) runDiscovery(ctx context.Context, every time.Duration) {
	if every <= 0 {
		every = defaultDeviceRefresh
	}
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		if err := h.reg.Refresh(ctx); err != nil && ctx.Err() == nil {
			h.log.Warn("device discovery", "err", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

// ---------------------------------------------------------------------------
// energy metering
// ---------------------------------------------------------------------------

// wireEnergy starts the meter poller. Off unless -energy-account names an
// account that exists on this hub.
//
// The account is checked HERE rather than discovered at the first write,
// because every metering table is foreign-keyed to accounts(id): a wrong id
// would not fail loudly, it would fail once a minute forever while looking
// like a device problem.
func (h *hub) wireEnergy(cfg config) {
	if cfg.energyAccount == "" {
		return
	}
	if h.reg == nil {
		h.log.Error("-energy-account is set but no device driver is running, " +
			"so there are no meters to read; the energy poller stays off")
		return
	}
	if _, err := h.store.AdminAccountByID(context.Background(), cfg.energyAccount); err != nil {
		h.log.Error("-energy-account names no account on this hub; the energy poller stays off",
			"account", cfg.energyAccount, "err", err)
		return
	}

	loc := time.UTC
	if cfg.energyTZ != "" {
		l, err := time.LoadLocation(cfg.energyTZ)
		if err != nil {
			h.log.Error("LINTEL_ENERGY_TZ is not a timezone this system knows; "+
				"rollup buckets stay anchored to UTC", "tz", cfg.energyTZ, "err", err)
		} else {
			loc = l
		}
	}

	// The metering engine owns migration 0011's tables and takes a bare
	// database handle so it cannot reach the audit tables — see store.DB.
	est := energy.NewStore(h.store.DB(), energy.WithLocation(loc))
	poller := energy.NewPoller(h.reg, est, cfg.energyAccount, energy.WithInterval(cfg.energyInterval))

	h.log.Info("energy poller enabled", "account", cfg.energyAccount,
		"interval", poller.Interval(), "tz", est.TZ())
	h.workers = append(h.workers, worker{
		name: "energy-poller",
		run: func(ctx context.Context) {
			_ = poller.Run(ctx, func(res energy.PollResult, err error) {
				if err != nil {
					h.log.Error("energy poll cycle", "err", err)
					return
				}
				// Only worth a line when something was lost. A meter that did
				// not answer is a gap in the record, and a gap nobody is told
				// about is the failure mode this engine exists to avoid.
				if res.Failed > 0 || res.Foreign > 0 {
					h.log.Warn("energy poll cycle incomplete", "meters", res.Meters,
						"read", res.Read, "failed", res.Failed, "foreign", res.Foreign)
				}
			})
		},
	})
}

// ---------------------------------------------------------------------------
// automations
// ---------------------------------------------------------------------------

// wireAutomations starts the rule scheduler. Off unless -automations is set.
//
// Note what is NOT configurable from here: the engine's action-tier ceiling.
// It is a constant in internal/automations, checked on both the save path and
// the execution path, and no flag, env var or config file in this binary can
// raise it. A rule fires with nobody watching; the set of things it may do is
// not an operator preference.
func (h *hub) wireAutomations(cfg config) {
	if !cfg.automations {
		return
	}
	if h.reg == nil {
		h.log.Error("-automations is set but no device driver is running, " +
			"so no rule could resolve a device; the rule scheduler stays off")
		return
	}
	// Same bare-handle rule as the metering engine, and here it is load
	// bearing: the engine writes its trail ONLY through the store's
	// hash-chained WriteAdminAudit, and it is built so it cannot reach the
	// audit tables any other way.
	eng, err := automations.NewEngine(automations.Config{
		Registry: h.reg,
		Store:    automations.NewStore(h.store.DB()),
		Audit:    h.store,
	})
	if err != nil {
		h.log.Error("rule engine not started; the rule scheduler stays off", "err", err)
		return
	}
	runner, err := automations.NewRunner(automations.RunnerConfig{
		Engine:   eng,
		Interval: cfg.automationsInterval,
		Log:      h.log,
	})
	if err != nil {
		h.log.Error("rule scheduler not started", "err", err)
		return
	}
	h.log.Info("rule scheduler enabled", "interval", cfg.automationsInterval,
		"max_action_tier", automations.MaxActionTier)
	h.workers = append(h.workers, worker{
		name: "rule-scheduler",
		run:  func(ctx context.Context) { _ = runner.Run(ctx) },
	})
}

// loadOrCreateSecret persists a random 32-byte JWT signing secret in the data
// dir at first boot (hex, 0600) so sessions survive restarts.
func loadOrCreateSecret(path string) ([]byte, error) {
	if raw, err := os.ReadFile(path); err == nil {
		secret, err := hex.DecodeString(string(raw))
		if err != nil || len(secret) < 32 {
			return nil, fmt.Errorf("corrupt jwt secret file %s", path)
		}
		return secret, nil
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return nil, err
	}
	if err := os.WriteFile(path, []byte(hex.EncodeToString(secret)), 0o600); err != nil {
		return nil, err
	}
	return secret, nil
}
