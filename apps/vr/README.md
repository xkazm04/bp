# apps/vr: the VR Light Table client (placeholder)

This folder will hold the Unreal Engine 5.8 project for bp's VR channel: a PC-tethered Quest 3 app
with Meta XR v207 and the Meta Interaction SDK, drawing the product at a backlit light table
(`docs/concepts/vr-light-table/`).

Nothing is here yet, on purpose. Unreal is not installed on the machine this was laid out on, and
the project is created in phase P3 (WP3.1) on the GPU workstation, after P0 has installed UE 5.8.2
and the Meta plugins (mage-arena-vr's `apps/vr/tools/install-xr.ps1`, adapted to this folder). Do not
add a `.uproject` by hand.

What the client will consume, already in this repo:

- `apps/server`: the product over HTTP and SSE (`npm run server`, `http://127.0.0.1:3100`), the same
  handlers apps/web mounts (`packages/core/src/server/api`).
- Kettle, read-only, with no product registered: `GET /api/products/kettle/structure` answers
  `{ structure, events, rev }` from `packages/core/data` (13 wings in `structure.domains`, rooms and fixtures in
  `capabilities`/`features`, the 8 lens manifests in `structure.lenses`, the event log in `events`). Kettle is not in
  `GET /api/products`, and every write route answers it 405.
- `packages/schema`: the app-structure v3 JSON Schemas and the UE `USTRUCT` headers generated from
  them, so `FJsonObjectConverter` fills the structs with no hand-written parsing.

It never computes a health rule or a layout rule; those stay in `packages/core`.

## BpLink contract

The requests the `BpLink` module will make for Kettle, against `apps/server` with no products file. `npm run check:bplink`
(`scripts/check-bplink.mjs`) starts the server and guards each answer; the counts are read from `packages/core/data`.

- `GET /api/products/kettle/structure`: 200 JSON `{ structure, events, rev }`, `structure.domains` = the wings,
  `structure.lenses` = the lens manifests.
- The events BpLink reads: the `events` string of that payload (JSONL, one valid JSON object per line, the same lines as
  `kettle.events.jsonl`).
- `GET /api/products/kettle/stream`: 405 with a JSON `error`, not an SSE stream. Kettle has no live stream, so BpLink's
  fallback is to read `rev` once from the structure payload (it is stable across reads).
