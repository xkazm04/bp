# Verdict - swarm watch & steer (2026-10-18)

Judge: claude-opus-5-5 (caller session; same family as one seat - read pool.md blind, seats
mapped only after this file). Pool: 14 round-1 proposals + 6 round-2 fusions from 3 seats
(agy gemini-4-argon, codex gpt-6.1-sol, claude opus-5-5); grok skipped (probe failed, unknown error).
Every anchor resolved (pool check).

## Premises checked in code

| claim | where | result |
|---|---|---|
| chosen option changes only toast + task text | sim.ts:405-421 | true |
| breachCheck can only add breaches; covers O-1/O-3 only | sim.ts:351-363 | true |
| user orders have no rule; author defaults 'mara' | sim.ts:272-279, :613 | true (dossier) |
| SimAgent.blk is never read by any renderer or panel | grep `.blk` in src | true (only written, sim.ts:494) |
| UIState.crew never read in src/engine | grep | true |
| blockedBy short ids (`PAY-14`) are not re-keyed by adaptSwarm | sample.ts:45-58, swarm.json:116,158 | true - P19's catch; P04 needs it |
| job verbs exist and do not branch sample/live | actions.ts:25-51,114 | true |
| dispatch() approves proposed rows | actions.ts:19 `DispatchResult.approved` | true - so P02's "dispatch proposed in selection" reopens the rejected auto lane; P09's approved-only rule is required |
| execute jobs run `--dangerously-skip-permissions` | jobs.server.ts:2,24 | true |
| live answered questions pruned after 10 s; back-to-work line 3.2 s | sim.ts:512, dynamic.ts:401 | true |
| decider overwritten to LIVE_DECIDER | live-feed.ts:26 | partly - it fills only when empty, but swarmFromScan never sets one, so effectively true |

## Triage (V value, C confidence, score = V*C / effort weight S1 M1.6 L2.5)

| id | title (short) | premise | V | C | eff | score | peers | cluster | call |
|---|---|---|---|---|---|---|---|---|---|
| P07 | preview + enact answers | true | 5 | 4 | M | 12.5 | 8 | A lead | keep |
| P01 | preview + enact answers | true | 5 | 3 | M* | 9.4 | 5.5 | A | fold (said S; it is M) |
| P12 | show what each answer changes | true | 5 | 3 | M | 9.4 | 7 | A | fold (honesty labels) |
| P15 | fusion: answers + projection | true | 5 | 3 | L* | 6 | - | A + F | fold: answer half into A, projection into F |
| P17 | fusion: one reducer answers+orders | true | 5 | 4 | L | 8 | - | A + B + E | fold: reducer design, breach-by-difference, "keep as order" without auto lane |
| P08 | written orders govern | true | 5 | 4 | S/M | 12.5 | 7 | B lead | keep |
| P03 | executable orders + remediation | true | 4 | 3 | M | 7.5 | 6.5 | B | fold (O-6/O-8 rules, dynamic spend, Enforce button as stretch) |
| P09 | live selection runs real jobs | true | 5 | 4 | M | 12.5 | 8.5 | C lead | keep |
| P02 | live targeting + desk routing | partly | 4 | 3 | M | 7.5 | 4 | C | fold decider routing, holds=1, paused reset; DROP dispatch-of-proposed |
| P18 | fusion: live answer stays on tile to evidence | true | 4 | 4 | M | 10 | - | D lead | keep |
| P13 | follow live answer to evidence | true | 4 | 3 | M | 7.5 | 5 | D | fold |
| P04 | blocker chains, crew focus, keyplan ink | true (with P19 fix) | 3 | 4 | S | 12 | 6.5 | E lead | keep |
| P19 | fusion: bottlenecks + resumption proof | true | 3 | 3 | M | 5.6 | - | E | fold id re-key + reverse index; defer satisfaction-event modelling |
| P11 | morning watch resumes per person | true | 3 | 3 | S | 9 | 5 | G | keep |
| P05 | decisions -> precedents, batch homogeneous | partly | 4 | 2 | M | 5 | 2.5 | H | fold into H without auto-settle; drop live coverage->orders (ledger owns findings) |
| P16 | fusion: govern everything | true | 4 | 2 | L* | 3.2 | - | B+C+H | dissolved into its parts |
| P06 | 60-min counterfactual + backward scrub | true | 4 | 2 | M | 5 | 2.5 | F lead | keep as leap (peers low; I overrule: the sim is pure and <1 ms per hour at scale 1, the determinism fix is a real defect, and "see what it will move" is a stated job) |
| P10 | bp as human gate for headless Claude runs | true | 5 | 2 | L | 4 | 6.5 | I | keep as leap, spike first |
| P14 | delegate a place with enforced orders | true | 4 | 2 | L | 3.2 | 3 | - | leave out (needs a durable control protocol before C lands) |
| P20 | fusion: command journal for live steers | true | 3 | 2 | L | 2.4 | - | C/D | leave out (new persistence; revisit after C and D) |

## Clusters - cross-seat agreement

- **A - answers that act** (P07, P01, P12, P15, P17): all 3 seats independently. Strongest signal.
- **B - orders that govern** (P08, P03, P17, P16): 3 seats.
- **C - live steering through real verbs** (P09, P02, P16, P18, P20): 3 seats.
- **D - live answer outcome on its tile** (P18, P13, P20): 2-3 seats.
- **E - blocker chains** (P04, P19): 2 seats.
- F, G, H, I single-seat or fusion-only.

## Reasoning

The council converged hard: today the area *looks* like a control surface but two of its three
levers are decorative - the option you pick does nothing, and an order you write does nothing.
On a live product, steering is worse than decorative: it moves fake state the next feed resets.
The scope therefore leads with making the levers real (A, B) and honest on live (C), then
lengthens the consequence trail (D, E, G), then offers three leaps that each reframe the area.

Design decisions made by the judge:
- A and B share **one reducer** (P17): preview, outcome and undo come from the same code, and
  breaches are tracked by difference so they can clear - without recounting (which would jump
  O-3's stamps 6 -> 27 at t=0, P17's measurement).
- Approval stays in the Blueprint queue: live "build here" takes approved ids only (P09), and
  "answer and keep as an order" (H) recommends rather than auto-answers - the owner rejected an
  auto lane (`measured-lens-scans.md:108`).
- Live never shows a simulated effect: answer previews on live draw only the proposal's own
  expected delta, labelled "expected".

When this hunt was judged, every seat proposed at least one leap. The council did not converge on
timid moves, so the dossier stood.
