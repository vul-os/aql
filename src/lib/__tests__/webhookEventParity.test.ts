import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The events the console offers must be the events the hub knows.
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
