# Personas adoption of app-structure v3

Status: brief for a spark in the Personas repo (sibling checkout `../personas`), against [app-structure-v3.md](app-structure-v3.md)
(schemas in `schema/`, built-ins in `lenses/`). Paths are relative to Personas at `0a96d32d3f`, except
P6 (the ai-registry repo, `../ai-registry`, at `196641c6`). Live counts (142 active features, 1,559 KPIs,
none linked to a feature) are from the 2026-10-09 scout, not re-queried.

## 1. Summary

Personas already writes `context-map.json` v2; v3 keeps its code tree and adds staged features,
milestones, KPIs, lens plugins and per-feature lens values ("facets"). Six one-session packages
cover the Personas side: merge-not-overwrite v3 export, v3 declarations, stage with history, a lens
catalog on the connector pattern, a KPI lens tag, and an ai-registry fix. The export goes first,
because today's whole-file rewrite erases anything another writer adds.

**Compatibility promise.** `groups[]` and `contexts[]` stay in their v2 shape, and existing readers
ignore keys they do not know. The declaration reader reads only `groups` and `contexts`
(`src-tauri/src/commands/infrastructure/context_declaration.rs:270-305`); the registry reads only
contexts (`scripts/build-registry-map.mjs:350-388`). So every v2 reader keeps working on a v3 file.
Only `use_cases[]` goes, replaced by `features[]` (spec §11); no Personas reader parses it back.

## 2. Work packages

`EXPORT` = `src-tauri/src/commands/infrastructure/context_map_export.rs`;
`DECL` = `src-tauri/src/commands/infrastructure/context_declaration.rs`;
`MIG` = `src-tauri/db/src/migrations/incremental/`.

### P1. Export v3 with merge, not overwrite

Today `write_context_map_artifacts` (EXPORT:55-100) exports only active features (EXPORT:75-79),
rewrites the whole file (EXPORT:90-95), writes `version: 2` (EXPORT:270-301), `null`s
(`primary_context` EXPORT:204, `group` EXPORT:245) and the absolute `project.root` (EXPORT:284).

Changes:
- **Slugs.** `dev_kpis` (MIG `c02_dev_goals_and_kpis.rs:241-268`) and `dev_milestones` (MIG
  `c03_fleet_and_workspaces.rs:437-450`) have none. Add `slug` with `UNIQUE(project_id, slug)`,
  backfilled by `slugify_use_case` (`src-tauri/db/src/repos/dev/use_cases.rs:21`) plus `-2` on a
  collision, immutable once set (`source: {kpi}` bindings depend on it).
- **New output.** `build_map` (EXPORT:171-302) writes `$schema: "app-structure/3"`, `version: 3`
  and `taxonomy.feature_kinds`/`feature_tiers`. It drops `project.root`, omits absent values instead
  of writing `null`, and adds four sections:
  - `features[]`: every `dev_use_cases` row that is not `proposed`, archived ones included as
    `status: "archived"`. `description` becomes `summary`. `milestone` is the feature's `core`
    membership in `dev_milestone_items` (MIG `c03_fleet_and_workspaces.rs:465-475`).
  - `milestones[]`.
  - `kpis[]`: `scope` by `use_case_id` > `context_id` > `context_group_id` > project
    (`src-tauri/core/src/models/dev_tools.rs:559`); `current` from `current_value`/`last_measured_at`,
    which only the governed doors roll forward (`src-tauri/db/src/repos/dev/kpis.rs:444`, `:542`;
    the simulation door does not, `kpis.rs:483-487`).
  - `lenses[]` and `facets` from P4. Empty until P4 lands.
- **Merge.** If a v3 file exists, read it first. Regenerate only `groups`, `contexts`, `stats`,
  `provenance`, `generator` and `generated_at`. Merge everything else by the spec §11 table:
  - features by slug, where Personas owns `id`, `kind`, `tier`, `status`, `contexts`,
    `primary_context`, plus `stage`/`stage_since` once P3 has given it a value;
  - KPIs by slug;
  - facets by feature × lens, where Personas replaces only facets with its own `source`;
  - `extensions`, unknown keys, orphaned facets and `source: "project"` lenses verbatim.

  Never write `declared`. Keep the refusal over a declared map (EXPORT:60-67).
