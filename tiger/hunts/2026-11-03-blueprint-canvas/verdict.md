# Verdict - 2026-11-03 blueprint canvas

Judge: claude-opus-5-5 (caller), blind on pool.md; premises checked at 4663536.
Council: codex gpt-6.1-sol@xhigh, claude opus-5-5@xhigh. Gemini skipped (agy on this machine lists no
Gemini 4; owner chose to run without it); Grok descoped by the owner (tiger 3.4.0).

## Premise checks

| id | premise | result |
|---|---|---|
| P01 | `lensAsOf` returns unmeasured for every past date; readings are dated | confirmed `timeview.ts:80-86`; bp's own store has readings on 3 dates (10-25, 10-30, 10-31), 522 of 523 metric pairs have >1 reading; Kettle: 566 events, 0 `lens-health` |
| P02 | `walk()` only flies the camera; no canvas live region | confirmed `Engine.ts:695-703`; aria-live exists only in companion, crossing, focus, ledger, ticker, toast |
| P03 | proposals carry metric + expected delta; clearPath ignores proposals | confirmed: 67/67 proposals in bp's store have both |
| P04/P10 | GA mode keyed to `payments-ga`; absent on live | confirmed `Engine.ts:777-778`, `constants.ts:41`; bp's map has no milestones |
| P05/P09 | trouble list cached by array identity while live scans mutate `f.trouble` in place | **confirmed defect**: `flags.ts:43-48` WeakMap + `live-health.ts:28-30` `Object.assign`; `applyScan` never replaces `P.features` (`live-feed.ts:90-94`); Overview counts memoized on `M.P` (`plan.tsx:155-159`). A feature that turns bad after load gets no flag and no count until reload |
| P07 | sample has 1 of 75 contexts with paths | not re-counted; the job (code review scoping) is adjacent, not the area's strength |

## Triage

| id | value | conf | effort | call | why |
|---|---|---|---|---|---|
| P09 (P05+P02) | high | high | M | **core C1+C2** | both seats converged on keyboard/trouble walking; carries a real defect fix and the recorded a11y deviation |
| P02 | high | high | S | in C2 | |
| P05 | high | high | S | in C1/C2 | |
| P01 | high | med-high | M | **core C3** | evolves "honest time"; data exists on live products today |
| P11 (P01+P06) | med | med | M | guard folded into C3 | its rule "replay from fresh inputs, never copy current overrides" is kept; criteria-pinning is left out (complex, hypothesis) |
| P03 | med-high | high | M | **supporting S1** (read side) | pure, checkable; the propose button needs a lens-scan skill change - out |
| P06 | med | med | M | **supporting S2** | compare two dates on unchanged geometry; best after C3 |
| P10 (P04+P08+P03) | high | med | L | **leap L1** | readiness for any selection works on live maps without milestones; no authoring UI |
| P04 | high | med | L | in L1 | milestone-only scope is absent on live maps |
| P08, P12 | med | low-med | L | dropped | authored acceptance sheets in browser storage; L1 gets most of the value from manifests alone |
| P07 | med | low | M | dropped -> backlog | different job; mapping coverage unproven |

Cross-seat agreement: keyboard/trouble walking (P02 + P05, fused by one seat as P09); readiness beyond the
sample milestone (P04 + P08, fused by both seats as P10 / P12); dated health (P01 + P06, fused as P11).
