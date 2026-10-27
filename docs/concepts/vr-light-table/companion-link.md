# Companion link: the contract VR's BpLink uses

Spark companion-upgrade, 2026-10-26. bp's companion lives in bp's server (`apps/server`, `http://127.0.0.1:3100`, the
canonical process; one process serves the companion). The web app and the VR client are two faces of the same companion:
the same turns, the same tools, the same cards. This page is what the UE client (`BpLink`) needs to follow it. It is a
contract only: no UE code changes with it. The UE work is planned in [companion-lamp-plan.md](companion-lamp-plan.md).

The wire types are `packages/core/src/companion/contract.ts`. Every route is loopback-only (a GET needs a loopback `Host`;
a POST also needs `content-type: application/json`), and every refusal is `{ error }`.

## 1. Focus: poll for "look here"

The companion moves the person's attention with the `focus.show` tool. Each call becomes a `FocusCommand`:

```json
{ "id": "f_0mh2k3x9a01a3f2", "product": "kettle", "target": { "kind": "feature", "id": "kettle-boil" }, "say": "This one first." }
```

- `GET /api/companion/focus?since=<id>`: the commands after `<id>`, **newest first**, at most 20. Without `since` (or with
  an id the server no longer keeps), every kept command. Ids sort by time, so BpLink keeps the newest id it acted on and
  passes it back.
- Poll every 1 to 2 s while the lamp is awake. Act on the **first** element only (the newest); the older ones are history.
- `target.kind` is one of `feature`, `room`, `wing`, `decision`, `wave`, `release`, `ledger-row`, `lens`. The target is
  always explicit: the companion never says "the current selection". A kind VR cannot show yet (the ledger kinds) is
  skipped silently; `say` is the caption under the lamp.
- The commands live in the server's memory (the last 20): a server restart forgets them, and BpLink starts again with no
  `since`.

## 2. Turns: talk to the companion

- `POST /api/companion/turn`, body `TurnRequest` `{ conversationId?, product?, text }`. Omit `conversationId` to start a
  conversation; pass the `product` slug the person is looking at. The answer is Server-Sent Events, one `TurnEvent` per
  event (`start`, `text` deltas, `tool`, `tool_result`, `card`, `focus`, then one `end` with `outcome`
  `done | interrupted | failed`). A conversation that already has a turn running answers **409** `{ error: 'thread_busy' }`
  before any event: wait and retry, do not queue.
- If UE's HTTP stack cannot read SSE, post the turn and poll `GET /api/companion/conversations` (the conversation's
  `updatedAt` and `turns` move when the turn ends), then read the reply from it. Turns and conversations are owned by the
  runtime package (P1); this page names the routes, P1's route headers are their contract.
- The page-wide stream, `GET /api/companion/stream` (events `turn`, `card`, `focus`, `status`), is what the web app reads.
  BpLink may use it instead of the focus poll when it can hold an SSE connection.

## 3. The lamp's states

VR draws the same seven `LampState`s the web lamp does, derived the same way:

| State | When |
|---|---|
| `idle` | no turn running, nothing pending; also when the server cannot be reached (show nothing alarming) |
| `listening` | the person is speaking or typing to the lamp (VR's own input state) |
| `thinking` | a turn has `start`ed and no `text` has arrived yet |
| `speaking` | `text` deltas are arriving |
| `working` | a `tool` event is open (no `tool_result` for its `callId` yet), or a scan or build job runs |
| `pointing` | a `focus` command was just applied (hold it a few seconds) |
| `asking` | a `card` is `pending` (`GET /api/companion/cards`, or a `card` event) |

When two apply, the later row in the table wins, except `listening`, which always wins.

## 4. Cards: answered in the web app only (v1)

A GATED tool (dispatching a wave, building or finishing a release, proposing a policy) never runs on the companion's say
so. It files a card (`state: pending`), and only a person moves it: `POST /api/companion/cards/<id>` needs the
`x-bp-human` token, which the server gives only to bp's own web page (`Sec-Fetch-Site: same-origin`, `Sec-Fetch-Mode:
cors`). VR cannot send those headers, so **in v1 VR shows a pending card and says where to answer it** ("Approve it in
bp on your desk"); it never approves. A pinch-to-approve in VR needs its own human path (a paired-device token), which is
a design decision for the follow-up spark, not a header BpLink adds.

`GET /api/companion/cards` lists the cards newest first (at most 50). A pending card expires after 24 h.

## 5. What BpLink must not do

- Call a GATED tool's route directly (`/waves/<w>/dispatch`, `/releases/<id>/build`, `/releases/<id>/finish`): those are a
  person's decisions, made in the web app or under a policy the person granted.
- Fetch `/api/companion/human-token`; it answers 403 to anything but bp's page, by design.
- Resolve "the selected feature" on the server's behalf: send ids, receive ids.
