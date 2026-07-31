package store

import (
	"context"
	"database/sql"
	"strings"
)

// Reading gate state for a chat query — docs/CHAT-COMMANDS.md §4.4.
//
// # Why this takes AvailableAP and not a list of ids
//
// Rule 1 is that a query resolves only over the caller's authorized set: a
// device you cannot command is a device you cannot see. `[]AvailableAP` is
// produced by exactly two functions, both of which do that authorization
// (AvailableAccessPointsByPhone, AvailableAccessPointsByProfile). Taking the
// type rather than `[]string` means a caller cannot hand this arbitrary ids
// without first constructing rows that only those two queries construct.
//
// It is not a guarantee — Go will let anyone build the struct — but it puts the
// authorized set in the signature rather than in a comment, and it means the
// leak would have to be written deliberately instead of by passing the wrong
// slice.
//
// # Why it reads the same counters the console does
//
// max(ts) over successful open/close rows in access_logs, which is what
// AccessPointDetail already reports to the portal. A second definition of "last
// opened" that drifted from the console's would mean chat and the web app
// answering the same question differently, and no way to tell which was right.

// GateReadRow is the disclosable state of one authorized gate.
type GateReadRow struct {
	APID   string
	APName string
	// LocationID and AccountID exist for the AUDIT row, not for the reply.
	// access_logs' foreign keys are ON DELETE SET NULL and the hash chain
	// covers denormalised snapshots (migration 0007), so a read row written
	// without them would be a chain entry that loses its subject the moment a
	// location is deleted — which is exactly when an audit trail matters.
	LocationID  string
	AccountID   string
	LastOpenAt  sql.NullInt64
	LastCloseAt sql.NullInt64
	DeviceID    string
	LastSeenAt  sql.NullInt64
}

