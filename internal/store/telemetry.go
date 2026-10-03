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
func (s *Store) Range(from, to time.Time) ([]sensors.Snapshot, error) {
	snaps := make([]sensors.Snapshot, 0)
	if from.After(to) {
		return snaps, nil
	}
	rows, err := s.db.Query(
		`SELECT ts, data FROM telemetry_samples WHERE ts >= ? AND ts <= ? ORDER BY ts ASC`,
		from.Unix(), to.Unix())
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
