# Outcome - 2026-11-03-release-ledger

Run branch `tiger/release-ledger` (bp), lens-scan half on `tiger/bp-release-ledger` (ai-registry). Baseline gate at
63b2922: `npm run check` 141 / 141 in the builder worktree.

| item | commits | verify | notes |
|---|---|---|---|
| C1 See what landed | 9a0e0d7, 77439e1, d25bec8, 61bd668 | `node scripts/check-landed.ts --root <bp>` gives "45 (45 by trailer, 0 by patch-id); accepted 44, failed 1; p-9c4a44 (failed) on master as 86fb968". `check:landed`: 16 passed (trailer, body-paragraph trailer, patch-id, revert, plus edge cases). `npm run check` 142 / 142. Re-run by the caller. | Derived on read through `GET releases/landed`, with no store write. Computed, not seen in a browser: Package reads "0 to cut · 44 landed outside a release", and Waiting for you drops from 2 to 1. |
| S2 lens-scan half | ai-registry 823498d27 | lens-scan tests 121 / 121 (re-run by the caller). `gate.mjs --all` 26 / 26 (builder). | `release-update --status tagged --from building --landed`. Without `--landed`, building to tagged still refuses. `/lens-scan release --landed` tags base HEAD with no PR. lens-scan 1.15.0 |
| L1 lens-scan half | ai-registry 3a618c966 | Included in the 121 / 121. | Every measurement records `commit_sha` (SKILL §2, footprint/steps/harness). `latest` now returns `commit_sha`. |
| C2 Held / short on main | 345b110, 6367afe, ef5d14f, 42f23c3, 01f2360 | `node scripts/check-on-main.ts --root <bp>` reads Held 20 · Short 7 · Not measured since 17, matching the seat's reading. Short: p-af6b17, p-dfee71, p-24dd2b, p-8485a6, p-084b81, p-a3edc8, p-1e6e34. 6 of the 7 are judgement-method; p-dfee71's target (-10 jankFrames) is impossible. `check:on-main` 26 passed (re-run by the caller). `npm run check` 143 / 143 (builder). | The measure key is **E**, not M (M is the compare panel's screen mode). E stays live under BP_WRITES=off, because scans are live by rule. The Morning Watch gains a "landed" card; morningDeck became async. Not done: the plan's track glyphs still say "awaiting release". |
| S3 Ship a slice | f0a52ec, e07ffec (merged d14882c) | `check:release-slice` 24 passed: choose 3 of 44, giving a draft of 3 with 41 left free; 3 fixes suggest 0.1.1 and all 44 suggest 0.2.0. `npm run check` 143 / 143 (builder). Re-run by the caller. | J/K plus X/Space in the pre-draft Package. "accepted 4 d ago" ages. |
| S2 Tag what landed (bp) | 9e5888e, d870a93 (merged d14882c) | `check:release-tag` 16 and `check:release-steps` 74 pass; `check:train-parity` 103. `npm run check` 144 / 144 (builder). Re-run by the caller. | T means "Tag v… over N landed items". Fake gh and claude only: the real `--landed` run, and bp's first v0.1.0, have not been run. Tag also retries from `failed`. A mixed draft keeps Build. |
| S1 Trust by outcome | 3fe1c08, 1e727f9 | `check:outcome` 24 passed (re-run by the caller after integration). On bp after the L1 merge: agent:director 14 held · 5 short · 7 unmeasured · 1 out of bounds; human:kazdan 6 · 1 · 10, matching the seat's 6/1/10. Predictor: "accept on 49 of 49 predicted rows; 6 not accepted". | Grouped by `triaged_by`, with `decided_by` as a second list. A rate is shown only from n≥10 per method. 26 of 27 measured outcomes are judgement. Not built: the cross-repo `demote: short` trust reason. |
| C3 Brief by outcome | 43dbac3, b56c9b0, 96dbbfb | `check:decision-brief` 75 passed: descoped is never an approval; counts match trackOf; ask when short ≥ held. `check:ledger-intents` 26 held. pof's 51 briefs are unchanged. bp quality-lens brief: "You approved 10 of 10 … on main 3 held, 1 short (judged), 5 unmeasured". | Y approves for later and N declines (final) with a reason, with no job queued. The drawer shows in Backlog and in compare. b56c9b0 alone is red (check:ledger-intents case 8); the tip is green. The compare panel's element budget went from 110 to 133. The plan card and the Review brief still build without landings. The "2-row re-render" was not measured in a browser. |
| L1 Evidence chain (bp) | 891232d, c15667b, a7dd58b (merged 0177295) | `check:outcome-evidence` 39 passed (re-run by the caller). Wrong-branch, changed-method and unplaceable readings cannot confirm. 4 items on one reading form 1 cohort. An out-of-bounds target stays unresolved. The watch steps 95 → shortfall, 78 → met, 97 → regression. A crash and restart queue no duplicate job. On bp the split goes from 20/7/17 to Held 20 · Short 6 · Unmeasured 17 · Out of bounds 1 (p-dfee71). `npm run check` 146 / 146 (builder). | All 27 deciding readings are judged by time: no stored row has commit_sha until lens-scan 1.15.0 is installed. 23 cohorts, 3 of them shared. The watch lives in `.ai/lens-scan/work/bp-watch.json`, with checkpoints at 1/7/30 d. Not built: watching landed items that are not in a release; correcting a target with a signed note; retrying a refused checkpoint. |

**Integration (caller).**
- d14882c merged S3/S2: a doc conflict, resolved keeping both rows. Gate 145 / 145.
- 0177295 merged L1:
  - Conflicts in record.ts, package.json and actions.ts. The cache key `[landed, contains, bounds]` was moved into
    outcome.ts `trackAt`.
  - The text merged clean but broke on meaning three times:
    - 3bb9267 `test(decision-brief)`: L1's method rule made the C3 fixture's static readings on judgement baselines
      unmeasured. The fixture's baselines now match their readings.
    - c398603: an out-of-bounds outcome was tallied as "no expected value". The server brief and the Trust panel
      built their options from landings alone and still read 7 short. They now go through `evidenceOpts`.
    - 4dff7b0: a type gap on the brief row's words, plus contract-1 rev 7.
  - Final gate 147 / 147. A full-gate run once failed `check:scan-jobs` (the lens-draft 504 timing); it passed alone
    (245 / 245) and in the next full run.

The S3/S2 brief asked BP_WRITES=off to hide release controls. An existing owner rule (`scan/writes.ts`, pinned by
check:scan-jobs) keeps the Release tab live, and the builder kept it. The brief's constraint was the caller's error.

## Found while building

- docs/blueprint-ui.md:595 still says pack branches are "never merged to main" (C1 builder). This is doc drift; the
  real workflow lands items on master.
- c15667b fix(train): the client's landings parser dropped `ancestry`, so every reading with a commit would read as
  unplaceable. Found by the L1 builder in code introduced by this run.
- The L1 restart test caught a real double-queue: after a restart the job registry had not yet read its journal.
  Fixed inside a7dd58b.
