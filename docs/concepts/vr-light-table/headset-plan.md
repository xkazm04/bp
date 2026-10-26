# Headset plan: the light table on the owner's Quest 3S

Written 2026-10-26 for the next session, in which the owner wires the Meta Quest 3S to Lynx and we look at the table in a
real headset for the first time. Until now every reading was made in flat captures or the Meta XR Simulator
(`lynx-plan.md` H1, decision 5). This plan says what to try, in what order, how long each probe gets, and what we record.

## Why the headset, and what we judge there

The flat captures stop being the right instrument at this point. The blind panel scored Kettle 34/45 and pof 31/45
(2026-10-25), and the registry's plateau record (`seated-in-world-reading`, `concept-scene-parity`) says the elements
still at 2 are mostly bound by the device and the forward path. Those are exactly the things only a headset can judge.

In the headset session we judge, in this order:

1. **Comfort, seated.** The owner's doctrine: seated, stationary, with no locomotion. Room switches fade the content and
   never the view. Is there any vection or discomfort when entering, leaving or switching rooms?
2. **Text comfort.** The screen deck's body text sits at about 33–35 arcmin. That clears our 22 arcmin floor but is
   below the vendor's comfortable band of 0.6–0.8° (36–48 arcmin).
   - Read every text class: deck title, body and chips; feature sheet; spines; lamp caption; wrist room list; room
     map names; key plan.
   - Grade each one: reads easily, reads with effort, or doesn't read.
3. **Placement.** Is the deck at 75 cm, straight ahead and 11° below the horizon, comfortable to read without neck
   strain? Is the map visible below it? Is the wrist panel readable with a natural turn of the wrist?
4. **Real hands.** Everything in WP1–WP3 was tested only with simulated hands. Try each gesture and record whether it
   works:
   - tap on the deck tabs, a feature glyph, a key-plan cell and a wrist row;
   - 0.8 s hold on the lamp and on a feature;
   - pinch-drag lasso;
   - room entry by pinch;
   - exit.
5. **Frame time.** The R5 bar is a GPU and game-thread p50 at or under 11.1 ms (90 Hz), with ASW off where the route
   allows it. Measure on the full pof plan in room mode and on the site plan.
6. **The look.** Re-judge the 15 elements in the headset, with the owner as the judge. They are not comparable to the
   capture scores, so record them as a separate column.

## The device: Quest 3S facts that change our numbers [verify on the device]

- **Display:** 1832 x 1920 per eye, a single LCD, Fresnel lenses, Snapdragon XR2 Gen 2, refresh 72/90/120 Hz.
- **Sharpness:** about 20 pixels per degree in the centre, lower than the Quest 3's roughly 25 (pancake lenses) that our
  legibility analysis assumed. Fresnel lenses also lose sharpness quickly away from the centre and add god rays on
  high-contrast text, such as light text on the dark glass deck.
- **What that means for us:**
  - Text that is comfortable on a Quest 3 may only "read with effort" here.
  - The deck's place straight ahead matters more, because the sweet spot is smaller.
  - The light-on-dark decision screens may show glare that the paper sheets do not.
- **If text fails:** do not lower the floor. Make the deck larger or nearer, or move text toward the centre of view
  (`angular-legibility-floor`).

## Before the session: owner steps (only the owner can do these)

1. **Developer mode.** In the Meta Horizon phone app: Devices → the headset → Headset settings → Developer mode on. This
   needs a Meta developer account (free).
2. **Headset update.** Update the firmware; note the version.
3. **Cable.** A USB-C cable that carries USB 3 data, about 3 m or more, plugged into one of Lynx's USB-C ports that
   does data, not only power. Air Link and streaming routes need the headset and Lynx on the same network: 5 GHz, or
   better 6 GHz Wi-Fi, with Lynx wired to the router if possible.
4. **Hand tracking** on in the headset settings (Movement tracking → Hand and body tracking).
5. **A chair.** Any normal chair with no wheels, at the desk where Lynx sits. We set the virtual table's height to the
   seated eye, so the chair height does not matter.

