# Territory dossier - Release Ledger (findings ledger, waves, release train)

Commit: 63b2922 - written 2026-11-03

Paths: `L/` = `apps/web/src/components/ledger/`, `S/` = `packages/core/src/server/`, `C/` = `packages/core/src/`.

## Why this area

bp draws a product as a plan, and then a swarm of AI agents builds it (README.md:1-7). The Release Ledger is where
that build happens on a real repo. A lens scan's findings become decisions here, approved findings become agent
jobs, built items are judged with evidence, and a release ships them. It is the product's "do" half; the canvas
is the "see" half. Hunt evidence, from `tiger.mjs hunt` at 63b2922 over 180 days: the context-map group "Release
Ledger" has heat 42, 225 commits, 60 files and 422 kB, and holds 4 contexts (ledger-core, train-compare,
train-decision, train-release). The bp product tree lists `ledger-triage-and-waves` among its major-tier features
(`.ai/lens-scan/app-structure.json`). Personas' Release card deep-links into it (README.md:39). The owner picked
this area over Scan Core and the VR light table.

## Who uses it, for what

- **The owner / product lead (one person, `human:kazdan`)** runs `/lens-scan` on their own repos (bp itself, pof).
  They hire the ledger to answer: which findings are worth building, in what batches, at what model and effort?
  Did the built item actually move its metric? What ships, as which version? Done well, a morning's findings
  become a shipped, measured release in a few keystrokes, and every yes or no can be traced back.
- **Agents** are both producers and deciders. `agent:director` triaged 27 of the 67 rows in bp's own store (below).
  `machine:lens-scan` accepts rows on its own, and the person can veto (L/variants/bits.tsx:78).
