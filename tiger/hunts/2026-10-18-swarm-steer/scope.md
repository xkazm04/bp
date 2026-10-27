# Scope - swarm watch & steer (2026-10-18)

**Thesis:** turn the swarm from a control surface that only *looks* like one into one whose
levers bind: what a person decides holds, what they write governs, and on a real product a
steer moves real work and stays on the plan until the product shows whether it paid off.

Council: 3 seats (Gemini 4 Argon, GPT-6.1 Sol, Claude Opus 5.5); Grok skipped (probe failed).

## Core

**C1 - Answers that act** (M; cluster A: P07 lead, P01, P12, P15, P17 - 3 seats)
Focus or hover an option and the plan shows what it would move: rollouts, agents moved or freed,
follow-up questions, orders it breaks or clears (owner named). Choosing it makes exactly that
happen; undo restores everything. Option effects come from a closed vocabulary in
`scripts/fixtures/gen-swarm.mjs` (regenerated, only what the consequence sentence says; others
narrative-only). One reducer drives preview, decide and undo; preview state is its own
`hlOpt`, not `S.prev`, so the selection bar and Enter are not hijacked. Breaches tracked by
difference so they can clear. Live: Approve previews only the proposal's expected delta,
labelled "expected".
Anchors: sim.ts:351-363, :405-421, :527-534; dynamic.ts:357-394; Overlays.tsx:237-242;
review.tsx:239-251; gen-swarm.mjs:57-83.
Verify: new `check:sim-answers` - every option with an effect: post-decide state == preview
(n/n); D-01 opt 0 -> PAY-09 100% + O-1 breach, opt 2 -> 0% and O-1 cleared; D-05 opt 0 moves
exactly 2 agents to BKG-06; D-10 opt 1 opens a security question for Jonas; undo restores every
field; t=0 breach counts unchanged.

