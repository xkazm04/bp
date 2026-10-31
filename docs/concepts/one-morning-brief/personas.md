# Personas and the fused morning: what its Blueprint port must change

The detail behind [`ROADMAP.md`](ROADMAP.md) section 5, written 2026-10-30. Two earlier notes cover the parts:
- [`../one-morning/personas-adoption.md`](../one-morning/personas-adoption.md) (e3): the follower, the place mapping, the
  echo rules;
- [`../decision-brief/personas-adoption.md`](../decision-brief/personas-adoption.md) (e2): the brief's port, the card,
  the fleet.

This file merges them into one order of work and adds the drift gate. Personas paths (`P:`) are in the read-only
reference tree `C:/t/hk-bp-ref-personas` at `ad40fcfa10`. bp paths are this repo, at the fusion merge `2ea1c1e`.

## 1. The topology: bp builds, Personas reads (owner)

- **bp builds.** A feature is built, gated and demonstrated in bp first. bp publishes:
  - its contracts: schemas in `packages/schema`, goldens, and dependency-free copy targets;
  - its computed state: the shared-focus record and the Morning deck.
- **Personas reads.** It copies the contracts under a pinned header and holds each copy with bp's golden. It reads
  bp's computed state from its Rust side. It writes only through the path it already has: `lens_scan_decide` →
  lens-scan's `store.mjs` (`P:src-tauri/src/commands/infrastructure/lens_scan/mod.rs:66-82`).
- **The meeting point stays `scan.db`** (DOSSIER §7.6). A decision taken in Personas reaches bp's deck through the store.
  bp's close card already counts decisions taken elsewhere (`decidedElsewhere`, `bp:packages/core/src/companion/morning.ts:202`).
- **The one new seam.** Personas' Rust calls bp's loopback HTTP. Its webview cannot:
  - the shipped CSP's `connect-src` names no `localhost` or `127.0.0.1` (`P:src-tauri/tauri.conf.json:43`); only
    `devCsp` allows `http://localhost:*` (`:44`);
  - bp sends no CORS headers;
  - bp refuses the origin `tauri.localhost` (`bp:packages/core/src/scan/local-only.ts:57-63`).
  Rust already has `reqwest` 0.12 (`P:src-tauri/Cargo.toml:67`).

## 2. The port today

- **What is ported.** `grep -rl "PORTED from bp" src` finds **54 files**. The DOSSIER says about 57; it may count
  other header wordings. They sit under `P:src/features/decision-center/blueprint/`:
  - 17 in `engine`;
  - 6 in `model`;
  - 4 in `standard`;
  - 23 across `ui`;
  - 2 in `ledger`;
  - 2 tests in `P:src/lib/lensScan/__tests__`.
- **Pins.** Only 7 headers name a bp commit: 5 at `fbef867`, 2 at `48171a1`. The others cite a bp path with no commit.
- **No gate.** Nothing fails when bp moves.
- **The rooms already drifted.**
  - Since bp `57ee810` (2026-10-25), a bp room is a capability. In Personas' ported layout that is a bay
    (`P:.../blueprint/model/layout.ts:1-6` is the `fbef867` port).
  - bp's wing ids carry a building index (`0:<domainId>`).
- **The seam.**
  - `BlueprintData` and `BlueprintActions` are in `P:.../blueprint/source.ts:44-62,107-123`. `decide(ids, decision,
    note?)` is at `:109`.
  - The live implementation maps to 8 Tauri commands, registered at `P:src-tauri/src/ipc_shards/shard_7.rs:375-382`:
    `lens_scan_products`, `snapshot`, `decide`, `triage`, `start`, `identity`, `commit_diff` and `shot`.
- **The wire.**
  - `P:src/lib/lensScan/wire.ts` `Proposal` (`:68`) has no `tier`, `risk_class`, `origin` or `external_ref`.
  - `source.ts:60` documents `storeVersion` as "1, 2 or 3 today".
  - bp's store is `user_version = 4`.
  - The Rust reader takes columns by presence, never by a version allowlist (`P:src-tauri/db/src/repos/dev/lens_scan.rs:14-18`).
    So v4 columns probably reach the webview untyped. This is **not verified at runtime**.
