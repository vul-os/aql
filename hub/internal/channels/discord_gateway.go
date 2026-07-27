package channels

// The Discord Gateway connection — this rail's DialChannel (channels.go).
//
// Shape, and why it is this shape: Slack Socket Mode (socketmode.go) set the
// precedent — dial OUT, receive over the held-open socket, feed the payloads
// into the SAME handlers a webhook would have reached. Discord's Gateway is
// the same class of thing with a longer protocol, so this file follows
// socketmode.go's structure exactly (SocketConn for the transport so tests
// inject a fake, OpenConn/Dial seams, Run's capped reconnect backoff) and adds
// only what Discord genuinely requires on top:
//
//   - IDENTIFY (op 2) with the bot token and an intents bitfield;
//   - HEARTBEAT (op 1) at the interval the SERVER dictates in HELLO — never a
//     number we chose — carrying the last sequence seen, and a zombie check:
//     a heartbeat that was never ACKed means the socket is dead even though
//     the read is still blocked, so the connection is dropped and rebuilt;
//   - RESUME (op 6) against the resume_gateway_url READY handed us, so a drop
//     replays the missed dispatches instead of losing them.
//
// TRANSPORT. github.com/coder/websocket, the hub's existing WebSocket
// dependency and the one socketmode.go already dials with — nothing new is
// introduced, and SocketConn/dialWebsocket are reused rather than re-declared.
//
// CONCURRENCY. Reads happen on one goroutine that hands frames to the serve
// loop; every WRITE (identify, resume, heartbeat) happens on the serve loop
// itself. So there is exactly one writer and one reader, which is the property
// socketmode.go gets for free by being single-goroutine and which a
// server-timed heartbeat makes non-trivial. Handle is called INLINE from the
// serve loop, so a handler that blocks for longer than the heartbeat interval
// (~41s in practice; the open path's own ceiling is the 5s device ack timeout)
// would stall heartbeats — the same coupling socketmode.go has, stated so it
// is a known bound rather than a surprise.
//
// FAIL CLOSED. A frame that does not decode, a HELLO that is missing or
// malformed, a HELLO arriving mid-session: none of these are guessed at. The
// connection is dropped and rebuilt, and nothing is dispatched. A frame this
// rail does not recognise (an opcode or an event it never asked for) is
// ignored rather than interpreted.
//
// CREDENTIALS. The bot token is sent in the IDENTIFY/RESUME payload and in the
// REST Authorization header, and appears in NO log line and NO error string —
// including the ones this file builds for a rejected connection. Discord does
// not put it in the Gateway URL (unlike Telegram's Bot API), so a dial error
// carrying the URL leaks nothing.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/coder/websocket"
)

var _ DialChannel = (*Discord)(nil)

// Gateway intent bits this rail asks for.
const (
	// discordIntentGuildMessages delivers MESSAGE_CREATE in servers.
	discordIntentGuildMessages = 1 << 9
	// discordIntentDirectMessages delivers MESSAGE_CREATE in DMs with the bot.
	discordIntentDirectMessages = 1 << 12
	// discordIntentMessageContent makes `content` non-empty. It is a
	// PRIVILEGED intent: it must be enabled for the application in Discord's
	// developer portal, or Discord closes the connection with 4014. Without
	// content there is no command to read, so this rail cannot work without
	// it — and Run says so explicitly rather than reconnecting forever.
	discordIntentMessageContent = 1 << 15
)

// DiscordDefaultIntents is what Discord.Run identifies with when Intents is
// left zero: messages in guilds and DMs, plus their content.
const DiscordDefaultIntents = discordIntentGuildMessages | discordIntentDirectMessages | discordIntentMessageContent

