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
