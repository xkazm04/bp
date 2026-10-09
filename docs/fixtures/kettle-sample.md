> Field reference for the original Kettle sample (`src/data/kettle.json`, `src/data/swarm.json`), as staged
> for the design contests. Regenerate both with `scripts/fixtures/gen-kettle.mjs` and `gen-swarm.mjs`.
> The app itself reads the app-structure v3 map built from it (`npm run data:kettle-v3`); that format is
> specified in `docs/standard/app-structure-v3.md`.

# Kettle blueprint data - schema

`kettle.js` sets `window.KETTLE` (load it with a `<script src>`; it works from `file://`).
`kettle.json` holds the same object. It is mock data for one fullstack product, **Kettle**
(booking, memberships and payments for independent fitness studios), dated **2026-10-08 09:00 UTC**.
The data is internally consistent: stages, history, snapshots, health and flags agree with each other.
Read `USERS.md` first: it says who uses this and why.

The owner has no schema requirement. You may derive, aggregate or ignore fields. Do not invent
features or numbers that contradict the data; you may compute new views from it.

## Top level

| key | what |
|---|---|
| `product` | `name`, `tagline`, `asOf`, `stack` (surface id -> description), `business` (studios 412, members, MRR, growth, churn), `team` |
| `lenses` | `["business","design","development","operations","security","quality"]` - the six fields; each feature has an object under each key |
| `stages` | lifecycle, in order: `idea`, `specified`, `in-dev`, `in-review`, `flagged`, `live`, `deprecated` |
| `people` | 8 humans and 6 agents: `id`, `name`, `kind` (`human`/`agent`), `field`, `title` |
| `milestones` | `M1` Public beta (done), `M2` Payments GA (2026-10-22, active), `M3` Multi-location, `M4` Kettle Assistant: `id, name, date, state, goal` |
| `domains` | 13: `id` (e.g. `PAY`), `name`, `summary`, `capabilities` (ids) |
| `capabilities` | 29: `id` (e.g. `PAY.2`), `domain`, `name`, `features` (ids) - the middle level |
| `features` | 132, below |
| `activity` | 249 events from the last 14 days, newest first, below |
| `snapshots` | 27 weekly counts per stage (2026-04-09 .. 2026-10-08): `week`, `counts` {stage: n}, `total` |

Hierarchy: **domain -> capability -> feature**, plus optional `parts` inside a feature (a checklist
on the two largest epics).

## Feature

| field | type / values | meaning |
|---|---|---|
| `id` | `PAY-09` | stable id |
| `name`, `summary` | text | plain-language name and one sentence |
| `domain`, `capability` | ids | position in the tree |
| `stage` | stage enum | lifecycle. `flagged` = in production behind a feature flag at partial rollout |
| `priority` | `P0`..`P3` | P0 = must have |
| `kind` | `customer` / `internal` / `business` / `platform` | customer-facing, staff tooling, commercial/growth, or ops & engineering platform |
| `milestone` | `M1`..`M4` or null | release it belongs to |
| `surfaces` | ids of `product.stack` | where it lives in the code (web-admin, web-member, mobile, api, workers, db, integrations, infra) |
| `dependsOn`, `usedBy` | feature ids | dependency graph (200 edges); `usedBy` is the reverse |
| `blockedBy` | feature ids | dependencies not yet shipped while this feature is in progress |
| `history` | `[{stage, date}]` | every stage transition, oldest first |
| `stageSince`, `created` | dates | |
| `owner` | person id | accountable human |
| `builtBy` | person ids | who wrote it, mostly agents (`forge-1`..`forge-4`) |
| `parts` | `[{name, done}]` or null | sub-items, only on the big epics |
| `notes` | `[{by, date, text}]` | human and agent remarks; these carry the stories |
| `health` | `good` / `watch` / `bad` | worst of the six lens healths |
| `flags` | strings | computed tensions: `ai-unreviewed-in-production`, `unmonitored`, `incident`, `security-gap`, `spec-drift`, `stalled`, `priority-not-started`, `demand-waiting`, `blocked` |

Each lens object has a `health` of `good`, `watch`, `bad` or `na` (not applicable yet, e.g.
operations for a feature not in production).

- **`business`**: `value` 1-5, `confidence` (`hypothesis`/`validated`/`measured`),
  `customerRequests30d`, `adoptionPct` (share of 412 studios using it, live only, may be null),
  `usageNote` (optional text), `revenueLink` (`direct`/`retention`/`indirect`/`none`), `mrrImpactUsd`.
- **`design`**: `status` (`none`/`sketch`/`wireframe`/`hi-fi`/`implemented`/`polished`/`n/a`),
  `a11y` (`pass`/`partial`/`fail`/`unknown`/`n/a`), `specDrift` (built differently from the spec).
