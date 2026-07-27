// A minimal in-memory IndexedDB stand-in, for testing the vault in Node.
//
// The unit suite runs in the `node` environment (vitest.config.ts) which has
// no IndexedDB, and pulling a full polyfill in as a dependency for one file
// is not worth it. This implements exactly the surface `vault.ts` uses:
//
//   indexedDB.open(name, version) -> { onupgradeneeded, onsuccess, onerror, result }
//   db.objectStoreNames.contains(name) / db.createObjectStore(name) / db.close()
//   db.transaction(name, mode) -> { oncomplete, onerror, onabort }
//   tx.objectStore(name).get/getAll/put/delete -> { onsuccess, onerror, result }
//
// Timing matters and is reproduced deliberately: requests settle on a
// macrotask, and the transaction only completes once every request it issued
// has settled — so the `await reqDone(...); await txDone(tx)` order in
// vault.ts is exercised the same way a real browser would exercise it.
//
// It is NOT structured-clone: values go in and come back by reference. That
// is what lets a test store a live CryptoKey, which is the whole reason the
// vault uses IndexedDB in the first place.

type Listener = ((ev: unknown) => void) | null;

class FakeRequest<T = unknown> {
  result!: T;
  error: unknown = null;
  onsuccess: Listener = null;
  onerror: Listener = null;
  onupgradeneeded: Listener = null;
}

class FakeObjectStore {
  constructor(
    private readonly data: Map<string, unknown>,
    private readonly tx: FakeTransaction,
  ) {}

  get(key: string) {
    return this.tx.enqueue(() => this.data.get(key));
  }

  getAll() {
    return this.tx.enqueue(() => Array.from(this.data.values()));
  }

  getAllKeys() {
    return this.tx.enqueue(() => Array.from(this.data.keys()));
  }

  put(value: unknown, key: string) {
    return this.tx.enqueue(() => {
      this.data.set(key, value);
      return key;
    });
  }

  delete(key: string) {
    return this.tx.enqueue(() => {
      this.data.delete(key);
      return undefined;
    });
  }
}

class FakeTransaction {
  oncomplete: Listener = null;
  onerror: Listener = null;
  onabort: Listener = null;
  error: unknown = null;
  private pending = 0;
  private settled = false;

  constructor(
    private readonly db: FakeDatabase,
    private readonly names: string[],
  ) {
    // A transaction with no requests still completes.
    setTimeout(() => this.maybeComplete(), 0);
  }

  objectStore(name: string): FakeObjectStore {
    if (!this.names.includes(name)) {
      throw new Error(`fake-idb: store "${name}" is not in this transaction`);
    }
    return new FakeObjectStore(this.db.storeData(name), this);
  }

  enqueue<T>(fn: () => T): FakeRequest<T> {
    const req = new FakeRequest<T>();
    this.pending += 1;
    setTimeout(() => {
      try {
        req.result = fn();
        req.onsuccess?.({ target: req });
      } catch (err) {
        req.error = err;
        req.onerror?.({ target: req });
      }
      this.pending -= 1;
      this.maybeComplete();
    }, 0);
    return req;
  }

  private maybeComplete(): void {
    if (this.settled || this.pending > 0) return;
    this.settled = true;
    setTimeout(() => this.oncomplete?.({ target: this }), 0);
  }
}

class FakeDatabase {
  constructor(private readonly stores: Map<string, Map<string, unknown>>) {}

  get objectStoreNames() {
    const stores = this.stores;
    return { contains: (name: string) => stores.has(name) };
  }

  createObjectStore(name: string) {
    if (!this.stores.has(name)) this.stores.set(name, new Map());
    return {};
  }

  transaction(names: string | string[]) {
    return new FakeTransaction(this, Array.isArray(names) ? names : [names]);
  }

  storeData(name: string): Map<string, unknown> {
    const data = this.stores.get(name);
    if (!data) throw new Error(`fake-idb: no such store "${name}"`);
    return data;
  }

  close(): void {
    /* nothing to release */
  }
}

class FakeIndexedDB {
  readonly dbs = new Map<string, { version: number; stores: Map<string, Map<string, unknown>> }>();

  open(name: string, version = 1) {
    const req = new FakeRequest<FakeDatabase>();
    setTimeout(() => {
      let entry = this.dbs.get(name);
      if (!entry) {
        entry = { version: 0, stores: new Map() };
        this.dbs.set(name, entry);
      }
      req.result = new FakeDatabase(entry.stores);
      if (entry.version < version) {
        entry.version = version;
        req.onupgradeneeded?.({ target: req });
      }
      req.onsuccess?.({ target: req });
    }, 0);
    return req;
  }
}

export type FakeIdbHandle = {
  /** Forget every database — call between tests. */
  reset(): void;
  /** Raw contents of one object store, for assertions the vault API cannot make. */
  rows<T>(dbName: string, storeName: string): T[];
  /** Raw keys of one object store. */
  keys(dbName: string, storeName: string): string[];
  /** Write straight into a store, bypassing the vault (to seed legacy shapes). */
  seed(dbName: string, storeName: string, key: string, value: unknown): void;
};

/** Install the fake as `globalThis.indexedDB` and hand back a control handle. */
export function installFakeIndexedDB(): FakeIdbHandle {
  const factory = new FakeIndexedDB();
  (globalThis as { indexedDB?: unknown }).indexedDB = factory;

  const storeOf = (dbName: string, storeName: string): Map<string, unknown> => {
    let entry = factory.dbs.get(dbName);
    if (!entry) {
      entry = { version: 0, stores: new Map() };
      factory.dbs.set(dbName, entry);
    }
    let data = entry.stores.get(storeName);
    if (!data) {
      data = new Map();
      entry.stores.set(storeName, data);
    }
    return data;
  };

  return {
    reset: () => factory.dbs.clear(),
    rows: <T,>(dbName: string, storeName: string) => Array.from(storeOf(dbName, storeName).values()) as T[],
    keys: (dbName: string, storeName: string) => Array.from(storeOf(dbName, storeName).keys()),
    seed: (dbName: string, storeName: string, key: string, value: unknown) => {
      storeOf(dbName, storeName).set(key, value);
    },
  };
}
