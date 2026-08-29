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

// Prune removes samples older than d.
func (s *Store) Prune(olderThan time.Duration) error {
	cutoff := time.Now().Add(-olderThan).Unix()
	_, err := s.db.Exec(`DELETE FROM telemetry_samples WHERE ts < ?`, cutoff)
	return err
}

func (s *Store) Close() error { return s.db.Close() }
