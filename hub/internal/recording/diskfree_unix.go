//go:build unix

package recording

import "golang.org/x/sys/unix"

// diskFree reports free and total bytes on the filesystem holding path.
//
// Bavail rather than Bfree: Bfree counts blocks reserved for root, which an
// unprivileged hub cannot use. Reporting those as free is how a "floor" is
// satisfied by space nothing can actually write to.
func diskFree(path string) (free, total int64, err error) {
	var st unix.Statfs_t
	if err := unix.Statfs(path, &st); err != nil {
		return 0, 0, err
	}
	return int64(st.Bavail) * int64(st.Bsize), int64(st.Blocks) * int64(st.Bsize), nil
}
