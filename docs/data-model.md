# Blueprint data model (v0.1, prototype)

Status: draft for round 1. The schema exists to feed the canvas prototypes and will change as the
visual shape settles. Every prototype reads the same two shared files:

| File | Role |
| --- | --- |
| `prototypes/shared/blueprint-data.js` | Mock dataset. Plain data, assigns `window.BLUEPRINT`. |
| `prototypes/shared/blueprint-model.js` | Derivations every variant shares (indexes, scores, rollups, filters). Assigns `window.BP`. |

Prototypes must never hard-code numbers derived from the data; they call `BP` so every variant shows
the same truth.

## Hierarchy

```
Product ── Domain (6) ── Module (20) ── Feature (110–130)
                                          └─ Dimension (3: dev, ops, biz)
                                               └─ Facet (4 per dimension, 12 per feature)
```

The mock product is **Larkspur**, a fullstack commerce platform for independent brands
(Next.js storefront + admin, Node API, background workers, Postgres/Redis, AWS). Much of it is
built by AI agent crews and reviewed by humans, which is exactly the situation the blueprint is
meant to make legible.

## Dimensions and facets

Each feature is assessed along three dimensions. Each dimension has four facets, each in one of the
facet states.

| Dimension | id | Question it answers | Facets (id: label) |
| --- | --- | --- | --- |
| Development | `dev` | Is it built and tested? | `spec`: Spec · `backend`: Backend · `frontend`: Frontend · `tests`: Tests |
| Operations | `ops` | Is it running safely in production? | `deploy`: Deployed · `observe`: Observability · `secure`: Security review · `runbook`: Runbook |
| Business | `biz` | Is it delivering value? | `value`: Value case · `docs`: Docs & help · `package`: Packaging · `adoption`: Adoption |

Facet states: `done` (1.0) · `partial` (0.5) · `todo` (0) · `blocked` (0, and flags attention) ·
`na` (not applicable, excluded from scores; e.g. `frontend` for a pure API feature).

## Feature lifecycle status

| id | Label | Meaning | Facet coherence rule |
| --- | --- | --- | --- |
| `live` | Live | In production and in use | dev all done/na; `ops.deploy` done; `biz.adoption` done or partial |
| `ready` | Ready | Built and verified, waiting for release | dev all done/na except `tests` may be partial; `ops.deploy` partial (staging) |
| `building` | In build | Actively being implemented | `dev.spec` done; at least one dev facet partial or todo; `ops.deploy` todo or partial |
| `planned` | Planned | Scoped, not started | `dev.spec` todo or partial; other dev facets todo; ops facets todo; `biz.adoption` todo |
| `blocked` | Blocked | Cannot progress | at least one facet `blocked`; `blockedReason` set |

## Shapes

```js
window.BLUEPRINT = {
  meta: { schemaVersion: '0.1', asOf: '2026-10-08' },
  product: {
    id, name, tagline, version, nextVersion,
    stack: { web, api, workers, data, infra },        // display strings
  },
  releases: [ { id: '1.4', label: 'v1.4', date: '2026-09-15', state: 'shipped' | 'next' | 'future' } ],
  teams: [ { id, name, kind: 'human' | 'agent' } ],    // owners; agent crews build, humans review
  dimensions: [ { id, label, short, question, facets: [ { id, label } ] } ],
  statuses: [ { id, label, description } ],
  facetStates: [ { id, label, value } ],
  domains: [ { id, code, name, summary } ],
  modules: [ { id, domainId, code, name, summary, owner, surfaces: ['web' | 'admin' | 'api' | 'worker' | 'data'] } ],
  features: [ {
    id: 'checkout.express-pay',        // '<moduleId>.<slug>'
    moduleId, name, summary,           // summary: one plain sentence
    status,                            // lifecycle id above
    priority: 'P0' | 'P1' | 'P2' | 'P3',
    release,                           // release id it shipped in or targets; null when unscheduled
    owner,                             // team id
    builtBy: 'agent' | 'human' | 'pair',
    review: 'approved' | 'pending' | 'changes' | 'none',   // human review of the latest change
    updatedAt: 'YYYY-MM-DD',
    dependsOn: [featureId],            // acyclic
    dims: {
      dev: { spec, backend, frontend, tests },
      ops: { deploy, observe, secure, runbook },
      biz: { value, docs, package, adoption },
    },
    metrics: { coverage, uptime, adoption },   // numbers or null: test coverage %, 30-day uptime %, % of merchants using
    blockedReason,                     // string, only when blocked
    note,                              // optional short string: review remark, risk, context
  } ],
};
```

## `window.BP` model API

| Member | Returns |
| --- | --- |
| `BP.data` | the raw `BLUEPRINT` object |
| `BP.product`, `BP.domains`, `BP.modules`, `BP.features`, `BP.releases`, `BP.teams` | arrays in display order |
| `BP.DIMENSIONS`, `BP.STATUSES`, `BP.FACET_STATES` | definitions from the data |
| `BP.domain(id)`, `BP.module(id)`, `BP.feature(id)`, `BP.team(id)`, `BP.release(id)` | lookups |
| `BP.modulesOf(domainId)`, `BP.featuresOf(moduleId)`, `BP.featuresOfDomain(domainId)` | children |
| `BP.facetValue(state)` | 1, 0.5, 0 or `null` for `na` |
| `BP.dimScore(feature, dimId)` | 0..1, mean of non-`na` facets |
| `BP.featureScore(feature)` | 0..1, mean of the three dimension scores |
| `BP.rollup(features)` | `{ count, byStatus, dims: {dev, ops, biz}, overall, attention, byReview, byBuilder }` |
| `BP.moduleRollup(id)`, `BP.domainRollup(id)`, `BP.productRollup()` | `rollup` of the subtree (memoized) |
| `BP.dependencies(id)`, `BP.dependents(id)` | feature arrays |
| `BP.needsAttention(feature)` | true when blocked, any facet blocked, or review is `changes` |
| `BP.search(query)` | features whose name, summary, id, module or domain name match (case-insensitive) |
| `BP.matches(feature, filter)` | filter: `{ statuses?: Set, query?: string, review?: Set, builtBy?: Set, attentionOnly?: bool }` |
| `BP.lensValue(feature, lens)` | `lens` is `'overall' | 'dev' | 'ops' | 'biz'`; returns the 0..1 score to encode |
| `BP.facetCounts(features, dimId?)` | counts of facet states, overall or per dimension |
| `BP.STATUS_ORDER` | `['live', 'ready', 'building', 'planned', 'blocked']` |
