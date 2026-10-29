# Run note: the first headset session, Quest 3S on Lynx (2026-10-26 to 2026-10-29)

The session followed [`../headset-plan.md`](../headset-plan.md). It was short: the owner wore the headset for a few
minutes, and the script stopped after step 1 (connect), with first readings for steps 2 (seat) and 6 (frame time).
Steps 3 to 5, 7 and 8 are still open.

## Route ladder

| Rung | Route | Result | Evidence |
|---|---|---|---|
| 1 | Meta Horizon Link | **Fail, cannot install on ARM64** | `OculusSetup.log`, twice. On 2026-10-26 the driver step failed: `oculus-driver.exe` exited -2, `OculusDriverInstaller` logged `Unable to load DLL 'DIFxAPI.dll'`. Windows on ARM64 has no DIFxAPI, and Link's USB and display drivers are x64 kernel drivers, which cannot run under emulation. On 2026-10-27 setup stopped earlier, at `CreateLibraryServiceStep` (`IdentityNotMappedException` in `GetServiceSid`), most likely debris from the first rollback. Both rolled back; the Quest's XRSP, Crosswind and Highwind USB interfaces stay in Error. Retrying will not help. |
| 2 | Steam Link + SteamVR | **Pass** | SteamVR and the Steam Link headset app (`qvlclient;panther;2.0.24.2395`) connect over Wi-Fi. `vrserver.txt`: `Model Number: Oculus Quest3S`, frequencies 72/80/90/120 Hz, 90 Hz chosen, NVENC with 10-bit encode, render target 2048 x 2048, encode width 1216. The table's log: `BpHands: Isdk hand and controller rigs on SteamVR/OpenXR (2.18.4)`. |
| 3 to 5 | ALVR, Virtual Desktop, Android | Not tried | Rung 2 passed. |

The launch was `node apps/vr/tools/run-bplink.mjs --mode game --runtime steamvr` (`XR_RUNTIME_JSON` is set for the
process only; HKLM still names the Simulator). Under Git Bash, `--game-mode /Script/...` is rewritten into a Windows path
(`C:/Program Files/Git/Script/...`). The config's `GlobalDefaultGameMode` covered it here. Prefix the command with
`MSYS_NO_PATHCONV=1` when passing that flag.

## What worked

- **The plan loaded from the local server.** Kettle: 5 wings, 13 rooms, 133 tiles.
- **Hands.**
  - SteamVR exposes `XR_EXT_hand_tracking` and `XR_EXT_hand_interaction`, and both hands were tracked.
  - The pawn logged `input=hands`, pinch-push and pinch-pull, and tracking loss with recovery.
  - The Meta-only extensions are missing (`XR_FB_hand_tracking_mesh`, `_aim`, `_capsules`). The Meta XR plugin logs
    `Non-Oculus OpenXR runtime is not supported` and gives way to plain OpenXR, and one engine assertion fires on
    `xrGetHandMeshFB`. Neither stopped the run.
- **The environment.** The owner: "all the background and environment around is straight and looks nice".

## What did not

- **Seat height.**
  - The log: `BpView: seat headset eye_above_floor_cm=67.5 table_top_cm=55.0 eye_above_top_cm=12.5 (target 43) moved_cm=55.2 turned_deg=110.5`.
  - The runtime's floor (Steam Link's) stood 67.5 cm under a seated eye, against about 115 to 125 cm in real life.
  - The seat trusted that floor, so the clamp left the top only 12.5 cm under the eye, where 43 cm was the target.
  - The owner: the wrist and the main deck "misplaced (angle and height) so it is impossible to reach and read almost".
  - Fix (this commit): `ABpPawn::Seat` corrects the floor once when a headset eye reads under `SeatEyeMinCm` (95 cm). It
    raises the pawn so the eye stands at `SeatedEyeCm` (120 cm), then seats the table to that eye. It logs `BpView: seat
    floor corrected by ...`.
  - Built, not yet verified in the headset: the second run never saw a tracked head.
- **The wrist panel's angle.**
  - The panel is attached to the left grip at `FRotator(-60, 180, 0)`, tuned on the Meta runtime.
  - SteamVR's hand grip pose (from `XR_EXT_hand_interaction`) may be oriented differently. Part of what the owner saw is
    the seat height, and part may be this.
  - Open: the owner's description of the panel's tilt in the headset.
- **Frame time, far from R5.**
  - First worn 40 s: `BpFrame: gpu_ms=20.9-21.5 game_ms=25.3-26.1 frame_ms=25.4-26.2` (about 38 fps).
  - The owner read 27 to 28 ms on the wrist meter later, "pretty solid".
  - The bar is 11.1 ms, so both threads are over it, the game thread most.
  - This ran uncooked `-game` from the editor's x64 binaries under ARM64 emulation.
  - After `entering standby` (the headset taken off, 15:30:41) SteamVR throttled the app to about 100 to 210 ms; those
    samples are not the app's cost.

## Open from the session script

Seat verification, comfort, text grades (`BpView.TextCard 1`), gesture hit rates, the CSV frame capture on pof, the
15-element headset scores.
