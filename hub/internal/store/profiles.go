package store

import (
	"context"
	"database/sql"
	"errors"
)

// Profile is the display half of a user: what other members see.
//
// The row is created with the user (see CreateUser) and has existed in the
// baseline schema since 0001. Nothing ever read it back or updated it, so the
// console's profile form posted to a route that did not exist and could not
// save — this is the missing half, not a new feature.
//
// AvatarSource is deliberately narrow. The baseline CHECK still permits
// 'google' because that value is part of a shipped schema and dropping it
// would rewrite a table for no behavioural gain; nothing writes it any more,
// and ProfileGet maps anything that is not 'user' to empty. That keeps the
// console's narrowed type honest whatever an old row happens to hold.
type Profile struct {
	UserID       string
	DisplayName  string
	AvatarURL    string
	AvatarSource string // "user" or ""
}

// ErrProfileMissing means the user has no profile row.
//
// It should not happen — CreateUser writes both in one transaction — but a
// database restored from a partial backup, or a user inserted by hand, can
// produce it. Callers get a distinguishable error rather than a zero Profile
// that reads as "this user has no display name".
var ErrProfileMissing = errors.New("store: profile row missing for user")

// ProfileGet reads one user's profile.
func (s *Store) ProfileGet(ctx context.Context, userID string) (*Profile, error) {
	var p Profile
	var name, avatar, source sql.NullString
	err := s.db.QueryRowContext(ctx,
		`SELECT display_name, avatar_url, avatar_source FROM profiles WHERE id = ?`,
		userID,
	).Scan(&name, &avatar, &source)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrProfileMissing
	}
	if err != nil {
		return nil, err
	}
	p.UserID = userID
	p.DisplayName = name.String
	p.AvatarURL = avatar.String
	if source.String == "user" {
		p.AvatarSource = "user"
	}
	return &p, nil
}

// ProfileUpdate applies a partial update and returns the row as it now stands.
//
// Both parameters are pointers so that "not mentioned" and "set to empty" stay
// distinguishable all the way down from the JSON body: PATCH with only a
// display name must not silently clear an avatar. A nil pointer leaves the
// column alone; a pointer to "" clears it.
//
// avatar_source follows avatar_url rather than being settable on its own —
// there is exactly one way an avatar gets here (a person typed a URL), so
// letting a client assert the source would be letting it assert something it
// cannot know.
func (s *Store) ProfileUpdate(ctx context.Context, userID string, displayName, avatarURL *string) (*Profile, error) {
	ts := now()

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	// Existence is checked inside the transaction so that "no such user" is a
	// clean ErrProfileMissing rather than an UPDATE that reports zero rows for
	// a reason the caller has to guess at.
	var exists int
	if err := tx.QueryRowContext(ctx, `SELECT 1 FROM profiles WHERE id = ?`, userID).Scan(&exists); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrProfileMissing
		}
		return nil, err
	}

	if displayName != nil {
		var v any
		if *displayName != "" {
			v = *displayName
		}
		if _, err := tx.ExecContext(ctx,
			`UPDATE profiles SET display_name = ?, updated_at = ? WHERE id = ?`,
			v, ts, userID); err != nil {
			return nil, err
		}
	}
	if avatarURL != nil {
		var url, source any
		if *avatarURL != "" {
			url = *avatarURL
			source = "user"
		}
		if _, err := tx.ExecContext(ctx,
			`UPDATE profiles SET avatar_url = ?, avatar_source = ?, updated_at = ? WHERE id = ?`,
			url, source, ts, userID); err != nil {
			return nil, err
		}
	}

	var p Profile
	var name, avatar, src sql.NullString
	if err := tx.QueryRowContext(ctx,
		`SELECT display_name, avatar_url, avatar_source FROM profiles WHERE id = ?`,
		userID,
	).Scan(&name, &avatar, &src); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	p.UserID = userID
	p.DisplayName = name.String
	p.AvatarURL = avatar.String
	if src.String == "user" {
		p.AvatarSource = "user"
	}
	return &p, nil
}
