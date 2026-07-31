package store

// What actuation configuration a controller reported it is actually running.
//
// See migrations/0026_controller_config_reports.sql for why this is its own
// table and not merged with anything holding outbound config: what the hub SENT
// and what a controller is RUNNING are different facts, and the whole point of
// the feature is that they can differ. Code that read one and reported the other
// would make the hub confidently wrong about a gate.
//
// Nothing here authorises anything. It is display data.

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
)

// ErrConfigReportInvalid — the payload is not valid JSON, so it is refused
// rather than stored. The column is read back and rendered; a row that cannot be
// parsed would surface as a broken console screen far from here, with nothing
// pointing at the write that caused it.
var ErrConfigReportInvalid = errors.New("store: config report payload is not valid JSON")

// ConfigReport is one controller's last reported configuration.
type ConfigReport struct {
	DeviceID string
	// Config is the report's `config` object verbatim, so a key the hub has
	// never heard of survives to be shown rather than being dropped on the way
	// in. Values are {"value":N,"source":"config"|"default"}.
	Config     json.RawMessage
	Firmware   string
	ReportedAt int64 // the controller's clock, from the signed message
	ReceivedAt int64 // the hub's clock, when it arrived
}

// SaveConfigReport records a controller's reported configuration, replacing any
// previous one.
//
// Last-write-wins: a configuration is a state, and the question is always what
// it is now. reportedAt is the controller's own clock and is stored as given —
// not clamped to the hub's — because a controller whose clock is wrong should be
// diagnosable, and silently rewriting its timestamp to something plausible is
// how that stops being visible.
func (s *Store) SaveConfigReport(ctx context.Context, deviceID string, config json.RawMessage, firmware string, reportedAt int64) error {
	if !json.Valid(config) {
		return ErrConfigReportInvalid
	}
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO controller_config_reports
		   (device_id, config, firmware, reported_at, received_at)
		 VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT (device_id) DO UPDATE SET
		     config      = excluded.config,
		     firmware    = excluded.firmware,
		     reported_at = excluded.reported_at,
		     received_at = excluded.received_at`,
		deviceID, string(config), firmware, reportedAt, now())
	return err
}

// ConfigReportFor returns a device's last reported configuration.
//
// ErrNotFound means the controller has never reported — a real and reportable
// state, and NOT the same as "running the defaults". Every controller predating
// ctl.report sends none, so anything rendering this must say "not reported yet"
// rather than filling in the firmware defaults it would be guessing at.
func (s *Store) ConfigReportFor(ctx context.Context, deviceID string) (ConfigReport, error) {
	var r ConfigReport
	var cfg string
	err := s.db.QueryRowContext(ctx,
		`SELECT device_id, config, firmware, reported_at, received_at
		   FROM controller_config_reports WHERE device_id = ?`, deviceID).
		Scan(&r.DeviceID, &cfg, &r.Firmware, &r.ReportedAt, &r.ReceivedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return ConfigReport{}, ErrNotFound
	}
	if err != nil {
		return ConfigReport{}, err
	}
	r.Config = json.RawMessage(cfg)
	return r, nil
}
