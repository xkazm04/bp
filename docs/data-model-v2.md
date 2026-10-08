# Blueprint data model v0.2 (round 2)

v0.2 replaces the round 1 facet checklists with **role ratings built on metrics**. It also scales the mock
product to about 500 features and adds **work intake, human gates, branches, an audited ledger, release packages
and initiatives**. The v0.1 files stay in place for the round 1 prototypes.

| File | Role |
| --- | --- |
| `scripts/data-v2/catalog.mjs` | Hand-authored names and summaries: areas, domains, modules, features, people, teams, systems, initiatives, release names, and the content pools (findings, bugs keyed by surface and domain, asks, reviewer notes keyed by kind of work, evidence, blocked reasons) |
| `scripts/data-v2/generate.mjs` | Deterministic generator (seeded PRNG): writes `prototypes/shared/v2/blueprint-data.js` |
| `scripts/data-v2/validate.mjs` | Integrity, coherence, distribution and API checks (`npm run validate:v2`) |
| `prototypes/shared/v2/blueprint-data.js` | Generated `window.BLUEPRINT`. Never edit by hand |
| `prototypes/shared/v2/blueprint-model.js` | `window.BP`: ratings, rollups, gates, filters and timeline helpers. Pages never compute these themselves |

## Hierarchy

```
Product › Area (5) › Domain (17) › Module (54) › Feature (~500)
                                                 ├─ work items (intake: goal, ticket, scan)
                                                 ├─ branches (agent or human work, gated by approval)
                                                 └─ ledger (audited activity = evidence)
```

The mock product is still **Larkspur**, a commerce platform for independent brands, now grown to version 1.11.3.
Its next release is 1.12.0. Use exactly these ids, codes and names, in this order:

| Area (id · name) | Domains (id · code · name): modules (id · name) |
| --- | --- |
| `shopper` · Shopper Experience | `storefront` · STF · Storefront: `catalog` Product Catalog, `product-pages` Product Pages, `content` Content & Pages, `themes` Themes & Branding<br>`discovery` · DSC · Search & Discovery: `search` Search, `recommendations` Recommendations, `merchandising` Merchandising<br>`community` · CMY · Community: `reviews` Reviews & Ratings, `ugc` Q&A and UGC, `loyalty` Loyalty & Referrals<br>`mobile` · MOB · Mobile App: `app-shell` App Shell, `mobile-checkout` Mobile Checkout, `app-engagement` App Engagement |
| `commerce` · Commerce Core | `checkout` · CHK · Cart & Checkout: `cart` Cart, `checkout-flow` Checkout Flow, `express` Express Checkout<br>`payments` · PAY · Payments: `cards` Card Processing, `alt-payments` Alternative Payments, `risk` Fraud & Risk, `payouts` Payouts & Reconciliation<br>`pricing` · PRC · Pricing & Promotions: `prices` Price Management, `discounts` Discounts, `gift-cards` Gift Cards<br>`billing` · BIL · Subscriptions & Billing: `subscriptions` Subscriptions, `merchant-billing` Merchant Billing, `invoicing` Invoicing & Tax |
| `fulfillment` · Fulfillment & Service | `orders` · ORD · Order Management: `order-lifecycle` Order Lifecycle, `order-editing` Order Editing, `returns` Returns & Exchanges<br>`inventory` · INV · Inventory: `stock` Stock & Locations, `purchasing` Purchasing, `forecasting` Forecasting<br>`shipping` · SHP · Shipping & Delivery: `labels` Rates & Labels, `tracking` Tracking, `local-delivery` Local Delivery<br>`care` · CAR · Customer Care: `help` Help Center, `support` Support Inbox, `notifications` Notifications |
| `merchant` · Merchant Platform | `admin` · ADM · Admin & Operations: `console` Admin Console, `bulk` Bulk Tools, `staff` Staff & Roles<br>`analytics` · ANL · Analytics: `events` Event Pipeline, `reports` Reports, `insights` Insights<br>`integrations` · INT · Integrations: `public-api` Public API, `webhooks` Webhooks, `channels` Channels & Marketplaces, `app-store` App Store |
| `foundation` · Foundation | `identity` · IAM · Identity & Access: `auth` Authentication, `accounts` Accounts & Privacy, `sessions` Sessions & Devices<br>`platform` · PLT · Platform & Reliability: `infrastructure` Infrastructure, `observability` Observability, `data-platform` Data Platform |

