/**
 * The one decision the energy chart cannot get wrong.
 *
 * README states it as a product promise: "An hour nobody measured reads as
 * null, never zero, and the chart draws it as a gap — an outage and a house
 * using nothing are different facts." The hub half is well guarded
 * (TestEmptyPeriodIsNotZero, TestPartialHourIsAFloorNotATotal). The console
 * half was inline JSX with no test, so `b.kwh ?? 0` anywhere in that
 * expression would have turned every outage into a confident zero — the exact
 * claim the README disclaims — and nothing would have failed.
 *
 * Extracted rather than tested in place because this repo has no component
 * test setup, and adding jsdom to assert one branch is a worse trade than
 * naming the decision.
 */
export type BucketShape =
  /** Nobody measured this period. Drawn as a hairline, never as a bar. */
  | { kind: 'gap' }
  /**
   * Measured. `height` is in viewBox units, floored so a real tiny reading
   * stays visible. `kwh` rides along so the caller renders the number it drew
   * rather than re-reading a nullable field and having to re-prove it is not
   * null — the re-proof is where a `?? 0` gets added by someone fixing a type
   * error.
   */
  | { kind: 'bar'; height: number; kwh: number };

/**
 * shapeFor decides how one bucket is drawn.
 *
 * A null kwh is a gap and can never be a bar, whatever the axis says. A
 * measured zero IS a bar — a house that genuinely used nothing is a fact worth
 * drawing, and collapsing it into the same mark as "not measured" is the
 * confusion this whole rule exists to prevent.
 */
export function shapeFor(kwh: number | null, axisMax: number, viewHeight: number): BucketShape {
  if (kwh === null) return { kind: 'gap' };
  // Guard the axis rather than the reading: a zero or negative axisMax would
  // make every bar NaN or infinite, and a chart of NaN renders as nothing at
  // all — silently, which is how a broken axis looks exactly like an outage.
  if (!(axisMax > 0)) return { kind: 'bar', height: 1, kwh };
  return { kind: 'bar', height: Math.max(1, (kwh / axisMax) * viewHeight), kwh };
}
