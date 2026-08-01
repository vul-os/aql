// Package httpapi is the hub's HTTP surface: std-lib net/http with Go 1.22
// pattern routing, no framework (house style). See hub/README.md for the map.
//
// # About the "Workers backend" this file and its neighbours keep naming
//
// Many route shapes here were originally ported from a Cloudflare Workers +
// Postgres backend that used to live in backend/. That directory was DELETED
// by decision — the Go hub is the only server — so those names are historical
// provenance and nothing a reader can open. They are kept because knowing a
// shape was inherited rather than chosen explains otherwise-odd corners of it.
//
// Nothing outside this repository specifies these routes any more. What the
// hub serves IS the contract, pinned from the console's side by
// src/lib/__tests__/routeParity.test.ts, which fails when a screen calls a
// route the hub does not have.
package httpapi

import (
	"context"
	"encoding/json"
	"log/slog"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/vul-os/aql/hub/internal/automations"
	"github.com/vul-os/aql/hub/internal/channels"
	"github.com/vul-os/aql/hub/internal/devices"
	"github.com/vul-os/aql/hub/internal/energy"
	"github.com/vul-os/aql/hub/internal/hub"
	"github.com/vul-os/aql/hub/internal/keys"
	"github.com/vul-os/aql/hub/internal/portal"
	"github.com/vul-os/aql/hub/internal/recording"
	"github.com/vul-os/aql/hub/internal/store"
)

// Config is what the server needs beyond its collaborators.
type Config struct {
	Version         string
	Env             string // reported by /health (backend APP_ENV parity)
	PublicURL       string
	AdminClaimToken string // empty = claim disabled (fail-closed)
	// RecordingsRoot is where camera clips live. Empty disables playback: a
	// hub with no configured root must refuse to serve footage rather than
	// resolve a relative path against whatever its working directory is.
	RecordingsRoot string
	// Live fans muxed fragments out to viewers. nil disables live view.
	Live      *recording.Broadcaster
	JWTSecret []byte
	// ClockSyncInterval is how often connected controllers are pinged to prove
	// their clock advanced. Zero = the 6-hour default, which is deliberately
	// far inside the 14-day staleness limit (see clocksync.go).
	//
	// Configurable because the right cadence is a property of a SITE, not of
	// this code: a fleet on links that drop for days wants a shorter one, and
	// the budget it is spending against is fixed by the wire contract rather
	// than by the hub.
	ClockSyncInterval time.Duration
	// AckTimeout bounds how long an open request waits for the device's
	// cmd.ack before recording 'undelivered'. Zero = default 5 s.
	AckTimeout time.Duration
	// RateLimits is the env layer of the rate-limit config (defaults
	// merged in main via store.ParseRateLimitConfig). Zero value = defaults.
	RateLimits store.RateLimitConfig
	// AuthRateLimits bounds the credential endpoints (login/register/
	// refresh) and the admin claim against brute-force/DoS — see
	// store.AuthRateLimitConfig's doc comment. Zero value = defaults.
	AuthRateLimits store.AuthRateLimitConfig
	// Devices is the device engine. Nil (the default) means no engine: the
	// endpoints report an empty fleet rather than failing.
	Devices *devices.Registry

	// Energy is the metering store. Nil (the default) means this hub has no
	// metering, and every energy route answers 503 with a distinct code.
	Energy *energy.Store

	// Automations is the rule engine. Nil (the default) means rules cannot be
	// managed on this hub, and every automations route answers 503.
	Automations *automations.Engine

	// AutomationsScheduler reports whether the background scheduler is
	// actually running. The engine and the scheduler are separate: an operator
	// can write rules with the scheduler off, and those rules will not fire.
	//
	// That is surfaced rather than prevented, so the API can say so plainly
	// instead of a console showing a list of rules that silently do nothing.
	AutomationsScheduler bool
	// Channels holds the chat-channel credentials (WhatsApp/Slack/Telegram).
	// Zero value = every channel refuses its webhook (fail-closed) and its
	// sender is a config-unset no-op.
	Channels channels.Config
	// RecoveryMailer delivers account-recovery secrets out of band (password
	// reset + username verification). nil falls back to LogRecoveryMailer, which
	// prints the link to the operator console and does NOT deliver anything —
	// read authmail.go's doc comment before running with the default on any
	// instance that has more than one account on it.
	RecoveryMailer RecoveryMailer
	// DMTAPTransport is the DMTAP dial-out channel's transport (see
	// channels/dmtap.go). nil (the default — main.go never sets this today)
	// means the DMTAP channel is disabled: fail-closed, never a silent no-op
	// that could be mistaken for working. There is no env var for this yet
	// because there is no real transport to configure (see dmtap.go's TODO).
	DMTAPTransport channels.DMTAPTransport
}