**C2 - Orders that govern** (M; cluster B: P08 lead, P03, P17 - 3 seats; depends on C1's reducer)
The four written-order templates get rules applied to events in scope: `ask` holds rollouts at
10% and opens a question for the author; `hold` refuses moves and stops generated commits;
`review` gates progress on a review answer; `first` protects the place from push donors.
Overridden recorded events log "held by O-n". Orders are signed by the reader (refused with no
reader, never 'mara'). O-6/O-8 evaluated; spend accrues from agents' tokens/min so pausing
research lowers the burn. One question per (order, feature); toasts collapse above 60x.
Anchors: sim.ts:270-287, :330-363, :582-632; orders.tsx:70-146; dynamic.ts:134-167.
Verify: new `check:sim-orders` - `ask` on Studio operations at t=0 as priya -> exactly 3
questions (STU-06, INS-02, BKG-02) and all <=10% until answered (before: 25/50/50%, 0
questions); `hold` on a room -> 0 moves in and 0 generated commits (before >0); spend rises with
time and rises slower after pause-research; unsigned order refused; undo restores counts.

**C3 - Steer a real product** (M; cluster C: P09 lead, P02, P18 - 3 seats)
On a live product the selection bar offers real verbs behind the usual NOT ISSUED YET preview:
Measure here (selection scans per lens, slot arithmetic shown), Build what is approved here
(dispatch approved ids only - never approves), Stop work here (cancel jobs in scope). Sample-only
verbs (push, pause, resume, order) are hidden and refused on live. Live facts fixed: the decider
is the map's lens/domain owner when named; the proposal a waiting lens agent holds reports
holds 1; feeds clear stale `paused`.
Anchors: Overlays.tsx:286-301; Engine.ts:808-823; actions.ts:25-51,114; live-feed.ts:21-28;
client.ts:345-365; sim.ts:493-494; agents.tsx:210-224.
Verify: extend `check:scan-jobs` (fake CLI): Measure on 5 features -> N jobs with
scope.features = the 5; Stop -> cancelled; Build on 2 approved + 3 proposed -> 1 execute job over
exactly 2, the 3 stay proposed; with sim.live SelBar has no Push/Pause/Order and sim.commit runs
0 times; Kettle map routes security proposals to jonas (queueFor('jonas').mine > 0). Real-store
smoke via `scripts/scan-demo.mjs` (repo law).

## Supporting

**S1 - A live answer stays on its tile until it has evidence** (M; cluster D: P18 lead, P13, P20; pairs with C3)
After Approve, the tile keeps one marker derived from the store: saving -> approved -> building
(job) -> built on branch (branch reading labelled) -> released -> confirmed or not by a current
reading; survives reload; offers the next verb in place. One glyph per tile, a count per room at
overview. Anchors: client.ts:332-365; sim.ts:510-513; dynamic.ts:396-412; derive.ts:18.
Verify: new `check:live-tracks` - saving/approved/409 states survive reload; baseline 42, expected
+10, branch 46 -> "built on branch 46 (expected 52)", current stays 42; executing->failed marks the
same tile with no duplicate question.

**S2 - Blocker chains and crew focus on the plan** (S; cluster E: P04 lead, P19)
Re-key `blockedBy` through adaptSwarm (today it stays a short id that resolves nowhere); hover a
blocked agent / focus a question on a blocker -> conduit to the blocking feature with "holds N
downstream"; one click to its open question or a push preview. Selecting a crew in Agents lights
it on the plan (UIState.crew is written, never read). Key plan paints paused agents in neutral ink,
not red. Anchors: sample.ts:45-58; sim.ts:216-220; dynamic.ts:205-272; keyplan.ts:34; agents.tsx:55-58.
Verify: check - every blocked agent's `blk` resolves to a map feature (before: 0 of 4); D-21 card
shows 1 downstream blocked; S.crew='forge-1' dims other crews; paused fill != th.red.

**S3 - Morning watch resumes where each person left off** (S; P11)
Per-product, per-reader "caught up" cursor (browser-local); changes since it grouped by place;
open questions always kept; arrivals batch behind "New arrivals" without moving focus; works on
live products (AWAY_SINCE stays sample-only); an explicit incomplete-history state when the cursor
predates the 200-row window. Anchors: model/index.ts:38-46; Engine.ts:745-751; Overlays.tsx:436-472.
Verify: ack, add 12 events over 4 features, reload -> exactly 12 grouped in 4 places; 50 arrivals
leave focus/scroll unchanged; old cursor -> incomplete-history state.

## Leaps

**L1 - Keep an answer as a standing order** (M; P17 step 4, P05; depends C1 + C2)
"Answer and keep as an order" turns a verdict into a signed, scoped order whose constraint is the
chosen effect. Later questions it covers are still asked, with the order shown as the recommendation
(learn from verdicts, no auto lane); "Batch-decide N matching" for homogeneous low/medium items with
a multi-feature preview. Verify: keep D-26's answer as an order on BKG -> a later matching question
arrives with that option pre-recommended and is not auto-closed; batch of 3 low items decides 3 with
one undo; high-urgency items never batch.

**L2 - See the hour ahead before you commit** (M; P06, P15)
Deterministic synth commits (integer counter, not float time), backward scrub via rebuild + replay
of events and interventions, and a 60-min counterfactual on every steer/answer preview: "+X% by
10:00" ghost badges, end-of-hour spend delta, a dashed counterfactual histogram in the timeline.
Verify: 16 ms vs 500 ms steps to t=1800 -> identical state; seek(2400) then seek(600) == direct
t=600; previewGA projection positive on GA features, negative on later, computed in <5 ms;
?scale=4 frame p95 <=16.7 ms.

**L3 - bp becomes the permission gate for its headless Claude runs** (L; P10; spike first)
Execute jobs drop `--dangerously-skip-permissions` for `--permission-prompt-tool` (or a PreToolUse
hook): in-scope edits pass silently, `hold`-ordered places deny, everything else asks - as a pin on
the feature whose files it touches, holding the job's agent, answered Allow once / Deny / Allow for
this run here. Timeout = deny. Verdict bound to (job, tool_use_id, input hash). Verify: fake CLI
asks for an out-of-scope Write -> pin on the right feature within 2 s, agent waiting, holds 1; deny /
allow / timeout->deny; changed input asks again; execute args no longer contain the skip flag.

## Left out

- P14 delegation and P20 command journal (L): a durable swarm-control protocol and new
  persistence before the live verbs (C3) exist would be built on a guess. Revisit after C3 + S1.
- P02's dispatching of proposed items in a selection: `dispatch()` approves them - the auto lane the
  owner rejected. C3 takes approved ids only.
- P05's live coverage deviations as standing orders: conflates lens findings (the ledger's ground)
  with orders.
- P16 as one item: too broad to verify as a unit; its parts live in C2, C3, L1.
- P19's modelled dependency-satisfaction events: needs new fixture semantics; S2 takes its id fix and
  reverse index.
- P03's "Enforce on N breaches" remediation button: a stretch inside C2 only if it falls out of the
  reducer.
