# Territory dossier - swarm watch & steer

Commit: fbef86726d - written 2026-10-18

Area paths: `src/lib/model/sim.ts`, `src/lib/model/live.ts`, `src/lib/model/live-feed.ts`,
`src/lib/model/constants.ts`, `src/data/swarm.json`, `src/components/rail/**`,
`src/components/Overlays.tsx`, `src/components/Dock.tsx`, `src/components/BaseBar.tsx`,
`src/engine/render/{dynamic,simwatch,keyplan}.ts`, the swarm parts of `src/engine/Engine.ts`
and `src/engine/state.ts`, `swarmFromScan` in `src/lib/scan/client.ts`.

## Why this area

bp ("the product blueprint") draws a whole software product as an architect's drawing set. The
README's second sentence is the reason it exists beyond a diagram: "On top of the plan, a
simulated swarm of AI agents builds the product. People watch the swarm, answer its questions
where they arise, and steer it." (`README.md:3-6`). The owner's founding brief for the design:
"Imagine behind blueprint swarm of agents works and user just watches, targets places to decide
and control this way mass development of whole project from his expertize len"
(`docs/contest-history.md:50-54`). Two of the eleven user moments (morning watch, steering a
push) exist only because of it (`docs/research/users.md:124-129`). The operator chose this area
for the hunt over the live-product ledger and the canvas lens reading. Hunt evidence
(`tiger.mjs hunt`, 180 days): the area spans the "Data and live products" (heat 47) and
"Blueprint chrome" (heat 57) context groups; `src/lib/model` 59 commits, `src/components/rail`
25. The repo's history only starts 2026-10-09, so all of it is one week old.

## Who uses it, for what

Sample product *Kettle* (fitness-studio booking, 132 features, 13 domains) is built mostly by
agents and supervised by eight people (`docs/research/users.md:12-34`): Mara (founder, 2-min
visits), Dev (product lead), Tomas (engineering lead, supervises agents), Priya (SRE), Jonas
(security), Lea (design), Sam (sales, 20 s "while talking"), Ines (QA). Sam and Mara "must never
have to read an engineering term" (:36); Tomas and Priya want evidence, "not an adjective"
(:37-38).

The jobs (`users.md:92-129`):
- **Watch** - "The structure stays still; the work moves over it." Activity, waiting and failure
  visible at every zoom without making the plan unreadable (:100-103). 42 agents in 8 crews;
  "Nobody here manages agents one by one" (:95-97).
- **Target** - pick a wing, room, bay, feature or lasso; look closer, ask "what is going on
  here", pause/resume, change priority, set a standing order (:104-106).
- **Decide** - 25 open decisions, each tagged with a lens and a decider, 2-3 options with
  consequences, a recommendation, wait time, agents blocked. Jonas sees his 5 without Mara's 7.
  "Deciding should take seconds, in place, with the consequence visible on the structure"
  (:107-112).
- **Standing orders** - scoped to a place or everything, visible where they govern; a violation
  shows where it happens (:113-115).
- **Mass control** - "see what that action will move" before committing, then see the swarm
  respond (:116-118). "Each person's lens is their control surface" (:120).
- **Moment 10, morning watch** - 5 min: "decide most of them in place, and leave" (:124-126).
- **Moment 11, steering a push** - Mara or Tomas, 15 min, the Money wing (:127-129).

Done well = seconds per decision, in place, consequence visible on the plan, per-person queue,
no engineering vocabulary for non-engineers.

## What it does today

**Simulation** (`SwarmSim`, `src/lib/model/sim.ts`, 645 lines). Agents, questions, orders at
`sim.ts:34-48`, steering previews `:51-60`. Sample: 8 crews, 42 agents, 28 questions, 8 orders,
a recorded hour of 419 events (`src/data/swarm.json`). `adaptSwarm` maps the swarm's short ids
to map slugs and adds the lenses each crew serves (`src/lib/data/sample.ts:35-61`). `?scale=N`
copies per product line (`sim.ts:152-167`). Clock: 09:00 2026-10-08, one hour
(`constants.ts:59`), speeds 1/8/60/240x (`constants.ts:58`), forward-only seek (`sim.ts:388`),
replay rebuilds (`sim.ts:394-400`). No RNG; FNV `hash01` (`sim.ts:80-84`). 16 event types
(`constants.ts:47-52`), five change state: move, commit, flag-change, task-done, decision-asked
(`sim.ts:336-350`).

**Answering.** `decide` frees waiting agents, sets them working, pulses touched features, keeps
one undo (`sim.ts:405-421`). Surfaces: Review flyout with lens filter, "Waiting for <person>" vs
"Everyone else" grouping, option buttons, accept-recommendation (`rail/wide/review.tsx:93-259`);
the decision card beside the feature tile with J/K (`Overlays.tsx:199-250`); keys 1-9 / Enter
(`Engine.ts:1179-1183`); feature page (`sheet/SheetBody.tsx:82-88`); phone (`Phone.tsx:42-70`).

