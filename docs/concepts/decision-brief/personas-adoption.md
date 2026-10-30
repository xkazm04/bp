# Personas adoption: the decision brief on Personas' card and in its fleet

Status: **a written note, not built.** Personas was read-only while this was made (2026-10-30); everything below is what
Personas would change, read against `personas@ad40fcfa10`. bp's side is built and gated.

## Why Personas needs nothing new from bp to start

Personas' Blueprint already holds the brief's inputs. `BlueprintData` (`src/features/decision-center/blueprint/source.ts`)
carries `structure` (the parsed `app-structure.json`) and `scan` (the store in bp's wire, NULL columns omitted). That is
exactly `briefFor(subject, scan, briefMapOf(structure))`. No IPC, no server, no network: bp and Personas still meet only in
`scan.db` and the map.

## P1 - port brief.ts, held by the golden file (the drift gate the Blueprint port never had)

1. Copy `packages/core/src/scan/brief.ts` under Personas' "PORTED from bp <sha>" header. It is pure. It imports
   `TIER_SAYS` (derive.ts), the `Proposal`/`ScanSnapshot` types (Personas has them, store v3; brief reads `tier` and
   `risk_class` by presence, so v3 rows simply give `risk class unknown`), `BRIEF_MATCHES` (schema-vocab.ts: four strings)
   and the `Structure` type, used only by `briefMapOfStructure`, which Personas does not need.
2. Add one test: read bp's `docs/concepts/decision-brief/golden.json`, run every case's `subject` over its `inputs`,
   and assert the output equals the case's `brief`, deep-equal. The Blueprint port has no such gate today: its ~57
   "PORTED from bp" files are pinned to an old bp commit and nothing fails when they drift. When bp changes the brief, the golden changes in the same commit (bp's
   `check:decision-brief` refuses otherwise), and Personas' test goes red until the port follows.
3. Optionally validate each brief against `packages/schema/schema/decision-brief-1.schema.json`.

## P2 - the card

`ui/sheet/ProposalCard.tsx` `Tail`, for `p.status === 'proposed'`:

- Under the card's header, render `brief.facts` as plain lines (they fit the card: at most 5 lines of 120 characters).
  A fact with `ids` opens its list: precedent rows (verdict, date, the note in quotes), dependents, execute runs.
- When `brief.advice.say === 'withdraw'`, make **Decline** the primary `OptionRow` with the tag "you declined this
  before". Pass `repeatNote(brief.declines[0])` as the decline reason, so `ReasonDialog` opens pre-filled and the new
  row's `decision_note` names the decision it repeats. Keep Approve, marked "approve anyway".
- Keys: Personas' accept key stays **a** (approve) and **x** (decline). The recommended option is the one `Enter` takes,
  as in bp.

## P3 - the fleet reads the decisions back

Personas' fleet runs bp jobs (`BP_RUNNER=personas`, origin `lens_scan`) and its own agents. Two ways to give them
`plan.brief`, cheapest first:

- **Prompt block, no server.** Before a lens-scan propose run, compute `briefFor({ feature, title })` for each feature
  in scope with the Rust store read already in `lens_scan.rs`, through a small node call to the ported brief.ts. Put
  the `declines` lines into the run's prompt: "The owner declined: ...". No new door.
- **The MCP door.** When bp's server runs, add `apps/mcp/bp-mcp.mjs` to the fleet run's `--mcp-config` (server name
  `bp`, `BP_URL` of bp's apps/server). The agent then has `mcp__bp__plan_brief`, and its reads land on bp's agent trail
  under `BP_CONVERSATION=<fleet run id>`. bp's cards slip then shows what each fleet run heard and did next.

## Open questions for Personas' owner

1. Where should the golden test live: next to `PARITY.md`, or in a cross-repo drift job?
2. Should Personas' fleet refuse to queue a proposal whose brief says `withdraw`, or only warn? bp only advises: the
   person decides.
3. Personas signs decisions `user:personas`, and the brief shows `by` with `user:` stripped ("by personas"). Is that
   the wording you want on a shared card?
