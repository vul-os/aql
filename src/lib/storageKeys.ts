// Browser-storage key names, and why there are two generations of them.
//
// Every key this app writes is namespaced `aql.`. They used to be `lintel.`,
// from before this repo absorbed lintel and became Aql.
//
// # Why a rename here is not free
//
// These are not internal identifiers. They are the durable state of an install
// that is already running on someone's machine:
//
//   aql.access_token / aql.refresh_token   the session
//   aql.gateway_url                        which hub this browser talks to
//   aql.theme                              light or dark
//   aql.activeAccount                      which account is selected
//
// Renaming them without a migration means every existing user is silently
// signed out on upgrade, loses the hub they had chosen, and watches the theme
// flip back — with no error anywhere to explain it. "It logged me out and
// forgot my server" is a bug report nobody would connect to a directory rename.
//
// # What this module does
//
// `read` looks at the current key, falls back to the legacy one, and MIGRATES
// it forward: the value is rewritten under the new name and the old key is
// removed, so the fallback is used at most once per browser. That keeps the
// compatibility window from becoming permanent by neglect — unlike the env-var
// fallback in hub/cmd/hub/env.go, where the hub cannot rewrite an operator's
// configuration and has to warn instead.
//
// Every access goes through here rather than touching localStorage directly, so
// a new key cannot be added that skips the migration.

const NS = 'aql.';
const LEGACY_NS = 'lintel.';

/** Canonical key names. Add here rather than inlining a string anywhere else. */
export const KEYS = {
  access: `${NS}access_token`,
  refresh: `${NS}refresh_token`,
  gatewayUrl: `${NS}gateway_url`,
  theme: `${NS}theme`,
  activeAccount: `${NS}activeAccount`,
  meCache: `${NS}me.v5`,
  chunkReload: `${NS}chunkReloadAttempted`,
  pendingInvite: `${NS}pendingInviteToken`,
  pendingWhatsAppPhone: `${NS}pendingWhatsAppPhone`,
} as const;

function legacyName(key: string): string {
  return key.startsWith(NS) ? LEGACY_NS + key.slice(NS.length) : key;
}

/**
 * Read a key, migrating a legacy value forward on first sight.
 *
 * Storage access is wrapped because it throws in a sandboxed iframe and in
 * Safari's private mode — a thrown quota error while reading a theme
 * preference must not take the whole app down.
 */
export function read(key: string): string | null {
  try {
    const current = window.localStorage.getItem(key);
    if (current !== null) return current;

    const legacy = legacyName(key);
    if (legacy === key) return null;
    const old = window.localStorage.getItem(legacy);
    if (old === null) return null;

    // Migrate forward, then drop the old name. Best-effort: if the write
    // fails we still return the value, because reading correctly matters more
    // than tidying up.
    try {
      window.localStorage.setItem(key, old);
      window.localStorage.removeItem(legacy);
    } catch {
      /* storage full or blocked — the value is still good */
    }
    return old;
  } catch {
    return null;
  }
}

export function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
    // Remove any legacy twin so a later downgrade-then-upgrade cannot resurrect
    // a stale value that has since been changed.
    const legacy = legacyName(key);
    if (legacy !== key) window.localStorage.removeItem(legacy);
  } catch {
    /* non-fatal */
  }
}

export function remove(key: string): void {
  try {
    window.localStorage.removeItem(key);
    const legacy = legacyName(key);
    if (legacy !== key) window.localStorage.removeItem(legacy);
  } catch {
    /* non-fatal */
  }
}

/**
 * Clear every key this app owns except the ones named in `keep`.
 *
 * BOTH namespaces are swept. Sweeping only the current one would leave a
 * signed-out browser holding a legacy `lintel.access_token`, which the migrating
 * read above would then happily restore — a sign-out that does not sign you
 * out. That is the exact bug this function exists to prevent, so the two-prefix
 * loop is load-bearing rather than defensive.
 */
export function clearOwnedExcept(keep: Iterable<string>): void {
  const kept = new Set<string>();
  for (const k of keep) {
    kept.add(k);
    kept.add(legacyName(k));
  }
  try {
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const k = window.localStorage.key(i);
      if (!k) continue;
      if (!k.startsWith(NS) && !k.startsWith(LEGACY_NS)) continue;
      if (kept.has(k)) continue;
      window.localStorage.removeItem(k);
    }
  } catch {
    /* non-fatal */
  }
}
