// Per-item honesty marks.
//
// Aql is one product: devices, automations, energy and physical access live on
// the same screens, and what backs each of them differs. Access points,
// members, grants and audit talk to your hub. Device rows come from the device
// engine — when one is configured, which is not the default.
//
// The rule: truth is marked PER ITEM, at the point of use — a chip on the
// panel, a chip on the row, a note under the control. Not a page-level banner.
// A banner over a mixed screen either lies about the real half or gets tuned
// out; a chip on the exact figure cannot do either.
//
// Companion rule for controls: anything with no engine behind it is rendered
// disabled and carries an <InertNote /> naming the ROADMAP phase that would
// make it work. Nothing here is wired to an endpoint that does not exist.
//
// There was a <DemoChip /> here for as long as six of the seven device kinds
// came from a fixture. The fixture is gone and so is the chip — an unused
// marker for "this is fake" is worse than none, because the next person to
// need one reaches for it and marks something that is actually live.

import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import type { DeviceState } from '@/lib/deviceKinds';

/**
 * The mark for a hub-backed item. Used where the reader needs the contrast
 * with an engine-backed or inert one beside it — never as decoration on a
 * screen where everything is the same kind of real.
 */
export function LiveChip({
  className,
  label = 'Hub',
  title = 'Served by your hub — a real device, real commands, real audit trail.',
}: {
  className?: string;
  label?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1.5 shrink-0 rounded-full border border-moss/35 bg-moss/10 px-2 py-0.5',
        'text-[9px] uppercase tracking-[0.16em] text-moss whitespace-nowrap',
        className,
      )}
    >
      <span className="h-1 w-1 rounded-full bg-moss" aria-hidden />
      {label}
    </span>
  );
}

/**
 * For a device the device engine reported (/v1/engine/devices).
 *
 * Real, like a hub row, and coloured the same — but named separately because
 * the two are not interchangeable to anyone debugging: a Hub row is an access
 * point or its paired controller on the signed-command path, an Engine row
 * came from a configured driver. Both are hardware; neither is a fixture.
 */
export function EngineChip({
  className,
  label = 'Engine',
  title = "Reported by the device engine on your hub — a real device, discovered by a configured driver. Not fixture data.",
}: {
  className?: string;
  label?: string;
  title?: string;
}) {
  return <LiveChip className={className} label={label} title={title} />;
}

/** A short "why this does nothing / where this came from" line. */
export function InertNote({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('text-xs text-ink/45 leading-relaxed', className)}>{children}</p>;
}

// 'unknown' is drawn hollow rather than as another filled grey dot: it means
// "the engine has not heard from this device", which a reader must be able to
// tell apart from 'off' (a device known to be off) and from 'alert' (a device
// known to be down) at a glance, not only by reading the label.
const STATE_DOT: Record<DeviceState, string> = {
  live: 'bg-moss',
  warn: 'bg-gold',
  alert: 'bg-terracotta',
  off: 'bg-ink/25',
  unknown: 'bg-transparent ring-1 ring-slate',
};

const STATE_LABEL: Record<DeviceState, string> = {
  live: 'reporting',
  warn: 'attention',
  alert: 'alert',
  off: 'off',
  unknown: 'not reported',
};

/**
 * Status is a coloured dot + a word — never colour alone (the dot repeats what
 * the label already says, so it survives colour-blindness and greyscale print).
 */
export function StateDot({ state, className }: { state: DeviceState; className?: string }) {
  return (
    <span
      className={cn('h-1.5 w-1.5 rounded-full shrink-0', STATE_DOT[state], className)}
      aria-hidden
    />
  );
}

export function StateLabel({ state }: { state: DeviceState }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs text-ink/70">
      <StateDot state={state} />
      {STATE_LABEL[state]}
    </span>
  );
}

/**
 * Single-hue magnitude bar. Colour carries no identity here — the row is
 * already named and its value directly labelled — so one accent is used for
 * every bar rather than a categorical palette (the warm token set has no
 * colour-blind-safe 3-way categorical split).
 */
export function Meter({
  fraction,
  idle = false,
  className,
}: {
  fraction: number;
  idle?: boolean;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, fraction * 100));
  return (
    <div className={cn('h-1.5 rounded-full bg-ink/8 overflow-hidden', className)}>
      <div
        className={cn('h-full rounded-full', idle ? 'bg-ink/20' : 'bg-terracotta')}
        style={{ width: `${Math.max(idle ? 0 : 2, pct)}%` }}
      />
    </div>
  );
}
