package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
)

// Controller-originated events (proto/events.md). See
// migrations/0019_controller_events.sql for why this table exists — briefly:
// the controller's whole durability apparatus for these events terminated in
// a log line on the hub, so an offline grant redemption, the one open with no
// hub in the loop, left no record anywhere.
//
// Two things happen on arrival, in this order:
//
//  1. The signed envelope is stored verbatim, keyed by event_id. That key is
//     the dedupe events.md promises: a replay collides and is dropped.
//  2. For the kinds that describe a PHYSICAL ACCESS OUTCOME, an access_logs
//     row is appended so the event appears in the audit view operators
//     actually read, and is covered by the tamper-evident hash chain.
//
// Step 2 is deliberately not "every kind". `boot` is real and worth keeping,
// but it is not an access event and putting it in the access log would dilute
// the one view a resident manager scans after an incident.

// SourceOfflineGrant marks an access_logs row that came from a controller
// event rather than a hub-dispatched command.
//
// Deliberately NOT added to httpapi's opSources: a client must never be able
// to claim its open was an offline grant redemption. Only a controller
// signature can produce this source, which is the entire point of the
// distinction — these rows are the ones no hub authorised.
const SourceOfflineGrant = "offline_grant"

// ControllerEvent is one verified, controller-signed event.
//
// The signature has ALREADY been checked against the enrolled device key by
// the caller (hub.VerifyFromController, fail-closed, before routing) — this
// layer stores evidence, it does not decide authenticity.
type ControllerEvent struct {
	EventID  string
	DeviceID string
	Kind     string
	TS       int64
	Data     map[string]any
	Sig      string
	Envelope []byte // exact signed bytes
}

// accessKinds are the event kinds that describe a gate physically opening, or
// failing to. These get an audit row in addition to the raw record.
//
// grant_redeemed is the authorisation ("this signed grant was accepted") and
// opened is the actuation ("the relay moved"). They are separate events on
// purpose: the controller writes the first BEFORE pulsing and the second
// after, so seeing a grant_redeemed with no matching opened is meaningful —
// it means the gate was authorised and then did not move.
var accessKinds = map[string]string{
	"grant_redeemed": "open",
	"opened":         "open",
	"denied":         "open",
}

// RecordControllerEvent stores a verified controller event and, for access
// kinds, appends the corresponding audit row.
//
// Returns stored=false when the event_id was already present. That is the
// dedupe path and is NOT an error: events.md's delivery model is at-least-
// once with no ack, so a redelivery is expected behaviour, and the correct
// response is to do nothing quietly rather than to log a second open.
func (s *Store) RecordControllerEvent(ctx context.Context, ev ControllerEvent) (stored bool, logID string, err error) {
	if ev.EventID == "" {
		return false, "", fmt.Errorf("controller event with no event_id")
	}
	if ev.DeviceID == "" {
		return false, "", fmt.Errorf("controller event with no device_id")
	}

	// Cheap pre-check so a redelivery does not append an audit row before the
	// insert below discovers the collision. The authoritative guard is still
	// the PRIMARY KEY — this is ordering, not trust.
	var seen int
	switch err := s.db.QueryRowContext(ctx,
		`SELECT 1 FROM controller_events WHERE event_id = ?`, ev.EventID).Scan(&seen); {
	case err == nil:
		return false, "", nil
	case errors.Is(err, sql.ErrNoRows):
	default:
		return false, "", err
	}

	data := ev.Data
	if data == nil {
		data = map[string]any{}
	}
	dataJSON, err := json.Marshal(data)
	if err != nil {
		return false, "", err
	}

	// The INSERT is the CLAIM, and it comes first.
	//
	// The audit row used to be appended before it, so the event row could carry
	// its id in one statement. Under two concurrent redeliveries of one event
	// that appended an audit row EACH: measured at six concurrent calls, one
	// controller_events row and six access_logs rows — six opens in the
	// tamper-evident trail for one gate movement. The pre-check above narrows
	// the window and cannot close it, which its own comment says ("ordering,
	// not trust").
	//
	// Insert first and the PRIMARY KEY decides the winner atomically. Everyone
	// else sees zero rows affected and appends nothing.
	//
	// The cost is that the event row's access_log_id is filled by an UPDATE a
	// moment later, so a reader between the two sees an event with no audit
	// pointer. That state is already normal here — a device with no access
	// point stores its raw event and no audit row at all — and it is the
	// better failure: an event without its audit row under-reports one open in
	// a log that still holds the raw signed evidence, where the old order
	// over-reported opens that never happened.
	res, err := s.db.ExecContext(ctx,
		`INSERT INTO controller_events
		   (event_id, device_id, device_id_snapshot, kind, ts, data, sig, envelope, received_at, access_log_id)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
		 ON CONFLICT(event_id) DO NOTHING`,
		ev.EventID, nullable(ev.DeviceID), ev.DeviceID, ev.Kind, ev.TS,
		string(dataJSON), ev.Sig, string(ev.Envelope), now())
	if err != nil {
		return false, "", err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return false, "", err
	}
	if n == 0 {
		// A redelivery. Nothing further happens, and in particular no audit row.
		return false, "", nil
	}

	if cmd, ok := accessKinds[ev.Kind]; ok {
		logID, err = s.appendEventAuditRow(ctx, ev, cmd)
		if err != nil {
			return false, "", err
		}
		if logID != "" {
			if _, err := s.db.ExecContext(ctx,
				`UPDATE controller_events SET access_log_id = ? WHERE event_id = ?`,
				logID, ev.EventID); err != nil {
				return false, "", err
			}
		}
	}
	return true, logID, nil
}

