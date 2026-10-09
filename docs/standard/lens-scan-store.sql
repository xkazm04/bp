-- lens-scan store v1. One file per product repo: <root>/.ai/lens-scan/scan.db (gitignored).
-- Written by the /lens-scan skill (ai-registry skills/lens-scan/scripts/store.mjs, the owner of this DDL);
-- read by the blueprint, which writes only proposal decisions. This file is copied name for name between
-- ai-registry skills/lens-scan/references/store.sql and bp docs/standard/lens-scan-store.sql.
-- Timestamps are ISO 8601 UTC strings. Absent values are NULL in SQL and omitted in JSON; a missing
-- measurement row means "unmeasured" (never a 0 placeholder). JSON columns hold JSON text.
PRAGMA journal_mode = WAL;
PRAGMA user_version = 1;

CREATE TABLE IF NOT EXISTS runs (
  id            TEXT PRIMARY KEY,
  started_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  ended_at      TEXT,
  phase         TEXT NOT NULL CHECK (phase IN ('measure', 'propose', 'execute', 'propagate')),
  status        TEXT NOT NULL CHECK (status IN ('running', 'done', 'failed', 'aborted')),
  lenses        TEXT NOT NULL,  -- JSON array of lens ids
  scope         TEXT,           -- JSON object
  skill_version TEXT,
  model         TEXT,
  note          TEXT
);

-- Append-only. `metric` is the lens field key.
CREATE TABLE IF NOT EXISTS measurements (
  id          INTEGER PRIMARY KEY,
  run_id      TEXT NOT NULL REFERENCES runs(id),
  feature     TEXT NOT NULL,
  lens        TEXT NOT NULL,
  metric      TEXT NOT NULL,
  value       REAL NOT NULL,
  unit        TEXT,
  method      TEXT CHECK (method IN ('static', 'probe', 'harness', 'judgement')),
  evidence    TEXT,
  measured_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS measurements_key ON measurements (feature, lens, metric, measured_at);

-- `standard`: '<subject>/<technique>' | 'house:<subject>/<technique>' | 'none'.
CREATE TABLE IF NOT EXISTS proposals (
  id             TEXT PRIMARY KEY,
  run_id         TEXT NOT NULL REFERENCES runs(id),
  feature        TEXT NOT NULL,
  lens           TEXT NOT NULL,
  metric         TEXT,
  title          TEXT NOT NULL,
  body           TEXT,
  standard       TEXT NOT NULL DEFAULT 'none',
  expected_delta REAL,
  size           TEXT CHECK (size IN ('XS', 'S', 'M', 'L', 'XL')),
  risk           INTEGER CHECK (risk BETWEEN 1 AND 10),
  kind           TEXT NOT NULL CHECK (kind IN ('fix', 'baseline-upgrade', 'propagation')),
  parent_id      TEXT REFERENCES proposals(id),
  status         TEXT NOT NULL CHECK (status IN ('proposed', 'approved', 'declined', 'executing', 'done', 'failed')),
  decided_by     TEXT,
  decided_at     TEXT,
  decision_note  TEXT,
  after_value    REAL,
  result_sha     TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS proposals_updated ON proposals (updated_at);

CREATE TABLE IF NOT EXISTS activity (
  id      INTEGER PRIMARY KEY,
  run_id  TEXT NOT NULL REFERENCES runs(id),
  at      TEXT NOT NULL,
  feature TEXT,
  lens    TEXT,
  kind    TEXT NOT NULL CHECK (kind IN ('reading', 'measured', 'proposed', 'executing', 'committed', 'note', 'error')),
  text    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shots (
  id             INTEGER PRIMARY KEY,
  run_id         TEXT NOT NULL REFERENCES runs(id),
  feature        TEXT NOT NULL,
  path           TEXT NOT NULL,  -- relative to the store dir: shots/<feature>/<run>-<size>-<theme>.png
  size           TEXT,
  theme          TEXT,
  harness_module TEXT,
  captured_at    TEXT NOT NULL,
  report         TEXT            -- JSON object
);

CREATE TABLE IF NOT EXISTS coverage (
  feature   TEXT NOT NULL,
  standard  TEXT NOT NULL,
  state     TEXT NOT NULL CHECK (state IN ('conformant', 'deviation', 'not-applicable', 'unknown')),
  evidence  TEXT,
  judged_at TEXT NOT NULL,
  run_id    TEXT REFERENCES runs(id),
  PRIMARY KEY (feature, standard)
);