- Callers (`context_generation.rs:2900`, `context_consolidate.rs:1505`, `dev_tools_http.rs:771,854,925`)
  do not change.

Acceptance:
1. The export validates against `app-structure-3.schema.json`, with no `null` and no `project.root`.
2. Two exports with no database change give identical `features`, `kpis`, `lenses`, `facets`, `extensions`.
3. A hand-added `extensions.com.example`, an unknown-lens facet, a `domains[]` entry and a feature
   absent from the database all survive a rescan.
4. Archiving a feature sets `status: "archived"`; it is not removed.
5. Every KPI and milestone has a unique slug that survives a rename.

### P2. Declaration reader v3

`parse_declared_map` (DECL:261-366) checks `domain` (DECL:289-296) and `category` (DECL:326-333)
against closed lists; `apply_declared_map` (DECL:391-517) upserts by name, stamping
`source = 'declared'` (DECL:500). Callers: `context_generation.rs:1416-1418`, `dev_tools_http.rs:719-721`.

Changes:
- **Validation.** On `$schema: "app-structure/3"`, validate against the published schema first,
  vendored as Twin Card is: copy the three schemas to `docs/standards/app-structure/3/` and
  `include_str!` them into a `jsonschema` validator (`src-tauri/src/commands/infrastructure/twin_card/schema.rs:14-24`;
  `jsonschema` 0.28, `src-tauri/Cargo.toml:431`), registering `lens-manifest-1` as a resource.
- **New sections.** Add `domains[]`, `capabilities[]`, `features[]`, `milestones[]`, project
  `lenses[]` and `facets`. Domains and capabilities need new tables `dev_product_domains` and
  `dev_product_capabilities` (slug, name, summary, order, `source` CHECK `declared|proposed`),
  plus a `capability_id` on `dev_use_cases`.
- **Ingest.** Features and milestones match by slug; stage goes through the P3 door (actor
  `declared`); `source: "project"` lenses become `lens_definitions` rows with `is_builtin = 0`;
  facets keep their `source`. Pruning stays limited to `declared` rows, as for contexts
  (DECL:504-514).

Acceptance:
1. v2 declarations apply as before (the tests from DECL:555 on pass).
2. `docs/standard/schema/fixtures/valid-map.json` applies; the four `invalid-*.json` fixtures are
   refused, naming the field.
3. A context with category `foo` is still refused.
4. Applying a v3 declaration twice changes nothing and appends no events.

### P3. Feature stage with history

`dev_use_cases` (MIG `c03_fleet_and_workspaces.rs:145-163`) has only `status`, and the repo accepts
two of its three CHECK values (`use_cases.rs:14`).

Changes:
- **Columns.** Add `stage TEXT NULL CHECK (stage IN ('idea','specified','in-dev','in-review','flagged','live','deprecated'))`
  and `stage_since TEXT NULL`, no default: unknown is NULL (house rule, MIG `e43_council.rs:26-32`).
- **Events table.** Add `dev_use_case_events`: id, `use_case_id` FK `ON DELETE SET NULL`, `slug`
  copied in (history outlives the row, as for council subjects at MIG `e43_council.rs:21-25`),
  `type` CHECK (`stage`, `feature-added`, `feature-archived`, `lens-health`), `lens_id`,
  `from_value`, `to_value`, `actor`, `source`, `at`. Not a reuse of `dev_kpi_measurements` (its
  `value REAL NOT NULL` cannot hold a stage), but its pattern: an append-only series (MIG
  `c02_dev_goals_and_kpis.rs:285-296`) plus one door that also updates the current value
  (`kpis.rs:444-468`).
- **One door.** `set_use_case_stage(pool, id, stage, actor, source)` beside `set_use_case_tier`
  (`use_cases.rs:325`) updates `stage`/`stage_since` and inserts the event in one transaction.
  `create_use_case` (`use_cases.rs:173`) and archiving via `update_use_case` (`use_cases.rs:240-291`)
  append `feature-added`/`feature-archived`.
- **Events file.** The export appends to `context-map.events.jsonl` the rows whose `id` (carried on
  each line; events allow unknown keys) is not yet in the file. It never rewrites it.

Acceptance:
1. An eighth stage value fails at the database.
2. A stage change adds one row and one jsonl line; every line validates against
   `app-structure-event-3.schema.json`.