**Steering.** Previews for push (`sim.ts:542-569`), pause/resume (`:570-581`), new order
(`:582-589`), pause research (`:590-598`); `commit` (`:599-621`); one undo slot (`:622-632`).
Selection bar with push/pause/resume/four order templates/"What is going on?" and an "ADDENDUM -
NOT ISSUED YET" preview (`Overlays.tsx:273-299`). Steer flyout: two presets, spend by crew
(`rail/wide/steer.tsx:13-107`). Orders flyout: breached first, "Show its places", order writer
(`rail/wide/orders.tsx:22-146`).

**Watching.** Agents flyout (crews, scan jobs, log; `rail/wide/agents.tsx:64-159`), hover cards
and ticker (`Overlays.tsx:58-131`), morning watch (`Overlays.tsx:436-479`), toasts with UNDO /
REPLAY / SHOW (`:422-425`), clock and hour histogram with arrival markers
(`BaseBar.tsx:53-215`). Canvas layers in `src/engine/render/dynamic.ts`: order zones
(:134-167), agents with trails and chips (:205-272), pulses (:277-291), question pins per room
and tile (:301-332), breach rivets (:334-346), preview arrows (:357-375), focused question
outlines affected features and draws lines to the agents it holds (:377-394), "+N back to work"
lines after an answer (:396-412). Key plan dots and flags (`keyplan.ts:30-42`).

**Live mode** (a real repo via the lens-scan store). `swarmFromScan` (`src/lib/scan/client.ts:324-379`):
one crew/agent per lens in the latest run, status from run state, progress = features measured /
in scope, open proposals become Approve/Decline questions with urgency from risk; no orders.
SSE deltas -> `engine.feed` -> `applyFeed` (`sim.ts:470-526`). Answers: optimistic `decideLive`
(`sim.ts:427-443`), POST to `src/app/api/products/[slug]/proposals/[id]/route.ts`, rollback on
error, 409 = "already decided elsewhere" (`sim.ts:449-463`). Proposals, decisions, run status
and activity are real; agent placement and "waiting" are inferred.

**What it does unusually well** - the council should evolve these:
1. **Questions live on the structure**: pins on tiles and rooms, outlines on affected features,
   lines to the agents each question holds, the card placed beside its tile
   (`dynamic.ts:301-394`, `Overlays.tsx:209-219`).
2. **The queue is personal and lens-shaped**: the person's/lens's questions first, ranked by
   urgency, then agents held, then wait (`sim.ts:219-249`); crews that don't serve the lens dim
   (`sim.ts:226-229`, `dynamic.ts:225`).
3. **Every steer is previewed on the plan before it applies, and undoable**
   (`sim.ts:542-632`).
4. **One UI for sample and real product**, with optimistic, rolled-back answers
   (`sim.ts:427-463`).
5. **Consequence made visible**: freed agents visibly go back to work (`dynamic.ts:396-412`).

## Measured state

Re-run at this commit by the caller's fact-gatherer (2026-10-18): `check:overlays` 11
expectations held; `check:live-health` 30 held; `check:release-train` 39 passed / 0 failed;
`check:timeline-keys` 85 held; `check:timeline-scrub` 33 held; `check:camera` 65 held;
`check:lens-health` 100% agreement. No `*.test.*` files exist; node check scripts are the gates
(`npm run check` -> `scripts/check-all.mjs`). No check targets `sim.ts` itself.

Performance (`docs/perf.md`, recorded 2026-10-09 / 2026-10-12, not re-run - needs a browser):
`?scale=4` with 168 agents at 8x: frame p50 16.7 ms, p95 16.7 ms, engine ~1.1 ms median; sim
updates reach the store at most every 250 ms; a sim-only loop draws ~30 fps; the static-raster
patch on sim ticks (~every 900 ms) is unmeasured. Budget: 60 fps at 1920x1080, `?scale=4`.
No `backdrop-filter` over the map (halved the frame rate).

Usage, decision latency, real-product swarm volume: not measured.

## Recent history

Repo history starts 2026-10-09 (58 commits touch the area, none are reverts).
- 10-09: foundation (`b11d8a0` - only commit ever to touch `swarm.json`), lens plugins, live
  products in the UI (`e2d471f`), UI overhaul with slim rail (`826cccd`).
- 10-09/10: scan-sweep fix rounds on rail, overlays, timeline, reduced motion.
- 10-12: perf - sim ticks patch the raster (`678e38e`), lazy Kettle chunk, memoised counters.
- 10-12..15: live readings in place, proposal card summary + Details, Find combobox, undoable
  toast, product switcher, right-click scans, workbench flyouts (`36c6126`), scan server.
- 10-15..17: the release-train ledger (separate area; not in scope).

**Rejected directions - do not re-propose:**
- Galaxy / star-system metaphors (`docs/contest-history.md:26-32`, `blueprint-ui.md:30-38`).
- Lenses that recolour nodes or retheme the whole UI at a readability cost (A/2 rejected,
  `contest-history.md:65-84`); lenses may reshape or use different icons; keep the blue/white
  palette.
