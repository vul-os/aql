// Package modbus is a read-only Modbus TCP driver for the device engine.
//
// Modbus is the protocol the industrial world actually runs on: energy meters,
// solar inverters, battery systems, PLCs, VFDs and building HVAC controllers
// nearly all speak it. That makes it the natural partner for internal/energy,
// whose poller reads devices.CapMeter devices through the registry. It is also a
// small binary protocol over TCP, so it costs no dependency: every byte of this
// package is standard library, no CGO.
//
// # TCP only, not RTU
//
// This driver speaks Modbus TCP (MBAP header + PDU over a stream socket) and
// NOT Modbus RTU or ASCII over a serial line. The omission is deliberate:
//
//   - RTU needs a serial port. A serial port is hardware, and hardware cannot be
//     stood up in a test. Everything below is exercised against a fake server on
//     a loopback listener; an RTU path would be the one part of this package
//     that ships untested, next to the parts that are.
//   - RTU framing is timing-based. A frame ends after 3.5 character times of
//     silence, which means correct framing depends on the host's scheduling
//     latency and on the USB-serial adapter's buffering. Getting that right
//     without a real bus to measure against produces code that looks correct and
//     mis-frames on contact.
//   - RTU carries a CRC-16 that TCP's MBAP does not, so the two share a PDU
//     layer but not a transport layer. Writing the PDU layer first — which is
//     what frame.go is — is the honest order to do this in.
//   - The common deployment already bridges. A serial meter on a site with a hub
//     is nearly always behind a Modbus TCP-to-RTU gateway, which this driver
//     talks to today: DeviceConfig.UnitID addresses the slave behind it, and the
//     gateway's own exception codes 0x0A/0x0B are mapped to
//     devices.ErrUnreachable precisely so "the gateway is up but the meter on the
//     bus is not" reads as unreachable and not as a device fault.
//
// # Read-only, and why that is structural rather than a promise
//
// This driver implements function codes 3 (read holding registers) and 4 (read
// input registers). It does not implement 6 or 16, and Driver.Execute returns
// devices.ErrUnsupported for every verb.
//
// It cannot be configured otherwise. Config accepts only capabilities whose
// entire verb set is devices.TierRead — today devices.CapMeter and
// devices.CapSensorReadCa (see readOnlyCaps) — and rejects anything else at
// startup. A device that never declares an actuable capability is a device the
// registry will never route an actuating verb to, because Registry.Resolve
// refuses a verb the device does not support. The read-only property therefore
// holds at config time, not at request time, and it does not depend on Execute
// remembering to refuse.
//
// The reason to draw the line here, rather than adding write support the way
// httpdev has actions:
//
//   - A Modbus register is an integer, not a name. An HTTP action is a URL a
//     vendor documented as an action ("/relay/1/on"); a register is address
//     0x1F4, and its meaning lives in a PDF. Address maps are routinely wrong in
//     the one way that matters — the "4x" convention numbers holding registers
//     from 40001, so a map saying 40100 means wire address 99, and vendors
//     disagree about whether their own documentation is already zero-based. A
//     one-off error in a read is a wrong number on a chart. A one-off error in a
//     write pokes a different live register.
//   - Function code 16 writes a RANGE. One wrong count does not write the wrong
//     value, it writes over the registers next to it, and on a PLC the registers
//     next to a setpoint are usually more setpoints.
//   - There is no acknowledgement of meaning. A write response echoes the
//     address and value the device accepted. It does not say what the plant did.
//   - The tier would come from whatever capability the operator typed. The
//     catalogue assigns the tier (devices.Tier is chosen in capability.go, never
//     by a driver), which is right — but the capability is chosen in config, and
//     for Modbus nothing in the protocol can contradict it. Declaring
//     devices.CapSwitch over a register that drives a contactor gets
//     TierReversible for something that is not reversible, and neither this
//     driver nor the registry can tell.
//
// None of that is unanswerable; it is answerable with a device to test against
// and a config shape that makes the hazard explicit. The answer is not in this
// change. What is in this change is the transaction layer that a write path
// would need, and the mapping it would have to use, written down: see
// Driver.Execute.
//
// # Decoding is the part that actually bites
//
// Modbus has no discovery, no types and no units. A register is sixteen bits,
// and everything else — whether two registers are one 32-bit number, whether it
// is signed, which register holds the high half, whether the bytes inside each
// register are swapped, and what to multiply the result by — is vendor
// convention that must be DECLARED. See Metric, RegisterType and WordOrder.
// WordOrder in particular exists because vendors genuinely disagree: the same
// 32-bit float is transmitted ABCD by one meter and CDAB by the next, the second
// being the notorious "word-swapped" or "mid-little" layout, and reading one as
// the other produces a plausible wrong number rather than an error.
//
// # Security, plainly
//
// Modbus has no authentication, no authorisation and no integrity protection.
// None. Anyone who can reach TCP/502 on a device can read every register and,
// with a five-line script, write them. This driver reading only does not change
// that; the network segment IS the trust boundary, and a Modbus device must
// never sit on a routable network. That is also why an address appears in this
// package's error strings where httpdev redacts one: there is no credential in a
// Modbus address to leak, and host:port is what an operator needs to fix a
// fault. devices.Health.Detail still names only device ids, per the seam.
//
// # What "it works" means here, precisely
//
// NOTHING IN THIS PACKAGE HAS EVER SEEN A METER. It was written against a fake
// server on a loopback listener that speaks MBAP. That proves the frames this
// package emits are parsed by the frames it expects, that every decode option
// decodes what it claims, and that every refusal path refuses. It does not prove
// any vendor agrees. The likely first-contact failures, in the order they
// usually bite: an address map that is off by one because of the 4x convention;
// a word order that is CDAB when the manual says ABCD; a device that accepts
// only one TCP connection and drops it after 10 seconds of idle rather than
// answering (handled — see endpoint.exchange — but the timeout that triggers the
// redial is a guess); and a gateway that returns 0x0B for a slave that is merely
// slow.
package modbus
