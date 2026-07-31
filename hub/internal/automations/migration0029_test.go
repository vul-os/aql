package automations

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// Migration 0029 rebuilds automation_rules to widen the trigger_kind CHECK.
//
// # Why this test exists
//
// Every other migration in this repository is a CREATE TABLE, and a CREATE
// TABLE cannot lose data. 0029 is the first that COPIES: it builds a new table,
// moves every row across by name, drops the original and renames. The risk is
// entirely in the copy, and the copy is the one part a normal test run never
// executes — migrations apply to a fresh database, where the source table is
// empty and a wrong column mapping moves nothing wrongly because it moves
// nothing at all.
//
// So this loads the migration's own SQL and runs the rebuild against a table
// that HAS rows, which is the state every existing hub is in.

// rebuildStatements returns the copy-and-swap half of 0029, with table names
// redirected to a scratch copy so the test can run it against a database where
// the migration has already been applied.
//
// Reading the shipped file rather than restating the SQL is the point: a test
// carrying its own copy of the statements would keep passing after someone
// edited the migration, which is the only edit that could break it.
func rebuildStatements(t *testing.T) []string {
	t.Helper()
	path := filepath.Join("..", "store", "migrations", "0029_automation_clip_trigger.sql")
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read migration: %v", err)
	}
	// Strip comments; keep statements.
	var kept []string
	for _, line := range strings.Split(string(body), "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), "--") {
			continue
		}
		kept = append(kept, line)
	}
	sql := strings.Join(kept, "\n")

	// The scratch run reads the LIVE table and writes a copy, so the original
	// survives for comparison. Only the destination names are rewritten.
	sql = strings.ReplaceAll(sql, "automation_rules_next", "rebuild_probe")
	sql = strings.ReplaceAll(sql, "DROP TABLE automation_rules;", "")
	sql = strings.ReplaceAll(sql, "ALTER TABLE rebuild_probe RENAME TO automation_rules;", "")
	sql = regexp.MustCompile(`(?m)^CREATE INDEX.*$`).ReplaceAllString(sql, "")

	var out []string
	for _, s := range strings.Split(sql, ";") {
		if strings.TrimSpace(s) != "" {
			out = append(out, s)
		}
	}
	if len(out) != 2 {
		t.Fatalf("expected a CREATE and an INSERT…SELECT, parsed %d statements from the migration", len(out))
	}
	return out
}

func TestMigration0029CopiesEveryRuleFieldAcross(t *testing.T) {
	h := newHarness(t)

	// Rules with DIFFERENT values in every column that could be mixed up by a
	// mis-ordered copy: two text fields, several integers, and the scheduler
	// state that a rule mid-life carries.
	if _, err := h.eng.SaveRule(h.ctx, h.rule("evening lights",
		Trigger{Kind: TriggerSchedule, Schedule: &Schedule{MinuteOfDay: 1080, Days: EveryDay, TZ: "Africa/Johannesburg"}},
		Action{DeviceKey: "test:lamp-1", Verb: "on"})); err != nil {
		t.Fatalf("SaveRule: %v", err)
	}
	if _, err := h.eng.SaveRule(h.ctx, h.rule("tank low",
		Trigger{Kind: TriggerThreshold, Threshold: &Threshold{
			DeviceKey: "test:lamp-1", Metric: "level", Op: OpBelow, Value: 12.5}},
		Action{Notify: &Notify{Message: "the tank is low"}})); err != nil {
		t.Fatalf("SaveRule: %v", err)
	}
	// Every column must carry a value distinguishable from its DEFAULT, or a
	// column dropped from the copy list reads identically on both sides and the
	// comparison passes while data is lost. The first version of this test set
	// MinIntervalS through SaveRuleState, which does not write that column — so
	// the fixture stored 0, the rebuild defaulted to 0, and deleting the column
	// from the migration passed. Driven off the table's own columns rather than
	// a hand-written list, so a column added later is stamped automatically.
	stampEveryColumn(t, h)

	before := dumpRules(t, h, "automation_rules")
	if len(before) != 2 {
		t.Fatalf("fixture wrote %d rules, want 2 — the copy would be tested against nothing", len(before))
	}
	// The fixture must actually contain the values the copy could lose. A row
	// of zeroes and empty strings survives any column mapping.
	if strings.Contains(before[0], "=0 ") || strings.Contains(before[1], "=0 ") {
		t.Fatalf("a column is still at its default, so losing it would be invisible:\n%s",
			strings.Join(before, "\n"))
	}

	for _, stmt := range rebuildStatements(t) {
		if _, err := h.db.ExecContext(h.ctx, stmt); err != nil {
			t.Fatalf("migration statement failed: %v\n%s", err, stmt)
		}
	}

	after := dumpRules(t, h, "rebuild_probe")
	if len(after) != len(before) {
		t.Fatalf("rebuild moved %d rows, want %d", len(after), len(before))
	}
	for i := range before {
		if before[i] != after[i] {
			t.Errorf("rule %d changed in the rebuild:\n before %s\n  after %s", i, before[i], after[i])
		}
	}
}