There are 5 areas, 17 domains and 54 modules, with 5 to 14 features per module and 480 to 520 features in total.

## Lenses

Eight lenses in two groups. **Role** lenses are Overall, Development, Operations and Business. **Specialist**
lenses are Security, Compliance, UX and Cost.

| id | Label | Question | Raw metrics (`feature.metrics.<id>`) | Applies when |
| --- | --- | --- | --- | --- |
| `overall` | Overall | Is it healthy? | composite (see below) | live, ready, building, blocked; `na` for planned |
| `dev` | Development | Is the code healthy? | `{ quality: 'A'..'E', coverage: 0–100, bugs: { critical, major, minor } }` | status ≠ planned |
| `ops` | Operations | Is it running well in production? | `{ monitored: bool, uptime: %, errorRate: %, p95: ms, sloP95: ms }`; uptime, errorRate and p95 are null when not monitored | status = live |
| `biz` | Business | Is it delivering without open asks? | `{ adoption: %, satisfaction: 1–5 \| null }`; backlog comes from open work items | status = live |
| `sec` | Security | Is it safe? | `{ vulns: { critical, high, medium }, lastScan: date \| null, secretsClean: bool }` | status ≠ planned |
| `comp` | Compliance | Is it covered by compliance scans? | `{ regimes: ['GDPR' \| 'PCI DSS' \| 'SOC 2' \| 'EAA'], coverage: %, findings: n }` | `regimes` not empty |
| `ux` | UX | Is it usable and accessible? | `{ a11y: 0–100, usability: 1–5 \| null, debt: n }` | the feature has a UI surface (`web`, `admin`, `mobile`) and status ≠ planned |
| `cost` | Cost | Is it within budget? | `{ monthly: USD, budget: USD, trend: % change over 30 days }` | status = live |

When a lens does not apply, its `metrics` entry is `null` and the rating band is `na`.

### Rating rules (`BP.rating(feature, lens)`)

`pw(x, points)` is piecewise-linear interpolation through `[x, y]` points, clamped at both ends.
Bands: **good** ≥ 0.8 · **fair** ≥ 0.6 · **poor** ≥ 0.4 · **critical** < 0.4 · **na**.

- **dev**: `q = {A:1, B:.85, C:.65, D:.45, E:.25}[quality]`, `cov = pw(coverage, [[0,0],[40,.4],[60,.7],[85,1]])`,
  `bug = clamp(1 − .45·critical − .12·major − .02·minor)`. The score is `.4q + .35cov + .25bug`, capped at .38 when `critical > 0`.
  Headline example: "Quality B · 82% coverage · 1 major bug".
- **ops**: if not monitored, the score is .5 with the reason "Not monitored: uptime and errors unknown". Otherwise
  `up = pw(uptime, [[98,.1],[99,.4],[99.5,.6],[99.9,.85],[99.95,1]])`, `err = pw(errorRate, [[.1,1],[.5,.75],[1,.55],[2,.35],[5,.05]])`
  and `lat = p95 ≤ sloP95 ? 1 : clamp(1 − (p95/sloP95 − 1)·1.2)`. The score is `.4up + .35err + .25lat`.
  Headline example: "99.95% uptime · 0.2% errors · p95 180 ms (SLO 250 ms)".
- **biz**: open backlog `n` = the feature's work items in state triage, backlog, in-progress or review. The score is
  `n=0 → 1`, `1 → .85`, `2 → .75`, `3–4 → .6`, `5–7 → .45`, `8+ → .3`. No open backlog means all green. Adoption is
  shown but does not score. Headline: "No open backlog" or "3 open backlog items · 47% adoption".
- **sec**: if `lastScan` is null, the score is .45 ("Never scanned"). Otherwise `critical > 0 → .2`, else
  `high > 0 → max(.4, .55 − .05·(high−1))`, else `medium > 0 → max(.65, .8 − .03·(medium−1))`, else 1. A scan
  older than 30 days caps the score at .7, older than 90 days at .5, and `secretsClean = false` caps it at .3.
  Headline: "0 critical · 1 high · scanned 3 days ago".
- **comp**: if `coverage = 0`, the score is .2 ("Not scanned"). Otherwise it is `coverage/100 · (1 − min(.6, .15·findings))`.
  Headline: "GDPR · PCI DSS · 86% scanned · 1 finding".
