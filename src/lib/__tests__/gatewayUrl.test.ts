import { describe, expect, it } from 'vitest';
import { normalizeGatewayUrl } from '../hub';
import { fromUnix } from '../time';

// normalizeGatewayUrl turns whatever an operator typed into the base URL every
// subsequent API call is made against, and it had no test.
//
// servingOrigin, right beside it in hub.ts, has one — the same class of
// decision, about which origin the console will treat as a hub. This is the
// other half: the address a person types into the picker, which is then stored
// and used until they change it.
//
// Two of its rules are not cosmetic:
//
//   - It strips credentials. `https://admin:hunter2@hub.example` would
//     otherwise be persisted verbatim in localStorage and sent as the base of
//     every request, putting a password somewhere no one expects to find one
//     and into any log or screenshot of the picker.
//   - It permits only http and https. The value reaches `new URL()` and is
//     rendered back to the operator, so a scheme that is not a transport at all
//     has no business surviving normalisation.

describe('normalizeGatewayUrl', () => {
  // Every expectation here is WITHOUT a trailing slash, which is not what I
  // assumed writing this: URL.toString() appends one for a bare host, and the
  // final replace strips it back off. That is the form api.ts needs, since it
  // builds `${base}/v1/...` and a kept slash would make that `//v1/...`. Four
  // of these cases were written the other way and the run corrected them.
  it('assumes https when no scheme was typed', () => {
    // The common case: someone types a hostname. Defaulting to http would
    // silently downgrade every hub that supports TLS.
    expect(normalizeGatewayUrl('hub.example.org')).toBe('https://hub.example.org');
    expect(normalizeGatewayUrl('  hub.example.org  ')).toBe('https://hub.example.org');
  });

  it('keeps an explicit scheme, including plain http for a hub on the LAN', () => {
    // http:// is typed deliberately and is the normal case for a box on the
    // local network with no certificate, so it must survive.
    expect(normalizeGatewayUrl('http://192.168.1.10:8080')).toBe('http://192.168.1.10:8080');
    expect(normalizeGatewayUrl('https://hub.example.org:8443')).toBe('https://hub.example.org:8443');
  });

  it('strips credentials rather than storing them', () => {
    const got = normalizeGatewayUrl('https://admin:hunter2@hub.example.org');
    expect(got).toBe('https://hub.example.org');
    expect(got).not.toContain('hunter2');
    expect(got).not.toContain('admin');
  });

  it('drops the query and fragment', () => {
    // A base URL with a query on it would corrupt every path appended to it.
    expect(normalizeGatewayUrl('https://hub.example.org/?token=abc#frag')).toBe(
      'https://hub.example.org',
    );
  });

  it('strips trailing slashes so paths are appended cleanly', () => {
    // api.ts builds `${base}/v1/...`; a trailing slash makes that `//v1/...`,
    // which some routers treat as a different path entirely.
    expect(normalizeGatewayUrl('https://hub.example.org/api///')).toBe(
      'https://hub.example.org/api',
    );
  });

  it('refuses anything that is not http or https', () => {
    for (const raw of [
      'javascript://alert(1)',
      'javascript:alert(1)',
      'file:///etc/passwd',
      'ftp://hub.example.org',
      'data://text/html,x',
      'tauri://localhost',
    ]) {
      expect(normalizeGatewayUrl(raw), raw).toBeNull();
    }
  });

  it('refuses input that cannot be a URL at all', () => {
    for (const raw of ['', '   ', 'https://', '://nope', 'h ttp://x']) {
      expect(normalizeGatewayUrl(raw), JSON.stringify(raw)).toBeNull();
    }
  });
});

// fromUnix is ten lines and has thirty-six call sites, and its own comment
// names the bug it exists to prevent: `new Date(unixSeconds)` reads the number
// as MILLISECONDS and yields a date in early 1970. Drop the multiplication and
// nothing throws — every timestamp in the console simply becomes a plausible
// wrong date, which is the kind of regression that survives a visual review of
// a screen full of "1970".
describe('fromUnix', () => {
  it('reads a gateway timestamp as seconds, not milliseconds', () => {
    const d = fromUnix(1_700_000_000);
    expect(d).not.toBeNull();
    expect(d!.getTime()).toBe(1_700_000_000_000);
    expect(d!.getUTCFullYear()).toBe(2023);
  });

  it('passes null and undefined straight through', () => {
    // Optional timestamps are common in the API — an access point that has
    // never been seen, a token that never expires — and rendering the epoch
    // for "never" would be a lie rather than a blank.
    expect(fromUnix(null)).toBeNull();
    expect(fromUnix(undefined)).toBeNull();
  });

  it('treats 0 as a real timestamp rather than as absent', () => {
    // 0 is a value the hub can genuinely send, and `if (!sec)` instead of an
    // explicit null check would silently turn it into "never".
    const d = fromUnix(0);
    expect(d).not.toBeNull();
    expect(d!.getTime()).toBe(0);
  });
});