// Discord is the dial-out channel value (channels.DialChannel).
type Discord struct {
	// BotToken authenticates the bot ("Authorization: Bot <token>"). Empty =
	// the channel is disabled, fail-closed.
	BotToken string
	// Intents is the gateway intents bitfield; zero means
	// DiscordDefaultIntents.
	Intents int

	// Handle processes one dispatch this rail asked for. eventType is
	// DiscordEventMessageCreate or DiscordEventInteractionCreate; data is the
	// raw `d` payload. Set by the httpapi layer exactly as SocketMode.Handle
	// is, and bound to the SAME shared open path — it may deliver an intent,
	// it never decides whether a gate may open.
	Handle func(ctx context.Context, eventType string, data json.RawMessage)

	// OpenConn obtains the Gateway URL (default: GET /gateway/bot).
	OpenConn func(ctx context.Context) (string, error)
	// Dial opens the WebSocket (default: coder/websocket, shared with
	// socketmode.go).
	Dial func(ctx context.Context, url string) (SocketConn, error)

	// APIBase overrides the REST base for tests. Never for production.
	APIBase string
	Client  *http.Client
	Logger  *slog.Logger
	// ReconnectMin is the backoff floor (default 1s, matches SocketMode/DMTAP).
	ReconnectMin time.Duration
	// FirstBeatFraction is the fraction of the server's heartbeat interval to
	// wait before the FIRST heartbeat (default 0.5). Discord asks clients to
	// jitter this so a fleet of bots reconnecting together does not beat in
	// lockstep; one self-hosted hub is not a fleet, so a fixed fraction is
	// enough and keeps the tests deterministic.
	FirstBeatFraction float64
}

// Kind identifies this as the Discord rail.
func (*Discord) Kind() string { return KindDiscord }

// Enabled reports whether a bot token is configured. Fail-closed: the zero
// value is disabled, and StartChannels will not launch it.
func (d *Discord) Enabled() bool { return d.BotToken != "" }

func (d *Discord) log() *slog.Logger {
	if d.Logger != nil {
		return d.Logger
	}
	return slog.Default()
}

func (d *Discord) reconnectMin() time.Duration {
	if d.ReconnectMin > 0 {
		return d.ReconnectMin
	}
	return time.Second
}

func (d *Discord) intents() int {
	if d.Intents != 0 {
		return d.Intents
	}
	return DiscordDefaultIntents
}

func (d *Discord) apiBase() string {
	if d.APIBase != "" {
		return strings.TrimRight(d.APIBase, "/")
	}
	return DiscordAPIBase
}

// Recoverable end-of-connection signals. None of them carry the token.
var (
	errDiscordReconnect      = errors.New("discord: gateway asked us to reconnect")
	errDiscordInvalidSession = errors.New("discord: gateway invalidated the session")
	errDiscordNoHello        = errors.New("discord: first frame was not hello")
	errDiscordBadHello       = errors.New("discord: hello carried no usable heartbeat interval")
	errDiscordMidHello       = errors.New("discord: hello arrived mid-session")
	errDiscordZombie         = errors.New("discord: heartbeat was never acknowledged")
	errDiscordDisabled       = errors.New("discord: no bot token configured")
)

// discordSession is what survives one connection so the next can RESUME:
// the session id, the URL to resume against, and the last sequence seen.
// Zeroing it forces a fresh IDENTIFY.
type discordSession struct {
	id        string
	resumeURL string
	seq       int64
	haveSeq   bool
}

// Run maintains the Gateway connection until ctx is cancelled, reconnecting
// with the same capped backoff SocketMode.Run and DMTAP.Run use, and resuming
// where it can. Launched in its own goroutine by StartChannels.
//
// It STOPS, loudly, on a rejection that reconnecting cannot fix — a refused
// token or an intent the application was never granted. Retrying those forever
// would hammer Discord with a credential it has already refused and bury the
// one message the operator needs in a reconnect loop.
func (d *Discord) Run(ctx context.Context) {
	if !d.Enabled() {
		return
	}
	backoff := d.reconnectMin()
	var sess discordSession
	for {
		if ctx.Err() != nil {
			return
		}
		err := d.connectOnce(ctx, &sess)
		if ctx.Err() != nil {
			return
		}
		if fatal := discordFatalClose(err); fatal != "" {
			d.log().Error("discord gateway rejected the connection; not reconnecting", "reason", fatal)
			return
		}
		if err != nil {
			d.log().Warn("discord gateway disconnected", "err", err, "retry_in", backoff)
			if !sleepCtx(ctx, backoff) {
				return
			}
			if backoff < 30*time.Second {
				backoff *= 2
			}
			continue
		}
		backoff = d.reconnectMin()
		if !sleepCtx(ctx, d.reconnectMin()) {
			return
		}
	}
}

