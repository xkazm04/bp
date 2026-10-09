# App structure v3

Status: standard, version 3 (lens manifests version 1). Reference specification.
Design history and the decisions behind it: [analysis.md](analysis.md).

## 1. Purpose

One data file per app project describes what the project is made of and how each part is doing.
Personas reads and writes it to operate the project; the blueprint reads it to draw the project.

The file is `context-map.json`, version 3 of Personas' context map. It holds:

- the **code tree**: context groups and contexts, exactly as in v2;
- the **product tree**: domains, capabilities and features, linked many-to-many to contexts;
- **milestones** and **KPIs**;
- **lenses**: the plugins the project uses, each with a full copy of its manifest;
- **facets**: each feature's values for each lens.

History lives beside it in an append-only events log, `context-map.events.jsonl`.

A lens is a plugin, not part of the format. A lens manifest declares its fields, a health rule
written as JSON data, and how it should be drawn. Six built-in lenses ship in a catalog
(`docs/standard/lenses/`); a project can add its own or switch any of them off.

## 2. Conformance

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are used as in RFC 2119.

The JSON Schemas (draft 2020-12) in `docs/standard/schema/` are normative for structure:

| Schema | Validates |
|---|---|
| `app-structure-3.schema.json` | a `context-map.json` v3 file |
| `lens-manifest-1.schema.json` | one lens manifest (also embedded as `lenses[].manifest`) |
| `app-structure-event-3.schema.json` | one line of the events log |

This document is normative for meaning: references, absent values, health evaluation, rollup,
the events log and merging. The TypeScript types in `src/lib/standard/types.ts` mirror the schemas;
`src/lib/standard/health.ts` is the reference evaluator.

- A **reader** is anything that loads the file. A reader MUST ignore keys it does not know.
- A **writer** is anything that saves it. A writer MUST keep what it does not own (section 11).
- A file is valid when it passes the schema and the reference checks in section 12.

## 3. Conventions

**Format marker.** `"$schema": "app-structure/3"` marks a v3 file. Readers MUST branch on it, not on
`version` (an older, incompatible Vibeman shape also said `2.0.0`). `version` is `3`.

**References.** Features, KPIs, milestones, domains and capabilities are referred to by `slug`.
Contexts and groups are referred to by `name`, which is their stable key. A UUID `id` MAY appear on
any record; writers pass it through unchanged and nothing MAY rely on it (Personas re-creates UUIDs
on full rescans).

**Slugs** match `^[a-z0-9][a-z0-9.-]*$`. A capability slug MAY carry its domain as a prefix
(`payments.billing`); this is a naming habit, not a rule.

**Absent values.** An unknown value is **omitted**. Writers MUST NOT write `null`, and MUST NOT write
`0`, `""` or `false` to mean "unknown" ("null is never zero"). Readers treat an absent value as
unknown, never as zero.

**Dates** are `YYYY-MM-DD`. **Date-times** are ISO 8601 with a zone (`2026-10-08T09:00:00Z`).

**Unknown keys.** Readers ignore them everywhere. The schema allows them where the ecosystem already
writes more than the standard names: the top level, `project`, `provenance`, `taxonomy`, `groups[]`,
`contexts[]`, `features[]`, `kpis[]` (Personas carries more KPI columns), facets and events. The
v3 grammar objects are closed, so typos fail validation: domains, capabilities, milestones, KPI
scopes, lens entries, manifests and everything inside them, conditions, overrides, feature
`parts` and `notes`.

**Lens ids.** The six built-in lenses use short ids: `business`, `design`, `development`,
`operations`, `security`, `quality`. Every other lens MUST use a reverse-DNS id matching
`^[a-z]{2,}(\.[a-z0-9-]+){2,}$` (`com.kettle.cost`), so it can never take a built-in's name. Code
MUST NOT branch on the built-in ids; every lens is drawn and evaluated from its manifest.

**Extensions.** `extensions` holds writer-specific data under reverse-DNS keys. Every writer MUST
keep it.

## 4. Top level

| Key | Type | Req. | Meaning |
|---|---|---|---|
| `$schema` | `"app-structure/3"` | yes | Format marker. |
| `version` | `3` | yes | |
| `project` | object | yes | `slug` (req.), `name` (req.), `id`, `description`, `kind`, `root`. Writers SHOULD omit the machine-specific `root` from git-tracked maps. |
| `generator` | string | | Who wrote the file: `personas-context-scan`, `kettle-sample`, `hand`. |
| `generated_at` | date-time | | |
| `declared` | boolean | | `true` only on a git-tracked, hand-owned map. Exporters never overwrite such a file and never write this key themselves. |
| `provenance` | object | | Free metadata, e.g. `git_commit`, `git_commit_count`. |
| `taxonomy` | object of string lists | | Vocabularies: `context_categories`, `group_domains`, `feature_kinds`, `feature_tiers`. |
| `stats` | object of integers | | Counts (`groups`, `contexts`, `features`, `kpis`, `lenses`). Informational; regenerated by writers. |
| `groups` | Group[] | | Code tree (section 5). |
| `contexts` | Context[] | | Code tree (section 5). |
| `domains` | Domain[] | | Product tree (section 6). |
| `capabilities` | Capability[] | | Product tree. |
| `features` | Feature[] | | Product tree. |
| `milestones` | Milestone[] | | Section 6.4. |
| `kpis` | Kpi[] | | Section 7. |
| `lenses` | LensEntry[] | | Section 8. |
| `facets` | object | | Section 9. |
| `extensions` | object | | Reverse-DNS keys only. |

