-- lens-scan store v2. One file per product repo: <root>/.ai/lens-scan/scan.db (gitignored).
-- Written by the /lens-scan skill (ai-registry skills/lens-scan/scripts/store.mjs, the owner of this DDL);
-- read by the blueprint, which writes only proposal decisions. This file is copied name for name between
-- ai-registry skills/lens-scan/references/store.sql and bp docs/standard/lens-scan-store.sql.
-- Timestamps are ISO 8601 UTC strings. Absent values are NULL in SQL and omitted in JSON; a missing
-- measurement row means "unmeasured" (never a 0 placeholder). JSON columns hold JSON text.
--
-- v2 (the release train): execute builds a lens's approved items as a PACK - one branch pack/<short>-<n>,
-- one squashed commit per item, never merged to main; a person TRIAGES each built item against its
-- before/after evidence; a RELEASE cherry-picks the accepted items onto release/<version>, opens a PR and,
-- after the merge, tags v<version>. v2 only adds: the packs and releases tables, columns on proposals
-- (pack, commit, attempt, release, triage), the before/after linkage on measurements and shots, and four
-- proposal statuses. No v1 column or status is renamed or dropped. store.mjs migrates a v1 file in place
-- (one transaction: proposals is rebuilt, since SQLite cannot widen a CHECK; every row is copied).
--
-- proposals.status, what each one means:
--   proposed   the skill proposed it; nobody has decided
--   approved   a person (review UI or `decide --by`) approved it; waiting to be built
--   declined   a person declined it
--   executing  the skill is building it now
--   done       built: its squashed commit is on its pack branch, waiting for triage
--   failed     the build did not reach its target; waiting for triage
--   accepted   (v2) triage: the person takes it into the next release
--   rework     (v2) triage: the person wants it rebuilt; a new attempt row (attempt_of = this id) carries the rebuild
--   descoped   (v2) triage: the person drops it; it never ships
--   released   (v2) shipped: its release was merged and tagged
PRAGMA journal_mode = WAL;
PRAGMA user_version = 2;

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
  measured_at TEXT NOT NULL,
  -- v2: a reading taken for one proposal, before or after its build, at the commit it was taken on.
  -- A row with a phase is that item's evidence, not the feature's current state.
  proposal_id TEXT,
  phase       TEXT CHECK (phase IN ('before', 'after')),
  commit_sha  TEXT
);
CREATE INDEX IF NOT EXISTS measurements_key ON measurements (feature, lens, metric, measured_at);
CREATE INDEX IF NOT EXISTS measurements_proposal ON measurements (proposal_id);

-- v2: a pack is one lens's built items on one branch, pack/<short>-<n>, cut from base_ref at base_sha.
-- open: being built or triaged; triaged: no item is executing, done or failed any more; closed: every
-- item is released, descoped or declined.
CREATE TABLE IF NOT EXISTS packs (
  id         TEXT PRIMARY KEY,                   -- 'k-<short>-<n>', e.g. k-des-3
  lens       TEXT NOT NULL,
  n          INTEGER NOT NULL,                   -- per-lens counter, 1-based
  branch     TEXT NOT NULL,                      -- pack/<short>-<n>
  base_ref   TEXT NOT NULL,                      -- e.g. main or release/1.4.0
  base_sha   TEXT NOT NULL,
  run_id     TEXT REFERENCES runs(id),           -- the execute run that built it
  status     TEXT NOT NULL CHECK (status IN ('open', 'triaged', 'closed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (lens, n)
);

-- v2: a release cherry-picks accepted items onto release/<version>, opens a PR, and is tagged v<version>
-- after the merge. draft -> building -> pr-open -> merged -> tagged; any state but tagged -> failed.
CREATE TABLE IF NOT EXISTS releases (
  id         TEXT PRIMARY KEY,                   -- 'rel-<version>'
  version    TEXT NOT NULL UNIQUE,               -- semver without the v
  branch     TEXT NOT NULL,                      -- release/<version>
  base_sha   TEXT,                               -- main's SHA the branch was cut from
  status     TEXT NOT NULL CHECK (status IN ('draft', 'building', 'pr-open', 'merged', 'tagged', 'failed')),
  pr_url     TEXT,
  tag        TEXT,
  notes      TEXT,
  error      TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- `standard`: '<subject>/<technique>' | 'house:<subject>/<technique>' | 'none'.
-- The status list and what each status means is in the header.
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
  status         TEXT NOT NULL CHECK (status IN ('proposed', 'approved', 'declined', 'executing', 'done', 'failed',
                                                 'accepted', 'rework', 'descoped', 'released')),
  decided_by     TEXT,
  decided_at     TEXT,
  decision_note  TEXT,
  after_value    REAL,
  result_sha     TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  -- v2
  pack_id        TEXT REFERENCES packs(id),
  commit_sha     TEXT,                           -- the item's own squashed commit on its pack branch
  attempt_of     TEXT REFERENCES proposals(id),  -- the previous attempt, when this is a rework rebuild
  release_id     TEXT REFERENCES releases(id),
  triage_note    TEXT,
  triaged_by     TEXT,                           -- <kind>:<name>
  triaged_at     TEXT
);
CREATE INDEX IF NOT EXISTS proposals_updated ON proposals (updated_at);
CREATE INDEX IF NOT EXISTS proposals_pack ON proposals (pack_id);
CREATE INDEX IF NOT EXISTS proposals_release ON proposals (release_id);

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
  path           TEXT NOT NULL,  -- relative to the store dir: shots/<run>/<feature>-<theme>-<size>.png
  size           TEXT,
  theme          TEXT,
  harness_module TEXT,
  captured_at    TEXT NOT NULL,
  report         TEXT,           -- JSON object
  -- v2: a capture for one proposal, before or after its build
  proposal_id    TEXT,
  phase          TEXT CHECK (phase IN ('before', 'after'))
);
CREATE INDEX IF NOT EXISTS shots_proposal ON shots (proposal_id);

CREATE TABLE IF NOT EXISTS coverage (
  feature   TEXT NOT NULL,
  standard  TEXT NOT NULL,
  state     TEXT NOT NULL CHECK (state IN ('conformant', 'deviation', 'not-applicable', 'unknown')),
  evidence  TEXT,
  judged_at TEXT NOT NULL,
  run_id    TEXT REFERENCES runs(id),
  PRIMARY KEY (feature, standard)
);