// connectOnce opens one connection — resuming when a session survives, else
// discovering a fresh Gateway URL — and serves it until it ends.
func (d *Discord) connectOnce(ctx context.Context, sess *discordSession) error {
	url := ""
	if sess.id != "" && sess.resumeURL != "" {
		url = sess.resumeURL
	} else {
		openConn := d.OpenConn
		if openConn == nil {
			openConn = d.openViaDiscord
		}
		u, err := openConn(ctx)
		if err != nil {
			return err
		}
		url = u
	}
	dial := d.Dial
	if dial == nil {
		dial = dialWebsocket
	}
	conn, err := dial(ctx, discordGatewayURL(url))
	if err != nil {
		return err
	}
	defer conn.Close()
	return d.serve(ctx, conn, sess)
}

// serve runs one established connection: hello → identify/resume → heartbeat +
// dispatch, until the connection ends. sess is updated in place so the next
// attempt can resume.
func (d *Discord) serve(ctx context.Context, conn SocketConn, sess *discordSession) error {
	readCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	frames := make(chan []byte)
	readErr := make(chan error, 1)
	go func() {
		for {
			raw, err := conn.Read(readCtx)
			if err != nil {
				readErr <- err
				return
			}
			select {
			case frames <- raw:
			case <-readCtx.Done():
				return
			}
		}
	}()

	// HELLO must be the first frame, and it dictates the heartbeat interval.
	// Anything else here is refused rather than defaulted: a made-up interval
	// is how a connection silently becomes a zombie.
	var hello discordFrame
	select {
	case raw := <-frames:
		f, err := parseDiscordFrame(raw)
		if err != nil {
			return err
		}
		hello = f
	case err := <-readErr:
		return err
	case <-ctx.Done():
		return ctx.Err()
	}
	if hello.Op != discordOpHello {
		return errDiscordNoHello
	}
	var helloData struct {
		HeartbeatIntervalMS int64 `json:"heartbeat_interval"`
	}
	if err := json.Unmarshal(hello.D, &helloData); err != nil || helloData.HeartbeatIntervalMS <= 0 {
		return errDiscordBadHello
	}
	interval := time.Duration(helloData.HeartbeatIntervalMS) * time.Millisecond

	resuming := sess.id != ""
	if resuming {
		if err := d.send(ctx, conn, discordOpResume, map[string]any{
			"token": d.BotToken, "session_id": sess.id, "seq": sess.seq,
		}); err != nil {
			return err
		}
	} else if err := d.send(ctx, conn, discordOpIdentify, map[string]any{
		"token":   d.BotToken,
		"intents": d.intents(),
		"properties": map[string]any{
			"os": "linux", "browser": "aql-gateway", "device": "aql-gateway",
		},
	}); err != nil {
		return err
	}

	beat := time.NewTimer(d.firstBeatDelay(interval))
	defer beat.Stop()
	awaitingACK := false

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case err := <-readErr:
			return err
		case <-beat.C:
			// A heartbeat that was never ACKed means the connection is a
			// zombie: reads can stay blocked indefinitely on a socket the
			// other end has stopped serving. Drop it and rebuild.
			if awaitingACK {
				return errDiscordZombie
			}
			if err := d.sendHeartbeat(ctx, conn, sess); err != nil {
				return err
			}
			awaitingACK = true
			beat.Reset(interval)
		case raw := <-frames:
			f, err := parseDiscordFrame(raw)
			if err != nil {
				return err // fail closed: an undecodable frame ends the connection
			}
			switch f.Op {
			case discordOpDispatch:
				if f.S != nil {
					sess.seq, sess.haveSeq = *f.S, true
				}
				switch f.T {
				case discordEventReady:
					var ready struct {
						SessionID        string `json:"session_id"`
						ResumeGatewayURL string `json:"resume_gateway_url"`
					}
					if err := json.Unmarshal(f.D, &ready); err != nil || ready.SessionID == "" {
						// No session id means nothing to resume with later.
						// Refuse rather than pretend the session is live.
						return errDiscordBadHello
					}
					sess.id, sess.resumeURL = ready.SessionID, ready.ResumeGatewayURL
					d.log().Info("discord gateway connected")
				case discordEventResumed:
					d.log().Info("discord gateway resumed", "seq", sess.seq)
				case DiscordEventMessageCreate, DiscordEventInteractionCreate:
					if d.Handle != nil {
						d.Handle(ctx, f.T, f.D)
					}
				}
			case discordOpHeartbeat:
				// The server may ask for a beat out of band; answer at once.
				if err := d.sendHeartbeat(ctx, conn, sess); err != nil {
					return err
				}
				awaitingACK = true
				beat.Reset(interval)
			case discordOpHeartbeatACK:
				awaitingACK = false
			case discordOpReconnect:
				return errDiscordReconnect // session kept: the next attempt resumes
			case discordOpInvalidSession:
				var resumable bool
				if err := json.Unmarshal(f.D, &resumable); err != nil || !resumable {
					*sess = discordSession{} // force a fresh IDENTIFY
				}
				return errDiscordInvalidSession
			case discordOpHello:
				return errDiscordMidHello // fail closed on a protocol violation
			default:
				// Unknown opcodes are ignored (forward-compatible), exactly as
				// socketmode.go ignores unknown envelope types.
			}
		}
	}
}

