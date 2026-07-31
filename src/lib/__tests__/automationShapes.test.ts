import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Every field the hub can put in a rule, the console can read.
 *
 * # The gap this closes
 *
 * An automation action gained a third form — `notify` — and the console could
 * neither create one nor render one: every alert rule came back as
 * "undefined unnamed target". None of this repo's reachability guards fired,
 * and they were right not to. routeParity checks that every hub ROUTE has a
 * client; the api-method check that every client METHOD has a screen; the store
 * check that every store method has a caller. An action form adds no route and
 * no method. It was unreachable in a way nothing measured.
 *
 * The measurable thing is the WIRE: a `json:"…"` tag on the rule model is a
 * field the hub will send, and a client type that has never heard of it will
 * silently drop or mis-render it. So this reads the tags out of the Go and
 * requires each one to appear in the TypeScript that models the same object.
 *
 * # What it does NOT check
 *
 * That the field is rendered WELL, or at all — only that the type knows the
 * name. `verb` was present and typed as required when the hub had made it
 * optional, and this test would not have caught that; the honest type did,
 * once written, by failing to compile. Nor does it check the editor can produce
 * every shape: that is a UI question this cannot see. It catches the specific
 * failure of a field the console has never been told about.
 */

const root = resolve(__dirname, '../../..');

/** Struct → the Go file that declares it, and the client type modelling it. */
const MODELLED = [
  { struct: 'Trigger', goFile: 'hub/internal/automations/rule.go' },
  { struct: 'Threshold', goFile: 'hub/internal/automations/rule.go' },
  { struct: 'Event', goFile: 'hub/internal/automations/rule.go' },
  { struct: 'Condition', goFile: 'hub/internal/automations/rule.go' },
  { struct: 'Action', goFile: 'hub/internal/automations/rule.go' },
  { struct: 'Notify', goFile: 'hub/internal/automations/rule.go' },
];

/**
 * JSON tags declared on one Go struct.
 *
 * Reads from the `type X struct {` line to its closing brace at column zero,
 * so a nested anonymous struct cannot leak its tags into the parent's set and a
 * later struct cannot bleed into an earlier one.
 */
function jsonTags(goSource: string, structName: string): string[] {
  const start = goSource.indexOf(`type ${structName} struct {`);
  expect(start, `${structName} is no longer declared — update MODELLED`).toBeGreaterThan(-1);
  const end = goSource.indexOf('\n}', start);
  expect(end, `${structName} is unterminated`).toBeGreaterThan(start);
  const body = goSource.slice(start, end);
  return [...body.matchAll(/json:"([^",]+)/g)].map((m) => m[1]).filter((t) => t !== '-');
}

/**
 * Source with comments removed.
 *
 * Not tidiness: this test's first version searched whole files for the tag as a
 * SUBSTRING, and every tamper passed. `notify` survived deleting the field
 * because the word remained in a doc comment and in `rule?.action.notify`. A
 * guard that matches prose is a guard that checks nothing — which is the exact
 * failure it was written to prevent, one level up.
 */
function code(src: string): string {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, '');
  return noBlock
    .split('\n')
    .map((line) => {
      const i = line.indexOf('//');
      return i >= 0 ? line.slice(0, i) : line;
    })
    .join('\n');
}

/**
 * Whether `name` appears as an object KEY — `notify:` or `notify?:` — rather
 * than anywhere at all. A field is modelled when something declares or builds
 * it, and a mention in an expression that READS it (`action.notify`) is not
 * that: the reader compiles fine against a type that never declared it.
 */
function declaresKey(src: string, name: string): boolean {
  return new RegExp(`(^|[\\s{,(])${name}\\??\\s*:`, 'm').test(src);
}

