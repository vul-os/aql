// Package camera is the first honest step of Aql's camera pipeline. It finds
// ONVIF cameras on the local network, reports whether each one answers, and
// asks each one where its stream would come from. It moves no pixels.
//
// # What it does
//
//   - WS-Discovery. A SOAP Probe datagram to the ONVIF discovery group
//     (239.255.255.250:3702) and a parse of the ProbeMatch replies: endpoint
//     reference, device-service address, and the scopes that carry a camera's
//     name, location and hardware string. Standard-library UDP, standard-library
//     XML, nothing else.
//   - A devices.Driver over what it found, declaring devices.CapCameraFeed —
//     which is a STATUS-ONLY capability. Its single verb is `status`, at
//     devices.TierRead. This driver cannot actuate a camera because the
//     catalogue hands it nothing to actuate with, and it does not ask for more.
//   - Stream-address resolution. GetCapabilities (with a GetServices fallback)
//     to find the media service, GetProfiles to enumerate the encoder profiles,
//     GetStreamUri to ask for the RTP-over-RTSP address of one profile. The
//     answer is recorded as a devices.Reading and shown to an operator. Nothing
//     ever connects to it.
//
// # What it does NOT do, and will not do without hardware
//
// No decoding. No transcoding. No recording. No live view. No snapshots. No
// ffmpeg, no CGO, no external dependency of any kind — every byte of this
// package is standard library.
//
// There IS an RTSP client (rtsp.go), and it does two things, both bounded.
//
// DESCRIBE: open, authenticate — digest, or basic where a camera offers nothing
// else — ask what the stream is, parse the SDP, disconnect. Holds no session.
//
// And, opt-in, a MEDIA-FLOW probe: SETUP the video track over interleaved TCP,
// PLAY, count RTP packets for a couple of seconds, TEARDOWN. It answers what
// DESCRIBE cannot — whether anything actually comes out — because a camera that
// describes a good stream and sends nothing is an ordinary failure whose only
// symptom is a black player. It always tears down: cheap cameras support very
// few sessions and one held by a health check competes with a real viewer.
//
// It COUNTS packets. It decodes none. That line is exactly where it is because
// RTP framing and the RTP header are specified tightly enough that a test can
// serve them faithfully, and H.264 depacketization is not: FU-A fragmentation,
// STAP-A aggregation and parameter-set handling vary between real cameras in
// ways a fake written from the same RFC would simply agree with. Everything
// above the packet counter waits for a camera to develop against.
//
// That one request is the difference between "ONVIF handed us a URL" and "that
// URL streams H264 and these credentials work on it", which is the question
// someone wiring up a camera actually has. Cameras routinely want a different
// account on the media leg than on the device service, and without a probe an
// operator discovers that in VLC rather than from this product. It is off by
// default (Config.VerifyStream) on cost grounds, not safety ones.
//
// That boundary is a decision, not an oversight. Everything above is testable
// without a camera — a Probe is a datagram and a parse, and the media calls are
// HTTP requests to a server a test can stand up in-process. Decoding and
// recording are not. They need a real camera to develop against — an RTSP media
// client and an fMP4 writer are not things to write blind, and code written that
// way compiles, passes tests built on its own assumptions, and fails the first
// time it meets hardware.
//
// The OTHER half of that blocker is gone. "A storage design this repository does
// not have" was true for a long time and is not now: docs/CAMERA-RETENTION.md
// settles where clips live, how long they last, who may watch, what a full disk
// does, and what a resident is told when retention drops the evening they cared
// about. Read it before adding anything here that stores a frame — recording is
// a data-retention policy with a UI attached, and the policy is decided.
//
// # What "it works" means here, precisely
//
// NOTHING IN THIS PACKAGE HAS EVER SEEN A CAMERA. It was written and tested
// against fakes: a UDP socket on loopback that replies with captured-shape
// ProbeMatch XML, and an httptest server that replies with captured-shape SOAP.
// That proves the request shapes this package EMITS parse the reply shapes it
// EXPECTS, and that every refusal path refuses. It does not prove that any real
// camera agrees with either. The likely first-contact failures, in the order
// they usually bite:
//
//   - A vendor whose GetCapabilities answer omits the media XAddr, so
//     resolution falls through to GetServices — implemented, also untested
//     against hardware.
//   - A camera that ignores WS-Security UsernameToken and answers 401 with
//     `WWW-Authenticate: Digest`. This package does NOT implement HTTP Digest
//     and will report the credentials as rejected. That gap is deliberate: a
//     Digest implementation written against no server is a guess.
//   - Media2 (the ver20 media service used by Profile T devices). Not
//     implemented. Cameras that offer only Media2 will resolve no stream
//     address, and will still report reachability honestly.
//   - A camera whose ProbeMatch omits an EndpointReference, which this package
//     drops because it has no stable identity to key on.
//
// # Why the refusals are the interesting part
//
// Two rules here are security properties, not conveniences, and both are on by
// default:
//
//   - A ProbeMatch is only believed if it relates to the probe this hub sent
//     (its wsa:RelatesTo must echo our MessageID). Discovery is unauthenticated
//     multicast; without this, anything on the LAN can inject a camera into the
//     hub's inventory by shouting at the right moment.
//   - A camera may only advertise ITSELF. The service address in a ProbeMatch
//     must be a literal IP equal to the packet's source, and the media address
//     and stream address a camera returns must stay on that same host. Without
//     that, a device on the LAN can point the hub — and the hub's stored
//     credentials for that camera — at any host it likes.
//
// Both have config escape hatches (see DiscoveryConfig and Config) because
// port-forwarded and NAT'd deployments genuinely break them, and both escape
// hatches are named for what they give up.
//
// # Security, plainly
//
// ONVIF authentication here is the WS-Security UsernameToken digest that
// Profile S mandates: base64(sha1(nonce || created || password)). SHA-1 is not
// a choice this package made; it is what the profile specifies. Over plaintext
// HTTP — which is what essentially every camera on a LAN speaks — anyone on the
// path can capture that digest with its nonce and mount an offline dictionary
// attack on the camera password. Set Config.RequireHTTPS when the fleet
// supports it. Camera passwords are held in memory only, never logged, never
// placed in a Health.Detail, a Summary or an error string.
//
// # Tripwire
//
// scripts/check-feature-claims.mjs greps hub/internal for
// RTSP|rtsp://|ffmpeg|onvif and fails while the docs still call the camera
// pipeline planned. This package trips it on purpose. The correct response is
// to make the docs say what this package actually is — discovery, reachability
// and stream-address resolution, with no live view and no recording — not to
// soften the check.
package camera
