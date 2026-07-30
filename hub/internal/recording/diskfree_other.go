//go:build !unix

package recording

import "errors"

// diskFree is unavailable off unix. The caller treats a measurement failure as
// "proceed but warn", so a hub on such a platform records without a disk floor
// and says so on every check rather than pretending one is enforced.
func diskFree(string) (int64, int64, error) {
	return 0, 0, errors.New("recording: free-space measurement is not implemented on this platform")
}
