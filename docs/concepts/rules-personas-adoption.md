# Standing rules in Personas: adoption note

Status: **proposal for the Personas side**, 2026-10-30. No Personas code was written. bp's half is built: the contract
is [rules-1.md](../standard/rules-1.md), the schema [rules-1.schema.json](../standard/rules-1.schema.json).
`scripts/personas-rules-reader.mjs` is a labelled stand-in for the rail proposed here (bp's repo, not Personas code).
Personas paths are relative to the Personas repo at `ad40fcfa10` (2026-10-26). Line numbers were read there.

## 1. Summary

bp now keeps the owner's standing rules beside `scan.db`: `<root>/.ai/lens-scan/work/bp-rules.json` (orders `O-n`:
hold, only, cap; grants `G-n`) and the append-only `bp-rules-log.jsonl` (what bp's doors held). Personas already
resolves `<root>/.ai/lens-scan` for every product, so it can read both files with no new seam to bp. The proposal:

1. **Read**: one new read-only Tauri command beside the existing eight, returning the two files.
2. **Show**: a "Rules" item on the Blueprint sheet's right rail with a flyout. It is read-only, and set, revoke and
   replay open bp.
3. **Honour**: Personas' own starts (`lens_scan_start`) run the same gate over the file before they spawn `drive.mjs`.
4. **Label**: `rule:G-n` in `proposals.decided_by` reads "grant G-n", never as a person.

## 2. How Personas reads the store directory today

- The Rust reader `src-tauri/db/src/repos/dev/lens_scan.rs` is read-only by construction (:9-13). It resolves the
  directory with `store_dir(root)` = `<root>/.ai/lens-scan` (:515-519) and `store_file` (:521-524). It reads
  `events.jsonl` raw, `""` when absent (`read_events`, :463-466). It builds the snapshot in `read_snapshot`
  (:538-554) and maps project to root in `project_root` (:576-586).
- The Tauri commands are in `src-tauri/src/commands/infrastructure/lens_scan/mod.rs`. Reads are in place, and writes
  go only through lens-scan's scripts (:4-8). `lens_scan_snapshot` is :48-61 and `lens_scan_start` is :106-119. The
  registration is `src-tauri/src/ipc_shards/shard_7.rs:375-382`, which lists exactly `lens_scan_products`,
  `lens_scan_snapshot`, `lens_scan_decide`, `lens_scan_triage`, `lens_scan_start`, `lens_scan_identity`,
  `lens_scan_commit_diff` and `lens_scan_shot`. None of the eight reads `work/`.
- On the TS side, `src/api/lensScan.ts` wraps the commands (`getLensScanSnapshot` :82-94, `startLensScan` :135-136).
  The drawing reads only `BlueprintData` and writes only through `BlueprintActions`
  (`src/features/decision-center/blueprint/source.ts:45-62`, `:107-123`). It never calls IPC itself (:1-5).
- The wire types are `src/lib/lensScan/wire.ts`, "PORTED VERBATIM from bp" (:1-3). `Proposal.decided_by` is
  `wire.ts:85`.

## 3. Read: a new command, `lens_scan_rules`

- **Repo layer**, in `src-tauri/db/src/repos/dev/lens_scan.rs`, next to `read_events` (:463-466):
  `pub fn read_rules(root: &Path) -> LensScanRules`. It reads `store_dir(root).join("work").join("bp-rules.json")` and
  `.join("bp-rules-log.jsonl")` with `std::fs::read_to_string`. No SQLite and no lock are involved, because bp writes
  the rules file by tmp + rename (rules-1 section 9), so a read never sees half a file.
- **Shape**, in `src-tauri/core/src/models/lens_scan.rs` beside `LensScanSnapshot` (:119-131), ts-rs exported:
  `LensScanRules { rules: Value /* parsed file, or null when absent */, log: String /* raw jsonl, newest 2000 lines */,
  error: Option<String> }`. A malformed file is `error` plus `rules: null`. It never fails the command, and it never
  fails the snapshot.
- **Command**, in `lens_scan/mod.rs` after `lens_scan_snapshot`: `lens_scan_rules(project_id) -> LensScanRules`. It
  uses `require_auth`, then `run_blocking`, then `repo::read_rules(&repo::project_root(..)?)`, the same three steps as
  :48-61. It is registered in `shard_7.rs` after :382.
- **Why a separate command, not a snapshot field**: the files are bp's, not lens-scan's. A bad rules file must not
  break the drawing, and the rail can re-read a 2 KB file every time it opens without paying for the snapshot's
  full-store read (its timeout is 30 s, `src/api/lensScan.ts:36`). Folding it into `LensScanSnapshot` later is cheap
  if one refresh is wanted.
- **TS wire**: a new `src/lib/lensScan/rules.ts` with a "PORTED from bp packages/core/src/scan/rules.ts" header
  (wire.ts's convention). It holds the types `Rule`, `RulesFile`, `HeldEntry`, `RuleKind` and the pure helpers the rail
  needs: `isLive`, `covers`, `tallyHeld`, `breachesOf` and `TIER_WORD`. It does not port `backtest`, `impact` or
  `checkRuleBody`, because replay and writing stay in bp. The narrowing (`getLensScanRules` in `src/api/lensScan.ts`)
  checks `version === 1` and the required fields of rules-1, which is the check `scripts/personas-rules-reader.mjs`
  makes, and shows `error` instead of rules on a mismatch.
- **Seam**: `BlueprintData` gains `rules?: { file: RulesFile | null; held: Record<string, HeldTally>; error?: string }`.
  When it is absent (the fixture or a test), the rail draws no Rules item.

## 4. Show: where the rail draws it

The rail is `src/features/decision-center/blueprint/ui/RightRail.tsx`, a 64 px column (:10-15). Its items are the
array at :27-36: `find`, `review`, `agents`, `plan`, `view`. There is no rules or orders item. Flyouts are typed by
`UiState.flyout: 'agents' | 'plan' | 'view' | null`
(`src/features/decision-center/blueprint/state/uiState.ts:51-52`). They are hosted by
`ui/rail/Flyout.tsx`, which switches on the open item at :70 (`AgentsPanel`, `PlanPanel`, `ViewPanel`, imported at
:21-23). `BlueprintSheet.tsx` mounts the rail at :75 and the flyout at :86.

Proposed:
- Add a `rules` entry to `RightRail.tsx:27-36` between `agents` and `plan`. Use bp's own live label and count
  (bp `apps/web/src/components/Dock.tsx:95`): label **Rules**, `n` = live orders and grants, sub-line
  "`g` grants", tone ink. Add a red badge (`n2`, as Review uses for failed builds at :30-31) when any live order has
  a breach.
- Add `'rules'` to the `UiState.flyout` union, add a `RulesPanel` in `ui/rail/panels/`, and add a branch at
  `Flyout.tsx:70`.
- The `RulesPanel` shows, newest first:
  - **Live orders**: id, kind terms (`hold`, `only security`, `cap medium on opus`), the owner's text, the place
    (`scope.label` and its kind), time left (or "until revoked"), held count from the log (items, acts, refusals, last
    time), and breaches. A breach row names the finding and who approved it.
  - **Live grants**: id, tier floor ("tier 2+ (normal or milder)", or "any tier", drawn in the red tone), place, time
    left (a grant always expires), and the tools it covers.
  - **Ended**: a count of revoked and expired rules, which can be expanded. They are kept as the record.
- **Breaches** come from the snapshot Personas already holds: `breachesOf` over the proposals it reads. A row counts
  when its status is not `proposed`, it has a `decided_at`, `decided_by` does not start with `rule:`, and the status
  is not `declined` (bp `rules.server.ts:77-93`). `hold` and `only` breaches are exact from `scan.db` alone. A `cap`
  breach also needs the model and effort of the wave package that built the finding (`work/bp-waves.json`), so the
  first cut shows hold and only breaches and says that cap breaches are counted in bp.
- **Nothing is writable.** Setting a rule, revoking it and replaying a draft stay in bp, the same way Release is
  read-only in Personas: "Cut, Finish and Undo open bp's Release tab" (`PARITY.md:41-43`). The panel's one action is
  **Open rules in bp**, built like `src/features/decision-center/lens/bpLink.ts:38-42`:
  `bpRulesUrl(base, slug) = <lens_scan.bp_url>/?product=<slug>&dock=orders` (base and slug from the same
  `bpBaseUrl` / `bpSlug`, :24-36). bp's deep link reads only `page` and `tab` today
  (bp `apps/web/src/engine/deep-link.ts:8`, `DEEP_LINK_KEYS = ['page', 'tab']`) and ignores other keys. Until bp adds
  `dock`, the link opens the product's plan with the Rules item one press away. That is a one-line bp change to make
  together with the Personas work.
- **PARITY.md**: the rail-panels paragraph says "Orders and Steer are bp's simulation and are left out" (:46-47).
  That holds for the simulation's orders. The new row reads: "Rules (bp's live standing rules) | present, read-only |
  set, revoke and replay open bp". Steer stays out.
- **Decision card**: approving is not building, so bp's gate does not stop it. But an approval inside a live order's
  place after the order was set reads as a breach in bp's panel (`breachesOf`, bp `rules.ts:220-224`), whether
  Personas or bp made it. The card should show the covering order ("O-3 holds Payments: approving here reads as a
  breach") before `lens_scan_decide`. It does not block.

## 5. Honour: Personas' own agent runs

There are two ways work reaches a product's code:

- **bp-started jobs under `BP_RUNNER=personas`** (bp `packages/core/src/server/jobs.server.ts:13`, `:64`). bp's doors
  gate first, at wave compose and dispatch, `/dispatch`, lens execute and the place scan (rules-1 section 6). Only
  then does the job go through the Personas fleet shim. These runs already honour orders, and Personas needs nothing
  for them.
- **Personas-started runs**: `lens_scan_start` (`lens_scan/mod.rs:106-119`) calls `start::start_drive`
  (`start.rs:191-217`), which spawns `node drive.mjs execute|cover|propagate` directly (`drive_args`, :58-86). bp is
  never asked, so a hold on Payments does not stop a Personas Build press in Payments.

The two ways to honour orders on Personas' path:

| | Call bp's gate over HTTP | Read `bp-rules.json` and run the gate locally |
|---|---|---|
| Exists today | no. bp has no gate-check route: `gateBuild` / `gateScan` run only inside the doors that act. | the file is in the directory Personas already resolves |
| Needs bp running | yes. Personas never calls bp's server today (bp `.hackathon/DOSSIER.md` section 4). | no |
| Needs | a new bp route, an HTTP client in Personas, and the product slug, which Personas can only guess (`bpSlug`, `bpLink.ts:12-16`) | a port of `gate`, about 40 pure lines (bp `rules.ts:103-129`), and one file read |
| Drift risk | none | the port can drift. A shared case table guards it: [`docs/standard/rules-1.cases.json`](../standard/rules-1.cases.json) (20 cases; bp's `check:rules` replays every one on bp's gate) is the table a Rust test of the port replays |

**Reading the file is cheaper**, and it works with bp off. That matters because a hold should hold when the owner
has closed bp. Put the gate in Rust, at the door, as the first step of `lens_scan_start` before `start_drive`. A
TS-side check could be bypassed by any other caller of the command. The act it builds:

- `execute` with `ids` is a build act. The items are those ids with their `feature` and `lens` from the store's
  proposals rows.
- `execute` without ids is a build act over every `approved` proposal of the lens, which is what drive will take.
- `measure` (`cover`) is a scan act `{ lens, scope }`: scope `selection` over `features`, else `all`.
- **Personas starts carry no model or effort, so a `cap` never holds them.** The gate holds a build for a cap only
  when the act names an effort (bp `rules.ts:108`), and that is the same in bp. The rail should say so under a cap.
- A refusal is an `AppError` that carries bp's citation words (`order O-3 (user:ana, 2026-10-30 14:02): ...`, from a
  port of `citeWords`). The Build queue shows it the way it shows a store `skipped[]` reason. A partial hold starts
  drive with the remaining ids and lists the held ones.
- **The log**: rules-1 names bp as the only writer of `bp-rules-log.jsonl`. Personas keeps its own holds in its
  tracing log until rules-1 adds a second writer (an appended `HeldEntry` with `tool: "personas.lens_scan_start"`).
  Until then, bp's held counts do not include Personas' holds.

## 6. The `rule:G-n` signature

When a grant runs a companion card, bp signs the decision `decided_by = 'rule:G-n'` in `scan.db`'s `proposals` (bp
`door.server.ts:44-53`, `:213`; the proposal route `products/[slug]/proposals/[id]/route.ts:21`; wave dispatch
`waves/[wave]/dispatch/route.ts:36`). Personas sees these rows in its snapshot as ordinary `decided_by` strings
(`wire.ts:85`).

