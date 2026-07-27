// Package energy is Aql's metering engine: it polls devices declaring the
// CapMeter capability, persists their raw readings, derives energy from them,
// summarises that into hourly/daily/monthly rollups, and attributes the result
// across grid, solar and battery.
//
// # The rule the whole package is built around
//
// A measurement system that quietly invents numbers is worse than no
// measurement system, because a wrong number is acted on and a missing one is
// investigated. Every design decision below follows from that:
//
//   - A gap is not a zero. A period with no evidence has a nil KWh, quality
//     [QualityEmpty], and zero coverage. It is impossible to render it as a
//     confident low bar without dereferencing a nil pointer first.
//   - A partially covered period is a floor, not a total. [Bucket.GapSeconds]
//     is non-zero and quality is [QualityPartial]. The true figure is higher.
//   - Interpolation is always labelled. When the engine fills a gap it records
//     the filled amount in EstimatedKWh and sets quality [QualityEstimated].
//     KWh minus EstimatedKWh is the part that was actually measured.
//   - A counter that goes backwards is a reset or a rollover, never negative
//     energy. See "Counters" below.
//   - Attribution is declared, never guessed from a device's name. A channel
//     nobody has classified is [SourceUnattributed] and is reported as its own
//     bucket rather than folded into grid.
//
// # Channels
//
// A channel is one (device key, metric) pair — a single reading stream. Meters
// commonly expose several: an inverter reporting kwh_charge and kwh_discharge
// is two channels, which is the only way a battery's two directions can be
// attributed opposite flows. A channel is either:
//
//	KindCounter — a cumulative kWh register. Energy is the difference between
//	              consecutive readings.
//	KindPower   — an instantaneous kW reading. Energy is the trapezoid between
//	              consecutive readings.
//
// That distinction changes what a gap means, and the engine treats the two
// differently on purpose:
//
//	A comms gap on a COUNTER loses time resolution but not energy. The next
//	reading still contains everything that happened while nobody was
//	listening. The total across the gap is known; only its distribution in
//	time is not. So the engine spreads it by time and marks every bucket it
//	touched as estimated.
//
//	A comms gap on a POWER channel loses the energy outright. No later sample
//	recovers it, and any shape drawn across the gap is fiction. So the engine
//	produces nothing for it: the buckets stay uncovered and report a gap.
//
// # Counters wrap and reset
//
// A meter reporting kWh-since-install rolls over at its register width and
// restarts at zero after a power loss or a replacement. Both look like the
// counter going backwards, and neither is negative energy.
//
//   - If the channel declares CounterMax and the implied rollover is plausible
//     against MaxKW, it is a wrap: kwh = CounterMax - from + to, quality
//     [DeltaWrap].
//   - Otherwise it is a reset: kwh = to, quality [DeltaReset]. That figure is a
//     LOWER BOUND — whatever accumulated between the previous reading and the
//     reset instant is gone and cannot be recovered from anything the meter
//     will say later. Every rollup containing a reset is downgraded to
//     [QualityPartial] however complete its coverage looks.
//
// With no declared CounterMax the two cannot be told apart, so the engine calls
// it a reset and accepts the lower bound rather than inventing a rollover
// point.
//
// # Clocks and ordering
//
// Samples are keyed on the reading's own At, not on arrival order. Nothing
// assumes samples arrive in order: a late sample landing between two already
// processed ones causes the deltas around it to be re-derived, and the buckets
// it touches to be re-rolled. A reading whose At is zero is stamped by the
// gateway and recorded as AtSourceGateway, because a sample timestamped by the
// receiver is weaker evidence than one timestamped by the meter and a dispute
// should be able to see which it has.
//
// # Incremental rollups
//
// Ingest marks the hour buckets a new or re-derived delta touches in
// energy_rollup_dirty. [Store.Rollup] drains that queue, recomputes only those
// hours, and re-derives the covering day and month from them. Reads never
// recompute. The marks are durable rows rather than an in-memory set so an
// interrupted pass resumes instead of leaving a stale bucket behind.
//
// # What this package does not do
//
// It does not actuate. CapMeter offers only `read` at TierRead; nothing here
// is on a command path. It does not price energy, and it does not decide what
// a tariff period is.
package energy
