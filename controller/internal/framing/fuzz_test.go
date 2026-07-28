package framing_test

import (
	"encoding/binary"
	"testing"

	"github.com/vul-os/aql/controller/internal/framing"
)

// The BLE reassembler, driven with chunks a stranger controls.
//
// Anyone in radio range can write to the `rx` characteristic — the grant that
// authenticates them is INSIDE the frame this code is assembling, so nothing
// has been verified at the point Push runs. A panic here kills the controller
// from the pavement outside, with no credential of any kind.
//
// The header is a 4-byte little-endian length, so the interesting inputs are
// the obvious hostile ones: a length of 0xFFFFFFFF, a length that overflows
// when added to an offset, a header split across two writes, a frame that
// claims more than MaxFrame, and a stream that never completes. A fuzzer
// reaches those far faster than a person enumerating them.
//
// Two properties beyond "does not panic", both of which are memory bounds
// rather than correctness:
//
//   - A declared length over MaxFrame must be REFUSED, not allocated. The
//     package maps that to frame_too_large and drops the connection; a
//     reassembler that believed the header first would let a stranger ask for
//     4 GiB on a Raspberry Pi.
//   - Total bytes returned may never exceed total bytes fed in. Reassembly
//     that can amplify is reassembly that can be used to exhaust memory with a
//     small write.

func FuzzReassemblerPush(f *testing.F) {
	frame := func(payload string) []byte {
		b := make([]byte, framing.HeaderSize+len(payload))
		binary.LittleEndian.PutUint32(b, uint32(len(payload)))
		copy(b[framing.HeaderSize:], payload)
		return b
	}

	f.Add(frame(`{"typ":"grant.open"}`))
	f.Add(frame(``))
	f.Add([]byte{0xFF, 0xFF, 0xFF, 0xFF})                   // 4 GiB declared
	f.Add([]byte{0x00, 0x00, 0x00, 0x80})                   // 2 GiB, sign-bit territory
	f.Add([]byte{0x01, 0x00, 0x00, 0x00})                   // declares 1 byte, sends none
	f.Add([]byte{0x00, 0x20})                               // header split mid-way
	f.Add(append(frame(`{}`), frame(`{}`)...))              // two frames in one write
	f.Add(append([]byte{0xFF, 0x7F, 0x00, 0x00}, 'x', 'y')) // over MaxFrame, under 32 bits

	f.Fuzz(func(t *testing.T, chunk []byte) {
		r := framing.NewReassembler()

		// Fed in slices of varying size, because the defect this codec is most
		// likely to have is at a chunk BOUNDARY — a header split across two
		// writes, a payload ending exactly on one. A single Push of the whole
		// buffer would never exercise that.
		for _, size := range []int{1, 3, 7, 23, len(chunk)} {
			if size <= 0 {
				continue
			}
			r.Abort()
			fed, got := 0, 0
			for off := 0; off < len(chunk); off += size {
				end := off + size
				if end > len(chunk) {
					end = len(chunk)
				}
				fed += end - off
				msgs, err := r.Push(chunk[off:end])
				if err != nil {
					// Messages ALONGSIDE an error are legitimate, and the
					// fuzzer taught me that: `02 00 00 00 3030 30303030` is a
					// complete 2-byte frame followed by four bytes read as a
					// header declaring 771 MiB. Push returns the completed
					// message and frame_too_large together.
					//
					// That is safe because blesession checks the error FIRST
					// and drops without touching the messages — a coupling
					// nothing tested until this input appeared, and one the
					// existing frame_too_large test could not catch because it
					// sends an oversized header alone, with no completed frame
					// in front of it. See TestValidFrameFollowedByAnOversized-
					// HeaderIsNotProcessed.
					//
					// So the assertion here is only that the messages returned
					// are themselves sane; whether the caller acts on them is
					// the caller's contract, tested where it lives.
					for _, m := range msgs {
						if len(m) > framing.MaxFrame {
							t.Fatalf("returned a %d-byte message alongside %v", len(m), err)
						}
						got += len(m)
					}
					break
				}
				for _, m := range msgs {
					if len(m) > framing.MaxFrame {
						t.Fatalf("reassembled a %d-byte message; MaxFrame is %d",
							len(m), framing.MaxFrame)
					}
					got += len(m)
				}
			}
			// No amplification: a reassembler that returns more than it was
			// given is one a stranger can use to exhaust memory cheaply.
			if got > fed {
				t.Fatalf("chunk size %d: returned %d bytes from %d fed in", size, got, fed)
			}
		}
	})
}

// Chunk is the other half of the codec. It handles data this controller is
// SENDING, so it is not attacker-controlled — but a round trip is the strongest
// statement available about the pair, and it costs one target.
func FuzzChunkRoundTrip(f *testing.F) {
	f.Add([]byte(`{"typ":"grant.result","result":"opened"}`), 23)
	f.Add([]byte(``), 5)
	f.Add([]byte(`x`), framing.HeaderSize+1)

	f.Fuzz(func(t *testing.T, msg []byte, mtu int) {
		if mtu <= framing.HeaderSize || mtu > 1024 || len(msg) > framing.MaxFrame {
			t.Skip()
		}
		chunks, err := framing.Chunk(msg, mtu)
		if err != nil {
			return
		}
		r := framing.NewReassembler()
		var out [][]byte
		for _, c := range chunks {
			if len(c) > mtu {
				t.Fatalf("Chunk produced a %d-byte chunk for an MTU of %d", len(c), mtu)
			}
			got, err := r.Push(c)
			if err != nil {
				t.Fatalf("a frame this package produced was refused by its own reassembler: %v", err)
			}
			out = append(out, got...)
		}
		if len(out) != 1 {
			t.Fatalf("round trip produced %d messages, want exactly 1", len(out))
		}
		if string(out[0]) != string(msg) {
			t.Fatalf("round trip changed the payload:\n got %q\nwant %q", out[0], msg)
		}
		if r.Partial() {
			t.Fatal("the reassembler still reports a partial frame after a complete round trip")
		}
	})
}
