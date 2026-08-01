package store

import "context"

// AnyDevicePaired reports whether this hub has ever completed a pairing.
//
// It exists for one caller and one decision: whether the hub may MINT a new
// signing identity at startup. keys.Load generates one when the seed file is
// absent, which is right on a first boot and catastrophic afterwards — a paired
// controller pins the old public key, so a fresh identity means every command
// it is sent fails `badsig`, and the repair that would move it must be signed
// by the key that is gone. Recovery is physically re-pairing every controller.
//
// A device row alone is not the test: an unpaired device is a claim token
// nobody has redeemed, and a hub that got that far and lost its key has lost
// nothing that cannot be re-issued from the console. Redeeming the claim is the
// point of no return, because that is when a controller PINS this hub's key.
//
// Keyed on `paired_at`, not on status. The first version of this asked for
// `status = 'paired'`, a value nothing in the product ever writes — RedeemClaim
// sets `status = 'active'` and stamps `paired_at`. It matched nothing, and the
// unit test agreed with it because the fixture wrote the same invented value;
// only running a REAL controller against a REAL hub showed the guard was inert.
// paired_at is also the more durable fact: a device disabled later has still
// been paired, and its controller still pins the key.
func (s *Store) AnyDevicePaired(ctx context.Context) (bool, error) {
	var n int
	err := s.db.QueryRowContext(ctx,
		`SELECT count(*) FROM devices WHERE paired_at IS NOT NULL LIMIT 1`).Scan(&n)
	if err != nil {
		return false, err
	}
	return n > 0, nil
}