// Server wires the store, signing keys, device hub and config into an
// http.Handler.
type Server struct {
	cfg   Config
	store *store.Store
	keys  *keys.Keys
	hub   *hub.Hub
	log   *slog.Logger

	// webhooks delivers outbound notifications. Never nil in production; a
	// nil dispatcher simply emits nothing, which is what tests that do not
	// care about webhooks get.
	webhooks *webhookDispatcher

	// energy is the metering store, or nil when no meter is configured. Nil is
	// the default and is not an error — a hub with no meter has no energy
	// history, which is different from a failure. Handlers return 503 with a
	// distinct code rather than 404, so an operator can tell "not wired up"
	// from "wrong URL".
	energy *energy.Store

	// automations is the rule engine, or nil when the scheduler is not running.
	// Nil is the default; every route answers 503 with a distinct code rather
	// than 404, for the reason automations.go gives.
	automations *automations.Engine

	// devices is the device engine, or nil when no driver was configured.
	// Nil is the DEFAULT and is not an error: a hub with no device config has
	// an empty fleet, which is different from a failure. Every handler in
	// engine.go checks for nil rather than assuming an engine exists.
	devices *devices.Registry

	// Chat-channel seam (internal/channels). The Channel values authenticate
	// inbound webhooks; the senders are interfaces so tests inject fakes.
	wa        channels.WhatsApp
	slack     channels.Slack
	tg        channels.Telegram
	waSend    channels.WhatsAppSender
	slackSend channels.SlackSender
	tgSend    channels.TelegramSender
	socket    *channels.SocketMode // non-nil only when a Slack app token is set; also in dial below
	dmtap     *channels.DMTAP      // non-nil only when cfg.DMTAPTransport is set; also in dial below

	// dial holds every configured DialChannel (subscribe-shaped channels —
	// see channels.DialChannel): Slack Socket Mode today, DMTAP alongside it.
	// StartChannels launches whichever of these report Enabled().
	dial []channels.DialChannel
}

// New builds a Server.
func New(cfg Config, st *store.Store, ks *keys.Keys, log *slog.Logger) *Server {
	if log == nil {
		log = slog.Default()
	}
	if cfg.AckTimeout <= 0 {
		cfg.AckTimeout = 5 * time.Second
	}
	if cfg.Env == "" {
		cfg.Env = "self-hosted"
	}
	if (cfg.RateLimits == store.RateLimitConfig{}) {
		cfg.RateLimits = store.RateLimitDefaults
	}
	if (cfg.AuthRateLimits == store.AuthRateLimitConfig{}) {
		cfg.AuthRateLimits = store.AuthRateLimitDefaults
	}
	if cfg.Channels.PublicURL == "" {
		cfg.Channels.PublicURL = cfg.PublicURL
	}
	s := &Server{cfg: cfg, store: st, keys: ks, hub: hub.New(), log: log, devices: cfg.Devices, energy: cfg.Energy, automations: cfg.Automations}
	s.webhooks = newWebhookDispatcher(st, log)
	// The automations engine raises alerts through the same dispatcher. Wired
	// HERE rather than at the engine's construction because the engine is built
	// before this server exists, and a second dispatcher for alerts would mean
	// two retirement counters and two delivery logs for one endpoint.
	if cfg.Automations != nil {
		cfg.Automations.SetNotifier(s.webhooks)
	}
	ch := cfg.Channels
	s.wa = channels.WhatsApp{AppSecret: ch.WhatsAppAppSecret, VerifyToken: ch.WhatsAppVerifyToken, PublicURL: ch.PublicURL}
	s.slack = channels.Slack{SigningSecret: ch.SlackSigningSecret}
	s.tg = channels.Telegram{WebhookSecret: ch.TelegramWebhookSecret}
	// WhatsApp engine: cloud (Meta Cloud API) is the default and the only
	// implicit choice; the self-hosted bridge is opt-in only and, when
	// selected, gets a non-negotiable startup warning naming the account-ban
	// risk (see channels/send.go's "WhatsApp engine selection" section).
	waEngine := channels.ResolveWhatsAppEngine(ch.WhatsAppEngine)
	if waEngine == channels.WhatsAppEngineBridge {
		log.Warn(channels.WhatsAppBanRiskWarning)
	}
	s.waSend = channels.NewWhatsAppSender(waEngine, ch)
	s.slackSend = &channels.HTTPSlackSender{BotToken: ch.SlackBotToken}
	s.tgSend = &channels.HTTPTelegramSender{BotToken: ch.TelegramBotToken}
	if ch.SlackAppToken != "" {
		// Socket Mode: the zero-URL path. Events + interactions arrive over the
		// outbound WebSocket and are fed through the SAME handlers as the webhook.
		s.socket = &channels.SocketMode{AppToken: ch.SlackAppToken, Logger: log, Handle: s.handleSlackSocketEnvelope}
		s.dial = append(s.dial, s.socket)
	}
	s.wireDiscord() // Discord: the third dial-out rail (channels_discord.go)
	// Telegram long-polling: the zero-ingress path for that rail, mirroring
	// Slack's Socket Mode above. Always constructed and always safe to
	// construct — the poller reports Enabled() == false unless the engine is
	// the exact opt-in "polling" AND a bot token is set, and StartChannels
	// skips every DialChannel that is not Enabled(). An install that has not
	// set AQL_TELEGRAM_ENGINE keeps the authenticated webhook, unchanged.
	//
	// This block is the one thing channels_telegram_polling.go was missing:
	// the poller, its offset storage and its handler have all existed for a
	// while, complete and tested, and nothing constructed them. Its own doc
	// comment carried these lines as a suggestion.
	if p := s.NewTelegramPoller(ch.TelegramEngine); p.Enabled() {
		s.dial = append(s.dial, p)
	}
	if cfg.DMTAPTransport != nil {
		// DMTAP: the second DialChannel, proving the seam generalizes beyond
		// Slack. Only reachable when a caller injects a real Transport (see
		// channels/dmtap.go — none exists in this codebase yet); main.go never
		// does, so this stays disabled in the shipped binary today.
		s.dmtap = &channels.DMTAP{Transport: cfg.DMTAPTransport, Logger: log, Handle: s.handleDMTAPIntent}
		s.dial = append(s.dial, s.dmtap)
	}
	return s
}