/**
 * The body of one function, by brace matching from its declaration.
 *
 * Needed because searching the WHOLE editor for `clip:` found
 * `TRIGGER_LABELS = { …, clip: 'Recording' }` — a label, not a builder. The
 * guard went green while the editor was incapable of producing the trigger,
 * which is precisely the failure it was written to catch. A form counts as
 * expressible only if the function that BUILDS rules builds it.
 */
function functionBody(src: string, name: string): string {
  const decl = src.indexOf(`function ${name}(`);
  expect(decl, `${name} is no longer declared — update this test`).toBeGreaterThan(-1);
  const open = src.indexOf('{', src.indexOf(')', decl));
  expect(open, `${name} has no body`).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error(`${name} is unterminated`);
}

describe('automation rule shapes', () => {
  it('every field the hub sends is named in the client type', () => {
    const client = code(readFileSync(resolve(root, 'src/lib/api.ts'), 'utf8'));
    const missing: string[] = [];
    let checked = 0;

    for (const { struct, goFile } of MODELLED) {
      const go = readFileSync(resolve(root, goFile), 'utf8');
      for (const tag of jsonTags(go, struct)) {
        checked++;
        // Named anywhere in the client's module: these types are nested
        // inline, so a per-type scope would be guesswork about which literal
        // belongs to which struct.
        if (!declaresKey(client, tag)) missing.push(`${struct}.${tag}`);
      }
    }

    // A parser that matched nothing would pass forever. The rule model has had
    // at least this many tagged fields since triggers, conditions and actions
    // all existed.
    expect(checked, 'no JSON tags parsed — the Go declarations have moved').toBeGreaterThan(15);
    expect(
      missing,
      'the hub can put these in a rule and the console has never heard of them',
    ).toEqual([]);
  });

  // The action forms specifically, because they are the ones that fail
  // invisibly: a rule the console cannot render still appears in the list, just
  // wrong. `notify` rendered as "undefined unnamed target" for exactly as long
  // as this test did not exist.
  it('the console can express every action form the hub accepts', () => {
    const go = readFileSync(resolve(root, 'hub/internal/automations/rule.go'), 'utf8');
    const editor = code(
      readFileSync(resolve(root, 'src/components/automations/RuleEditor.tsx'), 'utf8'),
    );
    const builder = functionBody(editor, 'buildAction');
    const forms = jsonTags(go, 'Action').filter((t) => t !== 'args' && t !== 'verb');
    expect(forms.length, 'no action forms found').toBeGreaterThan(2);

    for (const form of forms) {
      // The editor is allowed to LABEL a form differently from its wire name —
      // `notify` is offered as "Just alert me" — so what is required is that it
      // builds the field, not that it repeats the word in prose.
      expect(
        declaresKey(builder, form),
        `the editor never builds an action with "${form}", so a rule using that form ` +
          `cannot be created from the console`,
      ).toBe(true);
    }
  });

  // The same check one field over. When the hub gained a `clip` trigger, the
  // action check above passed — it only reads Action's tags — so an entire
  // trigger kind could ship creatable by the API and unreachable from the only
  // screen that creates rules. A kind nobody can select is a feature that
  // exists in the changelog and not in the product.
  it('the console can express every trigger kind the hub accepts', () => {
    const go = readFileSync(resolve(root, 'hub/internal/automations/rule.go'), 'utf8');
    const editor = code(
      readFileSync(resolve(root, 'src/components/automations/RuleEditor.tsx'), 'utf8'),
    );
    // `kind` is the discriminator, not a form; every other tag on Trigger is a
    // payload the editor has to be able to build.
    const builder = functionBody(editor, 'buildTrigger');
    const forms = jsonTags(go, 'Trigger').filter((t) => t !== 'kind');
    expect(forms.length, 'no trigger forms found').toBeGreaterThan(2);

    for (const form of forms) {
      expect(
        declaresKey(builder, form),
        `the editor never builds a trigger with "${form}", so that trigger kind ` +
          `cannot be created from the console`,
      ).toBe(true);
    }
  });
});
