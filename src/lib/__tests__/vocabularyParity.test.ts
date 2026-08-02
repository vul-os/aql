import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Closed vocabularies must be the same set on both sides of the language border.
//
// This file started as one check about webhook events and grew to five, because
// the defect it found was never about webhooks: it is about a set the hub
// validates against and the console renders as a fixed choice, maintained twice
// by hand, in two languages, with no build step between them.
//
// # What was wrong
//
// Webhooks.tsx renders a fixed checkbox list, with a comment naming its source
// of truth: "the closed event vocabulary (hub's KnownWebhookEvents in
// webhookdispatch.go)". It listed two. The hub knew four.
//
// `automation.alert` was the older casualty — dispatchable since rules could
// raise alerts, and unsubscribable from the console for that entire time, so
// the only way to receive one was to call the API directly. `access.held_open`
// was about to join it.
//
// Neither side is at fault on its own, which is why nothing caught it: the hub
// validates against its own list and refuses an unknown name, and the console
// only ever sends names from its list, so every request either side saw was
// valid. The defect lives strictly in the gap — an event nobody can ask for.
//
// # Why this compares source text
//
// There is no build step that shares this vocabulary between Go and TypeScript,
// and inventing one for four strings would be a heavier commitment than the
// problem. Reading both lists is enough, and it fails loudly the moment they
// diverge, which is the property that was missing.

const root = join(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

/** The hub's closed vocabulary, from the constants KnownWebhookEvents returns. */
function hubEvents(): string[] {
  const src = read('hub/internal/httpapi/webhookdispatch.go');
  const consts = new Map<string, string>();
  for (const m of src.matchAll(/^\s*(Event[A-Za-z]+)\s*=\s*"([a-z._]+)"/gm)) {
    consts.set(m[1], m[2]);
  }
  const listed = src.match(/func KnownWebhookEvents\(\) \[\]string \{\s*return \[\]string\{([^}]*)\}/);
  if (!listed) throw new Error('KnownWebhookEvents not found — this guard cannot read the hub');
  return listed[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((name) => {
      const v = consts.get(name);
      if (!v) throw new Error(`KnownWebhookEvents names ${name}, which has no string constant`);
      return v;
    });
}

/** The console's checkbox list. */
function consoleEvents(): string[] {
  const src = read('src/pages/app/Webhooks.tsx');
  const block = src.match(/const EVENT_OPTIONS[^=]*=\s*\[([\s\S]*?)\n\];/);
  if (!block) throw new Error('EVENT_OPTIONS not found — this guard cannot read the console');
  return [...block[1].matchAll(/value:\s*'([a-z._]+)'/g)].map((m) => m[1]);
}

// The same shape, for the other closed vocabularies this product duplicates in
// TypeScript.
//
// Each of these is a set the hub validates against and the console renders as a
// fixed choice. They agree today — checked one by one before this was written,
// not assumed — and the webhook list also agreed until it quietly did not. What
// makes the failure invisible is identical in every case: the hub refuses names
// it does not know, the console only sends names it does know, so no request is
// ever wrong and the missing option is simply never offered.
//
// Sets are compared, not order. A vocabulary is a set; presentation order is
// the console's business.
const VOCABULARIES: Array<{
  name: string;
  goFile: string;
  goPattern: RegExp;
  tsFile: string;
  tsPattern: RegExp;
  min: number;
  /**
   * The SCHEMA, where one of these vocabularies is also a CHECK constraint.
   *
   * Two surfaces was the wrong count. A value the Go allowlist accepts and the
   * table refuses does not fail validation — it reaches the database and comes
   * back a constraint error, which is a 500 where a 400 belonged. A value the
   * table accepts that neither Go nor the console knows is data nothing can
   * render. Both directions are silent until someone tries the value.
   *
   * Only set where a CHECK actually exists; not every vocabulary is stored.
   */
  sqlFile?: string;
  sqlPattern?: RegExp;
}> = [
  {
    name: 'access point kinds',
    goFile: 'hub/internal/httpapi/access.go',
    goPattern: /var apKinds = map\[string\]bool\{([^}]*)\}/,
    tsFile: 'src/lib/api.ts',
    tsPattern: /kind: ('(?:gate|door|barrier|other)'(?:\s*\|\s*'[a-z]+')*);/,
    min: 4,
    sqlFile: 'hub/internal/store/migrations/0001_baseline.sql',
    sqlPattern: /kind\s+TEXT NOT NULL CHECK \(kind IN \(([^)]*)\)\)/,
  },
  {
    name: 'location types',
    goFile: 'hub/internal/store/migrations/0001_baseline.sql',
    goPattern: /type\s+TEXT NOT NULL CHECK \(type IN \(([^)]*)\)\)/,
    tsFile: 'src/components/locations/CreateLocationModal.tsx',
    tsPattern: /\(\[([^\]]*)\] as const\)\.map/,
    min: 4,
  },
  {
    name: 'api token scopes',
    goFile: 'hub/internal/store/tokens.go',
    goPattern: /((?:Scope\w+ APITokenScope = "[a-z:]+"\s*(?:\/\/[^\n]*\n\s*)*)+)/,
    tsFile: 'src/pages/app/ApiTokens.tsx',
    tsPattern: /const ALL_SCOPES: ApiTokenScope\[\] = \[([^\]]*)\]/,
    min: 2,
    sqlFile: 'hub/internal/store/migrations/0012_api_tokens.sql',
    sqlPattern: /scope\s+TEXT NOT NULL CHECK \(scope IN \(([^)]*)\)\)/,
  },
  {
    // Roles decide who may do what, and they were the one vocabulary here with
    // FOUR surfaces and no comparison between any of them: a Go allowlist, a
    // console union type, and the same CHECK written out twice in two
    // migrations. The second SQL copy is covered by the duplicate-CHECK test
    // below, since a pattern can only read one file.
    name: 'account roles',
    goFile: 'hub/internal/httpapi/accounts.go',
    goPattern: /roleValues\s*=\s*map\[string\]bool\{([^}]*)\}/,
    tsFile: 'src/lib/api.ts',
    tsPattern: /role: ('owner'(?:\s*\|\s*'[a-z]+')*);/,
    min: 4,
    sqlFile: 'hub/internal/store/migrations/0001_baseline.sql',
    sqlPattern: /role\s+TEXT NOT NULL CHECK \(role IN \(([^)]*)\)\)/,
  },
  {
    name: 'automation trigger kinds',
    goFile: 'hub/internal/automations/rule.go',
    goPattern: /((?:Trigger\w+ TriggerKind = "[a-z]+"\s*(?:\/\/[^\n]*\n\s*)*)+)/,
    tsFile: 'src/lib/api.ts',
    tsPattern: /export type AutomationTriggerKind = ([^;]*);/,
    min: 4,
  },
];

