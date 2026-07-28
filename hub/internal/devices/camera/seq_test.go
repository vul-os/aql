package camera

import "testing"

// Loss counting, against the three things real networks do that break the naive
// version. Each case here is a stream a camera actually produces; getting any
// of them wrong makes the number worse than not reporting one, because an
// operator would act on it.

func observeAll(t *testing.T, ssrc uint32, seqs ...uint16) seqSet {
	t.Helper()
	s := seqSet{}
	for _, q := range seqs {
		s.observe(ssrc, q)
	}
	return s
}

func TestNoLossOnAContiguousRun(t *testing.T) {
	s := observeAll(t, 1, 100, 101, 102, 103, 104)
	exp, recv, lost, restarts := s.totals()
	if exp != 5 || recv != 5 || lost != 0 || restarts != 0 {
		t.Errorf("contiguous run: expected=%d received=%d lost=%d restarts=%d, want 5/5/0/0",
			exp, recv, lost, restarts)
	}
}

func TestGapIsCountedAsLoss(t *testing.T) {
	// 102 and 103 never arrived.
	s := observeAll(t, 1, 100, 101, 104, 105)
	exp, recv, lost, _ := s.totals()
	if exp != 6 || recv != 4 || lost != 2 {
		t.Errorf("gap: expected=%d received=%d lost=%d, want 6/4/2", exp, recv, lost)
	}
}

// The 16-bit sequence wraps every 65536 packets — roughly every half-minute on
// a busy stream. A tracker that reads the wrap as a backwards jump reports a
// catastrophic loss on a perfectly healthy camera, twice a minute.
func TestWrapAroundIsNotLoss(t *testing.T) {
	s := observeAll(t, 1, 65533, 65534, 65535, 0, 1, 2)
	exp, recv, lost, restarts := s.totals()
	if lost != 0 {
		t.Errorf("wraparound reported %d lost across 65535→0; expected=%d received=%d",
			lost, exp, recv)
	}
	if restarts != 0 {
		t.Errorf("wraparound was read as %d source restart(s)", restarts)
	}
	if exp != 6 || recv != 6 {
		t.Errorf("wraparound: expected=%d received=%d, want 6/6", exp, recv)
	}
}

// A late packet is not a lost one. Counting it as loss and then un-counting it
// makes the answer depend on when you looked.
func TestReorderingIsNotLoss(t *testing.T) {
	s := observeAll(t, 1, 100, 102, 101, 103)
	exp, recv, lost, _ := s.totals()
	if lost != 0 {
		t.Errorf("reordered arrival reported %d lost; expected=%d received=%d", lost, exp, recv)
	}
}

// Some networks duplicate. More received than the range implies is not
// negative loss.
func TestDuplicatesNeverProduceNegativeLoss(t *testing.T) {
	s := observeAll(t, 1, 100, 101, 101, 101, 102)
	exp, recv, lost, _ := s.totals()
	if lost != 0 {
		t.Errorf("duplicates reported %d lost; expected=%d received=%d", lost, exp, recv)
	}
	if recv != 5 || exp != 3 {
		t.Errorf("duplicates: expected=%d received=%d, want 3/5", exp, recv)
	}
}

// A camera that restarts its stream mid-probe jumps to a fresh sequence base.
// Reported as a restart rather than folded into loss: it is a different fault
// with a different fix, and a five-figure "loss" would be an artefact.
func TestSourceRestartIsNotAHugeLoss(t *testing.T) {
	s := observeAll(t, 1, 100, 101, 102, 40000, 40001)
	exp, recv, lost, restarts := s.totals()
	if restarts != 1 {
		t.Errorf("restarts = %d, want 1", restarts)
	}
	if lost > 2 {
		t.Errorf("a source restart was reported as %d lost packets (expected=%d received=%d)",
			lost, exp, recv)
	}
}

// Two sources on one channel are two independent sequence spaces. Interleaving
// them manufactures loss that is not there — and multiplexing is itself
// something MediaFlow already flags separately.
func TestSourcesAreTrackedIndependently(t *testing.T) {
	s := seqSet{}
	for _, p := range []struct {
		ssrc uint32
		seq  uint16
	}{
		{1, 100}, {2, 9000}, {1, 101}, {2, 9001}, {1, 102}, {2, 9002},
	} {
		s.observe(p.ssrc, p.seq)
	}
	exp, recv, lost, _ := s.totals()
	if lost != 0 {
		t.Errorf("interleaved sources reported %d lost; expected=%d received=%d", lost, exp, recv)
	}
	if exp != 6 || recv != 6 {
		t.Errorf("two sources: expected=%d received=%d, want 6/6", exp, recv)
	}
}

func TestEmptyProbeReportsNothing(t *testing.T) {
	exp, recv, lost, restarts := seqSet{}.totals()
	if exp != 0 || recv != 0 || lost != 0 || restarts != 0 {
		t.Errorf("empty probe: %d/%d/%d/%d, want zeros", exp, recv, lost, restarts)
	}
}

// The two questions must stay distinguishable. This is the whole reason the
// field exists: a stream can be flowing and not intact, and a packet counter
// alone reports that as healthy.
func TestFlowingAndIntactAreDifferentQuestions(t *testing.T) {
	lossy := MediaFlow{Packets: 60, Expected: 100, Lost: 40}
	if !lossy.Flowing() {
		t.Error("60 packets arrived but Flowing() is false")
	}
	if lossy.Intact() {
		t.Error("a stream missing 40% of its packets reported Intact()")
	}
	if got := lossy.LossRate(); got < 0.39 || got > 0.41 {
		t.Errorf("LossRate() = %v, want ~0.4", got)
	}

	clean := MediaFlow{Packets: 100, Expected: 100, Lost: 0}
	if !clean.Intact() {
		t.Error("a complete stream did not report Intact()")
	}

	silent := MediaFlow{}
	if silent.Intact() {
		t.Error("a stream with no packets at all reported Intact(); nothing arrived to be intact")
	}
	if silent.LossRate() != 0 {
		t.Errorf("LossRate() with nothing expected = %v, want 0", silent.LossRate())
	}
}