// firstBeatDelay is how long to wait before the first heartbeat.
func (d *Discord) firstBeatDelay(interval time.Duration) time.Duration {
	f := d.FirstBeatFraction
	if f <= 0 || f > 1 {
		f = 0.5
	}
	return time.Duration(float64(interval) * f)
}

// sendHeartbeat sends op 1 carrying the last sequence seen (null before the
// first dispatch, which is what Discord expects).
func (d *Discord) sendHeartbeat(ctx context.Context, conn SocketConn, sess *discordSession) error {
	if !sess.haveSeq {
		return d.send(ctx, conn, discordOpHeartbeat, nil)
	}
	return d.send(ctx, conn, discordOpHeartbeat, sess.seq)
}

// send writes one op-coded frame. Every write in this file goes through here,
// and every one of them happens on the serve goroutine — one writer, always.
func (d *Discord) send(ctx context.Context, conn SocketConn, op int, data any) error {
	raw, err := json.Marshal(map[string]any{"op": op, "d": data})
	if err != nil {
		return err
	}
	return conn.Write(ctx, raw)
}

// parseDiscordFrame decodes one Gateway frame. An undecodable frame is an
// error, never a best guess.
func parseDiscordFrame(raw []byte) (discordFrame, error) {
	var f discordFrame
	if err := json.Unmarshal(raw, &f); err != nil {
		return discordFrame{}, err
	}
	return f, nil
}

// discordGatewayURL pins the version and encoding onto a Gateway URL. Any
// query Discord already put there is replaced, so the version this client
// speaks is never decided by the server's URL.
func discordGatewayURL(base string) string {
	if i := strings.IndexByte(base, '?'); i >= 0 {
		base = base[:i]
	}
	return base + "?v=" + DiscordAPIVersion + "&encoding=json"
}

// openViaDiscord asks the REST API where to dial (GET /gateway/bot, which also
// proves the token is accepted before a socket is opened).
//
// The token rides in the Authorization header and appears in no error this
// function returns — a status code and Discord's own message are all that is
// surfaced.
func (d *Discord) openViaDiscord(ctx context.Context) (string, error) {
	if !d.Enabled() {
		return "", errDiscordDisabled
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, d.apiBase()+"/gateway/bot", nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bot "+d.BotToken)
	res, err := orDefaultClient(d.Client).Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	var out struct {
		URL     string `json:"url"`
		Message string `json:"message"`
	}
	_ = json.NewDecoder(res.Body).Decode(&out)
	if res.StatusCode/100 != 2 {
		if res.StatusCode == http.StatusUnauthorized {
			return "", errors.New("discord: gateway/bot rejected the bot token (check DISCORD_BOT_TOKEN)")
		}
		if out.Message != "" {
			return "", fmt.Errorf("discord: gateway/bot http %d: %s", res.StatusCode, out.Message)
		}
		return "", errors.New("discord: gateway/bot http " + strconv.Itoa(res.StatusCode))
	}
	if out.URL == "" {
		return "", errors.New("discord: gateway/bot returned no url")
	}
	return out.URL, nil
}

// discordFatalClose names a close code that reconnecting cannot fix, or ""
// when the error is an ordinary drop worth retrying. The returned text is
// operator-facing and contains no credential.
func discordFatalClose(err error) string {
	if err == nil {
		return ""
	}
	switch websocket.CloseStatus(err) {
	case 4004:
		return "authentication failed — the bot token was refused (check DISCORD_BOT_TOKEN)"
	case 4010:
		return "invalid shard"
	case 4011:
		return "sharding required — this bot is in too many guilds for a single connection"
	case 4012:
		return "invalid API version"
	case 4013:
		return "invalid gateway intents"
	case 4014:
		return "disallowed gateway intents — enable the MESSAGE CONTENT intent for this application in Discord's developer portal; without it inbound messages arrive with no text and this rail cannot read a command"
	}
	return ""
}
