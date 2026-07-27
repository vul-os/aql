package channels

// Telegram long-polling — the zero-ingress path for the Telegram rail, the
// same architectural move Slack Socket Mode (socketmode.go) already makes.
// Aql is installed at home: usually no static IP, very often behind CGNAT.
// A webhook needs a publicly reachable HTTPS URL that Telegram can POST to;
// getUpdates needs nothing but an outbound TLS connection to
// api.telegram.org. With this engine selected, WhatsApp Cloud API is the only
// rail left that genuinely requires ingress.
//
// TelegramPoller implements DialChannel (Kind/Enabled/Run) so it is a
// first-class channel alongside Socket Mode and DMTAP, not a Telegram-specific
// special case: StartChannels launches whichever DialChannels report Enabled().
//
// ---------------------------------------------------------------------------
// HOW INBOUND AUTHENTICITY IS ESTABLISHED — THIS IS A REAL CHANGE, NOT A
// DETAIL. READ IT BEFORE SELECTING THIS ENGINE.
// ---------------------------------------------------------------------------
//
// The webhook path authenticates every inbound request: Telegram sends the
// X-Telegram-Bot-Api-Secret-Token header and verifyTelegramSecret
// (channels.go) constant-time compares it against TELEGRAM_WEBHOOK_SECRET,
// refusing outright when the secret is unset. Anyone can POST to
// /webhooks/telegram; only a request carrying the shared secret is acted on.
//
// LONG-POLLING HAS NO REQUEST SIGNATURE AT ALL. There is no header to check
// and nothing to compare, because there is no inbound request: the gateway
// makes an OUTBOUND call and reads the response. What stands in for the
// secret-token check is therefore:
//
//  1. TLS to api.telegram.org — server-certificate validation is what proves
//     the bytes came from Telegram and not from something on the path. It is
//     the ONLY thing that proves it. This is why APIBase defaults to
//     https://api.telegram.org and why pointing it anywhere else (only tests
//     should) removes the entire authenticity story; Run logs a warning when
//     the configured base is not https.
//  2. The bot token in the URL path — this authenticates US to Telegram, and
//     scopes the response to this bot's update queue. It is a bearer
//     credential: anyone holding TELEGRAM_BOT_TOKEN can drain the same queue.
//
// So the trust root moves from "a shared secret we chose, checked per
// request" to "the public web PKI plus the bot token". That is the same trust
// root Socket Mode already relies on for Slack, and the same one the outbound
// sender (HTTPTelegramSender, send.go) has always relied on to send — but it
// is strictly different from what the webhook does on the way IN, and it must
// not be described as equivalent.
//
// Two consequences worth stating plainly:
//   - A compromised or misconfigured trust store, or a proxy that terminates
//     TLS, weakens inbound authenticity here in a way it does not on the
//     webhook path (where the secret token would still have to match).
//   - Conversely, nothing on the internet can reach this path at all. There is
//     no listener, so there is no unauthenticated request to reject, no
//     ingress to firewall and no URL to leak.
//
// ---------------------------------------------------------------------------
// EXACTLY-ONCE, AND WHAT SURVIVES A RESTART
// ---------------------------------------------------------------------------
//
// Telegram's getUpdates confirms by offset: passing offset=N marks every
// update with id < N as delivered, and Telegram will never send them again.
// Anything not yet confirmed is redelivered (Telegram holds updates ~24h), so
// a crash cannot silently lose an update.
//
// That alone leaves a window: an update handled just before a crash is
// unconfirmed (the confirmation only rides on the NEXT getUpdates call) and
// would be handled twice on restart. So the poller ALSO persists the offset
// through SaveOffset after each update is handled, and resumes from
// LoadOffset on start. The httpapi side backs those with the instance_settings
// table (see httpapi/channels_telegram_polling.go).
//
// The residual window is therefore exactly one update, and only on a crash
// between "handled" and "persisted" — the same at-least-once shape the webhook
// path already has, where Telegram redelivers any webhook that did not answer
// 2xx.
//
// DEDUPE HOLDS ACROSS AN ENGINE SWITCH, in both directions, because it is not
// this file's dedupe: message updates go through the SAME
// store.InsertInboundMessage the webhook path uses, whose uniqueness key is
// (channel, provider_message_id) with channel = "telegram". The engine is not
// part of the key. Flip AQL_TELEGRAM_ENGINE either way and a message
// already logged is still recognised as already logged.
//
// ---------------------------------------------------------------------------
// ONE HANDLER, NOT TWO
// ---------------------------------------------------------------------------
//
// Handle is fed the parsed update and must be the SAME dispatch the webhook
// route runs (httpapi.Server.processTGUpdate). This is deliberate and load
// bearing: identity resolution, the inbound dedupe, the verb/picker logic and
// the fail-closed GateVerb machinery (verb.go) all live behind that one
// function. A second copy of the open path is how the two drift and how one
// of them ends up missing a safety fix.
//
// Fail-closed parsing: an update whose JSON does not decode actuates NOTHING —
// it is consumed (so it cannot wedge the queue) and logged. The verb is never
// guessed here; this file does not know what a verb is.

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"
)

