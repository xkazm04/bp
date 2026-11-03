# Scope - Release Ledger, 2026-11-03

**Thesis.** The train still describes a branch-and-cherry-pick ritual nobody runs, while 44 accepted items have
already landed on master behind its back. Make the ledger see what landed. Judge each landed item on main as held,
short or unmeasured. Bring that outcome to the row where the next yes or no is given.

Council: codex gpt-6.1-sol and claude opus-5-5 (two families; the Google seat was unavailable on this machine).

## Core

- **C1 - See what already landed** (P01, P10's reconciliation; S).
  - **What it does:** `landedOf(log)` in `packages/core/src/scan` reads `Lens-Item:` lines anywhere in master's
    commit messages. It falls back to patch-id, and a later revert clears a landing. The result is derived on read
    and cached by the base sha, with no store write. Consumers:
    - the pre-flight gets a "landed" block;
    - the Package splits "landed outside a release" from "to cut";
    - Waiting-for-you leaves landed items out and names the failed item that is already on main;
    - the Kettle sim records a landing on sampleMerge.
  - **Verify:** bp at 63b2922 returns 45 landings. A temp-repo check covers four cases: a trailer, a trailer in a
    body paragraph, a cherry-pick with the message lost (patch-id), and a revert. `check:train-parity` stays green.
  - Anchors: track.ts:125-128, preflight.ts:28-51, release.server.ts:268-272.
- **C2 - Held, short or unmeasured on main** (P02; M; depends on C1).
  - **What it does:**
    - `trackOf` takes `TrackOpts.landed`. A landing time stands in for releasedAt, and the confirm rule is
      unchanged.
    - Chips Held / Short / Not measured since appear In packs.
    - A "Main now" line appears in Measurement.
    - M queues one scoped measure job per lens.
    - R on a short item prefills the rework note with the evidence.
    - record.ts and the Morning Watch count landed items through the same rule.
  - **Verify:**
    - On bp's store the chip counts equal trackOf's (seat reading: 20 / 7 / 17).
    - A check pins that the landed branch gives the same stage as the released branch on identical readings.
    - M queues exactly one job per lens.
- **C3 - The brief beside every backlog decision, by outcome** (P09, P06, P03 wording; M; depends on C1 and C2).
  - **What it does:**
    - precedentOf buckets the matched rows by trackOf stage: held, short, unmeasured, descoped, failed, declined.
      This also fixes descoped rows being counted as approvals (brief.ts:218).
    - Advice can reach "ask" when short is at least as common as held among 3 or more measured like accepts.
    - A focused-row drawer in the Backlog renders BriefFacts. `y` approves for later and `n` declines with a
      reason, through proposals/[id] and the intent store, with no job queued. The same drawer appears in pack
      judging.
  - **Verify:**
    - On a fixture shaped like bp's store, the precedent counts match trackOf, and a descoped row never counts as
      an approval.
    - pof (legacy, no landings) reads as today.
    - y and n survive a reload, signed.
    - J/K still re-renders 2 rows.
    - `BP_WRITES=off` hides y/n and the route answers 403.
    - check:decision-brief stays green.

## Supporting

- **S1 - Outcome by decider on the Trust panel** (P03; S; depends on C2). An Outcome column grouped by decider,
  showing held / short / unmeasured, with a rate only from n≥10 and judgement-method outcomes kept apart. A
  predictor line reads "predicted accept on 49 of 50; 6 not accepted". This is the number ROADMAP §7 says it needs
  before standing rules can be un-parked. **Verify:** on bp the panel equals outOf over the store, and the counts
  move after a measure run without code changes.
- **S2 - Release what landed: a Tag step** (P04; M; **cross-repo**, since lens-scan in ai-registry must take
  `--landed`).
  - **bp side:**
    - one step row, draft → tagged;
    - a RELEASE_STATE action reading "Tag v0.1.0 over N landed items";
    - a "landed" line in the notes, with the landing commit and the reading on main;
    - the sim implements the same row.
  - **lens-scan side:** check ancestry, run the gates on base HEAD, tag, and mark the items released.
  - **Verify:** with fake gh, a draft of landed items offers Tag instead of Build, and the job settles only at
    `tagged`. check:release-steps pins the row.
- **S3 - Ship a chosen slice, with age** (P05; S; bp only). Keyboard selection in the pre-draft Package, with the
  ids passed to createRelease. Acceptance age is shown from triaged_at. The version is suggested from the selection.
  **Verify:** on a 44-item fixture, choosing 3 makes a draft of exactly 3 and leaves 41 free. An unselected
  new-capability item does not force minor.

## Leaps

- **L1 - Every outcome earns its evidence** (P11, P08; L; **cross-repo**, since lens-scan measure must write
  commit_sha).
  - **What it does:**
    - An outcome case freezes the baseline, the target, the landing and the eligible readings.
    - Eligibility needs a compatible method and unit, and a measurement commit that contains the landing.
    - Items sharing one reading form one observation cohort, so it is not counted as several successes.
    - An owner-enabled checkpoint watch reuses the scoped jobs and the restart journal.
  - **Verify:**
    - A wrong-branch, missing-sha or changed-method reading cannot confirm an outcome.
    - Four items sharing one reading give one cohort.
    - Restart recovery queues no duplicate jobs.
- **L2 - Certify the exact snapshot a version tags** (P10; L; **cross-repo**, since a store membership seal and
  shared rehearsal are needed). A candidate manifest binds the target sha, the items, the landings and the gates.
  A landed, unlanded or mixed candidate is tagged at exactly the sha its gates tested, and the finish is
  idempotent. **Verify:** fake-runner fixtures cover all three candidate shapes. A retry never moves the tag.

## Left out

- **P07, rehearse before PR.** Nothing is left to cherry-pick.
- **P08 standalone.** Folded into L1.
- **P06 standalone.** Folded into C3.
