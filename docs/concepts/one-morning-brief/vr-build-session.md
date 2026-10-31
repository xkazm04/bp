# VR build session: compile F3 and D12, captures, and approving several findings at once

Plan for the next morning session (written 2026-10-31, after PR #12). It closes what S4 still owes on the UE side and
adds the owner's D15. Read with [`ROADMAP.md`](ROADMAP.md) S4, §4.3 and §4.5, and the two builder logs on Lynx:
`C:/t/hk-bp-sync-1029/logs/vr.md` (the 10-30 session: how the build, the demo store and the captures were run) and
`C:/t/hk-bp-sync-1029/logs/vr-f3.md` (the 10-31 session: what was written but never compiled).

## Where things stand

- On master (`16ea74a`): F3 (BpLink reads and sends the shared focus through the generated structs), D12 (a pinch on
  Approve approves through the device route `POST /api/products/<slug>/proposals/<id>/approve`, the door's `decide`
  scope), E6 (the door's slug is `{0,62}`). `npm run check` 130/130.
- **Never compiled by UBT.** The headless MCP editor (`apps/vr/tools/mcp-editor.mjs`, PID 18992, started 10-29) held
  the main checkout the whole 10-31 session. The owner had it stopped at the session's end. Engine calls were checked
  against the UE 5.8 source and the ue-standin syntax check passed under MSVC, nothing more.
- Owed from S4: the bpEditor build (the F3 compile, D5), F9, the card Approve captures, `run-bplink.mjs` editor and
  bundle runs, the L0 line.
- Out of this session: the Quest APK and BuildCookRun (D13, deferred again 2026-10-31), S7, S8.

## Owner decisions this plan carries (2026-10-31, recorded as D15-D17 in ROADMAP §6)

- **D15.** Where an approval relates to several findings at once, one pinch approves all of them.
- **D16.** Personas: no node for bp's domain-group wings for now; reading a Morning card does not move the drawing;
  Personas' TypeScript wire moves to store v5 (a Personas session, not this one).
- **D17.** Spend is not an issue (D11 stands); the APK stays deferred (D13 stands).

## 0. Preflight (10 min)

1. `git -C C:/Users/kazda/kiro/bp status -sb`: master, level with origin, only the untracked `.claude/settings.local.json`.
   Pull with `--ff-only` if behind. Other sessions use this checkout: never reset it.
2. No UE process: `tasklist | findstr /i "UnrealEditor UnrealBuildTool ShaderCompileWorker"` prints nothing.
   `node C:/t/hk-bp-sync-1029/ue-turn.mjs status` says `free` (it now also sees `UnrealEditor-Cmd`, fixed 10-31).
3. The stale MCP editor record: `apps/vr/Saved/mcp-editor.json` still names PID 18992. **Do not run
   `mcp-editor.mjs stop`** (it kills by the recorded PID, and Windows reuses PIDs). Check `Get-Process -Id 18992`; if no
   process or not `UnrealEditor-Cmd`, delete the json. Then `mcp-editor.mjs status` reports nothing running.
4. Ask whether any session still expects the MCP editor on 8770. If yes, restart it after this session, not during.

## 1. Compile (the F3 and D12 C++) - 30-60 min

- `node C:/t/hk-bp-sync-1029/ue-turn.mjs build` (bpEditor Win64 Development, start-editor.ps1's environment; one UBT at a
  time machine-wide). Then `ue-turn.mjs release`.
- Expected first-build fallout: the generated headers (`packages/schema/generated/ue`, through the schema junction)
  compile for the first time inside the module (D5). Fix compile errors in `BpLink.cpp` (`ReceiveFollowView`,
  `SendPublish`, `SendFollowOp`, `SendDecision`), `BpDeck.cpp` (`DeckApprove`), `BpMarks.cpp` (`CardTap`,
  `CardDecided`) in a branch `roadmap/vr-build`, built in the main checkout (commit there, push only the branch).
- Done when: exit 0, and `npm run check` still green.

## 2. F9 - the MetaXR debug files (10 min)

- After the build, list `apps/vr/Plugins/MetaXR/**/*.pdb|*.lib` with dates. The 10-31 count was 17 `.pdb` + 17 `.lib`
  dated 10-30 plus the vendor `OVRPlugin.lib` (the ROADMAP row says 54: the hackathon's junction write-through).
- If they are this checkout's own plugin build products (dated today, matching the modules built), they belong there:
  record that and close F9. If any came from a worktree build (10-30 dates that today's build did not rewrite) and
  differ from the vendor package, restore them from `apps/vr/tools/install-xr.ps1`'s source. Write the result into the
  F9 row.

## 3. The approve pinch, seen (60 min)

Follow the 10-30 recipe in `logs/vr.md` (demo store, editor on its own MCP port, PoF `capture_viewport` in PIE from the
table's target pose; look at every capture yourself).

1. Demo: `node scripts/morning-up.mjs --port 3313 --server --prod` with `BP_CLAUDE_BIN=scripts/fixtures/fake-claude.mjs`
   (the server listens on port+100). Product `kettle-web` (Kettle's sample has no store: approve answers 404 there).
2. Editor: `ue-turn.mjs editor`, the MCP editor on a free port (`BP_MCP_PORT`, not 8770 if another session wants it).
3. Card: a non-repeat open card, `BpHands.Pinch card:approve` -> HTTP 200, the store row `approved` with the Morning
   Watch's `decided_by` and note, one steering-log row, no job queued; the card moves on only after the 200 and stays
   gone after the next store read. Captures `vr-approve-card-before.jpg` / `-after.jpg` next to the decline ones in
   `../one-morning/`.
4. Deck: `BpHands.Pinch deck:approve` on a decision screen -> approved in the store and added to the draft wave (the
   earlier owner ruling; making it approve-only is a one-line removal if the owner asks). Captures before and after.
5. A refusal: approve an already decided finding -> 409 logged, the card stays.
6. Regression: `card:decline` on the repeat still declines (F8), and the deck's DECLINE · REPEAT still first.

## 4. D15 - several findings, one pinch (90 min)

Today every card and deck screen targets one finding, so D12's pinch approves one. D15 applies wherever a VR approval
relates to several findings.

1. **Inventory (15 min, decide before building).** List every VR control that stands for more than one finding: the
   room deck's summary at the queue's end (NEXT ROOM), a draft-wave card, any grouped card (search `BpDeck.cpp`,
   `BpMarks.cpp`, `BpTable.h`, `BpWrist.cpp` for queues and `Approve`). For each, write which findings it approves
   (only `proposed` ones, never decided, in-job or Kettle-sample ones). If none exists yet, ask the owner one question:
   "add APPROVE ALL (n) to the room summary?" and build only what is answered.
2. **Server.** A device route that approves a set: `POST /api/products/<slug>/proposals/approve` with `{ ids }`
   (1..50), the same `steer` approve per id (one steering-log row each), answering `{ approved, skipped: [{ id, status }] }`
   the way `dispatch` reports skips, 403 with `BP_WRITES=off`, 400 without `x-bp-device`, no job queued. A second verb on
   the door's named-only `decide` scope. Extend `check:vr-approve` (a set of three with one already decided: two
   approved, one skipped; a 51-id body refused) and `check:lan-door`; a row in `docs/blueprint-ui.md`.
3. **BpLink and the table.** `ApproveDecisions(TArray<FString> Ids, ...)`; the control's pinch calls it, and the table
   drops each approved finding after the 200 (as D12 does), keeping skipped ones with their reason in the log.
4. **Seen.** One pinch on the multi-finding control approves all its open findings in the store; capture before and
   after.

## 5. The run lines and close (30 min)

- `node apps/vr/tools/run-bplink.mjs --mode editor --product kettle-web`: the brief and approve lines in the log.
- `node apps/vr/tools/run-bplink.mjs --mode game --bundle --product kettle-web` (after `bundle-data.mjs --briefs
  kettle-web`): the briefs come from `briefs.json`; remove the generated bundle afterwards (the committed Kettle bundle
  is unchanged).
- **L0's unpaired line** (`--mode game --bundle`, default product): the bundle line and `Kettle wings=5` print. A step
  that breaks it is reverted (desk-to-table plan, decision 1).
- `npm run check` green; ROADMAP: S4 status closed (F3 compiled, F9 resolved, D15 built or answered), the F rows
  updated. Push `roadmap/vr-build`, open the PR (CI `check:waves` has flaked once; rerun once before reading it as red).
- Stop the editor and the demo by their PIDs or `scripts/kill-port.mjs`, `ue-turn.mjs release`, restore the main
  checkout to master.

## Stop rules

- A compile error outside BpLink, BpDeck, BpMarks or the generated headers: stop and report, do not refactor the module.
- Never junction a directory a build writes into a worktree; UE builds only in the main checkout.
- Kill only PIDs this session started; never by image name (`scripts/guard-kill.mjs` refuses it anyway).
- No real stores: demo and temp stores only.

## After this session (not in it)

- Personas: the TypeScript wire to store v5 (D16); re-copy bp's shared-focus golden after the S6 follow-ups PR lands.
- S7 (Stop and Follow in the world, history, across products), with the owner sitting.
- The APK and BuildCookRun, when the owner lifts D13 (the competition closes 2026-11-18).
- Personas master's red CI (unused bindings, runner libraries, cargo-deny advisories): its own session.
