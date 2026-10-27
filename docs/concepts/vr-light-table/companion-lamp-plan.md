# The VR lamp as the companion: wiring plan for the UE session

Status: **planned, 2026-10-26**, for the UE-focused session to take into its scope (Lynx, `apps/vr`, main checkout).

## Context

The web side of the companion shipped on master on 2026-10-26 (spark companion-upgrade):
- bp's own `claude -p` runtime, the brain and the bp MCP door
- the web lamp **Glim**

This plan wires the VR lamp to the same companion, so the headset and the desk are two faces of one brain: the same
turns, tools, cards and focus.

The wire contract is [`companion-link.md`](companion-link.md); read it first. This page orders the work, names the UE
hooks it lands on, and lists the decisions that are the UE session's to make.

**Supersedes.** This replaces the turn and card half of `lynx-plan.md` **L5.7**, which routed the lamp's states and cards
through the athena daemon (`/decisions`). The brain is bp's now. athena stays an optional second door (`athena-host.ts`,
whose `BP_TOOLS` derive from the same catalog), and remains a candidate for voice only (decision D1).

## What exists

**bp server (master).** All routes are loopback-only; the wire types are in `packages/core/src/companion/contract.ts`.
- `POST /api/companion/turn` returns SSE `TurnEvent`s. A conversation that already has a turn running answers 409.
- `GET /api/companion/conversations`
- `GET /api/companion/stream` streams `turn`, `card`, `focus` and `status` events.
- `GET /api/companion/focus?since=<id>` returns focus commands newest first, at most 20.
- `GET /api/companion/cards` lists cards; approving one is web-only (contract section 4).
- `GET /api/companion/find?product=&q=` resolves a name to a plan id.

The tool catalog, including `focus.show` and `plan.find`, is in `packages/core/src/companion/catalog.ts`.

**UE (master).**
- **BpLink.** `FBpLinkModule` polls scans and waves on `TickScanPoll`: `ScanPollBusyS` 0.5 s, `ScanPollIdleS` 4 s
  (`BpLink.h:135`). Its writes are `PostScan` and `AddToDraft`; it never dispatches. It reads the plan, structure and
  words.
- **The lamp code** is in `BpSwitch.cpp` / `BpTable.h:1281-1320`:
  - `FindLamp` and `PlaceLamp` locate and place it.
  - `SayLamp(Line)` sets a 6 s caption plate (`LampCaptionS`).
  - `LampYawToward` turns it.
  - `SetLampHold` fills a hold ring that asks for the next room.
  - `AskLamp(FeatureId)` gives a local one-liner built from the store.
  - `LampHead` is the hit sphere.
- **The mesh** is the static `SM_LampAgent`. A rigged skeletal version exists in `Content/Bp/Art/LampAgent/`: 6 rigid
  bones and 4 actions (asking, resting, speaking, working).

## Prerequisite (bp side, before UE work): one companion process

The companion's state is per process: the bus, focus history, cards cache and turn locks.
- The web page calls its own origin: `next dev` on :3000, or a `next start`.
- BpLink calls `apps/server` on :3100.

So a focus the web conversation issues never reaches the headset, and the reverse.

