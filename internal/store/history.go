package store

import (
	"database/sql"
	"time"
)

// This file holds the two histories that are about *events* rather than
// *samples*: whether each configured service answered its last probe, and how
// long each incarnation of the ephemeral tunnel URL lived. They share the
// SQLite handle with telemetry_samples, and share its retention: a row nobody
// prunes is a row that grows without bound on a host that stays up.

// Status values a recorded probe can carry. They are the ones
// internal/health publishes, restated here so the store does not have to
// import it — the store's job is to persist and aggregate, not to decide.
const (
	// StatusUp means the target answered the probe.
	StatusUp = "up"
	// StatusDown means the probe failed.
	StatusDown = "down"
	// StatusUnknown means the target was never probed in that bucket.
	StatusUnknown = "unknown"
)

// Severity ranks used to fold a whole time bucket into the single status a
// status-page strip has to draw. Worst-wins: a bucket in which the service was
// down at any point is drawn as down, because an availability strip that
// averages a 10-second outage away with a healthy bucket is a lie about the
// one thing the strip exists to answer.
const (
	rankUp      = 0
	rankUnknown = 1
	rankDown    = 2
)

// ServiceHealthPoint is one bucket of one service's probe history. TS is the
// newest sample inside the bucket (Unix seconds, matching telemetry_samples),
// and Status is the worst status observed across the whole bucket.
type ServiceHealthPoint struct {
	TS     int64  `json:"ts"`
	Status string `json:"status"`
}

// TunnelIncarnation is one lifetime of the ephemeral tunnel URL. EndedAt is nil
// while the incarnation is still the current one — an open-ended tunnel is the
// normal case, not missing data.
type TunnelIncarnation struct {
	StartedAt int64  `json:"started_at"`
	EndedAt   *int64 `json:"ended_at"`
	URL       string `json:"url"`
}