- **What Personas left out on purpose** (`P:.../blueprint/PARITY.md`):
  - bp's simulated swarm, Orders and Steer;
  - Release is read-only, and Cut, Finish and Undo open bp;
  - lens authoring stays in bp;
  - triage accept is **Y** in Personas (`P:.../blueprint/model/keymap.ts:27`) and **A** in bp.
- **The only link out today.** The browser deep link `<lens_scan.bp_url>/?product=<slug>&...`
  (`P:src/features/decision-center/lens/bpLink.ts:19-42`). Its slug is `bpSlug(root)`, the folder name (`:32-36`): a
  convention, not a lookup.

## 3. What changes, in order

### 3.1 The brief on the card (ROADMAP S3: G1, G2, G3)

| Step | Personas file | Change |
|---|---|---|
| Port | new `P:src/features/decision-center/blueprint/model/brief.ts` | A copy of `bp:packages/core/src/scan/brief.ts` under a pinned header (§5). Copy `TIER_SAYS` and `BRIEF_MATCHES` as constants rather than port `derive.ts` and `schema-vocab.ts`. `briefMapOfStructure` needs bp's `Structure`; Personas' ported loader (`blueprint/standard/load.ts`) may serve, or `briefMapOf(raw)` reads the raw map |
| Golden | new `P:.../blueprint/standard/decision-brief.golden.json` + `P:.../blueprint/__tests__/brief.golden.test.ts` | Copy bp's golden. Today it is `bp:docs/concepts/decision-brief/golden.json`, 6 cases; S2 may move it. Run every case's subject over its inputs and assert deep equality |
| Wire v4 | `P:src/lib/lensScan/wire.ts` | `Proposal` gains optional `tier`, `risk_class`, `origin` and `external_ref`. `source.ts:60` says 4. No Rust change, because Rust reads by presence |
| Card | `P:.../blueprint/ui/sheet/ProposalCard.tsx` (`Tail`, `:13-25`), `OptionRow.tsx`, `P:.../blueprint/ui/ReasonDialog.tsx` | Under the header: `brief.facts` as at most 5 plain lines; a fact with `ids` opens its list. On `advice.say === 'withdraw'`, **Decline** (`x`) is the primary `OptionRow`, tagged "you declined this before", and `ReasonDialog` opens pre-filled with `repeatNote(brief.declines[0])`. Approve stays, as "approve anyway". On `ask` with declines, show the amber quote and the chip "Like a declined idea", and Approve stays primary. Never bind **Y**: it is triage accept |
| Write | none new | `actions.decide([id], 'decline', note)` → `lens_scan_decide(project_id, ids, decision, note)`, which already takes a note (`mod.rs:66-82`) |

### 3.2 The Monitor follows the shared focus (ROADMAP S6: G4, G5)

**The Rust module.** It is new, next to `P:src-tauri/src/commands/infrastructure/lens_scan/`, with a name such as
`bp_link/`, and is registered in an IPC shard the way `shard_7.rs:375-382` registers lens-scan. The base URL comes from
the existing `lens_scan.bp_url` setting, default `http://localhost:3010` (`bpLink.ts:19-29`).

| Command or event | bp route | Notes |
|---|---|---|
| `bp_focus_start(window)` | `POST /api/session/focus` `{ op: 'hello', reader: 'personas:<window>', surface: 'personas', label: 'Personas' }`, then `GET /api/session/focus` every 1 s | Says hello every 15 s while a Blueprint surface is visible. Polls rather than streams, because the stream also carries the owner's companion turns |
| `bp-focus:view` (event) | - | The `SharedView` passed through as JSON. TS validates it with the ported `readFocusPlace` |
| `bp_focus_follow(on)` | `POST ... { op: 'follow', of: '*' }` / `{ op: 'unfollow' }` | The Follow chip |
| `bp_focus_stop()` | `POST ... { op: 'forget' }` | On window close, or when the last Blueprint surface unmounts |
| `bp_products()` | `GET /api/products` → `{ slug, name, root }` | The slug ↔ projectId table, matched on canonical, case-folded roots against `dev_projects.root_path`. It replaces `bpSlug(root)` here and in the Release deep link (`useBpRelease.ts:110`) |
| `bp_focus_publish(place)` | `POST ... { op: 'publish', place }` | **Only if the owner chooses G7** |

