# Architecture review, 2026-10-21

Scope: the boundaries P3 leans on, which are `packages/core` vs `apps/web`, `packages/schema` as the contract,
`apps/server` vs `apps/vr/BpLink`, and cycles between workspaces. Read on master `4eebd8f`. Nothing here was
built or run on Unreal. Settled decisions are taken as given: hand-written TS types with generated TS as a parity
artifact, a pure `packages/core`, and the P1 to P6 plan.

Already sound, so not findings: no workspace imports another in a cycle. `packages/core` reaches no `apps/*` and
no `@/` (enforced by `scripts/check-core-purity.mjs`). `apps/server` imports only `@bp/core`
(`apps/server/src/main.ts:10`, through `mount.ts`). Nothing imports `@bp/schema` at runtime, which is how the
parity decision means it to be. Each `apps/web` route is a thin re-export of the core handler at the same path,
and `scripts/check-route-guards.mjs:97-118` fails if a mount drifts.

## The five findings, most costly first

### 1. The server serves the raw map. The derived plan (layout and lens readings) exists only in TS. Blocks P3.

- **Evidence.** `packages/core/src/server/api/products/[slug]/structure/route.ts:31` and `:40` answer
  `{ structure, events, rev }` with the structure passed through as written. The header comment says "the client
  loads it with the standard's loader". That loader is `loadStructure` (`packages/core/src/standard/load.ts:568`),
  which calls `readLens` and `evaluateLens` (`load.ts:73-74`, `standard/health.ts:169`) for every lens reading. The
  layout is `layoutProduct` and `wingOrder` (`packages/core/src/model/layout.ts:29`, `:51`). No handler under
  `packages/core/src/server/` imports `model/layout`, `standard/health` or `loadStructure` (grep, no hits).
- **Why it costs later.** tech-stack.md §1 says the UE app "never computes a health rule or a layout rule". As
  built, it has to: WP3.2 ("wing footprints ... from `core`'s layout") and WP3.5 (lens switch) have no endpoint to
  read from. The two ways round it are both bad. One is porting the condition grammar and the layout into C++,
  which develops the logic twice. The other is an endpoint designed in a hurry during P3.
- **Smallest fix.** One read-only handler, for example `GET /api/products/[slug]/plan`. It runs `loadStructure`
  and `layoutProduct` in core and returns a flat projection: wing, room, bay and tile boxes with ids, plus each
  tile's health per enabled lens. `Layout` cannot be serialized as it is because its nodes point back to their
  parents (`layout.ts:12-16`), so the projection carries ids, not references. Give the answer a JSON Schema in
  `packages/schema` (see finding 2) so it reaches UE as USTRUCTs, and add the request to the BpLink contract
  (`scripts/check-bplink.mjs`).
- **Blocks P3:** yes, for WP3.2, WP3.3 and WP3.5. WP3.1 (log the wings) does not need it.

### 2. Kettle has two meanings of "wing", and P3's acceptance counts the other one. Blocks P3's acceptance wording.

- **Evidence.** The web app draws Kettle as 5 wings. `WING_DEFS` (`packages/core/src/model/constants.ts:32-38`)
  groups Kettle's 13 domains into 5, and `wingOrder` applies that grouping only to `kettle`
  (`layout.ts:32-34`). So it draws 5 wings, 13 rooms (domains), 29 bays (capabilities) and 133 tiles. BpLink
  instead logs `structure.domains` as the wings (`apps/vr/Source/BpLink/Private/BpLink.cpp:132-133`).
  `apps/vr/README.md:23` and `:36` say the same, and so does plan.md: WP3.1 and WP3.2 say "13 wings", and WP3.3
  says "29 rooms and 133 fixtures" (`plan.md:175-177`). `check-server` and `check-bplink` both count wings as
  `domains.length`.
- **Why it costs later.** VR would call capabilities "rooms" where the web calls them "bays", and would draw 13
  wings where the web draws 5. The Kettle-only table that keeps the two the same is TS, so nothing would ever
  flag the mismatch. It goes against "one logic, three channels" (tech-stack.md §3), and it carries into the
  voice tool `navigate` ("fly to a wing, room or feature", tech-stack.md §4).
- **Smallest fix.** Settle the words now: VR uses the web's levels (wing, room, bay, tile), and reads them from
  finding 1's endpoint, not from `structure.domains`. Then correct the WP3.x acceptance counts in plan.md to 5
  wings, 13 rooms, 29 bays and 133 fixtures. `check-bplink` can keep counting domains, but should label them
  domains. This needs a decision on the plan's wording, not code.
- **Blocks P3:** it blocks WP3.2 and WP3.3 as currently worded. The fix is cheap if made before WP3.2 starts.

### 3. Most of what `apps/server` emits has no schema, so it cannot reach UE as structs. Blocks P5, not P3.