/** Every quoted lowercase token in a matched block, deduped. */
function tokens(src: string, pattern: RegExp, what: string): string[] {
  const m = src.match(pattern);
  if (!m) throw new Error(`${what}: pattern matched nothing — this guard cannot read it`);
  const found = [...m[1].matchAll(/["']([a-z][a-z:._]*)["']/g)].map((x) => x[1]);
  return [...new Set(found)].sort();
}

describe.each(VOCABULARIES)('$name are the same set on both sides', (v) => {
  it('agrees between the hub and the console', () => {
    const go = tokens(read(v.goFile), v.goPattern, `${v.name} (${v.goFile})`);
    const ts = tokens(read(v.tsFile), v.tsPattern, `${v.name} (${v.tsFile})`);

    // Floors, so two patterns that stop matching cannot agree about nothing.
    expect(go.length, `parsed ${go.length} from ${v.goFile}`).toBeGreaterThanOrEqual(v.min);
    expect(ts.length, `parsed ${ts.length} from ${v.tsFile}`).toBeGreaterThanOrEqual(v.min);

    expect(
      ts,
      `${v.name} differ. The hub (${v.goFile}) has [${go.join(', ')}] and the console
(${v.tsFile}) has [${ts.join(', ')}]. One side offers something the other refuses,
or hides something the other accepts — and neither side reports an error, because
each is internally consistent.`,
    ).toEqual(go);
  });

  it.runIf(v.sqlFile)('agrees with the schema that stores it', () => {
    const go = tokens(read(v.goFile), v.goPattern, `${v.name} (${v.goFile})`);
    const sql = tokens(read(v.sqlFile!), v.sqlPattern!, `${v.name} (${v.sqlFile})`);

    expect(sql.length, `parsed ${sql.length} from ${v.sqlFile}`).toBeGreaterThanOrEqual(v.min);
    expect(
      sql,
      `${v.name} differ between the hub and its own table. Go (${v.goFile}) has
[${go.join(', ')}]; the CHECK in ${v.sqlFile} has [${sql.join(', ')}]. A value Go
accepts and the table refuses is a 500 where a 400 belonged; a value the table
accepts that Go does not know is a row nothing can render.`,
    ).toEqual(go);
  });
});

// Every verb a user can ACTUATE has a control in the console.
//
// This one is not a plain set comparison, and the reason is the interesting
// part. The hub's catalogue has eighteen verbs; the console renders sixteen
// buttons. The two it does not render are `read` and `status`, and their
// absence is correct: both are TierRead, and the console already shows device
// state continuously, so a button whose effect is "fetch what is on the screen"
// would be noise.
//
// So the comparison is over verbs that are NOT read-tier — the ones a person
// presses, where an addition the console never learned about is a capability
// nobody can use. The exclusion is derived from the hub's own tier table rather
// than a hardcoded list of two, so a future read-tier verb is excluded for the
// same reason and a future ACTUATING verb is not excluded at all.
//
// The first version of this parse read the tier as the field immediately after
// Verb, which is only true for rows with no Arg — so `set` and `hold`, both
// plainly actuating, came back classified as read-only. The implausible answer
// is what exposed the pattern.
describe('device verbs', () => {
  it('every actuating verb has a console control', () => {
    const go = read('hub/internal/devices/capability.go');
    const names = new Map(
      [...go.matchAll(/(Verb\w+)\s+Verb = "([a-z]+)"/g)].map((m) => [m[1], m[2]]),
    );
    // Verb first, Tier anywhere later in the same row: Arg/Min/Max sit between
    // them on every row that takes an argument.
    const rows = [...go.matchAll(/\{Verb:\s*(Verb\w+)[^}]*?Tier:\s*(Tier\w+)/g)];
    expect(rows.length, 'parsed no capability rows').toBeGreaterThanOrEqual(20);

    const actuating = new Set<string>();
    const readOnly = new Set<string>();
    for (const [, verbConst, tier] of rows) {
      const v = names.get(verbConst);
      if (!v) continue;
      if (tier === 'TierRead') readOnly.add(v);
      else actuating.add(v);
    }
    for (const v of actuating) readOnly.delete(v);

    expect(actuating.size, 'no actuating verbs parsed').toBeGreaterThanOrEqual(10);
    expect(readOnly.size, 'no read-tier verbs parsed — the exclusion is doing nothing').toBeGreaterThan(0);

    const ts = read('src/components/device/engineState.ts');
    const table = ts.match(/CAP_CONTROLS[^=]*=\s*\{([\s\S]*?)\n\};/);
    if (!table) throw new Error('CAP_CONTROLS not found — this guard cannot read the console');
    const controls = new Set([...table[1].matchAll(/verb:\s*'([a-z]+)'/g)].map((m) => m[1]));
    expect(controls.size, 'no controls parsed').toBeGreaterThanOrEqual(10);

    const unreachable = [...actuating].filter((v) => !controls.has(v)).sort();
    expect(
      unreachable,
      `the engine accepts these verbs and the console offers no way to send them: ${unreachable.join(', ')}.
A verb with no control is a capability a driver can advertise, the tier table can
rank, and no user can reach — add it to CAP_CONTROLS in engineState.ts.`,
    ).toEqual([]);

    const invented = [...controls].filter((v) => !actuating.has(v) && !readOnly.has(v)).sort();
    expect(
      invented,
      `the console offers these and the hub's catalogue has no such verb: ${invented.join(', ')}.
The engine refuses an unknown verb, so the button is a guaranteed error.`,
    ).toEqual([]);
  });
});

describe('webhook event vocabulary', () => {
  it('is read from both sides at all', () => {
    // The guard on the guard: two regexes that stopped matching would agree
    // perfectly about nothing.
    expect(hubEvents().length, 'parsed no events from the hub').toBeGreaterThanOrEqual(3);
    expect(consoleEvents().length, 'parsed no events from the console').toBeGreaterThanOrEqual(3);
  });

  it('offers every event the hub can send', () => {
    const hub = hubEvents().sort();
    const ui = consoleEvents().sort();

    const missing = hub.filter((e) => !ui.includes(e));
    expect(
      missing,
      `the hub can send these and the console offers no way to subscribe: ${missing.join(', ')}.
An operator would have to call the API by hand to receive them. Add them to
EVENT_OPTIONS in src/pages/app/Webhooks.tsx with a hint saying when they fire.`,
    ).toEqual([]);

    const extra = ui.filter((e) => !hub.includes(e));
    expect(
      extra,
      `the console offers these and the hub does not know them: ${extra.join(', ')}.
Creating such a subscription is a hard 400 — the operator ticks a box and gets a
refusal they cannot act on.`,
    ).toEqual([]);
  });
});


describe('the schema a parity entry reads is the one the database uses', () => {
  // A sqlFile entry names ONE migration, and migrations supersede each other.
  //
  // SQLite cannot ALTER a CHECK, so this repo changes one by rebuilding: create
  // `<table>_next` with the new constraint, copy, DROP the original, rename.
  // 0029 does exactly that to automation_rules, which is why trigger_kind
  // appears with three values in 0010 and four in 0029 — not a drift, a
  // replacement.
  //
  // The trap that leaves is quiet. A parity entry pinned to 0001 keeps reading
  // 0001 after the table it describes has been rebuilt in 0031, and compares Go
  // against a definition the database dropped. It would pass, on dead schema,
  // for as long as the old text sat in the old file.
  it('no table a sqlPattern reads has been rebuilt in a later migration', () => {
    const files = execFileSync('git', ['ls-files', 'hub/internal/store/migrations/*.sql'], {
      cwd: root,
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean)
      .sort();

    const withSql = VOCABULARIES.filter((v) => v.sqlFile);
    expect(withSql.length, 'no vocabulary reads the schema — this check is moot')
      .toBeGreaterThanOrEqual(2);

    const stale: string[] = [];
    for (const v of withSql) {
      const text = read(v.sqlFile!);
      const m = v.sqlPattern!.exec(text);
      if (!m) throw new Error(`${v.name}: sqlPattern matched nothing in ${v.sqlFile}`);
      // The CREATE TABLE this CHECK sits inside.
      const before = text.slice(0, m.index);
      const table = [...before.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?([a-z_]+)/g)].pop()?.[1];
      if (!table) throw new Error(`${v.name}: no CREATE TABLE above the CHECK in ${v.sqlFile}`);

      for (const f of files.filter((f) => f > v.sqlFile!)) {
        const later = read(f);
        if (
          new RegExp(`DROP TABLE\\s+(?:IF EXISTS\\s+)?${table}\\b`).test(later) ||
          new RegExp(`RENAME TO\\s+${table}\\b`).test(later)
        ) {
          stale.push(`${v.name} reads ${table} from ${v.sqlFile}, but ${f} rebuilds it`);
        }
      }
    }
    expect(
      stale,
      'a parity entry is comparing Go against a CREATE TABLE the database has ' +
        'since replaced. Point sqlFile at the migration that rebuilt it.',
    ).toEqual([]);
  });
});

describe('a vocabulary written into several migrations stays one vocabulary', () => {
  // `role` is CHECKed in THREE places — 0001_baseline.sql once and
  // 0002_members_invites_settings.sql twice. The parity entry above reads one
  // file and one match, so the other two could drift with nothing noticing:
  // memberships would accept a role that invites refuse, or the reverse, and
  // each table would be internally consistent.
  //
  // Deliberately comparing the two SQL sites to EACH OTHER rather than adding
  // a second parity entry. The failure being guarded is that they disagree —
  // which side is right is a question for whoever made them differ.
  it('every role CHECK in every migration is the same set', () => {
    // Written to find its own sites rather than take a list. The first draft
    // named two files and compared one CHECK from each; tamper.sh refused the
    // edit as ambiguous because the text appears TWICE in 0002, which is how
    // the third site was found. A hand-maintained list of places a pattern
    // occurs is a list that goes stale the moment someone adds a table.
    const files = execFileSync('git', ['ls-files', 'hub/internal/store/migrations/*.sql'], {
      cwd: root,
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean);

    const sites: Array<{ where: string; roles: string[] }> = [];
    for (const f of files) {
      const text = read(f);
      for (const m of text.matchAll(/role\s+TEXT NOT NULL CHECK \(role IN \(([^)]*)\)\)/g)) {
        const roles = [...new Set([...m[1].matchAll(/'([a-z]+)'/g)].map((x) => x[1]))].sort();
        sites.push({ where: `${f}:${text.slice(0, m.index).split('\n').length}`, roles });
      }
    }

    expect(sites.length, 'no role CHECK found in any migration — the pattern has drifted')
      .toBeGreaterThanOrEqual(3);

    const first = sites[0];
    for (const site of sites.slice(1)) {
      expect(
        site.roles,
        `the role CHECK at ${site.where} [${site.roles.join(', ')}] differs from
${first.where} [${first.roles.join(', ')}]. One table would accept a role another
refuses, and each is internally consistent.`,
      ).toEqual(first.roles);
    }
  });
});

describe('deny reasons are the same set on all three surfaces', () => {
  /**
   * Three surfaces, one vocabulary — and until this test they disagreed.
   *
   * The open path records eleven deny reasons. The hub's audit filter accepted
   * four of them; the console's union type named three; the console's filter
   * offered those same three. Nobody was wrong in a way that errors: the store
   * query has always matched any reason string, so the seven missing ones were
   * recorded, indexed and queryable, and simply could not be asked for. That is
   * the exact shape this file exists to catch, and deny reasons were not on its
   * list.
   */

  /** store.DenyReasons, with constant references resolved to their values. */
  function hubDenyReasons(): string[] {
    const openpath = read('hub/internal/store/openpath.go');
    const m = /var DenyReasons = \[\]string\{([\s\S]*?)\n\}/.exec(openpath);
    if (!m) throw new Error('store.DenyReasons: pattern matched nothing — this guard cannot read it');
    // Strip comments first, or a reason named in prose counts as a member.
    const body = m[1].replace(/\/\/[^\n]*/g, '');

    const out: string[] = [];
    for (const line of body.split('\n')) {
      const quoted = /"([a-z_]+)"/.exec(line);
      if (quoted) {
        out.push(quoted[1]);
        continue;
      }
      const ident = /^\s*(Reason[A-Za-z]+),/.exec(line);
      if (!ident) continue;
      // Resolve `ReasonX = "x"` from the store package rather than trusting the
      // identifier's spelling to match its value.
      const pattern = new RegExp(`\\b${ident[1]}\\s*=\\s*"([a-z_]+)"`);
      const decl =
        pattern.exec(read('hub/internal/store/timewindows.go')) ??
        pattern.exec(read('hub/internal/store/geofence.go'));
      if (!decl) throw new Error(`${ident[1]} is in DenyReasons but declared nowhere this guard reads`);
      out.push(decl[1]);
    }
    return [...new Set(out)].sort();
  }

  /** The reasons the console's filter actually offers. */
  function consoleOfferedReasons(): string[] {
    const src = read('src/pages/app/admin/AdminAudit.tsx');
    const m = /const DENY_REASONS[\s\S]*?\n\];/.exec(src);
    if (!m) throw new Error('DENY_REASONS: pattern matched nothing — this guard cannot read it');
    return [...new Set([...m[0].matchAll(/kind: '([a-z_]+)'/g)].map((x) => x[1]))].sort();
  }

  /** AdminAuditKind, minus the five generic selectors that are not reasons. */
  function consoleTypedReasons(): string[] {
    const src = read('src/lib/api.ts');
    const m = /export type AdminAuditKind =([\s\S]*?);/.exec(src);
    if (!m) throw new Error('AdminAuditKind: pattern matched nothing — this guard cannot read it');
    const generic = new Set(['all', 'denied', 'success', 'open', 'close']);
    return [...new Set([...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]))]
      .filter((k) => !generic.has(k))
      .sort();
  }

  it('the hub, the console type and the console filter all list the same reasons', () => {
    const hub = hubDenyReasons();
    const typed = consoleTypedReasons();
    const offered = consoleOfferedReasons();

    // Floors, so three patterns that stop matching cannot agree about nothing.
    expect(hub.length, `parsed ${hub.length} from store.DenyReasons`).toBeGreaterThanOrEqual(11);
    expect(typed.length, `parsed ${typed.length} from AdminAuditKind`).toBeGreaterThanOrEqual(11);
    expect(offered.length, `parsed ${offered.length} from DENY_REASONS`).toBeGreaterThanOrEqual(11);

    expect(typed, 'AdminAuditKind does not match store.DenyReasons').toEqual(hub);
    expect(offered, 'the filter offers a different set than the type allows').toEqual(hub);
  });

  it('the audit filter accepts every reason the open path can record', () => {
    // The allowlist is built from store.DenyReasons, so this checks the wiring
    // rather than a copy: a future edit that hand-lists reasons here again
    // fails, which is how it got to four out of eleven.
    const adminops = read('hub/internal/httpapi/adminops.go');
    const m = /var auditKinds = func\(\) map\[string\]bool \{([\s\S]*?)\n\}\(\)/.exec(adminops);
    if (!m) throw new Error('auditKinds: pattern matched nothing — this guard cannot read it');
    expect(m[1], 'auditKinds must be built from store.DenyReasons, not re-typed').toContain(
      'store.DenyReasons',
    );
    // And the generic selectors are still there beside them.
    for (const generic of ['all', 'denied', 'success', 'open', 'close']) {
      expect(m[1], `auditKinds no longer accepts ${generic}`).toContain(`"${generic}"`);
    }
  });
});