var _ DialChannel = (*TelegramPoller)(nil)

// ---------------------------------------------------------------------------
// Engine selection — webhook (default) vs opt-in polling
// ---------------------------------------------------------------------------

// TelegramEngine selects how inbound Telegram updates reach the gateway.
type TelegramEngine string

const (
	// TelegramEngineWebhook is the ingress path: Telegram POSTs to
	// /webhooks/telegram and every request is authenticated with the
	// X-Telegram-Bot-Api-Secret-Token header. DEFAULT — the only engine
	// ResolveTelegramEngine picks implicitly, so no existing install changes
	// behaviour on upgrade.
	TelegramEngineWebhook TelegramEngine = "webhook"
	// TelegramEnginePolling is the zero-ingress path: the gateway calls
	// getUpdates outbound. OPT-IN ONLY — see the authenticity block above for
	// what changes when it is selected.
	TelegramEnginePolling TelegramEngine = "polling"
)

// ResolveTelegramEngine turns the raw AQL_TELEGRAM_ENGINE env value into a
// TelegramEngine, mirroring ResolveWhatsAppEngine (send.go) exactly: fail
// closed toward the safe default. Unset, empty, misspelled, or any value other
// than the exact opt-in string "polling" (case-insensitive, trimmed) resolves
// to TelegramEngineWebhook. There is no auto-detect — a gateway does not
// quietly stop authenticating its inbound updates because a variable was
// fat-fingered.
func ResolveTelegramEngine(raw string) TelegramEngine {
	if strings.EqualFold(strings.TrimSpace(raw), string(TelegramEnginePolling)) {
		return TelegramEnginePolling
	}
	return TelegramEngineWebhook
}

// TelegramPollingAuthenticityNotice is the operator-facing line logged once at
// startup whenever the polling engine is selected. Not softened: an operator
// flipping this variable is changing how inbound authenticity is established,
// and the log is where that fact has to show up on the machine itself.
const TelegramPollingAuthenticityNotice = "AQL_TELEGRAM_ENGINE=polling selected: inbound Telegram updates are " +
	"fetched outbound via getUpdates and are NOT authenticated by the X-Telegram-Bot-Api-Secret-Token header the " +
	"webhook path checks per request. Authenticity now rests on TLS to api.telegram.org plus the bot token. In " +
	"exchange this rail needs no public URL and no inbound port, which is the point on a home connection behind " +
	"CGNAT."

// ---------------------------------------------------------------------------
// The poller
// ---------------------------------------------------------------------------

// telegramAPIBase is the real Bot API origin. TLS to this host is the whole of
// inbound authenticity on this engine (see the block above).
const telegramAPIBase = "https://api.telegram.org"