A list that is absent means "none declared". `features[]` replaces v2's `use_cases[]` (section 11).

## 5. Code tree (v2, unchanged)

`groups[]` and `contexts[]` are flat and snake_case exactly as in v2, so a v3 file is still a valid
v2 declaration for code-tree readers (the Personas declaration reader, ai-registry
`build-registry-map.mjs`, devlog, the dev-mode readers).

- **Group:** `name` (req., unique), `id`, `color`, `domain`, `context_count`.
- **Context:** `name` (req., unique, the stable key), `id`, `group` (a group name), `group_id`,
  `category`, `business_feature`, `description`, `file_paths[]`, `entry_points[]`, `db_tables[]`,
  `keywords[]`, `api_surface`, `cross_refs[]`, `tech_stack[]`, `pinned`, `last_written_at`.

## 6. Product tree

The product tree (domain, then capability, then feature) sits beside the code tree. Features link
many-to-many to contexts. The product tree is **declared** (git-tracked, owned by people); a scan
MAY only propose additions (section 11).

### 6.1 Domain

| Field | Type | Req. | |
|---|---|---|---|
| `slug` | slug | yes | Unique. |
| `name` | string | yes | |
| `id` | string | | Passed through. |
| `summary` | string | | |
| `order` | number | | Display order. |
| `source` | `declared` \| `proposed` | | Absent = `declared`. A scan writes only `proposed`. |

### 6.2 Capability

As Domain, plus `domain` (req.): the slug of its domain.

### 6.3 Feature

| Field | Type | Req. | |
|---|---|---|---|
| `slug` | slug | yes | Unique. The key for KPIs, facets and events. |
| `name` | string | yes | |
| `id` | string | | Passed through (Personas `dev_use_cases` id). |
| `summary` | string | | |
| `kind` | string | | Personas: `user_flow`, `capability`, `integration`, `ops` (see `taxonomy`). |
| `tier` | string | | Personas: `major`, `standard`. |
| `status` | `active` \| `archived` | | Personas compatibility. |
| `capability` | slug | | Its capability. Absent = not yet placed in the product tree. |
| `contexts` | string[] | | Context names (code tree links). |
| `primary_context` | string | | A context name, SHOULD be one of `contexts`. |
| `stage` | Stage | | Section 6.5. Absent = unknown, shown as unknown and never guessed. Writers SHOULD set it. |
| `stage_since` | date | | When it entered `stage`. |
| `priority` | `P0`..`P3` | | |
| `milestone` | slug | | A milestone slug. |
| `depends_on` | slug[] | | Feature slugs it needs. |
| `blocked_by` | slug[] | | Feature slugs blocking it now. |
| `owner` | string | | Actor id (free string in v3). |
| `built_by` | string[] | | Actor ids. |
| `surfaces` | string[] | | e.g. `api`, `workers`, `mobile`. |
| `created` | date | | |
| `parts` | `{name, done}[]` | | Sub-deliverables. |
| `notes` | `{by, date, text}[]` | | |

Health is not a feature field. It is computed per lens from facets (section 8.4).

### 6.4 Milestone

`slug` (req.), `name` (req.), `status` (req.: `planned` \| `active` \| `shipped`), `id`,
`target_date` (date), `goal`.

### 6.5 Stage vocabulary

A core field from a fixed, ordered list. It is not a lens. Changes are recorded as `stage` events.

| Stage | Meaning |
|---|---|
| `idea` | Proposed, not yet specified. |
| `specified` | Specified, no code yet. |
| `in-dev` | Being built. |
| `in-review` | Built, in review. |
| `flagged` | Live behind a partial rollout. |
| `live` | Live for everyone. |
| `deprecated` | Still running, on its way out. |

## 7. KPIs

Carried over from Personas `dev_kpis`.

| Field | Type | Req. | |
|---|---|---|---|
| `slug` | slug | yes | Unique. |
| `name` | string | yes | |
| `scope` | KpiScope | yes | Exactly one of `{"feature": slug}`, `{"context": name}`, `{"group": name}`, `{"project": true}`. |
| `id` | string | | Passed through. |
| `category` | `technical` \| `traffic` \| `value` \| `quality` | | |
| `lens` | lens id | | Optional lens tag: the lens this KPI informs. |
| `unit` | string | | `%`, `ms`, `USD`. |
| `direction` | `up` \| `down` | | Which way is better. |
| `baseline`, `target`, `warn_at`, `crit_at` | number | | Thresholds. |
| `target_date` | date | | |
| `current` | `{value, measured_at, env}` | | The latest measurement; `value` (number) required inside it. Absent when nothing was measured. |
| `status`, `tier`, `measure_kind` | string | | Personas columns. |

