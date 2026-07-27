package channels

// Discord outbound — the REST half of the rail (send.go owns the other
// providers' senders; this lives with the rest of Discord so the rail is one
// set of files). Same contract as every other sender: an interface so the
// httpapi handlers inject a recording fake in tests, and a real
// implementation that NO-OPS honestly (ok:false, a "…_unset" error) when its
// credential is unconfigured, so a half-configured install logs its replies
// instead of crashing.

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
)

// DiscordSender sends replies and acknowledges component taps.
type DiscordSender interface {
	// SendText posts a plain message to a channel.
	SendText(ctx context.Context, channelID, content string) SendResult
	// SendComponents posts a message carrying components (the gate picker).
	SendComponents(ctx context.Context, channelID, content string, components []DiscordComponent) SendResult
	// AckComponent acknowledges a component interaction without changing the
	// message — the Discord twin of Telegram's AnswerCallback.
	//
	// It exists because Discord DROPS an interaction that is not acknowledged
	// within ~3 seconds, which is shorter than an open may honestly take (the
	// device ack timeout alone is 5s). Acknowledging first and replying after
	// keeps the tap from expiring without ever claiming the gate moved.
	AckComponent(ctx context.Context, interactionID, interactionToken string) SendResult
}

// HTTPDiscordSender is the real implementation, against the official Bot API.
//
// Authentication is ALWAYS the bot scheme ("Authorization: Bot <token>").
// There is no user-token mode: driving a user account as a bot is ToS-banned,
// the same class of unofficial client send.go's WhatsApp engine block refuses
// to make implicit.
type HTTPDiscordSender struct {
	BotToken string
	// APIBase overrides the versioned REST base for tests. Never for
	// production credentials.
	APIBase string
	Client  *http.Client
}

func (s *HTTPDiscordSender) base() string {
	if s.APIBase != "" {
		return strings.TrimRight(s.APIBase, "/")
	}
	return DiscordAPIBase
}

func (s *HTTPDiscordSender) SendText(ctx context.Context, channelID, content string) SendResult {
	return s.createMessage(ctx, channelID, map[string]any{"content": DiscordContent(content)})
}

func (s *HTTPDiscordSender) SendComponents(ctx context.Context, channelID, content string, components []DiscordComponent) SendResult {
	return s.createMessage(ctx, channelID, map[string]any{
		"content": DiscordContent(content), "components": components,
	})
}

// createMessage POSTs /channels/{id}/messages.
func (s *HTTPDiscordSender) createMessage(ctx context.Context, channelID string, payload map[string]any) SendResult {
	if s.BotToken == "" {
		return SendResult{Error: "discord_token_unset"}
	}
	if channelID == "" {
		return SendResult{Error: "discord_channel_unset"}
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return SendResult{Error: err.Error()}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.base()+"/channels/"+channelID+"/messages", bytes.NewReader(body))
	if err != nil {
		return SendResult{Error: err.Error()}
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bot "+s.BotToken)
	res, err := orDefaultClient(s.Client).Do(req)
	if err != nil {
		return SendResult{Error: err.Error()}
	}
	defer res.Body.Close()
	var out struct {
		ID      string `json:"id"`
		Message string `json:"message"`
	}
	_ = json.NewDecoder(res.Body).Decode(&out)
	if res.StatusCode/100 != 2 {
		if out.Message != "" {
			return SendResult{Error: out.Message}
		}
		return SendResult{Error: "http_" + strconv.Itoa(res.StatusCode)}
	}
	return SendResult{OK: true, ProviderMessageID: out.ID}
}

// AckComponent POSTs /interactions/{id}/{token}/callback with the
// deferred-update type.
//
// The interaction TOKEN is a credential and it travels in the URL PATH, which
// is why this method never surfaces the request URL: a transport error from
// net/http embeds the URL it was dialling, so returning err.Error() here would
// write the token into an outbound-message log row. A fixed reason code is
// returned instead. (createMessage above may safely surface its error: its URL
// carries only a channel id.) No Authorization header is sent — the token in
// the path is what authorizes this call.
func (s *HTTPDiscordSender) AckComponent(ctx context.Context, interactionID, interactionToken string) SendResult {
	if interactionID == "" || interactionToken == "" {
		return SendResult{Error: "discord_interaction_unset"}
	}
	body, err := json.Marshal(map[string]any{"type": discordCallbackDeferredUpdate})
	if err != nil {
		return SendResult{Error: "discord_interaction_ack_failed"}
	}
	url := s.base() + "/interactions/" + interactionID + "/" + interactionToken + "/callback"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return SendResult{Error: "discord_interaction_ack_failed"}
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := orDefaultClient(s.Client).Do(req)
	if err != nil {
		return SendResult{Error: "discord_interaction_ack_failed"}
	}
	defer res.Body.Close()
	if res.StatusCode/100 != 2 {
		return SendResult{Error: "discord_interaction_ack_http_" + strconv.Itoa(res.StatusCode)}
	}
	return SendResult{OK: true}
}