- **`development`**: `status` (`not-started`/`in-progress`/`in-review`/`merged`/`done`),
  `progressPct`, `aiAuthoredPct`, `humanReviewed` (true/false/null), `openPRs`, `unitCoveragePct`,
  `techDebt` 0-3, `linesOfCode`, `lastCommit`, `stalled` (optional).
- **`operations`**: `environment` (`none`/`preview`/`staging`/`production`), `flag`
  {`key`, `rolloutPct`}, `sloTarget`, `sloActual`, `p95ms`, `errorRatePct`, `incidents30d`,
  `alerting`, `runbook`, `costUsdMonth`.
- **`security`**: `dataClass` (`public`/`internal`/`personal`/`payment`), `review`
  (`not-required`/`not-started`/`pending`/`passed`/`findings`), `openFindings`.
- **`quality`**: `status` (`n/a`/`untested`/`testing`/`partial`/`passed`/`failing`),
  `e2eTests`, `e2ePassing`, `openBugs` {`p1`,`p2`,`p3`}.

## Activity event

`{at, type, feature, actor, text, ...}` with `type` one of `commit`, `pr-opened`, `review`,
`deploy`, `flag`, `incident` (+`severity`), `comment`, `stage` (+`from`, `to`).

## Shape of the state today

57 live, 12 flagged, 7 in review, 27 in development, 16 specified, 12 ideas, 1 deprecated.
Overall health: 54 good, 64 watch, 14 bad. The stories worth finding are in `notes` and `flags`:
payments dunning live at 25% with no human review and no security review; the waitlist race
incident; tax handling on the critical path of Payments GA and a week late; the most-requested
feature (legacy migration) still in development; a P0 nobody has started (recurring auto-booking);
the public API live without rate limiting; a kiosk built from a wireframe that fails accessibility;
SMS costs tripling; a deprecated page builder 58 studios still use.

## The swarm - `swarm.js` / `swarm.json`

`swarm.js` sets `window.SWARM`; load it after `kettle.js`. It is **simulated** sample data layered on
`kettle.json` (every `feature` below is a feature id there), dated the same moment, 2026-10-08 09:00 UTC.
Present it as a simulation, never as a live feed of a real system.

| key | what |
|---|---|
| `squads` | 8 crews: `id` (`forge-1`..`forge-4`, `warden`, `tender` lead by the six agents in `people`; plus `scout`, `sentinel`), `name`, `role` (`build`, `review`, `operate`, `research`, `security`), `focus`, `size` |
| `agents` | 42 agents at 09:00: `id` (`forge-1.3`), `squad`, `role`, `status` (`working` 19, `waiting` 18, `blocked` 4, `failed` 1), `feature` (where it is), `task` (plain words), `progressPct`, `since`, `tokensPerMin`, `costUsdToday`, `doneToday`; `waitingOn` (decision id) when waiting, `blockedBy` (feature id) when blocked |
| `decisions` | 28: 25 open at 09:00 plus 3 that arrive during the replay (`arrivesAt`, seconds). `id`, `feature`, `domain`, `lens`, `decider` (person id), `askedBy` (agent id), `question`, `options` [{`label`, `consequence`}], `recommended` (option index, the agent's pick), `urgency` (`high`/`medium`/`low`), `waitingSince`, `blocksAgents`, `affects` (feature ids) |
| `orders` | 8 standing orders humans gave the swarm: `id`, `by` (person), `lens`, `scope` (`{domain}`, `{milestone}`, `{surface}` or `{all:true}`), `text`, `since`, `violations` |
| `replay` | about 420 events over the next hour, oldest first, for a page that wants to play the swarm forward (at any speed): `t` (seconds after 09:00), `at`, `agent`, `feature`, `type` (`commit`, `tests-pass`, `tests-fail`, `pr-open`, `task-done`, `review-pass`, `review-changes`, `deploy`, `flag-change`, `alert`, `spec-draft`, `note`, `finding`, `scan-clean`, `move` (with `from`), `decision-asked` (with `decision`)), `text` |
| `totals` | counts for a header |

The decisions sit on the stories already planted in `kettle.json`: dunning at 25% with no human
or security review (D-01, D-02), tax handling late (D-03), the waitlist incident (D-04), the
unstarted P0 recurring auto-booking (D-05), the public API without rate limiting (D-06), the kiosk
accessibility failure (D-07), the SMS cost (D-08), the deprecated page builder (D-09).

A decision made in the prototype may change the page's own state (an agent resumes, a flag moves,
a decision leaves the queue). Nothing is sent anywhere, and nothing needs to persist across reloads.
