import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The driver-health panel, guarded on the two ways it could quietly mislead.
 *
 * It exists because per-device state cannot express one specific failure: a
 * driver that is down as a whole. An unreachable MQTT broker does not look like
 * "the MQTT driver is down since 14:02" — it looks like a set of devices whose
 * readings stop being fresh, which is indistinguishable from a quiet house.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const panel = readFileSync(
  path.join(repo, 'src/components/device/DriverHealth.tsx'),
  'utf-8',
);

describe('the driver health panel', () => {
  it('is mounted on the Devices screen', () => {
    const page = readFileSync(path.join(repo, 'src/pages/app/Devices.tsx'), 'utf-8');
    expect(page).toContain('<DriverHealth />');
  });

  it('renders the driver’s own detail rather than a friendlier summary', () => {
    // That string is the only part of this panel that says what to FIX.
    expect(panel).toContain('{d.detail}');
  });

  it('does not present "no drivers" as "all healthy"', () => {
    // No drivers configured and every driver fine are different states, and the
    // difference is the whole question when a screen shows nothing.
    expect(panel).toContain('drivers.length === 0');
    expect(panel.toLowerCase()).toContain('none configured');
  });

  it('says how long a driver has been down', () => {
    // "down" without "since" invites the reading that it just happened.
    expect(panel).toContain('d.since');
    expect(panel.toLowerCase()).toContain('since');
  });
});