- Small text for looks: nothing the user must read under 12 px; body 14 px.
- A separate Scans panel for live products, and CLI-only approval or an auto lane - proposals
  are decided in the Blueprint UI queue (`.spark/Spark/ideas/measured-lens-scans.md:108,118`).
- A ticket tracker / kanban; "Humans do not write or move tasks here"; charts detached from the
  structure (`users.md:133-139`).
- A column board or table for the workbench flyouts (chosen 2026-10-15, `blueprint-ui.md:499-520`).

## Known limits and open questions

Gaps the code shows (no TODO markers exist; read from the code):
- **The chosen option changes nothing.** `d.ans.opt` reaches only the toast and an agent's task
  text (`sim.ts:405-421`). The consequence promised in the options is not simulated.
- **User-written orders have no rule**, so they never breach (`sim.ts:272-279`); the preview line
  "Agents read it before their next task" (`sim.ts:587`) has no mechanism; author defaults to
  `'mara'` (`:613`).
- **Orders are barely evaluated**: breaches computed at build for O-1/2/3/5, re-checked live only
  for O-1/O-3 on flag-change (`sim.ts:270-363`); O-6/O-8 never.
- **Spend never moves** (`sim.ts:264`); pausing research does not lower it though its preview
  claims cap logic (`:596`).
- **Steering in live mode is unguarded and goes nowhere**: selection bar, Agents overview,
  `Engine.preview/commit` (`Engine.ts:808-823`) and `sim.commit` have no live check; the next feed
  resets status and location but not `paused` (`sim.ts:493-494`); nothing reaches the store. Docs
  admit it: "the next feed puts the agents back" (`blueprint-ui.md:414-426`).
- **Live decisions have no undo**; "agents held" is always 0 in live (`client.ts:364`); the decider
  is the placeholder "whoever reviews" (`live-feed.ts:21-28`).
- **Computed but never shown**: `morningStats().done`, `SimAgent.tpm`, `UIState.askAll`
  (`state.ts:48`), `UIState.crew` - the Agents flyout says the crew "lights up on the plan"
  (`agents.tsx:55-58`) but no renderer reads it.
- Key plan paints paused agents red (`keyplan.ts:34`).
- Single undo slots; no backward seek; synth commits seed on float sim time, so they vary run to run
  (`sim.ts:374-377`).
- Kettle-only tables: WING_DEFS, GA_MILESTONE, LATER_MILESTONES, BLAST_DEFAULT
  (`constants.ts:41-45`), Steer presets (`steer.tsx:13-16`), AWAY_SINCE (`constants.ts:61`).
- The app-structure v3 standard has no swarm, agent or decision events (`docs/standard/app-structure-v3.md`
  §10, :651-673); analysis says the swarm "comes from a separate feed later"
  (`docs/standard/analysis.md:62,289`). The lens-scan store accepts only proposal decisions from
  the blueprint (§15, :951-975).
- Open: what a real agent fleet (not lens-scan) would feed; whether orders and steers should ever
  reach a real store; what the decision a person makes should teach the swarm.

## Constraints

- Stack: Next.js + React + TypeScript; a hand-written canvas engine (`src/engine/`). Camera and
  sim clock never in React state; draw only when dirty; dynamic layers culled to the viewport;
  60 fps at 1920x1080 with `?scale=4` (`docs/blueprint-ui.md:147-170`).
- 12 px text floor on DOM and canvas; spatial stability is sacred - flyouts overlay the plan and
  never move it; decisions and orders name their lens.
- "The swarm is a simulation, and the UI says so." All product data is sample data (Kettle).
  Fixtures are regenerated by `scripts/`; never hand-edit a generated file.
- Live products must stay honest: never show a simulated effect as if a real store recorded it.
  The store's DDL and the app-structure v3 format are shared standards (`docs/standard/`); a change
  to them is a spec change, versioned.
- Any work that makes bp show another product must grep the Kettle-only tables and say how each
  behaves for a non-Kettle product.
- Gates: `npm run typecheck`, `npm run build`, `npm run check`. Windows: never two files whose
  names differ only by case.
- Out of scope: the release-train ledger, the lens expressions contest, the canvas plan raster.
- Standards this repo subscribes to (ai-registry software-engineering bundle) that govern this
  area: `fleet-orchestration` (the operator's medium is a work item and a decision surface, not
  chat; watching is a mode - the fleet must run correctly when the operator is absent),
  `hitl-approval` (decisions are records; approval binds to what was approved; gate fatigue is
  the failure mode - tier by consequence, batch the homogeneous, learn from verdicts; timeout is
  deny or hold, never proceed), `feed` (live arrivals respect the reader), `canvas-graph`. Read
  them at `../ai-registry/knowledge/software-engineering/` if your sandbox reaches it; it may not.