// appendEventAuditRow maps an access-kind event onto the audit log.
//
// The access point is resolved from the device (access_points.device_id), not
// from anything inside the event: the payload is controller-supplied, and a
// controller must not be able to write audit rows against an access point it
// does not drive. A device with no access point still gets its raw event
// stored — the evidence is kept even when it cannot be placed.
func (s *Store) appendEventAuditRow(ctx context.Context, ev ControllerEvent, command string) (string, error) {
	var apID, locID, acctID string
	err := s.db.QueryRowContext(ctx,
		`SELECT ap.id, ap.location_id, l.account_id
		   FROM access_points ap
		   JOIN locations l ON l.id = ap.location_id
		  WHERE ap.device_id = ?
		  ORDER BY ap.created_at LIMIT 1`, ev.DeviceID).Scan(&apID, &locID, &acctID)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		return "", nil // unplaced device: raw event still stored
	case err != nil:
		return "", err
	}

	success := ev.Kind != "denied"
	reason := ""
	if !success {
		if r, ok := ev.Data["reason"].(string); ok {
			reason = r
		} else {
			reason = "denied"
		}
	}

	return s.InsertAccessLog(ctx, AccessLog{
		AccessPointID: apID,
		LocationID:    locID,
		AccountID:     acctID,
		// No UserID: an offline grant is redeemed by whoever holds it, and
		// the controller has no way to know which member that was. Claiming
		// one would be a guess written into an append-only audit log.
		Command: command,
		Source:  SourceOfflineGrant,
		Success: success,
		Error:   reason,
		TS:      ev.TS,
	})
}

// DeviceAccountID resolves which account owns a device, via its location.
//
// Used to authorise reads of that device's controller events: the events are
// audit evidence about one account's gates, and a device id is guessable.
func (s *Store) DeviceAccountID(ctx context.Context, deviceID string) (string, error) {
	var acct string
	err := s.db.QueryRowContext(ctx,
		`SELECT l.account_id FROM devices d
		   JOIN locations l ON l.id = d.location_id
		  WHERE d.id = ?`, deviceID).Scan(&acct)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	return acct, err
}

// ControllerEventsByDevice lists stored events for a device, newest first,
// ordered by the HUB's receive clock rather than the controller's ts (which
// events.md documents as unreliable after a power cut on a device with no RTC).
func (s *Store) ControllerEventsByDevice(ctx context.Context, deviceID string, limit int) ([]ControllerEvent, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT event_id, device_id_snapshot, kind, ts, data, sig, envelope
		   FROM controller_events WHERE device_id_snapshot = ?
		  ORDER BY received_at DESC, event_id DESC LIMIT ?`, deviceID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []ControllerEvent
	for rows.Next() {
		var ev ControllerEvent
		var dataJSON, envelope string
		if err := rows.Scan(&ev.EventID, &ev.DeviceID, &ev.Kind, &ev.TS, &dataJSON, &ev.Sig, &envelope); err != nil {
			return nil, err
		}
		ev.Envelope = []byte(envelope)
		if err := json.Unmarshal([]byte(dataJSON), &ev.Data); err != nil {
			ev.Data = map[string]any{}
		}
		out = append(out, ev)
	}
	return out, rows.Err()
}

// OrphanedControllerAuditRows returns access_logs rows that claim to have come
// from a controller and have no signed event behind them.
//
// # What this answers that the hash chain cannot
//
// The chain proves nobody edited a row. It cannot say whether the row should
// ever have been written — a bug upstream produces entries that verify
// perfectly, because nobody did edit them. That is not hypothetical here:
// RecordControllerEvent once appended the audit row before claiming the event
// id, so concurrent redeliveries of ONE controller event wrote one row each.
// Six opens in the chain for one movement of one gate, all six hashing
// correctly, five of them orphans.
//
// Every audit row with source `offline_grant` is written in exactly one place
// (appendEventAuditRow) and is pointed at by the controller_events row that
// caused it. So an orphan is a row with no signed evidence behind it, which is
// the signature of that bug and of anything else that writes to this log
// without going through the event path.
//
// # Why it is not a chain break
//
// An orphan is not tampering and must not be reported as such. The row is
// intact, the chain over it is intact, and what is missing is the evidence
// BESIDE it. Answering "is this log intact" and "does this log describe things
// that happened" are different questions, and conflating them would make a
// verify-audit failure mean two very different things.
func (s *Store) OrphanedControllerAuditRows(ctx context.Context) ([]string, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT a.id FROM access_logs a
		  WHERE a.source = ?
		    AND NOT EXISTS (
		          SELECT 1 FROM controller_events e WHERE e.access_log_id = a.id)
		  ORDER BY a.rowid ASC`, SourceOfflineGrant)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}
