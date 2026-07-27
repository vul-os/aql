package main

import (
	"log/slog"
	"os"
	"sort"
	"strings"
	"sync"
)

// Environment-variable naming, and why there are two of them.
//
// Every operator-facing variable is AQL_*. They used to be AQL_*, from
// before this repo absorbed lintel and became Aql, and an operator was left
// typing the name of a product that no longer exists to configure one that
// does.
//
// The old names still work. That is not indecision — an env var is part of a
// running install's configuration, and renaming one without a fallback breaks
// every deployment on upgrade with a symptom ("the energy poller stopped") that
// points nowhere near the cause ("a variable was renamed"). A silent fallback
// would be almost as bad: the install keeps working and nobody ever learns to
// migrate. So the fallback works AND says so, once per variable, at WARN.
//
// The deprecation is deliberately unbounded here. Removing the fallback is a
// breaking change for someone, and it should happen in a release that says so
// rather than as a side effect of a rename.

const (
	envPrefix       = "AQL_"
	legacyEnvPrefix = "LINTEL_"
)

var (
	legacyEnvMu   sync.Mutex
	legacyEnvSeen = map[string]string{} // legacy name -> current name
)

// lookupEnv resolves an AQL_* variable, falling back to its AQL_*
// predecessor and recording the use.
//
// A key without the AQL_ prefix is read verbatim: not everything this binary
// reads is ours (TZ, HOME, and the chat rails' own vendor-named variables).
func lookupEnv(key string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	if !strings.HasPrefix(key, envPrefix) {
		return ""
	}
	legacy := legacyEnvPrefix + strings.TrimPrefix(key, envPrefix)
	v := os.Getenv(legacy)
	if v == "" {
		return ""
	}
	legacyEnvMu.Lock()
	legacyEnvSeen[legacy] = key
	legacyEnvMu.Unlock()
	return v
}

// warnLegacyEnv logs every legacy variable that was actually used, once, after
// configuration is resolved.
//
// One line listing all of them rather than a line each: an operator upgrading a
// box that sets eight of these should get something they can act on in one
// read, not eight warnings interleaved with startup logging.
func warnLegacyEnv(log *slog.Logger) {
	legacyEnvMu.Lock()
	defer legacyEnvMu.Unlock()
	if len(legacyEnvSeen) == 0 {
		return
	}
	pairs := make([]string, 0, len(legacyEnvSeen))
	for legacy, current := range legacyEnvSeen {
		pairs = append(pairs, legacy+" -> "+current)
	}
	sort.Strings(pairs)
	log.Warn("deprecated environment variables in use; they still work, but the "+
		"AQL_ names are the supported ones and these will eventually be removed",
		"rename", strings.Join(pairs, ", "))
}
