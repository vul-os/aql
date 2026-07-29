/**
 * What actually happened to a gate command, in words.
 *
 * The hub distinguishes four delivery outcomes and documents each one
 * (`hub/internal/httpapi/open.go`'s dispatchCommand). The console discarded
 * all four: every call site awaited `api.accessOpen(...)` and moved straight to
 * a success state, so a 200 was rendered as "the gate opened" whether the
 * controller had acknowledged it, was offline, was silent, or did not exist.
 *
 * That is the worst version of the bug this codebase works hardest to avoid,
 * and it sat on the one path the product drives end to end. A person taps Open,
 * the button flips to Close, and the gate has not moved.
 *
 * The four outcomes are genuinely different things to tell someone:
 *
 *   acked        the controller answered. It happened.
 *   queued       the controller is OFFLINE. The command is stored and will be
 *                delivered when it reconnects — possibly in hours. Nothing has
 *                moved and nothing is about to.
 *   undelivered  the controller is connected but did not answer in time. This
 *                is INDETERMINATE: the command may have arrived and actuated
 *                with only the acknowledgement lost. It must not be reported as
 *                a failure, because a person told an open failed presses the
 *                button again — and the gate may open twice.
 *   no_device    no controller is attached to this access point. Nothing was
 *                sent and nothing ever will be.
 */

export type DeliveryKind = 'done' | 'queued' | 'unknown' | 'no_device' | 'unrecognised';

export type DeliveryOutcome = {
  kind: DeliveryKind;
  /** True only when the controller confirmed. The only case a UI may celebrate. */
  confirmed: boolean;
  /** Whether pressing again is a reasonable next action. False when indeterminate. */
  retryable: boolean;
  message: string;
};

/**
 * Narrow a delivery string for one command.
 *
 * `verbPast` is the verb in the past tense — "opened", "closed", "held open" —
 * so the copy names what was asked for rather than assuming an open.
 */
export function describeDelivery(delivery: string, verbPast: string): DeliveryOutcome {
  switch (delivery) {
    case 'acked':
      return { kind: 'done', confirmed: true, retryable: true, message: `The controller ${verbPast} it.` };

    case 'queued':
      return {
        kind: 'queued',
        confirmed: false,
        retryable: false,
        message:
          `This controller is offline. The command is queued and will run when it reconnects — ` +
          `nothing has ${verbPast === 'closed' ? 'closed' : 'moved'} yet.`,
      };

    case 'undelivered':
      return {
        kind: 'unknown',
        confirmed: false,
        // Deliberately not retryable. The command may have arrived and only the
        // acknowledgement been lost, so "try again" risks a second actuation.
        retryable: false,
        message:
          `Sent, but the controller did not confirm. It may have ${verbPast} anyway — ` +
          `check the gate before sending it again.`,
      };

    case 'no_device':
      return {
        kind: 'no_device',
        confirmed: false,
        retryable: false,
        message: 'No controller is attached to this access point, so nothing was sent.',
      };

    default:
      // An outcome this console does not recognise is not assumed to be
      // success. A newer hub reporting something new must not be rendered as a
      // gate that opened.
      return {
        kind: 'unrecognised',
        confirmed: false,
        retryable: false,
        message: `The hub reported "${delivery}", which this console does not recognise. Check the gate.`,
      };
  }
}
