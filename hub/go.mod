module github.com/vul-os/aql/hub

go 1.25.6

require (
	golang.org/x/crypto v0.54.0
	modernc.org/sqlite v1.54.0
)

require (
	github.com/dustin/go-humanize v1.0.1 // indirect
	github.com/mattn/go-isatty v0.0.20 // indirect
	github.com/ncruces/go-strftime v1.0.0 // indirect
	github.com/remyoudompheng/bigfft v0.0.0-20230129092748-24d4a6f8daec // indirect
	modernc.org/libc v1.74.1 // indirect
	modernc.org/mathutil v1.7.1 // indirect
	modernc.org/memory v1.11.0 // indirect
)

require (
	github.com/coder/websocket v1.8.15
	github.com/google/uuid v1.6.0
	github.com/vul-os/aql/jcs v0.0.0
	golang.org/x/sys v0.47.0
)

// The shared canonicalizer lives in this repo, alongside this module. There
// is no published version of it and there does not need to be: every consumer
// is in the same working tree.
replace github.com/vul-os/aql/jcs => ../jcs
