# Tiger backlog - bp

## From 2026-10-18-swarm-steer ([run](hunts/2026-10-18-swarm-steer/verdict.md))

Kept, not chosen:
- **L2 See the hour ahead** (P06, P15): deterministic synth commits, backward scrub, 60-min counterfactual on every preview. Peers rated low; judge kept as a leap.
- **L3 bp as the permission gate for headless Claude runs** (P10): drop `--dangerously-skip-permissions` for `--permission-prompt-tool` / PreToolUse hook; asks pinned on the feature whose files they touch. Spike the flag first.
- P14 delegate a place with enforced orders, P20 command journal for live steers - revisit now that C3 + S1 landed.

Found while building:
- O-8's fixture contradicts its rule: "Auto-written class descriptions" is at 25% in production at t=0 yet the fixture records 0 violations (C2).
- O-6 is detected, not enforced - "stops the rollout automatically" could become a hold (C2).
- Unfinished live tracks (unknown / not confirmed) have no age cutoff; a large store with old releases could crowd the plan (S1).
- The live activity window (200 rows) is now copied in three places (client.ts, store.server.ts, morning.ts LIVE_ACTIVITY_KEPT) (S3).
- M3 is hard-coded as the sample's `multi-location` milestone - one more Kettle-only constant (C2).
- Room "N tracked" count at overview is not clickable (S1).
- `USD_PER_KTOK = 0.01` is an invented sample price (C2).
- The swarm fixture has no question pairs that share lens + scope, so precedents only show through written orders (L1).

## From 2026-11-03-blueprint-canvas ([run](hunts/2026-11-03-blueprint-canvas/verdict.md))

Kept, not chosen / left out:
- **P07 Changed files onto product impact**: paste a file list, see mapped and downstream features. A different job; mapping coverage is unproven.
- **P08 / P12 Authored acceptance sheets with evidence chain**: L1 covers readiness from the manifests alone; authoring and the projected/branch/observed ledger remain.
- **P11 Criteria vs measurement attribution**: pin a rule and compare old vs new criteria across two dates.
- **P03 "Propose a fix for this step"**: needs `/lens-scan` to accept a feature scope and a target.

Follow-ups found while building:
- **Replay pays off only with dated judged fields** (C3): bp's store replays 0 of 147 pairs because built-in lens rules read hand-judged fields (`performance.budgetMet`, `design.a11y`, `security.review`, `quality.status`). Have lens-scan write those fields as dated readings.
- C2: Tab access to a room's tiles (from P02); an on-screen route indicator; a room sentence that says "in trouble" twice under a lens.
- L1: the evidence age is fixed at 30 d (`readyMaxAge`), not a control; there are no counts on room labels or numbers on flags.
- S2: compare marks are drawn on tiles only, not on ribbon segments.
- S1: chips do not link to the proposal (the only existing link, `openTrack`, opens behind the page).
- `scripts/overlays-loader.mjs` breaks on a long arrow function in a JSX attribute.
- The browser gate cannot run from a builder worktree (`next build` and a `node_modules/next` junction). No visual or perf.py check has been run on this run's UI.

## From 2026-11-03-release-ledger ([run](hunts/2026-11-03-release-ledger/verdict.md))

Kept, not chosen:
- **L2 Certify the exact snapshot a version tags** (P10): a candidate manifest binding target sha, items, landings
  and gates; tag exactly the tested sha; idempotent finish. Needs a store membership seal in lens-scan.

Dropped: P07 (rehearse before PR): nothing is left to cherry-pick.

Follow-ups found while building:
- **Ship lens-scan 1.15.0**: ai-registry branch `tiger/bp-release-ledger` (823498d27, 3a618c966) is unpushed.
  Until it is installed, no measurement carries `commit_sha`. L1's ancestry rule then never runs on real data, and
  all 27 deciding readings on bp are judged by time.
- **bp's first real release**: Tag v0.1.0 over the 44 landed items has only run on fake gh and claude.
- The plan's track glyphs, the plan card and the Review brief still build without landings, so they read "accepted
  · awaiting release" (C2, C3).
- `useTrain()` fetches landings once per caller, about 6 per ledger render (C1, C2). The server caches them; share
  the answer client-side.
- A watch attaches only to a release, so landed items with no release cannot be watched. A refused checkpoint scan
  is not retried. Correcting an out-of-bounds target with a signed note is not built (L1).
- The cross-repo trust reason `demote: short <id>` for store.mjs `trust` (S1).
- The brief's 120-char line can cut the "descoped N" tail when a tier and an outcome clause are both present (C3).
- The decision-brief golden has no outcome case; add one together with Personas (C3).
- 6 of 7 short items on bp are judgement-method readings; whether they are judge noise is not measured (C2).
- docs/blueprint-ui.md:595 still says pack branches are "never merged to main".
- `check:scan-jobs`' lens-draft 504 timeout assertion failed once under full-gate load and passed alone.