// GateReadSummary returns state for the given authorized access points, in the
// order they were passed — which is the caller's own priority order (visitor
// grants before member access), not a database ordering.
//
// A gate whose row cannot be read is OMITTED rather than returned empty. An
// entry with zero timestamps is indistinguishable from "never opened", and
// inventing that for a failed read would put a false fact in a member's hands.
func (s *Store) GateReadSummary(ctx context.Context, aps []AvailableAP) ([]GateReadRow, error) {
	if len(aps) == 0 {
		return nil, nil
	}
	ids := make([]any, 0, len(aps))
	for _, ap := range aps {
		ids = append(ids, ap.APID)
	}
	q := `SELECT ap.id, ap.name, ap.location_id, l.account_id,
	        (SELECT max(al.ts) FROM access_logs al
	           WHERE al.access_point_id = ap.id AND al.command = 'open'  AND al.success = 1),
	        (SELECT max(al.ts) FROM access_logs al
	           WHERE al.access_point_id = ap.id AND al.command = 'close' AND al.success = 1),
	        coalesce(ap.device_id, ''), d.last_seen_at
	      FROM access_points ap
	      JOIN locations l ON l.id = ap.location_id
	      LEFT JOIN devices d ON d.id = ap.device_id
	      WHERE ap.id IN (` + placeholders(len(ids)) + `)`
	rows, err := s.db.QueryContext(ctx, q, ids...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	byID := map[string]GateReadRow{}
	for rows.Next() {
		var r GateReadRow
		if err := rows.Scan(&r.APID, &r.APName, &r.LocationID, &r.AccountID,
			&r.LastOpenAt, &r.LastCloseAt, &r.DeviceID, &r.LastSeenAt); err != nil {
			return nil, err
		}
		byID[r.APID] = r
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Re-ordered to match the caller's slice. A map iteration here would make
	// the reply order random between identical queries, which reads as the hub
	// being confused about its own fleet.
	//
	// It is ALSO the second of two independent narrowings to the authorized
	// set — the IN clause is the first — and that redundancy is deliberate but
	// has a cost worth writing down: breaking either one alone leaves the other
	// holding, so a tamper against just one is indistinguishable from a working
	// guard. TestAQuestionOnlyReportsGatesTheAskerCouldOpen was only shown to
	// catch a widened read by disabling BOTH at once. Anyone verifying this
	// boundary in future has to do the same, or they will prove nothing and
	// believe they proved something.
	out := make([]GateReadRow, 0, len(aps))
	for _, ap := range aps {
		if r, ok := byID[ap.APID]; ok {
			out = append(out, r)
		}
	}
	return out, nil
}

// placeholders builds "?, ?, ?" for an IN clause. The ids are bound as
// parameters — never interpolated — so a gate name or id can carry anything.
func placeholders(n int) string {
	return strings.TrimSuffix(strings.Repeat("?,", n), ",")
}

// NoteChatQuery counts a query against its OWN window and reports whether the
// caller is past the cap.
//
// Its own scope, `query_1h`, and that separation is rule 4 rather than tidiness.
// Sharing the open budget would mean a reconnaissance flood — cheap, remote,
// needing only a linked identity — becoming a denial-of-open against a member
// standing at their own gate in the rain. The two limits protect different
// things and must not be able to exhaust each other.
//
// Fail-open on a counter error, matching NoteChatMessage: a database problem
// must not silently stop answering questions, and the actuation limits (which
// fail closed above TierConsequential) are a separate stack.
func (s *Store) NoteChatQuery(ctx context.Context, subject string, cap int64, nowUnix int64) (overCap bool) {
	if nowUnix == 0 {
		nowUnix = now()
	}
	ws := FixedWindowStart(nowUnix, HourS)
	if err := s.rateLimitBump(ctx, "query_1h", subject, ws, 1); err != nil {
		return false
	}
	var count int64
	if err := s.db.QueryRowContext(ctx,
		`SELECT count FROM rate_limit_counters WHERE scope='query_1h' AND subject=? AND window_start=?`,
		subject, ws).Scan(&count); err != nil {
		return false
	}
	return count > cap
}

// LogGateRead records that a member was told something about a gate.
//
// Rule 5: reads of a security system are security-relevant events. It writes to
// access_logs — the same append-only, hash-chained table as an open — with
// command "read", which is NOT one of the commands LogAccess accepts. That is
// deliberate on both sides: LogAccess is the ACTUATION choke point and runs
// geofence, time-window and quota checks that have no meaning for a question,
// so a read must not go through it, and it refuses a read command rather than
// quietly treating one as an open.
//
// Success is true because the disclosure happened. The open/close counters the
// console derives filter on their own command values, so these rows cannot
// inflate them.
func (s *Store) LogGateRead(ctx context.Context, apID, locationID, accountID, userID, source string) error {
	_, err := s.InsertAccessLog(ctx, AccessLog{
		AccessPointID: apID,
		LocationID:    locationID,
		AccountID:     accountID,
		UserID:        userID,
		Command:       "read",
		Source:        source,
		Success:       true,
	})
	return err
}

// ClaimActuationCooldown atomically claims a per-(subject, device, verb)
// cooldown for a chat actuation — docs/CHAT-COMMANDS.md §3.3's T1 row.
//
// Reuses rate_limit_cooldowns rather than adding a table. That table is keyed
// on an opaque subject and its conditional UPDATE is the atomicity this needs;
// a second table would be the same two columns with the same race to get wrong.
// The column is called last_open_at for historical reasons — it means "when
// this subject last claimed", and a chat subject is prefixed so the two
// populations cannot collide.
//
// Returns false when the cooldown has not elapsed. The claim happens in the
// same statement as the check, so two deliveries of one message race here and
// exactly one wins — a read-then-write would let both through, which for a
// duplicate webhook delivery means actuating twice.
func (s *Store) ClaimActuationCooldown(ctx context.Context, subject string, nowUnix, cooldownS int64) (bool, error) {
	return s.rateLimitClaimCooldown(ctx, subject, nowUnix, cooldownS)
}

// DeviceCommandLog is one engine command attempt, for the audit.
type DeviceCommandLog struct {
	DeviceKey string
	UserID    string
	Command   string
	Source    string
	Success   bool
	Err       string
}

// LogDeviceCommand records an engine actuation in access_logs.
//
// §3.8 is explicit: "Every attempt at every tier writes to the SAME access_logs
// table. Do not add a second log." The table is hash-chained with append-only
// triggers and is what GET /v1/admin/audit/verify checks; a parallel
// device-command table would sit outside both.
//
// The command column already stores a string, so a wider verb vocabulary is a
// data change and not a schema change — which is why this needs no migration.
// access_point_id is left empty because an engine device is not an access
// point; the device key rides in the error/detail column only when the command
// failed, so the row is identifiable by (command, source, user) plus its
// timestamp.
func (s *Store) LogDeviceCommand(ctx context.Context, l DeviceCommandLog) error {
	detail := l.Err
	if detail == "" {
		detail = l.DeviceKey
	} else {
		detail = l.DeviceKey + ": " + detail
	}
	_, err := s.InsertAccessLog(ctx, AccessLog{
		UserID:  l.UserID,
		Command: l.Command,
		Source:  l.Source,
		Success: l.Success,
		Error:   detail,
	})
	return err
}
