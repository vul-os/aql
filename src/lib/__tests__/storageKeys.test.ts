import { beforeEach, describe, expect, it } from 'vitest';
import { KEYS, clearOwnedExcept, read, remove, write } from '@/lib/storageKeys';

/**
 * These keys are the durable state of an install that is already running on
 * someone's machine: the session, the hub it talks to, the theme, the selected
 * account. Renaming the namespace without a migration signs every existing user
 * out, forgets their hub, and flips their theme — with nothing anywhere to
 * explain it.
 *
 * "It logged me out and forgot my server" is a bug report nobody would ever
 * connect to a directory rename, which is exactly why it needs a test.
 */

// An in-memory localStorage. The suite runs with `environment: 'node'` and no
// jsdom, deliberately — the module under test touches exactly one browser API,
// so a twelve-line stub is a better trade than a DOM dependency for the whole
// repo. It also makes the storage semantics this module relies on explicit:
// getItem returns null (not undefined) for an absent key, and every value is a
// string.
function installLocalStorage(): void {
  const map = new Map<string, string>();
  const store = {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  };
  (globalThis as { window?: unknown }).window = { localStorage: store };
}

beforeEach(() => {
  installLocalStorage();
});

describe('legacy keys migrate forward', () => {
  it('a value written under the old namespace is still readable', () => {
    window.localStorage.setItem('lintel.access_token', 'tok-abc');
    expect(read(KEYS.access)).toBe('tok-abc');
  });

  // Migrating rather than merely falling back is what keeps the compatibility
  // window from becoming permanent by neglect.
  it('reading migrates the value and drops the old key', () => {
    window.localStorage.setItem('lintel.gateway_url', 'https://hub.example');
    read(KEYS.gatewayUrl);
    expect(window.localStorage.getItem(KEYS.gatewayUrl)).toBe('https://hub.example');
    expect(window.localStorage.getItem('lintel.gateway_url')).toBeNull();
  });

  it('the current value wins over a stale legacy one', () => {
    window.localStorage.setItem('lintel.theme', 'dark');
    window.localStorage.setItem(KEYS.theme, 'light');
    expect(read(KEYS.theme)).toBe('light');
  });

  it('an absent key is null under both names', () => {
    expect(read(KEYS.activeAccount)).toBeNull();
  });

  // A downgrade-then-upgrade must not resurrect a value the user has since
  // changed.
  it('writing removes the legacy twin', () => {
    window.localStorage.setItem('lintel.theme', 'dark');
    write(KEYS.theme, 'light');
    expect(window.localStorage.getItem('lintel.theme')).toBeNull();
    expect(read(KEYS.theme)).toBe('light');
  });

  it('removing clears both names', () => {
    window.localStorage.setItem('lintel.refresh_token', 'old');
    window.localStorage.setItem(KEYS.refresh, 'new');
    remove(KEYS.refresh);
    expect(read(KEYS.refresh)).toBeNull();
  });
});

describe('the sweep covers both namespaces', () => {
  // The bug this prevents: clearing only the current namespace leaves a
  // legacy token behind, which the migrating read then restores. A sign-out
  // that does not sign you out.
  it('a legacy token does not survive a sign-out', () => {
    window.localStorage.setItem('lintel.access_token', 'ghost');
    window.localStorage.setItem('lintel.refresh_token', 'ghost');
    clearOwnedExcept([KEYS.gatewayUrl, KEYS.theme]);
    expect(read(KEYS.access)).toBeNull();
    expect(read(KEYS.refresh)).toBeNull();
  });

  it('kept keys survive under either name', () => {
    window.localStorage.setItem('lintel.gateway_url', 'https://hub.example');
    window.localStorage.setItem(KEYS.theme, 'dark');
    window.localStorage.setItem(KEYS.access, 'tok');
    clearOwnedExcept([KEYS.gatewayUrl, KEYS.theme]);
    expect(read(KEYS.gatewayUrl)).toBe('https://hub.example');
    expect(read(KEYS.theme)).toBe('dark');
    expect(read(KEYS.access)).toBeNull();
  });

  it('keys belonging to other apps are left alone', () => {
    window.localStorage.setItem('someone-elses-key', 'keep me');
    clearOwnedExcept([]);
    expect(window.localStorage.getItem('someone-elses-key')).toBe('keep me');
  });
});

describe('the key registry is the only place a name is written', () => {
  it('every key is namespaced', () => {
    for (const [name, key] of Object.entries(KEYS)) {
      expect(key.startsWith('aql.'), `${name} is not namespaced: ${key}`).toBe(true);
    }
  });

  // A key inlined as a string literal elsewhere would skip the migration
  // entirely, which is how one of these quietly stops working on upgrade.
  it('no source file inlines a legacy key', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const here = path.dirname(fileURLToPath(import.meta.url));
    const srcRoot = path.resolve(here, '../..');

    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name)) continue;
        // storageKeys.ts defines the namespaces; vault.ts documents at length
        // why the IndexedDB name is deliberately NOT renamed (renaming a
        // database orphans it rather than migrating, which would destroy the
        // app signing key and every offline grant).
        if (entry.name === 'storageKeys.ts' || entry.name === 'vault.ts') continue;
        if (full.includes('__tests__')) continue;
        const src = readFileSync(full, 'utf-8');
        for (const m of src.matchAll(/['"`]lintel\.[a-zA-Z0-9_.-]+['"`]/g)) {
          offenders.push(`${path.relative(srcRoot, full)}: ${m[0]}`);
        }
      }
    };
    walk(srcRoot);

    expect(
      offenders,
      `these inline a legacy storage key instead of using KEYS, so they skip the ` +
        `migration and will silently stop working:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
