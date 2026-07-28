package store

import (
	"context"
	"database/sql"
	"errors"
)

// Member is one row of an account's member roster (backend
// app.account_member_list shape: membership joined with user + profile).
type Member struct {
	UserID      string
	Role        string
	Status      string
	Username    string
	DisplayName string // "" when the profile has none

	// ActiveGrantsIssued counts the temporary access grants this member has
	// handed out that are still live.
	//
	// It is here because removing a member does NOT revoke them: grant
	// consumption keys on the visitor's phone and the access point, and never
	// looks at who issued it. That is deliberate — a departing concierge's
	// visitors should not be locked out mid-visit — but it means offboarding
	// alone can leave doors open that the removed member opened, and an
	// operator who is not told will not think to look.
	ActiveGrantsIssued int
}

// MemberList returns the full roster for an account. Handlers must gate on
// membership first (the caller sees co-members only for accounts they belong
// to — the SECURITY DEFINER helper's self-gate, done in the HTTP layer here).
func (s *Store) MemberList(ctx context.Context, accountID string) ([]Member, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT am.user_id, am.role, am.status, u.username, coalesce(p.display_name, ''),
		        (SELECT count(*) FROM temporary_access_grants g
		          WHERE g.account_id = am.account_id
		            AND g.granted_by_user_id = am.user_id
		            AND g.status = 'active' AND g.ends_at > ?)
		 FROM account_members am
		 JOIN users u ON u.id = am.user_id
		 LEFT JOIN profiles p ON p.id = am.user_id
		 WHERE am.account_id = ?
		 ORDER BY am.joined_at ASC`, now(), accountID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Member
	for rows.Next() {
		var m Member
		if err := rows.Scan(&m.UserID, &m.Role, &m.Status, &m.Username, &m.DisplayName,
			&m.ActiveGrantsIssued); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// upsertAccountMember mirrors the backend's ON CONFLICT DO UPDATE on
// account_members: role is replaced and status re-activated.
func upsertAccountMember(ctx context.Context, tx *sql.Tx, accountID, userID, role string) error {
	t := now()
	_, err := tx.ExecContext(ctx,
		`INSERT INTO account_members (account_id, user_id, role, status, joined_at, created_at, updated_at)
		 VALUES (?, ?, ?, 'active', ?, ?, ?)
		 ON CONFLICT (account_id, user_id) DO UPDATE SET
		     role = excluded.role, status = 'active', updated_at = excluded.updated_at`,
		accountID, userID, role, t, t, t)
	return err
}

// upsertLocationMembersForAccount adds the user to every location of the
// account (invite-accept semantics).
func upsertLocationMembersForAccount(ctx context.Context, tx *sql.Tx, accountID, userID, role string) error {
	t := now()
	_, err := tx.ExecContext(ctx,
		`INSERT INTO location_members (location_id, user_id, role, created_at, updated_at)
		 SELECT id, ?, ?, ?, ? FROM locations WHERE account_id = ?
		 ON CONFLICT (location_id, user_id) DO UPDATE SET
		     role = excluded.role, updated_at = excluded.updated_at`,
		userID, role, t, t, accountID)
	return err
}

// UpsertLocationMember adds (or re-roles) one user on one location.
func (s *Store) UpsertLocationMember(ctx context.Context, locationID, userID, role string) error {
	t := now()
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO location_members (location_id, user_id, role, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT (location_id, user_id) DO UPDATE SET
		     role = excluded.role, updated_at = excluded.updated_at`,
		locationID, userID, role, t, t)
	return err
}

var (
	// ErrLastOwner: the removal would leave the account with no active owner.
	// Nobody could then re-invite, re-role, or remove anyone — the account is
	// administratively dead, and there is no route in the product to revive it.
	ErrLastOwner = errors.New("last_owner")

	// ErrOwnerRemovalRequiresOwner: an admin tried to remove an owner. Admins
	// hold every other power in the account; letting them evict owners would
	// make "admin" and "owner" the same role, one removal at a time.
	ErrOwnerRemovalRequiresOwner = errors.New("owner_removal_requires_owner")
)

// RemoveAccountMember revokes a membership. It returns the removed member's
// role, for the caller's audit record.
//
// Revocation is a status flip, not a delete, and that is the whole mechanism:
// every gate in the product already reads `status = 'active'`, so one write
// closes all of them at once.
//
//   - the console — MemberRole backs every account-scoped handler;
//   - API tokens — VerifyAPIToken re-joins account_members on each call
//     ("if this row is gone, so is the token's authority, with no sweep
//     required"), so a revoked member's tokens stop working immediately
//     rather than living out their expiry;
//   - chat — the phone and channel lookups in channels.go join
//     `am.status = 'active'`, so a removed member's texts stop opening gates.
//
// Keeping the row is what lets a later re-invite reactivate it (the upsert
// sets status back to 'active') and what leaves the roster showing that the
// person was once here. location_members has no status column, so there is no
// soft state to set there and the rows are deleted outright — leaving them
// would be a latent grant waiting for whoever adds the first location-level
// check.
//
// actorRole is passed in rather than checked by the handler because the
// last-owner and owner-removal rules must be evaluated against the same
// snapshot as the write. Checked outside, two concurrent removals could each
// see two owners and both proceed.
func (s *Store) RemoveAccountMember(ctx context.Context, accountID, targetUserID, actorRole string) (string, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()

	var role string
	err = tx.QueryRowContext(ctx,
		`SELECT role FROM account_members
		 WHERE account_id = ? AND user_id = ? AND status = 'active'`,
		accountID, targetUserID).Scan(&role)
	if err != nil {
		return "", err // ErrNotFound for an unknown or already-revoked member
	}

	if role == "owner" {
		if actorRole != "owner" {
			return "", ErrOwnerRemovalRequiresOwner
		}
		var owners int
		if err := tx.QueryRowContext(ctx,
			`SELECT count(*) FROM account_members
			 WHERE account_id = ? AND role = 'owner' AND status = 'active'`,
			accountID).Scan(&owners); err != nil {
			return "", err
		}
		if owners <= 1 {
			return "", ErrLastOwner
		}
	}

	if _, err := tx.ExecContext(ctx,
		`UPDATE account_members SET status = 'revoked', updated_at = ?
		 WHERE account_id = ? AND user_id = ?`, now(), accountID, targetUserID); err != nil {
		return "", err
	}
	if _, err := tx.ExecContext(ctx,
		`DELETE FROM location_members
		 WHERE user_id = ? AND location_id IN (SELECT id FROM locations WHERE account_id = ?)`,
		targetUserID, accountID); err != nil {
		return "", err
	}
	if err := tx.Commit(); err != nil {
		return "", err
	}
	return role, nil
}

// RenameAccount updates the account name; ErrNotFound when the id is unknown.
// Tenancy: handlers only call this after an admin-role gate on accountID.
func (s *Store) RenameAccount(ctx context.Context, accountID, name string) error {
	res, err := s.db.ExecContext(ctx,
		`UPDATE accounts SET name = ?, updated_at = ? WHERE id = ?`, name, now(), accountID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}
