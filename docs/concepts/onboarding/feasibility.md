# Onboarding build-up: can the real pipeline drive the animation?

Spark `project-onboarding`, 2026-11-01. The contest `blueprint-buildup` (six seats, a pre-round so each took a different
approach) gave a shortlist of three build-up variants: **A1 Axonometric raise**, **B1 The outline becomes the building**,
**E1 Bubble diagram**. The owner's rule for choosing between them is this:

> the variant which would react closest to the prototype in code in real app would win; if the pipeline cannot push
> events, a preset fakes the onboarding as the fallback.

This page has three parts: the architecture check, the contract all three ports share, and how the check is run and
scored.

## 1. What the pipeline can tell the screen today

adopt-bp is a chain of steps. Each step leaves a file behind, and that file is the only signal a watcher can see. The
pipeline itself never emits events.

| Step | Kind | Leaves behind | When the screen can know | Granularity today |
|---|---|---|---|---|
| check | script, seconds | stdout JSON | step end | one |
| context map | script or LLM (if missing) | `context-map.json` | step end | one |
| seed | script, seconds | skeleton `app-structure.json`, `work/inventory.json` | step end | one (code tree only, no rooms yet) |
| **product tree** | **LLM, minutes** | `work/product-tree.json`, then `adopt.mjs tree` merges it into the map | **when the file is written** | **one burst: the whole structure at once** |
| events | script, seconds | `events.jsonl` (append-only) | step end | one (all dates) |
| measure | script, tens of seconds | `scan.db` runs | step end | one per lens |
| **judge** | **LLM, minutes** (one session: about 17 min for 34 features, LESSONS.md) | `work/judgement/NN.json` per batch of 8 | **per batch file** | **incremental**, but health only reaches the map after `adopt.mjs judge` merges every batch |
| register | script | `bp.products.local.json` | step end | one |

What the server already provides:
- `jobs.server.ts` runs `claude -p` in a product root with logs, a journal, cancel and orphan adoption.
- The SSE stream at `/api/products/[slug]/stream` sends `map`, `jobs` and store deltas. It only exists for a
  **registered** product with a store, and adopt today registers at the very end.
- There is no `adopt` job kind, and nothing watches `work/`.

**Verdict: feasible, with three backend changes. None of them is a rewrite.**

1. **Make the server the orchestrator, not the skill.** A new `adopt` job runs the deterministic steps itself
   (`adopt.mjs <step>`) and spawns `claude -p` only for the two LLM phases. Every step boundary then becomes a `phase`
   event from code we own, not from a transcript we parse. The project is registered first (decided W1), so the
   existing stream route can carry the events. Alternatively a dedicated onboarding stream can be keyed by job id.
2. **An incremental product tree.** The Phase-A prompt writes one file per domain, `work/product-tree.d/<NN>.json`,
   followed by the merged file. The server watches the directory and emits one `structure` chunk per file, which lets
   rooms really arrive room by room. If this fails, the whole tree arrives in one `structure` chunk. Every variant must
   survive that case, and the `real` preset already plays it.
3. **Provisional health per batch.** For each new `work/judgement/NN.json`, the server derives the batch's `general`
   readings with core's own loader (the same rule the canvas uses) and emits a `health` event. The final
   `adopt.mjs judge` merge stays the authority, and the last `health` events restate it.

The fallback is the preset source, which is a finished plan replayed on a schedule. It is shipped now and is what the lab
runs on.

## 2. The contract (`apps/web/src/buildup/contract.ts`)

One event stream feeds every variant: `begin`, `phase` (start/done/failed), `structure` chunks (parents before
children), `history` (first-seen dates), `health` batches, `done` and `failed`. A variant draws only what has arrived.
`begin` resets it, which is how replay works. `begin.extent` is `null` on a live run, because the plan's size is unknown
until the structure lands. The preset sources implement the same interface:

- `preset-demo`: about 45 s, the tree arriving wing by wing (the pipeline after change 2).
- `preset-real`: about 2.5 min, today's pipeline shape. It has a silent 45 to 65 s product-tree step, then the whole
  structure at once, history at once, then health in uneven batches of 8. The extent is not announced.