const (
	defaultTelegramPollTimeout = 30 * time.Second
	// telegramClientGrace is added to the long-poll timeout to size the HTTP
	// client deadline. It must be positive: a client timeout at or below the
	// server-side long-poll timeout would abort every single idle poll and turn
	// normal operation into a permanent error/backoff loop.
	telegramClientGrace       = 15 * time.Second
	defaultTelegramBackoffMin = time.Second
	defaultTelegramBackoffMax = 30 * time.Second
)

// TelegramPoller runs the outbound getUpdates loop. Configure BotToken, Engine,
// Handle (the shared webhook dispatch) and the offset persistence pair; the
// rest have working defaults.
//
// Fail-closed by construction: the zero value has Engine == "" which is not
// TelegramEnginePolling, so Enabled() is false and StartChannels will not run
// it. Polling is never something a forgotten field turns on.
type TelegramPoller struct {
	BotToken string
	// Engine must be exactly TelegramEnginePolling for this channel to run.
	// Build it with ResolveTelegramEngine.
	Engine TelegramEngine

	// Handle processes ONE parsed update. It must be the same function the
	// webhook route calls — see "ONE HANDLER, NOT TWO" above.
	Handle func(ctx context.Context, update *TGUpdate)

	// LoadOffset returns the last persisted offset (0 when none has ever been
	// stored: Telegram then sends the oldest update it still holds, so a first
	// run loses nothing). SaveOffset persists it after each handled update.
	// Both optional — with neither, the loop still runs correctly within a
	// process, relying on Telegram's own server-side confirmation, and only
	// loses the one-update crash window described above.
	LoadOffset func(ctx context.Context) (int64, error)
	SaveOffset func(ctx context.Context, offset int64) error

	// APIBase overrides the Bot API origin. TESTS ONLY — anything but
	// https://api.telegram.org removes the TLS authenticity this engine
	// depends on, and Run says so in the log.
	APIBase string

	// PollTimeout is the server-side long-poll hold (default 30s). The HTTP
	// client deadline is derived from it, never the other way round.
	PollTimeout time.Duration
	BackoffMin  time.Duration // error backoff floor (default 1s)
	BackoffMax  time.Duration // error backoff ceiling (default 30s)

	Client *http.Client
	Logger *slog.Logger

	clientOnce sync.Once
	client     *http.Client
}

// Kind identifies this as the Telegram channel — the same identity space and
// access_logs source the webhook path uses. The engine is a transport choice,
// never a different channel.
func (*TelegramPoller) Kind() string { return KindTelegram }

// Enabled reports whether long-polling should run. Fail-closed on three
// independent counts: the engine must be the exact opt-in value, a bot token
// must be configured (there is nothing to authenticate with otherwise), and a
// handler must be wired (a poll that drains Telegram's queue into nowhere
// would confirm updates no one ever saw — silent loss, which is worse than not
// running).
func (p *TelegramPoller) Enabled() bool {
	return p != nil && p.Engine == TelegramEnginePolling && p.BotToken != "" && p.Handle != nil
}

// Run polls until ctx is cancelled. Intended to be launched in its own
// goroutine by StartChannels; returns immediately when Enabled() is false.
//
// Shutdown: every request is built with http.NewRequestWithContext, so
// cancelling ctx aborts an in-flight getUpdates rather than waiting out its
// long-poll timeout, and every backoff sleep is ctx-aware. Cancelling ctx
// takes effect at once, never after up to PollTimeout.
func (p *TelegramPoller) Run(ctx context.Context) {
	if !p.Enabled() {
		return
	}
	p.log().Warn(TelegramPollingAuthenticityNotice)
	if base := p.apiBase(); !strings.HasPrefix(base, "https://") {
		p.log().Warn("telegram polling: API base is not https — inbound update authenticity is NOT established",
			"api_base", base)
	}

	offset := p.initialOffset(ctx)
	backoff := p.backoffMin()
	for {
		if ctx.Err() != nil {
			return
		}
		start := time.Now()
		next, n, err := p.pollOnce(ctx, offset)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			wait := backoff
			var ra retryAfterError
			if errors.As(err, &ra) && ra.after > 0 {
				wait = ra.after
			}
			p.log().Warn("telegram poll failed", "err", err, "retry_in", wait, "offset", offset)
			if !sleepCtx(ctx, wait) {
				return
			}
			if backoff < p.backoffMax() {
				backoff *= 2
				if backoff > p.backoffMax() {
					backoff = p.backoffMax()
				}
			}
			continue
		}
		offset = next
		backoff = p.backoffMin()
		// Anti-spin guard. A healthy getUpdates blocks server-side for
		// PollTimeout when idle, so the loop is naturally paced. A server that
		// answers "ok, nothing" instantly (a misconfigured proxy, a stub) would
		// otherwise spin a core; pace it at the backoff floor instead.
		if n == 0 && time.Since(start) < p.pollTimeout()/2 {
			if !sleepCtx(ctx, p.backoffMin()) {
				return
			}
		}
	}
}

