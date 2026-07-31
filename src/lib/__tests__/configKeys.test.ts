import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The controller-config form and the hub's accepted set must be the same keys.
 *
 * `ControllerConfig.tsx` carries a comment saying its FIELDS mirror
 * `httpapi/deviceconfig.go`'s `configBounds`. That was an assertion, and it went
 * stale: the form offered `sensor_debounce_ms` after it was established that the
 * controller stores that key and reads it nowhere. An operator could type a
 * number, watch the hub sign a command, watch the controller acknowledge it, and
 * have changed nothing about the gate.
 *
 * Both directions are failures and they fail differently:
 *
 *   - A key in the form but not in the hub's set is a control that produces a
 *     400. The operator sees a rejection for a field the product offered them.
 *   - A key in the hub's set but not in the form is a setting nothing can
 *     reach — which is how the dead key survived, because the hub kept
 *     accepting it long after the reason to had gone.
 *
 * Neither is visible from either file alone, which is why this reads both.
 */

const root = resolve(__dirname, '../../..');

function hubAcceptedKeys(): string[] {
  const src = readFileSync(resolve(root, 'hub/internal/httpapi/deviceconfig.go'), 'utf8');
  const start = src.indexOf('var configBounds = map[string]configBound{');
  expect(start, 'configBounds no longer declared as expected').toBeGreaterThan(-1);
  // The literal ends at the first line that is exactly `}` — the entries are
  // indented, so this cannot stop early on a nested brace.
  const body = src.slice(start).split('\n');
  const keys: string[] = [];
  for (const line of body.slice(1)) {
    if (line === '}') break;
    const m = /^\s*"([a-z0-9_]+)":/.exec(line);
    if (m) keys.push(m[1]);
  }
  return keys.sort();
}

function consoleFieldKeys(): string[] {
  const src = readFileSync(resolve(root, 'src/components/device/ControllerConfig.tsx'), 'utf8');
  const start = src.indexOf('const FIELDS: Field[] = [');
  expect(start, 'FIELDS no longer declared as expected').toBeGreaterThan(-1);
  const end = src.indexOf('\n];', start);
  expect(end, 'FIELDS literal is unterminated').toBeGreaterThan(start);
  const body = src.slice(start, end);
  return [...body.matchAll(/key: '([a-z0-9_]+)'/g)].map((m) => m[1]).sort();
}

describe('controller configuration keys', () => {
  it('offers exactly the keys the hub will send', () => {
    const hub = hubAcceptedKeys();
    expect(hub.length, 'parsed no keys out of configBounds — the parser has drifted').toBeGreaterThan(0);
    expect(consoleFieldKeys()).toEqual(hub);
  });

  it('does not offer or accept a key the controller never reads', () => {
    // `sensor_debounce_ms` is the worked example and the reason this file
    // exists. The controller's own comments say it is stored and ignored; the
    // debounce that applies comes from the relay wiring. If it ever becomes a
    // key the controller RESOLVES, this expectation is the thing that has to be
    // deleted deliberately — which is the point.
    expect(hubAcceptedKeys()).not.toContain('sensor_debounce_ms');
    expect(consoleFieldKeys()).not.toContain('sensor_debounce_ms');

    // And the refusal has to keep naming where the setting really is, or an
    // operator reads "not configurable" as "not supported".
    const go = readFileSync(resolve(root, 'hub/internal/httpapi/deviceconfig.go'), 'utf8');
    const refused = go.slice(go.indexOf('var refusedConfigKeys'));
    expect(refused).toContain('sensor_debounce_ms');
    expect(refused).toContain('-relay');
  });

  it('reports only what the controller resolves', () => {
    // The report carries the keys the controller RESOLVES, which is the same
    // set the hub sends. A key that can be configured and never reported would
    // leave the console showing a field with no "in effect" line under it
    // forever, indistinguishable from a controller that has not reported.
    const cmd = readFileSync(resolve(root, 'controller/internal/command/command.go'), 'utf8');
    const fn = cmd.slice(cmd.indexOf('func ResolvedConfig('));
    const resolved = [...fn.slice(0, fn.indexOf('\n}')).matchAll(/resolve\("([a-z0-9_]+)"/g)]
      .map((m) => m[1])
      .sort();
    expect(resolved).toEqual(hubAcceptedKeys());
  });
});
