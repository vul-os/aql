package httpapi

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"net/http"
	"strings"

	"github.com/vul-os/aql/hub/internal/store"
)

// Webhook management.
//
// Admin-only, deliberately. A webhook is a standing instruction to POST a
// signed record of every gate opening to an address of the configurer's
// choosing, and — even with the SSRF guard — that is a reach into the network
// the hub sits on. A viewer or an ordinary member has no business creating one,
// and the role check is the same isAdminRole the rest of the account surface
// uses rather than a new notion of privilege.
//
// The secret is returned EXACTLY ONCE, in the 201. There is no endpoint that
// reveals it afterwards, because the store has no read path that selects it —
// see internal/store/webhooks.go. An operator who loses it deletes the webhook
// and makes another, which is the correct trade: a key that can be re-read is
// a key that can be exfiltrated.

type webhookCreateReq struct {
	Name         string   `json:"name"`
	URL          string   `json:"url"`
	Events       []string `json:"events"`
	AllowPrivate bool     `json:"allow_private"`
}

func webhookJSON(w store.Webhook) map[string]any {
	m := map[string]any{
		"id":            w.ID,
		"name":          w.Name,
		"url":           w.URL,
		"events":        w.Events,
		"allow_private": w.AllowPrivate,
		"enabled":       w.Enabled,
		"created_at":    w.CreatedAt,
	}
	// Only present when the dispatcher retired it, and then always with the
	// reason — an endpoint that went quiet without one leaves an operator
	// nothing to act on.
	if w.DisabledAt != 0 {
		m["disabled_at"] = w.DisabledAt
		m["disabled_reason"] = w.DisabledReason
	}
	return m
}

func (s *Server) handleWebhooksList(w http.ResponseWriter, r *http.Request) {
	accountID := r.PathValue("id")
	role, ok := s.memberRole(w, r, accountID)
	if !ok {
		return
	}
	if !isAdminRole(role) {
		writeErr(w, http.StatusForbidden, "forbidden")
		return
	}
	hooks, err := s.store.WebhooksForAccount(r.Context(), accountID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	out := make([]map[string]any, 0, len(hooks))
	for _, h := range hooks {
		out = append(out, webhookJSON(h))
	}
	writeJSON(w, http.StatusOK, map[string]any{"webhooks": out})
}

func (s *Server) handleWebhookCreate(w http.ResponseWriter, r *http.Request) {
	accountID := r.PathValue("id")
	role, ok := s.memberRole(w, r, accountID)
	if !ok {
		return
	}
	if !isAdminRole(role) {
		writeErr(w, http.StatusForbidden, "forbidden")
		return
	}
	var req webhookCreateReq
	if !readJSON(w, r, &req) {
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		writeErr(w, http.StatusBadRequest, "name_required")
		return
	}
	// Validate the target BEFORE anything is written. A refused URL must not
	// leave a half-made subscription behind.
	if _, err := validateWebhookURL(req.URL, req.AllowPrivate); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_url")
		return
	}
	if len(req.Events) == 0 {
		writeErr(w, http.StatusBadRequest, "events_required")
		return
	}
	for _, e := range req.Events {
		if !knownWebhookEvent(e) {
			// A closed vocabulary: an unknown name is a typo worth refusing,
			// not a subscription that silently never fires and leaves someone
			// wondering why their alerting is quiet.
			writeErr(w, http.StatusBadRequest, "unknown_event")
			return
		}
	}

	secret, err := newWebhookSecret()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	hook, err := s.store.CreateWebhook(r.Context(), store.CreateWebhookArgs{
		AccountID: accountID, Name: req.Name, URL: req.URL,
		Secret: secret, Events: req.Events, AllowPrivate: req.AllowPrivate,
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}

	out := webhookJSON(*hook)
	// The only time this value is ever returned. Documented at the call site
	// as well as in the store, because the temptation to add a "reveal"
	// endpoint later is exactly what this comment exists to argue against.
	out["secret"] = secret
	out["secret_note"] = "Shown once. It cannot be retrieved again — delete and recreate the webhook if you lose it."
	writeJSON(w, http.StatusCreated, out)
}

func (s *Server) handleWebhookDelete(w http.ResponseWriter, r *http.Request) {
	accountID := r.PathValue("id")
	role, ok := s.memberRole(w, r, accountID)
	if !ok {
		return
	}
	if !isAdminRole(role) {
		writeErr(w, http.StatusForbidden, "forbidden")
		return
	}
	err := s.store.DeleteWebhook(r.Context(), accountID, r.PathValue("webhookID"))
	if errors.Is(err, sql.ErrNoRows) {
		writeErr(w, http.StatusNotFound, "not_found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// newWebhookSecret returns 256 bits of hex. Long enough that an HMAC key is
// not the weak link, and generated here rather than accepted from the operator
// so a receiver's convenience cannot become a guessable signing key.
func newWebhookSecret() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
