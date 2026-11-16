# S3. Onboarding a project, web and VR split, sped up (0:28-1:05)

Script: [../scenes.md](../scenes.md#s3-onboarding-a-project-web-and-vr-split-sped-up-028-105). The composite:
[../capture-plan.md](../capture-plan.md#the-split-screen).

## Setup

- **The project (owner decision D1, D2 in readiness.md).** A dedicated demo repository whose names are safe to show: no
  brand, product or person names in its folders, packages or README, because the agent names wings and rooms from them.
  Not dowser (its onboarded plan names Jira, Rovo and Atlassian: `.contest/arena/blueprint-buildup/runs/e2e-narrate/`),
  not pof (Blender and other tool names). Kept at a neutral path such as `C:/demo/<name>` (the path is typed on camera;
  it must not hold a person's name).
- **Registry:** a scratch products file (`BP_PRODUCTS_FILE=<scratch>/products.json`), so the run never writes the real
  `bp.products.local.json`. The scratch file also lists `kettle-live` if S2 and S5 are filmed in the same server session.
- **The run:** a real adopt costs money and time (n=1 on dowser@414e6ed, 2026-11-02: 17.4 min, $11.00, 5 wings, 14
  rooms). A smaller demo repo should be faster; measure it in the dry run. Rehearsals use the free stand-in:
  `node scripts/buildup/fake-onboard.mjs` (a real server, the real adopt.mjs steps, no model, about 150 s at speed 1);
  today it clones only dowser, so it needs a `--source` option first (gap G2).
- **Server:** `npm run server -- --lan` from the repo root with the scratch registry (and, for a rehearsal, the env that
  `fake-onboard.mjs env` prints). The headset paired with **Onboard** ticked.
- **Web window:** a 960x1080 client area (the left half of the composite at 1:1, no scaling), dark theme, on
  `http://127.0.0.1:3010/projects`.
- **Headset:** linked, on `kettle-live`, STUDIO, the console closed. Recorder at 1920x1080.
- **Clocks:** the PC's clock and the headset's must agree to the second (both on network time); each capture's sidecar
  or file time gives its start.

## Steps

1. Start the web capture (`record-demo.mjs --name s3-web --window "<title>" --fps 30`) and the headset recorder.
2. **Sync mark:** on the web, click a room on `/?product=kettle-live` so the table flies there (both sides move on the
   same published place). Then go to `/projects`.
3. Add a project: type `C:/demo/<name>`, Check, review the proposed name and slug (on camera: the name must be clean),
   Start onboarding. The page opens the onboarding screen.
4. In the headset: MENU > PROJECTS, tap the new project (it shows BEING READ). The table clears and starts to draw.
   Rescue: `BpLink.Product <slug>`.
5. Do nothing until the run ends. The wearer may lift the headset off between the start and the end if the run is long
   (the recorder keeps going; the cut uses only the table). Before the end, put it on, look at the table.
6. On the web, wait for "Open blueprint". On the table, wait until the ink has faded into the live plan. Hold 5 s. Stop
   both captures.
7. Optional second angle: the agentic path. In the headset PROJECTS > ADD A PROJECT > pick > ASK, then on the PC's
   Headsets page CONFIRM. It has never run on the device (headset-morning-check.md step 12): film it only after a clean
   dry run, and use it instead of steps 3-4 if it works (it shows the agent asking before it spends).

## Takes to get

- One full real run (both captures), plus a backup run if budget allows (D1). One fake-onboard take of the same layout as
  a rehearsal and as a last-resort fallback (captioned honestly, see Post).
- Clean plates: the web's finished blueprint 5 s; the table's finished plan 5 s from the seat.

## What can go wrong

- The agent names a wing or room after a brand: the run is spent. Check the demo repo's names before filming; dry-run it
  with the stand-in, which takes the names from the folders.
- The headset sleeps when lifted off during a long run (proximity sensor): keep it on, or send `adb shell am broadcast
  -a com.oculus.vrpowermanager.prox_close` before lifting it (the unattended-bench trick; the app may still drop out of
  focus after a while, so re-send it and check before the end), or accept a gap and re-join (the table catches up from the feed: a past batch is drawn at its
  end state at once).
- The table does not switch: `BpLink.Onboarding` logs what it polled; `BpLink.Product <slug>`.
- The run fails partway: the onboarding screen shows the failure band with resume; resume and keep recording.
- A long silence during judging (up to 135 s with no event, measured): the speed-up hides it; do not cut it out, the
  clock must stay continuous.

## Post

- Trim both to the shared sync mark (step 2's room flight: the first frame either side moves).
- 0:28-0:33 real time (typing, Start). 0:33-0:59 the run sped up by one factor on both sides: N = run length / 26 s (a
  12-minute run is about ×28). 0:59-1:05 real time on the finished sheet.
- Layout: web left 960x1080 at 1:1; headset right, a 960x1080 crop around the table from the 1920x1080 capture. Labels
  "PC" and "HEADSET" top-left of each half. The corner tag "Sped up ×N. The clock shows the real run." for the whole
  sped-up stretch. The web's run clock must stay readable (enlarge the crop if not).
- Audio: drop the sped-up audio; music bed only; Glim's NEW line (if made) laid in at 0:32 from its clip, as the
  headset played it in a separate real-time take.
- If only the fake-onboard take exists: caption "Rehearsal run: the reading is simulated, the drawing is real." Better:
  do not use it in the final cut.
