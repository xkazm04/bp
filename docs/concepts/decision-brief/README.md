# Decisions with memory: the decision brief

Every decision in the Blueprint carries a computed brief, and every past decision keeps speaking. The person reads the
brief on the decision card and decides in one keystroke. Agents read the **same** brief through the `plan.brief` tool
before they propose, so a declined idea is not proposed again.

## One function, every reader

`packages/core/src/scan/brief.ts` `briefFor(subject, scan, map)` is pure. The subject is an open proposal or an agent's
draft (a feature and a few words). Its four facts each carry the ids that back them:

| Fact | From | Thin evidence says |
|---|---|---|
| **blast** - the feature, its room and wing, the features whose `depends_on` name it | the v3 map | `which is not on the plan: blast radius unknown` |
| **precedent** - decided rows of the **same idea** (the attempt/parent chain, the same external item, or the same proposal filed again on the same feature: identical idea words, numbers counted, the feature's own name aside, never opposite), a **like idea** (the same action - the title's first real verb - and most of the same words), the same standard, or the same lens and tier; approved vs declined | the store's proposals | `No precedent yet under <lens>` |
| **declined** - the matching declines (not merely same-lens), latest first, one per standard, quoted in the person's words | `decision_note` / `triage_note`, `decided_by` | (no line) |
| **undo** - an approval builds on a pack branch and ships only after triage and a release; a decline is final; after release by `risk_class` | the process, `risk_class` | `after release unknown (no risk class)` |
| **cost** - median minutes per item of finished execute runs under the lens, else any lens | `runs`, `packs` | `Cost: no build history yet` |

`advice` is `withdraw` only when a decline of the **same idea** stands: it flips the card to Decline, and a decline is
final, so it rests on identity, never likeness (three independent reviews showed every likeness rule also matches
different changes: "Hash passwords with bcrypt" / "... with argon2"). `ask` when a like idea or the same standard was
declined (shown in amber, *Like a declined idea*, Approve stays the default) or similar decisions were mostly declines
(3+); else `proceed`. `facts` / `lines` are the brief in plain words under a fixed budget, **5 lines of at most 120 characters**,
the one rendering every small surface shares.

## The doors

| Reader | Door | What it does with the brief |
|---|---|---|
| The person, web | the plan's decision card and the Review detail (`apps/web/src/components/Brief.tsx`), computed in the browser over the map and stream the page already holds (`briefMapOfStructure`) | Each fact opens its evidence. A repeat of a standing decline recommends **Decline** ("you declined this before"): Enter takes it, and the decline's note names the decision it repeats (`repeatNote`). A question's `affects` is its blast radius, so the plan's amber outlines match the brief. |
| Agents | `plan.brief` in `packages/core/src/companion/catalog.ts` (AUTO) → `GET /api/companion/brief?product&feature&title[&lens]` or `&id=` | Read before proposing; `withdraw` means do not propose it. `decision.recommend` answers with the proposal's brief and a `conflict` when an approval contradicts a standing decline. |
| The person, watching agents | the cards slip (`AgentTrail.tsx`) ← `GET /api/companion/trail` | "Was about to propose X; read your decline Y: '...' / Withdrew it / Then recommended you decline Z". |
| VR (BpLink) | `GET /api/products/<slug>/proposals/<id>/brief` → `FBpDecisionBrief`, generated from `packages/schema/schema/decision-brief-1.schema.json` | See "VR" below: **not built tonight**. |
| Personas | the same function over its own `BlueprintData` | See [personas-adoption.md](personas-adoption.md): **not built** (Personas is read-only tonight). |

## Sync: why the readers cannot drift

- One function in core; web, apps/server, the MCP door and the routes all import it. The browser's map read and the
  server's raw read are pinned equal on Kettle (`check:decision-brief` case 14).
- One wire: `decision-brief-1.schema.json` is normative. `generate.mjs` makes BpLink's `FBpDecisionBrief` from it, and
  `parity.mjs` fails `check:schema` when the hand-written `Brief` and the schema disagree on a field.
- One golden: [golden.json](golden.json) holds fixed inputs and the exact briefs for five cases. bp's check fails when
  `brief.ts` stops producing it; a port (Personas) runs the same inputs and must reproduce it byte for byte.

## VR (the BpLink decision card) - built in the fusion (2026-10-30)

The plan below was e2's; the fused branch builds it (`docs/concepts/one-morning/vr-brief-*.jpg`, rendered from the
table's target pose in PIE over the editor MCP):

1. `ABpTable::RefreshCard` (BpMarks.cpp) picks `Ask` (or `BpCard.Ask <id>`, the morning's decision), then
   `RequestCardBrief` fetches `/api/products/<slug>/proposals/<Ask->id>/brief` once per finding through
   `FBpLinkModule::FetchBrief`, parsed with the generated `BpSchema::FromJson(Json, FBpDecisionBrief&)`; a stale answer is
   dropped, and the card redraws when the brief lands.
2. The card draws `lines` under the header, at most 5 rows, the `declined` fact bold in a dark amber; the room's sketch and
   the body's Impact step aside, and the card grows 7 x 2.5 cm (by capture: the fifth line was cut).
3. When `advice.say == "withdraw"`, the header says REPEATS A DECLINE and **DECLINE · REPEAT** is the first, filled button
   (Approve outlined). The note it stands for is built from `declines[0]` exactly as core's `repeatNote`. A likeness
   (`ask`) shows the quote and keeps Approve first.
4. Not built: a pinch on the card's buttons writes nothing (the site card's buttons have no hit handler, and the table's
   only write is a draft wave, the owner's VR rule). Offline (the bundle) has no `briefs.json`: the card is as before.

## Run it

See `.hackathon/DEMO.md` in the entry worktree, or: `node scripts/scan-demo.mjs --reset`,
`node scripts/brief-demo-seed.mjs`, apps/server and the web on throwaway `BP_HOME`, then
`node scripts/brief-agent-demo.mjs` (a scripted agent, no model). `python scripts/brief-demo-rehearse.py` walks the
whole path headless and asserts it.
