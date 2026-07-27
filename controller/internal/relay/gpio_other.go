//go:build gpio && !linux

package relay

// The GPIO character device is a Linux interface. Building with `-tags gpio`
// on any other OS still compiles (the config validation, state machine and
// uAPI packing are portable and their tests run here), but Open fails: there
// is no second backend and none is faked.
func openLines(cfg GPIOConfig) (lineHandle, lineHandle, error) {
	return nil, nil, ErrUnsupported
}
