// Command gateway is the lintel server: one Go binary — channels, rules,
// portal, API, device hub, audit — backed by one SQLite file.
//
// Configuration is flags-over-env:
//
//	-data / AQL_DATA_DIR             data directory (SQLite db, signing keys)   default ./data
//	-listen / AQL_LISTEN             listen address                             default :8080
//	-public-url / AQL_PUBLIC_URL     external base URL (webhooks, links)        default ""
//	-admin-claim-token / ADMIN_CLAIM_TOKEN
//	                                    one-shot instance-admin claim token; empty = claim disabled (fail-closed)
//	-behind-proxy / AQL_BEHIND_PROXY  permit binding a non-loopback -listen address; default false
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
//	-device-drivers / AQL_DEVICE_DRIVERS
//	                                    comma-separated device drivers to construct.
//	                                    Exact names only, "http" and "camera"; anything
//	                                    else is refused by name (see resolveDeviceDrivers).
//	                                    Empty (the default) = no device engine at all.
//	-device-config / AQL_DEVICE_CONFIG
//	                                    path to the JSON file holding those drivers'
//	                                    configuration (see deviceFile). Required as soon
//	                                    as -device-drivers names anything.
//	-energy-account / AQL_ENERGY_ACCOUNT_ID
//	                                    account the energy poller writes meter readings
//	                                    under. Empty (the default) = no polling. Needs a
//	                                    device driver: it reads meters through the registry.
//	-automations / AQL_AUTOMATIONS   run the automation rule scheduler; default false.
//	                                    Needs a device driver, for the same reason.
//
// Interval/tuning knobs are env-only, like the chat-channel credentials
// (defaults are the engines' own documented ones, which are the right answer
// for nearly every hub):
//
//	AQL_DEVICE_REFRESH_INTERVAL       how often every driver is re-discovered (default 5m)
//	AQL_ENERGY_INTERVAL               meter polling interval (default 60s)
//	AQL_CLOCK_SYNC_INTERVAL           controller clock-proof ping interval (default 6h)
//	AQL_ENERGY_SAMPLE_RETENTION       how long raw meter samples are kept
//	                                  (default 720h / 30d; 0 keeps forever)
//	AQL_ENERGY_TZ                     IANA timezone rollup buckets are anchored to
//	                                     (default UTC — a bill is a local-time document)
//	AQL_AUTOMATIONS_INTERVAL          rule scheduler tick (default 30s)
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
// Chat-channel credentials (WHATSAPP_*/SLACK_*/TELEGRAM_*, no AQL_ prefix —
// see channels.FromEnv) are read directly from the environment, as is the
// WhatsApp engine selection:
//
//	AQL_WHATSAPP_ENGINE               "cloud" (default; also anything unset/
//	                                      misspelled) or the opt-in "bridge" —
//	                                      see channels.ResolveWhatsAppEngine.
//	                                      Selecting "bridge" logs a startup
//	                                      warning naming its account-ban risk.
//	AQL_WHATSAPP_BRIDGE_URL           opt-in self-hosted bridge (target:
//	AQL_WHATSAPP_BRIDGE_API_KEY       Evolution API) base URL / api key /
//	AQL_WHATSAPP_BRIDGE_INSTANCE      instance name — only consulted when
//	                                      AQL_WHATSAPP_ENGINE=bridge.
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

	"github.com/vul-os/aql/hub/internal/automations"
	"github.com/vul-os/aql/hub/internal/channels"
	"github.com/vul-os/aql/hub/internal/devices"
	"github.com/vul-os/aql/hub/internal/devices/accessdev"
	"github.com/vul-os/aql/hub/internal/devices/camera"
	"github.com/vul-os/aql/hub/internal/devices/httpdev"
	"github.com/vul-os/aql/hub/internal/devices/modbus"
	"github.com/vul-os/aql/hub/internal/devices/mqtt"
	"github.com/vul-os/aql/hub/internal/energy"
	"github.com/vul-os/aql/hub/internal/httpapi"
	"github.com/vul-os/aql/hub/internal/keys"
	"github.com/vul-os/aql/hub/internal/recording"
	"github.com/vul-os/aql/hub/internal/secretref"
	"github.com/vul-os/aql/hub/internal/store"
)

// Version is stamped via -ldflags "-X main.Version=..." at release time.
var Version = "0.1.0-dev"

func envOr(key, def string) string {
	if v := lookupEnv(key); v != "" {
		return v
	}
	return def
}