**WP-0: done, 2026-10-26 (the web track's landing).** Build the web app with `BP_COMPANION_URL=http://127.0.0.1:3100`
(the rewrite is fixed at build time). `apps/web/next.config.ts` then hands every `/api/companion/*` request to that
process (`docs/blueprint-ui.md`, "One companion process").

Proof, with apps/server on a scratch port and the page on another:
- A focus POSTed to the companion process moved the page's camera.
- A card POSTed to the companion process showed in Glim's hands.
- The page's Approve reached the companion process, through the human-token path.

The UE session runs the web app this way whenever it tests a desk-to-headset seam.

## Work packages (UE)

### U1. BpLink companion client (C++, BpLink module)
- **Focus poll.** Poll `GET /api/companion/focus?since=<last id>` on the existing tick: 1 s while the lamp is awake (a
  turn running, a card pending, or within 30 s of the person's last lamp gesture), else 4 s. Act on the newest element
  only, and keep its id. A server restart means a 404 or an empty list with an unknown `since`; start again with no
  `since`.
- **Card poll.** Poll `GET /api/companion/cards` on the same cadence and keep the pending ones.
- **Turns.** `PostTurn(Text, Product, OnEvent)` POSTs `/api/companion/turn` and decodes SSE incrementally via
  `FHttpRequest::OnRequestProgress64`. The fallback (D3): poll `/conversations` for the turn's end, then read the reply.
- **State.** Expose `FBpCompanionState { LampState, Caption, PendingCards, LastFocus, ConversationId }` and a delegate
  `OnBpCompanion`, the same shape as `OnBpScanState`.
- **Types.** Prefer generating the companion types through `packages/schema` (the repo's "logic once" rule) over
  hand-written JSON parsing; decision D4.
- **Must not.** BpLink never calls a GATED route (`/waves/<w>/dispatch`, `/releases/<id>/build|finish`) and never
  fetches `/human-token` (contract section 5).

### U2. Lamp states in the rig (BpSwitch / BpTable, art)
- **State map.** Map the seven `LampState`s to the lamp:
  - `idle` → resting
  - `listening` → resting with the head toward the person
  - `thinking` → working with a slow lens pulse
  - `speaking` → speaking, with the caption streamed into `SayLamp` (cap two lines, keep the newest sentence)
  - `working` → working
  - `pointing` → the head turns with `LampYawToward` and the reaching arm extends
  - `asking` → asking, with the head toward the deck
- **Derivation.** Use the same rule as the web host (`apps/web/src/components/companion/store.ts` `deriveLamp`): a
  pending card means asking, a fresh focus means pointing, and so on.
- **Mesh.** The static mesh can only turn and glow. D2 decides whether to switch to the skeletal lamp now.
- **Emissive.** The head glows by state; a warm lens is the companion's one warm note in VR too.
- **Budget.** Measure draws with the CSV profiler (overlay Gates), as the delta against a run with the lamp hidden.

### U3. Focus in VR (BpTable, BpLevels, BpDeck)
- **Mapping.** Map `FocusCommand.target.kind` to existing commands:
  - `room` → `SwitchRoom(id, TEXT("companion"))` (room mode)
  - `wing` → the level/wing entry `BpLevel.Enter` uses
  - `feature` → its room's mode, then `BpLevel.Highlight` on the glyph
  - `decision` → `BpDeck.Show` on that proposal's card
  - `lens` → `BpTable.Lens`
  - `wave`, `release`, `ledger-row` → no VR surface. `SayLamp("<say> - open it in bp on your desk")`.
- **Never move the view.** Room mode fades paper and deck; the camera never flies (VR comfort rule).
- **Gesture.** The lamp turns toward the target and speaks `say`.
- **Ids.** Product mismatch: a focus for another product than the open one only speaks, and never switches product. Ids
  come from `plan.find` or the companion's tools and match the plan ids BpLink already holds, the same ids
  `/plan?layout=islands` serves.

### U4. Talking to the lamp from VR
- **Gestures become canned turns.** These are the v1 input:
  - A held point on a glyph (today's `AskLamp`) becomes the turn "Tell me about feature <id> on <product>"; the local
    one-liner stays the instant answer while the turn runs.
  - The lamp hold-to-fill stays local (next room).
  - A new pinch on the lamp head becomes the turn "What should I look at first?".
- **Voice (D1)** is the only open question about free text in VR.
- **Conversation.** VR uses one conversation per session, kept in BpLink. The web app keeps its own; both share the
  brain.

### U5. Cards in VR
- Pending cards show on the deck glass, in the deck's existing card style, with the lamp in `asking`.
- In v1 there is no approve in VR. The card says "Approve it in bp on your desk", and the lamp follows it to
  `done`/`declined` through the card poll.
- A pinch-to-approve needs its own human path, D5.

## Decisions for the UE session (ask the owner, recommendation first)

| # | Decision | Recommendation | Alternatives |
|---|---|---|---|
| D1 | Voice input/output | **None in v1**: gestures become canned turns; spoken output stays captions. Voice is the next spark. | athena `/voice` websocket for speech in and out (the L10 checkout; Kokoro/Whisper not yet run on Lynx); Meta Voice SDK speech-to-text only |
| D2 | Lamp mesh | **Static plus emissive by state** in v1, which stays within the draw budget readings. | Switch to the skeletal rig (4 actions exist; adds an AnimBP and the pose budget) |
| D3 | Turn transport | **SSE via `OnRequestProgress64`**, with a fallback to the conversation poll. | Poll only; or `/api/companion/stream` held open for every event |
| D4 | Wire types | **Generate via `packages/schema`**, the same path as the plan types. | Hand-parse the six fields BpLink reads |
| D5 | Approving in VR | **Not in v1**: web-only, as the contract says. | A paired-device token (registry `device-pairing`) minted in the web app and scoped to card answers |

## Gates and proof (the overlay's apps/vr gates, plus these)

- **Build and Kettle line.** The UBT `bpEditor Win64 Development` build exits 0, and `run-bplink.mjs --mode editor`
  prints the Kettle line.
- **Focus seam smoke.**
  1. With `npm run server` on :3100, `curl -X POST localhost:3100/api/companion/focus -H 'content-type:
     application/json' -d '{"product":"kettle","kind":"room","id":"<from /api/companion/find>","say":"here"}'`.
  2. The editor PIE run switches to that room within 2 s and the lamp captions "here".
  3. Capture it from the target pose (PoF capture_viewport); the builder looks at the capture.
- **Turn smoke.** A held point on a glyph posts a turn; the lamp goes thinking → speaking, and the caption carries the
  reply. Check one ledger row in `$BP_HOME/companion/ledger.jsonl`.
- **Card smoke.**
  1. `curl -X POST localhost:3100/api/companion/cards -d '{"tool":"release.build","args":{"slug":"kettle","id":"r-x"}}'`
     shows the card on the deck with the lamp in `asking`.
  2. Approving it in the web page (on WP-0's shared process) returns the lamp to idle.
- **Staged exe.** Before calling it done: BuildCookRun, then `run-bplink.mjs --mode staged --exe <bp.exe>`. The uncooked
  run is not proof.

## Non-goals

- Changing the companion's runtime, brain or catalog from UE. A new tool goes through `catalog.ts` and its route.
- Dispatch or release build from VR.
- A second brain, or a VR-side prompt.
