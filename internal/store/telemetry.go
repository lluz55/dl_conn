package store

import (
	"database/sql"
	"encoding/json"
	"time"

	"dl_conn/internal/sensors"

	_ "modernc.org/sqlite"
)

// Store persists telemetry snapshots.
type Store struct {
	db *sql.DB
}

// New opens or creates the SQLite DB at path and ensures schema.
func New(path string) (*Store, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if err := db.Ping(); err != nil {
		return nil, err
	}
	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) migrate() error {
	_, err := s.db.Exec(`
	CREATE TABLE IF NOT EXISTS telemetry_samples (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		ts INTEGER NOT NULL,
		data TEXT NOT NULL
	);
	CREATE INDEX IF NOT EXISTS telemetry_samples_ts ON telemetry_samples(ts);
	`)
	return err
}

// Insert stores a snapshot.
func (s *Store) Insert(snap sensors.Snapshot) error {
	data, err := json.Marshal(snap)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`INSERT INTO telemetry_samples(ts, data) VALUES(?, ?)`, snap.SampledAt.Unix(), string(data))
	return err
}

// Latest returns the most recent snapshot.
func (s *Store) Latest() (*sensors.Snapshot, error) {
	row := s.db.QueryRow(`SELECT data FROM telemetry_samples ORDER BY ts DESC LIMIT 1`)
	var data string
	if err := row.Scan(&data); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	var snap sensors.Snapshot
	if err := json.Unmarshal([]byte(data), &snap); err != nil {
		return nil, err
	}
	return &snap, nil
}

// Range returns the samples recorded in the inclusive window [from, to],
// oldest first. The window is resolved with the same Unix-second resolution the
// rows are stored with, so callers get every sample whose ts falls in the
// window and no sample outside it.
//
// The returned slice is always non-nil — an empty window yields an empty slice
// rather than nil, so a caller that encodes it as JSON emits [] and not null.
// A from after to is treated as an empty window rather than an error: it is a
// caller mistake worth rendering as "no data", not as a failed request.
//
// This is the unfiltered primitive. A caller serving a chart should reach for
// RangeBucketed instead: over a whole retention window this returns one row
// per sample, and a dashboard must not download (or decode) all of them.
func (s *Store) Range(from, to time.Time) ([]sensors.Snapshot, error) {
	return s.scan(
		`SELECT ts, data FROM telemetry_samples WHERE ts >= ? AND ts <= ? ORDER BY ts ASC`,
		from.Unix(), to.Unix())
}

// RangeBucketed returns at most maxPoints samples spread evenly over the
// inclusive window [from, to], oldest first: the window is cut into at most
// maxPoints equal-width time buckets and the newest sample inside each bucket
// is returned. Fewer samples than maxPoints means the window held fewer.
//
// The point is the size of the answer, not its exactness. A dashboard draws a
// fixed number of pixels across the window, so one representative sample per
// bucket is indistinguishable from every sample — while the difference on the
// wire is two orders of magnitude. A 7-day window at the default 10s cadence
// holds ~60k rows (~25 MB as JSON); bucketed to 720 it holds at most 720.
//
// The bucket is a divisor of the window in Unix seconds and SQLite groups on
// `(ts - from) / bucket`, so a bucket is exactly one aligned interval and no
// sample is counted twice. Within a bucket the *newest* row wins: SQLite
// documents that a bare column alongside a single min()/max() aggregate takes
// its value from the row holding that extremum, so one group yields exactly
// one coherent snapshot instead of an arbitrary mix of columns.
//
// Same contract as Range: inclusive bounds, non-nil slice, and a from after to
// is an empty window rather than an error. maxPoints below 1 is treated as 1.
func (s *Store) RangeBucketed(from, to time.Time, maxPoints int) ([]sensors.Snapshot, error) {
	if from.After(to) {
		return emptyRange(), nil
	}
	if maxPoints < 1 {
		maxPoints = 1
	}
	fromUnix, toUnix := from.Unix(), to.Unix()
	// Ceiling division over the window's *integer offsets* — there are
	// span+1 of them, from 0 at `from` to span at `to` — which is what makes
	// the group count a hard ceiling: with span+1 <= maxPoints*bucket, no
	// offset reaches maxPoints*bucket, so the highest index is maxPoints-1.
	// Dividing span instead would hand back maxPoints+1 groups exactly when
	// the window divides evenly. Floored at 1s, because a zero-width bucket
	// would collapse every sample into one group.
	bucket := int64(1)
	if span := toUnix - fromUnix; span >= 0 {
		if b := (span + int64(maxPoints)) / int64(maxPoints); b > 1 {
			bucket = b
		}
	}
	return s.scan(`
		SELECT newest AS ts, data FROM (
			SELECT data, MAX(ts) AS newest FROM telemetry_samples
			WHERE ts >= ? AND ts <= ?
			GROUP BY (ts - ?) / ?
		) ORDER BY ts ASC`,
		fromUnix, toUnix, fromUnix, bucket)
}

// emptyRange is the shared zero-length answer, so a JSON-encoding caller gets
// [] rather than null on every path that has nothing to return.
func emptyRange() []sensors.Snapshot { return make([]sensors.Snapshot, 0) }

// scan runs a range query shaped (ts INTEGER, data TEXT) and decodes every row
// into a snapshot, in the order the query produced them.
func (s *Store) scan(query string, args ...any) ([]sensors.Snapshot, error) {
	snaps := emptyRange()
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	// A read-only Rows close cannot fail in a way the caller can act on —
	// the result set is already drained or the query errored — but the
	// unchecked return still has to be silenced explicitly for errcheck.
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var ts int64
		var data string
		if err := rows.Scan(&ts, &data); err != nil {
			return nil, err
		}
		var snap sensors.Snapshot
		if err := json.Unmarshal([]byte(data), &snap); err != nil {
			return nil, err
		}
		snaps = append(snaps, snap)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return snaps, nil
}

// Prune removes samples older than d.
func (s *Store) Prune(olderThan time.Duration) error {
	cutoff := time.Now().Add(-olderThan).Unix()
	_, err := s.db.Exec(`DELETE FROM telemetry_samples WHERE ts < ?`, cutoff)
	return err
}

func (s *Store) Close() error { return s.db.Close() }