- **Evidence.** `packages/schema/schema/` holds only `app-structure-3`, `app-structure-event-3` and
  `lens-manifest-1`. None of these describe:
  - the structure envelope `{ structure, events, rev }` (`structure/route.ts:31`). BpLink parses it by hand
    (`BpLink.cpp:87-101`).
  - the SSE events `snapshot | delta | map | ping | error | jobs` (`packages/core/src/scan/types.ts:299`), with
    `ScanSnapshot` (`types.ts:193`) and `ScanDelta`.
  - `ScanJob` (`packages/core/src/scan/jobs.ts:25`), `Proposal` (`types.ts:70`), and `Wave` and its packages
    (`packages/core/src/scan/waves.ts:22`).

  These shapes are hand-written TS types in core. They are the ones WP5.1 to WP5.3 read: pins rising from the
  stream, packages, dispatch and jobs.
- **Why it costs later.** The tech-stack promise ("a field added to a schema reaches both channels in one
  change") covers the map only. For everything live, BpLink would carry hand-written C++ structs, and nothing
  would check them when a core type changes.
- **Smallest fix.** Add a `wire` schema to `packages/schema`: the envelope, the six stream events, ScanJob,
  Proposal and Wave. Extend the existing parity rule (types.ts against generated TS, presence and optionality) to
  these core types, and emit their USTRUCTs. This follows the settled decision: core's types stay the ones the
  code imports.
- **Blocks P3:** no. P3 reads only the envelope, which BpLink already handles. It becomes a blocker at WP5.1.

### 4. Client-side protocol and domain rules still live in `apps/web`, in a React module. Blocks P5, not P3.

- **Evidence.**
  - `apps/web/src/lib/scan/client.ts:40-62`: `upsert` and `mergeScan`. These are the rules for applying a stream
    `delta` to a snapshot: the key per table, the coverage key `feature + standard`, and keeping only the last 200
    activity rows. They sit in a file that imports React (`client.ts:4`).
  - `client.ts:300-329`: `parseWavePackage`, `parseWave`, `parseWaves` and `parseWaveDispatch` are the wave wire
    parsers. Their siblings (`parseScanJob`, `parseTriageResult` and others) are already in core at
    `packages/core/src/train/wire.ts:152-216`.
  - `apps/web/src/lib/scan/scan-views.ts:24` `scopesAt` (feature, then bay, room, wing, everything, deduplicated)
    and `:53` `jobProgress`. The first is how a pointed place becomes a `ScanScope`, which is what `scan.place`
    and WP5.1's sweep need. It imports only engine types (`scan-views.ts:6-7`).
  - `apps/web/src/lib/model/live-steer.ts:86` `planLive`, the pure planner for measure, build and stop. It is kept
    out of core only because the same file holds `runLivePlan` (`:139`), which calls the browser client.
- **Why it costs later.** apps/server needs these rules when it hosts athena's tools (`scan.place`,
  `wave.compose`, `wave.dispatch`, tech-stack.md §4). The VR client needs the same behaviour. While they live in
  apps/web, each new channel copies them, and the copies drift: "one finding in one draft wave" (WP5.2) is the
  kind of rule that drifts.
- **Smallest fix.** Move the pure parts to core with no change in behaviour: `mergeScan` and `upsert` to
  `core/scan`, the wave parsers to `core/train/wire.ts` or `core/scan/waves.ts`, `scopesAt` and `jobProgress` to
  `core/scan` (swap the `Crumb` type for a `{ t, id }[]` parameter), and `planLive` to `core/scan`. Leave
  `runLivePlan` in apps/web. `check:core-purity` already guards what may move.
- **Blocks P3:** no. Do it before WP5.1 and WP5.4.

### 5. Kettle is read-only on the server, and its simulation runs only in the browser. Blocks P5's Kettle gate, not P3.

- **Evidence.** Every Kettle route except `structure` answers 405
  (`packages/core/src/server/products.server.ts:57-70`: "only GET /api/products/kettle/structure answers it"),
  and so does Kettle's `/stream`, which BpLink pins (`BpLink.cpp`, `apps/vr/WP3.1.md`). The swarm and scan
  simulations that make Kettle feel live are pure core (`packages/core/src/model/sim.ts:158` `SwarmSim`,
  `model/scan-sim.ts:65` `ScanSim`). They are built only in the web's in-process sample model
  (`packages/core/src/model/sample.ts:26-27`). No server code instantiates them.
- **Why it costs later.** P5's gate is "the full loop ... on Kettle and on a live product" (plan.md, P5). Through
  `apps/server`, a VR client on Kettle can neither scan, compose a wave, see jobs, nor receive a stream. On Kettle
  the loop exists only inside a browser tab.
- **Smallest fix.** This is a decision to make before P5 starts. One option is to have `apps/server` host the
  Kettle simulations behind the same routes and stream them (a sample store in memory, still never written to
  disk). The other is to restate the P5 gate as live-product only, with Kettle read-only in VR. The first costs a
  sim host in core/server; the second costs nothing but the plan line.
- **Blocks P3:** no. P3 reads Kettle, which works today.

## Order of work

1 and 2 are the ones to settle before WP3.2. They are best done together: finding 1's endpoint is where VR gets
the wing grouping from. 3 and 4 are P5 prep and can be done as one package: schema for the wire, then the pure
rules into core. 5 is a decision for the operator, not a code change.