// Hub exposes the device hub (tests + channel integrations).
func (s *Server) Hub() *hub.Hub { return s.hub }

// StartChannels launches every configured dial-out channel worker
// (channels.DialChannel — Slack Socket Mode, DMTAP) bound to ctx. Disabled
// channels (Enabled() == false, e.g. no credentials configured) are skipped:
// fail-closed, never "runs unauthenticated". Call once after New; it returns
// immediately, the workers run in the background.
func (s *Server) StartChannels(ctx context.Context) {
	for _, d := range s.dial {
		if d == nil || !d.Enabled() {
			continue
		}
		s.log.Info("dial-out channel enabled", "channel", d.Kind())
		go d.Run(ctx)
	}
}

// Router builds the mux. Later-ported route groups (accounts, locations,
// access, devices, channels, admin console) attach here.
func (s *Server) Router() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", s.handleHealth)
	mux.HandleFunc("GET /v1/gateway/key", s.handleGatewayKey)

	// auth
	mux.HandleFunc("POST /v1/auth/register", s.handleRegister)
	mux.HandleFunc("POST /v1/auth/login", s.handleLogin)
	mux.HandleFunc("POST /v1/auth/refresh", s.handleRefresh)
	mux.HandleFunc("POST /v1/auth/logout", s.handleLogout)
	mux.Handle("POST /v1/auth/logout-all", s.requireAuth(s.handleLogoutAll))
	mux.Handle("GET /v1/auth/me", s.requireAuth(s.handleMe))

	// account recovery (spec: backend auth.ts; see authrecovery.go). The
	// first three are unauthenticated by necessity — the caller is by
	// definition someone who cannot log in — and are throttled + uniform in
	// their responses accordingly. update-password is authenticated AND
	// re-authenticates with the current password: it is not a shortcut past
	// the reset flow.
	mux.HandleFunc("POST /v1/auth/forgot-password", s.handleForgotPassword)
	mux.HandleFunc("POST /v1/auth/reset-password", s.handleResetPassword)
	mux.Handle("POST /v1/auth/update-password", s.requireAuth(s.handleUpdatePassword))
	mux.Handle("PATCH /v1/auth/me/profile", s.requireAuth(s.handleProfileUpdate))

	// Phone linking (see phones.go and docs/PHONE-LINKING.md). Session-only,
	// like the 2FA routes below: linking an identity that the chat rails
	// then trust is not something an API token should be able to do.
	mux.Handle("POST /v1/phones/me/link", s.requireAuth(s.handlePhoneLinkStart))
	mux.Handle("GET /v1/phones/me/phones", s.requireAuth(s.handlePhonesList))
	mux.Handle("DELETE /v1/phones/me/phones/{id}", s.requireAuth(s.handlePhoneUnlink))

	// Channel identity linking (see channellink.go). Same ceremony, different
	// binding target — and a longer code, because a channel code cannot name
	// the account that may spend it.
	mux.Handle("POST /v1/channels/me/link", s.requireAuth(s.handleChannelLinkStart))
	mux.Handle("GET /v1/channels/me/identities", s.requireAuth(s.handleChannelIdentitiesList))
	mux.Handle("DELETE /v1/channels/me/identities/{channel}/{external_id}", s.requireAuth(s.handleChannelIdentityUnlink))

	// two-factor authentication (see twofactor.go). All four are session-only
	// — an API token can never enrol, activate or remove a second factor,
	// because requireAuth accepts JWTs only. The login-side gate is not a
	// route: it lives inside POST /v1/auth/login above, so there is no way to
	// reach a session without passing it.
	mux.Handle("GET /v1/auth/2fa", s.requireAuth(s.handleTwoFactorStatus))
	mux.Handle("POST /v1/auth/2fa/enroll", s.requireAuth(s.handleTwoFactorEnroll))
	mux.Handle("DELETE /v1/auth/2fa/enroll", s.requireAuth(s.handleTwoFactorEnrollCancel))
	mux.Handle("POST /v1/auth/2fa/activate", s.requireAuth(s.handleTwoFactorActivate))
	mux.Handle("POST /v1/auth/2fa/disable", s.requireAuth(s.handleTwoFactorDisable))

	// instance admin first-run claim
	mux.Handle("GET /v1/admin/claim", s.requireAuth(s.handleClaimState))
	mux.Handle("POST /v1/admin/claim", s.requireAuth(s.handleClaim))

	// platform-admin console (spec: backend admin.ts) — live-admin gated
	mux.Handle("GET /v1/admin/overview", s.requireAdmin(s.handleAdminOverview))
	mux.Handle("GET /v1/admin/accounts", s.requireAdmin(s.handleAdminAccounts))
	mux.Handle("GET /v1/admin/accounts/{id}", s.requireAdmin(s.handleAdminAccountGet))
	mux.Handle("PATCH /v1/admin/accounts/{id}", s.requireAdmin(s.handleAdminAccountPatch))
	mux.Handle("GET /v1/admin/users", s.requireAdmin(s.handleAdminUsers))
	mux.Handle("PATCH /v1/admin/users/{id}", s.requireAdmin(s.handleAdminUserPatch))
	mux.Handle("POST /v1/admin/users/{id}/platform-admin", s.requireAdmin(s.handleAdminPlatformAdmin))
	mux.Handle("GET /v1/admin/limits", s.requireAdmin(s.handleAdminLimitsGet))
	mux.Handle("PATCH /v1/admin/limits", s.requireAdmin(s.handleAdminLimitsPatch))
	mux.Handle("GET /v1/admin/audit", s.requireAdmin(s.handleAdminAudit))
	mux.Handle("GET /v1/admin/audit/actions", s.requireAdmin(s.handleAdminAuditActions))
	mux.Handle("GET /v1/admin/audit/verify", s.requireAdmin(s.handleAdminAuditVerify))

	// accounts + members + invites
	mux.Handle("GET /v1/accounts", s.requireAuth(s.handleAccountsList))
	mux.Handle("POST /v1/accounts", s.requireAuth(s.handleAccountCreate))
	// literal "invites" segment wins over {id} in the 1.22 mux
	mux.Handle("POST /v1/accounts/invites/{token}/accept", s.requireAuth(s.handleInviteAccept))
	mux.Handle("PATCH /v1/accounts/{id}", s.requireAuth(s.handleAccountPatch))
	mux.Handle("GET /v1/accounts/{id}/members", s.requireAuth(s.handleMembersList))
	mux.Handle("DELETE /v1/accounts/{id}/members/{user_id}", s.requireAuth(s.handleMemberRemove))
	mux.Handle("POST /v1/accounts/{id}/invites", s.requireAuth(s.handleInviteCreate))

	// scoped API tokens (see tokens.go). Session-only routes: a token can
	// never mint, list or revoke another token — requireAuth accepts JWTs
	// only, so escalating from a leaked token to a fresh, differently-scoped
	// one is not a path that exists.
	mux.Handle("GET /v1/accounts/{id}/api-tokens", s.requireAuth(s.handleAPITokensList))
	mux.Handle("POST /v1/accounts/{id}/api-tokens", s.requireAuth(s.handleAPITokenCreate))
	mux.Handle("POST /v1/accounts/{id}/api-tokens/{token_id}/revoke", s.requireAuth(s.handleAPITokenRevoke))

	// locations + limits
	mux.Handle("GET /v1/accounts/{id}/locations", s.requireAuth(s.handleLocationsList))
	mux.Handle("POST /v1/accounts/{id}/locations", s.requireAuth(s.handleLocationCreate))
	mux.Handle("POST /v1/locations", s.requireAuth(s.handleTopLevelLocationCreate))
	mux.Handle("PATCH /v1/locations/{id}", s.requireAuth(s.handleLocationPatch))
	mux.Handle("DELETE /v1/locations/{id}", s.requireAuth(s.handleLocationDelete))
	mux.Handle("GET /v1/locations/{id}/limits", s.requireAuth(s.handleLocationLimitsGet))
	mux.Handle("PATCH /v1/locations/{id}/limits", s.requireAuth(s.handleLocationLimitsPatch))
	// §4.4 rule 6's switch: whether a chat rail may disclose occupancy for this
	// location. Off unless an operator says otherwise.
	mux.Handle("GET /v1/locations/{id}/disclosure", s.requireAuth(s.handleLocationDisclosureGet))
	mux.Handle("PATCH /v1/locations/{id}/disclosure", s.requireAuth(s.handleLocationDisclosurePatch))

	// access points
	//
	// The four tokenScoped routes below are the ONLY ones an API token can
	// reach, and each names the scope it demands at registration — see
	// tokens_auth.go for why that placement, rather than a check inside a
	// handler, is what makes a read-only token structurally unable to
	// actuate. Every other route in this Router is requireAuth/requireAdmin,
	// which accept session JWTs only, so a token presented anywhere else is
	// refused for not being a JWT. Adding a token-reachable route is a
	// deliberate one-line act here; forgetting is fail-closed.
	mux.Handle("GET /v1/access-points", s.tokenScoped(store.ScopeAccessRead, fenceAccountQuery, s.handleAccessPointsList))
	mux.Handle("POST /v1/access-points", s.requireAuth(s.handleAccessPointCreate))
	mux.Handle("GET /v1/access-points/{id}", s.tokenScoped(store.ScopeAccessRead, fenceAccessPointPath, s.handleAccessPointGet))

	// Maintenance log. requireAuth, NOT tokenScoped: a scoped API token can
	// read access points and open them, and neither of those implies a right
	// to read or append a service history. Reaching it from a token would need
	// a scope of its own, and inventing one for a surface nothing integrates
	// with yet would be widening the token model on speculation. Session only
	// until something actually needs otherwise.
	mux.Handle("GET /v1/access-points/{id}/maintenance", s.requireAuth(s.handleMaintenanceList))
	mux.Handle("POST /v1/access-points/{id}/maintenance", s.requireAuth(s.handleMaintenanceCreate))

	// the open path + temporary grants (spec: backend access.ts logAccess)
	mux.Handle("POST /v1/access-points/{id}/open", s.tokenScoped(store.ScopeAccessOpen, fenceAccessPointPath, s.handleAccessPointOpen))
	mux.Handle("POST /v1/access-points/{id}/close", s.tokenScoped(store.ScopeAccessOpen, fenceAccessPointPath, s.handleAccessPointClose))
	// A hold goes through the same choke point as an open (see
	// handleAccessPointHold) but is deliberately NOT token-reachable. The
	// four tokenScoped routes above are the whole list, and the reasoning the
	// maintenance log already uses applies here exactly: a scoped token can
	// read access points and open them, and neither of those implies a right
	// to leave one standing open. Somebody who minted an open-scoped token
	// consented to pulses, not to a gate held wide. Session only.
	mux.Handle("POST /v1/access-points/{id}/hold", s.requireAuth(s.handleAccessPointHold))
	mux.Handle("GET /v1/grants", s.requireAuth(s.handleGrantsList))
	mux.Handle("POST /v1/grants", s.requireAuth(s.handleGrantCreate))
	mux.Handle("GET /v1/grants/{id}", s.requireAuth(s.handleGrantGet))
	mux.Handle("POST /v1/grants/{id}/revoke", s.requireAuth(s.handleGrantRevoke))

	// offline grants (spec: proto/grants.md) — the gateway-side issuance half
	// of the emergency no-internet path; controller/internal/grants verifies.
	mux.Handle("POST /v1/offline-grants", s.requireAuth(s.handleOfflineGrantIssue))
	mux.Handle("GET /v1/offline-grants", s.requireAuth(s.handleOfflineGrantList))
	mux.Handle("POST /v1/offline-grants/{id}/revoke", s.requireAuth(s.handleOfflineGrantRevoke))

	// Time-window rules (see timewindows.go): when a given member may open a
	// given door. Writes are admin-only; the list is readable by any member,
	// but an ordinary member sees only the rules that name them.
	mux.Handle("GET /v1/accounts/{id}/time-windows", s.requireAuth(s.handleTimeWindowsList))
	mux.Handle("POST /v1/accounts/{id}/time-windows", s.requireAuth(s.handleTimeWindowCreate))
	mux.Handle("DELETE /v1/accounts/{id}/time-windows/{ruleID}", s.requireAuth(s.handleTimeWindowDelete))

	// Operator-armed T4 chat windows. Arming does NOT make a T4 verb reachable
	// over chat — see t4windows.go — it is one of the three independent
	// requirements in CHAT-COMMANDS.md §3.3's T4 row.
	mux.Handle("GET /v1/accounts/{id}/t4-windows", s.requireAuth(s.handleT4WindowsList))
	mux.Handle("POST /v1/accounts/{id}/t4-windows", s.requireAuth(s.handleT4WindowArm))
	mux.Handle("POST /v1/accounts/{id}/t4-windows/{windowID}/disarm", s.requireAuth(s.handleT4WindowDisarm))

	// Geofence rules (see geofence.go): an optional radius around a door or a
	// site, outside which an open is refused. Writes are admin-only; the list
	// is readable by ANY member, because a fence binds everyone identically
	// and a resident refused at the gate needs to be able to see why. Note
	// that this is a convenience, not a security control — the position it
	// tests is client-supplied and unverified (store/geofence.go).
	// LAN controller discovery (see discovery.go). POST, not GET: a browse puts
	// multicast on the operator's network and takes seconds, which is the wrong
	// shape for something a browser may prefetch or retry.
	mux.Handle("POST /v1/accounts/{id}/discover/controllers", s.requireAuth(s.handleDiscoverControllers))

	// Rail disclosures (see disclosure.go). Deliberately unauthenticated: the
	// four §26.3 fields exist so someone can compare adapters BEFORE choosing
	// one, and there is nothing account-specific in what the platforms do.
	mux.HandleFunc("GET /v1/rails/disclosure", s.handleRailDisclosures)

	// Automation rules (see automations.go). Admin-only including reads: a
	// rule says what the household's hardware does unattended, which is closer
	// to the audit trail than to a meter reading. Every safety property lives
	// in internal/automations, not here.
	mux.Handle("GET /v1/accounts/{id}/automations", s.requireAuth(s.handleAutomationsList))
	mux.Handle("POST /v1/accounts/{id}/automations", s.requireAuth(s.handleAutomationCreate))
	mux.Handle("GET /v1/accounts/{id}/automations/runs", s.requireAuth(s.handleAutomationRuns))
	mux.Handle("PUT /v1/accounts/{id}/automations/{ruleID}", s.requireAuth(s.handleAutomationUpdate))
	mux.Handle("DELETE /v1/accounts/{id}/automations/{ruleID}", s.requireAuth(s.handleAutomationDelete))
	mux.Handle("POST /v1/accounts/{id}/automations/{ruleID}/enabled", s.requireAuth(s.handleAutomationSetEnabled))
	mux.Handle("POST /v1/accounts/{id}/automations/{ruleID}/run", s.requireAuth(s.handleAutomationRunNow))
	mux.Handle("GET /v1/accounts/{id}/automations/{ruleID}/runs", s.requireAuth(s.handleAutomationRuns))

	// Energy metering (see energy.go). Read-only: samples come from the poller
	// reading real meters, and an endpoint that injects them is a way to forge
	// a bill. Every member reads — household consumption is not private
	// between members of the same household.
	mux.Handle("GET /v1/accounts/{id}/energy/channels", s.requireAuth(s.handleEnergyChannels))
	mux.Handle("GET /v1/accounts/{id}/energy/series", s.requireAuth(s.handleEnergySeries))
	mux.Handle("GET /v1/accounts/{id}/energy/mix", s.requireAuth(s.handleEnergyMix))

	mux.Handle("GET /v1/accounts/{id}/geofences", s.requireAuth(s.handleGeofencesList))
	mux.Handle("POST /v1/accounts/{id}/geofences", s.requireAuth(s.handleGeofenceCreate))
	mux.Handle("DELETE /v1/accounts/{id}/geofences/{ruleID}", s.requireAuth(s.handleGeofenceDelete))

	// analytics (see analytics.go) — READ-ONLY summaries over the append-only,
	// hash-chained audit rows. Session-auth only, member-gated per subject,
	// and every window is bounded (store.AnalyticsMaxWindowDays): an
	// unbounded scan over years of audit rows would be a denial of service
	// against a hub whose other job is opening gates.
	mux.Handle("GET /v1/analytics/accounts/{id}/summary", s.requireAuth(s.handleAnalyticsAccountSummary))
	mux.Handle("GET /v1/analytics/accounts/{id}/insights", s.requireAuth(s.handleAnalyticsAccountInsights))
	mux.Handle("GET /v1/analytics/locations/{id}/summary", s.requireAuth(s.handleAnalyticsLocationSummary))

	// Outbound webhooks. Admin-only: a webhook is a standing instruction to POST
	// a signed record of every gate opening to an address of the configurer's
	// choosing.
	mux.Handle("GET /v1/accounts/{id}/webhooks", s.requireAuth(s.handleWebhooksList))
	mux.Handle("POST /v1/accounts/{id}/webhooks", s.requireAuth(s.handleWebhookCreate))
	mux.Handle("DELETE /v1/accounts/{id}/webhooks/{webhookID}", s.requireAuth(s.handleWebhookDelete))

	// Device engine (internal/devices). Read paths are open to any authenticated
	// member; execute is an actuation and carries the tier ceiling and the
	// hazardous-motion confirm described in engine.go.
	mux.Handle("GET /v1/engine/devices", s.requireAuth(s.handleEngineDevices))

	// Device ownership (see deviceclaims.go). Account-admin only: a claim
	// decides who may actuate a physical device from then on, which is the
	// same class of act as creating an access point.
	mux.Handle("GET /v1/accounts/{id}/devices/claimable", s.requireAuth(s.handleClaimableDevices))
	mux.Handle("POST /v1/accounts/{id}/devices/claims", s.requireAuth(s.handleDeviceClaimCreate))
	mux.Handle("DELETE /v1/accounts/{id}/devices/claims/{key}", s.requireAuth(s.handleDeviceClaimDelete))
	mux.Handle("GET /v1/engine/devices/{key}/readings", s.requireAuth(s.handleEngineReadings))
	mux.Handle("POST /v1/engine/devices/{key}/execute", s.requireAuth(s.handleEngineExecute))
	mux.Handle("GET /v1/engine/health", s.requireAuth(s.handleEngineHealth))

	// devices + pairing + controller transport (spec: backend devices.ts +
	// proto/pairing.md)
	mux.Handle("GET /v1/devices", s.requireAuth(s.handleDevicesList))
	// The raw signed events a controller has delivered (see devices.go).
	// Admin-only; the access-relevant ones are already in every member's
	// audit view.
	mux.Handle("GET /v1/devices/{id}/events", s.requireAuth(s.handleDeviceEvents))
	mux.Handle("GET /v1/devices/{id}/config-report", s.requireAuth(s.handleDeviceConfigReport))
	// Remote controller retuning (deviceconfig.go). The hub is the only place
	// a bad value can be stopped: the controller stores whatever it is sent.
	mux.Handle("PATCH /v1/devices/{id}/config", s.requireAuth(s.handleDeviceConfig))
	// Which controllers can still be trusted to honour an offline grant
	// (clocksync.go). Operational fleet data, account-admin only.
	mux.Handle("GET /v1/accounts/{id}/controllers/clock-freshness", s.requireAuth(s.handleClockFreshness))

	// Camera footage (cameraview.go). `camera:view` is a per-member, per-camera
	// grant and is NOT implied by owner or admin — docs/CAMERA-RETENTION.md §2.4.
	// The access LOG is open to every member, not admins only, because the
	// subjects of the footage have the strongest claim to it (§2.5).
	mux.Handle("GET /v1/accounts/{id}/camera-view-grants", s.requireAuth(s.handleCameraViewGrants))
	mux.Handle("POST /v1/accounts/{id}/camera-view-grants", s.requireAuth(s.handleCameraViewGrant))
	mux.Handle("DELETE /v1/accounts/{id}/camera-view-grants", s.requireAuth(s.handleCameraViewRevoke))
	mux.Handle("GET /v1/accounts/{id}/cameras/{key}/clips", s.requireAuth(s.handleCameraClips))
	mux.Handle("GET /v1/accounts/{id}/cameras/{key}/clips/{clip}", s.requireAuth(s.handleCameraClipPlay))
	mux.Handle("GET /v1/accounts/{id}/cameras/{key}/live", s.requireAuth(s.handleCameraLive))
	mux.Handle("GET /v1/accounts/{id}/camera-access-log", s.requireAuth(s.handleCameraAccessLog))

	// Gateway signing-key rotation (keyrotation.go). Platform-admin only: it
	// replaces the key EVERY controller on this hub verifies against, so it is
	// not scoped to an account — there is one key and it is the hub's.
	mux.Handle("GET /v1/admin/gateway-key/rotation", s.requireAdmin(s.handleKeyRotationStatus))
	mux.Handle("GET /v1/admin/gateway-key/rotation/preview", s.requireAdmin(s.handleKeyRotationPreview))
	mux.Handle("POST /v1/admin/gateway-key/rotation", s.requireAdmin(s.handleKeyRotationStart))
	mux.Handle("POST /v1/admin/gateway-key/rotation/retry", s.requireAdmin(s.handleKeyRotationRetry))
	mux.Handle("POST /v1/devices", s.requireAuth(s.handleDeviceCreate))
	// proto/pairing.md's diagram specifies POST /pair/redeem — that's the path
	// the controller builds from its --gateway URL. Serve it there (spec form)
	// and keep the /api alias for existing callers.
	mux.HandleFunc("POST /pair/redeem", s.handlePairRedeem)
	mux.HandleFunc("POST /api/pair/redeem", s.handlePairRedeem)
	mux.HandleFunc("GET /api/controller/ws", s.handleControllerWS)
	mux.HandleFunc("POST /api/controller/challenge", s.handleControllerChallenge)
	mux.HandleFunc("POST /api/controller/poll", s.handleControllerPoll)
	mux.HandleFunc("POST /api/controller/ack", s.handleControllerAck)

	// chat channels.
	// Unauthenticated by design: each self-authenticates its provider signature
	// / secret token (fail-closed), then funnels opens through the SAME
	// store.LogAccess choke point + hub dispatch the /v1 open route uses.
	mux.HandleFunc("GET /webhooks/whatsapp", s.handleWhatsAppVerify)
	mux.HandleFunc("POST /webhooks/whatsapp", s.handleWhatsAppWebhook)
	mux.HandleFunc("POST /webhooks/slack", s.handleSlackEvents)
	mux.HandleFunc("POST /webhooks/slack/interactions", s.handleSlackInteractions)
	mux.HandleFunc("POST /webhooks/telegram", s.handleTelegramWebhook)

	// embedded portal seam — everything unmatched falls through to it
	mux.Handle("/", portal.Handler())

	return mux
}

