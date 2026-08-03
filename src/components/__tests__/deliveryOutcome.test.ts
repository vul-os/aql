import { describe, expect, it } from 'vitest';
import { describeDelivery } from '../access/delivery';
import { consoleShowsEngineDevice } from '../device/engineState';

// describeDelivery decides what a person is told after they press a button that
// moves a gate, and it had no test.
//
// It is the console-side twin of api.ts's isIndeterminate, whose own comment
// says the same thing in the same words: "a person told an open failed presses
// the button again — and the gate may open twice". Here the mechanism is the
// `retryable` flag rather than a narrowing helper, and the hazard is identical.
//
// # Tested as a set, on an invariant rather than five separate strings
//
// Five delivery values, each returning four fields. Asserting the copy of each
// one individually would pin the wording and miss the property that matters, so
// what is asserted is: `confirmed` and `retryable` are true for EXACTLY the
// acknowledged case and false everywhere else, including for a value this
// console has never heard of.
//
// That is the shape a future case gets wrong. Someone adding a sixth delivery
// state copies the nearest branch, and the nearest branch is `acked` — the one
// with both flags true.

const CASES: { delivery: string; confirmed: boolean; retryable: boolean; kind: string }[] = [
  { delivery: 'acked', confirmed: true, retryable: true, kind: 'done' },
  { delivery: 'queued', confirmed: false, retryable: false, kind: 'queued' },
  { delivery: 'undelivered', confirmed: false, retryable: false, kind: 'unknown' },
  { delivery: 'no_device', confirmed: false, retryable: false, kind: 'no_device' },
  { delivery: 'something_a_newer_hub_sent', confirmed: false, retryable: false, kind: 'unrecognised' },
  { delivery: '', confirmed: false, retryable: false, kind: 'unrecognised' },
];

describe('describeDelivery', () => {
  it('confirms only what the controller acknowledged', () => {
    for (const c of CASES) {
      const got = describeDelivery(c.delivery, 'opened');
      expect(got.kind, c.delivery).toBe(c.kind);
      expect(
        got.confirmed,
        `${c.delivery}: only an acknowledgement may be celebrated as a completed open`,
      ).toBe(c.confirmed);
    }
  });

  it('never invites a second press of a command that may already have run', () => {
    // The whole reason `undelivered` is not retryable: the command may have
    // arrived and only the acknowledgement been lost. A "try again" there risks
    // a second actuation of a physical barrier.
    const undelivered = describeDelivery('undelivered', 'opened');
    expect(undelivered.retryable).toBe(false);
    expect(undelivered.confirmed).toBe(false);

    for (const c of CASES) {
      expect(describeDelivery(c.delivery, 'opened').retryable, c.delivery).toBe(c.retryable);
    }
  });

  it('names the verb that was actually asked for', () => {
    // The copy is shared by open, close and hold. Hard-coding "opened" would
    // tell someone who pressed Close that the gate opened.
    expect(describeDelivery('acked', 'closed').message).toContain('closed');
    expect(describeDelivery('acked', 'held open').message).toContain('held open');
    expect(describeDelivery('acked', 'closed').message).not.toContain('opened');
  });

  it('says both halves of the no-controller case', () => {
    // Each fact alone misleads. "Nothing was sent" suggests the request was
    // rejected, when the hub authorised it and wrote an audit row. "Logged"
    // alone is what let this render as a success.
    const m = describeDelivery('no_device', 'opened').message;
    expect(m).toMatch(/logged/i);
    expect(m).toMatch(/no gate moved|no controller/i);
  });

  it('quotes an unrecognised delivery rather than swallowing it', () => {
    // A newer hub reporting something new must be legible to whoever is
    // debugging it, not flattened into a generic error.
    const m = describeDelivery('half_delivered', 'opened').message;
    expect(m).toContain('half_delivered');
  });

  it('tells the queued case that nothing has moved yet', () => {
    const m = describeDelivery('queued', 'opened').message;
    expect(m).toMatch(/offline/i);
    expect(m).toMatch(/nothing has/i);
  });
});

// consoleShowsEngineDevice is two lines, and both of them are a negation.
//
// Its doc records why it exists at the fetch rather than at each screen: it was
// at each screen for one commit and was already wrong in two of the three
// places — Overview counted every gate twice in the fleet total, and RuleEditor
// would have offered gates in an automation's device picker, "the last place a
// gate should appear".
//
// suppressEngineRow and kindLabel underneath it are both tested. What is not is
// the composition, where a dropped `!` inverts the whole thing: the console
// would then show ONLY gates and hide every lamp, camera and meter — and it
// would do so in all three consumers at once, which is exactly the coupling
// that moving the filter here was meant to buy.
describe('consoleShowsEngineDevice', () => {
  it('hides access points, which the access-point API reports with more detail', () => {
    expect(consoleShowsEngineDevice({ kind: 'access' })).toBe(false);
  });

  it('shows every other device kind', () => {
    for (const kind of ['lighting', 'camera', 'climate', 'energy', 'sensor', 'robot']) {
      expect(consoleShowsEngineDevice({ kind }), kind).toBe(true);
    }
  });

  it('shows a kind this console has never heard of', () => {
    // A newer hub with an eighth kind should have its devices appear rather
    // than silently vanish from the fleet: an unknown device the operator can
    // see is a question, and one they cannot is a gap they will not notice.
    expect(consoleShowsEngineDevice({ kind: 'aquarium' })).toBe(true);
  });
});
