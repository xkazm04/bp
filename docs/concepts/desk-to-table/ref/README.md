# Reference shots: the light table look and the crossing

These are the pictures the port is held to (`../plan.md`, W2). Look at the matrix side by side with them after any
change to the canvas's look or to the crossing: run `python scripts/shots.py <base> <out>`, then compare its
`table-*`, `crossing-dark` and `subtle-*-L0` shots with the files here.

| File | What it is |
|---|---|
| `winner-compare-l0.jpg` | the hackathon's site plan: web before, web after, the real VR table (UE capture), side by side |
| `winner-compare-room.jpg` | the web room against the VR room mode |
| `winner-crossing.gif` | the whole crossing as an animation: the arming card, the ten states and the closing card |
| `winner-crossing-s0.jpg` ... `winner-crossing-s9.jpg` | the crossing's ten states at 1600x900, in order: desk, armed, blackout, passthrough, claimed, lift, fade, arrived, table leads, headset off |
| `ported-room-dark.jpg` | master after W0 (`17f57a3`): Scheduling & Classes at the room, dark |
| `ported-bay-light.jpg` | the same at a bay, light theme |
| `ported-table-card.jpg` | the rail's "Take it to the table" card, unarmed |
| `ported-crossing-fade.jpg` | `/crossing` at "Room fades" (t 2.0), with the real UE capture in the panel |

The `winner-*` files come from branch `hack/a2-desk-table`'s `.hack/shots/` (2026-10-28), converted to JPEG at quality 85.
The `ported-*` files come from `scripts/shots.py` on master after the port. Inside the crossing, the stage is a web mock
of what the APK would draw; the only Unreal pictures are the ones its panel marks REAL.