// RecordServiceHealth stores one probe round: a status for every service at a
// single instant. All rows land in one transaction, because a round is only
// meaningful as a unit — half a round would render as a service that stopped
// existing for one bucket.
//
// It is deliberately forgiving of an empty map: a host with no services
// configured is not an error, it is just nothing to record.
func (s *Store) RecordServiceHealth(ts time.Time, statuses map[string]string) error {
	if len(statuses) == 0 {
		return nil
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	stmt, err := tx.Prepare(`INSERT INTO service_health_samples(ts, service_id, status) VALUES(?, ?, ?)`)
	if err != nil {
		return err
	}
	defer func() { _ = stmt.Close() }()

	unix := ts.Unix()
	for id, status := range statuses {
		if _, err := stmt.Exec(unix, id, status); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// RangeServiceHealth returns the recorded probe history for every service seen
// in the inclusive window [from, to], bucketed down to at most maxPoints per
// service and ordered oldest first within each service.
//
// The returned map is keyed by service ID and is always non-nil; a window with
// nothing in it yields an empty map, so a JSON-encoding caller emits {} rather
// than null. A service that has no row in the window is absent from the map
// rather than present with an empty series — "never probed" is a different
// statement from "probed and up", and the caller draws them differently.
func (s *Store) RangeServiceHealth(from, to time.Time, maxPoints int) (map[string][]ServiceHealthPoint, error) {
	out := make(map[string][]ServiceHealthPoint)
	if from.After(to) {
		return out, nil
	}
	if maxPoints < 1 {
		maxPoints = 1
	}
	bucket := bucketWidth(from.Unix(), to.Unix(), maxPoints)

	rows, err := s.db.Query(`
		SELECT service_id,
		       MAX(CASE status WHEN ? THEN 2 WHEN ? THEN 1 ELSE 0 END) AS worst,
		       MAX(ts) AS newest
		FROM service_health_samples
		WHERE ts >= ? AND ts <= ?
		GROUP BY service_id, (ts - ?) / ?
		ORDER BY service_id ASC, newest ASC`,
		StatusDown, StatusUnknown, from.Unix(), to.Unix(), from.Unix(), bucket)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	for rows.Next() {
		var (
			serviceID string
			worst     int
			newest    int64
		)
		if err := rows.Scan(&serviceID, &worst, &newest); err != nil {
			return nil, err
		}
		out[serviceID] = append(out[serviceID], ServiceHealthPoint{
			TS:     newest,
			Status: statusFromRank(worst),
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

// statusFromRank inverts the severity rank the bucket query computes.
func statusFromRank(rank int) string {
	switch rank {
	case rankDown:
		return StatusDown
	case rankUnknown:
		return StatusUnknown
	default:
		return StatusUp
	}
}

// RecordTunnelIncarnation closes whatever incarnation is still open and opens a
// new one at url. Called once per distinct hostname cloudflared prints, so the
// table is the daemon's own record of how often the ephemeral URL rotates —
// which is the question a dashboard cannot answer on its own, because a
// rotation usually happens with no browser open.
//
// Closing first is what makes the table self-healing across restarts: a daemon
// that was killed mid-incarnation leaves that row open, and the next start
// closes it at the moment it takes over, rather than leaving a tunnel that
// looks like it is still alive.
func (s *Store) RecordTunnelIncarnation(startedAt time.Time, url string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	unix := startedAt.Unix()
	if _, err := tx.Exec(
		`UPDATE tunnel_incarnations SET ended_at = ? WHERE ended_at IS NULL`,
		unix,
	); err != nil {
		return err
	}
	if _, err := tx.Exec(
		`INSERT INTO tunnel_incarnations(started_at, ended_at, url) VALUES(?, NULL, ?)`,
		unix, url,
	); err != nil {
		return err
	}
	return tx.Commit()
}

// CloseOpenTunnelIncarnation ends the open incarnation, if there is one, at ts.
// Called on daemon shutdown so a clean stop ends its tunnel rather than leaving
// a row open until the next start repairs it.
func (s *Store) CloseOpenTunnelIncarnation(ts time.Time) error {
	_, err := s.db.Exec(`UPDATE tunnel_incarnations SET ended_at = ? WHERE ended_at IS NULL`, ts.Unix())
	return err
}

// RangeTunnelIncarnations returns the incarnations overlapping the inclusive
// window [from, to], oldest first, capped at maxPoints. A range that starts
// before the window still overlaps it and is returned in full — truncating an
// incarnation at the window edge would invent a start time that never
// happened.
//
// The cap keeps the newest maxPoints (the answer is reversed back to oldest
// first afterwards): when a window is overrun it is the old half that is
// uninteresting, and the recent rotations are what the reader is looking at.
func (s *Store) RangeTunnelIncarnations(from, to time.Time, maxPoints int) ([]TunnelIncarnation, error) {
	out := []TunnelIncarnation{}
	if from.After(to) {
		return out, nil
	}
	if maxPoints < 1 {
		maxPoints = 1
	}
	rows, err := s.db.Query(`
		SELECT started_at, ended_at, url FROM (
			SELECT started_at, ended_at, url FROM tunnel_incarnations
			WHERE started_at <= ? AND (ended_at IS NULL OR ended_at >= ?)
			ORDER BY started_at DESC LIMIT ?
		) ORDER BY started_at ASC`,
		to.Unix(), from.Unix(), maxPoints)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	for rows.Next() {
		var (
			inc     TunnelIncarnation
			endedAt sql.NullInt64
		)
		if err := rows.Scan(&inc.StartedAt, &endedAt, &inc.URL); err != nil {
			return nil, err
		}
		if endedAt.Valid {
			v := endedAt.Int64
			inc.EndedAt = &v
		}
		out = append(out, inc)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

// pruneHistory applies the same retention to the event histories that
// Prune applies to telemetry_samples. Rows whose *start* is older than the
// cutoff are dropped: an incarnation that started long ago and is still open is
// kept, because dropping it would erase the tunnel currently in use.
func (s *Store) pruneHistory(olderThan time.Duration) error {
	cutoff := time.Now().Add(-olderThan).Unix()
	for _, q := range []string{
		`DELETE FROM service_health_samples WHERE ts < ?`,
		`DELETE FROM tunnel_incarnations WHERE started_at < ? AND ended_at IS NOT NULL`,
	} {
		if _, err := s.db.Exec(q, cutoff); err != nil {
			return err
		}
	}
	return nil
}