**Scope precedence:** feature, then context, then group, then project. The KPIs that apply to a
feature are those scoped to it, to any of its contexts, to those contexts' groups, and to the
project. Where a reader shows one KPI per `category` (or per `lens` tag) for a feature, the narrowest
scope wins, in that order.

A lens field MAY take its value from a KPI (section 8.2, `source`).

## 8. Lenses

### 8.1 Lens entries (`lenses[]`)

Catalog plus snapshot: built-in and custom manifests exist in a catalog, and the map holds a full
copy of each manifest it uses, so the file is self-describing.

| Field | Type | Req. | |
|---|---|---|---|
| `id` | lens id | yes | Unique within `lenses[]`. MUST equal `manifest.id`. |
| `version` | semver | yes | MUST equal `manifest.version`. |
| `source` | `builtin` \| `project` | yes | `builtin` requires a built-in id; `project` requires a reverse-DNS id. |
| `enabled` | boolean | yes | `false` hides the lens. Its facets are kept. |
| `manifest` | LensManifest | yes | A full copy. |

Switching a lens off is not deleting it. Removing an entry orphans its facets, and a writer MUST
keep orphaned facets (section 11).

### 8.2 Lens manifest (`$schema: "lens-manifest/1"`)

| Field | Type | Req. | |
|---|---|---|---|
| `$schema` | `"lens-manifest/1"` | yes | |
| `id` | lens id | yes | |
| `version` | semver | yes | |
| `name` | string | yes | e.g. `Security`. |
| `short` | `^[A-Z0-9]{2,4}$` | | Short label, e.g. `SEC`. |
| `description` | string | | |
| `reader` | `{role, density}` | yes | `density`: `simple` \| `standard` \| `dense` (how much a reader of this lens wants to see). `role`: who reads it. |
| `fields` | Field[] | yes | At least one. Keys unique. |
| `health` | Health | yes | Section 8.3. |
| `presentation` | Presentation | yes | Section 8.5. |

**Field:**

| Field | Type | Req. | |
|---|---|---|---|
| `key` | `^[a-z][A-Za-z0-9]*$` | yes | camelCase. Values are flat: nested data is flattened into keys (`openBugsP1`). |
| `label` | string | yes | |
| `type` | FieldType | yes | See below. |
| `values` | string[] | enum only, required | The ordered list of allowed values, first to last. |
| `currency` | ISO 4217 | money only, required | |
| `min`, `max` | number | | Bounds for numeric fields. `max` also scales the lens line (8.6). |
| `unit` | string | | Display unit, e.g. `ms`. |
| `headline` | boolean | | The field that best sums up the lens. |
| `description` | string | | |
| `source` | `{kpi: slug}` \| `{feature: core field}` | | A **bound** field: its value comes from somewhere other than the facet and is filled in at evaluation. Exactly one key. See below. |

**Bound fields.** A field with a `source` is read-only for producers: its value is filled in when
health is evaluated, and a value stored in the facet under its key is ignored (validators warn about
it; writers SHOULD NOT write one).
- `{"kpi": "<slug>"}`: the KPI's `current.value`. The KPI MUST exist in the map. If it has no
  current value, the field is absent. The binding lives in the manifest, so the value is the same
  for every feature that has this lens: bind KPIs that describe the lens's context (a project-wide
  bill, a group SLO), and keep per-feature measurements in facet values.
- `{"feature": "<core field>"}`: the feature's own core field, so rules can read lifecycle facts
  without copying them into every lens (stage stays one core field, decision 4). Only these core
  fields can be bound: **`stage`, `priority`, `kind`, `tier`, `milestone`, `status`**. Any other
  name is an error. If the feature has no value for it, the field is absent (an unknown stage never
  matches `in`, it is never guessed). A field bound to `stage`, `priority` or `status` SHOULD be an
  `enum` listing that core vocabulary; `kind`, `tier` and `milestone` are free strings, so `enum`
  or `string`.

Bound values are not measurements: a facet whose only values would be feature-bound is unmeasured.

**Field types:** `number`, `integer`, `percent` (0..100 unless `min`/`max` say otherwise), `money`
(with `currency`), `boolean`, `string`, `enum` (ordered `values`), `date` (`YYYY-MM-DD`).

### 8.3 Health rule

```jsonc
"health": {
  "applies_when": <condition>,            // optional
  "rules": [ { "when": <condition>, "health": "good" | "watch" | "bad", "reason": "text with {field}", "short": "≤ 28 chars, optional" } ],
  "default": "good" | "watch" | "bad",
  "rollup": { "method": "worst-of" } | { "method": "share", "watch": 0.2, "bad": 0.34 } | { "method": "weighted", "by": "<field>" }
}
```

`rules`, `default` and `rollup` are required; every rule needs `when`, `health` and `reason`.