// dumpRules renders every column of every rule as a stable string, ordered by
// id so the two sides compare positionally.
//
// Reads the column list from the table itself rather than naming columns: a
// column added to the rules table and forgotten in 0029's copy list is exactly
// the failure this is for, and a hand-written SELECT here would share the
// oversight.
func dumpRules(t *testing.T, h *harness, table string) []string {
	t.Helper()
	rows, err := h.db.QueryContext(h.ctx, `SELECT * FROM `+table+` ORDER BY id`)
	if err != nil {
		t.Fatalf("select %s: %v", table, err)
	}
	defer rows.Close()
	cols, err := rows.Columns()
	if err != nil {
		t.Fatalf("columns: %v", err)
	}
	if len(cols) < 15 {
		t.Fatalf("%s has %d columns — too few to be the rules table", table, len(cols))
	}
	var out []string
	for rows.Next() {
		vals := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			t.Fatalf("scan: %v", err)
		}
		var parts []string
		for i, c := range cols {
			parts = append(parts, c+"="+renderVal(vals[i]))
		}
		sort.Strings(parts)
		out = append(out, strings.Join(parts, " "))
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("rows: %v", err)
	}
	return out
}

func renderVal(v any) string {
	switch x := v.(type) {
	case nil:
		return "<null>"
	case []byte:
		return string(x)
	default:
		return strings.TrimSpace(strings.Join(strings.Fields(strings.ReplaceAll(
			strings.TrimSpace(sprint(x)), "\n", " ")), " "))
	}
}

func sprint(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case int64:
		return itoa(x)
	case float64:
		return trimFloat(x)
	}
	return "?"
}

func itoa(n int64) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var b []byte
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	if neg {
		return "-" + string(b)
	}
	return string(b)
}

func trimFloat(f float64) string {
	s := itoa(int64(f))
	if float64(int64(f)) == f {
		return s
	}
	return s + ".x"
}

// stampEveryColumn writes a distinctive value into every column of every rule.
//
// Skips the three that cannot take an arbitrary value: id and account_id are
// foreign keys the fixture depends on, and trigger_kind is the CHECK-closed
// vocabulary this migration exists to widen — all three already differ from
// their defaults anyway.
func stampEveryColumn(t *testing.T, h *harness) {
	t.Helper()
	skip := map[string]bool{"id": true, "account_id": true, "trigger_kind": true, "created_by": true}

	rows, err := h.db.QueryContext(h.ctx, `PRAGMA table_info(automation_rules)`)
	if err != nil {
		t.Fatalf("table_info: %v", err)
	}
	type col struct{ name, typ string }
	var cols []col
	for rows.Next() {
		var cid int
		var name, typ string
		var notnull int
		var dflt any
		var pk int
		if err := rows.Scan(&cid, &name, &typ, &notnull, &dflt, &pk); err != nil {
			rows.Close()
			t.Fatalf("scan table_info: %v", err)
		}
		if !skip[name] {
			cols = append(cols, col{name, strings.ToUpper(typ)})
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		t.Fatalf("table_info rows: %v", err)
	}
	if len(cols) < 12 {
		t.Fatalf("stamped only %d columns — table_info did not describe the rules table", len(cols))
	}

	var sets []string
	var args []any
	for i, c := range cols {
		sets = append(sets, c.name+" = ?")
		if c.typ == "INTEGER" {
			args = append(args, 900000+i)
		} else {
			args = append(args, "probe-"+c.name)
		}
	}
	res, err := h.db.ExecContext(h.ctx,
		`UPDATE automation_rules SET `+strings.Join(sets, ", "), args...)
	if err != nil {
		t.Fatalf("stamp: %v", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		t.Fatal("stamped no rows")
	}
}

// The rebuild's whole justification is that the database keeps enforcing the
// closed vocabulary. A rebuild that quietly dropped the CHECK would pass every
// test above — the rows would all copy correctly — while removing the guard the
// migration exists to preserve.
func TestTheTriggerVocabularyIsStillClosedAfterTheRebuild(t *testing.T) {
	h := newHarness(t)

	insert := func(kind string) error {
		_, err := h.db.ExecContext(h.ctx,
			`INSERT INTO automation_rules (id, account_id, name, trigger_kind, created_at, updated_at)
			 VALUES (?, ?, 'probe', ?, 1, 1)`,
			newID(), h.accountID, kind)
		return err
	}

	// The kind this migration added must be accepted, or the CHECK is now
	// narrower than the code and every clip rule fails to save.
	if err := insert("clip"); err != nil {
		t.Fatalf("the database refuses the kind 0029 added: %v", err)
	}
	// The kinds that were already there must still be accepted.
	for _, k := range []string{"schedule", "threshold", "event"} {
		if err := insert(k); err != nil {
			t.Errorf("the rebuild lost the kind %q: %v", k, err)
		}
	}
	// And the vocabulary must still be CLOSED. This is the half a rebuild can
	// silently drop: copying rows correctly into a table with no constraint
	// looks identical to copying them into one that has it.
	if err := insert("whatever-the-caller-felt-like"); err == nil {
		t.Error("the database accepted an unreviewed trigger kind — the CHECK did not survive the rebuild")
	}
}