## The route ladder

Lynx runs Windows 11 on ARM64. That is the whole risk: Meta lists Intel and AMD CPUs only for Quest Link
(`lynx-plan.md` H1). Each rung is a timed probe with a clear pass or fail. Stop at the first rung that passes.

| Rung | Route | What it needs | Probe | Time box | Pass |
|---|---|---|---|---|---|
| 1 | **Meta Horizon Link** (cable, then Air Link) | Link PC app on Windows ARM64, emulated x64 if it installs; NVIDIA GPU driver path | Install the app. Does it start, see the headset, and offer "Set Meta Quest Link as active OpenXR runtime"? Then `run-bplink --mode game --vr` with no `--xr-sim` | 30 min | The table appears in the headset through Link, and `LogHMD` names the Oculus OpenXR runtime |
| 2 | **Steam Link** (Valve, free) with SteamVR | Steam and SteamVR on ARM64 under emulation; Steam Link app on the headset | SteamVR starts and the headset sees it; set SteamVR as the OpenXR runtime **per process** (`XR_RUNTIME_JSON` = SteamVR's json), never system-wide | 30 min | As rung 1, with `LogHMD` naming SteamVR |
| 3 | **ALVR** (free, open source) | SteamVR (rung 2's half), plus NVENC on the N1X | ALVR streamer pairs over Wi-Fi | 30 min | As rung 1 |
| 4 | **Virtual Desktop** (paid, about 25 USD, Quest Store) | The VD streamer on ARM64; it has its own OpenXR runtime (VDXR) | **Ask the owner before buying.** Check the streamer's ARM64 status first | 20 min, after approval | As rung 1 |
| 5 | **Standalone Android build** (no PC at runtime) | UE Android SDK/NDK/JDK on Lynx; a Quest 3S packaging profile; the mobile forward renderer | Package `bp` as an APK, install it with `adb`, and run it standalone against apps/server reached over the LAN | A session of its own | The app runs on the headset and fetches the plan over Wi-Fi |

**Rung 5 is a different product.** The PC-tethered quality bar (README, "Quality bar") drops to the mobile renderer on
the XR2 Gen 2, so fidelity will fall a long way: no rect-light path, a tight draw budget, and textures to cut. It is
still the surest way to judge **comfort, text, placement and hands**, which barely depend on the renderer. If rungs
1–4 fail, we decide in the session whether rung 5 is worth a session of its own for those four questions.

**Never run `activate_simulator.ps1`.** It rewrites `HKLM\SOFTWARE\Khronos\OpenXR\1`, which every PC route needs. Each
route selects its runtime per process, or through its own app's switch.

**Port 8000 stays untouched.** apps/server runs on its own port, as in every round.

## Code to change before or during the session

All of these can be built and checked in the Simulator before the headset arrives. Items 1–3 block a fair reading.

1. **Seated calibration (blocks).** Today the headset path uses a LocalFloor origin and lowers the pawn by a standing
   eye of 165 cm (`BpPawn.cpp`, `IsHeadsetOn`). The owner sits, so a 95 cm table would sit at chest height.
   - Add `BpView.Seat` (and a wrist button or a 2 s two-hand hold): read the HMD's current eye position and move the
     table so that eye sits where the target pose puts it, 43 cm above the table top and 30 cm behind the near edge.
   - Moving the table, not the view, keeps the comfort rule.
   - Run it once at start and again on demand. Log the measured eye height.
2. **Anchor the deck, lamp caption and wrist to the seated eye (blocks).** WP2 and WP3 place them from the target eye
   constants. After calibration that is the real eye, but say so in code and re-place on every `BpView.Seat`.
3. **A legibility test card (blocks the text reading).** `BpView.TextCard` shows one panel with every text class
   (deck, sheet, spine, caption, wrist, map name, key plan) at its real size and distance, each labelled with its
   computed arcmin. The owner reads it and grades each line.
4. **A frame-time readout.** A small wrist or corner readout of GPU and game-thread ms (p50 over 2 s), so the owner
   sees it in the headset. `stat unit` does not render legibly in stereo. Also add a CSV run per route, as before.
5. **A headset launch mode.** `run-bplink --mode game --vr --runtime link|steamvr|alvr|vd`, which sets
   `XR_RUNTIME_JSON` per process from the route's known json path, or leaves it unset for Link, and logs the runtime
   it got. The Simulator stays `--xr-sim`.
6. **Hand tracking settings.** Confirm that hand tracking is enabled for the OpenXR path in project settings (Meta XR
   and Isdk; nothing is set in `Config/DefaultEngine.ini` today), and that the Isdk rigs in `BpPawn.cpp` attach when
   a real runtime is present.

## The session script (about 90 minutes once a route works)

1. **Connect (rung ladder).** Note the route, app versions, refresh rate and whether ASW is off.
2. **Seat.** The owner sits and holds still for `BpView.Seat`. Log the eye height.
3. **Comfort.** 5 minutes at the site plan. Enter a room with dive, exit, enter with lift, then switch rooms four
   times by each route. The owner rates comfort 1–5 after each and notes any discomfort.
4. **Text.** Read the test card and grade every line, then read one decision screen, one sheet and the wrist room list
   in place.
5. **Hands.** Run the gesture list from "What we judge" item 4, five tries each. Record hits and misses and what went
   wrong. Allow 3 tries before calling a gesture failed.
6. **Frame time.** Run the CSV on pof, both in room mode with the deck and on the site plan, and record p50, p95 and
   max for GPU and game thread.
7. **Look.** The owner scores the 15 elements in the headset, plus a free note.
8. **Close.** Note what to change first.

## What we record

- `runs/<date>-lynx-quest3s.md`:
  - the route and versions;
  - every rung tried, with its pass or fail line;
  - the seated eye height;
  - comfort ratings;
  - the text grades per class, with each class's computed arcmin;
  - gesture hit rates;
  - frame times against R5;
  - the owner's 15-element headset scores;
  - the owner's notes.
- `machine.md`: new readings for the route, with log lines (`LogHMD` runtime, Link or SteamVR versions).
- `lynx-plan.md` H1: closed by the route that worked, or narrowed by the rungs that failed.
- **Registry.** The `seated-in-world-reading` applications get their first headset evidence:
  - comfort for `fade-the-content-not-the-view`, which is "unmeasurable" today;
  - text grades for `angular-legibility-floor`;
  - placement for `panel-placement-in-the-view-band`.
  
  Also record the Quest 3S's real pixels per degree against the Quest 3 figure the subject quotes.

## Decisions the session may need from the owner

- **Buying Virtual Desktop** (rung 4), if rungs 1–3 fail.
- **Whether to spend a session on the Android build** (rung 5), if every PC route fails, accepting the lower fidelity
  to judge comfort, text and hands.
- **Whether a failed text grade means a larger deck or a nearer one.** Larger keeps the 75 cm reading distance and
  takes more of the view; nearer brings it toward the near half of the table.

## Sources

- Microsoft added Windows on Arm support to its Mixed Reality Link app for Quest 3/3S in August 2025. It streams the
  Windows desktop as virtual monitors, not OpenXR apps, so it does not run the table, but it shows that Quest-to-ARM PC
  pairing works:
  [Windows Central](https://www.windowscentral.com/hardware/virtual-reality/windows-on-arm-pcs-can-now-connect-to-meta-quest-microsoft-sneaks-out-mixed-reality-link-update),
  [Microsoft support](https://support.microsoft.com/en-us/windows/experience/compatibility/about-windows-mixed-reality-link).
- ALVR's own requirements (Windows 10/11; NVENC on NVIDIA; Quest 3S listed): [ALVR on GitHub](https://github.com/alvr-org/ALVR).
- No source found (2026-10-26) confirms Meta Horizon Link, SteamVR or the Virtual Desktop streamer on Windows ARM64.
  Rungs 1–4 are probes, not expectations.