Its timings are modelled, not measured, until step 3 below replaces them with a tape.

## 3. The feasibility check, and how the winner is chosen

1. **Port all three into the app against the contract** (lab route `/buildup?v=a|b|e&product=<slug>&source=demo|real`).
   Each port keeps its prototype's look and motion. Its data load and internal clock are replaced by the event stream.
   Each builder returns a reaction-gap list: every moment where the prototype relied on knowing something before the
   pipeline can know it (the extent, all rooms at once, dates during the tree, health per tile).
2. **Build the live source** (changes 1 to 3). Its first output is a **tape**: the timestamped event log of a real
   adopt run on a small repo, saved as JSON. A `tape` source replays it, so every variant can be watched under the real
   rhythm, repeatedly, without paying for another LLM run.
3. **Score each variant on the tape, against its own prototype**, at 1600x900 with frames at matched event times:
   - **Reaction latency**: the time from an event to the first visible change.
   - **Dead time**: the longest stretch with nothing new on screen during a real gap.
   - **Fidelity**: whether the frames still read as the prototype; the owner judges this, blind to the variant letter
     where possible.
   - **Gap count**: how many prototype behaviours had to be faked or dropped.

   The variant closest to its prototype under the real tape wins. If no variant holds up on the tape, the preset
   becomes the onboarding's face and the real run plays behind it.

Recorded deviations and open questions go to the idea note `.spark/Spark/ideas/project-onboarding.md`.

## 4. Port results (2026-11-01, step 1 done)

All three ports run on the preset sources in the lab, with typecheck green, `npm run check` 130/130, and no page or console
errors on a production build. Their ending frames match the prototypes. What the event stream changed, per variant:

| | A1 Axonometric raise | B1 Outline becomes the building | E1 Bubble diagram |
|---|---|---|---|
| Before the tree | empty table drifts, "waiting m:ss" | step log with real times, LLM step counting up | compass pen circles the sheet, rail clock |
| Structure all at once | plays as the prototype's opening, then rooms at its demo pace | queued and typed at demo pace (capped at 36 s) | cluster packed, then drafted wing by wing (about 9 s for Kettle) |
| Structure per wing | wings rise as chunks land | typing starts at about 5 s, not 0.7 s; pof runs long | cluster re-packs and rescales per chunk |
| Lost to the stream | totals ("3/5 wings"), phase lengths | totals, measure progress, timeline seeking | domain draft order (the history reorder slide), run total |
| Behind at 4x/8x | queue compresses to 0.4x | paces from the events' `at` | lags, because the props carry no speed |

Open contract proposals:
- A pacing hint, either `speed` in the props or B's method of reading pace from `at` against the wall clock. E asked
  for this.
- An optional total count on the first `structure` event. A asked for it to restore "n/N".
- The product tree's domain order on `structure`. E asked for it.

## 5. Real speed: what a live run looks like, and how to keep the screen from going stale

Measured on the first real onboarding through the harness (`scripts/buildup/onboard-live.ts`), driving variant A. The
repo was dowser (266 tracked files, 181 source; its context map covered 11 of them), the run used claude -p with the
default model, on 2026-11-01, n=1. It took **16.3 min and cost $10.58**, and produced 5 wings, 16 rooms and 22 features.

| t | Step | What exists on disk | What the screen showed |
|---|---|---|---|
| 0-23 s | check, agent start | check output | empty table |
| 23 s | context map (LLM names unmapped code) | `work/context-supplement.json`: every code area with its files | empty table |
| 122 s | seed | map skeleton (28 code contexts) + `work/inventory.json` (files, lines, first/last commit per area) | empty table |
| 166-174 s | product tree (LLM) | `work/product-tree.d/NN-*.json`: the 5 domains, named, one file each (asked for in the prompt) | empty table |
| 275-283 s | tree merged, history, measure, batches | the whole plan, dated | the plan rises (fine) |
| 283-957 s | **judge (LLM, 3 parallel subagents)** | `work/judgement/03.json` at 597 s, `02` at 811 s, `01` at 913 s | **the same frame for 11 min** |
| 957-978 s | merge, register, report | health in the map, ADOPT.md | health lands, done |

