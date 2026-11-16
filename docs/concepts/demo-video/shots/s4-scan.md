# S4. A scan: Glim flies room to room, findings land (1:05-1:29)

Script: [../scenes.md](../scenes.md#s4-a-scan-glim-flies-room-to-room-findings-land-105-129-headset-the-sample).

## Setup

- **Build:** the filming APK. The scan theatre (`BpScanTheatre.cpp`) has not yet been seen on the device with a
  person wearing it (headset-morning-check.md step 9): it must pass the dry run.
- **Data and link: the bundled sample, no PC.** The sample scan (`BpSampleScan.cpp`) refuses a table a server answers,
  so this scene is its own session: `node apps/vr/tools/quest-tether.mjs --remove`, force-stop, launch. The console must
  say SAMPLE. (A live scan of the demo project would avoid the switch but has not run with the theatre: D6 in
  readiness.md.)
- **Settings:** `bp.ScanTheatre 1`, `bp.ScanVoice 1`, captions on, `bp.SampleScanMaxS 40` (the default; 24 to 30 makes
  the walk fit with no speed-up, decide in the dry run). STUDIO.
- **Pose:** seated, the whole site plan in view (thumbstick click is controllers: instead BACK until the whole plan
  shows, or `BpView.Seat`). The wall in the top of frame, the table in the lower two thirds.

## Steps

1. Recorder on. MENU > SCAN by hand. SCAN THIS once (PRESS AGAIN), then again.
2. Keep the head still and slightly raised so Glim's flights and the table stay in frame.
3. At the end the SCAN RESULT sheet arrives on the wall; point at DECIDE THEM and pinch. Stop.

## Takes to get

- 3 full takes. 1 take with the head following Glim (a more lively cut-in). A close take of one finding dropping onto a
  room (lean toward the table).

## What can go wrong

- The scan is refused (the table is linked): unlink and relaunch.
- A stop-ship pin lands in the usual colour (known on the PC): acceptable; do not caption severity.
- The walk is too long: lower `bp.SampleScanMaxS` before the take rather than speeding up in post, so Glim's flights stay
  natural.
- Glim's room caption is too small at 1080p: the transcript caption carries "Reading Billing, 3 of 13"-style lines only
  for the first two rooms.

## Post

- Real time if the walk fits 16 s; else ×1.5 to ×2 on the walk only, tagged "×2". Keep the start and result lines at real
  speed. Hard cut out on DECIDE THEM.