// initialOffset resumes from the persisted offset. A load error is NOT fatal
// and NOT treated as zero silently: it is logged, and the loop starts from 0,
// which means Telegram replays whatever it still holds unconfirmed. Replay is
// recoverable (messages dedupe in the store); refusing to start is not.
func (p *TelegramPoller) initialOffset(ctx context.Context) int64 {
	if p.LoadOffset == nil {
		return 0
	}
	offset, err := p.LoadOffset(ctx)
	if err != nil {
		p.log().Warn("telegram poll: could not load stored offset, resuming from Telegram's own confirmation point", "err", err)
		return 0
	}
	if offset < 0 {
		return 0
	}
	return offset
}

// pollOnce runs one getUpdates and dispatches what it returns, in order.
// Returns the offset to use next and how many raw updates arrived.
//
// Ordering is deliberate: dispatch, THEN persist. The alternative (persist
// first) converts the one-update crash window from a possible replay into a
// certain loss — a resident's tap that actuates nothing. On a gate rail, a
// redelivered actuation the resident just asked for is the better failure,
// and for message updates it is not even visible: store.InsertInboundMessage
// recognises the redelivery and the handler returns without replying.
func (p *TelegramPoller) pollOnce(ctx context.Context, offset int64) (int64, int, error) {
	raws, err := p.getUpdates(ctx, offset)
	if err != nil {
		return offset, 0, err
	}
	next := offset
	advanced := false
	for _, raw := range raws {
		if ctx.Err() != nil {
			return next, len(raws), ctx.Err()
		}
		id, ok := telegramUpdateID(raw)
		if !ok {
			// No usable update_id: we cannot say where this sits in the queue,
			// so we neither actuate it nor claim to have consumed it.
			p.log().Warn("telegram poll: update carries no usable update_id; nothing actuated")
			continue
		}
		var u TGUpdate
		if err := json.Unmarshal(raw, &u); err != nil {
			// Malformed body, usable position. Consume it — leaving it
			// unconfirmed would wedge the queue behind a payload that can never
			// be parsed — but actuate NOTHING. No verb is inferred here.
			p.log().Warn("telegram poll: malformed update; nothing actuated", "update_id", id, "err", err)
		} else {
			p.Handle(ctx, &u)
		}
		if id >= next {
			next = id + 1
			advanced = true
		}
		p.persist(ctx, next)
	}
	if len(raws) > 0 && !advanced {
		// Every update in a non-empty batch lacked an id. Confirming nothing
		// means Telegram resends the same batch, so this would loop forever;
		// guessing a position would confirm updates we never read. Treat it as
		// a broken response: back off, keep the offset, stay loud.
		return offset, len(raws), errTelegramNoUsableUpdateID
	}
	return next, len(raws), nil
}

func (p *TelegramPoller) persist(ctx context.Context, offset int64) {
	if p.SaveOffset == nil {
		return
	}
	if err := p.SaveOffset(ctx, offset); err != nil && ctx.Err() == nil {
		// Telegram's own confirmation still advances on the next call, so this
		// degrades to "a crash here may replay", not to loss.
		p.log().Warn("telegram poll: could not persist offset", "offset", offset, "err", err)
	}
}

