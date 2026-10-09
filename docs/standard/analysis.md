# App structure standard v3: analysis and design brief

Status: designed, 2026-10-09. Spark `blueprint-data-standard`. The decisions came from three
question waves with the owner.

**Goal.** One data format per app project. Personas reads and writes it to operate the project,
and the blueprint reads it to draw the project. Lenses are plugins that can be added and removed.

## 1. Summary

The standard is version 3 of Personas' `context-map.json`. It keeps everything in v2 (the code
tree: context groups, contexts, and features linked across contexts) and adds:
- a product tree: domains, then capabilities, then features;
- a lifecycle stage on every feature;
- milestones;
- KPIs, carried over from Personas' model;
- a list of lens plugins, each with a copy of its manifest;
- per-feature lens values ("facets").

An append-only events log beside the file holds history. Lenses are not built into the format: each
one is a manifest that declares its fields, a health rule written as JSON data (no code), and how it
should be drawn. Six built-in lenses ship in a catalog, and a project can add its own or switch any
of them off.

## 2. What exists today

The evidence for this section comes from three read-only scouts over the Personas repo (sibling checkout `../personas`).

| | Personas today | Blueprint today (Kettle sample) |
|---|---|---|
| File | `context-map.json` v2. The scan writes it from the database and rewrites the whole file each time. A git-tracked file marked `"declared": true` is read back in and never overwritten. | `src/data/kettle.json` (sample data) |
| Code tree | `groups[]` and `contexts[]` (219 contexts in 16 groups for Personas itself) | none |
| Product tree | none | 13 domains, 29 capabilities |
| Feature | a `dev_use_cases` row: slug, kind, tier, status `active` or `archived`, linked to many contexts. **No stage, no health, no dimensions, no history.** | stage (7 values), priority, milestone, dependencies, a 6-lens object, health |
| KPI | `dev_kpis` (scope precedence: use case, then context, then group, then project; category, thresholds, current value) plus `dev_kpi_measurements`, which is append-only. 1,559 KPIs, **none linked to a feature.** | none |
| Lenses | none on features. Council dimensions and scan "lenses" are fixed lists compiled into the code. | 6 lenses fixed in a TypeScript union, referenced in 28 files |
| Extension pattern | **The connector catalog**: one JSON manifest per unit, built-in and user-made units side by side (`is_builtin`), upgrades refresh built-ins only, names are unique, declared `fields[]` are rendered by one generic form | `LensExpression` channels keyed by the 6 fixed ids |
| History | KPI measurements and council runs are append-only. Feature status is overwritten. | `history[]` per feature, 27 weekly snapshots, an activity feed |

Constraints the standard must keep, so that every current reader still works:
1. The flat, snake_case `groups[]` and `contexts[]` exactly as in v2. The Personas declaration
   reader, ai-registry `build-registry-map.mjs`, devlog and the dev-mode readers depend on them.
2. **The context name is the stable key.** Personas re-creates UUIDs on full rescans, and links are
   reconciled by name and slug. Cross-references therefore use slugs and context names, and `id` is
   passed through but never relied on.
3. Readers ignore unknown keys. That is the ecosystem rule; the Personas declaration reader and the
   ai-registry follow it.
4. A real format marker. `version: 2` is ambiguous: an older, incompatible Vibeman shape also said
   2.0.0.

## 3. Decisions