// envBoolOr parses key as a bool (strconv.ParseBool: "1"/"t"/"true"/"TRUE"/
// "True" and their "0"/"f"/"false" counterparts), falling back to def when
// the variable is unset or does not parse.
func envBoolOr(key string, def bool) bool {
	if v := lookupEnv(key); v != "" {
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
	if v := lookupEnv(key); v != "" {
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
	// 0 = httpapi's 6-hour default. Not restated here: two places declaring
	// the same default is two places for it to drift.
	clockSyncInterval time.Duration
	// energySampleRetention bounds the samples table. Deltas are never
	// pruned; see energy.WithSampleRetention.
	energySampleRetention time.Duration
	energyTZ              string

	// Automations (internal/automations).
	automations         bool
	automationsInterval time.Duration
}

func main() {
	// `aql-hub verify-audit [-data DIR]` — a CLI subcommand form of
	// GET /v1/admin/audit/verify (see httpapi/adminops.go +
	// store/audithash.go) that works against a cold backup WITHOUT booting
	// the server or its HTTP surface at all: walks both tamper-evident
	// hash chains (access_logs, admin_audit_log) and reports the first
	// broken link, if any, with a non-zero exit code on failure.
	if len(os.Args) > 1 && os.Args[1] == "verify-audit" {
		os.Exit(runVerifyAudit(os.Args[2:]))
	}

	// `aql-hub 2fa disable -user NAME -reason TEXT [-data DIR]` — the
	// last-resort escape hatch for a user who lost both their authenticator
	// and their recovery codes. See store/twofactor_operator.go for what
	// authorises it (possession of the data directory, nothing else) and why
	// the audit entry is written in the same transaction as the disable.
	if len(os.Args) > 2 && os.Args[1] == "2fa" && os.Args[2] == "disable" {
		os.Exit(runTwoFactorDisable(os.Args[3:]))
	}

	// `aql-hub energy rebucket -account ID [-tz ZONE] [-dry-run]` — rebuild
	// energy rollups under the current timezone after AQL_ENERGY_TZ changed.
	//
	// Rollups carry their zone in their identity and reads filter on the
	// current one, so changing it orphans the history: still in the database,
	// keyed to a zone nothing asks about. See rebucket.go for what it can and
	// cannot recover — the honest half is that anything older than the sample
	// retention window is gone in every zone.
	if len(os.Args) > 2 && os.Args[1] == "energy" && os.Args[2] == "rebucket" {
		os.Exit(runEnergyRebucket(os.Args[3:]))
	}

	// Anything else that looks like a subcommand is a mistake, and must not
	// fall through to starting the server.
	//
	// It used to. `aql-hub 2fa disabel -user alice` — one transposed letter —
	// matched no dispatch above, and flag.Parse ignores positional arguments,
	// so the binary BOOTED A HUB: it generated a fresh Ed25519 signing key and
	// a JWT secret, created the database, ran migrations and started the
	// background workers. Against a fresh directory that is merely surprising.
	// Against the directory an operator meant to inspect it is destructive, and
	// that is not a hypothetical: verify-audit is documented as working on a
	// cold backup, so a backup is exactly where these commands get pointed.
	//
	// The default -listen is non-loopback and refuses to start, which hid this
	// — but the deployment the docs recommend binds loopback, and there it
	// starts cleanly.
	//
	// The server itself takes no positional arguments, so a leading non-flag
	// token has no other meaning.
	if msg, unknown := unknownCommand(os.Args[1:]); unknown {
		fmt.Fprint(os.Stderr, msg)
		os.Exit(2)
	}

	var (
		dataDir     = flag.String("data", envOr("AQL_DATA_DIR", "./data"), "data directory")
		listen      = flag.String("listen", envOr("AQL_LISTEN", ":8080"), "listen address")
		publicURL   = flag.String("public-url", envOr("AQL_PUBLIC_URL", ""), "external base URL")
		claimToken  = flag.String("admin-claim-token", envOr("ADMIN_CLAIM_TOKEN", ""), "one-shot admin claim token (empty disables claiming)")
		behindProxy = flag.Bool("behind-proxy", envBoolOr("AQL_BEHIND_PROXY", false), "permit binding a non-loopback -listen address (this binary serves plain HTTP; only set this when TLS is terminated upstream by a reverse proxy)")

		deviceDrivers = flag.String("device-drivers", envOr("AQL_DEVICE_DRIVERS", ""), "comma-separated device drivers to construct ("+strings.Join(knownDeviceDrivers(), ", ")+"); empty disables the device engine")
		deviceConfig  = flag.String("device-config", envOr("AQL_DEVICE_CONFIG", ""), "path to the JSON device-driver configuration file (required for every driver except `access`, which reads the database)")
		energyAccount = flag.String("energy-account", envOr("AQL_ENERGY_ACCOUNT_ID", ""), "account id the energy poller writes meter readings under; empty disables polling")
		runAutomation = flag.Bool("automations", envBoolOr("AQL_AUTOMATIONS", false), "run the automation rule scheduler")
	)
	flag.Parse()

	// unknownCommand above catches a LEADING non-flag token. This catches a
	// trailing one: `aql-hub -listen 127.0.0.1:8080 hub -data /srv/aql`, where a
	// stray word makes -data positional too. Go stops parsing at the first
	// non-flag argument, so everything after it is silently dropped and the hub
	// starts with those defaults instead.
	//
	// A MISTYPED flag is not this case and needs no help — `-devce-drivers`
	// fails in flag.Parse with "flag provided but not defined". Checked, because
	// the first version of this comment claimed otherwise.
	if flag.NArg() > 0 {
		fmt.Fprintf(os.Stderr, "aql-hub: unexpected argument %q\n\n", flag.Arg(0))
		fmt.Fprintln(os.Stderr, "The hub takes flags only. Go stops parsing flags at the first non-flag")
		fmt.Fprintln(os.Stderr, "argument, so every flag after this one would have been ignored and the")
		fmt.Fprintln(os.Stderr, "hub would have started with those defaults instead.")
		fmt.Fprintln(os.Stderr, "\nUsage:")
		flag.PrintDefaults()
		os.Exit(2)
	}

	log := slog.New(slog.NewTextHandler(os.Stderr, nil))

	cfg := config{
		dataDir:     *dataDir,
		listen:      *listen,
		publicURL:   *publicURL,
		claimToken:  *claimToken,
		behindProxy: *behindProxy,

		deviceDrivers: *deviceDrivers,
		deviceConfig:  *deviceConfig,
		deviceRefresh: envDurationOr("AQL_DEVICE_REFRESH_INTERVAL", defaultDeviceRefresh),

		energyAccount:     *energyAccount,
		energyInterval:    envDurationOr("AQL_ENERGY_INTERVAL", energy.DefaultInterval),
		clockSyncInterval: envDurationOr("AQL_CLOCK_SYNC_INTERVAL", 0),
		// A default, not "off". Retention that has to be switched on is
		// retention nobody switches on, and the failure mode is a disk that
		// fills months later on a machine with no operator watching it.
		energySampleRetention: envDurationOr("AQL_ENERGY_SAMPLE_RETENTION", energy.DefaultSampleRetention),
		energyTZ:              envOr("AQL_ENERGY_TZ", ""),

		automations:         *runAutomation,
		automationsInterval: envDurationOr("AQL_AUTOMATIONS_INTERVAL", automations.DefaultInterval),
	}

	if err := run(cfg, log); err != nil {
		log.Error("fatal", "err", err)
		os.Exit(1)
	}
}

// runVerifyAudit implements `aql-hub verify-audit`. It opens the SQLite
// database exactly the way the server does (store.Open), which means it
// applies any pending migration + hash-chain backfill to the file it is
// pointed at — a real, if small, mutation. For forensic use against a
// backup, run this against a COPY, never the original evidence file.
// (Operator-facing docs for this subcommand are not part of this change —
// see gateway/README.md, owned separately.)
func runVerifyAudit(args []string) int {
	fs := flag.NewFlagSet("verify-audit", flag.ExitOnError)
	dataDir := fs.String("data", envOr("AQL_DATA_DIR", "./data"), "data directory")
	fs.Parse(args)

	// One door for every subcommand — see openexisting.go. Inline here first,
	// then two more subcommands turned out to have the same defect, which is
	// what a point fix looks like just before it becomes a shared one.
	st, err := openExistingStore(*dataDir, "verify-audit")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
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

// runTwoFactorDisable turns off one user's active second factor.
//
// It runs against the database directly rather than the HTTP API on purpose:
// the API cannot offer this, because every route that ends a second factor
// requires a claim the locked-out user by definition does not have. The
// authority here is possession of the data directory — which is to say, shell
// access to the host, which already permits strictly more than this does.
//
// -reason is required and recorded verbatim. An entry saying only that 2FA was
// turned off tells a later reader nothing; one saying "phone lost, confirmed
// with Ada by video call" tells them whether to be worried.
func runTwoFactorDisable(args []string) int {
	fs := flag.NewFlagSet("2fa disable", flag.ExitOnError)
	dataDir := fs.String("data", envOr("AQL_DATA_DIR", "./data"), "data directory")
	username := fs.String("user", "", "username of the locked-out account (required)")
	reason := fs.String("reason", "", "why this is being done; recorded in the audit log (required)")
	fs.Parse(args)

	switch {
	case strings.TrimSpace(*username) == "":
		fmt.Fprintln(os.Stderr, "2fa disable: -user is required")
		return 2
	case strings.TrimSpace(*reason) == "":
		// Required rather than defaulted: a blank reason is indistinguishable
		// from an attacker's entry, and the whole value of this subcommand
		// over a hand-written UPDATE is what it leaves behind.
		fmt.Fprintln(os.Stderr, "2fa disable: -reason is required — it is what the audit entry is for")
		return 2
	}

	st, err := openExistingStore(*dataDir, "2fa disable")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer st.Close()

	ctx := context.Background()
	userID, err := st.UserIDByUsernameForOperator(ctx, strings.TrimSpace(*username))
	if errors.Is(err, store.ErrNotFound) {
		fmt.Fprintf(os.Stderr, "no such user: %s\n", *username)
		return 1
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "look up user: %v\n", err)
		return 1
	}

	res, err := st.DisableTOTPByOperator(ctx, userID, strings.TrimSpace(*reason))
	if errors.Is(err, store.ErrNoLiveTOTP) {
		// Not framed as success: the operator was told someone is locked out,
		// and this says the lock is somewhere else.
		fmt.Fprintf(os.Stderr, "%s has no active second factor — nothing was changed, "+
			"and whatever is blocking them is not 2FA\n", *username)
		return 1
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "disable: %v\n", err)
		return 1
	}

	fmt.Printf("2FA disabled for %s (user %s, factor %s)\n", res.Username, res.UserID, res.FactorID)
	if res.RecoveryCodesOutstanding > 0 {
		fmt.Printf("NOTE: %d unused recovery code(s) were still outstanding — that account "+
			"had a way back in without this. Worth asking why it was not used.\n",
			res.RecoveryCodesOutstanding)
	}
	fmt.Println("They can sign in with their password alone now, and should re-enrol.")
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
			"AQL_BEHIND_PROXY=1) to declare that intent explicitly. See "+
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

	log.Info("aql hub", "version", Version, "listen", cfg.listen,
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
	energy      *energy.Store
	automations *automations.Engine
	log         *slog.Logger
	store       *store.Store
	keys        *keys.Keys
	srv         *httpapi.Server
	// reg is the device engine. nil unless -device-drivers named a driver
	// this binary could build: no device config, no registry, no behaviour.
	reg *devices.Registry
	// camDrv is the camera driver, when one registered. Held separately from
	// the registry because recording needs a resolved media address and a
	// credential, and devices.Driver — correctly — has no notion of either.
	camDrv *camera.Driver
	// live fans camera fragments out to viewers. Always constructed; it costs
	// nothing until somebody watches.
	live *recording.Broadcaster
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

	// Refuse to mint a NEW signing identity for a hub that has paired
	// controllers. keys.Load generates one when the seed file is absent, which
	// is right on a first boot and unrecoverable afterwards: each paired
	// controller pins the old public key, so a fresh identity makes every
	// command it is sent fail `badsig`, and the `repair` that would move it has
	// to be signed by the key that is gone. The only way back is physically
	// re-pairing every controller.
	//
	// Checked HERE because it is the only place that can be: keys.Load sees a
	// directory, and by the time it runs store.Open has already created the
	// database, so "is this a first boot" is not a question the filesystem can
	// answer. The store can.
	paired, err := st.AnyDevicePaired(context.Background())
	if err != nil {
		st.Close()
		return nil, fmt.Errorf("check paired devices: %w", err)
	}
	if paired {
		if err := keys.RequireExisting(cfg.dataDir); err != nil {
			st.Close()
			return nil, fmt.Errorf("keys: %w", err)
		}
	}

	ks, err := keys.Load(cfg.dataDir)
	if err != nil {
		st.Close()
		return nil, fmt.Errorf("keys: %w", err)
	}

	// The mirror image of the check above, and the same failure one step in.
	//
	// A rotation in the database with NO retained key on disk means every
	// controller that has not repaired yet is unreachable: signForDevice sees
	// HasPrevious() false, leaves the pin empty, and signs with the CURRENT
	// key — which those controllers reject as badsig, and the repair that would
	// move them cannot be signed either.
	//
	// This does NOT refuse to start, unlike the missing-key case. Controllers
	// that already repaired are fine, and stopping the hub would take their
	// gates down to punish them for the others. So it is an alarm, and the
	// rotation status endpoint reports `retained_key_present: false` so the
	// console can show it rather than an operator finding out at a gate.
	if _, err := st.OpenKeyRotation(context.Background()); err == nil && !ks.HasPrevious() {
		log.Error("KEY ROTATION IS RECORDED BUT THE RETAINED KEY IS GONE: every controller " +
			"that has not repaired yet will reject this hub's commands, and cannot be " +
			"repaired without that key. Restore it from a backup, or re-pair those " +
			"controllers physically")
	}

	secret, err := loadOrCreateSecret(filepath.Join(cfg.dataDir, "jwt_secret"))
	if err != nil {
		st.Close()
		return nil, fmt.Errorf("jwt secret: %w", err)
	}

	// The device engine is built BEFORE the server, because the server exposes
	// it: constructing the server first and back-filling the registry would
	// leave a window where /v1/engine/* reports an empty fleet on a hub that
	// actually has one.
	h := &hub{log: log, store: st, keys: ks}
	h.wireDevices(cfg)
	h.energy = h.newEnergyStore(cfg)
	h.automations = h.newAutomationsEngine()

	// One broadcaster, shared: the recorder fills it and the server drains it.
	// Two would mean live viewers watching a stream nothing publishes to.
	h.live = recording.NewBroadcaster()

	srv := httpapi.New(httpapi.Config{
		// Same path the recorder writes to, so playback and retention cannot
		// disagree about where footage lives.
		RecordingsRoot: filepath.Join(cfg.dataDir, "recordings"),
		Live:           h.live,
		Devices:        h.reg,
		Energy:         h.energy,
		Automations:    h.automations,
		// True only when the scheduler will actually be started below.
		AutomationsScheduler: cfg.automations && h.automations != nil,
		ClockSyncInterval:    cfg.clockSyncInterval,
		Version:              Version,
		Env:                  envOr("AQL_ENV", "self-hosted"),
		PublicURL:            cfg.publicURL,
		AdminClaimToken:      cfg.claimToken,
		JWTSecret:            secret,
		// Rate-limit env layer (db overrides via PATCH /v1/admin/limits sit on
		// top; see store.ResolveRateLimitConfig).
		RateLimits: store.ParseRateLimitConfig(lookupEnv),
		// Credential-endpoint brute-force throttles (login/register/refresh/
		// admin-claim) — env-only, deliberately NOT admin-overridable at
		// runtime; see store.AuthRateLimitConfig's doc comment.
		AuthRateLimits: store.ParseAuthRateLimitConfig(lookupEnv),
		// Chat channels (WhatsApp/Slack/Telegram): env-named per the backend.
		Channels: channels.FromEnv(lookupEnv, cfg.publicURL),
	}, st, ks, log)

	h.srv = srv
	h.wireEnergy(cfg)
	h.wireAutomations(cfg)
	// Every legacy variable that was actually read, in one line.
	//
	// Placed at the END of setup rather than beside the flag parsing, because
	// not all of them are read there: AQL_ENV and the chat rails' variables are
	// resolved while the HTTP server is being constructed, and warning earlier
	// silently under-reported exactly the ones an operator is most likely to
	// have set. One line, once, after everything has been read.
	warnLegacyEnv(h.log)

	// Always on. A controller learns the hub's time at the WS handshake and
	// on an accepted ping, and a healthy connection never re-handshakes — so
	// without this a controller connected for 14 days straight starts refusing
	// every offline grant with stale_clock, at the gate, during exactly the
	// outage those grants exist for. See httpapi/clocksync.go.
	h.workers = append(h.workers, worker{
		name: "controller-clock-sync",
		run:  h.srv.RunClockSync,
	})

	// Also always on, and idle unless a key rotation is in flight. It has to
	// survive a restart: a hub that rebooted mid-rotation would otherwise leave
	// every unrepaired controller pinning a superseded key with nothing trying
	// to move it, and the retained private key on disk indefinitely.
	h.workers = append(h.workers, worker{
		name: "gateway-key-rotation",
		run:  h.srv.RunKeyRotationSweep,
	})

	// Camera-clip retention. Constructed unconditionally and cheap when idle: it
	// derives its work from the clip index, so a hub that has never recorded
	// sweeps an empty set once an hour.
	//
	// Wired here rather than left for whatever eventually starts capturing,
	// because a retention sweep with no caller is the failure mode the reclaim
	// guard names — correct code, and storage that grows without limit until
	// somebody goes looking. A camera dropped from the config still has footage
	// on the disk, and this is what bounds it.
	if rec, err := recording.New(h.store, recording.Config{
		Root: filepath.Join(cfg.dataDir, "recordings"),
		Log:  h.log,
		Live: h.live,
	}); err != nil {
		h.log.Error("recording: retention worker not started", "err", err)
	} else {
		// The loop is written here rather than inside the package so the
		// wiring is visible where someone reads to find out what runs on its
		// own. It sweeps once at startup — a hub that was off for a week comes
		// back with a week of expired footage — and hourly after that, which is
		// frequent enough that clips leave within an hour of their deadline and
		// rare enough to be invisible on a Pi.
		// Capture. Only when a camera driver registered AND a camera has a
		// resolved stream address: with neither, this loop enumerates an empty
		// set and sleeps.
		if h.camDrv != nil {
			h.workers = append(h.workers, worker{
				name: "camera-capture",
				run: func(ctx context.Context) {
					rec.RunCapture(ctx, func(ctx context.Context) ([]recording.Source, error) {
						var out []recording.Source
						for _, t := range h.camDrv.StreamTargets() {
							key := devices.Key(h.camDrv.ID(), t.ID)
							// Footage is written under an account id, and there
							// is no correct directory for footage nobody owns —
							// so an unclaimed camera is not recorded. It is not
							// an error: claiming is a deliberate act an admin
							// performs, and until then the camera is visible and
							// not recorded.
							acct, err := h.store.DeviceOwnerAccount(ctx, key)
							if err != nil {
								continue
							}
							out = append(out, recording.Source{
								DeviceKey: key, AccountID: acct,
								StreamURL: t.URL, Cred: t.Cred,
							})
						}
						return out, nil
					})
				},
			})
		}

		h.workers = append(h.workers, worker{
			name: "camera-clip-retention",
			run: func(ctx context.Context) {
				t := time.NewTicker(recording.RetentionInterval)
				defer t.Stop()
				for {
					if n, err := rec.ExpireAll(ctx); err != nil {
						h.log.Error("camera clip retention sweep failed", "err", err)
					} else if n > 0 {
						h.log.Info("camera clip retention", "expired", n)
					}
					// Expiry works from the index, so it cannot see a file that
					// has no row — a crash between WriteClip's rename and its
					// insert leaves exactly that, and nothing else would ever
					// reclaim it. Same pass, because the two together are what
					// actually bounds the disk.
					if n, err := rec.ReclaimOrphans(ctx); err != nil {
						h.log.Error("camera clip orphan sweep failed", "err", err)
					} else if n > 0 {
						h.log.Info("camera clip orphan sweep", "reclaimed", n)
					}
					select {
					case <-ctx.Done():
						return
					case <-t.C:
					}
				}
			},
		})
	}
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
	deviceDriverMQTT   = "mqtt"
	deviceDriverModbus = "modbus"
	// deviceDriverAccess is the only driver built from the DATABASE rather than
	// the device config file, so it is also the only one usable with no
	// -device-config at all. See docs/ACCESS-ON-THE-ENGINE.md §3.2.
	deviceDriverAccess = "access"
)

// needsDeviceConfig reports whether a driver is built from the config file.
// Everything except access is.
func needsDeviceConfig(name string) bool { return name != deviceDriverAccess }

// defaultDeviceRefresh is how often every driver is re-discovered. Five
// minutes: discovery is how a camera that came back on the network reappears
// and how a device that went away stops being asserted as live, and neither
// is urgent enough to be worth probing a segment over every few seconds.
const defaultDeviceRefresh = 5 * time.Minute

func knownDeviceDrivers() []string {
	return []string{deviceDriverAccess, deviceDriverCamera, deviceDriverHTTP, deviceDriverModbus, deviceDriverMQTT}
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
		case deviceDriverHTTP, deviceDriverCamera, deviceDriverMQTT, deviceDriverModbus, deviceDriverAccess:
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
	MQTT   *mqtt.Config    `json:"mqtt"`
	Modbus *modbus.Config  `json:"modbus"`
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
	if err := resolveDeviceSecrets(&out); err != nil {
		return deviceFile{}, fmt.Errorf("%s: %w", path, err)
	}
	return out, nil
}

// resolveDeviceSecrets turns `${env:…}` and `${file:…}` references into the
// secrets they name, at exactly the three places a credential can appear.
//
// Enumerated rather than reflected over: resolving EVERY string in the config
// would mangle a device label that happens to look like a reference, and would
// silently acquire new behaviour every time a driver gained a field. These
// three are the credential surface, and a fourth should be added here
// deliberately.
//
// A failure returns a ZERO deviceFile, so a partially-resolved config can never
// reach a driver — half a credential set is how a hub connects to one broker
// authenticated and another anonymously without saying so.
func resolveDeviceSecrets(f *deviceFile) error {
	if f.MQTT != nil {
		v, err := secretref.Resolve("mqtt.password", f.MQTT.Password)
		if err != nil {
			return err
		}
		f.MQTT.Password = v
	}
	if f.Camera != nil {
		for host, cred := range f.Camera.Credentials {
			where := "camera.credentials[" + host + "]"
			if host == "" {
				where = "camera.credentials (default)"
			}
			v, err := secretref.Resolve(where+".password", cred.Password)
			if err != nil {
				return err
			}
			cred.Password = v
			f.Camera.Credentials[host] = cred
		}
	}
	if f.HTTP != nil {
		for i := range f.HTTP.Devices {
			d := &f.HTTP.Devices[i]
			h, err := secretref.ResolveMap("http.devices["+d.ID+"]", d.Headers)
			if err != nil {
				return err
			}
			d.Headers = h
		}
	}
	return nil
}

// buildDeviceDriver constructs one named driver from the config file. The
// driver packages validate everything themselves, at construction, which is
// why this is as thin as it is.
func (h *hub) buildDeviceDriver(name string, file deviceFile) (devices.Driver, error) {
	switch name {
	case deviceDriverAccess:
		// Read-only: it surfaces gates in the fleet and refuses every verb.
		// Opening one stays on the signed Ed25519 path — see the accessdev
		// package doc and docs/ACCESS-ON-THE-ENGINE.md §3.1.
		return accessdev.New(accessdev.Config{
			List: func(ctx context.Context) ([]accessdev.AccessPoint, error) {
				rows, err := h.store.AllAccessPoints(ctx)
				if err != nil {
					return nil, err
				}
				out := make([]accessdev.AccessPoint, 0, len(rows))
				for _, r := range rows {
					out = append(out, accessdev.AccessPoint{
						ID: r.ID, AccountID: r.AccountID, Name: r.Name,
						Kind: r.Kind, DeviceID: r.DeviceID, Status: r.Status,
					})
				}
				return out, nil
			},
			// Read lazily: the device hub is built AFTER the engine is wired,
			// so at boot there is genuinely nobody to ask, and the second
			// return value is what says so instead of reporting every gate as
			// offline.
			Connected: func(controllerID string) (bool, bool) {
				if h.srv == nil {
					return false, false
				}
				return h.srv.Hub().Connected(controllerID), true
			},
			Log: h.log.With("driver", deviceDriverAccess),
		})
	case deviceDriverHTTP:
		if file.HTTP == nil {
			return nil, errors.New(`the device config has no "http" object`)
		}
		d, err := httpdev.New(*file.HTTP)
		if err != nil {
			return nil, err
		}
		return d, nil
	case deviceDriverModbus:
		if file.Modbus == nil {
			return nil, errors.New(`the device config has no "modbus" object`)
		}
		d, err := modbus.New(*file.Modbus)
		if err != nil {
			return nil, err
		}
		return d, nil
	case deviceDriverMQTT:
		if file.MQTT == nil {
			return nil, errors.New(`the device config has no "mqtt" object`)
		}
		d, err := mqtt.New(*file.MQTT)
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
	// `access` reads the database, so a hub that wants only its gates in the
	// fleet needs no config file. Requiring one to list devices the product
	// already knows about would be a file written to satisfy a check.
	wantsFile := false
	for _, name := range enabled {
		if needsDeviceConfig(name) {
			wantsFile = true
		}
	}
	var file deviceFile
	if wantsFile {
		if cfg.deviceConfig == "" {
			h.log.Error("device drivers were selected but -device-config is empty; "+
				"the device engine stays off", "drivers", enabled)
			return
		}
		var err error
		file, err = loadDeviceFile(cfg.deviceConfig)
		if err != nil {
			h.log.Error("device config could not be read; the device engine stays off",
				"path", cfg.deviceConfig, "err", err)
			return
		}
	}

	reg := devices.NewRegistry()
	var registered []string
	for _, name := range enabled {
		drv, err := h.buildDeviceDriver(name, file)
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
		if cd, ok := drv.(*camera.Driver); ok {
			// Kept so the capture worker can enumerate resolved streams. The
			// registry stores drivers behind an interface that deliberately has
			// no notion of a media address.
			h.camDrv = cd
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

// newEnergyStore builds the metering store. It is built UNCONDITIONALLY, and
// separately from the poller, for a reason worth stating: history does not
// vanish because polling was turned off. An operator who disables the poller —
// or whose meter died last month — must still be able to read what was already
// recorded, so the read API is bound to the store rather than to the worker.
//
// The engine owns migration 0011's tables and takes a bare database handle so
// it cannot reach the audit tables — see store.DB.
func (h *hub) newEnergyStore(cfg config) *energy.Store {
	loc := time.UTC
	if cfg.energyTZ != "" {
		l, err := time.LoadLocation(cfg.energyTZ)
		if err != nil {
			h.log.Error("AQL_ENERGY_TZ is not a timezone this system knows; "+
				"rollup buckets stay anchored to UTC", "tz", cfg.energyTZ, "err", err)
		} else {
			loc = l
		}
	}
	return energy.NewStore(h.store.DB(), energy.WithLocation(loc))
}

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

	// Rollup buckets are anchored to a timezone and the default is UTC, which
	// is the wrong answer for most of the world and produces numbers that look
	// entirely right. Said at startup, and only when metering is actually
	// running, because this is the last moment it is cheap to fix.
	//
	// The "later does not re-bucket" half is the part that makes this worth a
	// warning rather than a doc line. tz is part of energy_rollups' primary key,
	// every read filters on the CURRENT zone, and rollups are recomputed only
	// from the dirty queue that ingest marks — reads never do that work, by
	// design. So switching zones after months of running leaves the old buckets
	// in the table, correct and permanently invisible, with no backfill path.
	if cfg.energyTZ == "" {
		h.log.Warn("AQL_ENERGY_TZ is not set, so energy rollups anchor to UTC. "+
			"Every daily and monthly total will split at UTC midnight rather than local "+
			"midnight, which is wrong for anywhere that is not UTC and looks plausible. "+
			"Set it now rather than later: the timezone is part of each rollup's identity, "+
			"so changing it afterwards does not re-bucket what is already stored — the old "+
			"rows stay in the database and stop appearing in any query",
			"set", "AQL_ENERGY_TZ", "example", "Africa/Johannesburg")
	}

	est := h.energy
	// Route each meter's samples to the account that CLAIMED it, falling back
	// to -energy-account for meters nobody has claimed. Without this the
	// poller wrote every meter on the hub under one account, which is right
	// for one household and wrong in both directions for two: the account
	// that claimed a meter saw nothing for it, and the configured account saw
	// meters it never claimed.
	poller := energy.NewPoller(h.reg, est, cfg.energyAccount,
		energy.WithInterval(cfg.energyInterval),
		energy.WithSampleRetention(cfg.energySampleRetention),
		energy.WithOwnerLookup(func(ctx context.Context, deviceKey string) (string, bool, error) {
			owner, err := h.store.DeviceOwnerAccount(ctx, deviceKey)
			if errors.Is(err, store.ErrDeviceNotClaimed) {
				return "", false, nil
			}
			if err != nil {
				return "", false, err
			}
			return owner, true, nil
		}))

	retention := "forever"
	if cfg.energySampleRetention > 0 {
		retention = cfg.energySampleRetention.String()
	}
	h.log.Info("energy poller enabled", "account", cfg.energyAccount,
		"interval", poller.Interval(), "tz", est.TZ(), "sample_retention", retention)
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
				// A prune refusal is normal while the rollup backlog clears,
				// so it is not a warning — but a hub that can NEVER prune is
				// a disk filling quietly, which is the thing this is for.
				if res.PruneErr != nil {
					h.log.Info("energy sample retention did not run this cycle",
						"reason", res.PruneErr)
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
// newAutomationsEngine builds the rule engine, separately from the scheduler
// and BEFORE the HTTP server, so the management API is bound to it at
// construction rather than back-filled.
//
// It is built whenever there is a device registry, even with -automations off.
// The two are genuinely different things: the engine validates and stores
// rules, the scheduler fires them. An operator setting a hub up wants to write
// the rules first and turn the scheduler on once they are happy.
//
// The obvious hazard in that — rules that exist and quietly never fire — is
// answered by reporting it rather than by preventing it: the list response
// carries scheduler_running, so a console can say so plainly. Refusing to store
// a rule because the scheduler is off would be the worse trade, since it makes
// the setup order load-bearing for no safety gain.
//
// Nil when there is no registry. Not an error: a rule that cannot resolve a
// device is a rule that cannot be saved, so an engine without one would accept
// nothing and mislead about why.
func (h *hub) newAutomationsEngine() *automations.Engine {
	if h.reg == nil {
		return nil
	}
	// Same bare-handle rule as the metering engine, and here it is load
	// bearing: the engine writes its trail ONLY through the store's
	// hash-chained WriteAdminAudit, and it is built so it cannot reach the
	// audit tables any other way.
	eng, err := automations.NewEngine(automations.Config{
		Registry: h.reg,
		Store:    automations.NewStore(h.store.DB()),
		Audit:    h.store,
		// A rule may only drive devices its own account has claimed. Nil here
		// would keep the pre-ownership behaviour, where a rule in one account
		// could actuate another account's device.
		//
		// AccountForDeviceKey rather than DeviceOwnerAccount, because a gate is
		// never CLAIMED — it is owned through its location's account — and
		// "unclaimed is permitted" would otherwise let a rule in one account
		// name another account's gate.
		//
		// Written as a closure rather than passed as the method value it could
		// be, because the store's reachability guard matches `.Name(` and a
		// method value is invisible to it. See that test's note.
		DeviceOwner: func(ctx context.Context, deviceKey string) (string, bool, error) {
			return h.store.AccountForDeviceKey(ctx, deviceKey)
		},
	})
	if err != nil {
		h.log.Error("rule engine not started; automation rules cannot be "+
			"managed or fired on this hub", "err", err)
		return nil
	}
	return eng
}

func (h *hub) wireAutomations(cfg config) {
	if !cfg.automations {
		return
	}
	eng := h.automations
	if eng == nil {
		h.log.Error("-automations is set but there is no rule engine (no device " +
			"driver is running, so no rule could resolve a device); the rule " +
			"scheduler stays off")
		return
	}
	runner, err := automations.NewRunner(automations.RunnerConfig{
		Engine:   eng,
		Interval: cfg.automationsInterval,
		Log:      h.log,
		// Clip triggers ask the clip index when a camera last recorded. The
		// store is always present here, so clip rules are never silently inert.
		Clips: h.store,
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

// knownCommands is every subcommand the dispatch above recognises, in the form
// an operator types. Kept beside unknownCommand so the refusal can list them:
// "unknown command" without the list is a dead end, and this binary's commands
// are the kind somebody reaches for once a year.
var knownCommands = []string{
	"aql-hub verify-audit [-data DIR]",
	"aql-hub 2fa disable -user NAME -reason TEXT [-data DIR]",
	"aql-hub energy rebucket -account ID [-tz ZONE] [-dry-run]",
}

// unknownCommand reports whether args begin with something that looks like a
// subcommand but matched no dispatch, and returns what to print if so.
//
// The server takes no positional arguments, so a leading non-flag token has no
// other meaning and must not be ignored. Separated from main for one reason:
// the behaviour that matters is that the binary does NOT start a hub, and a
// test cannot observe an os.Exit — so the decision lives here where it can be
// asserted directly.
func unknownCommand(args []string) (string, bool) {
	if len(args) == 0 || strings.HasPrefix(args[0], "-") {
		return "", false
	}
	var b strings.Builder
	fmt.Fprintf(&b, "aql-hub: unknown command %q\n\n", strings.Join(args, " "))
	fmt.Fprintln(&b, "Known commands:")
	for _, c := range knownCommands {
		fmt.Fprintf(&b, "  %s\n", c)
	}
	fmt.Fprintln(&b, "\nTo start the hub, pass flags only: aql-hub [-listen ADDR] [-data DIR] …")
	return b.String(), true
}