**`applies_when`** (optional) says when the lens applies to a feature at all, in the same grammar.
When it is present and does not match, the lens's health is `na`. It moves the judgment "does this
lens apply?" into the manifest, so every producer gets the same answer; a facet's
`"applicable": false` still forces `na` and wins (section 8.4). An `applies_when` that names a field
the manifest does not declare is ignored, so the lens applies; validators reject it as an error,
because silently hiding a lens would be worse than showing it.

**Condition grammar.** This is all of it, so every implementation evaluates it identically.

- A **leaf** is `{ "field": <key>, <op>: <operand> }` with **exactly one** operator. A leaf with no
  operator or several never matches, and validators reject it.
- Leaves combine with `{ "all": [c, ...] }` (every one matches; at least one item), `{ "any": [c, ...] }`
  (at least one matches; at least one item) and `{ "not": c }`.

| Operator | Operand | Matches when the value is |
|---|---|---|
| `eq` | string, number or boolean | present and strictly equal to the operand |
| `ne` | string, number or boolean | present and not strictly equal |
| `lt` `lte` `gt` `gte` | number or string | present, and both are numbers (numeric order) or both are strings (code-unit order, correct for ISO dates); otherwise no match |
| `in` | non-empty array of scalars | present and strictly equal to one of the items |
| `nin` | non-empty array of scalars | present and equal to none of the items |
| `missing` | `true` | absent |
| `present` | `true` | present |

Semantics, exactly:

1. **Missing values.** A value that is absent (or, in malformed data, `null`) matches only
   `missing`. Every other operator is false on it, including `ne` and `nin`. `not` inverts the
   result as usual, so `{"not": {"field": "x", "eq": 1}}` is true when `x` is absent. To mean
   "present and not 1", write `{"all": [{"field": "x", "present": true}, {"field": "x", "ne": 1}]}`.
2. **No type coercion.** `5` never equals `"5"`; `true` never equals `1`. A comparison across types
   is false (for `ne` and `nin`, strict inequality makes it true when the value is present).
3. **`in` and arrays.** The operand is the list. The value is a single scalar (no field type is a
   list); it matches if it is strictly equal to an item. Enum values are compared as strings:
   ordering operators do not use enum position, so write enum ranges with `in`.
4. **Unknown fields.** A rule that names a field the manifest does not declare never matches, as a
   whole, even when the name sits under `not` or `any`. Validators warn about it.
5. **First match wins.** Rules are evaluated top to bottom; the first rule whose `when` matches gives
   the health. If none matches, the health is `default`.
6. **Reasons.** `{key}` in `reason` is replaced by the field's value (bound values included), or by
   `unknown` when it is absent.
7. **Short reasons.** A rule MAY add `short` (at most 28 characters, same `{key}` substitution):
   the reason for tight places such as a tile stamp. Viewers use `reason` where it fits and fall
   back to `short`; a rule without `short` falls back to the lens name.

**What a condition can read.** The lens's own facet values, with bound fields filled in (KPI values
and the whitelisted core feature fields). It cannot read other lenses' values or compare two fields
with each other. A producer that knows something the rules cannot express uses an override
(section 9) or a field.

### 8.4 Health values and evaluation

| Health | Source |
|---|---|
| `good`, `watch`, `bad` | Computed by the rules, or set by an override. |
| `unmeasured` | The feature has no facet for the lens, or a facet with no measured values and no override in force. |
| `na` | The lens does not apply: the facet says `"applicable": false`, or the manifest's `applies_when` does not match. |

**Precedence:** `applicable: false` > `applies_when` > override (in date) > rules > `default`, and
`unmeasured` when there are no measured values and no override. "Measured values" are the facet's
values after binding, not counting feature-bound fields. Exactly, in this order:

1. No facet → `unmeasured`.
2. `"applicable": false` → `na`.
3. No measured values and no override → `unmeasured`.
4. `applies_when` present and not matching → `na`.
5. An `override` whose `until` is today or later (inclusive, compared as dates) → its `health`.
6. No measured values (the override has expired) → `unmeasured`.
7. The first matching rule → its `health`; else `default`.

The feature's own health in a General view is the worst of its lenses' measured healths (`bad`
over `watch` over `good`), over enabled lenses only; `na` and `unmeasured` do not count (none measured: `unmeasured`).

Health is computed when the data changes and cached. It never runs per animation frame.

### 8.5 Rollup

`rollup` turns the healths of a group of features (a capability, a domain, a room on the plan) into
one health for that group under this lens. Each feature contributes its health from 8.4, so overrides
are already applied. Only **measured** features (`good`, `watch`, `bad`) count: `na` and
`unmeasured` features are left out of both numerator and denominator. If no feature is measured,
the rollup is `na` when every feature is `na`, else `unmeasured` (also for an empty group).