| # | Question | Decision | Rejected |
|---|---|---|---|
| 1 | Where the standard lives | **context-map v3**, one file per project | companion file (the two files drift apart); folder of files |
| 2 | Hierarchy | **Two trees, linked.** The product tree (domain, then capability, then feature) sits beside the code tree (group, then context). Features link many-to-many to contexts. | reuse the code tree; flat tags |
| 3 | What a lens plugin declares | **field schema, health rule, presentation hints** | the evaluator, and who decides the lens's questions (they live elsewhere) |
| 4 | Stage | **A core field from a fixed list, with history.** It is not a lens. | a stage list set per project; stage as a lens |
| 5 | Where lens plugins come from | **Catalog plus snapshot.** Built-in and custom manifests exist in a catalog, and the map holds a full copy of each manifest it uses. | listing ids only; defining every lens inline |
| 6 | KPIs and lenses | **Lens fields bind to KPIs.** A field can take its value from a KPI, and a KPI can carry an optional `lens` tag. | each KPI belongs to one lens; keep them separate |
| 7 | History | **An append-only events log beside the map** | history inside features; current state only |
| 8 | The agent swarm | **Not in v3.** It is runtime state and comes from a separate feed later. | decisions and orders in the map; everything in the map |
| 9 | Health rule format | **Declarative JSON rules** | expression strings; stored values only |
| 10 | Health value | **Computed, with an optional override** that records who, why and until when | always computed; always stored |
| 11 | Who writes the product tree | **Declared** (git-tracked); a scan may only propose | derived by the scan; edited by people only |
| 12 | Build scope | **Spec, schema and blueprint adoption** in this repo, plus a brief for the Personas work | spec only; everything, including Personas |

These conventions were decided directly, without a question, because the evidence already answered them:
- **References use slugs.** Features, KPIs, milestones, domains and capabilities are referred to by
  `slug`; contexts by `name`. A UUID `id` is optional and is passed through unchanged.