3. A second export with no change appends nothing.
4. Only the door writes `stage` (grep).

### P4. Lens catalog on the connector pattern

Model: the connector catalog. One JSON per unit in `scripts/connectors/builtin/` (135 files);
`scripts/generate-connector-seed.mjs` reads them (lines 62-95), emits `BUILTIN_CONNECTORS` (line 145)
and writes only on change (lines 150-158), run from `scripts/run-codegen.mjs:41`;
`connector_definitions` with `is_builtin` (`src-tauri/db/src/migrations/schema.rs:503-518`); seeding
by `INSERT OR IGNORE` then a refresh of built-ins only (`src-tauri/db/src/lib.rs:2105-2146`); name
uniqueness checked in code, as the column has no UNIQUE (`src-tauri/db/src/repos/resources/connectors.rs:107-128`).
Facet rows follow `dev_council_verdicts` (MIG `e43_council.rs:148-164`: one row per subject ×
dimension, nullable score, `payload_json`, a `UNIQUE` pair), with a lens foreign key in place of its
closed `dimension` CHECK.

Changes:
- **Built-in files.** Copy this repo's `docs/standard/lenses/*.json` into `scripts/lenses/builtin/`.
- **Seed codegen.** Add `scripts/generate-lens-seed.mjs`, which writes
  `src-tauri/db/src/builtin_lenses.rs`, and register it in `run-codegen.mjs`.
- **`lens_definitions`**: `id` (lens id), `version`, `name UNIQUE` (a new table needs no de-dup
  pass, so the constraint is real), `manifest_json`, `is_builtin`, timestamps. Seeded beside
  `seed_builtin_connectors` (`lib.rs:492`, `lib.rs:2327`), refreshing built-in manifests only.
- **`dev_project_lenses`**: `project_id`, `lens_id` FK `ON DELETE RESTRICT`, `enabled`. Toggling
  appends `lens-enabled`/`lens-disabled`; disabling never deletes.
- **`dev_use_case_lens_facets`**: `use_case_id` FK `ON DELETE CASCADE`, `lens_id` FK
  `ON DELETE RESTRICT`, `values_json NOT NULL`, nullable `applicable`, `measured_at`,
  `source NOT NULL`, `override_health` (CHECK `good|watch|bad`), `override_by`, `override_why`,
  `override_until` (a CHECK: all four set or all NULL), `UNIQUE(use_case_id, lens_id)`.
- **Evaluator.** Port this repo's `src/lib/standard/health.ts` to Rust. It takes the feature's core
  fields (`stage`, `priority`, `kind`, `tier`, `milestone`, `status`), since four built-ins bind
  `stage`, and evaluates `applies_when` (spec §8.2-8.4). Personas has no `priority`, so rules on it
  never match. A change in computed health appends `lens-health`.

Acceptance:
1. The six built-ins are seeded; an edited built-in file refreshes on restart, custom rows do not.
2. A custom lens with a taken name is refused; a facet for an unknown lens fails at the foreign key.
3. The evaluator reproduces every expected health in `fixtures/valid-applies-when.json` (spec §12),
   including `na` from `applies_when` over an in-date override.
4. Disabling a lens keeps its facets; the export shows `enabled: false`.

### P5. KPI lens tag and the feature↔KPI link

The scan can already scope a KPI to a feature (`src-tauri/src/commands/infrastructure/kpi_scan.rs:876-889`,
prompt line 193), yet live data has none. The detail modal shows category
(`src/features/teams/sub_kpis/KpiDetailModal.tsx:128`); the overview rolls up by group
(`src/features/teams/sub_kpis/kpiOverviewModel.ts:39-62`); `src/features/teams/sub_features/FeaturesPage.tsx`
never mentions KPIs.

Changes:
- **`lens` column.** Add a nullable `lens TEXT` to `dev_kpis`, FK to `lens_definitions(id)`
  `ON DELETE SET NULL`. Show it next to the category, and add it to `update_kpi` (`kpis.rs:170`).
- **Linking pass.** Add a pass that proposes `use_case_id` for KPIs whose context is in exactly one
  feature's slice. The person accepts or rejects each proposal, as with KPI proposals.
- **Features page.** Show each feature's KPIs by scope precedence (spec §7).