// ---------------------------------------------------------------------------
// plumbing
// ---------------------------------------------------------------------------

type ctxKey int

const claimsKey ctxKey = 0

// requireAuth verifies the Bearer access token AND re-reads the user's LIVE
// status from the users row before letting the request through.
//
// Before this, only requireAdmin (adminops.go) did the live re-read — its
// own comment explains why: "the users row is re-read per request, so
// revocation is immediate and the JWT's adm claim is never trusted for
// gating." That discipline was not applied to ordinary auth, so a disabled
// user's still-signature-valid access token kept working for up to its
// full TTL (accessTTL, 15 minutes) after an admin disabled them — the
// finding this closes. The cost is one extra query per authenticated
// request (requireAdmin already pays it, and pays it TWICE now — once here
// and once for its own is_platform_admin check — a small, accepted
// redundancy on a self-hosted, requests-per-minute-not-per-second system).
func (s *Server) requireAuth(next http.HandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := r.Header.Get("Authorization")
		tok, ok := strings.CutPrefix(h, "Bearer ")
		if !ok || tok == "" {
			writeErr(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		claims, err := VerifyJWT(s.cfg.JWTSecret, tok)
		if err != nil {
			writeErr(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		u, err := s.store.UserByID(r.Context(), claims.Sub)
		if err != nil || u.Status != "active" {
			writeErr(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		next(w, r.WithContext(context.WithValue(r.Context(), claimsKey, claims)))
	})
}

// clientIP returns the TCP peer address (the host part of RemoteAddr) —
// NEVER a client-supplied header. X-Forwarded-For / X-Real-IP are
// deliberately not honored: this gateway has no configured trusted-proxy
// allowlist, and without one, trusting a client-controlled header would
// let an attacker mint a fresh "IP" on every request and defeat every
// per-IP throttle in authratelimit.go outright. A reverse-proxy deployment
// that wants per-real-client throttling needs a trusted-proxy config added
// first — using an unvalidated header here would be a worse regression
// than not supporting that deployment shape yet.
func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// authIPGate enforces an IP-scoped auth throttle (store.AuthRateLimitConfig)
// before a credential-endpoint handler does any real work. It writes the
// response itself on denial/error and returns false — callers just
// `if !s.authIPGate(...) { return }`, the same shape as this package's
// other gate helpers (memberRole, requireAccountAdmin, ...).
//
// Fails CLOSED on a counter-store error — see authratelimit.go's package
// doc comment for why this deliberately diverges from openpath.go's
// fail-open policy.
func (s *Server) authIPGate(w http.ResponseWriter, r *http.Request, scope string, limit int64) bool {
	ok, retry, err := s.store.CheckAuthRateLimit(r.Context(), scope, "ip:"+clientIP(r), limit, time.Now().Unix())
	if err != nil {
		s.log.Error("auth rate limit check failed", "scope", scope, "err", err)
		writeErr(w, http.StatusServiceUnavailable, "rate_limit_unavailable")
		return false
	}
	if !ok {
		w.Header().Set("Retry-After", strconv.FormatInt(retry, 10))
		writeErr(w, http.StatusTooManyRequests, "rate_limited")
		return false
	}
	return true
}

func claimsFrom(r *http.Request) *Claims {
	c, _ := r.Context().Value(claimsKey).(*Claims)
	return c
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, code string) {
	writeJSON(w, status, map[string]string{"error": code})
}

func readJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_json")
		return false
	}
	return true
}

// ---------------------------------------------------------------------------
// health + gateway key
// ---------------------------------------------------------------------------

// handleHealth keeps the GET /health shape the Workers backend had, so the
// hub picker (src/lib/hub.ts testGatewayUrl) can probe any hub: it reads
// {ok, env} and treats ok:false as an unhealthy DB. db_now proves the SQLite
// handle is live (the Workers version selected now() from Postgres). On a DB
// error this returns ok:false + 500, which is the shape the picker expects.
func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	dbNow, err := s.store.DBNow(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok": true, "env": s.cfg.Env, "db_now": dbNow, "version": s.cfg.Version,
	})
}

func (s *Server) handleGatewayKey(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"alg":        "ed25519",
		"public_key": s.keys.PublicKeyB64(),
	})
}
