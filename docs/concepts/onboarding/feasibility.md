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
