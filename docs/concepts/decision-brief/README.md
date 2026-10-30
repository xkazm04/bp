# Decisions with memory: the decision brief

**The as-built record** of hackathon bp-sync-1029's entry e2, fused into the Morning Watch (PR #9, `51e193e`; the
morning side is [`../one-morning/`](../one-morning/README.md)). What comes next is planned in
[`../one-morning-brief/ROADMAP.md`](../one-morning-brief/ROADMAP.md), not here.

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
| VR (BpLink) | `GET /api/products/<slug>/proposals/<id>/brief` → `FBpDecisionBrief`, generated from `packages/schema/schema/decision-brief-1.schema.json` | See "VR" below: the table's card is built (the fusion); the room deck (BpDeck) and the offline `briefs.json` are not. |
| Personas | the same function over its own `BlueprintData` | See [personas-adoption.md](personas-adoption.md): **not built** (Personas is read-only tonight). |

## Sync: why the readers cannot drift

- One function in core; web, apps/server, the MCP door and the routes all import it. The browser's map read and the
  server's raw read are pinned equal on Kettle (`check:decision-brief` case 14).
- One wire: `decision-brief-1.schema.json` is normative. `generate.mjs` makes BpLink's `FBpDecisionBrief` from it, and
  `parity.mjs` fails `check:schema` when the hand-written `Brief` and the schema disagree on a field.
- One golden: [golden.json](golden.json) holds fixed inputs and the exact briefs for six cases. bp's check fails when
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
4. **A pinch on DECLINE · REPEAT declines it in the store** (ROADMAP F8, the owner's call on 2026-10-30: "pinching decline
   should decline"; built 2026-10-30 on `roadmap/vr-s4-table-brief`). The hands find the card's two buttons by their painted
   boxes (`ABpTable::CardHit`, `CardAim`; `BpHands.Pinch card:decline`), and `CardTap` calls `FBpLinkModule::DeclineRepeat`:
   `POST /api/products/<slug>/proposals/<id>/decline {}` with `x-bp-device`. That route is the Morning Watch's own Decline
   (`steer`): the server takes it only when the card brief says the same idea was declined before, and writes `declined`
   with the brief's `Repeats <id>, declined <day>: "..."` through `decide`, plus a steering-log row. The card then moves on
   to the next open finding. Decline on any other card writes nothing (logged: the plan's free Decline, with the owner's
   own note, stays at the desk). Over the LAN the verb is the door's `decide` scope, granted only when the owner's
   approve names it. Held by `check:vr-decline` (through the real door) and `check:lan-door`. Captures:
   `../one-morning/vr-decline-card-before.jpg`, `vr-decline-card-after.jpg`.
   **A pinch on Approve approves it in the store** (ROADMAP D12, the owner's call on 2026-10-31: "Pinching approve in VR
   should approve the target decisions", superseding "Approve writes nothing"; built on `roadmap/vr-f3-approve`).
   `CardTap` calls `FBpLinkModule::ApproveDecision`: `POST /api/products/<slug>/proposals/<id>/approve {}` with
   `x-bp-device`, the Morning Watch's own Approve (`steer`): `approved` through `decide`, signed and noted `Morning Watch`
   as the web deck's, one steering-log row, and no job queued. The card moves on when the server answers 200, as after
   the decline; a 409 (decided elsewhere) leaves it. The room deck's Approve writes the same approve and still adds the
   finding to the draft wave. Same `decide` scope on the door. Held by `check:vr-approve` (through the real door).
5. **The room deck's decision screens carry the brief too** (F1): the five lines under the title, the quoted decline in
   amber; a repeat leads with DECLINE · REPEAT, which writes the store the same way (a plain Decline stays memory-only).
   Captures: `../one-morning/vr-deck-brief-repeat.jpg`, `vr-deck-brief-repeat-close.jpg`, `vr-deck-decline-after-close.jpg`.
6. **Offline** (F2): `apps/vr/tools/bundle-data.mjs --briefs` writes `Content/BpData/<slug>/briefs.json` (id -> the route's
   body), and BpLink's bundle path reads it, so the card draws the same lines with no server (Decline is refused there:
   no server keeps a decision). Opt-in: the committed Kettle bundle, which rides in the competition APK, is unchanged.

## Run it

The fused demo (the brief on the Morning Watch) is in [`../one-morning/README.md`](../one-morning/README.md) "Run it".
e2's own demo, on one product: `node scripts/scan-demo.mjs --reset`,
`node scripts/brief-demo-seed.mjs`, apps/server and the web on throwaway `BP_HOME`, then
`node scripts/brief-agent-demo.mjs` (a scripted agent, no model). `python scripts/brief-demo-rehearse.py` walks the
whole path headless and asserts it.