var errTelegramNoUsableUpdateID = errors.New("telegram getUpdates: batch carried no usable update_id")

// retryAfterError carries Telegram's own 429 parameters.retry_after, which is
// better information than our exponential guess.
type retryAfterError struct {
	after time.Duration
	msg   string
}

func (e retryAfterError) Error() string { return e.msg }

// telegramUpdateID pulls just update_id out of a raw update, so a payload this
// gateway cannot fully parse can still be positioned in the queue.
func telegramUpdateID(raw json.RawMessage) (int64, bool) {
	var probe struct {
		UpdateID *int64 `json:"update_id"`
	}
	if err := json.Unmarshal(raw, &probe); err != nil || probe.UpdateID == nil {
		return 0, false
	}
	return *probe.UpdateID, true
}

// getUpdates performs one long poll. allowed_updates is pinned to exactly what
// this gateway acts on; anything else Telegram might add later is never even
// delivered, which keeps a future update type from arriving as an unparsed
// blob that has to be reasoned about.
func (p *TelegramPoller) getUpdates(ctx context.Context, offset int64) ([]json.RawMessage, error) {
	if p.BotToken == "" {
		return nil, errors.New("telegram_token_unset")
	}
	payload, err := json.Marshal(map[string]any{
		"offset":          offset,
		"timeout":         int(p.pollTimeout() / time.Second),
		"allowed_updates": []string{"message", "callback_query"},
	})
	if err != nil {
		return nil, err
	}
	url := strings.TrimRight(p.apiBase(), "/") + "/bot" + p.BotToken + "/getUpdates"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := p.httpClient().Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	var out struct {
		OK          bool              `json:"ok"`
		Result      []json.RawMessage `json:"result"`
		Description string            `json:"description"`
		Parameters  struct {
			RetryAfter int `json:"retry_after"`
		} `json:"parameters"`
	}
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		return nil, fmt.Errorf("telegram getUpdates: %w", err)
	}
	if res.StatusCode/100 != 2 || !out.OK {
		msg := out.Description
		if msg == "" {
			msg = fmt.Sprintf("http_%d", res.StatusCode)
		}
		if out.Parameters.RetryAfter > 0 {
			return nil, retryAfterError{
				after: time.Duration(out.Parameters.RetryAfter) * time.Second,
				msg:   "telegram getUpdates: " + msg,
			}
		}
		return nil, errors.New("telegram getUpdates: " + msg)
	}
	return out.Result, nil
}

// ---------------------------------------------------------------------------
// defaults
// ---------------------------------------------------------------------------

func (p *TelegramPoller) apiBase() string {
	if p.APIBase != "" {
		return p.APIBase
	}
	return telegramAPIBase
}

func (p *TelegramPoller) pollTimeout() time.Duration {
	if p.PollTimeout > 0 {
		return p.PollTimeout
	}
	return defaultTelegramPollTimeout
}

func (p *TelegramPoller) backoffMin() time.Duration {
	if p.BackoffMin > 0 {
		return p.BackoffMin
	}
	return defaultTelegramBackoffMin
}

func (p *TelegramPoller) backoffMax() time.Duration {
	if p.BackoffMax > 0 {
		return p.BackoffMax
	}
	return defaultTelegramBackoffMax
}

// httpClient sizes its own deadline from the long-poll timeout. It does NOT
// use orDefaultClient (send.go): that client's 10s timeout is shorter than the
// 30s hold a long poll is supposed to sit in, so borrowing it would fail every
// idle poll.
func (p *TelegramPoller) httpClient() *http.Client {
	p.clientOnce.Do(func() {
		if p.Client != nil {
			p.client = p.Client
			return
		}
		p.client = &http.Client{Timeout: p.pollTimeout() + telegramClientGrace}
	})
	return p.client
}

func (p *TelegramPoller) log() *slog.Logger {
	if p.Logger != nil {
		return p.Logger
	}
	return slog.Default()
}