- Today no Personas UI shows `decided_by`. A grep of `src/features/decision-center` for `decided_by` matches only the
  fixture (`blueprint/fixture/actions.ts:45`, `blueprint/fixture/kettle.scan.json`) and its test
  (`blueprint/__tests__/fixtureActions.test.ts:40`). Nothing is mislabelled yet.
- When a surface shows who decided, `user:<login>` reads as the login, and `rule:G-n` reads as **"by grant G-n"** in
  the grant tone. When `lens_scan_rules` is loaded, the label adds the grant's text and links to the Rules flyout. It
  is never shown as a person, and it is never counted as the owner's decision in any "decided by you" figure, for the
  same reason bp leaves those rows out of the replay (bp `rules.server.ts:83`, `:95-97`).
- Personas' own signature stays `user:<gh>`, else `user:personas` (`src/api/lensScan.ts:138-139`). A `rule:` prefix
  must never come from Personas, because only bp's grant path can sign one.

## 7. Not built tonight

- No Personas code: no command, no wire type, no rail item, no gate port, no PARITY.md edit.
- No bp `dock=orders` deep-link key (section 4).
- No Personas `HeldEntry` writer, and no rules-1 change that would allow one.
- No `cap` breach in Personas (it needs `bp-waves.json`).

## 8. Open questions for the owner

1. `propagate` with only `--standard` names no items before drive runs. Should a live hold or `only` order anywhere
   refuse it (the cautious choice), or should it be ungated until drive can list its items?
2. Should Personas' gate holds go into bp's log (a rules-1 v1.1 that allows a second appender), so that bp's held
   counts are whole?
3. Should the gate move into lens-scan's `drive.mjs`? It would then cover every runner, the CLI included. It is the
   strongest place, but it is in a third repo that neither app owns.
