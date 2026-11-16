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

### The four events, built and replayed (2026-11-02)

The contract carries `survey`, `outline`, `activity`, `progress` and `health.provisional` (commit 6850c10).
`scripts/buildup/derive.ts` reads them from the files the run already writes; `onboard-live.ts` sends them and copies
those files into the tape; `scripts/buildup/replay-tape.ts` plays any tape as a live feed (17c1ccf). All three variants
draw them (c794bdc A, ead3bfd B with the camera fix, e505c45 E), and the demo source looks as it did.

The three tapes above predate the events, so the replay re-derives them, with two approximations: the code areas come
from dowser@414e6ed rebuilt in a throwaway clone (17 folder-named areas, `dowser-414e6ed.docs.json`), not the 28 the
runs' model named; and each provisional batch is the final readings split into eights, since the tapes did not keep
which features were judged together. A tape recorded from now on needs neither.

Each tape was replayed at 1x through all three variants at once (9 recordings, 0 page errors, in
`.contest/arena/blueprint-buildup/runs/replay/tape-<run>/<variant>/`, side by side in `compare-tape-<run>.png`).
Every variant now shows true progress from 23 s: A traces code lots on the table and pencils the wings over them, B
types a site survey and the domain outline in its column, E sketches code-area circles, then domain bubbles. During
judging each shows the batch count, the area being read and pencil readings that ink at the end.

The silences are shorter, not gone: during judging the subagents' tool calls are sparse, and the longest gap with no
event at all is 88-111 s depending on the run (measured on the replayed event lists). Each variant keeps a calm idle motion there (A a light line, B a breathing
cursor and ticking clocks, E a circling pen) and shows no invented number. Both A and E's builders asked for one more
link: which code areas each wing or feature covers, so activity could light the feature being judged, not a code area.

## 6. First real onboarding through the app (2026-11-02)

B won (contest verdict B/1); A and E are removed. The flow is built: `/projects` (add, manage, remove with purge), the
server `adopt` job with its build-up journal and SSE feed, and `/projects/<slug>/onboarding` playing B live, ending
with "Open blueprint". One real run on dowser@414e6ed, driven through the UI by Playwright and recorded
(`.contest/arena/blueprint-buildup/runs/e2e/`: video, stills, the job's journal and log), n=1:

| t | event |
|---|---|
| 13 s | Add project, Check, Start onboarding -> the onboarding screen |
| 42 / 122 / 133 s | survey, enriched twice |
| 132 s | seed (24 code contexts) |
| 255 s | outline (5 domains) and the structure **in the same second**; history at 257 s |
| 447 / 909 / 944 s | judgement batches, provisional health each |
| 993 s | final health (1 in trouble), register 1014 s, done 1044 s; "Open blueprint" band at 1058 s |

17.4 min, $11.00, 5 wings, 14 rooms, 17 features, 0 page or console errors; the blueprint opened on the new product.
The longest stretch with no event was 135 s (773-913 s, judging), 120 activity events in all.

Finding: with adopt-bp 1.5.0 the model wrote all `product-tree.d` files in one burst just before the merged tree, so the
outline arrived with the structure and bought no lead time (the test harness's prompt, which asked for the files
explicitly, got 40-110 s). The skill's wording needs to make the per-domain write happen as each domain is decided, or
the server needs another early signal of the domains.

## 7. Second real onboarding: narration with a real model (2026-11-02)

Same repo (dowser@414e6ed), same UI flow and recorder, adopt-bp **1.6.0** (per-domain `product-tree.d` writes and
`work/progress.jsonl` narration), n=1. Recording, stills, journal and log: `.contest/arena/blueprint-buildup/runs/e2e-narrate/`
(git-ignored, kept for the demo).

| t | event |
|---|---|
| 10 s | onboarding screen |
| 21 s | first narration ("context map covers 11 of 181 source files, drafting a supplement") |
| 22 / 60 / 68 s | survey, enriched twice |
| 111 / 116 / 121 / 125 s | outline, **one domain at a time**, each with a narration naming the next |
| 182 s | structure (4 wings, 11 rooms, 15 features); history 188 s |
| 202 s | both judge batches dispatched in parallel (two narration lines in the same second) |
| 778 / 901 s | provisional health per batch; final health 931 s |
| 968 s | done; "Open blueprint" band at 979 s |

16.1 min, $9.67, 0 page or console errors. 27 narration lines, 97 activity events. The outline now leads the structure
by 57-71 s (it arrived in the same second in section 6), so the burst finding above is fixed by the skill. Longest
stretch with no event: 83 s (818-901 s, judging), down from 135 s.

Finding: judge batches run in parallel, so `progress.n` counts batches **landed** ("0 of 2 judged"), never the batch
being worked on. A surface that shows it as "batch n of N" misreads it.
