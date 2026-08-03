import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GATEWAY_KEY, applyGatewayUrl, getApiBaseUrl, getStoredGatewayUrl } from '../hub';
import { KEYS } from '../storageKeys';

// Switching hubs, and the rule that a token belongs to the hub that minted it.
//
// applyGatewayUrl is where the console changes which server it talks to. Its
// doc states the rule — "Tokens and caches belong to the hub that minted them.
// When the effective base URL changes, drop every key this app owns except the
// hub choice itself and the theme" — and nothing checked it. That is a
// credential-handling rule with two distinct ways to get it wrong:
//
//   - Skip the clear, and an access token minted by hub A is carried to hub B
//     and sent as the Authorization header on the first request to a server
//     that never issued it.
//   - Clear too eagerly and the newly-written hub choice goes with it, because
//     the clear runs AFTER the write and sweeps the whole `aql.` namespace. The
//     picker would then appear to do nothing at all.
//
// The order — write, compare, then sweep with the key excepted — is what makes
// both work, and neither is visible from a call site.

const original = Object.getOwnPropertyDescriptor(globalThis, 'window');

/** A localStorage good enough for storageKeys: length/key/get/set/remove. */
function fakeStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    map,
    api: {
      get length() {
        return map.size;
      },
      key: (i: number) => [...map.keys()][i] ?? null,
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
      clear: () => map.clear(),
    },
  };
}

let reloads = 0;

function installWindow(seed: Record<string, string> = {}) {
  const s = fakeStorage(seed);
  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage: s.api,
      location: {
        protocol: 'http:',
        origin: 'http://localhost:5173',
        port: '5173',
        reload: () => {
          reloads++;
        },
      },
    },
    configurable: true,
    writable: true,
  });
  return s;
}

beforeEach(() => {
  reloads = 0;
});

afterEach(() => {
  if (original) Object.defineProperty(globalThis, 'window', original);
  else Reflect.deleteProperty(globalThis as Record<string, unknown>, 'window');
  vi.unstubAllEnvs();
});

describe('applyGatewayUrl', () => {
  it('drops tokens and caches when the hub actually changes', () => {
    const s = installWindow({
      [KEYS.access]: 'token-from-hub-a',
      [KEYS.refresh]: 'refresh-from-hub-a',
      [KEYS.meCache]: '{"id":"u1"}',
      [KEYS.activeAccount]: 'acct-a',
      [GATEWAY_KEY]: 'https://hub-a.example',
    });

    applyGatewayUrl('https://hub-b.example');

    expect(s.map.get(KEYS.access), 'an access token minted by hub A survived a move to hub B').toBeUndefined();
    expect(s.map.get(KEYS.refresh)).toBeUndefined();
    expect(s.map.get(KEYS.meCache), 'the cached profile of hub A is not hub B').toBeUndefined();
    expect(s.map.get(KEYS.activeAccount)).toBeUndefined();
    // And the thing being chosen survived its own sweep.
    expect(s.map.get(GATEWAY_KEY)).toBe('https://hub-b.example');
    expect(reloads).toBe(1);
  });

  it('keeps the theme, which is a preference rather than a credential', () => {
    const s = installWindow({
      [KEYS.access]: 'token',
      [KEYS.theme]: 'dark',
      [GATEWAY_KEY]: 'https://hub-a.example',
    });
    applyGatewayUrl('https://hub-b.example');
    expect(s.map.get(KEYS.theme)).toBe('dark');
    expect(s.map.get(KEYS.access)).toBeUndefined();
  });

  it('leaves the session alone when the effective URL is unchanged', () => {
    // Re-picking the hub you are already on must not sign you out. The
    // comparison is against the EFFECTIVE base URL, not the raw stored string.
    const s = installWindow({
      [KEYS.access]: 'token',
      [GATEWAY_KEY]: 'https://hub-a.example',
    });
    applyGatewayUrl('https://hub-a.example');
    expect(s.map.get(KEYS.access), 'choosing the hub you are already on signed you out').toBe('token');
    expect(reloads).toBe(1);
  });

  it('clears the choice on null and wipes the session with it', () => {
    const s = installWindow({
      [KEYS.access]: 'token',
      [GATEWAY_KEY]: 'https://hub-a.example',
    });
    applyGatewayUrl(null);
    expect(s.map.get(GATEWAY_KEY)).toBeUndefined();
    expect(s.map.get(KEYS.access), 'forgetting the hub kept its token').toBeUndefined();
    expect(getStoredGatewayUrl()).toBeNull();
  });

  it('also sweeps the legacy namespace', () => {
    // storageKeys migrates `lintel.` keys forward on read. Clearing only the
    // current namespace would leave a legacy token that the migrating read then
    // restores — a sign-out that does not sign you out.
    const s = installWindow({
      'lintel.access_token': 'legacy-token',
      [GATEWAY_KEY]: 'https://hub-a.example',
    });
    applyGatewayUrl('https://hub-b.example');
    expect(s.map.get('lintel.access_token')).toBeUndefined();
  });
});

// The precedence rule is stored > VITE_API_BASE_URL > localhost, and only two
// of those three layers are reachable from here.
//
// hub.ts captures `import.meta.env` once at module load. vi.stubEnv does not
// reach that captured reference, and neither does resetModules + stubEnv before
// a dynamic import — both were tried and both left envBaseUrl() returning null.
// So the MIDDLE layer cannot be exercised in a unit test at all.
//
// This is written down because the first draft of this block did stub the env,
// assert that the stored value won, and pass — while the env layer was never
// set, so it demonstrated nothing about precedence. A test that appears to
// cover the middle of a three-way rule and does not is worse than one that
// covers two thirds and says so. The env layer's real coverage is the built
// artifact, which check-render.mjs loads.
describe('the effective base URL', () => {
  it('prefers the stored choice over the fallback', () => {
    installWindow({ [GATEWAY_KEY]: 'https://chosen.example' });
    expect(getApiBaseUrl()).toBe('https://chosen.example');
  });

  it('strips a trailing slash from the stored value', () => {
    // The picker normalises, but a value can also arrive from a ?gateway= deep
    // link or an older build, and `${base}/v1/...` must not become `//v1/...`.
    installWindow({ [GATEWAY_KEY]: 'https://chosen.example///' });
    expect(getApiBaseUrl()).toBe('https://chosen.example');
  });

  it('falls back to localhost when nothing is configured', () => {
    installWindow();
    expect(getApiBaseUrl()).toBe('http://localhost:8787');
  });

  it('survives storage throwing, as it does in Safari private mode', () => {
    // storageKeys wraps every access because localStorage throws in a
    // sandboxed iframe and in private mode. A console that cannot read a
    // preference must still boot.
    Object.defineProperty(globalThis, 'window', {
      value: {
        localStorage: {
          get length(): number {
            throw new Error('SecurityError');
          },
          key: () => {
            throw new Error('SecurityError');
          },
          getItem: () => {
            throw new Error('SecurityError');
          },
          setItem: () => {
            throw new Error('SecurityError');
          },
          removeItem: () => {
            throw new Error('SecurityError');
          },
        },
        location: { reload: () => void reloads++ },
      },
      configurable: true,
      writable: true,
    });
    expect(getStoredGatewayUrl()).toBeNull();
    expect(getApiBaseUrl()).toBe('http://localhost:8787');
    // And applying a choice must not throw either — it simply cannot persist.
    expect(() => applyGatewayUrl('https://hub-b.example')).not.toThrow();
    expect(reloads).toBe(1);
  });
});
