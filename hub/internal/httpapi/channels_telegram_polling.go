package httpapi

// Telegram long-polling — the httpapi half: it binds channels.TelegramPoller
// to the SAME dispatch the webhook route runs (processTGUpdate,
// channels_telegram.go) and to durable offset storage, exactly as
// SocketMode.Handle binds Slack's zero-ingress path to the Slack webhook
// handlers.
//
// Read channels/telegram_polling.go first: it carries the authenticity
// statement (polling has no per-request secret-token check; TLS to
// api.telegram.org plus the bot token replace it) and the offset design. This
// file only supplies the two things the poller cannot know: which function is
// the shared handler, and where the offset lives.

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"

	"github.com/vul-os/aql/hub/internal/channels"
	"github.com/vul-os/aql/hub/internal/store"
)

// telegramPollOffsetKey is the instance_settings key holding the next
// getUpdates offset. instance_settings is the store's existing durable KV (the
// admin-claim flag and the rate-limit overrides already live there), so this
// needs no schema of its own and inherits the same fsync'd SQLite file the
// access log is written to.
const telegramPollOffsetKey = "telegram_poll_offset"

// NewTelegramPoller builds the long-polling channel for this server. It is
// always safe to call: the returned poller reports Enabled() == false unless
// rawEngine is exactly the opt-in "polling" AND a bot token is configured, and
// StartChannels skips every DialChannel that is not Enabled(). rawEngine is
// the AQL_TELEGRAM_ENGINE value; unset/misspelled means webhook, so an
// upgrade changes nothing on its own.
//
// Wiring (one line each, in the two files this change deliberately does not
// touch):
//
//	// httpapi.Server.New, beside the Socket Mode block:
//	if p := s.NewTelegramPoller(os.Getenv("AQL_TELEGRAM_ENGINE")); p.Enabled() {
//	        s.dial = append(s.dial, p)
//	}
//
// StartChannels(ctx) then runs it in its own goroutine and cancelling ctx
// stops it — including an in-flight getUpdates.
func (s *Server) NewTelegramPoller(rawEngine string) *channels.TelegramPoller {
	return &channels.TelegramPoller{
		BotToken:   s.cfg.Channels.TelegramBotToken,
		Engine:     channels.ResolveTelegramEngine(rawEngine),
		Handle:     s.processTGUpdate,
		LoadOffset: s.telegramPollOffset,
		SaveOffset: s.setTelegramPollOffset,
		Logger:     s.log,
	}
}

// telegramPollOffset reads the persisted offset. "Never stored" is 0, not an
// error: on a first run Telegram sends the oldest update it still holds, so
// starting at 0 loses nothing. A genuine read error IS returned — the poller
// logs it rather than silently pretending the queue is fresh.
func (s *Server) telegramPollOffset(ctx context.Context) (int64, error) {
	raw, err := s.store.InstanceSettingGet(ctx, telegramPollOffsetKey)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) || errors.Is(err, store.ErrNotFound) {
			return 0, nil
		}
		return 0, err
	}
	var offset int64
	if err := json.Unmarshal(raw, &offset); err != nil {
		return 0, err
	}
	if offset < 0 {
		return 0, nil
	}
	return offset, nil
}

// setTelegramPollOffset persists the next offset. updated_by is the empty
// string: no human did this, and attributing a background loop to a user in
// the settings table would be a small lie in an audit surface.
func (s *Server) setTelegramPollOffset(ctx context.Context, offset int64) error {
	return s.store.InstanceSettingSet(ctx, telegramPollOffsetKey, offset, "")
}
