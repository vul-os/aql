import { afterEach, describe, expect, it } from 'vitest';
import { servingOrigin } from '../hub';
import { capNote } from '../../components/device/liveState';

// Which origins may be treated as the hub, and which must not.
//
// The console is embedded in the hub and served by it, so the origin that
// delivered the page is the best guess at where the API is — that is the fix
// this covers. The exclusions are the load-bearing half: a wrong guess here
// silently points the console at something that is not a hub, and the operator
// sees failures rather than a question.
//
// The first-run e2e spec proves the positive case against a real binary. This
// covers the cases that have no server to point at, which an end-to-end test
// cannot reach.

const original = Object.getOwnPropertyDescriptor(globalThis, 'window');

function withLocation(loc: { protocol: string; origin: string; port: string } | null) {
  if (loc === null) {
    Reflect.deleteProperty(globalThis as Record<string, unknown>, 'window');
    return;
  }
  Object.defineProperty(globalThis, 'window', {
    value: { location: loc },
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  if (original) Object.defineProperty(globalThis, 'window', original);
  else Reflect.deleteProperty(globalThis as Record<string, unknown>, 'window');
});

describe('servingOrigin', () => {
  it('is the origin when a hub could be serving it', () => {
    withLocation({ protocol: 'http:', origin: 'http://127.0.0.1:8080', port: '8080' });
    expect(servingOrigin()).toBe('http://127.0.0.1:8080');

    withLocation({ protocol: 'https:', origin: 'https://hub.example.org', port: '' });
    expect(servingOrigin()).toBe('https://hub.example.org');
  });

  it('is null for the Vite dev server, which serves the console and no API', () => {
    // Without this, `npm run dev` connects the console to its own file server
    // and every call 404s against a page rather than reaching a hub.
    withLocation({ protocol: 'http:', origin: 'http://localhost:5173', port: '5173' });
    expect(servingOrigin()).toBeNull();
    withLocation({ protocol: 'http:', origin: 'http://localhost:4173', port: '4173' });
    expect(servingOrigin()).toBeNull();
  });

  it('is null where the origin cannot serve an API at all', () => {
    // A desktop shell has to pick a hub explicitly; its own origin serves the
    // bundle off disk.
    withLocation({ protocol: 'file:', origin: 'null', port: '' });
    expect(servingOrigin()).toBeNull();
    withLocation({ protocol: 'tauri:', origin: 'tauri://localhost', port: '' });
    expect(servingOrigin()).toBeNull();
  });

  it('is null with no window, so nothing server-side guesses an origin', () => {
    withLocation(null);
    expect(servingOrigin()).toBeNull();
  });
});

describe('capNote', () => {
  // A capped list that says nothing reads as the complete list. The hub goes to
  // the trouble of fetching one extra row to know the difference, and the
  // console dropped the answer: breakdown_truncated has been in the response
  // for as long as the endpoint has existed and no type here named it.
  it('says so when the hub capped the list', () => {
    expect(capNote(20, true)).toBe('Showing the busiest 20 — there are more.');
  });

  it('says nothing when the list is complete', () => {
    // Silence is correct here, and it is the reason this is a function rather
    // than an inline ternary: "there are more" under a complete list would be
    // its own lie.
    expect(capNote(3, false)).toBeNull();
    expect(capNote(0, false)).toBeNull();
  });
});