The agent's own activity stream (stream-json) carried 166 tool calls, 20 to 30 a minute while judging, because the
subagents' calls are visible. Each call names the files it reads. The screen is stale in two places: **0 to 4.6 min**,
before any structure, and **4.7 to 16 min**, judging. The pipeline knows something new in both windows; it is just not
sent.

### Four more events, each read from something the run already writes

| Event (wire name) | Fields | Producer (what the server watches) | First available (run A) |
|---|---|---|---|
| `survey` | `areas: { id, name, files, lines \| null, first \| null, last \| null }[]` | `work/context-supplement.json` + the map's code tree, then `work/inventory.json` (re-sent, merged by `id`) | 23 s, enriched at 122 s |
| `outline` | `domains: { id, name, summary \| null, capabilities: string[] }[]` | `work/product-tree.d/*.json` (Phase A writes one file per domain) | 166 s, about 110 s before the boxes |
| `activity` | `area \| null, path, verb: 'read' \| 'write' \| 'run'`, at most 1/s | the agent's tool calls (paths matched to survey areas by prefix) | 23 s onwards, continuous |
| `progress` | `phase, n, of, detail \| null` | judgement files per batch, measure runs per lens | judge: 597 / 811 / 913 s |

Together with change 3 (provisional health per judgement batch), the judging window gets three real health updates,
not one at the end. All four are additive. A variant that ignores them still works, so the contract stays backward
compatible. The absent-value convention stays `null`.

### What each shortlisted variant would draw with them

- **A, axonometric:** `survey` chalks the code areas as lots on the light table, sized by lines. That is a site plan of
  the code, standing from 23 s. `outline` ghosts the wing names over the lots at 166 s. `activity` makes the survey
  plane pulse over the lot being read. While judging, `progress` sweeps the inspection rings over the batch's tiles,
  and each batch's health lands.
- **B, outline:** the column types the `survey` as a "site survey" section first, then the `outline` domains at
  166 s, which is the prototype's own idea arriving two minutes early. `activity` becomes the cursor line
  ("reading forge/src/core"). `progress` drives the judge header.
- **E, bubble:** the closest fit. A bubble diagram needs no boxes, so `outline` alone draws the domain bubbles at
  166 s, and `survey` can seed pencil dots per code area before that. Judging hatches each batch's bubbles as its
  file lands.

### All three runs (2026-11-01, dowser, one real onboarding per variant, disbanded after each)

| Variant | Run | Cost | Domains decided (`product-tree.d`) | Plan on screen | Judgement files | Health on screen | What the recording shows |
|---|---|---|---|---|---|---|---|
| A axonometric | 16.3 min | $10.58 | 166-174 s | 4.7 min | 597 / 811 / 913 s | 16.0 min | empty table for 4.6 min, then a frozen raised plan for 11 min |
| B outline | 16.3 min | $11.49 | 235-278 s | 4.7 min | 692 / 817 / 875 s | 15.7 min | step log only for 4.7 min, then the camera rests zoomed into half the plan for 11 min |
| E bubble | 14.9 min | $11.41 | 169-226 s | about 4 min (bubbles), 6 min (block plan) | 661 / 755 / 832 s | 14.5 min | the most movement early, then a frozen block plan for 9.5 min |

Every recorder session logged 0 page errors, and every disband left dowser clean at `414e6ed`. The judging window
(9.5 to 11 min, about two thirds of every run) is the same for all three variants, so the four events above are needed
whichever variant wins. Without them, no variant can be told apart from a stalled app for most of a real run. The
domain files arrive 40 to 110 s before the merged tree in every run, which supports change 2.

Recordings, stills (every 30 s) and tapes are in `.contest/arena/blueprint-buildup/runs/live/`. Each run is a
separate onboarding, so each variant drew its own product tree. The tapes are kept, so any variant can be replayed
against any run.

Harness: `scripts/buildup/onboard-live.ts` (run and feed), `scripts/buildup/record.py` (video and stills) and
`scripts/buildup/disband.mjs` (snapshot and restore of the test repo).
