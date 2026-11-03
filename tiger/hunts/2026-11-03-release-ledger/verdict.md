# Verdict - 2026-11-03-release-ledger

Judge: claude-opus-5-5 (caller session; same family as one of two seats). Read pool.md blind. Seats live:
codex:gpt-6.1-sol@xhigh, claude:claude-opus-5-5@xhigh. Skipped: agy:gemini-4-argon@high (model not on this machine;
`agy models` lists Gemini 3.8 Flash at best).

## The dossier was wrong, and round 1 corrected it

The brief said 44 accepted items "sit on pack branches never merged". A seat checked git and found them on master.
The caller re-checked at 63b2922:
- `git log master --format=%B | grep -o "Lens-Item: *[a-z0-9-]*" | sort -u | wc -l` gives 45.
- `git branch -a | grep -c pack/` gives 0.
- `git tag -l 'v*'` lists nothing.
- 86fb968 (#16) is p-9c4a44, still `failed` in the store.

So the last mile runs, but outside the train, and the train cannot see it. Every proposal that builds on this
fact stands on a verified premise.

## Triage

| id | premise | already | value | conf | effort | score | peers | note |
|---|---|---|---|---|---|---|---|---|
| P01 landed from git | true (verified above; preflight.ts:28-51 has no landed block; track.ts:140 says "awaiting release" forever) | no | 5 | 5 | S | 25 | 9 | foundation for everything below |
| P02 held / short on main | true (track.ts:125-149 confirms only `released` rows) | the rule exists, unreachable for landed rows | 5 | 4 | M | 12.5 | 7 | one owner of the rule kept |
| P09 brief with outcomes in the ledger (fuses P06+P03+P02+P01) | true (brief.ts:218 counts every non-declined row, descoped included, as approved; no ledger file references briefFor/BriefFacts) | brief exists elsewhere | 4 | 4 | M | 10 | - | best fusion: decision and outcome meet at the row |
| P06 brief + approve/decline in backlog | true | - | 4 | 4 | M | 10 | 6 | folded into P09 |
| P03 grade deciders by outcome | true (trust.ts, TrustPanel exist; 0 trust_events) | partial | 3 | 3 | S after C2 | 9 | 3 | peers low; kept as supporting because the §7 un-park question needs exactly this number |
| P04 release what landed (tag path) | true (0 releases, no tags; the cut path assumes unshipped commits) | no | 4 | 3 | M + cross-repo | 7.5 | 6 | needs lens-scan `--landed` in ai-registry |
| P05 ship a slice | true (VersionBox.tsx:66 calls createRelease without ids; actions.ts:111 takes ids) | the API exists | 2 | 4 | S | 8 | 3 | less urgent now that everything already landed; useful for a mixed release |
| P08 outcome watch | true (track.ts eligibility is time-only) | partial | 4 | 2 | L | 3.2 | 4 | merged into L1 |
| P11 outcome evidence chain (fuses P01+P02+P03+P08) | true (current measurements carry no commit_sha) | - | 4 | 3 | L + cross-repo | 4.8 | - | lead of L1 |
| P10 certified snapshot (fuses P01+P04+P07) | true | - | 3 | 3 | L + cross-repo | 3.6 | - | leap |
| P07 rehearse before PR | partly: nothing is left to cherry-pick | - | 2 | 2 | M + cross-repo | 2.5 | 2 | dropped |

**Clusters.**
- Both seats, independently, made "the train must see main" the centre. P01 came from one seat in round 1; the
  other seat fused it into all three of its round-2 proposals.
- Outcome on main: P02, P08 and P11.
- The brief at decision time: P06 and P09.

**Overruled peers.**
- P03 scored 3 from peers, but I keep it as supporting. The owner's own parked decision (ROADMAP §7) waits on
  exactly this measure. Built on C2 it costs little.

## Left out

- **P07, rehearsal.** Its premise has gone: the work is already on main, so there is nothing to cherry-pick.
- **P10 as core.** Its sealed-snapshot contract needs a store verb and shared execution in lens-scan. It stays a
  leap.
- **P08 standalone.** It is folded into L1 (P11), which keeps P08's checkpoint watch and adds commit
  eligibility.