When bp is down, the module reports offline every 5 s instead of failing each second. Rust sends no Origin and no
`Sec-Fetch-Site`, so it passes bp's `localHost`, `localOnly` and `jsonOnly` guards with `content-type:
application/json`, and with no bp change. The shared focus needs no token (`bp:.../api/session/focus/route.ts:9-10`).

**Applying a place.** This happens only while the Monitor's Blueprint tab or a Blueprint sheet is visible. The tab is
mounted at `P:src/features/fleet/monitor/shell/MonitorBody.tsx:58` (`BlueprintPicker`), and the sheet by `openLensSheet`
→ `LensSheetHost` → `LiveBlueprint` → `BlueprintSheet`. A shared place never pops the full-bleed sheet over another
Personas view. Two seams are needed:

1. **`place?: FocusPlace` on `LensSheetRequest`** (`P:.../lens/lensSheetStore.ts:14-17`). Opening another product
   remounts the sheet, which is keyed by `projectId` (`P:.../lens/LensSheetHost.tsx:47`). `initialFeature` applies only
   once (`P:.../controller/useSheetController.ts:73-81`).
2. **A `useFocusApply(nav, plan)` hook in the sheet controller** for moves within the open product. It uses `nav.toLevel`,
   `nav.openSheet` and `nav.flyToPlace('wing' | 'bay', id)` (`P:.../controller/useNavigation.ts:15-29,54-66,78`).

Which Personas node a bp place lands on depends on the map's shape, because Personas' ported layout (the `fbef867`
port) draws what the map gives it. Two shapes exist:

- **A current bp map** (a live product, and the demo maps that `morning-up` seeds): in bp a wing is a domain
  (`<building>:<key>`, e.g. `0:FND` or `0:<domainId>`), a room is a **capability**, and a bay is a feature kind
  (`<capabilityId>.<kind>`). Personas draws **each capability as its own wing and its own room**, with bp's bays as its
  bays, and has no node at all for a domain-group wing.
- **The older Kettle fixture** (the shape this table was first written for): Personas' wing, room and bay were bp's
  group, domain and capability, so a capability, which is what a bp room is, was a Personas **bay**.

| bp place | Personas call on a current bp map | Personas call on the older Kettle fixture |
|---|---|---|
| `site`, or no target | `nav.toLevel(0)` | the same |
| `wing` `0:<key>` (a domain-group wing) | **No node. Hold still and say** "wing `<id>` is not on Personas' plan" | `nav.flyToPlace('wing', id)` |
| `room` `<capabilityId>` | The Personas **room** of that capability, at L2 | `nav.flyToPlace('bay', id)` (a bp room is a Personas bay) |
| a bay `<capId>.<kind>` (if S2 makes it a place) | The same bay | strip `.<kind>`, then `flyToPlace('bay', ...)` |
| `feature` | `nav.openSheet(fid, lens?)`, with `lens` read from the hash's `lens=` | the same |
| an id that resolves to nothing | Hold still and say "<kind> <id> is not on Personas' plan" | the same |
| an unknown slug | "Not in Personas: <slug>" | the same |

On a current map the old rule "a bp room is a Personas bay" lands a room one level too high. Personas' follower applies
the left-hand column: the log of the S6 session found it on the first live run and fixed it in Personas `31eb33b512`
(room to Personas room at L2, bay to the same bay, a domain-group wing holds still and says so). The layout it reads is
`P:.../blueprint/model/layout.ts` (the `fbef867` port). The stand-in's `--personas` output (`bp:scripts/focus-standin.ts`)
prints the left-hand column.

**Owner decisions, 2026-10-31.**

1. **Personas gets no node for domain-group wings for now.** A shared `wing` place holds still in Personas and says
   so (above). Adding a wing node for domains is a later Personas layout change, not part of S6.
2. **Reading a Morning card in Personas does not move the drawing.** Browsing the deck (the Morning tab) is reading; only
   **O / Open** on a card flies the drawing to its place.

**The follow logic.** Personas takes the follow logic from S2's copy target (`sameSpot`, `toApply`, `followingWords`),
held by the shared-focus golden. It does not take it from e3's note: since bp `0a9cbef`, `sameSpot` also compares the
level and the hash's `at` (`bp:packages/core/src/session/focus.ts:95-99`), and the note predates that.

### 3.3 The Morning deck in the Monitor (ROADMAP S6: G6)

| Step | Where | Change |
|---|---|---|
| Read | Rust `bp_morning(since?)` → `GET /api/companion/morning` | bp's computed `MorningDeck` (S2: `morning-deck-1`). It is read-only and loopback-only, and needs no token |
| Show | a new Monitor view beside Blueprint in `MonitorBody.tsx` | The cards, each with its brief, read-only. Reading a card does not move the drawing; **O / Open** does (§3.2, owner decision 2026-10-31). Nothing is published unless G7 is chosen |
| Approve / Decline a repeat | `actions.decide([card.decision.proposal], ...)` → `lens_scan_decide` | `projectId` comes from the root table. **Never** bp's `POST /api/companion/morning`, which needs bp's human token, handed only to a same-origin bp page |
| Defer / Hold | a deep link `?product=<slug>&morning=<card id>` | They stay in bp. They write bp's steering log (`bp:.../companion/morning.server.ts:26-27`). Personas does not append to it (G8, recommended no) |

## 4. The Rust commands, all together

| Command | Session | Writes? |
|---|---|---|
| `bp_products` | S6 | no |
| `bp_focus_start`, `bp_focus_follow`, `bp_focus_stop` | S6 | Only bp's shared-focus record (presence and follow), never a store |
| `bp_morning` | S6 | no |
| `bp_focus_publish` | only with G7 | the shared focus |
| existing `lens_scan_decide` | S3, S6 | the store, through `store.mjs`, as today |

None of these needs a new bp route. If the owner ever wants a webview path, scope it to `/api/session/focus` with a
per-install token minted by bp. Never widen `LOOPBACK_HOST` and never allow `tauri.localhost`: every Tauri 2 app on the
machine shares that origin.

## 5. The wire-version gap and the drift gate

**The gap.** Personas types stop at store v3, while bp is at v4. bp now also speaks three wires Personas has never seen:
- `decision-brief-1`;
- the shared focus (`shared-focus-1` after S2);
- the deck (`morning-deck-1` after S2).

The 54 legacy ports trail bp by about 900 commits (DOSSIER §4).

**The gate** has three parts, so that a change on either side turns something red:

1. **bp: a contract manifest.** The proposed home is `bp:packages/schema/contract.json`. It lists every artifact a port
   copies (schemas, goldens and copy targets such as `session/focus-contract.ts`) with its sha256. A bp check (S2) fails
   when an artifact changes and the manifest does not. A changed golden is then always a deliberate commit.
2. **Personas: pinned copies held by goldens.** Each contract copy carries the header `PORTED from bp <path> @ <sha>
   sha256:<hash>`. One Personas test, `P:.../blueprint/__tests__/contract.test.ts` (proposed), runs each golden
   (brief, shared focus) against the port and checks that every copy still matches its header hash.
3. **Cross-repo: a report.** `bp:scripts/personas-drift.mjs --personas <root>` (proposed) compares each Personas header
   with bp's manifest and with bp's current files.
   - It lists drifted contract copies, which exit non-zero.
   - It lists the 54 legacy ports with their pins, as a report only.
   - It runs at the start of S3 and S6, and in the start-of-day hygiene sweep.
   - It stays **out of `npm run check`**: a machine without a Personas checkout would print SKIP, and a SKIP fails bp's
     suite (DOSSIER §6).

Re-porting the 54 legacy files (for example the capability-room layout) is a separate decision, not part of this plan.
The report makes their age visible.

## 6. What stays read-only in Personas

| Area | Owner of writes |
|---|---|
| Release: cut, finish, undo | bp (PARITY.md) |
| Lens authoring | bp |
| Defer and Hold, the steering log | bp |
| Standing rules (e1, parked) | bp. Personas would read `bp-rules.json` only |
| The shared focus | bp's record. Personas is a follower; publishing is G7 |
| Proposal decisions | **Both**, each through its own path into `store.mjs`, as today |

## 7. Questions for Personas' owner

1. Follower only (recommended), or a publisher too (G7)?
2. Where does the golden test live: next to `PARITY.md`, or in a cross-repo job (e2's question 1)? This plan proposes
   the test in Personas and the report in bp.
3. Personas signs `user:personas`, and a shared card says "by personas". Is that the wording wanted (e2's question 3)?
4. Should the fleet refuse to queue a proposal whose brief says `withdraw`, or only warn (e2's question 2)? bp only
   advises.