- **Absent values:** an unknown value is **omitted**, never written as `null` or `0` ("null is
  never zero", as in Personas KPIs). A feature with no facet for a lens reads as `unmeasured`. A
  facet with `"applicable": false` reads as `na`.
- **Lens ids:** the six built-ins use short ids (`business`, `design`, `development`, `operations`,
  `security`, `quality`). Custom lenses must use reverse-DNS ids (`com.kettle.cost`), so they can
  never take a built-in's name. This is the connector rule, applied to ids.
- **Switching a lens off is not deleting it.** `lenses[].enabled: false` hides the lens, and its
  facets are kept. Removing the entry orphans its facets, and any reader that rewrites the file
  must keep them.
- **`features[]` replaces `use_cases[]`.** A v3 reader accepts `use_cases[]` as a stand-in when
  `features[]` is missing. A v3 writer emits only `features[]`.
- **Lens rules may read core feature fields (added during the WP1 build).** Fields may bind to
  core fields with `source: { "feature": "stage" }` (whitelist: stage, priority, kind, tier,
  milestone, status). These values are read at evaluation and never stored in facets.
  `health.applies_when` decides when a lens is `na`. Precedence: `applicable: false`, then
  `applies_when`, then an in-date override, then rules, then the default. Evidence: with only
  facet values, security reproduced 87.9% of the sample's health; with these two pieces, all six
  lenses reproduce 100%.
- **JSON Schema (draft 2020-12) is the normative artifact.** It works for both Rust and
  TypeScript. TypeScript types are written to match it and checked against the Kettle example.

## 4. The contract (wire-level)

### 4.1 `context-map.json` v3

```jsonc
{
  "$schema": "app-structure/3",          // the format marker; readers branch on this, not on `version`
  "version": 3,
  "generator": "personas-context-scan",  // or "kettle-sample", "hand"
  "generated_at": "2026-10-08T09:00:00Z",
  "declared": true,                      // optional; only on git-tracked, hand-owned maps (never written by an export)
  "provenance": { "git_commit": "…", "git_commit_count": 10635 },
  "project": { "slug": "kettle", "name": "Kettle", "id": "…", "description": "…", "kind": "code" },
  "taxonomy": {
    "context_categories": ["ui","api","lib","data","test","config"],
    "group_domains": ["feature","infrastructure","shared","integration","data"],
    "feature_kinds": ["user_flow","capability","integration","ops"],
    "feature_tiers": ["major","standard"]
  },
  "stats": { "groups": 16, "contexts": 219, "features": 132, "kpis": 40, "lenses": 7 },

  // ---- code tree (v2, unchanged) ----
  "groups":   [ { "id": "…", "name": "Agent Platform", "color": "violet", "domain": "feature", "context_count": 25 } ],
  "contexts": [ { "id": "…", "name": "agent-health", "group": "…", "group_id": "…", "category": "ui",
                  "business_feature": "…", "description": "…", "file_paths": [], "entry_points": [],
                  "db_tables": [], "keywords": [], "api_surface": "…", "cross_refs": [], "tech_stack": [],
                  "pinned": false, "last_written_at": "…" } ],

  // ---- product tree (new) ----
  "domains":      [ { "slug": "payments", "name": "Memberships & Payments", "summary": "…", "order": 5,
                      "source": "declared" } ],              // "declared" | "proposed"
  "capabilities": [ { "slug": "payments.billing", "domain": "payments", "name": "Billing", "order": 2 } ],

  "features": [ {
    "slug": "failed-payment-dunning", "id": "…", "name": "Failed-payment dunning", "summary": "…",
    "kind": "capability", "tier": "major",
    "status": "active",                                      // Personas compatibility: active | archived
    "capability": "payments.billing",                        // product tree; omitted = unplaced
    "contexts": ["billing-engine", "dunning-worker"],         // code tree, by context name
    "primary_context": "dunning-worker",
    "stage": "flagged",                                      // idea|specified|in-dev|in-review|flagged|live|deprecated
    "stage_since": "2026-09-30",
    "priority": "P1",                                        // P0..P3, optional
    "milestone": "payments-ga",                              // milestone slug, optional
    "depends_on": ["recurring-billing-engine"],              // feature slugs
    "blocked_by": [],
    "owner": "mara", "built_by": ["forge-1"],                // actor ids (free strings in v3)
    "surfaces": ["api","workers"],
    "created": "2026-08-02",
    "parts": [ { "name": "Retry schedule", "done": true } ],
    "notes": [ { "by": "jonas", "date": "2026-09-30", "text": "…" } ]
  } ],

  "milestones": [ { "slug": "payments-ga", "name": "Payments GA", "status": "active",   // planned|active|shipped
                    "target_date": "2026-10-22", "goal": "…" } ],

  "kpis": [ {
    "slug": "dunning-recovery-rate", "id": "…", "name": "Recovered failed payments",
    "scope": { "feature": "failed-payment-dunning" },        // exactly one of feature|context|group|project:true
    "category": "value",                                     // Personas: technical|traffic|value|quality
    "lens": "business",                                      // optional lens tag (decision 6)
    "unit": "%", "direction": "up",
    "baseline": 0, "target": 60, "target_date": "2026-11-30", "warn_at": 40, "crit_at": 25,
    "current": { "value": 47.5, "measured_at": "2026-10-08T06:00:00Z", "env": "production" },
    "status": "active", "tier": "primary", "measure_kind": "derived"
  } ],

  // ---- lenses (new): the plugins this project uses, each with a manifest copy ----
  "lenses": [
    { "id": "security", "version": "1.0.0", "source": "builtin", "enabled": true, "manifest": { /* §4.2 */ } },
    { "id": "com.kettle.cost", "version": "0.1.0", "source": "project", "enabled": true, "manifest": { } }
  ],

  // ---- facets (new): lens values per feature, keyed by feature slug, then lens id ----
  "facets": {
    "failed-payment-dunning": {
      "security": {
        "values": { "dataClass": "payment", "review": "pending", "openFindings": 0 },
        "measured_at": "2026-10-08T08:10:00Z", "source": "scan",
        "override": { "health": "watch", "by": "jonas", "why": "review booked Thursday", "until": "2026-10-16" }
      },
      "business": { "values": { "value": 5, "customerRequests30d": 14 } }
    }
  },

  "extensions": { "com.kettle.sample": { "note": "sample data" } }   // reverse-DNS keys; every writer must keep them
}
```

**Stage vocabulary (fixed, ordered):** `idea`, `specified`, `in-dev`, `in-review`, `flagged`, `live`,
`deprecated`. `flagged` means live behind a partial rollout.

### 4.2 Lens manifest (`$schema: "lens-manifest/1"`)

```jsonc
{
  "$schema": "lens-manifest/1",
  "id": "security",                         // built-in short id, or reverse-DNS for a custom lens
  "version": "1.0.0",
  "name": "Security", "short": "SEC",
  "description": "Data classes, reviews and findings.",
  "reader": { "role": "security", "density": "standard" },        // density: simple | standard | dense
  "fields": [
    { "key": "dataClass", "label": "Data class", "type": "enum",
      "values": ["public","internal","personal","payment"], "headline": true },
    { "key": "review", "label": "Review", "type": "enum", "values": ["none","pending","passed","failed"] },
    { "key": "openFindings", "label": "Open findings", "type": "integer", "min": 0 },
    { "key": "recovery", "label": "Recovered", "type": "percent", "source": { "kpi": "dunning-recovery-rate" } }
  ],
  "health": {
    "rules": [
      { "when": { "all": [ { "field": "dataClass", "in": ["personal","payment"] },
                           { "field": "review", "ne": "passed" } ] },
        "health": "bad", "reason": "Sensitive data without a passed review" },
      { "when": { "field": "openFindings", "gt": 0 }, "health": "watch", "reason": "{openFindings} open findings" }
    ],
    "default": "good",
    "rollup": { "method": "worst-of" }      // worst-of | share { watch: 0.2, bad: 0.34 } | weighted { by: "<field>" }
  },
  "presentation": {
    "glyph": "padlock",                     // a name from the shared glyph set, or { "path": "<SVG path, 16x16 box>" }
    "line": "hatched",                      // solid|double|dotted|comb|chain|hatched|dimension
    "accent": { "dark": "#b9a7ff", "light": "#5b3fd1" },   // optional; the subtle view uses ink only
    "evidence": ["dataClass", "review"],    // which fields a tile shows, in order, limited by density
    "measures": "dataClass"                 // the field the lens line measures (number, or an ordered enum)
  }
}
```

**The condition grammar** is all of it, so Rust and TypeScript evaluate it identically:
- A leaf is `{ "field": k, <op>: v }`, where `<op>` is one of `eq`, `ne`, `lt`, `lte`, `gt`, `gte`,
  `in`, `nin`, `missing`, `present`.
- Leaves combine with `{ "all": [...] }`, `{ "any": [...] }` and `{ "not": cond }`.
- Rules are evaluated top to bottom, and the first match wins.
- `reason` may name fields in braces.
- A rule that names an unknown field never matches.

**Field types:** `number`, `integer`, `percent`, `money` (with `currency`), `boolean`, `string`, `enum`
(an ordered `values` list), `date`.

**Health values:**
- Computed: `good`, `watch`, `bad`.
- Also possible: `unmeasured` (no facet) and `na` (`"applicable": false`).
- An override applies only until its `until` date.

### 4.3 Events log: `context-map.events.jsonl`

One JSON object per line, append-only. It is never rewritten.

```jsonc
{ "at": "2026-09-30T14:02:00Z", "type": "stage", "feature": "failed-payment-dunning",
  "from": "in-review", "to": "flagged", "actor": "forge-1", "source": "scan" }
```

| `type` | Required fields |
|---|---|
| `stage` | `feature`, `from`, `to` |
| `lens-health` | `feature`, `lens`, `from`, `to` |
| `kpi-threshold` | `kpi`, `from`, `to` (a track verdict) |
| `milestone` | `milestone`, `from`, `to` |
| `feature-added` | `feature` |
| `feature-archived` | `feature` |
| `lens-enabled` | `lens` |
| `lens-disabled` | `lens` |

Weekly snapshots and "what changed" are worked out from this log. Readers ignore types they don't know.

### 4.4 Compatibility rules

- A v3 file is still a valid v2 declaration for code-tree readers, because `groups[]` and
  `contexts[]` are unchanged and unknown keys are ignored.
- A v3 reader that receives v2 (no `$schema`, `version: 2`) maps `use_cases[]` to `features[]` with
  no stage (shown as stage unknown, never guessed). It also treats the six built-in lenses as
  available but unmeasured.
- Writers keep these intact: `extensions`, facets for lenses they don't know, and manifests with
  `source: "project"`. A Personas rescan may regenerate `groups[]`, `contexts[]` and `stats` only. It
  must merge features, KPIs, lenses and facets rather than overwrite them. This is the main Personas
  change (WP4).

## 5. Work packages

| WP | Builder session | Files | Done when |
|---|---|---|---|
| **1. Standard** (Director, first, committed before the others) | `docs/standard/app-structure-v3.md` (the spec), `docs/standard/schema/app-structure-3.schema.json`, `docs/standard/schema/lens-manifest-1.schema.json`, `docs/standard/lenses/*.json` (the six built-ins), `scripts/validate-structure.mjs` | The schemas validate the six manifests. The validator fails on an unknown stage, a bad lens id, or a condition with two operators. The spec owns the doc surface. |
| **2. Kettle as v3** | `scripts/kettle-to-v3.mjs`, `src/data/kettle.app-structure.json`, `src/data/kettle.events.jsonl` | All 132 features, 13 domains, 29 capabilities, 4 milestones, and **KPIs derived from the sample**. The six built-in lenses plus one custom lens, `com.kettle.cost` (monthly cost, SMS spend), to prove a lens is a plugin. The events log rebuilds the 27 weekly snapshots exactly. The file validates. |
| **3. Blueprint adoption** | `src/lib/standard/` (types, loader for v3 and v2, rule evaluator, rollup), `src/lib/model/*`, `src/engine/lens/*`, `src/components/*` that read lens lists, and `src/variants/subtle/` | The `LensId` union and the `LENSES` constant are gone. Tabs, legend, sheet, queue emphasis and the General strip come from `lenses[]` where `enabled` is true. The subtle variant draws any lens from its manifest's `glyph`, `line` and `measures`. Health comes only from the rules. `?lenses=-security` and an enabled custom lens both work. Type checks, the build and frame time are unchanged. |
| **4. Personas adoption brief** (document only) | `docs/standard/personas-adoption.md` | Covers the changes in the Personas repo: v3 export and merge, a v3 declaration reader, a `stage` column on `dev_use_cases` plus events, a lens catalog modelled on connectors (`scripts/lenses/builtin/*.json`, a `lens_definitions` table with `is_builtin`), facet rows shaped like council verdicts, a `lens` tag on `dev_kpis`, and a v3-aware ai-registry `build-registry-map`. It is ready to hand to a spark in that repo. |

- **Order:** WP1 first, then WP2 and WP3 in parallel (WP3 codes against the WP1 types and a stub
  file until WP2 lands). WP4 can run any time after WP1.
- **Landing:** this repo has **no commits yet**. Building means first committing the current app
  (scaffold, engine, variants, docs) as the base, then building in a worktree.
- **Shaped and bold variants:** they know only the six built-in ids. For any other lens they fall
  back to the manifest-driven subtle channel. They stay reachable at `/variants`.

## 6. Non-goals (v3)

- The agent swarm: agents, decisions, standing orders, the replay. It moves to a separate runtime feed.
- A UI for installing, authoring or removing lenses. In v3 lenses are added in the file or catalog,
  and the blueprint only displays them.
- Routing lens questions to deciders. (Lens evaluators, skills that fill values, were a v3 non-goal;
  since 3.1 they are a goal, served by the ai-registry `/lens-scan` skill: it measures the metric
  fields of the development, security and design lenses per feature, keeps their history in the
  lens-scan store and writes the latest values into facets. See app-structure-v3.md sections 8.7
  and 15.)
- Changes to the Personas repo itself (WP4 is a brief).
- Expression languages, or plugin code that runs inside the blueprint.

## 7. Risks

- **Personas' full-file rewrite** drops v3 sections until WP4 ships. Mitigation: a hand-owned map
  uses `declared: true`, which the exporter already refuses to overwrite.
- **Slug and name stability:** renaming a feature slug breaks KPIs, facets and events that point at
  it. Mitigation: the events log records a `feature-renamed` event; a later minor version adds it.
- **Glyph vocabulary:** custom SVG paths in manifests are untrusted input. The blueprint parses them
  only with `Path2D`, never as HTML, and caps their length.
- **Rollup on large projects:** rules are evaluated once per feature and lens when the data
  changes, and cached. They never run in the frame loop.
- **Absolute `project.root`:** a machine-specific path. v3 writers should omit it from git-tracked maps.
