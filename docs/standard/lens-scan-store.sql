-- lens-scan store v5. One file per product repo: <root>/.ai/lens-scan/scan.db (gitignored).
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
-- v3 (the undo): proposals.triaged_from, the status an item left at its latest triage, so `triage --decision
-- reopen` can put a person's call back while its release is still a draft. One nullable column, last in
-- proposals; store.mjs migrates a v2 file in place by ALTER (one transaction), a v1 file straight to v3.
--
-- v4 (the takeover): where an item came from and how bad its problem is. proposals gains, last and in this order,
-- origin ('scan' | 'ado' | 'sweep', default 'scan'), external_ref ('<origin>:<id>' in the source system, UNIQUE when
-- set: the import idempotency key), external_url, tier (0 stop-ship, 1 before production, 2 soon after, 3 backlog;
-- NULL = untriaged), risk_class (secret | authz | money | data | llm | perf | reliability | ux | debt; NULL =
-- unclassified), ranked_by (<kind>:<name>) and ranked_at; kind takes 'work-item' (an imported item: no metric or
-- delta). The existing `risk` (1-10) is unchanged: the risk of making the change, never the problem's severity
-- (references/triage.md is the rubric for tier and risk_class). store.mjs migrates a v3 file by rebuilding proposals
-- (the kind CHECK changed; one transaction, every row copied, origin 'scan'), a v2 file through v3, a v1 file
-- straight to v4.
--
-- v5 (scan-finding/1, the shared finding contract - SKILL.md ## Finding contract): proposals gains, last and in this
-- order, impact (1-10: severity of a defect / value of an opportunity), impact_why, confidence (low|medium|high),
-- effort (1-10; from size XS=1 S=2 M=4 L=7 XL=10 when only a size is known), score (scan-score/1, stored by the skill,
-- never recomputed by a reader), score_parts (JSON breakdown), band ('ranked' | 'reserve': verified but over the
-- run's cap), mvp (1 on the top finding of its lens in its run), mvp_rule ('top-score' | 'override'), mvp_why,
-- category ('technical' | 'product'), predicted_verdict ('accept' | 'reject' | 'defer', recorded before any person
-- decides), predicted_why, predicted_by ('<skill>@<version>:<model>'), predicted_at, veto_until (set when a machine
-- decided under L1: a person may reverse it until then), proof (JSON: metric, method, unit, before, after, verdict,
-- control, base_sha, head_sha). A machine decision is decided_by / triaged_by 'machine:lens-scan'. trust_events is the
-- append-only autonomy ledger: a slice's current level is its latest event's to_level, or the category start level
-- (technical 2, product 0) when it has none. store.mjs migrates a v4 file by ALTER ADD COLUMN (one transaction);
-- older files go through v4 first.
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
--   a reopen (v3) is no status of its own: the item goes back to its triaged_from
PRAGMA journal_mode = WAL;
PRAGMA user_version = 5;

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
  kind           TEXT NOT NULL CHECK (kind IN ('fix', 'baseline-upgrade', 'propagation', 'work-item')),
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
  triaged_at     TEXT,
  -- v3
  triaged_from   TEXT,                           -- the status it left at its latest triage; reopen's target
  -- v4: where the item came from, and how bad the problem is (risk above is the risk of the CHANGE)
  origin         TEXT NOT NULL DEFAULT 'scan' CHECK (origin IN ('scan', 'ado', 'sweep')),
  external_ref   TEXT,                           -- '<origin>:<id>' in the source system; the import idempotency key
  external_url   TEXT,
  tier           INTEGER CHECK (tier BETWEEN 0 AND 3),  -- 0 stop-ship .. 3 backlog; NULL = untriaged
  risk_class     TEXT CHECK (risk_class IN ('secret', 'authz', 'money', 'data', 'llm', 'perf', 'reliability', 'ux', 'debt')),
  ranked_by      TEXT,                           -- <kind>:<name>
  ranked_at      TEXT,
  -- v5: scan-finding/1
  impact            INTEGER CHECK (impact BETWEEN 1 AND 10),
  impact_why        TEXT,
  confidence        TEXT CHECK (confidence IN ('low', 'medium', 'high')),
  effort            INTEGER CHECK (effort BETWEEN 1 AND 10),
  score             REAL,                        -- scan-score/1; NULL when impact or effort is unknown
  score_parts       TEXT,                        -- JSON {impact, confidence_w, effort_div, risk_factor, formula}
  band              TEXT NOT NULL DEFAULT 'ranked' CHECK (band IN ('ranked', 'reserve')),
  mvp               INTEGER NOT NULL DEFAULT 0 CHECK (mvp IN (0, 1)),
  mvp_rule          TEXT CHECK (mvp_rule IN ('top-score', 'override')),
  mvp_why           TEXT,
  category          TEXT CHECK (category IN ('technical', 'product')),
  predicted_verdict TEXT CHECK (predicted_verdict IN ('accept', 'reject', 'defer')),
  predicted_why     TEXT,
  predicted_by      TEXT,
  predicted_at      TEXT,
  veto_until        TEXT,
  proof             TEXT                         -- JSON {metric, method, unit, before, after, verdict, control, base_sha, head_sha}
);
CREATE UNIQUE INDEX IF NOT EXISTS proposals_external_ref ON proposals (external_ref) WHERE external_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS proposals_tier ON proposals (tier);
CREATE INDEX IF NOT EXISTS proposals_score ON proposals (lens, band, score);

-- v5. Append-only autonomy ledger (scan-finding/1). slice = '<category>|<lens>|<risk_class>|<size>', '-' for an
-- absent part. level 0 propose, 1 auto-triage, 2 auto-build with proof, 3 auto-merge.
CREATE TABLE IF NOT EXISTS trust_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT NOT NULL,
  slice      TEXT NOT NULL,
  from_level INTEGER NOT NULL CHECK (from_level BETWEEN 0 AND 3),
  to_level   INTEGER NOT NULL CHECK (to_level BETWEEN 0 AND 3),
  reason     TEXT NOT NULL,                      -- 'promote: agreement' | 'demote: reversal <id>' | 'demote: not-better <id>' | 'overlay: <key>'
  agreement  REAL,                               -- 0..1 over the window, when computed
  n          INTEGER,                            -- human-decided items in the window
  item_id    TEXT REFERENCES proposals(id)       -- the item that caused a demotion
);
CREATE INDEX IF NOT EXISTS trust_events_slice ON trust_events (slice, id);
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