| Method | Result |
|---|---|
| `worst-of` | `bad` if any is bad, else `watch` if any is watch, else `good`. |
| `share` `{watch, bad}` | With *n* measured features: if bad/*n* ≥ `bad` → `bad`; else if (watch + bad)/*n* ≥ `watch` → `watch`; else `good`. Thresholds are fractions 0..1, both required. |
| `weighted` `{by}` | Score good = 0, watch = 1, bad = 2. Take the mean score weighted by each feature's value of the numeric field `by`. Mean < 0.5 → `good`, < 1.5 → `watch`, else `bad`. A feature whose weight is absent, not a number or not positive weighs 0. If the total weight is 0, use `worst-of`. |

### 8.6 Presentation

| Field | Type | Req. | |
|---|---|---|---|
| `glyph` | glyph name \| `{path}` | yes | A name from the shared glyph set, or an SVG path in a 16x16 box. |
| `line` | line name | yes | A name from the shared line set. |
| `accent` | `{dark, light}` | | `#rrggbb` per theme. Optional; the subtle view draws in ink only. |
| `evidence` | field key[] | | The fields a tile shows, in order. Readers show the first 2 (`simple`), 3 (`standard`) or 4 (`dense`), by `reader.density`. |
| `measures` | field key | | The field the lens line measures. MUST be numeric or an enum. |

**The lens line.** The measured length of a lens's line, as a fraction 0..1 of the rail:
- numeric field: value / `max`, clamped to 0..1 (`percent` uses `max` 100 when none is given);
- enum field: the value's position / (number of values - 1), so the first value is an empty rail;
- absent value: nothing is measured, and the rail stays a faint hairline.

**Shared glyph set** (drawn in a square, ink only, a few strokes each, distinct at 7 px):

| Name | Drawing | Built-in use |
|---|---|---|
| `bars` | three rising bars | business |
| `set-square` | a drafting set square: a right triangle with a small inner right angle | design |
| `brackets` | a pair of angle brackets, `< >` | development |
| `pulse` | a pulse line: flat, a sharp peak and trough, flat | operations |
| `padlock` | a padlock: filled body and shackle | security |
| `check` | a check mark | quality |

**Shared line set** (drawn along a rail band):

| Name | Drawing | Built-in use |
|---|---|---|
| `solid` | one continuous rule | (custom lenses) |
| `double` | two parallel hairlines, a ledger's double underline | business |
| `dotted` | a row of dots, a guide line | design |
| `comb` | a base rule with regular ticks, a ruler | development |
| `chain` | long dash, dot, long dash: a centre line | operations |
| `hatched` | a band between two rules filled with diagonal hatching, a fire-rated wall | security |
| `dimension` | a rule with end ticks, a dimension line | quality |

Renderers MUST draw every name in both sets. A custom `glyph.path` is untrusted input: renderers
MUST parse it only as a path (for example with `Path2D`), never as markup. The schema limits it
to path commands and numbers, at most 2048 characters.

## 9. Facets

```jsonc
"facets": { "<feature slug>": { "<lens id>": <Facet> } }
```

| Field | Type | |
|---|---|---|
| `values` | object | Field key → string, number or boolean. Flat. Unknown values are omitted. Bound fields (8.2) are not stored here. |
| `applicable` | boolean | `false` = the lens does not apply to this feature (health `na`), whatever `applies_when` says. Absent = the manifest decides. For facts no lens value carries (a feature with no screen has no design); values MAY still be present. |
| `measured_at` | date-time | When the values were taken. |
| `source` | string | Who produced them: `scan`, `hand`, a tool name. Used by merging (section 11). |
| `override` | `{health, by, why, until}` | All four required. `health` is `good`, `watch` or `bad`; `until` is a date (inclusive). After `until` the rules apply again. |

- Every key of `facets` MUST be a feature slug in `features[]`.
- A facet whose lens id is not in `lenses[]` is **orphaned**. It is not an error, readers ignore it,
  and writers MUST keep it.
- Each value MUST fit its field's type (and `values`, `min`, `max`) when the lens is in `lenses[]`.
  A value for an undeclared key is kept, ignored by the rules, and warned about.

## 10. Events log (`context-map.events.jsonl`)

One JSON object per line, beside the map. The log is **append-only**: writers append lines and
never rewrite, reorder or delete them. Lines SHOULD be in time order.

Every event has `at` (date-time, req.) and `type` (req.), and MAY have `actor` and `source`.

| `type` | Required fields | `from` / `to` |
|---|---|---|
| `stage` | `feature`, `from`, `to` | stages |
| `lens-health` | `feature`, `lens`, `from`, `to` | healths, including `unmeasured` and `na` |
| `kpi-threshold` | `kpi`, `from`, `to` | the KPI's track verdicts (free strings) |
| `milestone` | `milestone`, `from`, `to` | `planned`, `active`, `shipped` |
| `feature-added` | `feature` | `to` (optional): the stage the feature was added at |
| `feature-archived` | `feature` | |
| `lens-enabled` | `lens` | |
| `lens-disabled` | `lens` | |

Readers MUST skip types they do not know. Events MAY name features, KPIs or milestones that no longer
exist in the map (history outlives records); validators only warn. Weekly snapshots and "what
changed" are derived from the log: the stage of a feature on a date is the `to` of its last `stage`
or `feature-added` event at or before that date. Writers SHOULD give `feature-added` a `to`; without
one, the feature's stage is unknown until its first `stage` event.

## 11. Compatibility and merging

**Reading v2.** A file without `$schema` and with `version: 2` is a v2 map. A v3 reader that accepts
it maps `use_cases[]` to `features[]` (slug, name, kind, tier, status and context links) with no
`stage`, shown as unknown and never guessed. The six built-in lenses are available but every feature
is `unmeasured`. A v3 reader also accepts `use_cases[]` as a stand-in when a v3 file has no
`features[]`. A v3 writer emits only `features[]`.

**v3 for v2 readers.** A v3 file is a valid v2 declaration for code-tree readers, because `groups[]`
and `contexts[]` are unchanged and unknown keys are ignored.

**Every writer** MUST:
- keep `extensions`, unknown keys at the levels where they are allowed, orphaned facets, facets of
  lenses it does not know, and lens entries with `source: "project"` (never edit or drop them);
- never write `null`;
- append an event for each change it makes to a feature's stage, a milestone's status, a lens's
  `enabled`, or a feature's existence or archiving.

**A rescan** (Personas regenerating the map from its database) MAY regenerate only `groups[]`,
`contexts[]` and `stats`, plus the file metadata (`provenance`, `generator`, `generated_at`).
Everything else is merged:

| Section | Merge rule |
|---|---|
| `features[]` | Matched by `slug`. The scan updates only the fields it owns: `id`, `kind`, `tier`, `status`, `contexts`, `primary_context`. It MAY add features it finds (with no `stage` unless it knows it). It MUST NOT delete a feature; one the scan no longer finds keeps its record (it may be declared ahead of code). Every other field is kept. |
| `domains[]`, `capabilities[]` | Declared. The scan MUST NOT change or remove them; it MAY add entries with `source: "proposed"`. |
| `milestones[]` | Declared; kept as is. |
| `kpis[]` | Matched by `slug`. The scan updates the measured fields it owns (`current`, thresholds, `status`); it keeps `lens` and unknown keys. It does not delete KPIs that other writers added. |
| `lenses[]` | Kept. A catalog upgrade MAY refresh the manifest copy (and `version`) of `source: "builtin"` entries only. `enabled` is never changed by a scan. |
| `facets` | Matched by feature slug and lens id. A producer replaces only facets it produced (same `source`) and keeps every other facet. It keeps `override` unless it is the one who set it; it MAY drop an expired override. |
| `taxonomy` | Kept; the scan MAY add values to its lists. |
| `extensions` | Kept verbatim. |

A map with `declared: true` is hand-owned: exporters MUST NOT overwrite it.

## 12. Validation

`node scripts/validate-structure.mjs <file.json>... [--events <file.jsonl>]` (`npm run validate:structure`)
runs the schema (ajv, 2020 dialect) and then the reference checks a schema cannot express. With no
arguments it validates the six built-in manifests.

Errors (the file is invalid):
- duplicate slugs, names or lens ids; duplicate field keys in a manifest;
- a capability's domain, a feature's capability, contexts, primary context, milestone, `depends_on`
  or `blocked_by`, a KPI scope target, or a field's `source.kpi` that does not resolve;
- a field bound to a core feature field outside the whitelist, or bound to one with a type other
  than `enum` or `string`;
- an `applies_when` that names an undeclared field;
- a facet keyed by an unknown feature; a facet value that does not fit its field;
- `lenses[].id` or `version` that differs from its manifest's;
- `presentation.evidence`/`measures` or a `weighted` rollup naming an unknown field, or a non-numeric
  weight or measure.

Warnings: rules or reasons naming unknown fields, enum operands outside the field's values, ordering
operators on enums, a facet that stores a value for a feature-bound field, a field bound to `stage`,
`priority` or `status` whose enum lacks part of that vocabulary, a KPI lens tag not in `lenses[]`, a `primary_context` outside `contexts`, `stats`
that disagree with the lists, events naming records not in the map or out of time order.
Notes: orphaned facets, expired overrides.

Fixtures in `docs/standard/schema/fixtures/`:
- `valid-map.json` with `valid-map.events.jsonl`: the example in section 14.
- `valid-applies-when.json`: a custom lens with feature-bound `stage` and `tier` and an
  `applies_when`. Read on any date: `book-a-class` (live, major, 25 tickets) is `bad`;
  `loyalty-points` (idea) is `na` even though it has an override in force, because `applies_when`
  outranks overrides; `spot-selection` is `watch`, and the `stage` its facet stores is ignored (a
  warning); `class-packs` is `na` from `"applicable": false`; `virtual-classes` has no facet and is
  `unmeasured`. The rollup (share 0.25 / 0.2 over the two measured features) is `bad`.
- Files that must fail: `invalid-stage.json` (unknown stage), `invalid-lens-id.json` (a custom lens
  without a reverse-DNS id), `invalid-two-operators.json` (a condition leaf with two operators),
  `invalid-core-field.json` (a field bound to the core field `owner`, outside the whitelist).

## 13. The built-in lenses

| Id | Reader density | Glyph | Line | Measures | Rollup | Binds | Applies when |
|---|---|---|---|---|---|---|---|
| `business` | standard | `bars` | `double` | `value` (1..5) | weighted by `value` | `stage`, `priority` | always |
| `design` | simple | `set-square` | `dotted` | `status` (enum) | share 0.25 / 0.15 | `stage` | always (a feature with no screen: `"applicable": false`) |
| `development` | dense | `brackets` | `comb` | `progressPct` | share 0.25 / 0.15 | | `status` is not `not-started` |
| `operations` | dense | `pulse` | `chain` | `rolloutPct` | worst-of | | `environment` is not `none`, `preview` or `staging` |
| `security` | standard | `padlock` | `hatched` | `dataClass` (enum) | worst-of | `stage` | the review has started, and not (public data, no findings, stage `idea` or `specified`) |
| `quality` | standard | `check` | `dimension` | `e2ePassPct` | share 0.2 / 0.1 | `stage` | `status` is not `untested`, and stage is not `idea` or `specified` |

Stage-aware rules in the built-ins: business is `bad` for a P0 at `idea`/`specified` and for 15+
customer requests before it ships, and `watch` when deprecated or when shipped with value ≤ 2;
security is `bad` for a pending review in `flagged`, `live` or `deprecated`; design is `watch` when
shipped with the design at `none`, `sketch` or `wireframe`; quality is `watch` when shipped with
fewer than 3 end-to-end tests.

The manifests are in `docs/standard/lenses/`; `src/lib/standard/catalog.ts` loads them.
`node scripts/check-builtin-health.ts` checks the rules against the Kettle sample, handing each
feature to the evaluator for the bound fields.

## 14. Example

A complete, valid map (`docs/standard/schema/fixtures/valid-map.json`): one group, two contexts,
two features in one capability, a milestone, a KPI, one built-in lens (security, which binds the
feature's `stage` and has an `applies_when`) and one custom lens bound to the KPI, facets with an
override, and an orphaned `business` facet that writers keep.

```json
{
  "$schema": "app-structure/3",
  "version": 3,
  "generator": "hand",
  "generated_at": "2026-10-08T09:00:00Z",
  "declared": true,
  "project": { "slug": "kettle", "name": "Kettle", "kind": "code" },
  "stats": { "groups": 1, "contexts": 2, "features": 2, "kpis": 1, "lenses": 2 },
  "groups": [ { "name": "Payments", "domain": "feature", "context_count": 2 } ],
  "contexts": [
    { "name": "billing-engine", "group": "Payments", "category": "lib" },
    { "name": "dunning-worker", "group": "Payments", "category": "lib" }
  ],
  "domains": [ { "slug": "payments", "name": "Memberships & Payments", "order": 5, "source": "declared" } ],
  "capabilities": [ { "slug": "payments.billing", "domain": "payments", "name": "Billing", "order": 2 } ],
  "features": [
    { "slug": "recurring-billing-engine", "name": "Recurring billing engine", "status": "active",
      "capability": "payments.billing", "contexts": ["billing-engine"], "primary_context": "billing-engine",
      "stage": "live", "stage_since": "2026-06-02", "priority": "P0" },
    { "slug": "failed-payment-dunning", "name": "Failed-payment dunning", "kind": "capability", "tier": "major",
      "status": "active", "capability": "payments.billing", "contexts": ["billing-engine", "dunning-worker"],
      "primary_context": "dunning-worker", "stage": "flagged", "stage_since": "2026-09-30", "priority": "P1",
      "milestone": "payments-ga", "depends_on": ["recurring-billing-engine"], "owner": "mara", "built_by": ["forge-1"] }
  ],
  "milestones": [ { "slug": "payments-ga", "name": "Payments GA", "status": "active", "target_date": "2026-10-22" } ],
  "kpis": [
    { "slug": "dunning-sms-spend", "name": "Dunning SMS spend", "scope": { "feature": "failed-payment-dunning" },
      "category": "technical", "lens": "com.kettle.cost", "unit": "USD", "direction": "down",
      "target": 200, "warn_at": 250, "crit_at": 400,
      "current": { "value": 310, "measured_at": "2026-10-08T06:00:00Z", "env": "production" } }
  ],
  "lenses": [
    { "id": "security", "version": "1.0.0", "source": "builtin", "enabled": true, "manifest": {
      "$schema": "lens-manifest/1", "id": "security", "version": "1.0.0", "name": "Security", "short": "SEC",
      "description": "Data classes, security reviews and open findings.",
      "reader": { "role": "security", "density": "standard" },
      "fields": [
        { "key": "dataClass", "label": "Data class", "type": "enum", "values": ["public", "internal", "personal", "payment"], "headline": true },
        { "key": "review", "label": "Review", "type": "enum", "values": ["not-required", "not-started", "pending", "findings", "passed"],
          "description": "Security review state. The lens does not apply until a review is due." },
        { "key": "openFindings", "label": "Open findings", "type": "integer", "min": 0 },
        { "key": "stage", "label": "Stage", "type": "enum",
          "values": ["idea", "specified", "in-dev", "in-review", "flagged", "live", "deprecated"],
          "source": { "feature": "stage" }, "description": "The feature's lifecycle stage, read from the feature." }
      ],
      "health": {
        "applies_when": { "all": [
          { "not": { "field": "review", "eq": "not-started" } },
          { "not": { "all": [ { "field": "dataClass", "eq": "public" }, { "field": "review", "ne": "findings" },
                              { "field": "stage", "in": ["idea", "specified"] } ] } }
        ] },
        "rules": [
          { "when": { "field": "openFindings", "gt": 0 }, "health": "bad", "reason": "{openFindings} open findings" },
          { "when": { "all": [ { "field": "review", "eq": "pending" }, { "field": "stage", "in": ["flagged", "live", "deprecated"] } ] },
            "health": "bad", "reason": "In production ({stage}) without a finished security review" },
          { "when": { "field": "review", "eq": "pending" }, "health": "watch", "reason": "Security review pending" }
        ],
        "default": "good",
        "rollup": { "method": "worst-of" }
      },
      "presentation": { "glyph": "padlock", "line": "hatched", "accent": { "dark": "#d4a8ff", "light": "#7a36c8" },
                        "evidence": ["dataClass", "review", "openFindings"], "measures": "dataClass" }
    } },
    { "id": "com.kettle.cost", "version": "0.1.0", "source": "project", "enabled": true, "manifest": {
      "$schema": "lens-manifest/1", "id": "com.kettle.cost", "version": "0.1.0", "name": "Cost", "short": "COST",
      "description": "Running cost per feature, including SMS spend.",
      "reader": { "role": "finance", "density": "standard" },
      "fields": [
        { "key": "monthlyUsd", "label": "Monthly cost", "type": "money", "currency": "USD", "min": 0, "max": 5000, "headline": true },
        { "key": "smsSpendUsd", "label": "SMS spend", "type": "money", "currency": "USD", "min": 0, "source": { "kpi": "dunning-sms-spend" } }
      ],
      "health": {
        "rules": [
          { "when": { "field": "monthlyUsd", "gte": 2000 }, "health": "bad", "reason": "Costs {monthlyUsd} USD a month" },
          { "when": { "field": "smsSpendUsd", "gte": 250 }, "health": "watch", "reason": "SMS spend {smsSpendUsd} USD this month" }
        ],
        "default": "good",
        "rollup": { "method": "weighted", "by": "monthlyUsd" }
      },
      "presentation": { "glyph": { "path": "M2 14h12M4 14V6h8v8M6 6V3h4v3" }, "line": "solid",
                        "evidence": ["monthlyUsd", "smsSpendUsd"], "measures": "monthlyUsd" }
    } }
  ],
  "facets": {
    "recurring-billing-engine": {
      "security": { "values": { "dataClass": "payment", "review": "passed", "openFindings": 0 },
                    "measured_at": "2026-10-08T08:10:00Z", "source": "scan" },
      "business": { "values": { "value": 5 } }
    },
    "failed-payment-dunning": {
      "security": {
        "values": { "dataClass": "payment", "review": "pending", "openFindings": 0 },
        "measured_at": "2026-10-08T08:10:00Z", "source": "scan",
        "override": { "health": "watch", "by": "jonas", "why": "Review booked Thursday", "until": "2026-10-16" }
      },
      "com.kettle.cost": { "values": { "monthlyUsd": 340 }, "source": "hand" }
    }
  },
  "extensions": { "com.kettle.sample": { "note": "sample data" } }
}
```

Reading it on 2026-10-09:
- `failed-payment-dunning` / `security`: `applies_when` matches (payment data, review pending), and
  the bound `stage` is `flagged`, so the rules say `bad` ("In production (flagged) without a finished
  security review"). The override says `watch` until 2026-10-16 inclusive, so the health is `watch`.
  From 2026-10-17 the rules apply again.
- `failed-payment-dunning` / `com.kettle.cost`: `smsSpendUsd` comes from the KPI (310), so the
  second rule matches: `watch`, "SMS spend 310 USD this month".
- `recurring-billing-engine` / `com.kettle.cost`: no facet, so `unmeasured`.
- The `business` facet is orphaned (no `business` entry in `lenses[]`): ignored and kept.
- Security rollup over the capability (worst-of over `good` and `watch`): `watch`.

Its events log (`valid-map.events.jsonl`):

```json
{"at":"2026-09-23T10:00:00Z","type":"stage","feature":"failed-payment-dunning","from":"in-dev","to":"in-review","actor":"forge-1","source":"scan"}
{"at":"2026-09-30T14:02:00Z","type":"stage","feature":"failed-payment-dunning","from":"in-review","to":"flagged","actor":"tender","source":"scan"}
{"at":"2026-10-01T09:00:00Z","type":"lens-health","feature":"failed-payment-dunning","lens":"security","from":"bad","to":"watch","actor":"jonas","source":"hand"}
{"at":"2026-10-08T06:00:00Z","type":"kpi-threshold","kpi":"dunning-sms-spend","from":"on-track","to":"at-risk","source":"scan"}
```