Acceptance:
1. `lens` round-trips through create, update and export; an unknown lens id is refused.
2. The pass reports how many KPIs gained a `use_case_id`; none was set without a person accepting it.
3. A feature with a feature-scoped KPI shows it on the Features page.

### P6. ai-registry `build-registry-map.mjs`

`readContexts` (`scripts/build-registry-map.mjs:350-388`) reads flat `contexts[]` and ignores other
keys, but line 386 labels any file with a `$schema` and no `generator` as `vibeman`.

Change: branch on `$schema === 'app-structure/3'` (generator `app-structure-3`); note in a comment
that the new sections are ignored.

Acceptance:
1. `docs/standard/schema/fixtures/valid-map.json` with `generator` removed is read as
   `app-structure-3`.
2. A Personas v3 export gives the same context rows as its v2 export did.
3. Vibeman and v2 inputs are unchanged.

## 3. Data migration

- **Stage backfill** (P3) for the 142 active features, first match wins:
  1. `core` in a `shipped` milestone → `live` (`stage_since` = its `shipped_at`).
  2. Council state (`src-tauri/db/src/repos/dev/council.rs:158-188`) `approved`, `approved_drifted`
     or `machine_pass` → `live`.
  3. Council state `ready`, `fail`, `rejected`, `incomplete` or `stalled` → `in-review`.
  4. `core` in an `active` milestone → `in-dev`.
  5. In a `planned` milestone, or a `later` bucket → `specified`.
  6. No context links and `created_by = 'user'` → `idea`.
  7. Otherwise NULL (unknown, never guessed).

  Each backfilled feature gets one `feature-added` event (`to` = its stage, `source: "backfill"`)
  dated at migration, so the log invents no earlier history. Archived features get no stage.
- **KPIs** are untouched. The only changes are the new `slug` (P1) and a NULL `lens` (P5).
- **Lens facets** start empty: every feature reads `unmeasured`. Council scores are not copied
  (different dimensions, different rules).

## 4. Order and risks

**Proposed order:** P1, then P3, P4, P5, P2. P6 can go any time.
- **P1** first: merge-on-rescan stops the whole-file rewrite (EXPORT:90-95) erasing v3 sections.
  It ships alone, with empty `lenses` and no `stage`.
- **P3** ships alone; the export then fills `stage` and starts the events file.
- **P4** needs `stage` for its evaluator; **P5** needs `lens_definitions`; **P2** ingests what all
  the others store.
- **P6** ships alone: Personas already sets `generator`, so the mislabel only hits hand-written
  v3 files.

Risks:
- **Two writers of `stage`.** A hand edit to an undeclared map is overwritten by the database
  value. A person owns stage via `declared: true` plus P2, or via the Personas door.
- **Feature renames change the slug.** `update_use_case` re-slugifies on rename (`use_cases.rs:268-270`),
  so the merge would keep the old feature and add a new one, and file facets, KPI scopes and events
  would still name the old slug. P1 needs an answer to Q4 before it ships.
- **"Lens" is taken.** Scan agents are called lenses (`src-tauri/src/commands/infrastructure/scan_agents.toml`,
  23 entries). Keep the new code under `lens_definitions` and facet names.
- **Backfill rule 2** assumes approval means shipped, which is false for batch releases (Q1).

## 5. Open questions for the Personas owner

1. **Backfill rule 2.** Is a council approval close enough to `live` for Personas' own projects, or
   should approved features stop at `in-review` until a milestone ships?
2. **Declared maps and the events file.** When a map has `declared: true`, should Personas still
   append to `context-map.events.jsonl` (its stage changes would then be recorded but not shown in
   the map), or leave both files alone?
3. **Feature priority.** The `business` lens binds `priority`. Should `dev_use_cases` gain a
   `priority` (P0-P3), or should that rule stay silent in Personas?
4. **Slug on rename.** Freeze a feature's slug once set (telemetry matching moves to the name), or
   keep re-slugifying and wait for the `feature-renamed` event that analysis §7 plans for a later
   minor version?
5. **Registry key.** The registry keys contexts on `id` when all have one (`build-registry-map.mjs:384`),
   but the spec says nothing may rely on `id` and full rescans re-create ids. Should P6 switch v3
   files to `group/name` keys, at the cost of one churn pass?