- **ux**: `a = a11y/100`, `u = usability ? (usability−1)/4 : .7` and `d = 1 − min(1, debt/6)`. The score is
  `.5a + .3u + .2d`, capped at .55 when `a11y < 60`. Headline: "WCAG 92 · usability 4.2/5 · 2 UX debt items".
- **cost**: `r = monthly/budget`. The score is `r ≤ .8 → 1`, `≤ 1 → .82`, `≤ 1.15 → .62`, `≤ 1.4 → .45`, else .25,
  capped at .6 when `trend > 25`. Headline: "$1,240/mo · 82% of budget · +6% in 30 days".
- **overall** (exec health, headline leads with what is wrong: "Critical in Cost", "Good in 5 of 7 lenses · weakest
  Security (fair)", "Good in all 7 lenses"):
  - live: weighted mean of the applicable lenses (dev .2, ops .2, biz .15, sec .2, comp .1, ux .1, cost .05,
    renormalised), capped at .55 when any applicable lens is critical.
  - ready: the same over dev, sec, comp and ux.
  - building: `.5·dev + .5·delivery`, where delivery is 1, .6 when a gate has waited more than 7 days, or .45 when a branch
    has changes requested.
  - blocked: .2, with `blockedReason` as the headline.
  - planned: `na` ("Not started · planned for v2.0").

`rating` returns `{ lens, score, band, headline, facts: [{ label, value, band? }], reasons: [string] }`, memoised.
`facts` are the 2–4 numbers behind the headline, ready to display. `reasons` explain any cap or penalty in plain words.

Display convention: `score` stays 0–1, but every text the model writes (headlines, facts, reasons) uses the 0–100
points pages show, rounded down so a number never reads as a better band than the score has (0.7963 is "79", fair):
"Capped at 38: 1 critical bug open", Overall facts "Security 70". Latencies of a second or more read in seconds
("p95 5 s (SLO 10 s)"); the ledger keeps raw milliseconds.

## Shapes

```js
window.BLUEPRINT = {
  meta: { schemaVersion: '0.2', asOf: '2026-10-08' },
  product: { id, name, tagline, version: '1.11.3', nextVersion: '1.12.0', stack: { web, api, workers, data, infra } },
  areas:   [{ id, name, summary }],
  domains: [{ id, areaId, code, name, summary }],
  modules: [{ id, domainId, name, summary, owner /* human team */, surfaces: ['web'|'admin'|'mobile'|'api'|'worker'|'data'] }],
  teams:   [{ id, name, kind: 'human' | 'agent' }],          // 6 human squads, 5 agent crews
  people:  [{ id, name, role: 'engineering'|'operations'|'product'|'security'|'design'|'compliance'|'executive', team }],
  systems: [{ id, name, kind: 'pipeline'|'monitor'|'scanner'|'export'|'sync' }],  // automated ledger writers (below)
  releases: [{ id: '1.11', label: 'v1.11', date, state: 'shipped'|'next'|'future', name, summary,
               items: [{ feature, kind: 'new'|'improved'|'fixed', note }] }],
  initiatives: [{ id, name, kind: 'permanent'|'temporary', type: 'compliance-scan'|'a11y-monitoring'|'refactor'|'scan'|'upgrade'|'cost',
                  summary, owner /* person */, startedAt, endsAt /* null if permanent */,
                  coverage: [{ feature, state: 'covered'|'in-progress'|'pending'|'finding', note? }] }],
  features: [{
    id: '<moduleId>.<slug>', moduleId, name, summary,         // name ≤ 32 chars, summary ≤ 120 chars
    status: 'live'|'ready'|'building'|'planned'|'blocked',
    priority: 'P0'|'P1'|'P2'|'P3',
    release,                    // release id it first shipped in (live) or targets; null = unscheduled
    owner,                      // team id
    builtBy: 'agent'|'human'|'pair',
    surfaces,                   // subset of the module's surfaces; drives UX applicability
    progress,                   // 0–100 delivery progress (100 for live and ready)
    createdAt, updatedAt,       // 'YYYY-MM-DD'
    dependsOn: [featureId],     // acyclic
    metrics: { dev, ops, biz, sec, comp, ux, cost },   // null where a lens does not apply
    workItems: [{ id: 'wi-0001', title, source: 'goal'|'ticket'|'scan', sourceRef, kind: 'feature'|'bug'|'perf'|'security'|'compliance'|'ux'|'cost'|'refactor',
                  state: 'triage'|'backlog'|'in-progress'|'review'|'done'|'dismissed', priority, createdAt, triagedBy /* person|null */, initiative /* id|null */ }],
    branches: [{ id: 'feat/…' | 'fix/…' | 'perf/…' | 'sec/…' | 'refactor/…', workItem, crew /* agent team|null */, author /* person|null */,
                 activity: 'implement'|'fix'|'refactor'|'perf'|'security'|'test'|'docs',
                 state: 'running'|'awaiting-approval'|'changes-requested'|'approved'|'merged'|'abandoned',
                 openedAt, updatedAt, checks: { tests: 'pass'|'fail'|'running', coverageDelta },
                 evidence: { kind: 'demo'|'report', title, summary, ref } | null, reviewer /* person|null */, note /* reviewer note|null */ }],
    ledger: [{ id: 'ev-00001', at: 'YYYY-MM-DDTHH:MM:00Z', actor /* person, agent crew or system id */, actorKind: 'agent'|'human'|'system',
               action: 'goal'|'ticket'|'scan'|'triage'|'branch'|'commit'|'test'|'demo'|'report'|'approve'|'request-changes'|'merge'|'deploy'|'release'|'monitor'|'incident'|'cost'|'audit',
               lens /* lens id it is evidence for, or null */, result: 'pass'|'fail'|'warn'|'info', summary, ref, hash /* 7 hex */ }],
    blockedReason, note,        // optional strings
  }],
};
```

Releases: 12 shipped (`1.0` on 2025-06-10, then roughly every six weeks up to `1.11` on 2026-09-22), `1.12` next
(2026-11-03), and `2.0` (2027-01-26) and `2.1` (2027-04-13) in the future. Each shipped release lists 25–70 items:
features first shipped in it (`new`) plus later `improved` and `fixed` items for live features. The next release
lists the ready, building and blocked features that target it (`new`) and the live features whose branch is
approved or awaiting approval (`improved` or `fixed`, with a note that says what changes for merchants, such as
"Moved onto the payments core.").

Systems: `ci` CI pipeline (test), `deploy` Deploy pipeline (deploy), `slo` SLO monitor (monitor), `sast` Security
scanner (sec scan), `perfscan` Performance scanner (ops scan), `compscan` Compliance scanner (comp audit), `a11yscan`
Accessibility scanner (UX audit), `costs` Cloud cost export (cost) and `tickets` Ticket sync (ticket). Every
`system` ledger entry comes from the system for its action. Agent entries name an agent crew; human entries a person.

Initiatives: 2 permanent (legal compliance scan coverage; accessibility monitoring) and 4 temporary (Payments
core refactor, Performance scan October 2026, Runtime upgrade to Node 22, Cloud cost reduction sprint). The
performance scan creates `scan` work items in `triage` across Search, Storefront and Checkout.

### Coherence rules (enforced by the validator)

- **planned**: dev, ops, biz, sec, ux and cost metrics are null; no branches except at most one `running` spike; `progress` is 0–10.
- **building**: ops, biz and cost are null; at least one branch is running, awaiting approval or with changes requested; `progress` is 15–90.
- **ready**: ops, biz and cost are null; at least one approved or merged branch; `progress` is 100; the target release is `1.12`.
- **live**: ops, biz and cost are present; `release` is a shipped release; the ledger includes `deploy` and `release` entries.
- **blocked**: `blockedReason` is set; ops, biz and cost are null.
- comp is non-null exactly when the feature handles regulated data (payments, identity, billing, accounts, UI under EAA).
- ux is null when the feature has no `web`, `admin` or `mobile` surface.
- Every branch's `workItem` exists on the same feature. Work items in `done` have a merged branch, unless their source is a
  dismissed scan finding.
- A branch with state `awaiting-approval` has `evidence`. A branch with `changes-requested` has `reviewer` and `note`.
  A reviewer is never the branch's author. A `test` branch raises coverage, and its report quotes the same gain.
- Every open gate's evidence (the demo or report awaiting approval, and each change request, whose summary is the
  reviewer's note) is in the ledger.
- Each live feature has 4–10 ledger entries (planned: 1–3). Ledger entries back the metrics: `test` for dev coverage,
  `monitor` for ops, `scan` for sec, `audit` for comp and UX, `cost` for cost. Entries are sorted newest first, dated on or before `asOf`.
- Distributions:
  - Status: live 52–60%, ready 6–10%, building 15–20%, planned 12–18%, blocked 3–6%.
  - Builder: agent ~50%, pair ~30%, human ~20%.
  - Overall bands among live features: good 40–60%, fair 20–35%, poor 8–18%, critical 3–10%.
  - Unmonitored live features: 6–12%.
  - Gates: triage 25–60, awaiting approval 30–70, changes requested 8–20.
  - Total ledger entries: 2,500–4,000.
  - Needs attention: 8–17% of features, so the red mark stays a signal. A lens is critical only when the feature
    is meant to be in trouble there: metric noise never drags a healthy lens into critical.
  - Open compliance findings on 12–35% of the features in compliance scope.
- Realism: Foundation and Commerce Core are the most mature. Mobile App and Community are roadmap-heavy. Payments and
  Checkout carry the refactor initiative. Compliance applies to Payments (PCI DSS), Identity and accounts (GDPR),
  Billing (SOC 2) and shopper-facing UI (EAA).

## `window.BP` (v0.2)

| Member | Returns |
| --- | --- |
| `data`, `product`, `areas`, `domains`, `modules`, `features`, `releases`, `teams`, `people`, `systems`, `initiatives` | raw arrays in display order |
| `version`, `asOf` | `'0.2'` and the dataset's as-of date (`'2026-10-08'`) |
| `LENSES` | `[{ id, label, short, group: 'role'\|'specialist', question }]` in display order |
| `STATUSES`, `STATUS_ORDER`, `BANDS`, `BAND_IDS`, `BUILDERS`, `GATE_KINDS` | definitions; `BANDS = [{ id, label, min }]` for good, fair, poor, critical, plus na |
| `area(id)`, `domain(id)`, `module(id)`, `feature(id)`, `team(id)`, `person(id)`, `system(id)`, `release(id)`, `initiative(id)` | lookups |
| `actor(id)` | the person, team (squad or agent crew) or system a ledger entry names, or null |
| `domainsOf(areaId)`, `modulesOf(domainId)`, `featuresOf(moduleId)`, `featuresOfDomain(id)`, `featuresOfArea(id)` | children in display order |
| `pathOf(featureId)` | `{ area, domain, module }` |
| `rating(feature, lens)` | see the rating rules |
| `moduleRating(id, lens)`, `domainRating(id, lens)`, `areaRating(id, lens)`, `productRating(lens)`, `rollupRating(features, lens)` | `{ score, band, counts: { good, fair, poor, critical, na }, applicable, worst: [featureId ×3] }` (memoised) |
| `rollup(features)`, `moduleRollup`, `domainRollup`, `areaRollup`, `productRollup` | `{ count, byStatus, byBuilder, attention, gates: { triage, approval, changes } }` |
| `needsAttention(feature)` | blocked, any lens in the critical band, or a branch with changes requested |
| `gates(feature)` | `[{ kind: 'triage'\|'approval'\|'changes', id, title, since, waitingDays, ref, feature, workItem, branch }]`, longest wait first (`feature`, `workItem` and `branch` are ids; `branch` is null for triage) |
| `openBacklog(feature)` | open work items |
| `dependencies(f)`, `dependents(f)` | feature arrays |
| `initiativesOf(f)` | `[{ initiative, state, note }]`, where `initiative` is the initiative object |
| `initiativeState(f, initiativeId)` | coverage state or null |
| `ledgerOf(f, { lens?, action? })` | ledger entries, newest first; `lens` and `action` take a value, an array or a Set (`'overall'` means every entry) |
| `releasesInOrder()`, `releaseItems(id)`, `featureReleases(f)` | timeline helpers: releases oldest first; a release's items `[{ feature (id), kind, note }]`; and the releases a feature appears in, `[{ release, kind, note }]` with the release object, oldest first |
| `search(query)`, `matches(f, filter)` | features matching every word (name matches first); filter: `{ statuses, query, initiative, gates: 'any'\|'triage'\|'approval'\|'changes', attentionOnly, lens, bands }`, where statuses and bands take an array or a Set |
| `band(score)` | band id |
| `daysSince(date)` | whole days from a date to `asOf`, never negative |

Functions accept a feature object or an id. Everything derived is memoised (`rollupRating` and `rollup` on an
ad-hoc list are memoised by that array's identity, so keep the array if you call them often), and nothing mutates
the data. Returned arrays are copies; returned objects are shared, so treat them as read-only.