- **Personas** (the owner's desktop app) is the read-only reader of the same `scan.db`, and its fleet can run
  bp's jobs (`BP_RUNNER=personas`, S/jobs.server.ts:13-16,72).

## What it does today

**Source of truth.** lens-scan's SQLite store `<repo>/.ai/lens-scan/scan.db`. bp reads it read-only with
`node:sqlite` (S/store.server.ts:1-12). Every write shells out to lens-scan's `store.mjs` (outside this repo):
triage runs `store.mjs triage --by user:<gh login>` (S/release.server.ts:186,201). The stream route sends a
snapshot, then a delta every 1000 ms (S/api/products/[slug]/stream/route.ts:1-10). On the Kettle sample, findings
are fixtures plus a simulator (L/useLedger.ts:3-6, C/model/train-sim.ts:1-8).

**1. Backlog: findings to work.** `useLedger` maps proposals to rows. A row carries the stored `score`, which bp
never recomputes, and the dispatchable flag `can` (L/useLedger.ts:55-77). From scan-finding/1 (f376552), rows also
show a lens MVP strip, a reserve band, predicted verdicts, the Veto of machine decisions, and a Trust panel. Keys:
D dispatches the selection, A the focused row (L/variants/Triage.tsx:2-6, L/train/keymap.ts:61-62). There is no
keep / reject / snooze in the ledger: decline and veto live on `/proposals/[id]` and in the Review flyout
(L/LedgerPage.tsx:40).

**2. Waves: batches for agents.** A wave is a set of named packages. Each package has a model (sonnet|opus), an
effort (low..xhigh) and finding ids (C/scan/waves.ts:1-35). The composer leaves out findings another draft already
holds and warns on a shared feature (L/waves/WaveComposer.tsx:2-10). Arrange re-partitions in one press: by
feature (no two packages build one feature) or by lens (L/waves/arrange.ts:1-8). Dispatch approves the findings,
then queues one execute job per package, at most 50 findings each (S/waves.server.ts:113-145). The job is
`claude -p ... --model <m> --effort <e>` running `/lens-scan execute --proposals ...` (S/jobs.server.ts:46,475,618).
At most 3 jobs run at once, and 50 are kept per product (S/jobs.server.ts:3). The owner's standing orders
(`gateBuild`) hold findings back at compose time and at dispatch time
(S/api/products/[slug]/waves/route.ts:12-28, S/waves.server.ts:131-134). One build-admission rule is shared by every
build path (C/scan/admit.ts). Waves persist to `.ai/lens-scan/work/bp-waves.json` (S/waves.server.ts:1-5,45-55).

**3. Packs: judging what was built.** lens-scan builds one lens's items onto a pack branch `pack/<short>-<n>`,
which is never merged to main (docs/blueprint-ui.md:595). Pack status is open, triaged or closed
(C/scan/types.ts:26,226-240). A built item (status done or failed) waits for a person (C/train/rules.ts:12). The
decisions are accept, rework, descope and reopen (C/train/rules.ts:22-27). A note is required for rework, for
descope, and to accept a flagged item (C/train/rules.ts:30-37). Keys A, R, S, U; U undoes the decision you just
made (1c245d4). One pure decision planner feeds every button, count and key (b68ea16). Decisions are optimistic
through an intent store that settles only when the store shows the change, with a 60 s bound
(L/intents.ts:1-7, L/train/Decide.tsx:11-14,46-61).

The evidence panel, opened with Enter:
- **Verdict** (moved / flat / worse / unmeasured): the after reading against the median of the baseline runs, with
  a noise floor of at least one 16.7 ms frame for timings (C/scan/compare.ts:43-53,80-97). Computed once and reused
  by the row, the perf table, the notes and the pre-flight (C/train/perf.ts:1-4).
- **Screens**: before and after pairs, viewed side by side, as a slider, as a blink, as a change map, or zoomed to
  the changed area (L/train/keymap.ts:36-39). The pixel diff is a 32x18 grid computed in a worker
  (C/train/pixels.ts:7-12,45-82, L/train/compare/changeMap.worker.ts:11,30-37).
- **Commit diff**: `git show`, capped at 2000 lines (S/release.server.ts:224,242-266).
- **Measurement**: the latest before and after evidence lines, each with its commit
  (L/train/compare/Measurement.tsx:22-33).

**4. Release: shipping.** The version is the latest `v*` tag, bumped minor for baseline-upgrade or new-capability
items (C/scan/release.ts:14-48). The draft goes through `store.mjs release-create` and `release-add`
(S/api/products/[slug]/releases/route.ts:40-49). The pre-flight is a dry run that blocks on items with no commit
and warns on flagged ones (L/train/release/preflight.ts:5-13). Build and finish need `gh auth` (412 otherwise) and
queue `/lens-scan release --id rel-<v> [--finish]` as a claude job (S/api/products/[slug]/releases/[id]/release-job.ts:41-46,
S/jobs.server.ts:486). The lifecycle is draft, building, pr-open, merged, tagged, or failed
(C/scan/release-steps.ts:58-65). A job counts as done only when the store row reaches the target status
(S/jobs.server.ts:737-748). One notes writer lists, per item, the metric before and after, the commit, the pack,
any conflicts and the gates (C/train/notes.ts:59-78).

**5. Lens authoring.** LensChat calls `/api/lens-draft`, which runs `claude -p ... /lens-scan onboard --draft-only`
and resumes the session on later turns (S/api/lens-draft/route.ts:3,20,55, C/scan/lens-draft.ts:18-40). The chat
writes nothing. "Add lens" writes `app-structure.json` atomically, project entries only (S/lens-write.server.ts:1-7).
The chat survives a reload (485a4cd).

**Strengths worth evolving.**
- The ledger is keyboard-first with one keymap and layered Esc. A J/K step re-renders 2 rows, and a check holds it
  (L/variants/Triage.tsx:24).
- One verdict and one decision planner, reused everywhere.
- Writes are honest: 409 when nothing moved, 429 at the queue cap, 503 when the store is locked
  (S/api/products/[slug]/triage/route.ts:8-10).
- Every decision is signed, and machine decisions can be vetoed.
- The store's state wins over the UI's.
- Arrange by feature makes build clashes impossible by construction.

**Adjacent and reusable.** `briefFor` (C/scan/brief.ts) gives every open proposal a brief: blast radius,
precedent, the owner's quoted declines, undo, and cost per item from finished runs
(docs/concepts/decision-brief/README.md). The brief is shown on the plan card, Review, the phone and the Morning
Watch, but `train/` never references it. `scan/track.ts` counts a release item as confirmed only on a reading taken
after the release that meets its expected value. The Morning Watch already asks whether yesterday's releases moved
their numbers (docs/concepts/one-morning-brief/ROADMAP.md:59,93).

## Measured state

- **Checks.** All 23 area checks exit 0 at 63b2922 (`npm run -s check:<name>`, run 2026-11-03): waves,
  release-train, store-triage, release-states, train-quality, ledger-shell, train-wire, train-sim, triage-cap,
  train-compare, train-budget, train-pending, train-reasons, release-words, train-parity, train-plan,
  scan-demo-train, train-undo, ledger-intents, release-steps, release-notes, wave-arrange, release-preflight.
- **bp's own live store** (`.ai/lens-scan/scan.db`, read with node:sqlite on 2026-11-03):
  - 25 runs, 1651 measurements, 79 shots, 0 trust_events.
  - 19 packs: 17 triaged, 2 open.
  - 67 proposals, all `kind=fix`: 44 accepted, 20 descoped, 2 failed, 1 rework.
  - Triaged by `human:kazdan` 38, `agent:director` 27, none 2.
  - Created 2026-10-25, last updated 2026-10-31.
  - **0 releases.**
- **pof's live store** (`../pof/.ai/lens-scan/scan.db`, same date):
  - 5 runs, 1236 measurements, 0 shots, 0 packs, 0 releases.
  - 51 proposals, all still `proposed`; none was ever dispatched.
  - Its proposals table lacks the scan-finding/1 columns (score, band, mvp, predicted_*, veto_until, proof).
- **So the train's last mile has never run on a real product.** 44 accepted items sit on pack branches that are
  never merged (docs/blueprint-ui.md:595), and no release exists in either store. The release path has only run
  on the Kettle simulator and `scan-demo.mjs` (fake gh, fake PR URLs, C/model/train-sim.ts:20,429,501).
- **Not measured:** time from finding to release, accept rate per lens over time, whether accepted items' metrics
  held after merge (no merge has happened), real job cost per item, UI performance on a large store.

## Recent history

90 days, `git log -- L/ C/train C/scan/release.ts C/scan/waves.ts`: 99 commits. Most are scan-sweep polish: honest
empty, error and loading states, a11y, timeouts, and "say it in words" fixes (e.g. 4c30b45, 83d2b7e, c79314f,
cb4f63d). The feature moves:
- one decision planner (b68ea16) and undo-what-you-just-did (1c245d4);
- one settle-by-authority intent store (41b200e) and one build-admission rule (55e8d01);
- one release-notes writer (039d191) and the Release tab pre-flight (69e77e5);
- the wave composer's one-press arrange (3fd2dc1);
- the change-map crop and zoom (6923a84);
- opening on the Backlog scope (00980d6);
- scan-finding/1: stored score, MVP strip, reserve band, predicted verdicts, Veto, Trust panel and all-lens jobs
  (f376552);
- knowing which lenses a repo cannot measure, with a prepare job (fdaaa00);
- a lens chat that survives reloads (485a4cd).

Earlier tiger hunts (`tiger/hunts.md`) went to swarm steer (2026-10-18) and the blueprint canvas (2026-11-03,
landed today). Kept but not built from the canvas hunt, so do not re-propose them as-is:
- P07: a changed-files-to-impact view;
- P08/P12: authored acceptance sheets;
- P11: criteria-vs-measurement attribution;
- P03: "propose a fix for this step", which needs lens-scan to take a feature scope.

Owner decisions that bind (ROADMAP.md §6):
- D11/D17: spend is not capped, but gates and demos stay on fake `claude` and fake `gh`.
- D12/D15: approve from VR or the deck goes through the `decide` scope, with no job queued.
- §7: standing rules (e1) are parked until the owner's record can be trusted to decide alone.

## Known limits and open questions

- **The release has never been exercised for real.** Why have 44 accepted items not shipped? The data cannot say
  whether the owner never pressed Build, gh or auth blocked it, or the cherry-pick from 19 pack branches is too
  heavy. Nothing in the ledger surfaces "accepted, not shipped, for N days".
- **The loop does not close in the ledger.** After a release, nothing in `train/` shows whether shipped items held
  their after-value on main. That logic exists in `scan/track.ts` and the Morning Watch, not here.
- **Decisions are made without the brief.** The decision brief (precedent, quoted declines, cost) is not on the
  ledger's rows or the pack judging (grep of `train/`: no `briefFor`).
- **No keep / reject / snooze in the Backlog.** Decline lives elsewhere. On pof, 51 proposals have never been
  touched.
- **Kettle leaks into live code.** `'kettle'` is used as a cache and UI key (L/train/Decide.tsx:80,
  L/train/compare/Screens.tsx:32), and "Kettle" is the release notes title (C/train/notes.ts:61). On Kettle, waves
  live only in memory or in the browser.
- **Rules live outside the tree.** The transition rules mirror `store.mjs` in lens-scan and cannot be verified
  here (C/train/rules.ts:1-7). The job registry is in memory, so a server restart loses running jobs and their
  stall cause (L/train/release/releaseState.ts:97-123).
- **Pixel diff.** A resized image is scaled into the before image's box, not compared over the common area
  (C/train/pixels.ts:39-44). Shots are cached for 1 h (S/api/products/[slug]/shots/[...path]/route.ts:15-18).
- **Doc drift.** blueprint-ui.md:953 says packs are listed newest first, but the code sorts oldest first.
  app-structure-v3 §15 omits packs, releases and triage.
- **Agent permissions.** Every agent job runs with permission prompts disabled, by the operator's choice
  (S/jobs.server.ts:2). The swarm hunt kept "bp as the permission gate" as a leap (tiger/backlog.md L3).

## Constraints

- Stack: an npm workspace with Next (apps/web), framework-free core (packages/core; `check:core-purity`), a node
  server, and TypeScript. The gate is `npm run check` (scripts/check-all.mjs).
- **The store is lens-scan's.** bp never writes `scan.db` directly: every write goes through `store.mjs`, a skill
  in the separate ai-registry repo. A proposal that needs a new store verb or column must say so as a cross-repo
  dependency. Anything bp-side can live in `.ai/lens-scan/work/` (as `bp-waves.json` does) or be derived on read.
- Gates and demos run on fake `claude` and fake `gh` (D11). A paid real run is allowed, but no check may depend
  on one.
- Kettle (sample) and live products must both keep working. `check:train-parity` holds both planes.
- `BP_WRITES=off` must still remove every write control (403 on the routes).
- Keyboard-first, honest-state language ("say it in words"), and one owner of each rule (no second copy of a
  verdict, planner or rule).
- Out of scope for this hunt: the blueprint canvas drawing (hunted today), the swarm simulation, and the VR table.
