package energy

import (
	"context"
	"database/sql"
	"math"
	"os"
	"path/filepath"
	"sort"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

// The tests run against the REAL migration set, applied in order from
// internal/store/migrations, rather than against a hand-written schema. A
// migration that composes with everything a test invented but not with the
// baseline is a migration that fails on first deploy and nowhere else.
func openTestDB(t *testing.T) *sql.DB {
	t.Helper()
	path := filepath.Join(t.TempDir(), "energy_test.db")
	db, err := sql.Open("sqlite",
		"file:"+path+"?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)")
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { db.Close() })

	names, err := filepath.Glob(filepath.Join("..", "store", "migrations", "*.sql"))
	if err != nil {
		t.Fatalf("glob migrations: %v", err)
	}
	if len(names) == 0 {
		t.Fatal("no migrations found")
	}
	sort.Strings(names)
	for _, n := range names {
		body, err := os.ReadFile(n)
		if err != nil {
			t.Fatalf("read %s: %v", n, err)
		}
		if _, err := db.Exec(string(body)); err != nil {
			t.Fatalf("apply %s: %v", filepath.Base(n), err)
		}
	}
	return db
}

func newAccount(t *testing.T, db *sql.DB, id string) string {
	t.Helper()
	now := time.Now().Unix()
	if _, err := db.Exec(
		`INSERT INTO accounts (id, name, country_code, status, created_at, updated_at)
		 VALUES (?,?,'ZA','active',?,?)`, id, id, now, now); err != nil {
		t.Fatalf("create account: %v", err)
	}
	return id
}

func newStore(t *testing.T, opts ...Option) (*Store, string, context.Context) {
	t.Helper()
	db := openTestDB(t)
	acc := newAccount(t, db, "acct-1")
	return NewStore(db, opts...), acc, context.Background()
}

// base is a fixed instant on an hour boundary in UTC, so every bucket
// assertion below is arithmetic rather than wall-clock luck.
var base = time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC)

func counterChannel(t *testing.T, s *Store, acc, dev string, mutate func(*Channel)) Channel {
	t.Helper()
	c := Channel{
		DeviceKey:           dev,
		Metric:              "kwh",
		Kind:                KindCounter,
		Source:              SourceGrid,
		Flow:                FlowSupply,
		Scale:               1,
		IntervalSeconds:     900,
		GapToleranceSeconds: 1800,
		Enabled:             true,
	}
	if mutate != nil {
		mutate(&c)
	}
	if err := s.UpsertChannel(context.Background(), acc, c); err != nil {
		t.Fatalf("UpsertChannel: %v", err)
	}
	return c
}

func sampleAt(dev, metric string, offset time.Duration, v float64) Sample {
	return Sample{
		DeviceKey: dev,
		Metric:    metric,
		At:        base.Add(offset),
		Value:     v,
		HasValue:  true,
		AtSource:  AtSourceDevice,
	}
}

func mustIngest(t *testing.T, s *Store, acc string, samples ...Sample) IngestResult {
	t.Helper()
	res, err := s.Ingest(context.Background(), acc, samples)
	if err != nil {
		t.Fatalf("Ingest: %v", err)
	}
	return res
}

func mustRollup(t *testing.T, s *Store, acc string) RollupResult {
	t.Helper()
	res, err := s.Rollup(context.Background(), acc, 0)
	if err != nil {
		t.Fatalf("Rollup: %v", err)
	}
	return res
}

// hours returns the dense hour series for one channel over n hours from base.
func hours(t *testing.T, s *Store, acc, dev string, n int) []Bucket {
	t.Helper()
	out, err := s.Series(context.Background(), acc, SeriesQuery{
		DeviceKey: dev, Grain: GrainHour,
		From: base, To: base.Add(time.Duration(n) * time.Hour),
	})
	if err != nil {
		t.Fatalf("Series: %v", err)
	}
	if len(out) != n {
		t.Fatalf("expected %d dense hour buckets, got %d", n, len(out))
	}
	return out
}

func deltaRows(t *testing.T, s *Store, acc, dev, metric string) []Delta {
	t.Helper()
	rows, err := s.db.QueryContext(context.Background(), `
		SELECT from_at, to_at, kwh, quality, spans_gap, from_value, to_value
		FROM energy_deltas WHERE account_id = ? AND device_key = ? AND metric = ?
		ORDER BY to_at`, acc, dev, metric)
	if err != nil {
		t.Fatalf("query deltas: %v", err)
	}
	defer rows.Close()
	var out []Delta
	for rows.Next() {
		var d Delta
		var from, to int64
		var q string
		var spans int
		if err := rows.Scan(&from, &to, &d.KWh, &q, &spans, &d.FromValue, &d.ToValue); err != nil {
			t.Fatalf("scan delta: %v", err)
		}
		d.From, d.To = time.Unix(from, 0).UTC(), time.Unix(to, 0).UTC()
		d.Quality, d.SpansGap = DeltaQuality(q), spans != 0
		out = append(out, d)
	}
	return out
}

func approx(t *testing.T, got, want float64, what string) {
	t.Helper()
	if math.Abs(got-want) > 1e-6 {
		t.Errorf("%s: got %v, want %v", what, got, want)
	}
}

func wantKWh(t *testing.T, b Bucket, want float64) {
	t.Helper()
	if b.KWh == nil {
		t.Fatalf("bucket %s: KWh is nil, wanted %v", b.Start.Format(time.RFC3339), want)
	}
	approx(t, *b.KWh, want, "bucket "+b.Start.Format(time.RFC3339)+" kwh")
}

func wantNilKWh(t *testing.T, b Bucket) {
	t.Helper()
	if b.KWh != nil {
		t.Errorf("bucket %s: KWh is %v, wanted nil — an unobserved period must not present as a number",
			b.Start.Format(time.RFC3339), *b.KWh)
	}
}

func wantQuality(t *testing.T, b Bucket, want Quality) {
	t.Helper()
	if b.Quality != want {
		t.Errorf("bucket %s: quality %q, want %q", b.Start.Format(time.RFC3339), b.Quality, want)
	}
}
